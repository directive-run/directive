/**
 * Shared Adapter Utilities
 *
 * Common types and helper functions used across all framework adapters.
 * @internal
 */

import { withTracking } from "./core/tracking.js";
import type {
  HistoryAPI,
  HistoryState,
  SnapshotMeta,
  SystemInspection,
} from "./core/types.js";

// ============================================================================
// SystemLike — structural type satisfied by both System and SingleModuleSystem
// ============================================================================

/**
 * Minimal structural type for shared adapter helpers.
 * Both `System<any>` and `SingleModuleSystem<any>` satisfy this interface,
 * eliminating the need for `as unknown as System<any>` casts in adapters.
 * @internal
 */
export interface SystemLike {
  readonly isSettled: boolean;
  readonly history: HistoryAPI | null;
  readonly facts: {
    $store: {
      get(key: string): unknown;
      has(key: string): boolean;
      toObject(): Record<string, unknown>;
    };
  };
  readonly derive?: Record<string, unknown>;
  read(key: string): unknown;
  inspect(): SystemInspection;
}

// ============================================================================
// Requirements State
// ============================================================================

/**
 * Requirements state returned by useRequirements hooks.
 * Provides a focused view of just requirements without full inspection overhead.
 */
export interface RequirementsState {
  /** Array of unmet requirements waiting to be resolved */
  unmet: Array<{
    id: string;
    requirement: { type: string; [key: string]: unknown };
    fromConstraint: string;
  }>;
  /** Array of requirements currently being resolved */
  inflight: Array<{ id: string; resolverId: string; startedAt: number }>;
  /** Whether there are any unmet requirements */
  hasUnmet: boolean;
  /** Whether there are any inflight requirements */
  hasInflight: boolean;
  /** Whether the system is actively working (has unmet or inflight requirements) */
  isWorking: boolean;
}

// ============================================================================
// Inspect State (shared across all adapters)
// ============================================================================

/**
 * Consolidated inspection state returned by useInspect hooks.
 * Identical shape across React, Vue, Svelte, Solid, and Lit adapters.
 */
export interface InspectState {
  /** Whether the system has settled (no pending operations) */
  isSettled: boolean;
  /** Array of unmet requirements */
  unmet: RequirementsState["unmet"];
  /** Array of inflight requirements */
  inflight: RequirementsState["inflight"];
  /** Whether the system is actively working */
  isWorking: boolean;
  /** Whether there are any unmet requirements */
  hasUnmet: boolean;
  /** Whether there are any inflight requirements */
  hasInflight: boolean;
}

/**
 * Information about a single constraint.
 */
export interface ConstraintInfo {
  id: string;
  active: boolean;
  priority: number;
}

/**
 * Compute InspectState from a system instance.
 * Centralizes the logic currently duplicated across adapters.
 * @internal
 */
export function computeInspectState(system: SystemLike): InspectState {
  const inspection = system.inspect();
  return {
    isSettled: system.isSettled,
    unmet: inspection.unmet,
    inflight: inspection.inflight,
    isWorking: inspection.unmet.length > 0 || inspection.inflight.length > 0,
    hasUnmet: inspection.unmet.length > 0,
    hasInflight: inspection.inflight.length > 0,
  };
}

// ============================================================================
// Throttled Hook Options
// ============================================================================

/**
 * Options for throttled hooks.
 * Used by useInspectThrottled, useRequirementsThrottled, etc.
 */
export interface ThrottledHookOptions {
  /**
   * Minimum time between updates in milliseconds.
   * @default 100
   */
  throttleMs?: number;
}

// ============================================================================
// Throttle Utility
// ============================================================================

/**
 * Create a throttled version of a callback function.
 * Uses trailing-edge throttling: the callback will be called at most once per interval,
 * with the latest arguments from the most recent call.
 *
 * @param callback - The function to throttle
 * @param ms - The minimum time between calls in milliseconds
 * @returns A throttled version of the callback and a cleanup function
 * @internal
 */
export function createThrottle<T extends (...args: unknown[]) => void>(
  callback: T,
  ms: number,
): { throttled: T; cleanup: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;
  let lastCallTime = 0;

  const throttled = ((...args: Parameters<T>) => {
    const now = Date.now();
    const timeSinceLastCall = now - lastCallTime;

    if (timeSinceLastCall >= ms) {
      // Enough time has passed, call immediately
      lastCallTime = now;
      callback(...args);
    } else {
      // Schedule for later, keeping latest args
      lastArgs = args;
      if (!timeoutId) {
        timeoutId = setTimeout(() => {
          timeoutId = null;
          lastCallTime = Date.now();
          if (lastArgs) {
            callback(...lastArgs);
            lastArgs = null;
          }
        }, ms - timeSinceLastCall);
      }
    }
  }) as T;

  const cleanup = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    lastArgs = null;
  };

  return { throttled, cleanup };
}

// ============================================================================
// Shared Adapter Helpers
// ============================================================================

