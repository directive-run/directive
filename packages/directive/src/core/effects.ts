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
	FactsSnapshot,
	FactsStore,
	Schema,
} from "./types.js";

// ============================================================================
// Effects Manager
// ============================================================================

/**
 * Manager for fire-and-forget side effects.
 * Effects run after facts stabilize, support auto-tracked or explicit
 * dependencies, and return optional cleanup functions (like React's `useEffect`).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface EffectsManager<_S extends Schema = Schema> {
	/** Run all effects that should trigger based on changes */
	runEffects(changedKeys: Set<string>): Promise<void>;
	/** Run all effects unconditionally */
	runAll(): Promise<void>;
	/** Disable an effect */
	disable(id: string): void;
	/** Enable an effect */
	enable(id: string): void;
	/** Check if an effect is enabled */
	isEnabled(id: string): boolean;
	/** Run all stored cleanup functions (called on system stop/destroy) */
	cleanupAll(): void;
	/** Register new effect definitions (for dynamic module registration) */
	registerDefinitions(newDefs: EffectsDef<Schema>): void;
}

/** Internal effect state */
interface EffectState {
	id: string;
	enabled: boolean;
	hasExplicitDeps: boolean; // true = user-provided deps (fixed), false = auto-tracked (re-track every run)
	dependencies: Set<string> | null; // null = not yet tracked
	lastSnapshot: FactsSnapshot<Schema> | null;
	cleanup: (() => void) | null; // cleanup function returned by last run()
}

/**
 * Options for creating an effects manager.
 * Passed internally by the engine – most users define effects in `createModule()`.
 */
export interface CreateEffectsOptions<S extends Schema> {
	definitions: EffectsDef<S>;
	facts: Facts<S>;
	store: FactsStore<S>;
	/** Callback when an effect runs */
	onRun?: (id: string) => void;
	/** Callback when an effect errors */
	onError?: (id: string, error: unknown) => void;
}

/**
 * Create an effects manager that runs fire-and-forget side effects
 * after facts stabilize.
 *
 * Effects support auto-tracked dependencies (synchronous reads only) or
 * explicit `deps` arrays for async effects. Each effect can return a cleanup
 * function that runs before the next invocation or on system stop.
 *
 * @param options - Configuration including effect definitions, facts proxy, store, and callbacks.
 * @returns An `EffectsManager` with methods for running, enabling/disabling, and cleanup.
 *
 * @example
 * ```typescript
 * effects: {
 *   // Auto-tracked: re-runs when `facts.count` changes
 *   logCount: {
 *     run: (facts) => {
 *       console.log("Count:", facts.count);
 *       return () => console.log("Cleanup logCount");
 *     },
 *   },
 *   // Explicit deps: required for async effects
 *   syncToServer: {
 *     deps: ["user", "settings"],
 *     run: async (facts, prev) => {
 *       if (prev && facts.settings !== prev.settings) {
 *         await api.updateSettings(facts.user.id, facts.settings);
 *       }
 *     },
 *   },
 * }
 * ```
 */
export function createEffectsManager<S extends Schema>(
	options: CreateEffectsOptions<S>,
): EffectsManager<S> {
	const { definitions, facts, store, onRun, onError } = options;

	// Internal state for each effect
	const states = new Map<string, EffectState>();

	// Previous facts snapshot for comparison
	let previousSnapshot: FactsSnapshot<Schema> | null = null;

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
			lastSnapshot: null,
			cleanup: null,
		};

		states.set(id, state);
		return state;
	}

	/** Get or create state for an effect */
	function getState(id: string): EffectState {
		return states.get(id) ?? initState(id);
	}

	/** Create a snapshot of current facts */
	function createSnapshot(): FactsSnapshot<Schema> {
		return facts.$snapshot() as FactsSnapshot<Schema>;
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
				console.error(`[Directive] Effect "${state.id}" cleanup threw an error:`, error);
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
					console.error(`[Directive] Effect "${state.id}" cleanup threw an error:`, error);
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

		onRun?.(id);

		try {
			if (!state.hasExplicitDeps) {
				// Auto-tracked: re-track dependencies on EVERY run so conditional
				// reads are picked up (fixes frozen deps after first run)
				let trackedDeps: Set<string> | null = null;
				let effectPromise: unknown;
				const trackingResult = withTracking(() => {
					store.batch(() => {
						effectPromise = def.run(facts, previousSnapshot as FactsSnapshot<S> | null);
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
					effectPromise = def.run(facts, previousSnapshot as FactsSnapshot<S> | null);
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
	};

	return manager;
}
