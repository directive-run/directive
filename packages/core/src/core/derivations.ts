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

import { attributeError, freezeSpec } from "../utils/utils.js";
import { evaluateTemplate, isTemplate, memoizePredicate } from "./predicate.js";
import {
  BLOCKED_PROPS,
  derivationDep,
  derivationDepId,
  describeDep,
  isDerivationDep,
  isTracking,
  trackAccess,
  withTracking,
} from "./tracking.js";
import type {
  DefinitionMeta,
  DerivationState,
  DerivationsDef,
  DerivedValues,
  Facts,
  Schema,
} from "./types.js";
import { freezeMeta } from "./types/meta.js";

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
  /**
   * Get what a derivation last read, as names a human reads.
   *
   * Fact keys keep their key; a dependency on another derivation reads
   * `derive.total`. Internally the two live in one string keyspace separated by
   * a namespace prefix, and this is the only place that encoding is unwrapped —
   * an introspection accessor should not hand back a private separator.
   *
   * A fresh Set each call. Nothing on a hot path reads this.
   */
  getDependencies(id: keyof D): Set<string>;
  /**
   * Record that something outside the derivation graph watches this derivation.
   *
   * A derivation read from inside a tracking context marks itself; a derivation
   * named in a hand-written `deps` array cannot, because nothing reads it, so
   * the engine says so on its behalf. Monotone — a name is never unmarked while
   * the derivation exists, because a dependency set that stopped naming it may
   * name it again on the next run and the cost of assuming it still watches is
   * one entry in a Set.
   */
  markObserved(id: string): void;
  /**
   * Drain the derivations that may have moved since the last drain into `out`,
   * under {@link derivationDep} names.
   *
   * See {@link CreateDerivationsOptions.onInvalidate} for why this is separate
   * from the announcement, and what it costs.
   */
  collectInvalidated(out: Set<string>): void;
  /** Register new derivation definitions (for dynamic module registration) */
  registerDefinitions(newDefs: DerivationsDef<S>): void;
  /** Override an existing derivation function */
  assignDefinition(
    id: string,
    fn: DerivationsDef<S>[keyof DerivationsDef<S>],
  ): void;
  /** Remove a derivation and clean up its state */
  unregisterDefinition(id: string): void;
  /** Compute a derivation immediately (ignores cache) */
  callOne(id: string): unknown;
  /** Get metadata for a derivation (if provided via object form) */
  getMeta(id: string): DefinitionMeta | undefined;
}

/** Options for creating a derivations manager */
export interface CreateDerivationsOptions<
  S extends Schema,
  D extends DerivationsDef<S>,
