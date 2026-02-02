/**
 * Constraints - Rules that produce requirements when conditions aren't met
 *
 * Features:
 * - Sync and async constraint evaluation
 * - Priority ordering (higher runs first)
 * - Timeout handling for async constraints
 * - Error isolation
 */

import { createRequirementWithId, RequirementSet } from "./requirements.js";
import { withTracking } from "./tracking.js";
import type {
	ConstraintsDef,
	ConstraintState,
	Facts,
	Requirement,
	RequirementKeyFn,
	RequirementWithId,
	Schema,
} from "./types.js";
import { withTimeout } from "./utils.js";

// ============================================================================
// Constraints Manager
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface ConstraintsManager<_S extends Schema> {
	/** Evaluate all constraints and return unmet requirements */
	evaluate(changedKeys?: Set<string>): Promise<RequirementWithId[]>;
	/** Get the current state of a constraint */
	getState(id: string): ConstraintState | undefined;
	/** Get all constraint states */
	getAllStates(): ConstraintState[];
	/** Disable a constraint */
	disable(id: string): void;
	/** Enable a constraint */
	enable(id: string): void;
	/** Invalidate constraints that depend on the given fact key */
	invalidate(factKey: string): void;
}

/** Options for creating a constraints manager */
export interface CreateConstraintsOptions<S extends Schema> {
	definitions: ConstraintsDef<S>;
	facts: Facts<S>;
	/** Custom key functions for requirements (by constraint ID) */
	requirementKeys?: Record<string, RequirementKeyFn>;
	/** Default timeout for async constraints (ms) */
	defaultTimeout?: number;
	/** Callback when a constraint is evaluated */
	onEvaluate?: (id: string, active: boolean) => void;
	/** Callback when a constraint errors */
	onError?: (id: string, error: unknown) => void;
}

/** Default async constraint timeout (5 seconds) */
const DEFAULT_TIMEOUT = 5000;

/**
 * Create a constraints manager.
 */
