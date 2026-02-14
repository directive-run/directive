/**
 * Dependency tracking context for auto-tracking derivations and effects.
 *
 * Uses a stack-based approach to handle nested derivation computations.
 * When a derivation accesses a fact, the tracking context records it.
 * This is the foundation of Directive's signals-style reactivity –
 * derivations automatically know which facts they depend on.
 *
 * @example
 * ```typescript
 * // Typically used internally by the derivation/effects managers.
 * // Direct usage is for advanced custom derivation authors:
 * const { value, deps } = withTracking(() => {
 *   return facts.count * 2; // `count` is automatically tracked
 * });
 * console.log(deps); // Set { "count" }
 *
 * // Read facts without creating dependencies
 * const snapshot = withoutTracking(() => {
 *   return facts.count; // NOT tracked
 * });
 * ```
 */

import type { TrackingContext } from "./types.js";

/** Stack of active tracking contexts */
const trackingStack: TrackingContext[] = [];

/** Create a new tracking context */
function createTrackingContext(): TrackingContext {
	const dependencies = new Set<string>();

	return {
		get isTracking() {
			return true;
		},
		track(key: string) {
			dependencies.add(key);
		},
		getDependencies() {
			return dependencies;
		},
	};
}

/** Null tracking context when not tracking */
const nullContext: TrackingContext = {
	isTracking: false,
	track() {},
	getDependencies() {
		return new Set();
	},
};

/**
 * Get the current tracking context from the stack.
 * Returns a null context (no-op tracking) if no tracking is active.
 *
 * @returns The active `TrackingContext`, or a null context that silently ignores `track()` calls.
 */
export function getCurrentTracker(): TrackingContext {
	return trackingStack[trackingStack.length - 1] ?? nullContext;
}

/**
 * Check if dependency tracking is currently active.
 *
 * @returns `true` if inside a `withTracking()` call.
 */
export function isTracking(): boolean {
	return trackingStack.length > 0;
}

/**
 * Run a function with dependency tracking enabled.
 * Any fact accesses inside `fn` are recorded as dependencies.
 * Supports nesting – each call gets its own tracking scope.
 *
 * @param fn - The function to execute with tracking.
 * @returns An object with `value` (the function's return value) and `deps` (the set of accessed fact keys).
 *
 * @example
 * ```typescript
 * const { value, deps } = withTracking(() => {
 *   return facts.firstName + " " + facts.lastName;
 * });
 * // value: "Jane Doe"
 * // deps: Set { "firstName", "lastName" }
 * ```
 */
export function withTracking<T>(fn: () => T): { value: T; deps: Set<string> } {
	const context = createTrackingContext();
	trackingStack.push(context);

	try {
		const value = fn();
		return { value, deps: context.getDependencies() };
	} finally {
		trackingStack.pop();
	}
}

/**
 * Run a function with tracking temporarily disabled.
 * Fact accesses inside `fn` will not be recorded as dependencies.
 * Useful for reading facts in a derivation without creating a dependency
 * (e.g., for logging or one-time initialization).
 *
 * @param fn - The function to execute without tracking.
 * @returns The function's return value.
 *
 * @example
 * ```typescript
 * derive: {
 *   summary: (facts) => {
 *     const count = facts.count; // tracked dependency
 *     const label = withoutTracking(() => facts.debugLabel); // NOT tracked
 *     return `${label}: ${count}`;
 *   },
 * }
 * ```
 */
export function withoutTracking<T>(fn: () => T): T {
	// Temporarily clear the stack
	const saved = trackingStack.splice(0, trackingStack.length);

	try {
		return fn();
	} finally {
		// Restore the stack
		trackingStack.push(...saved);
	}
}

/**
 * Manually record a fact key as a dependency in the current tracking context.
 * No-op if dependency tracking is not active.
 *
 * Primarily used by the facts proxy internally. Custom derivation authors
 * may call this directly when bypassing the proxy (e.g., reading from a Map).
 *
 * @param key - The fact key to record as a dependency.
 */
export function trackAccess(key: string): void {
	getCurrentTracker().track(key);
}
