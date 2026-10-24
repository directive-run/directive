/**
 * The L2 reconcile part (spike): constraints → requirements → resolvers,
 * driven by the system core's async pass (core.ts `reconcile`).
 *
 * The core owns the pass and its timing: it runs on the kernel's lane (one
 * micro flush for every system on a scheduler), awaits effects only when an
 * effect returned a promise, then asks this part. This part:
 *
 * 1. `begin_` (pass start, synchronous): closes the writer-stamp record of
 *    the writes this pass is about and opens the next one.
 * 2. `evaluate_` (after effects): last pass's requirements when nothing a
 *    constraint read changed (synchronous, as 1.35's `evaluateUnaffected`),
 *    else the async evaluation the core awaits.
 * 3. `commit_` (same continuation as the core's pass end): diff against the
 *    previous set; a removed requirement whose run's own writes were the only
 *    change to what its constraint read is satisfied, any other is canceled;
 *    each added one is dispatched; requeues are applied.
 *
 * Follow-up passes (a run ended, a requeue) go through the core's
 * `schedule`, which asks the kernel's scheduler, so systems sharing one
 * flush in registration order.
 *
 * SPIKE: not reviewed, not for merge. See docs/rfc-l2-reconcile.md.
 */

import { type ConstraintDef, createConstraints } from "./constraints.js";
import type { ReconcileFeature, SystemPart } from "./core.js";
import { DERIVATION_DEP_PREFIX } from "./facts.js";
import type { RequirementKeyFn, RequirementWithId } from "./requirements.js";
import { type ResolverDef, type Run, createResolvers } from "./resolvers.js";

declare module "../kernel.js" {
  interface KernelFeatures {
    /** Added by `withReconcile` (reconcile.ts). */
    reconcile: ReconcileFeature;
  }
}

