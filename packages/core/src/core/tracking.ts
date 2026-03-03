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
 * Returns null context if no tracking is active.
 */
export function getCurrentTracker(): TrackingContext {
  return trackingStack[trackingStack.length - 1] ?? nullContext;
}

/**
 * Check if we're currently tracking dependencies.
 */
export function isTracking(): boolean {
  return trackingStack.length > 0;
}

/**
 * Run a function with dependency tracking.
 * Returns the computed value and the set of dependencies accessed.
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
 * Useful for reading facts without creating dependencies.
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
 * Track a specific key in the current context.
 * No-op if not currently tracking.
 */
export function trackAccess(key: string): void {
  getCurrentTracker().track(key);
}
