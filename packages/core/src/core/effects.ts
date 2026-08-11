/**
 * Effects - Fire-and-forget side effects
 *
 * Features:
 * - Separate from requirement resolution
 * - Error isolation (never breaks reconciliation)
 * - Optional explicit dependencies for optimization
 * - Runs after facts stabilize
 *
 * IMPORTANT: Auto-tracking limitations
 * ------------------------------------
 * When using auto-tracking (no explicit `deps`), only SYNCHRONOUS fact accesses
 * are tracked. If your effect reads facts after an `await`, those reads are NOT
 * tracked and won't trigger the effect on future changes.
 *
 * For async effects, always use explicit `deps`:
 * @example
 * ```typescript
 * effects: {
 *   // BAD: fetchData is async, facts.userId read after await won't be tracked
 *   badEffect: {
 *     run: async (facts) => {
 *       await someAsyncOp();
 *       console.log(facts.userId); // NOT tracked!
 *     },
 *   },
 *   // GOOD: explicit deps for async effects
 *   goodEffect: {
 *     deps: ["userId"],
 *     run: async (facts) => {
 *       await someAsyncOp();
 *       console.log(facts.userId); // Works because we declared the dep
 *     },
 *   },
 * }
 * ```
 */

import isDevelopment from "#is-development";
import { attributeError, freezeSpec } from "../utils/utils.js";
import { extractDeps, isPredicate, memoizePredicate } from "./predicate.js";
import { derivationDep, describeDep, withTracking } from "./tracking.js";
import type {
  EffectsDef,
  Facts,
  FactsStore,
  InferSchema,
  Schema,
} from "./types.js";

// ============================================================================
// Effects Manager
// ============================================================================

/**
 * Manager returned by {@link createEffectsManager} that runs fire-and-forget
 * side effects after facts stabilize.
 *
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface EffectsManager<_S extends Schema = Schema> {
  /**
   * Run all effects whose tracked dependencies overlap with `changedKeys`.
   *
   * @remarks
   * Effects with no recorded dependencies (first run or auto-tracked with no
   * reads) run on any change. After execution, a snapshot of current facts is
   * stored for the `prev` parameter on the next invocation.
   *
   * @param changedKeys - Fact keys that changed since the last run.
   */
  runEffects(changedKeys: Set<string>): Promise<void>;
  /**
   * Run every enabled effect unconditionally, regardless of dependencies.
   */
  runAll(): Promise<void>;
  /**
   * Disable an effect so it is skipped during subsequent runs.
   *
   * @param id - The effect definition ID.
   */
  disable(id: string): void;
  /**
   * Re-enable a previously disabled effect.
   *
   * @param id - The effect definition ID.
   */
  enable(id: string): void;
  /**
   * Check whether an effect is currently enabled.
   *
   * @param id - The effect definition ID.
   * @returns `true` if the effect has not been disabled.
   */
  isEnabled(id: string): boolean;
  /**
   * Invoke every stored cleanup function and mark the manager as stopped.
   *
   * @remarks
   * After this call, any cleanup functions returned by in-flight async effects
   * will be invoked immediately rather than stored.
   */
  cleanupAll(): void;
  /**
   * Register additional effect definitions at runtime (used for dynamic
   * module registration).
   *
   * @param newDefs - New effect definitions to merge into the manager.
   */
  registerDefinitions(newDefs: EffectsDef<Schema>): void;
  /**
   * Override an existing effect definition. Runs cleanup of the old effect first.
   *
   * @param id - The effect definition ID to override.
   * @param def - The new effect definition.
   * @throws If no effect with this ID exists.
   */
  assignDefinition(id: string, def: EffectsDef<Schema>[string]): void;
  /**
   * Remove an effect definition. Runs cleanup (try-catch) and removes from state.
   *
   * @param id - The effect definition ID to remove.
   */
  unregisterDefinition(id: string): void;
  /**
   * Execute an effect's `run()` function immediately.
   *
   * @param id - The effect definition ID.
   */
  callOne(id: string): Promise<void>;
}

