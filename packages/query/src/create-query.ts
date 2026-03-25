/**
 * createQuery — Generate constraint/resolver/effect fragments for declarative data fetching.
 *
 * Takes a QueryOptions config and returns a QueryDefinition containing
 * fragments that merge into a module via `withQueries`.
 *
 * The fetcher is user-provided (fetch-agnostic). Cache is stored as facts
 * (serializable, time-travel-compatible). Status is a derivation.
 *
 * @module
 */

import type {
  QueryOptions,
  QueryDefinition,
  ResourceState,
} from "./types.js";
import { createIdleResourceState } from "./types.js";

// ============================================================================
// Internal key helpers
// ============================================================================

/** Prefix for internal query facts. Matches Directive's $store/$snapshot convention. */
const PREFIX = "$";

/** Build an internal fact key for a query. */
function qKey(name: string, suffix: string): string {
  return `${PREFIX}${name}_${suffix}`;
}

/** Build the requirement type for a query. */
function reqType(name: string): string {
  return `QUERY_${name.toUpperCase()}`;
}

/** Serialize a key object to a stable string for cache identity. */
function serializeKey(key: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(key)
      .sort()
      .reduce(
        (acc, k) => {
          acc[k] = key[k];

          return acc;
        },
        {} as Record<string, unknown>,
      ),
  );
}

// ============================================================================
// Structural sharing (deep equal + reference preservation)
// ============================================================================

/** Deep equal with reference preservation. Returns old ref if deeply equal. */
function replaceEqualDeep(oldVal: unknown, newVal: unknown): unknown {
  if (Object.is(oldVal, newVal)) {
    return oldVal;
  }

  if (
    typeof oldVal !== "object" ||
    typeof newVal !== "object" ||
    oldVal === null ||
    newVal === null
  ) {
    return newVal;
  }

  const oldArr = Array.isArray(oldVal);
  const newArr = Array.isArray(newVal);
  if (oldArr !== newArr) {
    return newVal;
  }

  if (oldArr && newArr) {
    const oldA = oldVal as unknown[];
    const newA = newVal as unknown[];
    if (oldA.length !== newA.length) {
      return newVal;
    }
    let same = true;
    const result = new Array(newA.length);
    for (let i = 0; i < newA.length; i++) {
      result[i] = replaceEqualDeep(oldA[i], newA[i]);
      if (result[i] !== oldA[i]) {
        same = false;
      }
    }

    return same ? oldVal : result;
  }

  const oldObj = oldVal as Record<string, unknown>;
  const newObj = newVal as Record<string, unknown>;
  const oldKeys = Object.keys(oldObj);
  const newKeys = Object.keys(newObj);
  if (oldKeys.length !== newKeys.length) {
    return newVal;
  }

  let same = true;
  const result: Record<string, unknown> = {};
  for (const k of newKeys) {
    if (!(k in oldObj)) {
      return newVal;
    }
    result[k] = replaceEqualDeep(oldObj[k], newObj[k]);
    if (result[k] !== oldObj[k]) {
      same = false;
    }
  }

  return same ? oldVal : result;
}

// ============================================================================
// createQuery
// ============================================================================

/**
 * Create a declarative data fetching query.
 *
 * Returns a {@link QueryDefinition} containing constraint/resolver/effect
 * fragments that merge into a module via `withQueries`.
 *
 * @example
 * ```typescript
 * const user = createQuery({
 *   name: "user",
 *   key: (facts) => facts.userId ? { userId: facts.userId } : null,
 *   fetcher: async (params, signal) => {
 *     const res = await fetch(`/api/users/${params.userId}`, { signal });
 *     return res.json();
 *   },
 *   refetchAfter: 30_000,
 * });
 *
 * const module = createModule("app", withQueries([user], { ... }));
 * ```
 */
export function createQuery<
  TData,
  TRaw = TData,
  TError = Error,
  TKey extends Record<string, unknown> = Record<string, unknown>,
