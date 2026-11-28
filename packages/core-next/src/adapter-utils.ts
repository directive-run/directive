/**
 * `@directive-run/core/adapter-utils` (the L13 RFC's AU1 to AU8): the helpers
 * the framework adapters share, ported line for line from
 * packages/core/src/adapter-utils.ts and core/types/adapter-utils.ts.
 *
 * One difference in mechanism: 1.35 tracks a selector's reads with a
 * module-level tracker; core-next keeps one tracker per system, so
 * {@link runTrackedSelector} borrows the system's own through `scopes`
 * (api/plugins.ts), the first-party pairing persistence already reads. No
 * core seam, and nothing here reaches a `createSystem` build. Two
 * behaviours follow from it and differ from 1.35 (the fix round's notes): a
 * copy or wrapper of a system (`{ ...system }`, a Proxy) has no entry in
 * `scopes`, so its selector records no keys; and a selector that reads a
 * second system does not record that system's reads.
 * @internal
 */

import isDevelopment from "#is-development";
import { MEMBER_DEP_PREFIX, type Tracker } from "./api/facts.js";
import { scopes } from "./api/plugins.js";
import type { Graph } from "./graph.js";
import type { Facts } from "./types/facts.js";
import type { Plugin } from "./types/plugins.js";
import type { Requirement } from "./types/requirements.js";
import type { Schema } from "./types/schema.js";
import type {
  HistoryAPI,
  HistoryState,
  SnapshotMeta,
  SystemInspection,
} from "./types/system.js";

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
  if (isDevelopment && system == null) {
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
 * Run `selector` with `deps` as the tracker's frame, apart from whatever is
 * running around it, as 1.35's nested frame is.
 *
 * - The frame is the tracker's effect frame as well, so a membership test
 *   (`"double" in system.derive`) and a read of an unknown derivation take
 *   the core's effect rule: a membership key (the caller drops it) and no
 *   watcher, where its other rule records the derivation as read. 1.35
 *   records neither (derivations.ts `has`, and `get` on an unknown name).
 * - Inside a derivation's compute the graph would link that derivation to
 *   every fact the selector reads, so the selector runs outside the graph's
 *   active node (as `graph.untracked` does, without a closure per call).
 */
function framed<R>(
  tracker: Tracker,
  graph: Graph | undefined,
  deps: Set<string>,
  selector: (state: Record<string, unknown>) => R,
  state: Record<string, unknown>,
): R {
  const prevDeps = tracker.deps;
  const prevEffect = tracker.effect_;
  const prevActive = graph?.active;
  tracker.deps = tracker.effect_ = deps;
  if (graph) {
    graph.active = null;
  }
  try {
    return selector(state);
  } finally {
    tracker.deps = prevDeps;
    tracker.effect_ = prevEffect;
    if (graph) {
      graph.active = prevActive!;
    }
  }
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

  // 1.35's tracker is module-level; this system's is in its context. An
  // object no system made (a hand-built SystemLike) has none, and nothing it
  // reads could be recorded on either engine: a tracker of its own gives the
  // same empty list.
  const context = scopes.get(system);
  const tracker: Tracker = context?.tracker ?? {
    deps: null,
    effect_: undefined,
  };
  const deps = new Set<string>();
  const value = framed(
    tracker,
    context?.kernel.graph,
    deps,
    selector,
    stateProxy as Record<string, unknown>,
  );
  const factKeys: string[] = [];
  for (const key of deps) {
    if (key[0] !== MEMBER_DEP_PREFIX) {
      factKeys.push(key);
    }
  }

  return {
    value,
    factKeys,
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
// The bridge helpers (1.35 core/types/adapter-utils.ts) and shallowEqual
// ============================================================================

/**
 * Set a bridge fact without strict typing.
 * Use for adapter-internal bridge fields like `__adapterState`.
 */
export function setBridgeFact<V>(
  facts: Facts<Schema>,
  key: string,
  value: V,
): void {
  (facts as Record<string, unknown>)[key] = value;
}

/**
 * Get a bridge fact without strict typing.
 * Use for adapter-internal bridge fields.
 */
export function getBridgeFact<V>(facts: Facts<Schema>, key: string): V {
  return (facts as Record<string, unknown>)[key] as V;
}

// 1.35 declares this in core/types/adapter-utils.ts; this entry does not
// export it.
interface AdapterCallbacks {
  onRequirementCreated?: (req: Requirement) => void;
  onRequirementResolved?: (req: Requirement) => void;
  onError?: (error: Error) => void;
}

/**
 * Create a callback plugin for adapter events.
 * Wraps adapter callbacks in a Directive plugin.
 *
 * @param name - Plugin name (for debugging)
 * @param callbacks - Callback functions to invoke
 */
export function createCallbackPlugin(
  name: string,
  callbacks: AdapterCallbacks,
): Plugin<any> {
  return {
    name,
    onRequirementCreated: callbacks.onRequirementCreated
      ? (req) => callbacks.onRequirementCreated!(req.requirement)
      : undefined,
    onRequirementMet: callbacks.onRequirementResolved
      ? (req) => callbacks.onRequirementResolved!(req.requirement)
      : undefined,
    onError: callbacks.onError,
  };
}

/**
 * Create a type guard for a specific requirement type.
 * Simplifies the common pattern of checking req.type.
 */
export function requirementGuard<R extends Requirement>(
  type: R["type"],
): (req: Requirement) => req is R {
  return (req): req is R => req.type === type;
}

/** Create a type guard that matches multiple requirement types. */
export function requirementGuardMultiple<R extends Requirement>(
  types: R["type"][],
): (req: Requirement) => req is R {
  const typeSet = new Set(types);
  return (req): req is R => typeSet.has(req.type);
}

// The root's, which is built (the RFC's section C).
export { shallowEqual } from "./api/utils.js";

/**
 * Merge a DistributableSnapshot's data into initialFacts for SSR hydration.
 * Used by all framework adapters' hydration hooks/controllers.
 *
 * Accepts both shapes:
 * - DistributableSnapshot (`{ data: Record<string, unknown> }`) — used by React's DirectiveHydrator
 * - Plain `Record<string, unknown>` — used by Lit/Vue/Svelte/Solid adapters
 */
export function mergeHydrationFacts(
  snapshot:
    | { data?: Record<string, unknown> }
    | Record<string, unknown>
    | undefined
    | null,
  initialFacts?: Record<string, unknown>,
): Record<string, unknown> {
  if (!snapshot) {
    return { ...initialFacts };
  }

  // If snapshot has a .data property that is a non-null object, treat as DistributableSnapshot
  const data =
    "data" in snapshot &&
    typeof snapshot.data === "object" &&
    snapshot.data !== null
      ? (snapshot.data as Record<string, unknown>)
      : (snapshot as Record<string, unknown>);

  return { ...initialFacts, ...data };
}