/** Number of consecutive identical dep sets before skipping re-tracking */
const STABLE_THRESHOLD = 3;

/**
 * What a manager built without derivations hands to `run()`. Frozen and
 * shared — every such manager has the same nothing to offer.
 */
const EMPTY_DERIVED: Record<string, unknown> = Object.freeze(
  Object.create(null),
);

/** Internal effect state */
interface EffectState {
  id: string;
  enabled: boolean;
  hasExplicitDeps: boolean; // true = user-provided deps (fixed), false = auto-tracked (re-track every run)
  dependencies: Set<string> | null; // null = not yet tracked
  /**
   * Declared `deps` names that name nothing the system holds yet — neither a
   * fact key nor a derivation — kept so they can be asked again. Empty once
   * every name has resolved, which for a `deps` array written against declared
   * facts is from the first call; `null` for an effect with no explicit `deps`.
   * See {@link EffectState.hasExplicitDeps}.
   */
  unresolvedDeps: string[] | null;
  /** The raw `deps` array, for re-resolving {@link EffectState.unresolvedDeps}. */
  rawDeps: readonly string[] | null;
  cleanup: (() => void) | null; // cleanup function returned by last run()
  /** How many consecutive runs produced the same deps (auto-tracked only) */
  stableRunCount: number;
  /** Once true, skip withTracking() overhead until a tracked fact mutates */
  depsStable: boolean;
}

/**
 * Configuration options accepted by {@link createEffectsManager}.
 *
 * @internal
 */
export interface CreateEffectsOptions<S extends Schema> {
  /** Effect definitions keyed by ID. */
  definitions: EffectsDef<S>;
  /** Proxy-based facts object passed to effect `run()` functions. */
  facts: Facts<S>;
  /** Underlying fact store used for `batch()` coalescing of mutations. */
  store: FactsStore<S>;
  /**
   * The system's derived values, handed to `run()` as its third argument —
   * after `facts` and `prev`, which already occupy the first two.
   *
   * An effect that reads a derivation used to have to reach back through
   * `system.derive`, which is the single-module accessor: compose that module
   * into a `createSystem({ modules })` and the identical read resolves a
   * namespace instead of a value, silently. Passing it in removes the
   * reach-back entirely.
   *
   * Reads through it track, so a synchronous effect that consults a derivation
   * is woken when that derivation moves without naming it in `deps`. An async
   * effect still has to declare — its reads happen past an `await`, where
   * auto-tracking cannot see them, whichever door they came through.
   *
   * Supplied by the engine; a manager built without derivations gets an empty
   * object, which is what it has.
   */
  derived?: Record<string, unknown>;
  /**
   * Whether a name in an explicit `deps` array refers to a derivation.
   *
   * An auto-tracked derivation read is recorded under an internal namespace and
   * a hand-written one is not, so without this `deps: ["total"]` naming a
   * derivation records a name nothing ever invalidates and the effect never
   * re-runs — while the auto-tracked equivalent works, which is what makes it
   * look correct.
   *
   * Supplied by the engine, which is the only thing that knows the merged
   * module set. Defaults to "nothing is a derivation".
   */
  isDerivation?: (name: string) => boolean;
  /**
   * Whether a name in an explicit `deps` array refers to a declared fact.
   *
   * Only used to decide which names are worth asking about again. A name that
   * already means a fact is settled — {@link CreateEffectsOptions.isDerivation}
   * resolves a fact/derivation collision toward the fact, so a declared fact key
   * cannot later come to mean a derivation — and re-asking it every reconcile is
   * work with no reachable answer.
   *
   * Supplied by the engine alongside `isDerivation`, from the same merged module
   * set. Defaults to "nothing is a declared fact", which costs a re-ask per
   * reconcile and decides nothing differently.
   */
  isFactKey?: (name: string) => boolean;
  /** Called when an effect executes, with the fact keys that triggered it. */
  onRun?: (id: string, deps: string[]) => void;
  /** Called when an effect's `run()` or cleanup function throws. */
  onError?: (id: string, error: unknown) => void;
}

