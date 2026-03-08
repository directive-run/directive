/**
 * Derivations - Auto-tracked computed values with composition
 *
 * Features:
 * - Automatic dependency tracking (no manual deps arrays)
 * - Memoization with smart invalidation
 * - Derivation composition (derivations can depend on other derivations)
 * - Circular dependency detection
 * - Lazy evaluation
 */

import { BLOCKED_PROPS, trackAccess, withTracking } from "./tracking.js";
import type {
  DerivationState,
  DerivationsDef,
  DerivedValues,
  Facts,
  FactsStore,
  Schema,
} from "./types.js";

// ============================================================================
// Derivations Manager
// ============================================================================

export interface DerivationsManager<
  S extends Schema,
  D extends DerivationsDef<S>,
> {
  /** Get a derived value (computes if stale) */
  get<K extends keyof D>(id: K): ReturnType<D[K]>;
  /** Check if a derivation is stale */
  isStale(id: keyof D): boolean;
  /** Invalidate derivations that depend on a fact key */
  invalidate(factKey: string): void;
  /** Invalidate derivations for multiple fact keys, notifying listeners once at the end */
  invalidateMany(factKeys: Iterable<string>): void;
  /** Invalidate all derivations */
  invalidateAll(): void;
  /** Subscribe to derivation changes */
  subscribe(ids: Array<keyof D>, listener: () => void): () => void;
  /** Get the proxy for composition */
  getProxy(): DerivedValues<S, D>;
  /** Get dependencies for a derivation */
  getDependencies(id: keyof D): Set<string>;
  /** Register new derivation definitions (for dynamic module registration) */
  registerDefinitions(newDefs: DerivationsDef<S>): void;
  /** Override an existing derivation function */
  assignDefinition(id: string, fn: DerivationsDef<S>[keyof DerivationsDef<S>]): void;
  /** Remove a derivation and clean up its state */
  unregisterDefinition(id: string): void;
  /** Compute a derivation immediately (ignores cache) */
  callOne(id: string): unknown;
}

/** Options for creating a derivations manager */
export interface CreateDerivationsOptions<
  S extends Schema,
  D extends DerivationsDef<S>,
> {
  definitions: D;
  facts: Facts<S>;
  store: FactsStore<S>;
  /** Callback when a derivation is computed */
  onCompute?: (
    id: string,
    value: unknown,
    oldValue: unknown,
    deps: string[],
  ) => void;
  /** Callback when a derivation is invalidated */
  onInvalidate?: (id: string) => void;
  /** Callback when a derivation errors */
  onError?: (id: string, error: unknown) => void;
}

/**
 * Create a manager for lazily-evaluated, auto-tracked derived values.
 *
 * Derivations are memoized computations that automatically track which facts
 * they read. When a tracked fact changes, the derivation is invalidated and
 * recomputed on next access. Derivations can depend on other derivations
 * (composition), and circular dependencies are detected at compute time.
 *
 * Notifications are deferred during invalidation so listeners always see
 * consistent state across multiple simultaneous fact changes.
 *
 * @param options - Derivation definitions, facts proxy, store, and optional lifecycle callbacks
 * @returns A `DerivationsManager` with get/invalidate/subscribe/getProxy methods
 */
export function createDerivationsManager<
  S extends Schema,
  D extends DerivationsDef<S>,
