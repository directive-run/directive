/**
 * createListQuery — Per-key cached fetches for the "N items each fetched
 * independently" pattern.
 *
 * `createQuery` cache is singular: one ResourceState per query name. Key
 * change replaces the entry. That fits page-level "current entity"
 * patterns but breaks "render N cards each fetching its own data" — the
 * canonical TanStack Query case where you'd call `useQuery({queryKey:
 * ["X", id]})` N times and each component gets independent state.
 *
 * `createListQuery` keeps the rest of Directive Query's contract — facts
 * as cache, ResourceState derivation, structural sharing, retry, polling
 * — but the cache is `Map<serializedKey, ResourceState<T>>`. Components
 * subscribe to the whole map, look up their item via `serializeKey()` on
 * their own params, OR call the bound handle's `peek(params)` for a
 * direct lookup.
 *
 * The constraint emits ONE requirement per active key (not one per query
 * total), so the resolver runs in parallel, one resolver invocation per
 * item. Existing requirement coalescing in core dedupes simultaneous
 * fetches for the same key.
 *
 * @module
 */

import {
  PREFIX,
  buildKey,
  replaceEqualDeep,
  serializeKey,
} from "./internal.js";
import type { QueryDefinition, QueryOptions, ResourceState } from "./types.js";
import { createIdleResourceState } from "./types.js";

/** Build the requirement type for a list query. */
function reqType(name: string): string {
  return `LIST_QUERY_${name.toUpperCase()}`;
}

/** Mark every active key as needing a refetch — replaces the trigger
 *  fact so the engine's change tracker fires once per call. */
function bumpAllTriggers(
  facts: Record<string, unknown>,
  triggerKey: string,
  activeKeysKey: string,
): void {
  const active = (facts[activeKeysKey] as Record<string, true>) ?? {};
  const triggers = (facts[triggerKey] as Record<string, number>) ?? {};
  const now = Date.now();
  const next: Record<string, number> = { ...triggers };
  for (const k of Object.keys(active)) next[k] = now;
  facts[triggerKey] = next;
}

/**
 * Configuration for a list query.
 *
 * Differs from {@link QueryOptions} in one place: `keys` (plural)
 * returns an array of key objects — one per active list item. Returning
 * `null` or `[]` disables the query entirely.
 *
 * @typeParam TData - Per-item data type (after transform)
 * @typeParam TRaw  - Raw fetcher response type per item (defaults to TData)
 * @typeParam TError - Per-item error type (default: Error)
 * @typeParam TKey  - Per-item key/params object type
 */
export interface ListQueryOptions<
  TData,
  TRaw = TData,
  TError = Error,
  TKey extends Record<string, unknown> = Record<string, unknown>,
> extends Omit<
    QueryOptions<TData, TRaw, TError, TKey>,
    | "key"
    | "placeholderData"
    | "keepPreviousData"
    | "initialData"
    | "initialDataUpdatedAt"
  > {
  /**
   * Derive the active list of keys from facts. Return `null` or `[]` to
   * disable the query (clears all cached entries on garbage collection).
   * Each returned object IS the typed params passed to `fetcher`.
   */
  keys: (facts: Record<string, unknown>) => TKey[] | null;

  /**
   * Initial data per-key. Map from `serializeKey(key)` → TData. Treated
   * as real cache entries (status: success). Use for SSR hydration.
   */
  initialData?: Map<string, TData>;
}

/**
 * Per-item state map. Public shape of the derivation for `useDerived`.
 *
 * Note: stored internally as a plain `Record<string, ResourceState>` so
 * facts stay JSON-serializable (time-travel + structuredClone friendly).
 * The derivation exposes that record directly; consumers iterate via
 * `Object.entries()` or look up by stringified key.
 */
export type ListResourceMap<TData, TError = Error> = Record<
  string,
  ResourceState<TData, TError>
>;

/**
 * Bound handle for a list query (returned via `createQuerySystem`).
 * Mirrors {@link BoundQueryHandle} but operates on per-key cache entries.
 */