/**
 * Create a manager for fire-and-forget side effects that run after facts
 * stabilize.
 *
 * @remarks
 * Effects support two dependency modes:
 *
 * - **Auto-tracked** (no `deps`): Dependencies are re-tracked on every run
 *   via {@link withTracking}, so conditional fact reads are always captured.
 *   Only synchronous reads are tracked; reads after an `await` are invisible.
 *
 * - **Explicit `deps`**: A fixed array of fact keys declared on the definition.
 *   Preferred for async effects where auto-tracking cannot cross `await`
 *   boundaries.
 *
 * Each effect can return a cleanup function that runs before the next
 * execution or when {@link EffectsManager.cleanupAll | cleanupAll} is called.
 * Errors in effects are isolated via try-catch and never break the
 * reconciliation loop. Synchronous fact mutations inside effects are
 * coalesced with `store.batch()`.
 *
 * @param options - Configuration including effect definitions, facts proxy,
 *   store, and lifecycle callbacks.
 * @returns An {@link EffectsManager} for running, enabling/disabling, and
 *   cleaning up effects.
 *
 * @example
 * ```typescript
 * const effects = createEffectsManager({
 *   definitions: {
 *     logPhase: {
 *       run: (facts, prev) => {
 *         if (prev?.phase !== facts.phase) {
 *           console.log(`Phase changed to ${facts.phase}`);
 *         }
 *       },
 *     },
 *   },
 *   facts: factsProxy,
 *   store: factsStore,
 * });
 *
 * await effects.runEffects(new Set(["phase"]));
 * ```
 *
 * @internal
 */
