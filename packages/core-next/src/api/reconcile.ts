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
 * flush in registration order. On the `micro` lane an ask whose microtask
 * finds a pass still open is dropped, as 1.35's scheduleReconcile is: a run
 * leaves flight (resolvers.ts) at 1.35's microtask, so the passes that
 * follow are 1.35's. A module with no constraints and no
 * resolvers defines no feature, so its pass is the L1 pass.
 */

import isDevelopment from "#is-development";
import { type ConstraintDef, createConstraints } from "./constraints.js";
import type { ErrorsFeature, ReconcileFeature, SystemPart } from "./core.js";
import { DERIVATION_DEP_PREFIX, describeDep } from "./facts.js";
import type { RequirementKeyFn, RequirementWithId } from "./requirements.js";
import { type ResolverDef, type Run, createResolvers } from "./resolvers.js";
import type { ModuleDefinition } from "./types.js";

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
    if (hooks.wants(at)) {
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
    if (!def.async && !constraints.isAsync(id)) {
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
    onEvaluate: (id, active) =>
      emit("constraint.evaluate", () => ({ id, active })),
    onError(id, error) {
      const strategy = reportError("constraint", id, error);
      emit("constraint.error", () => ({ id, error }));
      if (strategy === "disable") {
        constraints.disable(id);
      }
    },
  });
  /**
   * Quirk (a): re-dispatches in a row per requirement id under "retry", at
   * most 3; a completed run, a retraction or stop() starts it over.
   */
  const redo = new Map<string, number>();
  /** Requirement ids a run asked to dispatch again (`context.requeue()`). */
  const requeued = new Set<string>();
  /** The requirement set the last commit acted on, by id. */
  let previous = new Map<string, RequirementWithId>();
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
      (kernel.features as { errors?: ErrorsFeature }).errors?.clear_(
        run.resolver_,
      );
      redo.delete(run.req_.id);
      constraints.markResolved(run.req_);
      if (!previous.has(run.req_.id)) {
        // A satisfied or detached run: its requirement left the set
        // already, so if it is asked again it must resolve again. Its
        // `after` dependents are asked again when it leaves flight (1.35).
        constraints.forget(run.req_.id);
      }
    },
    onError(run, error) {
      const req = run.req_;
      // 1.35 passes the requirement as the error's context. Under "throw"
      // this throws, so nothing below runs (no hook, no module hook).
      const strategy = reportError(
        "resolver",
        run.resolver_,
        error,
        req,
        run.satisfied_,
      );
      emit("resolver.error", () => ({ resolver: run.resolver_, req, error }));
      if (strategy === "disable") {
        constraints.disable(req.fromConstraint);
      }
      if (strategy === "retry") {
        // 1.35: the next diff sees it as added, and the pass this asks for
        // runs while the run is in flight, so it drops the dispatch.
        previous.delete(req.id);
        schedule();
        // Quirk (a): the requeue applies once the run is out of flight, so
        // the pass after its end re-dispatches it, if it is still raised.
        const times = (redo.get(req.id) ?? 0) + 1;
        if (times <= 4) {
          redo.set(req.id, times);
          if (times < 4) {
            requeued.add(req.id);
          } else if (isDevelopment) {
            console.warn(
              `[Directive] resolver "${run.resolver_}" failed 3 retries in a row; it will run again when its requirement is raised anew.`,
            );
          }
        }
      }
      // The module's own hook: an observer, after the engine has acted. A
      // throwing hook is isolated and logged with the module's id (1.35).
      const owner =
        (module as { owners_?: Record<string, ModuleDefinition> }).owners_?.[
          run.resolver_
        ] ?? module;
      const hook = (
        owner.hooks as
          | { onResolverError?: (e: Error, r: unknown, c: object) => void }
          | undefined
      )?.onResolverError;
      if (hook) {
        try {
          hook(error, req.requirement, { facts: context.facts });
        } catch (hookError) {
          console.error(
            `[Directive] onResolverError hook for module "${owner.id}" threw:`,
            hookError,
          );
        }
      }
    },
    onEnd(run) {
      // 1.35's onResolutionComplete. A pass asked for while one is open is
      // dropped when its microtask finds the pass still open, as in 1.35.
      settled();
      if (needsPass(run)) {
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
  /** The run in flight for `id`: until it leaves, even once it reported. */
  const runFor = (id: string) => resolvers.inflight.get(id);
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
        // and is superseded if the requirement comes back. One that has
        // reported its outcome already is only marked.
        run.satisfied_ = true;
      } else if (bound) {
        // RFC-0003: not aborted, so its data writes land (the binding still
        // drops a clobbered key); out of flight, so the requirement can be
        // dispatched again.
        resolvers.detach(req.id);
      } else {
        resolvers.abort(req.id);
      }
      constraints.forget(req.id);
      redo.delete(req.id);
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
      let baseline: Map<string, unknown> | undefined;
      if (bindings) {
        for (const req of added) {
          const keys = bindingOf(req);
          if (keys) {
            baseline ??= new Map();
            for (const key of keys) {
              baseline.set(key, context.store.get(key));
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
      const result = {
        unmet: current.filter((r) => !resolvers.inflight.has(r.id)),
        inflight: [...resolvers.inflight.values()].map((run) => ({
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

      return result;
    },
    busy_: () => resolvers.inflight.size > 0,
    start_: () => constraints.markAllDirty(),
    dirty_: (id) => constraints.markDirty(id),
    stop_() {
      // Quirk j: a requirement canceled here leaves the set, so the pass
      // after start() sees it as added and dispatches it again if it is
      // still wanted. 1.35 keeps it and never runs it again.
      for (const id of resolvers.abortAll()) {
        previous.delete(id);
      }
      // A requeue asked by a run just canceled is not carried into start().
      requeued.clear();
      redo.clear();
    },
    inspect_: () => ({
      unmet: [...previous.values()],
      inflight: [...resolvers.inflight.values()].map((run) => ({
        id: run.req_.id,
        resolverId: run.resolver_,
        startedAt: run.startedAt_,
      })),
      constraints: constraints.states_().map((state) => {
        const def = constraintDefs[state.id] as ConstraintDef & {
          meta?: unknown;
        };
        // 1.35 lists `abortOn` only when it names a key.
        const abortOn = def.abortOn?.length ? def.abortOn : undefined;

        return {
          id: state.id,
          active: state.lastResult ?? false,
          disabled: constraints.isDisabled(state.id),
          priority: state.priority,
          hitCount: state.hitCount,
          lastActiveAt: state.lastActiveAt,
          meta: def.meta,
          ...(abortOn ? { abortOn } : {}),
        };
      }),
      resolvers: Object.fromEntries(
        [...resolvers.inflight.values()].map((run) => [
          run.req_.id,
          status(run),
        ]),
      ),
    }),
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
  /** 1.35's ResolverStatus for a run in flight: pending, then running. */
  const status = (run: Run): Record<string, unknown> =>
    run.attempt_ === 0
      ? {
          state: "pending",
          requirementId: run.req_.id,
          startedAt: run.startedAt_,
        }
      : {
          state: "running",
          requirementId: run.req_.id,
          startedAt: run.startedAt_,
          attempt: run.attempt_,
        };
  /** 1.35's explain(): why a requirement in the current set is there. */
  system.explain = (requirementId: string): string | null => {
    const req = previous.get(requirementId);
    if (!req) {
      return null;
    }
    const from = req.fromConstraint;
    const state = constraints.state_(from);
    const run = resolvers.inflight.get(requirementId);
    const relevant: Record<string, unknown> = {};
    const read = constraints.depsOf(from);
    if (read) {
      for (const dep of read) {
        relevant[describeDep(dep)] = dep.startsWith(DERIVATION_DEP_PREFIX)
          ? context.derived[dep.slice(1)]
          : context.store.get(dep);
      }
    } else {
      Object.assign(relevant, context.store.toObject());
    }
    const meta = (constraintDefs[from] as { meta?: Record<string, any> })?.meta;
    const lines = [
      `Requirement "${req.requirement.type}" (id: ${req.id})`,
      `├─ Produced by constraint: ${meta?.label ?? from}`,
      `├─ Constraint priority: ${state?.priority ?? 0}`,
      `├─ Constraint active: ${state?.lastResult ?? "unknown"}`,
      // Outcomes are not kept (1.35 keeps an LRU of them): a requirement
      // not in flight reads "idle".
      `├─ Resolver status: ${run ? status(run).state : "idle"}`,
    ];
    if (meta?.description) {
      lines.push(`├─ Description: ${meta.description}`);
    }
    const payload = Object.entries(req.requirement)
      .filter(([k]) => k !== "type")
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(", ");
    if (payload) {
      lines.push(`├─ Requirement payload: { ${payload} }`);
    }
    const entries = Object.entries(relevant).slice(0, 10);
    if (entries.length > 0) {
      lines.push("└─ Relevant facts:");
      entries.forEach(([k, v], i) => {
        const text = typeof v === "object" ? JSON.stringify(v) : String(v);
        lines.push(
          `${i === entries.length - 1 ? "   └─" : "   ├─"} ${k} = ${text.slice(0, 50)}${text.length > 50 ? "..." : ""}`,
        );
      });
    }

    return lines.join("\n");
  };
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