export interface BoundListQueryHandle<TData, TError = Error, TKey = unknown> {
  /** Trigger a refetch for ALL currently-active keys. */
  refetchAll: () => void;
  /** Trigger a refetch for ONE specific key (resolver runs once). */
  refetch: (params: TKey) => void;
  /**
   * Pure cache lookup — returns the ResourceState for the given key
   * without setting any facts. Use in selector hooks that read one item
   * from a list-query's cache. Returns `null` if no entry exists yet.
   */
  peek: (params: TKey) => ResourceState<TData, TError> | null;
  /** Set cached data directly for one key (for optimistic updates). */
  setData: (params: TKey, data: TData) => void;
  /** Invalidate one key's cache entry — triggers refetch on next evaluation. */
  invalidate: (params: TKey) => void;
  /** Invalidate ALL active keys at once. */
  invalidateAll: () => void;
}

// ============================================================================
// createListQuery
// ============================================================================

/**
 * Create a per-key cached fetch — the N-items pattern.
 *
 * @example
 * ```ts
 * const matchupDrift = createListQuery({
 *   name: "matchupDrift",
 *   // Active keys come from facts — page sets them when the bracket loads
 *   keys: (facts) =>
 *     facts.activeGameIds
 *       ? (facts.activeGameIds as string[]).map((id) => ({ gameId: id }))
 *       : null,
 *   fetcher: async ({ gameId }, signal) => {
 *     const res = await fetch(`/api/drift?id=${gameId}`, { signal });
 *     return res.json();
 *   },
 *   refetchAfter: 30_000,
 * });
 *
 * // In a card component:
 * const drift = system.queries.matchupDrift.peek({ gameId: "abc" });
 * if (drift?.isSuccess) render(drift.data);
 * ```
 */
export function createListQuery<
  TData,
  TRaw = TData,
  TError = Error,
  TKey extends Record<string, unknown> = Record<string, unknown>,
