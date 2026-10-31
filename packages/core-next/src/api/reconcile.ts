/**
 * The L2 reconcile part: constraints → requirements → resolvers, driven by
 * the system core's async pass (core.ts `reconcile`).
 *
 * The core owns the pass and its timing: it runs on the kernel's lane (one
 * micro flush for every system on a scheduler), awaits effects only when an
 * effect returned a promise, then asks this part through three hooks:
 *
 * 1. `begin_` (pass start, synchronous): where L2b closes the pass's writer
 *    stamps. Nothing to do at L2a.
 * 2. `evaluate_` (after effects): last pass's requirements when nothing a
 *    constraint read changed (synchronous, as 1.35's `evaluateUnaffected`),
 *    else the async evaluation the core awaits.
 * 3. `commit_` (same continuation as the core's pass end): diff against the
 *    previous set; cancel each removed requirement's run, dispatch each
 *    added one; answer the `onReconcileEnd` result.
 *
 * Follow-up passes (a run ended, `enable()`) go through the core's
 * `schedule`, which asks the kernel's scheduler, so systems sharing one
 * flush in registration order. A module with no constraints and no
 * resolvers defines no feature, so its pass is the L1 pass.
 */

import { type ConstraintDef, createConstraints } from "./constraints.js";
import type { ReconcileFeature, SystemPart } from "./core.js";
import type { RequirementKeyFn, RequirementWithId } from "./requirements.js";
import { type ResolverDef, createResolvers } from "./resolvers.js";

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
  const resolvers = createResolvers({
    defs: resolverDefs,
    facts: ctx.facts,
    store: ctx.store,
    clock,
    owner: kernel.owner,
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
    onEnd() {
      settled();
      schedule();
    },
  });

  /** The requirement set the last commit acted on, by id. */
  let previous = new Map<string, RequirementWithId>();

  const feature: ReconcileFeature = {
    begin_() {},
    evaluate_: (passKeys) =>
      constraints.unaffected(passKeys) ?? constraints.evaluate(passKeys),
    commit_(current) {
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
      for (const req of removed) {
        resolvers.abort(req.id);
        constraints.forget(req.id);
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
