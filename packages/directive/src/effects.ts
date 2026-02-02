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
}

/** Internal effect state */
interface EffectState {
	id: string;
	enabled: boolean;
	dependencies: Set<string> | null; // null = track dynamically
	lastSnapshot: FactsSnapshot<Schema> | null;
}

/** Options for creating an effects manager */
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
 * Create an effects manager.
 */
export function createEffectsManager<S extends Schema>(
	options: CreateEffectsOptions<S>,
): EffectsManager<S> {
	const { definitions, facts, onRun, onError } = options;

	// Internal state for each effect
	const states = new Map<string, EffectState>();

	// Previous facts snapshot for comparison
	let previousSnapshot: FactsSnapshot<Schema> | null = null;

	/** Initialize state for an effect */
	function initState(id: string): EffectState {
		const def = definitions[id];
		if (!def) {
			throw new Error(`[Directive] Unknown effect: ${id}`);
		}

		const state: EffectState = {
			id,
			enabled: true,
			dependencies: def.deps ? new Set(def.deps as string[]) : null,
			lastSnapshot: null,
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

		// If effect has explicit deps, check if any changed
		if (state.dependencies) {
			for (const dep of state.dependencies) {
				if (changedKeys.has(dep)) return true;
			}
			return false;
		}

		// No explicit deps = run on any change (first time only, then track)
		return true;
	}

	/** Run a single effect */
	async function runEffect(id: string): Promise<void> {
		const state = getState(id);
		const def = definitions[id];

		if (!state.enabled || !def) return;

		onRun?.(id);

		try {
			// If no explicit deps, track what facts are accessed during execution
			if (!state.dependencies) {
				// Track dependencies during actual run
				let trackedDeps: Set<string> | null = null;
				const trackingResult = withTracking(() => {
					// We need to handle the async case carefully
					// Run synchronous portion with tracking
					return def.run(facts, previousSnapshot as FactsSnapshot<S> | null);
				});
				trackedDeps = trackingResult.deps;

				// If the effect is async, wait for it
				const result = trackingResult.value;
				if (result instanceof Promise) {
					await result;
				}

				// Update tracked dependencies
				if (trackedDeps.size > 0) {
					state.dependencies = trackedDeps;
				}
			} else {
				// Has explicit deps, just run without tracking
				await def.run(facts, previousSnapshot as FactsSnapshot<S> | null);
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
	};

	return manager;
}