>(
  options: QueryOptions<TData, TRaw, TError, TKey>,
): QueryDefinition<TData> {
  const {
    name,
    key: keyFn,
    fetcher,
    transform,
    refetchAfter = 0,
    expireAfter: _expireAfter = 300_000,
    enabled,
    dependsOn,
    retry,
    refetchOnWindowFocus = true,
    refetchOnReconnect = true,
    refetchInterval,
    placeholderData,
    initialData,
    initialDataUpdatedAt,
    onSuccess,
    onError,
    onSettled,
    structuralSharing = true,
    tags: _tags,
  } = options;

  // Internal fact keys
  const stateKey = qKey(name, "state");
  const keyKey = qKey(name, "key");
  const triggerKey = qKey(name, "trigger");
  const requirementType = reqType(name);

  // Normalize retry to RetryPolicy
  const retryPolicy =
    typeof retry === "number"
      ? { attempts: retry, backoff: "exponential" as const }
      : retry;

  /** Build the ResourceState derivation from internal facts. */
  function buildResourceState(
    facts: Record<string, unknown>,
  ): ResourceState<TData, TError> {
    const state = facts[stateKey] as ResourceState<TData, TError> | undefined;
    if (!state) {
      return createIdleResourceState<TData, TError>();
    }

    // Apply placeholder data if pending and no data yet
    if (state.isPending && state.data === null && placeholderData !== undefined) {
      const placeholder =
        typeof placeholderData === "function"
          ? (placeholderData as (prev?: TData) => TData | undefined)(undefined)
          : placeholderData;
      if (placeholder !== undefined) {
        return { ...state, data: placeholder, isPreviousData: true };
      }
    }

    return state;
  }

  /** Check if the query should fire. */
  function shouldFetch(facts: Record<string, unknown>): boolean {
    // Compute key
    const currentKey = keyFn(facts);
    if (currentKey === null) {
      return false;
    }

    // Check enabled condition
    if (enabled && !enabled(facts)) {
      return false;
    }

    // Check dependsOn
    if (dependsOn) {
      for (const dep of dependsOn) {
        const depState = facts[qKey(dep, "state")] as
          | ResourceState<unknown>
          | undefined;
        if (!depState || depState.status !== "success") {
          return false;
        }
      }
    }

    const state = facts[stateKey] as ResourceState<TData, TError> | undefined;
    const prevSerializedKey = facts[keyKey] as string | null;
    const serializedKey = serializeKey(currentKey);

    // Key changed — always refetch
    if (prevSerializedKey !== serializedKey) {
      return true;
    }

    // Manual trigger
    if (facts[triggerKey]) {
      return true;
    }

    // No data yet — fetch
    if (!state || state.status === "pending") {
      return true;
    }

    // Check staleness
    if (refetchAfter > 0 && state.dataUpdatedAt !== null) {
      const age = Date.now() - state.dataUpdatedAt;
      if (age >= refetchAfter) {
        return true;
      }
    }

    return false;
  }

  // ---- Build the definition ----

  const definition: QueryDefinition<TData> = {
    name,

    schema: {
      facts: {
        [stateKey]: { _type: null as unknown },
        [keyKey]: { _type: "" as unknown },
        [triggerKey]: { _type: 0 as unknown },
      },
      derivations: {
        [name]: { _type: null as unknown },
      },
    },

    requirements: {
      [requirementType]: {},
    },

    init: (facts: Record<string, unknown>) => {
      if (initialData !== undefined) {
        const state = createIdleResourceState<TData, TError>();
        state.data = initialData;
        state.status = "success";
        state.isPending = false;
        state.isSuccess = true;
        state.dataUpdatedAt = initialDataUpdatedAt ?? Date.now();
        facts[stateKey] = state;
      } else {
        facts[stateKey] = createIdleResourceState<TData, TError>();
      }
      facts[keyKey] = null;
      facts[triggerKey] = 0;
    },

    derive: {
      [name]: buildResourceState,
    },

    constraints: {
      [`${PREFIX}${name}_fetch`]: {
        when: shouldFetch,
        require: (facts: Record<string, unknown>) => {
          const currentKey = keyFn(facts);

          return {
            type: requirementType,
            key: currentKey ? serializeKey(currentKey) : "",
            params: currentKey,
          };
        },
        priority: 50,
      },
    },

    resolvers: {
      [`${PREFIX}${name}_resolve`]: {
        requirement: requirementType,
        key: (req: Record<string, unknown>) =>
          `${requirementType}:${req.key as string}`,
        retry: retryPolicy,
        resolve: async (
          req: Record<string, unknown>,
          context: { facts: Record<string, unknown>; signal: AbortSignal },
        ) => {
          const { facts, signal } = context;
          const params = req.params as TKey;
          const serializedKey = req.key as string;

          // Update key tracking
          facts[keyKey] = serializedKey;

          // Clear trigger
          facts[triggerKey] = 0;

          // Set fetching state
          const prevState = facts[stateKey] as ResourceState<TData, TError>;
          facts[stateKey] = {
            ...prevState,
            isFetching: true,
            isStale: false,
          };

          try {
            const rawData = await fetcher(params, signal);
            let data: TData = transform
              ? transform(rawData)
              : (rawData as unknown as TData);

            // Structural sharing — preserve references if data unchanged
            if (structuralSharing && prevState?.data !== null) {
              data = replaceEqualDeep(prevState.data, data) as TData;
            }

            const now = Date.now();
            facts[stateKey] = {
              data,
              error: null,
              status: "success",
              isPending: false,
              isFetching: false,
              isStale:
                refetchAfter > 0
                  ? false
                  : false,
              isSuccess: true,
              isError: false,
              isPreviousData: false,
              dataUpdatedAt: now,
              failureCount: 0,
              failureReason: null,
            } satisfies ResourceState<TData, TError>;

            onSuccess?.(data);
            onSettled?.(data, null);
          } catch (error) {
            // Don't update state if the fetch was aborted (key changed)
            if (signal.aborted) {
              return;
            }

            const typedError = error as TError;
            const currentState = facts[stateKey] as ResourceState<
              TData,
              TError
            >;
            facts[stateKey] = {
              ...currentState,
              error: typedError,
              status: "error",
              isPending: false,
              isFetching: false,
              isError: true,
              isSuccess: false,
              failureCount: currentState.failureCount + 1,
              failureReason: typedError,
            };

            onError?.(typedError);
            onSettled?.(undefined, typedError);
          }
        },
      },
    },

    effects: {
      // Window focus refetch
      ...(refetchOnWindowFocus
        ? {
            [`${PREFIX}${name}_focus`]: {
              run: (facts: Record<string, unknown>) => {
                if (typeof document === "undefined") {
                  return;
                }

                const handler = () => {
                  if (document.hidden) {
                    return;
                  }
                  const state = facts[stateKey] as
                    | ResourceState<TData, TError>
                    | undefined;
                  if (!state) {
                    return;
                  }
                  const shouldRefetch =
                    refetchOnWindowFocus === "always" ||
                    (state.dataUpdatedAt !== null &&
                      refetchAfter > 0 &&
                      Date.now() - state.dataUpdatedAt >= refetchAfter);
                  if (shouldRefetch) {
                    facts[triggerKey] = Date.now();
                  }
                };

                document.addEventListener("visibilitychange", handler);

                return () =>
                  document.removeEventListener("visibilitychange", handler);
              },
            },
          }
        : {}),

      // Network reconnect refetch
      ...(refetchOnReconnect
        ? {
            [`${PREFIX}${name}_online`]: {
              run: () => {
                if (typeof window === "undefined") {
                  return;
                }

                const handler = () => {
                  // Trigger will be picked up on next reconcile
                };

                window.addEventListener("online", handler);

                return () => window.removeEventListener("online", handler);
              },
            },
          }
        : {}),

      // Polling
      ...(refetchInterval
        ? {
            [`${PREFIX}${name}_poll`]: {
              run: (facts: Record<string, unknown>) => {
                const interval =
                  typeof refetchInterval === "function"
                    ? refetchInterval(
                        (facts[stateKey] as ResourceState<TData, TError>)?.data ??
                          undefined,
                      )
                    : refetchInterval;

                if (!interval) {
                  return;
                }

                const timer = setInterval(() => {
                  facts[triggerKey] = Date.now();
                }, interval as number);

                return () => clearInterval(timer);
              },
            },
          }
        : {}),
    },

    // --- Imperative handles ---

    refetch: (facts: Record<string, unknown>) => {
      facts[triggerKey] = Date.now();
    },

    invalidate: (facts: Record<string, unknown>) => {
      const state = facts[stateKey] as ResourceState<TData, TError> | undefined;
      if (state) {
        facts[stateKey] = { ...state, isStale: true };
      }
      facts[triggerKey] = Date.now();
    },

    cancel: (facts: Record<string, unknown>) => {
      // Cancel is handled by the engine's resolver cancellation via AbortSignal.
      // Setting key to a new value triggers requirement diff which cancels old resolver.
      // For explicit cancel, we invalidate the trigger to prevent re-fire.
      facts[triggerKey] = 0;
    },

    setData: (facts: Record<string, unknown>, data: TData) => {
      const prevState =
        (facts[stateKey] as ResourceState<TData, TError>) ??
        createIdleResourceState<TData, TError>();
      facts[stateKey] = {
        ...prevState,
        data,
        status: "success",
        isPending: false,
        isFetching: false,
        isSuccess: true,
        isError: false,
        error: null,
        dataUpdatedAt: Date.now(),
      };
    },

    prefetch: (
      facts: Record<string, unknown>,
      params: Record<string, unknown>,
    ) => {
      const serialized = serializeKey(params);
      facts[keyKey] = serialized;
      facts[triggerKey] = Date.now();
    },
  };

  return definition;
}