export function createEffectsManager<S extends Schema>(
  options: CreateEffectsOptions<S>,
): EffectsManager<S> {
  const {
    definitions,
    facts,
    store,
    derived = EMPTY_DERIVED,
    isDerivation = () => false,
    isFactKey = () => false,
    onRun,
    onError,
  } = options;

  // Internal state for each effect
  const states = new Map<string, EffectState>();

  // Previous facts snapshot for comparison (plain object for bracket-style proxy access)
  let previousSnapshot: Record<string, unknown> | null = null;

  // Track whether cleanupAll has been called (system stopped/destroyed).
  // If an async effect resolves after stop, its cleanup is invoked immediately.
  let stopped = false;

  // Compiled predicate gate per effect (only effects with a data `on` field).
  const onGates = new Map<
    string,
    (facts: Record<string, unknown>, prev?: Record<string, unknown>) => boolean
  >();

  /**
   * Whether the system now holds something under this name, either way.
   *
   * A name that means a fact and a name that means a derivation are both
   * answered: the first keeps the bare key, the second takes the namespaced
   * form, and either way the question has been settled and does not need asking
   * again.
   */
  function isKnownName(name: string): boolean {
    return isDerivation(name) || isFactKey(name);
  }

  /**
   * A declared `deps` array, on the keyspace auto-tracking uses, plus the names
   * that the system does not yet hold anything under.
   *
   * `isDerivation` is a live lookup over the merged module set, so what a name
   * means is not fixed when the effect is registered — registering an effect
   * and then the derivation it names is an ordinary thing to do with the
   * piecemeal API, and the name means a derivation only after the second call.
   * Resolving once at registration made that order significant and silently so:
   * the effect kept the bare name, nothing ever announces a bare derivation
   * name, and the effect never ran again.
   *
   * A name the system already holds is not carried forward. That is the whole
   * of the second return value: it is the list of names still capable of
   * changing meaning, and for the ordinary `deps` array — every name a fact the
   * module declares — it is empty on the first call and stays that way.
   */
  function resolveDeps(raw: readonly string[]): {
    dependencies: Set<string>;
    unresolved: string[];
  } {
    const dependencies = new Set<string>();
    const unresolved: string[] = [];

    for (const name of raw) {
      if (isDerivation(name)) {
        dependencies.add(derivationDep(name));
      } else {
        dependencies.add(name);
        if (!isFactKey(name)) {
          unresolved.push(name);
        }
      }
    }

    return { dependencies, unresolved };
  }

  /**
   * Ask the unresolved names again, and rebuild if the system has since come to
   * hold one of them. A no-op once every name has resolved, and a handful of
   * property lookups until then.
   */
  function refreshDeps(state: EffectState): void {
    const pending = state.unresolvedDeps;
    if (state.rawDeps === null || pending === null || pending.length === 0) {
      return;
    }
    if (!pending.some(isKnownName)) {
      return;
    }

    const resolved = resolveDeps(state.rawDeps);
    state.dependencies = resolved.dependencies;
    state.unresolvedDeps = resolved.unresolved;
  }

  /** Initialize state for an effect */
  function initState(id: string): EffectState {
    const def = definitions[id];
    if (!def) {
      throw new Error(`[Directive] Unknown effect: ${id}`);
    }

    // Always clear any stale gate from a previous registration of this id
    // before re-installing. Without this, swapping a data-form `on` effect
    // for a function-form one would leave the old gate active in shouldRun().
    onGates.delete(id);

    let dependencies: Set<string> | null = null;
    let hasExplicitDeps = false;
    let unresolvedDeps: string[] | null = null;
    let rawDeps: readonly string[] | null = null;

    if (def.deps) {
      // Resolved against the module's derivation names, because auto-tracking
      // files a derivation read under a namespace and a hand-written name has
      // no way to know that. Without this, the documented escape hatch is dead
      // for exactly the dependency it is most often reached for.
      rawDeps = def.deps as string[];
      const resolved = resolveDeps(rawDeps);
      dependencies = resolved.dependencies;
      unresolvedDeps = resolved.unresolved;
      hasExplicitDeps = true;
    } else if (def.on !== undefined) {
      // Declarative trigger — deps are extracted statically from the
      // predicate; the predicate is the gate evaluated after the
      // dep-overlap pre-filter in shouldRun(). Not resolved against derivation
      // names the way `deps` is: the predicate is evaluated against the facts
      // snapshot, which carries no derivations, so every path it names is a
      // fact key by construction. A non-predicate value here
      // is a user error and must throw (matches the friendly throw used by
      // constraints/derivations) instead of silently no-op-ing.
      if (!isPredicate(def.on)) {
        throw new Error(
          `[Directive] effect on must be a FactPredicate spec; got ${typeof def.on}`,
        );
      }
      if (def.on === null || typeof def.on !== "object") {
        throw new Error(
          `[Directive] memoizePredicate: predicate must be a plain object or array; got ${typeof def.on}`,
        );
      }
      freezeSpec(def.on);
      dependencies = extractDeps(def.on);
      hasExplicitDeps = true;
      const memoized = memoizePredicate(def.on as object);
      // Attribute a Directive-prefixed throw (e.g. `$matches: string`) to the
      // owning effect so the stack trace points at user config.
      onGates.set(
        id,
        attributeError("effect", id, (facts, prev) => memoized(facts, prev)),
      );
    }

    const state: EffectState = {
      id,
      enabled: true,
      hasExplicitDeps,
      dependencies,
      unresolvedDeps,
      rawDeps,
      cleanup: null,
      stableRunCount: 0,
      depsStable: false,
    };

    states.set(id, state);
    return state;
  }

  /** Get or create state for an effect */
  function getState(id: string): EffectState {
    return states.get(id) ?? initState(id);
  }

  /** Create a plain-object snapshot of current facts.
   *  Effects receive `prev` through module-scoped proxies (system.ts) that use
   *  bracket-style property access, so the snapshot must be a plain object —
   *  NOT a FactsSnapshot (which only exposes .get()/.has()). */
  function createSnapshot(): Record<string, unknown> {
    return store.toObject();
  }

  /** Reset dep stability so the next run re-tracks via withTracking() */
  function resetStability(state: EffectState): void {
    state.depsStable = false;
    state.stableRunCount = 0;
  }

  /** Check whether any dependency overlaps with the changed keys */
  function hasOverlap(deps: Set<string>, changedKeys: Set<string>): boolean {
    for (const dep of deps) {
      if (changedKeys.has(dep)) {
        return true;
      }
    }

    return false;
  }

  /** Check if an effect should run based on changed keys */
  function shouldRun(id: string, changedKeys: Set<string>): boolean {
    const state = getState(id);
    if (!state.enabled) {
      return false;
    }

    // Declared names that the system did not hold at registration are re-asked
    // here rather than trusted from it — see `resolveDeps`. Names it did hold
    // are settled and this costs nothing.
    refreshDeps(state);

    // If effect has tracked deps (explicit or auto-tracked), check if any changed
    if (state.dependencies) {
      if (!hasOverlap(state.dependencies, changedKeys)) {
        return false;
      }

      // Reset dep stability when a tracked fact changes so the next run
      // re-tracks via withTracking() and can discover new conditional reads.
      if (state.depsStable) {
        resetStability(state);
      }

      // For effects with a declarative `on` predicate, also evaluate the
      // predicate after the dep-overlap pre-filter so we only run when the
      // condition currently holds. `$changed` reads `prev` via the previous
      // snapshot — on the first run `prev` is null, which the predicate
      // runtime treats as "value present is a change".
      const gate = onGates.get(id);
      if (gate) {
        const facts = createSnapshot();
        const prev = previousSnapshot ?? undefined;

        return gate(facts, prev);
      }

      return true;
    }

    // No deps yet (first run or auto-tracked with no reads) = run on any change
    return true;
  }

  /** Run cleanup for a single effect (safe — catches errors) */
  function runCleanup(state: EffectState): void {
    if (state.cleanup) {
      try {
        state.cleanup();
      } catch (error) {
        onError?.(state.id, error);
        console.error(
          `[Directive] Effect "${state.id}" cleanup threw an error:`,
          error,
        );
      }
      state.cleanup = null;
    }
  }

  /** Store a cleanup function if the effect returned one */
  function storeCleanup(state: EffectState, result: unknown): void {
    if (typeof result === "function") {
      if (stopped) {
        // System already stopped — invoke cleanup immediately so it's not lost
        try {
          (result as () => void)();
        } catch (error) {
          onError?.(state.id, error);
          console.error(
            `[Directive] Effect "${state.id}" cleanup threw an error:`,
            error,
          );
        }
      } else {
        state.cleanup = result as () => void;
      }
    }
  }

  /** Run the effect's `run()` inside a store.batch(), await if needed, and store cleanup */
  async function runBatchedEffect(
    state: EffectState,
    def: EffectsDef<S>[string],
  ): Promise<void> {
    let effectPromise: unknown;
    store.batch(() => {
      effectPromise = def.run(
        facts,
        previousSnapshot as InferSchema<S> | null,
        derived,
      );
    });
    if (effectPromise instanceof Promise) {
      const result = await effectPromise;
      storeCleanup(state, result);
    } else {
      storeCleanup(state, effectPromise);
    }
  }

  /** Check whether two dep sets are identical */
  function areDepsEqual(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size) {
      return false;
    }
    for (const dep of b) {
      if (!a.has(dep)) {
        return false;
      }
    }

    return true;
  }

  /** Check whether tracked deps match current deps and update stability counters */
  function updateDepStability(
    state: EffectState,
    trackedDeps: Set<string>,
  ): void {
    const same =
      state.dependencies && areDepsEqual(state.dependencies, trackedDeps);

    if (!same) {
      resetStability(state);

      return;
    }

    state.stableRunCount++;
    if (state.stableRunCount >= STABLE_THRESHOLD) {
      state.depsStable = true;
    }
  }

  /**
   * Effects already warned about reading facts past an `await`.
   *
   * Once per effect, not once per run: an effect that runs every reconcile
   * would otherwise turn one design note into a log.
   */
  const warnedAsync = new Set<string>();

  /**
   * Say so, once, when an async auto-tracked effect read nothing it could be
   * woken by.
   *
   * The tracking context is a synchronous stack: it is pushed, the body runs,
   * and it is popped the moment the body *returns* — which for an `async` body
   * is at its first `await`. Everything the continuation reads afterwards falls
   * outside it and is recorded as a dependency of nothing. An effect whose reads
   * are all past that boundary therefore ends up with an empty dependency set,
   * which this manager reads as "no dependencies known" and runs on *every*
   * reconcile. It looks like it works, because it does fire; what it has lost is
   * any relationship between when it fires and what it reads.
   *
   * **Why not warn on every async auto-tracked effect**, the way core warns on
   * every async constraint without `deps`. Because there is a correct shape —
   * hoist every read above the first `await` — and nothing distinguishes it from
   * the broken one at runtime, so a broad warning fires on correct code with no
   * way to say "I did that". This repo has such an effect. A warning that cannot
   * be satisfied gets muted, and a muted warning protects nothing. The empty
   * dependency set is the case that is unambiguous, and it is the one worth
   * interrupting someone for.
   *
   * Triggered on the return value rather than a declaration flag, because
   * effects have no `async: true` to key on — and the return value is the truth
   * where a flag is a claim.
   */
  function warnAsyncAutoTracked(id: string, deps: Set<string>): void {
    if (deps.size > 0 || warnedAsync.has(id)) {
      return;
    }
    warnedAsync.add(id);

    console.warn(
      `[Directive] Async effect "${id}" recorded no dependencies, so it runs on every reconcile. Auto-tracking cannot see across an \`await\` — the tracking context closes when the body returns its promise — and this effect read nothing before its first one. Add \`deps: ["key1", "key2"]\`, or move the reads above the first \`await\`.`,
    );
  }

  /** Run an auto-tracked effect, re-tracking dependencies each time */
  async function runAutoTrackedEffect(
    state: EffectState,
    def: EffectsDef<S>[string],
  ): Promise<void> {
    // Deps have been stable — skip withTracking() overhead
    if (state.depsStable && state.dependencies) {
      await runBatchedEffect(state, def);

      return;
    }

    // Re-track dependencies so conditional reads are picked up
    let effectPromise: unknown;
    const trackingResult = withTracking(() => {
      store.batch(() => {
        effectPromise = def.run(
          facts,
          previousSnapshot as InferSchema<S> | null,
          derived,
        );
      });
      return effectPromise;
    });
    const trackedDeps = trackingResult.deps;

    // If the effect is async, wait for it and capture cleanup
    let result = trackingResult.value;
    if (result instanceof Promise) {
      if (isDevelopment) {
        warnAsyncAutoTracked(state.id, trackedDeps);
      }
      result = await result;
    }
    storeCleanup(state, result);

    updateDepStability(state, trackedDeps);

    // Update tracked dependencies
    state.dependencies = trackedDeps.size > 0 ? trackedDeps : null;
  }

  /** Run a single effect */
  async function runEffect(id: string): Promise<void> {
    const state = getState(id);
    const def = definitions[id];

    if (!state.enabled || !def) return;

    // Run previous cleanup before re-running
    runCleanup(state);

    onRun?.(
      id,
      state.dependencies ? Array.from(state.dependencies, describeDep) : [],
    );

    try {
      if (!state.hasExplicitDeps) {
        await runAutoTrackedEffect(state, def);
      } else {
        await runBatchedEffect(state, def);
      }
    } catch (error) {
      // Effects are fire-and-forget - errors are reported but don't propagate
      onError?.(id, error);
      console.error(`[Directive] Effect "${id}" threw an error:`, error);
      // Reset dep stability — we don't know what the effect would have read
      if (!state.hasExplicitDeps) {
        resetStability(state);
      }
    }
  }

  // Initialize all effect states
  for (const id of Object.keys(definitions)) {
    initState(id);
  }

  const manager: EffectsManager<S> = {
    async runEffects(changedKeys: Set<string>): Promise<void> {
      const effectsToRun: string[] = [];

      for (const id of Object.keys(definitions)) {
        if (shouldRun(id, changedKeys)) {
          effectsToRun.push(id);
        }
      }

      // Run effects in parallel (they're independent)
      await Promise.all(effectsToRun.map(runEffect));

      // Update previous snapshot
      previousSnapshot = createSnapshot();
    },

    async runAll(): Promise<void> {
      const effectIds = Object.keys(definitions);
      await Promise.all(
        effectIds.map((id) => {
          const state = getState(id);
          if (state.enabled) {
            // Reset stability so runEffect re-tracks deps
            // (runAll bypasses shouldRun where the normal reset lives)
            resetStability(state);

            return runEffect(id);
          }
          return Promise.resolve();
        }),
      );

      // Update previous snapshot
      previousSnapshot = createSnapshot();
    },

    disable(id: string): void {
      const state = getState(id);
      state.enabled = false;
    },

    enable(id: string): void {
      const state = getState(id);
      state.enabled = true;
    },

    isEnabled(id: string): boolean {
      return getState(id).enabled;
    },

    cleanupAll(): void {
      stopped = true;
      for (const state of states.values()) {
        runCleanup(state);
      }
    },

    registerDefinitions(newDefs: EffectsDef<Schema>): void {
      for (const [key, def] of Object.entries(newDefs)) {
        (definitions as Record<string, unknown>)[key] = def;
        initState(key);
      }
    },

    assignDefinition(id: string, def: EffectsDef<Schema>[string]): void {
      if (!definitions[id]) {
        throw new Error(
          `[Directive] Cannot assign effect "${id}" — it does not exist. Use register() to create it.`,
        );
      }

      // Run cleanup of old effect before replacing
      const state = states.get(id);
      if (state) {
        runCleanup(state);
      }

      // Replace definition and re-init state
      (definitions as Record<string, unknown>)[id] = def;
      initState(id);
    },

    unregisterDefinition(id: string): void {
      if (!definitions[id]) {
        return;
      }

      // Run cleanup (try-catch inside runCleanup)
      const state = states.get(id);
      if (state) {
        runCleanup(state);
      }

      // Remove from all maps
      delete (definitions as Record<string, unknown>)[id];
      states.delete(id);
      onGates.delete(id);
    },

    async callOne(id: string): Promise<void> {
      const def = definitions[id];
      if (!def) {
        throw new Error(
          `[Directive] Cannot call effect "${id}" — it does not exist.`,
        );
      }

      const state = getState(id);
      if (!state.enabled) {
        return;
      }

      // Run cleanup of previous run
      runCleanup(state);

      onRun?.(
        id,
        state.dependencies ? Array.from(state.dependencies, describeDep) : [],
      );

      try {
        let effectPromise: unknown;
        store.batch(() => {
          effectPromise = def.run(
            facts,
            previousSnapshot as InferSchema<S> | null,
            derived,
          );
        });
        if (effectPromise instanceof Promise) {
          const result = await effectPromise;
          storeCleanup(state, result);
        } else {
          storeCleanup(state, effectPromise);
        }
      } catch (error) {
        onError?.(id, error);
        console.error(`[Directive] Effect "${id}" threw an error:`, error);
      }
    },
  };

  return manager;
}
