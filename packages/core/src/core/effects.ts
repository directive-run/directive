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

import { withTracking } from "./tracking.js";
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

/** Internal effect state */
interface EffectState {
  id: string;
  enabled: boolean;
  hasExplicitDeps: boolean; // true = user-provided deps (fixed), false = auto-tracked (re-track every run)
  dependencies: Set<string> | null; // null = not yet tracked
  cleanup: (() => void) | null; // cleanup function returned by last run()
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
  const { definitions, facts, store, onRun, onError } = options;

  // Internal state for each effect
  const states = new Map<string, EffectState>();

  // Previous facts snapshot for comparison (plain object for bracket-style proxy access)
  let previousSnapshot: Record<string, unknown> | null = null;

  // Track whether cleanupAll has been called (system stopped/destroyed).
  // If an async effect resolves after stop, its cleanup is invoked immediately.
  let stopped = false;

  /** Initialize state for an effect */
  function initState(id: string): EffectState {
    const def = definitions[id];
    if (!def) {
      throw new Error(`[Directive] Unknown effect: ${id}`);
    }

    const state: EffectState = {
      id,
      enabled: true,
      hasExplicitDeps: !!def.deps,
      dependencies: def.deps ? new Set(def.deps as string[]) : null,
      cleanup: null,
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

  /** Check if an effect should run based on changed keys */
  function shouldRun(id: string, changedKeys: Set<string>): boolean {
    const state = getState(id);
    if (!state.enabled) return false;

    // If effect has tracked deps (explicit or auto-tracked), check if any changed
    if (state.dependencies) {
      for (const dep of state.dependencies) {
        if (changedKeys.has(dep)) return true;
      }
      return false;
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

  /** Run a single effect */
  async function runEffect(id: string): Promise<void> {
    const state = getState(id);
    const def = definitions[id];

    if (!state.enabled || !def) return;

    // Run previous cleanup before re-running
    runCleanup(state);

    onRun?.(id, state.dependencies ? [...state.dependencies] : []);

    try {
      if (!state.hasExplicitDeps) {
        // Auto-tracked: re-track dependencies on EVERY run so conditional
        // reads are picked up (fixes frozen deps after first run)
        let trackedDeps: Set<string> | null = null;
        let effectPromise: unknown;
        const trackingResult = withTracking(() => {
          store.batch(() => {
            effectPromise = def.run(
              facts,
              previousSnapshot as InferSchema<S> | null,
            );
          });
          return effectPromise;
        });
        trackedDeps = trackingResult.deps;

        // If the effect is async, wait for it and capture cleanup
        let result = trackingResult.value;
        if (result instanceof Promise) {
          result = await result;
        }
        storeCleanup(state, result);

        // Update tracked dependencies (always replace to catch new conditional reads)
        state.dependencies = trackedDeps.size > 0 ? trackedDeps : null;
      } else {
        // Has explicit deps, batch synchronous mutations and run
        let effectPromise: unknown;
        store.batch(() => {
          effectPromise = def.run(
            facts,
            previousSnapshot as InferSchema<S> | null,
          );
        });
        if (effectPromise instanceof Promise) {
          const result = await effectPromise;
          storeCleanup(state, result);
        } else {
          storeCleanup(state, effectPromise);
        }
      }
    } catch (error) {
      // Effects are fire-and-forget - errors are reported but don't propagate
      onError?.(id, error);
      console.error(`[Directive] Effect "${id}" threw an error:`, error);
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

    registerDefinitions(newDefs: EffectsDef<S>): void {
      for (const [key, def] of Object.entries(newDefs)) {
        (definitions as Record<string, unknown>)[key] = def;
        initState(key);
      }
    },

    assignDefinition(id: string, def: EffectsDef<S>[string]): void {
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

      onRun?.(id, state.dependencies ? [...state.dependencies] : []);

      try {
        let effectPromise: unknown;
        store.batch(() => {
          effectPromise = def.run(
            facts,
            previousSnapshot as InferSchema<S> | null,
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