export const withReconcile: SystemPart = (ctx) => {
  const { kernel, module, system, reportError, schedule, settled } = ctx;
  const constraintDefs = (module.constraints ?? {}) as Record<
    string,
    ConstraintDef
  >;
  const resolverDefs = (module.resolvers ?? {}) as Record<string, ResolverDef>;
  if (
    Object.keys(constraintDefs).length === 0 &&
    Object.keys(resolverDefs).length === 0
  ) {
    // No feature: the core's pass stays exactly the L1 pass.
    return;
  }
  const { hooks, clock } = kernel;
  const emit = (at: string, data: () => Record<string, unknown>) => {
    if (hooks.live) {
      hooks.emit(at, data());
    }
  };
  const keys: Record<string, RequirementKeyFn> = {};
  for (const def of Object.values(resolverDefs)) {
    if (def?.key && typeof def.requirement === "string") {
      keys[def.requirement] = def.key;
    }
  }
  const derivationIds = new Set(Object.keys(module.derive ?? {}));
  const constraints = createConstraints({
    defs: constraintDefs,
    facts: ctx.facts,
    derived: ctx.derived,
    tracker: ctx.tracker,
    keys,
    isDerivation: (name) => derivationIds.has(name),
    watch: ctx.watch,
    clock,
    owner: kernel.owner,
    onEvaluate: (id, active) =>
      emit("constraint.evaluate", () => ({ id, active })),
    onError(id, error) {
      reportError("constraint", id, error);
      emit("constraint.error", () => ({ id, error }));
    },
  });
  const requeued = new Set<string>();
  const resolvers = createResolvers({
    defs: resolverDefs,
    facts: ctx.facts,
    store: ctx.store,
    clock,
    owner: kernel.owner,
    rng: kernel.rng,
    emit,
    onComplete(run) {
      emit("resolver.complete", () => ({
        resolver: run.resolver_,
        req: run.req_,
        duration: clock.now() - run.startedAt_,
      }));
      emit("requirement.met", () => ({
        req: run.req_,
        resolver: run.resolver_,
      }));
      constraints.markResolved(run.req_.fromConstraint);
    },
    onError(run, error) {
      reportError("resolver", run.resolver_, error);
      emit("resolver.error", () => ({
        resolver: run.resolver_,
        req: run.req_,
        error,
      }));
    },
    onEnd(satisfied) {
      // A satisfied run's finish changes nothing a pass acts on unless it
      // left a requeue or a dirty constraint behind; settle still hears it.
      settled();
      if (!satisfied || requeued.size > 0 || constraints.hasDirty()) {
        schedule();
      }
    },
    onRequeue: (id) => requeued.add(id),
  });

  // --- writer stamps (A3) --------------------------------------------------
  // key -> the writers that changed it: run ids, 0 for anything else. Kept
  // only while a run could write (as 1.35 counts only then), double
  // buffered: `open` takes writes, `closed` is what this pass is about.
  let open = new Map<string, Set<number>>();
  let closed = new Map<string, Set<number>>();

  /**
   * Whether `run`'s own writes, with those of the other runs whose
   * requirements disappeared this pass (`joint`), were the only changes this
   * pass to what the constraint reads. 1.35 `satisfiedByOwnWrite`.
   */
  function satisfied(
    run: Run,
    passKeys: Set<string>,
    joint: Set<number>,
  ): boolean {
    const read = constraints.depsOf(run.req_.fromConstraint);
    if (!joint.has(run.id_) || !read) {
      return false;
    }
    let changed = 0;
    for (const dep of read) {
      // SPIKE GAP: 1.35 follows a derivation to the facts it reads.
      if (dep.startsWith(DERIVATION_DEP_PREFIX) || !passKeys.has(dep)) {
        continue;
      }
      changed++;
      for (const by of closed.get(dep) ?? []) {
        if (!joint.has(by)) {
          return false;
        }
      }
    }

    return changed > 0;
  }

  let previous = new Map<string, RequirementWithId>();
  let lastCurrent: RequirementWithId[] = [];
  let lastRemoved: RequirementWithId[] = [];

  const feature: ReconcileFeature = {
    stamp_(key) {
      const by = resolvers.takeWriter();
      if (resolvers.live.size > 0) {
        let set = open.get(key);
        if (!set) {
          open.set(key, (set = new Set()));
        }
        set.add(by);
      }
    },
    begin_() {
      const done = closed;
      closed = open;
      done.clear();
      open = done;
    },
    evaluate_: (passKeys) =>
      constraints.unaffected(passKeys) ?? constraints.evaluate(passKeys),
    commit_(current, passKeys) {
      const quiet = current.length === 0 && previous.size === 0;
      const next = quiet ? previous : new Map<string, RequirementWithId>();
      const added: RequirementWithId[] = [];
      const removed: RequirementWithId[] = [];
      if (!quiet) {
        for (const req of current) {
          if (!next.has(req.id)) {
            next.set(req.id, req);
          }
          emit("requirement.created", () => ({ req }));
        }
        for (const [id, req] of next) {
          if (!previous.has(id)) {
            added.push(req);
          }
        }
        for (const [id, req] of previous) {
          if (!next.has(id)) {
            removed.push(req);
          }
        }
      }
      if (removed.length > 0) {
        // The runs whose requirements disappeared and that wrote this pass
        // own the pass's changes jointly (keyed siblings writing one fact).
        const wrote = new Set<number>();
        for (const by of closed.values()) {
          for (const w of by) {
            wrote.add(w);
          }
        }
        const joint = new Set<number>();
        for (const req of removed) {
          const run = resolvers.inflight.get(req.id);
          if (run && wrote.has(run.id_)) {
            joint.add(run.id_);
          }
        }
        for (const req of removed) {
          const run = resolvers.inflight.get(req.id);
          if (run && joint.size > 0 && satisfied(run, passKeys, joint)) {
            // Its own write made the requirement go away: not canceled. It
            // stays in flight (stop aborts it, settle waits), is not retried,
            // and is superseded if the requirement comes back.
            resolvers.markSatisfied(req.id);
            continue;
          }
          resolvers.abort(req.id);
        }
      }
      for (const req of added) {
        resolvers.resolve(req);
      }
      previous = next;
      // ctx.requeue(): applied once the requeuing run is out of flight, so
      // the next diff sees the requirement as added.
      if (requeued.size > 0) {
        let applied = false;
        for (const id of requeued) {
          if (!resolvers.inflight.has(id)) {
            previous.delete(id);
            requeued.delete(id);
            applied = true;
          }
        }
        if (applied) {
          schedule();
        }
      }
      lastCurrent = current;
      lastRemoved = removed;
    },
    busy_: () => resolvers.inflight.size > 0,
    start_: () => constraints.markAllDirty(),
    stop_: () => resolvers.abortAll(),
    result_() {
      const inflight = [...resolvers.inflight.values()].map((run) => ({
        id: run.req_.id,
        resolverId: run.resolver_,
        startedAt: run.startedAt_,
      }));

      return {
        unmet: lastCurrent.filter((r) => !resolvers.inflight.has(r.id)),
        inflight,
        completed: [],
        canceled: lastRemoved.map((r) => ({
          id: r.id,
          resolverId: resolvers.inflight.get(r.id)?.resolver_ ?? "unknown",
        })),
      };
    },
    details_() {
      const out: string[] = [];
      const runs = [...resolvers.inflight.values()];
      if (runs.length > 0) {
        out.push(
          `${runs.length} resolvers inflight: ${runs.map((r) => r.resolver_).join(", ")}`,
        );
      }

      return out;
    },
    unmet_() {
      const all = [...previous.values()];

      return all.length > 0
        ? [
            `${all.length} unmet requirements: ${all.map((r) => r.requirement.type).join(", ")}`,
          ]
        : [];
    },
  };
  kernel.define("reconcile", feature);
  system.constraints = {
    disable: (id: string) => constraints.disable(id),
    enable(id: string) {
      constraints.enable(id);
      schedule();
    },
    isDisabled: (id: string) => constraints.isDisabled(id),
  };
};