>(
  options: ListQueryOptions<TData, TRaw, TError, TKey>,
): QueryDefinition<ListResourceMap<TData, TError>> {
  const {
    name,
    keys: keysFn,
    fetcher,
    transform,
    refetchAfter = 0,
    expireAfter = 300_000,
    enabled,
    dependsOn,
    retry,
    refetchOnWindowFocus = true,
    refetchOnReconnect = true,
    refetchInterval,
    initialData,
    suspense = false,
    throwOnError = false,
    onSuccess,
    onError,
    onSettled,
    structuralSharing = true,
    tags: _tags,
  } = options;

  // Internal fact keys
  // _states: Map<serializedKey, ResourceState> — the per-key cache
  // _activeKeys: Set<serializedKey> — currently requested by keysFn
  // _trigger: Map<serializedKey, number> — manual refetch counters per key
  // _expireAt: Map<serializedKey, number> — when to GC each entry
  const statesKey = buildKey(name, "states");
  const activeKeysKey = buildKey(name, "activeKeys");
  const triggerKey = buildKey(name, "triggerByKey");
  const expireKey = buildKey(name, "expireAt");
  const requirementType = reqType(name);

  // Normalize retry to RetryPolicy
  const retryPolicy =
    typeof retry === "number"
      ? { attempts: retry, backoff: "exponential" as const }
      : retry;

  /** Read the per-key state map from facts (creating one if missing). */
  function readStates(
    facts: Record<string, unknown>,
  ): ListResourceMap<TData, TError> {
    return (facts[statesKey] as ListResourceMap<TData, TError>) ?? {};
  }

  /** Build the public derivation — returns the same record reference,
   *  garbage-collecting entries whose key is no longer active AND whose
   *  expireAt has passed. */
  function buildResourceMap(
    facts: Record<string, unknown>,
  ): ListResourceMap<TData, TError> {
    const states = readStates(facts);
    const expireAt = (facts[expireKey] as Record<string, number>) ?? {};
    const active = (facts[activeKeysKey] as Record<string, true>) ?? {};
    const stateKeys = Object.keys(states);
    const activeCount = Object.keys(active).length;
    if (
      expireAfter > 0 &&
      Number.isFinite(expireAfter) &&
      stateKeys.length > activeCount
    ) {
      const now = Date.now();
      for (const k of stateKeys) {
        if (active[k]) continue;
        const exp = expireAt[k] ?? 0;
        if (exp > 0 && exp <= now) {
          delete states[k];
          delete expireAt[k];
        }
      }
    }
    return states;
  }

  /** Decide which list items need fetching now. Returns the array of
   *  requirements the constraint should emit. */
  function pendingRequirements(
    facts: Record<string, unknown>,
  ): Array<{ type: string; key: string; params: TKey }> {
    const currentKeys = keysFn(facts);
    if (!currentKeys || currentKeys.length === 0) return [];

    if (enabled && !enabled(facts)) return [];

    if (dependsOn) {
      for (const dep of dependsOn) {
        const depState = facts[buildKey(dep, "state")] as
          | ResourceState<unknown>
          | undefined;
        if (!depState || depState.status !== "success") {
          return [];
        }
      }
    }

    const states = readStates(facts);
    const triggers = (facts[triggerKey] as Record<string, number>) ?? {};
    const out: Array<{ type: string; key: string; params: TKey }> = [];
    for (const key of currentKeys) {
      const sk = serializeKey(key);
      const state = states[sk];

      // Manual refetch trigger
      if ((triggers[sk] ?? 0) > 0) {
        out.push({ type: requirementType, key: sk, params: key });
        continue;
      }
      // No cached entry yet
      if (!state || state.status === "pending") {
        out.push({ type: requirementType, key: sk, params: key });
        continue;
      }
      // Stale data
      if (refetchAfter > 0 && state.dataUpdatedAt !== null) {
        const age = Date.now() - state.dataUpdatedAt;
        if (age >= refetchAfter) {
          out.push({ type: requirementType, key: sk, params: key });
        }
      }
    }
    return out;
  }

  // ---- Build the QueryDefinition ----

  const definition: QueryDefinition<ListResourceMap<TData, TError>> = {
    name,
    // Tags are typed against the per-item TData (since users want to
    // tag-invalidate "all matchups for game X"), not the Map. Cast to
    // satisfy QueryDefinition's generic, which uses the derivation type.
    tags: _tags as unknown as QueryDefinition<
      ListResourceMap<TData, TError>
    >["tags"],
    suspense,
    throwOnError,

    schema: {
      facts: {
        [statesKey]: { _type: null as unknown },
        [activeKeysKey]: { _type: null as unknown },
        [triggerKey]: { _type: null as unknown },
        [expireKey]: { _type: null as unknown },
      },
      derivations: {
        [name]: { _type: null as unknown },
      },
    },

    requirements: {
      [requirementType]: {},
    },

    init: (facts: Record<string, unknown>) => {
      const states: ListResourceMap<TData, TError> = {};
      if (initialData) {
        for (const [sk, data] of initialData) {
          const s = createIdleResourceState<TData, TError>();
          s.data = data;
          s.status = "success";
          s.isPending = false;
          s.isSuccess = true;
          s.dataUpdatedAt = Date.now();
          states[sk] = s;
        }
      }
      facts[statesKey] = states;
      facts[activeKeysKey] = {} as Record<string, true>;
      facts[triggerKey] = {} as Record<string, number>;
      facts[expireKey] = {} as Record<string, number>;
    },

    derive: {
      [name]: buildResourceMap,
    },

    constraints: {
      [`${PREFIX}${name}_fetch_list`]: {
        when: (facts: Record<string, unknown>) =>
          pendingRequirements(facts).length > 0,
        require: (facts: Record<string, unknown>) => pendingRequirements(facts),
        priority: 50,
      },
    },

    resolvers: {
      [`${PREFIX}${name}_resolve_list`]: {
        requirement: requirementType,
        // Per-key dedupe — coalesces concurrent identical fetches.
        key: (req: Record<string, unknown>) =>
          `${requirementType}:${req.key as string}`,
        retry: retryPolicy,
        resolve: async (
          req: Record<string, unknown>,
          context: { facts: Record<string, unknown>; signal: AbortSignal },
        ) => {
          const { facts, signal } = context;
          const params = req.params as TKey;
          const sk = req.key as string;
          // Replace records (not mutate in place) so the engine's fact-
          // change tracker fires. createQuery follows the same convention
          // — facts are immutable values, mutations replace the reference.
          const states = readStates(facts);
          const triggers = (facts[triggerKey] as Record<string, number>) ?? {};
          const activeKeys =
            (facts[activeKeysKey] as Record<string, true>) ?? {};

          // Track this key as active (resets GC clock)
          facts[activeKeysKey] = { ...activeKeys, [sk]: true };
          facts[triggerKey] = { ...triggers, [sk]: 0 };

          // Mark the entry as fetching (preserve previous data if any)
          const prev = states[sk];
          const fetchingEntry =
            prev && prev.data !== null
              ? { ...prev, isFetching: true, isStale: false }
              : {
                  ...createIdleResourceState<TData, TError>(),
                  isFetching: true,
                };
          facts[statesKey] = { ...states, [sk]: fetchingEntry };

          try {
            const rawData = await fetcher(params, signal);
            let data: TData = transform
              ? transform(rawData)
              : (rawData as unknown as TData);

            // Structural sharing per-key — preserve refs if data is deep-equal.
            if (
              structuralSharing &&
              prev?.data !== null &&
              prev?.data !== undefined
            ) {
              data = replaceEqualDeep(prev.data, data) as TData;
            }

            const now = Date.now();
            const successEntry: ResourceState<TData, TError> = {
              data,
              error: null,
              status: "success",
              isPending: false,
              isFetching: false,
              isStale: false,
              isSuccess: true,
              isError: false,
              isComplete: false,
              isPreviousData: false,
              dataUpdatedAt: now,
              failureCount: 0,
              failureReason: null,
            };
            // Re-read because other concurrent resolvers may have written
            // to the same record while this fetch was in flight.
            const latestStates = readStates(facts);
            facts[statesKey] = { ...latestStates, [sk]: successEntry };

            // Schedule GC for when this key is no longer active.
            const expire = (facts[expireKey] as Record<string, number>) ?? {};
            facts[expireKey] = { ...expire, [sk]: now + expireAfter };

            // The shared QueryOptions types onSuccess/onSettled with TData
            // (the per-item type), which is exactly what we have here. No
            // cast needed; the QueryDefinition wrapper's TData generic
            // refers to the derivation type (the Map), not the per-item type.
            (onSuccess as ((d: TData) => void) | undefined)?.(data);
            (
              onSettled as
                | ((d: TData | undefined, e: TError | null) => void)
                | undefined
            )?.(data, null);
          } catch (error) {
            if (signal.aborted) return;
            const typedError = error as TError;
            const latestStates = readStates(facts);
            const current = latestStates[sk];
            const errorEntry: ResourceState<TData, TError> = {
              ...(current ?? createIdleResourceState<TData, TError>()),
              error: typedError,
              status: "error",
              isPending: false,
              isFetching: false,
              isError: true,
              isSuccess: false,
              failureCount: (current?.failureCount ?? 0) + 1,
              failureReason: typedError,
            };
            facts[statesKey] = { ...latestStates, [sk]: errorEntry };
            (onError as ((e: TError) => void) | undefined)?.(typedError);
            (
              onSettled as
                | ((d: TData | undefined, e: TError | null) => void)
                | undefined
            )?.(undefined, typedError);
          }
        },
      },
    },

    effects: {
      // Window focus refetch — triggers ALL active keys at once via the
      // shared trigger map.
      ...(refetchOnWindowFocus
        ? {
            [`${PREFIX}${name}_focus_list`]: {
              run: (facts: Record<string, unknown>) => {
                if (typeof document === "undefined") return;
                const handler = () => {
                  if (document.hidden) return;
                  bumpAllTriggers(facts, triggerKey, activeKeysKey);
                };
                document.addEventListener("visibilitychange", handler);
                return () =>
                  document.removeEventListener("visibilitychange", handler);
              },
            },
          }
        : {}),

      ...(refetchOnReconnect
        ? {
            [`${PREFIX}${name}_online_list`]: {
              run: (facts: Record<string, unknown>) => {
                if (typeof window === "undefined") return;
                const handler = () => {
                  bumpAllTriggers(facts, triggerKey, activeKeysKey);
                };
                window.addEventListener("online", handler);
                return () => window.removeEventListener("online", handler);
              },
            },
          }
        : {}),

      // Polling — same trigger-map approach.
      ...(refetchInterval
        ? {
            [`${PREFIX}${name}_poll_list`]: {
              run: (facts: Record<string, unknown>) => {
                const intervalMs =
                  typeof refetchInterval === "function"
                    ? refetchInterval(undefined as unknown as TData)
                    : refetchInterval;
                if (!intervalMs || intervalMs <= 0) return;
                const id = setInterval(() => {
                  bumpAllTriggers(facts, triggerKey, activeKeysKey);
                }, intervalMs);
                return () => clearInterval(id);
              },
            },
          }
        : {}),
    },

    // Imperative handles — operate on individual keys, not the whole map.
    refetch: (facts: Record<string, unknown>) => {
      // Default: refetch all active keys (matches createQuery's refetch
      // semantics, which always refetches "the current data").
      bumpAllTriggers(facts, triggerKey, activeKeysKey);
    },

    invalidate: (facts: Record<string, unknown>) => {
      // Default: invalidate all entries by clearing their dataUpdatedAt
      // — next evaluation will see them as stale and refetch.
      const states = readStates(facts);
      const next: ListResourceMap<TData, TError> = {};
      for (const [k, s] of Object.entries(states)) {
        next[k] = { ...s, isStale: true, dataUpdatedAt: null };
      }
      facts[statesKey] = next;
    },

    cancel: () => {
      /* no-op: per-key cancellation lives on the resolver's AbortController,
       * fired by the engine when keys leave the active set. */
    },

    setData: (
      facts: Record<string, unknown>,
      _data: ListResourceMap<TData, TError>,
    ) => {
      // Setting the entire map at once is the documented escape hatch for
      // SSR-style hydration. For per-key writes use the bound handle's
      // setData(params, data) — wired in createQuerySystem.
      facts[statesKey] = _data;
    },

    prefetch: (
      facts: Record<string, unknown>,
      params: Record<string, unknown>,
    ) => {
      // Add the key to active set so the next constraint pass picks it up.
      const active = (facts[activeKeysKey] as Record<string, true>) ?? {};
      facts[activeKeysKey] = { ...active, [serializeKey(params)]: true };
    },
  };

  return definition;
}

