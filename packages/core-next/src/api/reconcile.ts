/**
 * The L2 reconcile part: constraints → requirements → resolvers, driven by
 * the system core's async pass (core.ts `reconcile`).
 *
 * The core owns the pass and its timing: it runs on the kernel's lane (one
 * micro flush for every system on a scheduler), awaits effects only when an
 * effect returned a promise, then asks this part through three hooks:
 *
 * 1. `begin_` (pass start, synchronous): closes the pass's writer record,
 *    `key → stamps` of the writes since the last pass began (the same
 *    window as the core's pass keys).
 * 2. `evaluate_` (after effects): last pass's requirements when nothing a
 *    constraint read changed (synchronous, as 1.35's `evaluateUnaffected`),
 *    else the async evaluation the core awaits.
 * 3. `commit_` (same continuation as the core's pass end): diff against the
 *    previous set. A removed requirement whose run's own writes were the
 *    only change to what its constraint read is satisfied (RFC row 1); any
 *    other is canceled. Each added one is dispatched, then requeues are
 *    applied; answers the `onReconcileEnd` result.
 *
 * Follow-up passes (a run ended, a requeue, `enable()`) go through the core's
 * `schedule`, which asks the kernel's scheduler, so systems sharing one
 * flush in registration order. A module with no constraints and no
 * resolvers defines no feature, so its pass is the L1 pass.
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

export const withReconcile: SystemPart = (context) => {
  const { kernel, module, system, reportError, schedule, settled } = context;
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
  const { hooks, clock, rng } = kernel;
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
    facts: context.facts,
    derived: context.derived,
    tracker: context.tracker,
    keys,
    isDerivation: (name) => derivationIds.has(name),
    watch: context.watch,
    clock,
    owner: kernel.owner,
    onEvaluate: (id, active) =>
      emit("constraint.evaluate", () => ({ id, active })),
    onError(id, error) {
      reportError("constraint", id, error);
      emit("constraint.error", () => ({ id, error }));
    },
  });
  /** Requirement ids a run asked to dispatch again (`context.requeue()`). */
  const requeued = new Set<string>();
  /** The requirement set the last commit acted on, by id. */
  let previous = new Map<string, RequirementWithId>();
  const resolvers = createResolvers({
    defs: resolverDefs,
    store: context.store,
    factsFor: context.factsFor,
    clock,
    owner: kernel.owner,
    // The kernel's seeded rng when it has one; else the host's, read at
    // each draw (as 1.35 does).
    random: rng ?? (() => Math.random()),
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
      constraints.markResolved(run.req_);
      if (!previous.has(run.req_.id)) {
        // A satisfied run: its requirement left the set already, so if it
        // is asked again it must resolve again.
        constraints.forget(run.req_.id);
        if (constraints.hasDirty()) {
          // Its `after` dependents are asked again (1.35).
          schedule();
        }
      }
    },
    onError(run, error) {
      // 1.35 passes the requirement as the error's context.
      reportError("resolver", run.resolver_, error, run.req_);
      emit("resolver.error", () => ({
        resolver: run.resolver_,
        req: run.req_,
        error,
      }));
    },
    onEnd(run) {
      settled();
      // As 1.35: a satisfied run's finish changes nothing a pass acts on,
      // unless it left a requeue or a dirty constraint behind.
      if (!run.satisfied_ || requeued.size > 0 || constraints.hasDirty()) {
        schedule();
      }
    },
    onRequeue: (id) => requeued.add(id),
  });

  // --- writer stamps (RFC row 1) -------------------------------------------
  // key → who changed it: one stamp, or several once a second writer comes.
  // Double buffered: `open` takes the writes since this pass began,
  // `closed` holds the window the pass keys came from. A write allocates
  // nothing unless a second writer changes the same key in one window.
  let open = new Map<string, number | number[]>();
  let closed = new Map<string, number | number[]>();
  if (Object.keys(resolverDefs).length > 0) {
    context.writers.record = (key, stamp) => {
      const by = open.get(key);
      if (by === undefined) {
        open.set(key, stamp);
      } else if (typeof by === "number") {
        if (by !== stamp) {
          open.set(key, [by, stamp]);
        }
      } else if (!by.includes(stamp)) {
        by.push(stamp);
      }
    };
  }
  /** Every write to `key` in the closed window came from one of `joint`. */
  const ownedBy = (key: string, joint: ReadonlySet<number>) => {
    const by = closed.get(key);
    if (by === undefined) {
      // A change nobody stamped: not a run's.
      return false;
    }
    if (typeof by === "number") {
      return joint.has(by);
    }

    return by.every((stamp) => joint.has(stamp));
  };
  /**
   * 1.35's satisfiedByOwnWrite: `run` wrote this pass, and every change this
   * pass to what its constraint read, directly or through derivations
   * (followed to their facts), came from `joint`, the runs whose
   * requirements were removed in this pass. Anything else that touched what
   * the constraint reads makes it an ordinary retraction, canceled.
   */
  function satisfied(
    run: Run,
    passKeys: ReadonlySet<string>,
    joint: ReadonlySet<number>,
  ): boolean {
    const read = constraints.depsOf(run.req_.fromConstraint);
    if (!read || !joint.has(run.stamp_)) {
      return false;
    }
    let changed = 0;
    const seen = new Set<string>();
    const owned = (deps: Iterable<string>): boolean => {
      for (const dep of deps) {
        if (dep.startsWith(DERIVATION_DEP_PREFIX)) {
          if (!seen.has(dep)) {
            seen.add(dep);
            const inner = context.derivationDeps(dep.slice(1));
            if (inner && !owned(inner)) {
              return false;
            }
          }
          continue;
        }
        if (passKeys.has(dep)) {
          changed++;
          if (!ownedBy(dep, joint)) {
            return false;
          }
        }
      }

      return true;
    };

    return owned(read) && changed > 0;
  }
  /** Retract each removed requirement: satisfied runs go on, others cancel. */
  function retract(removed: RequirementWithId[], passKeys: Set<string>) {
    // The runs whose requirements disappeared and that wrote this pass own
    // the pass's changes jointly (keyed siblings writing one fact).
    const joint = new Set<number>();
    if (closed.size > 0) {
      for (const req of removed) {
        const run = resolvers.inflight.get(req.id);
        if (run && wrote(run.stamp_)) {
          joint.add(run.stamp_);
        }
      }
    }
    for (const req of removed) {
      const run = resolvers.inflight.get(req.id);
      if (run && joint.size > 0 && satisfied(run, passKeys, joint)) {
        // Its own write made the requirement go away: not canceled. It
        // stays in flight (stop aborts it, settle waits), is not retried,
        // and is superseded if the requirement comes back.
        resolvers.satisfy(req.id);
      } else {
        resolvers.abort(req.id);
      }
      constraints.forget(req.id);
    }
  }
  /** `stamp` changed some key in the closed window. */
  const wrote = (stamp: number) => {
    for (const by of closed.values()) {
      if (by === stamp || (typeof by !== "number" && by.includes(stamp))) {
        return true;
      }
    }

    return false;
  };

  const feature: ReconcileFeature = {
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
        retract(removed, passKeys);
      }
      for (const req of added) {
        if (system.isRunning) {
          resolvers.resolve(req);
        } else {
          // Stopped while this pass waited: left for start() to dispatch.
          next.delete(req.id);
        }
      }
      previous = next;
      if (requeued.size > 0) {
        // Applied once the requeuing run is out of flight (RFC row 7): a
        // run still going would drop the dispatch as a duplicate, and the
        // requeue would be lost. Its end schedules the pass that applies it.
        let applied = false;
        for (const id of requeued) {
          if (!resolvers.inflight.has(id)) {
            previous.delete(id);
            requeued.delete(id);
            applied = true;
          }
        }
        if (applied) {
          // The next diff sees the requirement as added, if still asked.
          schedule();
        }
      }
      if (constraints.hasDirty()) {
        // A constraint held back by `after` was released (quirk e).
        schedule();
      }
      const inflight = [...resolvers.inflight.values()];

      return {
        unmet: current.filter((r) => !resolvers.inflight.has(r.id)),
        inflight: inflight.map((run) => ({
          id: run.req_.id,
          resolverId: run.resolver_,
          startedAt: run.startedAt_,
        })),
        completed: [],
        // As 1.35: a canceled run is gone by now, so its resolver is
        // "unknown"; one still in flight (L2b: satisfied) is named.
        canceled: removed.map((r) => ({
          id: r.id,
          resolverId: resolvers.inflight.get(r.id)?.resolver_ ?? "unknown",
        })),
      };
    },
    busy_: () => resolvers.inflight.size > 0,
    start_: () => constraints.markAllDirty(),
    stop_() {
      // Quirk j: a requirement canceled here leaves the set, so the pass
      // after start() sees it as added and dispatches it again if it is
      // still wanted. 1.35 keeps it and never runs it again.
      for (const id of resolvers.abortAll()) {
        previous.delete(id);
      }
    },
    details_(core) {
      const runs = [...resolvers.inflight.values()];
      const all = [...previous.values()];

      return [
        ...(runs.length > 0
          ? [
              `${runs.length} resolvers inflight: ${runs.map((r) => r.resolver_).join(", ")}`,
            ]
          : []),
        ...core,
        ...(all.length > 0
          ? [
              `${all.length} unmet requirements: ${all.map((r) => r.requirement.type).join(", ")}`,
            ]
          : []),
      ];
    },
  };
  kernel.define("reconcile", feature);
  system.constraints = {
    disable(id: string) {
      // Quirk e: a dependent it held back is asked again.
      if (constraints.disable(id)) {
        schedule();
      }
    },
    enable(id: string) {
      constraints.enable(id);
      schedule();
    },
    isDisabled: (id: string) => constraints.isDisabled(id),
  };
};