export function createConstraintsManager<S extends Schema>(
	options: CreateConstraintsOptions<S>,
): ConstraintsManager<S> {
	const {
		definitions,
		facts,
		requirementKeys = {},
		defaultTimeout = DEFAULT_TIMEOUT,
		onEvaluate,
		onError,
	} = options;

	// Internal state for each constraint
	const states = new Map<string, ConstraintState>();
	const disabled = new Set<string>();

	// Track which constraints are async
	const asyncConstraintIds = new Set<string>();

	// Dependency tracking: which facts each constraint depends on
	const constraintDeps = new Map<string, Set<string>>();
	// Reverse mapping: which constraints depend on each fact
	const factToConstraints = new Map<string, Set<string>>();
	// Track which constraints need re-evaluation
	const dirtyConstraints = new Set<string>();
	// Track last requirement for each constraint (for incremental updates)
	const lastRequirements = new Map<string, RequirementWithId | null>();
	// First evaluation flag
	let hasEvaluated = false;

	/**
	 * Determine if a constraint is async.
	 * Uses the explicit `async` flag if provided, otherwise falls back to runtime detection.
	 * Runtime detection is only used on first evaluation and logs a dev warning.
	 */
	function isAsyncConstraint(id: string, def: ConstraintsDef<S>[string]): boolean {
		// Prefer explicit flag to avoid runtime detection side effects
		if (def.async !== undefined) {
			return def.async;
		}

		// Check if we've already detected this constraint as async
		if (asyncConstraintIds.has(id)) {
			return true;
		}

		// Runtime detection is deferred to first evaluation
		// We'll detect it in evaluateSync if it returns a Promise
		return false;
	}

	/** Initialize state for a constraint */
	function initState(id: string): ConstraintState {
		const def = definitions[id];
		if (!def) {
			throw new Error(`[Directive] Unknown constraint: ${id}`);
		}

		const isAsync = isAsyncConstraint(id, def);
		if (isAsync) {
			asyncConstraintIds.add(id);
		}

		const state: ConstraintState = {
			id,
			priority: def.priority ?? 0,
			isAsync,
			lastResult: null,
			isEvaluating: false,
			error: null,
		};

		states.set(id, state);
		return state;
	}

	/** Get or create state for a constraint */
	function getState(id: string): ConstraintState {
		return states.get(id) ?? initState(id);
	}

	/** Update dependency tracking for a constraint */
	function updateDependencies(id: string, newDeps: Set<string>): void {
		const oldDeps = constraintDeps.get(id) ?? new Set();

		// Remove old dependencies
		for (const dep of oldDeps) {
			const constraints = factToConstraints.get(dep);
			constraints?.delete(id);
			if (constraints && constraints.size === 0) {
				factToConstraints.delete(dep);
			}
		}

		// Add new dependencies
		for (const dep of newDeps) {
			if (!factToConstraints.has(dep)) {
				factToConstraints.set(dep, new Set());
			}
			factToConstraints.get(dep)!.add(id);
		}

		constraintDeps.set(id, newDeps);
	}

	/** Evaluate a single sync constraint */
	function evaluateSync(id: string): boolean | Promise<boolean> {
		const def = definitions[id];
		if (!def) return false;

		const state = getState(id);

		state.isEvaluating = true;
		state.error = null;

		try {
			// Track dependencies during evaluation
			const { value: result, deps } = withTracking(() => def.when(facts));

			// Update dependency tracking
			updateDependencies(id, deps);

			// Runtime async detection: if this was thought to be sync but returns a Promise
			if (result instanceof Promise) {
				// Mark as async for future evaluations
				asyncConstraintIds.add(id);
				state.isAsync = true;

				if (process.env.NODE_ENV !== "production") {
					console.warn(
						`[Directive] Constraint "${id}" returned a Promise but was not marked as async. ` +
							`Add \`async: true\` to the constraint definition to avoid this warning and improve performance.`,
					);
				}

				// Return the promise to be handled as async
				return result.then((asyncResult) => {
					state.lastResult = asyncResult;
					state.isEvaluating = false;
					onEvaluate?.(id, asyncResult);
					return asyncResult;
				}).catch((error) => {
					state.error = error instanceof Error ? error : new Error(String(error));
					state.lastResult = false;
					state.isEvaluating = false;
					onError?.(id, error);
					return false;
				});
			}

			state.lastResult = result;
			state.isEvaluating = false;
			onEvaluate?.(id, result);
			return result;
		} catch (error) {
			state.error = error instanceof Error ? error : new Error(String(error));
			state.lastResult = false;
			state.isEvaluating = false;
			onError?.(id, error);
			return false;
		}
	}

	/** Evaluate a single async constraint with timeout */
	async function evaluateAsync(id: string): Promise<boolean> {
		const def = definitions[id];
		if (!def) return false;

		const state = getState(id);
		const timeout = def.timeout ?? defaultTimeout;

		state.isEvaluating = true;
		state.error = null;

		try {
			const resultPromise = def.when(facts) as Promise<boolean>;

			// Race against timeout (with proper cleanup)
			const result = await withTimeout(
				resultPromise,
				timeout,
				`Constraint "${id}" timed out after ${timeout}ms`,
			);

			state.lastResult = result;
			state.isEvaluating = false;
			onEvaluate?.(id, result);
			return result;
		} catch (error) {
			state.error = error instanceof Error ? error : new Error(String(error));
			state.lastResult = false;
			state.isEvaluating = false;
			onError?.(id, error);
			return false;
		}
	}

	/** Get the requirement for a constraint, tracking dependencies if require is a function */
	function getRequirement(id: string): { requirement: Requirement | null; deps: Set<string> } {
		const def = definitions[id];
		if (!def) return { requirement: null, deps: new Set() };

		const requireDef = def.require;
		if (typeof requireDef === "function") {
			// Track dependencies when require is a function
			const { value: requirement, deps } = withTracking(() => requireDef(facts));
			return { requirement: requirement as Requirement, deps };
		}

		return { requirement: requireDef, deps: new Set() };
	}

	/** Merge additional dependencies into existing constraint deps */
	function mergeDependencies(id: string, additionalDeps: Set<string>): void {
		if (additionalDeps.size === 0) return;

		const existingDeps = constraintDeps.get(id) ?? new Set();
		for (const dep of additionalDeps) {
			existingDeps.add(dep);
			// Update reverse mapping
			if (!factToConstraints.has(dep)) {
				factToConstraints.set(dep, new Set());
			}
			factToConstraints.get(dep)!.add(id);
		}
		constraintDeps.set(id, existingDeps);
	}

	// Initialize all constraint states and cache sorted order
	let sortedConstraintIds: string[] | null = null;

	function getSortedConstraintIds(): string[] {
		if (!sortedConstraintIds) {
			sortedConstraintIds = Object.keys(definitions).sort((a, b) => {
				const stateA = getState(a);
				const stateB = getState(b);
				return stateB.priority - stateA.priority;
			});
		}
		return sortedConstraintIds;
	}

	for (const id of Object.keys(definitions)) {
		initState(id);
	}

	const manager: ConstraintsManager<S> = {
		async evaluate(changedKeys?: Set<string>): Promise<RequirementWithId[]> {
			const requirements = new RequirementSet();

			// Get all enabled constraints (use cached sort order)
			const allConstraintIds = getSortedConstraintIds().filter((id) => !disabled.has(id));

			// Determine which constraints to evaluate
			let constraintsToEvaluate: string[];

			if (!hasEvaluated || !changedKeys || changedKeys.size === 0) {
				// First evaluation or no specific changes: evaluate all
				constraintsToEvaluate = allConstraintIds;
				hasEvaluated = true;
			} else {
				// Incremental: only evaluate constraints affected by changed keys
				const affected = new Set<string>();
				for (const key of changedKeys) {
					const dependentConstraints = factToConstraints.get(key);
					if (dependentConstraints) {
						for (const id of dependentConstraints) {
							if (!disabled.has(id)) {
								affected.add(id);
							}
						}
					}
				}
				// Also include any dirty constraints
				for (const id of dirtyConstraints) {
					if (!disabled.has(id)) {
						affected.add(id);
					}
				}
				dirtyConstraints.clear();
				constraintsToEvaluate = [...affected];

				// For constraints NOT being re-evaluated, add their last requirements
				for (const id of allConstraintIds) {
					if (!affected.has(id)) {
						const lastReq = lastRequirements.get(id);
						if (lastReq) {
							requirements.add(lastReq);
						}
					}
				}
			}

			// Separate sync and async constraints
			const syncConstraints: string[] = [];
			const asyncConstraints: string[] = [];

			for (const id of constraintsToEvaluate) {
				const state = getState(id);
				if (state.isAsync) {
					asyncConstraints.push(id);
				} else {
					syncConstraints.push(id);
				}
			}

			// Evaluate sync constraints first (they're fast)
			// Some may turn out to be async at runtime - collect those for async evaluation
			const unexpectedAsync: Array<{ id: string; promise: Promise<boolean> }> = [];

			for (const id of syncConstraints) {
				const result = evaluateSync(id);

				// Handle runtime-detected async constraints
				if (result instanceof Promise) {
					unexpectedAsync.push({ id, promise: result });
					continue;
				}

				if (result) {
					const { requirement, deps: requireDeps } = getRequirement(id);
					// Merge require() deps into constraint deps
					mergeDependencies(id, requireDeps);
					if (requirement) {
						const keyFn = requirementKeys[id];
						const reqWithId = createRequirementWithId(requirement, id, keyFn);
						requirements.add(reqWithId);
						lastRequirements.set(id, reqWithId);
					} else {
						lastRequirements.set(id, null);
					}
				} else {
					lastRequirements.set(id, null);
				}
			}

			// Handle any sync constraints that turned out to be async
			if (unexpectedAsync.length > 0) {
				const asyncResults = await Promise.all(
					unexpectedAsync.map(async ({ id, promise }) => ({
						id,
						active: await promise,
					})),
				);

				for (const { id, active } of asyncResults) {
					if (active) {
						const { requirement, deps: requireDeps } = getRequirement(id);
						mergeDependencies(id, requireDeps);
						if (requirement) {
							const keyFn = requirementKeys[id];
							const reqWithId = createRequirementWithId(requirement, id, keyFn);
							requirements.add(reqWithId);
							lastRequirements.set(id, reqWithId);
						} else {
							lastRequirements.set(id, null);
						}
					} else {
						lastRequirements.set(id, null);
					}
				}
			}

			// Evaluate async constraints in parallel
			if (asyncConstraints.length > 0) {
				const asyncResults = await Promise.all(
					asyncConstraints.map(async (id) => ({
						id,
						active: await evaluateAsync(id),
					})),
				);

				for (const { id, active } of asyncResults) {
					if (active) {
						const { requirement, deps: requireDeps } = getRequirement(id);
						mergeDependencies(id, requireDeps);
						if (requirement) {
							const keyFn = requirementKeys[id];
							const reqWithId = createRequirementWithId(requirement, id, keyFn);
							requirements.add(reqWithId);
							lastRequirements.set(id, reqWithId);
						} else {
							lastRequirements.set(id, null);
						}
					} else {
						lastRequirements.set(id, null);
					}
				}
			}

			return requirements.all();
		},

		getState(id: string): ConstraintState | undefined {
			return states.get(id);
		},

		getAllStates(): ConstraintState[] {
			return [...states.values()];
		},

		disable(id: string): void {
			disabled.add(id);
			// Invalidate cache when constraints change
			sortedConstraintIds = null;
			// Mark as dirty so it gets removed from requirements on next evaluate
			lastRequirements.delete(id);
		},

		enable(id: string): void {
			disabled.delete(id);
			// Invalidate cache when constraints change
			sortedConstraintIds = null;
			// Mark as dirty so it gets evaluated on next cycle
			dirtyConstraints.add(id);
		},

		invalidate(factKey: string): void {
			// Mark all constraints that depend on this fact as dirty
			const dependentConstraints = factToConstraints.get(factKey);
			if (dependentConstraints) {
				for (const id of dependentConstraints) {
					dirtyConstraints.add(id);
				}
			}
		},
	};

	return manager;
}