> {
  definitions: D;
  facts: Facts<S>;
  /** Callback when a derivation is computed */
  onCompute?: (
    id: string,
    value: unknown,
    oldValue: unknown,
    deps: string[],
  ) => void;
  /**
   * Callback when a derivation transitions from valid to stale.
   *
   * Edge-triggered, and deliberately so: it reports a state *change*, which is
   * what a log line and a devtools timeline entry are for. A derivation that is
   * already stale has not changed state, and repeating the announcement on
   * every fact write turns a 200-derivation graph into two thousand log lines
   * per ten writes and evicts everything else from a devtools ring buffer.
   *
   * Anything that needs to know a derivation *may have moved* — which is a
   * different question, and one whose answer repeats while the derivation stays
   * stale — reads {@link DerivationsManager.collectInvalidated} instead.
   */
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
 * @param options - Derivation definitions, facts proxy, store, and optional
 *   lifecycle callbacks.
 * @returns A {@link DerivationsManager} for accessing, invalidating, and
 *   subscribing to derived values.
 *
 * @internal
 */
export function createDerivationsManager<
  S extends Schema,
  D extends DerivationsDef<S>,
>(options: CreateDerivationsOptions<S, D>): DerivationsManager<S, D> {
  const { definitions, facts, onCompute, onInvalidate, onError } = options;

  /** Consecutive identical dep sets before skipping withTracking() */
  const STABLE_THRESHOLD = 3;

  // Meta storage for derivations using object form { compute, meta }
  const derivationMeta = new Map<string, DefinitionMeta>();

  /**
   * Resolve any object-form derivation into a bare function. Accepts:
   *   - `(facts, derived) => T`                 (function form)
   *   - `{ compute: fn, meta }`                 (function with meta)
   *   - `{ compute: FactPredicate, meta }`      (boolean data form)
   *   - `{ compute: FactTemplate,  meta }`      (string data form)
   * Mutates `definitions[key]` to a bare function and stores any meta.
   */
  function unwrapDerivationAt(key: string, raw: unknown): void {
    if (
      typeof raw !== "object" ||
      raw === null ||
      !Object.hasOwn(raw, "compute")
    ) {
      return;
    }
    const obj = raw as { compute: unknown; meta?: DefinitionMeta };
    const c = obj.compute;
    let fn: ((facts: unknown, derived: unknown) => unknown) | undefined;

    if (typeof c === "function") {
      fn = c as (facts: unknown, derived: unknown) => unknown;
    } else if (isTemplate(c)) {
      freezeSpec(c);
      fn = (facts) => evaluateTemplate(c, facts as Record<string, unknown>);
    } else if (typeof c === "object" && c !== null) {
      // Defensive: memoizePredicate also throws on non-object predicates, but a
      // guard here keeps the failure adjacent to the registration site.
      freezeSpec(c);
      const memoized = memoizePredicate(c);
      // Attribute a Directive-prefixed throw (e.g. `$matches: string`) to the
      // owning derivation so the stack trace points at user config.
      fn = attributeError("derivation", key, (facts) =>
        memoized(facts as Record<string, unknown>),
      );
    } else if (c !== undefined) {
      throw new Error(
        `[Directive] memoizePredicate: predicate must be a plain object or array; got ${typeof c}`,
      );
    }

    if (fn) {
      (definitions as Record<string, unknown>)[key] = fn;
      const frozen = freezeMeta(obj.meta);
      if (frozen) {
        derivationMeta.set(key, frozen);
      }
    }
  }

  // Unwrap any object-form definitions at construction time.
  // After this, definitions[id] is always a bare function.
  for (const [key, raw] of Object.entries(definitions)) {
    unwrapDerivationAt(key, raw);
  }

  // Internal state for each derivation
  const states = new Map<string, DerivationState<unknown>>();
  const listeners = new Map<string, Set<() => void>>();

  // Track which derivations depend on which fact keys
  const factToDerivedDeps = new Map<string, Set<string>>();
  // Track which derivations depend on which other derivations
  const derivedToDerivedDeps = new Map<string, Set<string>>();

  /**
   * Derivations something outside the graph watches — see
   * {@link DerivationsManager.markObserved}.
   *
   * Empty is the common case and the cheap one: with nothing watching, an
   * invalidation has no audience outside the graph and {@link collectInvalidated}
   * does no work at all.
   */
  const observedIds = new Set<string>();

  /**
   * How many derivation bodies are on the stack.
   *
   * The composition proxy is handed to derivation bodies *and*, since
   * constraints and effects gained their `derived` parameter, to those too — so
   * a read through it no longer implies the reader is inside the graph. This
   * tells the two apart: at depth zero the reader is a constraint or an effect,
   * which is an outside watcher and has to be recorded as one; deeper, it is
   * one derivation composing another, which the `derivedToDerivedDeps` graph
   * already invalidates without help.
   *
   * Counted rather than flagged because a derivation body may compute another
   * derivation while running, and the inner one finishing does not put the
   * reader back outside.
   */
  let computingDepth = 0;

  /**
   * Derivations whose own dependency changed since the last drain.
   *
   * The roots of the "may have moved" question, recorded rather than answered:
   * the answer is their transitive closure, and walking that costs the whole
   * downstream graph, so it is walked once per drain instead of once per fact
   * write — and only when something is watching. A Set of derivation IDs, so a
   * write storm between two drains cannot make it larger than the graph.
   */
  const invalidationRoots = new Set<string>();

  /** Set by `invalidateAll()`, which has every derivation as a root. */
  let allInvalidated = false;

  // Deferred notification: during invalidation, collect IDs to notify.
  // Listeners fire AFTER all invalidations complete so they see consistent state.
  let invalidationDepth = 0;
  const pendingNotifications = new Set<string>();
  let isFlushing = false;
  const MAX_FLUSH_ITERATIONS = 100;

  // The proxy for composition (derivations accessing other derivations)
  // biome-ignore lint/style/useConst: Reassigned later in createDerivedProxy()
  let derivedProxy: DerivedValues<S, D>;

  // ---- Shared dependency-map helpers ----

  /**
   * Which map a tracked dependency belongs in, and under what key.
   *
   * The namespace decides, not a lookup. Both maps used to be selected by
   * asking whether a *name* was also a derivation — `definitions[dep]` on the
   * way in, `states.has(dep)` on the way out — which answers the wrong question
   * for a module carrying a fact and a derivation of the same name. A derivation
   * reading `facts.ready` alongside a sibling derivation named `ready` had its
   * fact dependency filed under derivations, so changing the fact never
   * invalidated it. The prefix says which kind the read was, at the point the
   * read happened, and nothing downstream has to guess.
   */
  function depMapFor(dep: string): {
    map: Map<string, Set<string>>;
    key: string;
  } {
    if (isDerivationDep(dep)) {
      return { map: derivedToDerivedDeps, key: derivationDepId(dep) };
    }

    return { map: factToDerivedDeps, key: dep };
  }

  /** Remove `id` from the dep-set keyed by `dep`. Deletes empty sets. */
  function removeDepLink(dep: string, id: string): void {
    const { map, key } = depMapFor(dep);
    const depSet = map.get(key);
    depSet?.delete(id);
    if (depSet && depSet.size === 0) {
      map.delete(key);
    }
  }

  /** Add `id` to the dep-set keyed by `dep`, creating the set if needed. */
  function addDepLink(dep: string, id: string): void {
    const { map, key } = depMapFor(dep);
    let depSet = map.get(key);
    if (!depSet) {
      depSet = new Set();
      map.set(key, depSet);
    }
    depSet.add(id);
  }

  /** Remove `id` from all dependency maps it participates in */
  function removeOwnDepLinks(id: string): void {
    const state = states.get(id);
    if (!state) {
      return;
    }
    for (const dep of state.dependencies) {
      removeDepLink(dep, id);
    }
  }

  /**
   * A derivation's definition has been replaced. Mark it stale, and carry that
   * through to everything composed on top of it.
   *
   * A new function means a new value, which means every derivation that read
   * this one is holding a value computed from the old one. Marking only this
   * derivation leaves those caches standing and, worse, leaves a valid
   * derivation sitting downstream of a stale one — the one shape the
   * invalidation walk assumes cannot happen, since it stops at the stale
   * frontier on the grounds that everything past it is stale already. From
   * then on every walk stops here and the dependents are never woken again.
   *
   * Shared by the two ways a definition can be replaced — assigning over it,
   * and registering a module whose `derive` names it — because they are the
   * same act and diverging on either obligation is how one of them acquired
   * this defect while the other did not.
   *
   * Deliberately does not touch the dependency set. Keeping it is what lets
   * the next recompute's diff remove the links the old definition tracked;
   * discarding it compares the new dependencies against nothing and leaves
   * every old link in place.
   */
  function invalidateReplacedDefinition(id: string): void {
    const state = states.get(id);
    if (!state) {
      return;
    }

    const wasStale = state.isStale;
    state.isStale = true;
    state.depsStable = false;
    state.stableRunCount = 0;
    pendingNotifications.add(id);
    if (!wasStale) {
      onInvalidate?.(id);
    }
    invalidationRoots.add(id);

    invalidationDepth++;
    try {
      const visited = new Set<string>([id]);
      const dependents = derivedToDerivedDeps.get(id);
      if (dependents) {
        for (const dependent of dependents) {
          invalidateDerivation(dependent, visited);
        }
      }
    } finally {
      invalidationDepth--;
    }
  }

  /** Invalidate derivations that depend on `id`, then clean up its entry */
  function invalidateDependentsOf(id: string): void {
    const dependents = derivedToDerivedDeps.get(id);
    if (!dependents) {
      return;
    }

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

  /** Remove a derivation from all internal maps */
  function purgeFromMaps(id: string): void {
    delete (definitions as Record<string, unknown>)[id];
    states.delete(id);
    listeners.delete(id);
    pendingNotifications.delete(id);
    derivationMeta.delete(id);
    observedIds.delete(id);
    invalidationRoots.delete(id);
  }

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
      stableRunCount: 0,
      depsStable: false,
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
    computingDepth++;

    try {
      // Capture old value before recomputation
      const oldValue = state.cachedValue;

      let value: unknown;
      let deps: Set<string>;

      if (state.depsStable && state.dependencies.size > 0) {
        // Fast path: deps are stable — skip withTracking() overhead
        value = def(facts, derivedProxy);
        deps = state.dependencies;
      } else {
        // Full tracking path
        const tracked = withTracking(() => def(facts, derivedProxy));
        value = tracked.value;
        deps = tracked.deps;

        // Check dep stability
        if (
          state.dependencies.size > 0 &&
          setsEqual(deps, state.dependencies)
        ) {
          state.stableRunCount++;
          if (state.stableRunCount >= STABLE_THRESHOLD) {
            state.depsStable = true;
          }
        } else {
          state.stableRunCount = 0;
        }
      }

      // Update state
      state.cachedValue = value;
      state.isStale = false;

      // Update dependency tracking
      updateDependencies(id, deps);

      // Notify callback (guard avoids the allocation when no listener).
      // Described, not raw: a plugin and a trace entry are both read by a
      // person, and the namespace separator is an internal encoding.
      if (onCompute) {
        onCompute(id, value, oldValue, Array.from(deps, describeDep));
      }

      return value;
    } catch (error) {
      onError?.(id, error);
      throw error;
    } finally {
      state.isComputing = false;
      computingDepth--;
    }
  }

  /** Check whether two Sets contain the same elements */
  function setsEqual(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size) {
      return false;
    }
    for (const dep of b) {
      if (!a.has(dep)) {
        return false;
      }
    }

    return true;
  }

  /** Update dependency tracking for a derivation */
  function updateDependencies(id: string, newDeps: Set<string>): void {
    const state = getState(id);
    const oldDeps = state.dependencies;

    if (setsEqual(oldDeps, newDeps)) {
      return;
    }

    for (const dep of oldDeps) {
      removeDepLink(dep, id);
    }
    for (const dep of newDeps) {
      addDepLink(dep, id);
    }

    state.dependencies = newDeps;
  }

  /** Notify all listeners for the given derivation ids */
  function notifyListeners(ids: string[]): void {
    for (const id of ids) {
      const fns = listeners.get(id);
      if (fns) {
        for (const listener of fns) {
          listener();
        }
      }
    }
  }

  /** Flush deferred notifications after all invalidations complete */
  function flushNotifications(): void {
    if (invalidationDepth > 0 || isFlushing) {
      return;
    }

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
            `[Directive] Infinite derivation notification loop detected after ${MAX_FLUSH_ITERATIONS} iterations. Remaining: ${remaining.join(", ")}. This usually means a derivation listener is mutating facts that re-trigger the same derivation.`,
          );
        }

        const ids = [...pendingNotifications];
        pendingNotifications.clear();
        notifyListeners(ids);
      }
    } finally {
      isFlushing = false;
    }
  }

  /** Enqueue transitive dependents of `id` into the work queue */
  function enqueueDependents(id: string, queue: string[]): void {
    const dependents = derivedToDerivedDeps.get(id);
    if (!dependents) {
      return;
    }
    for (const dependent of dependents) {
      queue.push(dependent);
    }
  }

  /**
   * Invalidate a derivation and its transitive dependents using iterative
   * traversal (work queue) to avoid stack overflow on deep chains.
   *
   * Accepts an optional shared `visited` Set so that `invalidateMany` can
   * coalesce multiple root invalidations into a single traversal.
   *
   * **Staleness latches, so the walk stops at the stale frontier.** A derivation
   * that is already stale has nothing to re-mark, and — because a derivation
   * only becomes valid by reading every dependency back — everything downstream
   * of a stale derivation is stale too. Walking through it would re-decide
   * facts already decided, once per fact write, over the whole downstream graph.
   *
   * That leaves the other question — which derivations *may have moved* — which
   * does repeat while a derivation stays stale, and which the frontier does not
   * answer. That one is not pushed. `startId` is filed as a root and the
   * transitive answer is computed at drain time, once per reconcile rather than
   * once per write, and only when something is watching. See
   * {@link DerivationsManager.collectInvalidated}.
   */
  function invalidateDerivation(
    startId: string,
    visited = new Set<string>(),
  ): void {
    invalidationRoots.add(startId);

    const queue = [startId];

    while (queue.length > 0) {
      const id = queue.pop()!;
      if (visited.has(id)) {
        continue;
      }
      visited.add(id);

      const state = states.get(id);
      if (!state || state.isStale) {
        continue;
      }

      state.isStale = true;
      // Reset dep stability so next recompute re-tracks via withTracking()
      state.depsStable = false;
      state.stableRunCount = 0;
      onInvalidate?.(id);

      // Defer listener notification until all invalidations complete.
      // This prevents listeners from observing partially-stale state and
      // avoids infinite loops from Set mutation during iteration (listeners
      // recompute derivations → updateDependencies → modify dep Sets).
      pendingNotifications.add(id);

      enqueueDependents(id, queue);
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
      // records a dependency on it (enables composition invalidation).
      // Namespaced, so the dependency cannot be mistaken for a fact key of
      // the same name — see DERIVATION_DEP_PREFIX.
      trackAccess(derivationDep(prop));

      // A read from outside a derivation body is a constraint's `when()` or an
      // effect's `run()` reading its `derived` parameter, and that is an
      // outside watcher: its dependency set is matched against the invalidation
      // set every reconcile, so this derivation has to be in the set that gets
      // collected. Without it the gate reads the value once and is never woken
      // again — silently, which is the failure this parameter exists to end.
      if (computingDepth === 0 && isTracking()) {
        observedIds.add(prop);
      }

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
      // Register the access, exactly as the composition proxy does.
      //
      // These are two doors onto one value — `derived.total` inside a
      // derivation body and `system.derive.total` from anywhere else — and only
      // one of them used to record that the read happened. So a constraint
      // whose `when()` consulted `system.derive.total` had its dependency on
      // `total` silently dropped: it evaluated once and was never brought back,
      // because nothing knew it cared. A no-op outside a tracking context,
      // which is where the overwhelming majority of these reads happen.
      //
      // Namespaced, for the same reason the composition proxy is: a fact and a
      // derivation may share a name, and a dependency set that could not tell
      // them apart re-ran an effect gated on the fact whenever the derivation
      // went stale.
      //
      // A read under tracking is also the definition of an outside watcher:
      // whatever body is running had this derivation written into its
      // dependency set, and that set is matched against the invalidation set
      // every reconcile. A read with no tracking context — a component
      // rendering, a test asserting — records nothing and watches nothing
      // through this channel, so it does not mark.
      if (isTracking()) {
        trackAccess(derivationDep(id as string));
        observedIds.add(id as string);
      }

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
      allInvalidated = true;
      try {
        for (const state of states.values()) {
          if (!state.isStale) {
            state.isStale = true;
            state.depsStable = false;
            state.stableRunCount = 0;
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
      const described = new Set<string>();
      for (const dep of getState(id as string).dependencies) {
        described.add(describeDep(dep));
      }

      return described;
    },

    markObserved(id: string): void {
      observedIds.add(id);
    },

    collectInvalidated(out: Set<string>): void {
      if (observedIds.size === 0) {
        // Nothing outside the graph is watching, so there is no closure to
        // compute and nothing to compute it for. The roots go, rather than
        // accumulating for whoever watches first: a watcher starts watching by
        // reading — a constraint's `when()`, an effect's body, an effect's
        // `deps` resolving — and whatever it read, it read after these. Holding
        // them back to deliver later would tell a fresh reader that a value it
        // has just seen may have moved since.
        invalidationRoots.clear();
        allInvalidated = false;

        return;
      }

      if (allInvalidated) {
        for (const id of observedIds) {
          out.add(derivationDep(id));
        }
        allInvalidated = false;
        invalidationRoots.clear();

        return;
      }

      if (invalidationRoots.size === 0) {
        return;
      }

      const queue = [...invalidationRoots];
      invalidationRoots.clear();
      const seen = new Set(queue);

      // Every watched derivation the walk can still reach is one it has not
      // reached yet, so once it has reached all of them there is nothing left
      // to find. `seen` makes each node arrive once, so this counts nodes, not
      // arrivals. Turns a graph where the watched derivations sit near the
      // changed fact into a walk of a few nodes rather than the whole cone.
      const watched = observedIds.size;
      let reached = 0;

      while (queue.length > 0) {
        const id = queue.pop()!;
        if (observedIds.has(id)) {
          out.add(derivationDep(id));
          if (++reached >= watched) {
            break;
          }
        }

        const dependents = derivedToDerivedDeps.get(id);
        if (!dependents) {
          continue;
        }
        for (const dependent of dependents) {
          if (!seen.has(dependent)) {
            seen.add(dependent);
            queue.push(dependent);
          }
        }
      }
    },

    registerDefinitions(newDefs: DerivationsDef<S>): void {
      for (const [key, raw] of Object.entries(newDefs)) {
        // Whether this key already names a live node. Registering over one is
        // a *replacement* — the same act `assignDefinition` performs, reached
        // through `system.registerModule` with a module whose `derive` names a
        // derivation the system already has, which nothing refuses: the
        // registration path checks fact-name collisions and never derivation
        // ones.
        //
        // It has to be told apart from a genuinely new key, because a fresh
        // state object is the wrong answer for a live one twice over. The old
        // dependency set goes with it, so the diff that removes stale links on
        // the next recompute compares against an empty set and every link the
        // replaced definition tracked is left standing. And the node is reset
        // to stale with nothing downstream told, which leaves a valid
        // derivation sitting under a stale one — the one shape the
        // invalidation walk assumes cannot happen, since it stops at the stale
        // frontier on the grounds that everything past it is stale already.
        // The damage is permanent rather than transient: every later walk
        // stops at the same node, so its dependents are never woken again.
        const replacing = states.has(key);

        if (typeof raw === "function") {
          (definitions as Record<string, unknown>)[key] = raw;
          if (replacing) {
            derivationMeta.delete(key);
          }
        } else {
          derivationMeta.delete(key);
          unwrapDerivationAt(key, raw);
        }

        if (replacing) {
          // Keeps the state — and with it the dependency set the diff needs —
          // and carries the change through the graph. Exactly what assigning
          // over the same name does, because it is the same thing happening.
          invalidateReplacedDefinition(key);
        } else {
          initState(key);
        }
      }

      flushNotifications();
    },

    assignDefinition(
      id: string,
      fn: DerivationsDef<S>[keyof DerivationsDef<S>],
    ): void {
      if (!definitions[id as keyof D]) {
        throw new Error(
          `[Directive] Cannot assign derivation "${id}" — it does not exist. Use register() to create it.`,
        );
      }

      // Unwrap object forms (function-with-meta, predicate, or template).
      if (typeof fn === "function") {
        (definitions as Record<string, unknown>)[id] = fn;
        derivationMeta.delete(id);
      } else {
        derivationMeta.delete(id);
        unwrapDerivationAt(id, fn);
      }

      invalidateReplacedDefinition(id);

      flushNotifications();
    },

    unregisterDefinition(id: string): void {
      if (!definitions[id as keyof D]) {
        return;
      }

      removeOwnDepLinks(id);
      invalidateDependentsOf(id);
      purgeFromMaps(id);

      flushNotifications();
    },

    getMeta(id: string): DefinitionMeta | undefined {
      return derivationMeta.get(id);
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