/**
 * Dev-mode assertion that the system parameter is non-null.
 * Tree-shaken in production builds.
 * @internal
 */
export function assertSystem(hookName: string, system: unknown): void {
  if (process.env.NODE_ENV !== "production" && system == null) {
    throw new Error(
      `[Directive] ${hookName}() requires a system instance as the first argument. Received ${system}.`,
    );
  }
}

/** Default equality function using Object.is */
export function defaultEquality<T>(a: T, b: T): boolean {
  return Object.is(a, b);
}

/**
 * Build a HistoryState object from a system's history instance.
 * Returns null when history is disabled.
 * @internal
 */
export function buildHistoryState(system: SystemLike): HistoryState | null {
  const debug = system.history;
  if (!debug) return null;

  // Build lightweight metadata array (no facts data)
  const snapshots: SnapshotMeta[] = debug.snapshots.map((s) => ({
    id: s.id,
    timestamp: s.timestamp,
    trigger: s.trigger,
  }));

  return {
    // Navigation state
    canGoBack: debug.currentIndex > 0,
    canGoForward: debug.currentIndex < debug.snapshots.length - 1,
    currentIndex: debug.currentIndex,
    totalSnapshots: debug.snapshots.length,

    // Snapshot access
    snapshots,
    getSnapshotFacts: (id: number): Record<string, unknown> | null => {
      const snap = debug.snapshots.find((s) => s.id === id);
      return snap ? snap.facts : null;
    },

    // Navigation
    goTo: (snapshotId: number) => debug.goTo(snapshotId),
    goBack: (steps?: number) => debug.goBack(steps),
    goForward: (steps?: number) => debug.goForward(steps),
    replay: () => debug.replay(),

    // Session persistence
    exportSession: () => debug.export(),
    importSession: (json: string) => debug.import(json),

    // Changesets
    beginChangeset: (label: string) => debug.beginChangeset(label),
    endChangeset: () => debug.endChangeset(),

    // Recording control
    isPaused: debug.isPaused,
    pause: () => debug.pause(),
    resume: () => debug.resume(),
  };
}

/**
 * Pick specific fact values from a system's store.
 * @internal
 */
export function pickFacts(
  system: SystemLike,
  keys: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    result[key] = system.facts.$store.get(key);
  }
  return result;
}

// ============================================================================
// Tracked Selector
// ============================================================================

/** Result of running a selector with tracking. @internal */
export interface TrackedSelectorResult<R> {
  value: R;
  factKeys: string[];
  deriveKeys: string[];
}

/**
 * Run a selector against a system with automatic dependency tracking.
 * Creates a Proxy that intercepts property access to distinguish between
 * fact reads (tracked via withTracking) and derivation reads (tracked manually).
 *
 * Used by useSelector in all framework adapters.
 * @internal
 */
export function runTrackedSelector<R>(
  system: SystemLike,
  deriveKeySet: Set<string>,
  selector: (state: Record<string, unknown>) => R,
): TrackedSelectorResult<R> {
  const accessedDeriveKeys: string[] = [];

  const stateProxy = new Proxy(
    {},
    {
      get(_, prop: string | symbol) {
        if (typeof prop !== "string") return undefined;
        if (deriveKeySet.has(prop)) {
          accessedDeriveKeys.push(prop);
          return system.read(prop);
        }
        return system.facts.$store.get(prop);
      },
      has(_, prop: string | symbol) {
        if (typeof prop !== "string") return false;
        return deriveKeySet.has(prop) || system.facts.$store.has(prop);
      },
      ownKeys() {
        const factKeys = Object.keys(system.facts.$store.toObject());
        const combined = new Set(factKeys);
        for (const k of deriveKeySet) combined.add(k);
        return [...combined];
      },
      getOwnPropertyDescriptor() {
        return { configurable: true, enumerable: true, writable: true };
      },
    },
  );

  const { value, deps } = withTracking(() =>
    selector(stateProxy as Record<string, unknown>),
  );
  return {
    value,
    factKeys: Array.from(deps) as string[],
    deriveKeys: accessedDeriveKeys,
  };
}

/**
 * Check if tracked dependency keys have changed.
 * @internal
 */
export function depsChanged(
  prevFacts: string[],
  newFacts: string[],
  prevDerived: string[],
  newDerived: string[],
): boolean {
  const factsChanged =
    newFacts.length !== prevFacts.length ||
    newFacts.some((k, i) => k !== prevFacts[i]);
  const derivedChanged =
    newDerived.length !== prevDerived.length ||
    newDerived.some((k, i) => k !== prevDerived[i]);
  return factsChanged || derivedChanged;
}

// ============================================================================
// Re-exports from core/types/adapter-utils and utils/utils
// ============================================================================

export {
  setBridgeFact,
  getBridgeFact,
  createCallbackPlugin,
  requirementGuard,
  requirementGuardMultiple,
} from "./core/types/adapter-utils.js";

export { shallowEqual } from "./utils/utils.js";