>(options: CreateDerivationsOptions<S, D>): DerivationsManager<S, D> {
  const {
    definitions,
    facts,
    store: _store,
    onCompute,
    onInvalidate,
    onError,
  } = options;
  // Note: _store is kept for API compatibility but invalidation is handled by the engine calling invalidate()

  // Internal state for each derivation
  const states = new Map<string, DerivationState<unknown>>();
  const listeners = new Map<string, Set<() => void>>();

  // Track which derivations depend on which fact keys
  const factToDerivedDeps = new Map<string, Set<string>>();
  // Track which derivations depend on which other derivations
  const derivedToDerivedDeps = new Map<string, Set<string>>();

  // Deferred notification: during invalidation, collect IDs to notify.
  // Listeners fire AFTER all invalidations complete so they see consistent state.
  let invalidationDepth = 0;
  const pendingNotifications = new Set<string>();
  let isFlushing = false;
  const MAX_FLUSH_ITERATIONS = 100;

  // The proxy for composition (derivations accessing other derivations)
  let derivedProxy: DerivedValues<S, D>;

  /** Initialize state for a derivation */
  function initState(id: string): DerivationState<unknown> {
    const def = definitions[id as keyof D];
    if (!def) {
      throw new Error(`[Directive] Unknown derivation: ${id}`);
    }

    const state: DerivationState<unknown> = {
      id,
      compute: () => computeDerivation(id),
      cachedValue: undefined,
      dependencies: new Set(),
      isStale: true,
      isComputing: false,
    };

    states.set(id, state);
    return state;
  }

  /** Get or create state for a derivation */
  function getState(id: string): DerivationState<unknown> {
    return states.get(id) ?? initState(id);
  }

  /** Compute a derivation and track its dependencies */
  function computeDerivation(id: string): unknown {
    const state = getState(id);
    const def = definitions[id as keyof D];

    if (!def) {
      throw new Error(`[Directive] Unknown derivation: ${id}`);
    }

    // Circular dependency detection
    if (state.isComputing) {
      throw new Error(
        `[Directive] Circular dependency detected in derivation: ${id}`,
      );
    }

    state.isComputing = true;

    try {
      // Capture old value before recomputation
      const oldValue = state.cachedValue;

      // Compute with tracking
      const { value, deps } = withTracking(() => def(facts, derivedProxy));

      // Update state
      state.cachedValue = value;
      state.isStale = false;

      // Update dependency tracking
      updateDependencies(id, deps);

      // Notify callback
      onCompute?.(id, value, oldValue, [...deps]);

      return value;
    } catch (error) {
      onError?.(id, error);
      throw error;
    } finally {
      state.isComputing = false;
    }
  }

  /** Update dependency tracking for a derivation */
  function updateDependencies(id: string, newDeps: Set<string>): void {
    const state = getState(id);
    const oldDeps = state.dependencies;

    // Short-circuit: skip full remove/add cycle when deps haven't changed
    if (oldDeps.size === newDeps.size) {
      let same = true;
      for (const dep of newDeps) {
        if (!oldDeps.has(dep)) {
          same = false;
          break;
        }
      }
      if (same) {
        return;
      }
    }

    // Remove old fact dependencies
    for (const dep of oldDeps) {
      // Check if it's a fact key or a derived key
      if (states.has(dep)) {
        const depSet = derivedToDerivedDeps.get(dep);
        depSet?.delete(id);
        // Clean up empty Sets to prevent memory leaks
        if (depSet && depSet.size === 0) {
          derivedToDerivedDeps.delete(dep);
        }
      } else {
        const depSet = factToDerivedDeps.get(dep);
        depSet?.delete(id);
        // Clean up empty Sets to prevent memory leaks
        if (depSet && depSet.size === 0) {
          factToDerivedDeps.delete(dep);
        }
      }
    }

    // Add new dependencies
    for (const dep of newDeps) {
      // Check if it's a derivation or a fact
      if (definitions[dep as keyof D]) {
        // It's a derivation-to-derivation dependency
        if (!derivedToDerivedDeps.has(dep)) {
          derivedToDerivedDeps.set(dep, new Set());
        }
        derivedToDerivedDeps.get(dep)!.add(id);
      } else {
        // It's a fact dependency
        if (!factToDerivedDeps.has(dep)) {
          factToDerivedDeps.set(dep, new Set());
        }
        factToDerivedDeps.get(dep)!.add(id);
      }
    }

    state.dependencies = newDeps;
  }

  /** Flush deferred notifications after all invalidations complete */
  function flushNotifications(): void {
    if (invalidationDepth > 0 || isFlushing) return;

    isFlushing = true;
    try {
      // Loop until no more pending — listeners may trigger new invalidations
      // that add to pendingNotifications via re-entrant invalidate() calls.
      let iterations = 0;
      while (pendingNotifications.size > 0) {
        if (++iterations > MAX_FLUSH_ITERATIONS) {
          const remaining = [...pendingNotifications];
          pendingNotifications.clear();
          throw new Error(
            `[Directive] Infinite derivation notification loop detected after ${MAX_FLUSH_ITERATIONS} iterations. ` +
              `Remaining: ${remaining.join(", ")}. ` +
              "This usually means a derivation listener is mutating facts that re-trigger the same derivation.",
          );
        }

        const ids = [...pendingNotifications];
        pendingNotifications.clear();

        for (const id of ids) {
          listeners.get(id)?.forEach((listener) => listener());
        }
      }
    } finally {
      isFlushing = false;
    }
  }

  /**
   * Invalidate a derivation and its transitive dependents using iterative
   * traversal (work queue) to avoid stack overflow on deep chains.
   *
   * Accepts an optional shared `visited` Set so that `invalidateMany` can
   * coalesce multiple root invalidations into a single traversal.
   */
  function invalidateDerivation(
    startId: string,
    visited = new Set<string>(),
  ): void {
    const queue = [startId];

    while (queue.length > 0) {
      const id = queue.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);

      const state = states.get(id);
      if (!state || state.isStale) continue;

      state.isStale = true;
      onInvalidate?.(id);

      // Defer listener notification until all invalidations complete.
      // This prevents listeners from observing partially-stale state and
      // avoids infinite loops from Set mutation during iteration (listeners
      // recompute derivations → updateDependencies → modify dep Sets).
      pendingNotifications.add(id);

      // Queue transitive dependents
      const dependents = derivedToDerivedDeps.get(id);
      if (dependents) {
        for (const dependent of dependents) {
          queue.push(dependent);
        }
      }
    }
  }

  // Create the proxy for composition
  derivedProxy = new Proxy({} as DerivedValues<S, D>, {
    get(_, prop: string | symbol) {
      if (typeof prop === "symbol") {
        return undefined;
      }
      if (BLOCKED_PROPS.has(prop)) {
        return undefined;
      }

      // Return undefined for unknown derivation keys instead of throwing.
      // React 19 dev-mode traverses objects accessing $$typeof, toJSON, then, etc.
      if (!definitions[prop as keyof D]) {
        return undefined;
      }

      // Track this derivation access so the consuming derivation
      // records a dependency on it (enables composition invalidation)
      trackAccess(prop);

      const state = getState(prop);

      // Recompute if stale
      if (state.isStale) {
        computeDerivation(prop);
      }

      return state.cachedValue;
    },

    set() {
      return false;
    },

    deleteProperty() {
      return false;
    },

    defineProperty() {
      return false;
    },

    getPrototypeOf() {
      return null;
    },

    setPrototypeOf() {
      return false;
    },
  });

  // Note: Fact change invalidation is handled by the engine calling invalidate()

  const manager: DerivationsManager<S, D> = {
    get<K extends keyof D>(id: K): ReturnType<D[K]> {
      const state = getState(id as string);

      if (state.isStale) {
        computeDerivation(id as string);
      }

      return state.cachedValue as ReturnType<D[K]>;
    },

    isStale(id: keyof D): boolean {
      const state = states.get(id as string);
      return state?.isStale ?? true;
    },

    invalidate(factKey: string): void {
      const dependents = factToDerivedDeps.get(factKey);
      if (!dependents) return;

      invalidationDepth++;
      const visited = new Set<string>();
      try {
        for (const id of dependents) {
          invalidateDerivation(id, visited);
        }
      } finally {
        invalidationDepth--;
        flushNotifications();
      }
    },

    invalidateMany(factKeys: Iterable<string>): void {
      invalidationDepth++;
      // Share a single visited Set across all root invalidations so
      // transitive dependents are only processed once.
      const visited = new Set<string>();
      try {
        for (const factKey of factKeys) {
          const dependents = factToDerivedDeps.get(factKey);
          if (!dependents) continue;
          for (const id of dependents) {
            invalidateDerivation(id, visited);
          }
        }
      } finally {
        invalidationDepth--;
        flushNotifications();
      }
    },

    invalidateAll(): void {
      invalidationDepth++;
      try {
        for (const state of states.values()) {
          if (!state.isStale) {
            state.isStale = true;
            pendingNotifications.add(state.id);
          }
        }
      } finally {
        invalidationDepth--;
        flushNotifications();
      }
    },

    subscribe(ids: Array<keyof D>, listener: () => void): () => void {
      for (const id of ids) {
        const idStr = id as string;
        if (!listeners.has(idStr)) {
          listeners.set(idStr, new Set());
        }
        listeners.get(idStr)!.add(listener);
      }

      return () => {
        for (const id of ids) {
          const idStr = id as string;
          const listenerSet = listeners.get(idStr);
          listenerSet?.delete(listener);
          // Clean up empty Sets to prevent memory leaks
          if (listenerSet && listenerSet.size === 0) {
            listeners.delete(idStr);
          }
        }
      };
    },

    getProxy(): DerivedValues<S, D> {
      return derivedProxy;
    },

    getDependencies(id: keyof D): Set<string> {
      return getState(id as string).dependencies;
    },

    registerDefinitions(newDefs: DerivationsDef<S>): void {
      for (const [key, fn] of Object.entries(newDefs)) {
        (definitions as Record<string, unknown>)[key] = fn;
        initState(key);
      }
    },

    assignDefinition(id: string, fn: DerivationsDef<S>[keyof DerivationsDef<S>]): void {
      if (!definitions[id as keyof D]) {
        throw new Error(
          `[Directive] Cannot assign derivation "${id}" — it does not exist. Use register() to create it.`,
        );
      }

      // Replace definition
      (definitions as Record<string, unknown>)[id] = fn;

      // Mark stale so it recomputes with the new function
      const state = states.get(id);
      if (state) {
        state.isStale = true;
        pendingNotifications.add(id);
      }

      flushNotifications();
    },

    unregisterDefinition(id: string): void {
      if (!definitions[id as keyof D]) {
        return;
      }

      // Clean up dependency maps
      const state = states.get(id);
      if (state) {
        for (const dep of state.dependencies) {
          if (states.has(dep)) {
            const depSet = derivedToDerivedDeps.get(dep);
            depSet?.delete(id);
            if (depSet && depSet.size === 0) {
              derivedToDerivedDeps.delete(dep);
            }
          } else {
            const depSet = factToDerivedDeps.get(dep);
            depSet?.delete(id);
            if (depSet && depSet.size === 0) {
              factToDerivedDeps.delete(dep);
            }
          }
        }
      }

      // Invalidate dependents (derivations that depend on this one)
      const dependents = derivedToDerivedDeps.get(id);
      if (dependents) {
        invalidationDepth++;
        try {
          for (const dependent of dependents) {
            invalidateDerivation(dependent);
          }
        } finally {
          invalidationDepth--;
        }
        derivedToDerivedDeps.delete(id);
      }

      // Remove from all maps
      delete (definitions as Record<string, unknown>)[id];
      states.delete(id);
      listeners.delete(id);
      pendingNotifications.delete(id);

      flushNotifications();
    },

    callOne(id: string): unknown {
      const def = definitions[id as keyof D];
      if (!def) {
        throw new Error(
          `[Directive] Cannot call derivation "${id}" — it does not exist.`,
        );
      }

      // Always recompute (call ignores cache)
      return computeDerivation(id);
    },
  };

  return manager;
}