/**
 * Build a per-key bound handle from a system facts proxy + a list query
 * definition. Called by createQuerySystem when wiring `system.queries.X`
 * for any query whose definition originated in createListQuery.
 *
 * Exposed here (not just inside createQuerySystem) so callers using
 * createModule + withQueries can build the same handle themselves.
 */
export function bindListQueryHandle<
  TData,
  TError = Error,
  TKey extends Record<string, unknown> = Record<string, unknown>,
>(
  facts: Record<string, unknown>,
  name: string,
): BoundListQueryHandle<TData, TError, TKey> {
  const statesKey = buildKey(name, "states");
  const triggerKey = buildKey(name, "triggerByKey");

  const activeKeysKey = buildKey(name, "activeKeys");
  return {
    refetchAll: () => bumpAllTriggers(facts, triggerKey, activeKeysKey),
    refetch: (params) => {
      const triggers = (facts[triggerKey] as Record<string, number>) ?? {};
      facts[triggerKey] = { ...triggers, [serializeKey(params)]: Date.now() };
    },
    peek: (params) => {
      const states = facts[statesKey] as ListResourceMap<TData, TError>;
      return states?.[serializeKey(params)] ?? null;
    },
    setData: (params, data) => {
      const states = (facts[statesKey] as ListResourceMap<TData, TError>) ?? {};
      const sk = serializeKey(params);
      const prev = states[sk];
      facts[statesKey] = {
        ...states,
        [sk]: {
          ...(prev ?? createIdleResourceState<TData, TError>()),
          data,
          error: null,
          status: "success",
          isPending: false,
          isFetching: false,
          isStale: false,
          isSuccess: true,
          isError: false,
          dataUpdatedAt: Date.now(),
        },
      };
    },
    invalidate: (params) => {
      const states = (facts[statesKey] as ListResourceMap<TData, TError>) ?? {};
      const sk = serializeKey(params);
      const prev = states[sk];
      if (prev) {
        facts[statesKey] = {
          ...states,
          [sk]: { ...prev, isStale: true, dataUpdatedAt: null },
        };
      }
    },
    invalidateAll: () => {
      const states = (facts[statesKey] as ListResourceMap<TData, TError>) ?? {};
      const next: ListResourceMap<TData, TError> = {};
      for (const [k, s] of Object.entries(states)) {
        next[k] = { ...s, isStale: true, dataUpdatedAt: null };
      }
      facts[statesKey] = next;
    },
  };
}
