/**
 * Dependency tracking context for auto-tracking derivations
 *
 * Uses a stack-based approach to handle nested derivation computations.
 * When a derivation accesses a fact, the tracking context records it.
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
 * Get the current tracking context.
 *
 * @returns The active {@link TrackingContext}, or a null context (no-op) if
 *   no tracking is active.
 *
 * @internal
 */
export function getCurrentTracker(): TrackingContext {
  return trackingStack[trackingStack.length - 1] ?? nullContext;
}

/**
 * Check if dependency tracking is currently active.
 *
 * @returns `true` if inside a {@link withTracking} call, `false` otherwise.
 *
 * @internal
 */
export function isTracking(): boolean {
  return trackingStack.length > 0;
}

/**
 * Run a function with dependency tracking.
 *
 * @remarks
 * Pushes a fresh tracking context onto the stack, executes `fn`, then pops
 * the context. Any fact reads inside `fn` are recorded as dependencies.
 * Nesting is supported — inner calls get their own independent context.
 *
 * @param fn - The function to execute under tracking.
 * @returns An object with the computed `value` and a `deps` Set of accessed
 *   fact keys.
 *
 * @internal
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
 * Run a function without tracking.
 *
 * @remarks
 * Temporarily clears the tracking stack so that fact reads inside `fn` do
 * not register as dependencies. The stack is restored after `fn` returns
 * (even on error). Useful for side-effect reads that should not trigger
 * derivation invalidation.
 *
 * @param fn - The function to execute without tracking.
 * @returns The return value of `fn`.
 *
 * @internal
 */
export function withoutTracking<T>(fn: () => T): T {
  // Temporarily clear the stack
  const saved = trackingStack.splice(0, trackingStack.length);

  try {
    return fn();
  } finally {
    // Restore the stack (loop avoids spread overflow with deep stacks)
    for (const ctx of saved) {
      trackingStack.push(ctx);
    }
  }
}

/**
 * Track a specific key in the current context.
 *
 * @remarks
 * No-op if no tracking context is active.
 *
 * @param key - The fact key to record as a dependency.
 *
 * @internal
 */
export function trackAccess(key: string): void {
  getCurrentTracker().track(key);
}

/**
 * Prototype pollution guard — shared across all proxy handlers.
 *
 * @remarks
 * Contains `__proto__`, `constructor`, and `prototype`. Every proxy `get`
 * and `has` trap checks this set and returns `undefined` / `false` for
 * matching keys, preventing prototype pollution via proxy-based objects.
 *
 * @internal
 */
export const BLOCKED_PROPS: ReadonlySet<string> = Object.freeze(
  new Set(["__proto__", "constructor", "prototype"]),
);
