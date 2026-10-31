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
 *    other is canceled, or detached when its constraint is bound (RFC-0003).
 *    Each added one is dispatched with one baseline of the bound keys, read
 *    before any of them starts, then requeues are applied; answers the
 *    `onReconcileEnd` result.
 *
 * Follow-up passes (a run ended, a requeue, `enable()`) go through the core's
 * `schedule`, which asks the kernel's scheduler, so systems sharing one
 * flush in registration order. A module with no constraints and no
 * resolvers defines no feature, so its pass is the L1 pass.
 */

import isDevelopment from "#is-development";
import { type ConstraintDef, createConstraints } from "./constraints.js";
import type { ReconcileFeature, SystemPart } from "./core.js";
import { DERIVATION_DEP_PREFIX } from "./facts.js";
import type { RequirementKeyFn, RequirementWithId } from "./requirements.js";
import { type ResolverDef, type Run, createResolvers } from "./resolvers.js";

/** Slots in a bound key's `[stamp, changes, dropped]` count triples. */
const CHANGED = 1;
const DROPPED = 2;

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
  /** Some constraint lists `abortOn` keys: only then is a baseline read. */
  const bindings = Object.values(constraintDefs).some(
    (def) => (def?.abortOn?.length ?? 0) > 0,
  );
  /** `id::reason` pairs already reported as binding disabled (1.35). */
  const disabledBinding = new Set<string>();
  /**
   * 1.35's getConstraintBinding: the constraint's `abortOn` keys, unless it
   * is async (declared, or found async at runtime). An async constraint
   * awaits between its answer and the dispatch, so it cannot be bound; that
   * is reported once per constraint and reason.
   */
  const bindingOf = (req: RequirementWithId): readonly string[] | undefined => {
    const id = req.fromConstraint;
    const def = bindings && id ? constraintDefs[id] : undefined;
    const keys = def?.abortOn;
    if (!keys || keys.length === 0) {
      return undefined;
    }
    if (!def.async && !constraints.isAsync(id!)) {
      return keys;
    }
    const reason = def.async ? "async-declared" : "async-promoted";
    const once = `${id}::${reason}`;
    if (!disabledBinding.has(once)) {
      disabledBinding.add(once);
      if (isDevelopment) {
        console.warn(
          reason === "async-promoted"
            ? `[Directive] constraint '${id}': abortOn binding disabled because when() returned a Promise — convert to a synchronous when, mark the constraint async: true and accept the binding being off, or use a data-form when (always sync).`
            : `[Directive] Constraint "${id}" has \`abortOn\` but is async. Binding is disabled — async constraints cannot be bound. To enable abortOn, switch to a synchronous function-form when or a data-form when (always sync), and drop \`async: true\`.`,
        );
      }
      emit("constraint.binding.disabled", () => ({ id, reason }));
    }

    return undefined;
  };
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
  /** Between `begin_` and `commit_`. */
  let passOpen = false;
  /**
   * Runs that ended on their own (complete or error) while a pass was open,
   * by requirement id. Their slot is empty already (one outcome), but the
   * pass's commit still decides for them, as 1.35's commit does for a run
   * that has reported its outcome and not yet left its in-flight map: whether
   * its own writes satisfied its requirement, and whether its end needs a
   * pass.
   */
  const ended = new Map<string, Run>();
  const resolvers = createResolvers({
    defs: resolverDefs,
    store: context.store,
    factsFor: context.factsFor,
    peek: (key) => context.store.get(key),
    has: (key) => context.store.has(key),
    onDrop: (key, stamp) => tally(key, stamp, DROPPED),
    bindingOf,
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
        // A satisfied or detached run: its requirement left the set
        // already, so if it is asked again it must resolve again.
        constraints.forget(run.req_.id);
        if (!run.detached_ && constraints.hasDirty()) {
          // Its `after` dependents are asked again (1.35). A detached run's
          // end asks for no pass in 1.35.
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
      if (passOpen) {
        // The open pass's commit decides for it (see `ended`).
        ended.set(run.req_.id, run);
      } else if (needsPass(run)) {
        schedule();
      }
    },
    onRequeue: (id) => requeued.add(id),
  });

  /**
   * As 1.35: a satisfied run's finish changes nothing a pass acts on, unless
   * it left a requeue or a dirty constraint behind.
   */
  const needsPass = (run: Run) =>
    !run.satisfied_ || requeued.size > 0 || constraints.hasDirty();

  // --- writer stamps (RFC row 1) -------------------------------------------
  // key → who changed it: one stamp, or several once a second writer comes.
  // Double buffered: `open` takes the writes since this pass began,
  // `closed` holds the window the pass keys came from. A write allocates
  // nothing unless a second writer changes the same key in one window.
  let open = new Map<string, number | number[]>();
  let closed = new Map<string, number | number[]>();
  // --- bound keys: counted (RFC-0003 with RFC row 1) ----------------------
  // 1.35 counts a run's write to a bound key as its own even when the
  // binding drops it, and compares counts: the removed runs' writes to a key
  // must number its changes. So a key the runs changed nothing of, but that
  // one of them tried to change after another writer did, is still theirs.
  // Only a bound key can drop a write, so only bound keys are counted, per
  // writer: flat `[stamp, changes, dropped]` triples, double buffered like
  // the stamps. Every other key is answered by the stamps alone.
  const boundKeys = bindings
    ? new Set(
        Object.values(constraintDefs).flatMap((def) => def?.abortOn ?? []),
      )
    : null;
  let openTally = new Map<string, number[]>();
  let closedTally = new Map<string, number[]>();
  const tally = (key: string, stamp: number, slot: 1 | 2) => {
    const counts = openTally.get(key);
    if (counts === undefined) {
      openTally.set(key, [stamp, slot === CHANGED ? 1 : 0, slot - 1]);

      return;
    }
    for (let i = 0; i < counts.length; i += 3) {
      if (counts[i] === stamp) {
        counts[i + slot]!++;

        return;
      }
    }
    counts.push(stamp, slot === CHANGED ? 1 : 0, slot - 1);
  };
  if (Object.keys(resolverDefs).length > 0) {
    context.writers.record = (key, stamp) => {
      // As 1.35: a write counts only while a run is in flight (or detached
      // and still going). One made with none (a plugin writing before the
      // first run starts) is nobody's.
      if (resolvers.inflight.size === 0 && resolvers.detached.size === 0) {
        return;
      }
      if (boundKeys?.has(key)) {
        tally(key, stamp, CHANGED);
      }
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
    const counts = closedTally.get(key);
    if (counts !== undefined) {
      // 1.35's count test: the joint runs' changes plus their dropped writes
      // equal all its changes, so the drops make up for the other writers'.
      let others = 0;
      let dropped = 0;
      for (let i = 0; i < counts.length; i += 3) {
        if (joint.has(counts[i]!)) {
          dropped += counts[i + DROPPED]!;
        } else {
          others += counts[i + CHANGED]!;
        }
      }

      return others === dropped;
    }
    const by = closed.get(key);
    if (by === undefined) {
      // Changed while no run was in flight: uncounted, as in 1.35, so it
      // does not count against the runs.
      return true;
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
  /** The run in flight for `id`, or one that ended in this pass. */
  const runFor = (id: string) => resolvers.inflight.get(id) ?? ended.get(id);
  /** Retract each removed requirement: satisfied runs go on, others cancel. */
  function retract(removed: RequirementWithId[], passKeys: Set<string>) {
    // The runs whose requirements disappeared and that wrote this pass own
    // the pass's changes jointly (keyed siblings writing one fact).
    const joint = new Set<number>();
    if (closed.size > 0 || closedTally.size > 0) {
      for (const req of removed) {
        const run = runFor(req.id);
        if (run && wrote(run.stamp_)) {
          joint.add(run.stamp_);
        }
      }
    }
    for (const req of removed) {
      // Looked up first, as 1.35 does: it may report a disabled binding.
      const bound = bindingOf(req);
      const run = runFor(req.id);
      if (run && joint.size > 0 && satisfied(run, passKeys, joint)) {
        // Its own write made the requirement go away: not canceled. It
        // stays in flight (stop aborts it, settle waits), is not retried,
        // and is superseded if the requirement comes back. One that ended
        // in this pass has reported its outcome; it is only marked.
        run.satisfied_ = true;
      } else if (ended.get(req.id) === run) {
        // Ended in this pass, not by its own write: its outcome stands
        // (one per run). 1.35 would cancel it as well.
        ended.delete(req.id);
      } else if (bound) {
        // RFC-0003: not aborted, so its data writes land (the binding still
        // drops a clobbered key); out of flight, so the requirement can be
        // dispatched again.
        resolvers.detach(req.id);
      } else {
        resolvers.abort(req.id);
      }
      constraints.forget(req.id);
    }
  }
  /** `stamp` changed some key in the closed window, or tried to (dropped). */
  const wrote = (stamp: number) => {
    for (const by of closed.values()) {
      if (by === stamp || (typeof by !== "number" && by.includes(stamp))) {
        return true;
      }
    }
    for (const counts of closedTally.values()) {
      for (let i = 0; i < counts.length; i += 3) {
        if (counts[i] === stamp && counts[i + DROPPED]! > 0) {
          return true;
        }
      }
    }

    return false;
  };

  const feature: ReconcileFeature = {
    begin_() {
      passOpen = true;
      const done = closed;
      closed = open;
      done.clear();
      open = done;
      if (boundKeys !== null) {
        const counted = closedTally;
        closedTally = openTally;
        counted.clear();
        openTally = counted;
      }
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
      // One baseline for every run this pass dispatches, read before the
      // first starts: a run's synchronous write to a key a later sibling is
      // bound to is then a clobber for that sibling (1.35). Only the bound
      // keys are read, and nothing at all without a binding.
      let baseline: Record<string, unknown> | undefined;
      if (bindings) {
        for (const req of added) {
          const keys = bindingOf(req);
          if (keys) {
            baseline ??= Object.create(null) as Record<string, unknown>;
            for (const key of keys) {
              baseline[key] = context.store.get(key);
            }
          }
        }
      }
      for (const req of added) {
        if (system.isRunning) {
          resolvers.resolve(req, baseline);
        } else {
          // Stopped while this pass waited: left for start() to dispatch.
          next.delete(req.id);
        }
      }
      previous = next;
      passOpen = false;
      if (requeued.size > 0) {
        // Applied once the requeuing run is out of flight (RFC row 7): a
        // run still going would drop the dispatch as a duplicate, and the
        // requeue would be lost. Its end schedules the pass that applies it;
        // for a run that ended in this pass, that is the next one, as 1.35.
        let applied = false;
        for (const id of requeued) {
          if (!resolvers.inflight.has(id) && !ended.has(id)) {
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
      // A run that ended in this pass is listed as 1.35 lists it, still in
      // flight, in dispatch order (stamps rise with each dispatch).
      let inflight = [...resolvers.inflight.values()];
      let pending = false;
      if (ended.size > 0) {
        inflight = [...inflight, ...ended.values()].sort(
          (a, b) => a.stamp_ - b.stamp_,
        );
        for (const run of ended.values()) {
          pending ||= needsPass(run);
        }
      }
      const listed = (id: string) =>
        resolvers.inflight.has(id) || ended.has(id);
      const result = {
        unmet: current.filter((r) => !listed(r.id)),
        inflight: inflight.map((run) => ({
          id: run.req_.id,
          resolverId: run.resolver_,
          startedAt: run.startedAt_,
        })),
        completed: [],
        // As 1.35: a canceled run is gone by now, so its resolver is
        // "unknown"; one still listed (satisfied) is named.
        canceled: removed.map((r) => ({
          id: r.id,
          resolverId: runFor(r.id)?.resolver_ ?? "unknown",
        })),
      };
      ended.clear();
      if (pending) {
        // A run that ended in this pass needs one after it.
        schedule();
      }

      return result;
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
