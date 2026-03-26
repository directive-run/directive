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

import {
  PREFIX,
  buildKey,
  replaceEqualDeep,
  serializeKey,
} from "./internal.js";
import type { QueryDefinition, QueryOptions, ResourceState } from "./types.js";
import { createIdleResourceState } from "./types.js";

/** Build the requirement type for a query. */
function reqType(name: string): string {
  return `QUERY_${name.toUpperCase()}`;
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
>(options: QueryOptions<TData, TRaw, TError, TKey>): QueryDefinition<TData> {
  const {
    name,
    key: keyFn,
    fetcher,
    transform,
    refetchAfter = 0,
    enabled,
    dependsOn,
    retry,
    refetchOnWindowFocus = true,
    refetchOnReconnect = true,
    refetchInterval,
    placeholderData: rawPlaceholderData,
    keepPreviousData = false,
    initialData,
    initialDataUpdatedAt,
    suspense = false,
    throwOnError = false,
    onSuccess,
    onError,
    onSettled,
    structuralSharing = true,
    tags: _tags,
  } = options;

  // Resolve keepPreviousData → placeholderData
  const placeholderData =
    rawPlaceholderData ??
    (keepPreviousData ? (prev?: TData) => prev : undefined);

  // Internal fact keys
  const stateKey = buildKey(name, "state");
  const keyKey = buildKey(name, "key");
  const triggerKey = buildKey(name, "trigger");
  const prevDataKey = buildKey(name, "prevData");
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
    if (
      state.isPending &&
      state.data === null &&
      placeholderData !== undefined
    ) {
      const prevData = facts[prevDataKey] as TData | undefined;
      const placeholder =
        typeof placeholderData === "function"
          ? (placeholderData as (prev?: TData) => TData | undefined)(
              prevData ?? undefined,
            )
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
        const depState = facts[buildKey(dep, "state")] as
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
    tags: _tags,
    suspense,
    throwOnError,

    schema: {
      facts: {
        [stateKey]: { _type: null as unknown },
        [keyKey]: { _type: "" as unknown },
        [triggerKey]: { _type: 0 as unknown },
        [prevDataKey]: { _type: null as unknown },
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
      facts[prevDataKey] = null;
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
          const prevSerializedKey = facts[keyKey] as string | null;
          facts[keyKey] = serializedKey;

          // Clear trigger
          facts[triggerKey] = 0;

          // Store previous data for keepPreviousData / placeholderData(prev)
          const prevState = facts[stateKey] as ResourceState<TData, TError>;
          const keyChanged = prevSerializedKey !== serializedKey;
          if (keyChanged && prevState?.data !== null) {
            facts[prevDataKey] = prevState.data;
          }

          // Reset to pending on key change so placeholder logic kicks in
          if (keyChanged && prevState?.status === "success") {
            facts[stateKey] = {
              ...createIdleResourceState<TData, TError>(),
              isFetching: true,
            };
          } else {
            facts[stateKey] = {
              ...prevState,
              isFetching: true,
              isStale: false,
            };
          }

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
              isStale: false,
              isSuccess: true,
              isError: false,
              isPreviousData: false,
              dataUpdatedAt: now,
              failureCount: 0,
              failureReason: null,
            } satisfies ResourceState<TData, TError>;

            // Clear previous data — real data is now available
            facts[prevDataKey] = null;

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
                    refetchAfter === 0 ||
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
              run: (facts: Record<string, unknown>) => {
                if (typeof window === "undefined") {
                  return;
                }

                const handler = () => {
                  const state = facts[stateKey] as
                    | ResourceState<TData, TError>
                    | undefined;
                  if (!state) {
                    return;
                  }
                  const shouldRefetch =
                    refetchOnReconnect === "always" ||
                    refetchAfter === 0 ||
                    (state.dataUpdatedAt !== null &&
                      refetchAfter > 0 &&
                      Date.now() - state.dataUpdatedAt >= refetchAfter);
                  if (shouldRefetch) {
                    facts[triggerKey] = Date.now();
                  }
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
                if (typeof refetchInterval === "function") {
                  // Dynamic interval — use setTimeout chain so interval re-evaluates after each tick
                  let timeoutId: ReturnType<typeof setTimeout> | undefined;
                  let stopped = false;

                  const tick = () => {
                    if (stopped) {
                      return;
                    }
                    const ms = refetchInterval(
                      (facts[stateKey] as ResourceState<TData, TError>)?.data ??
                        undefined,
                    );
                    if (!ms) {
                      return;
                    }
                    timeoutId = setTimeout(() => {
                      facts[triggerKey] = Date.now();
                      tick();
                    }, ms as number);
                  };

                  tick();

                  return () => {
                    stopped = true;
                    if (timeoutId) {
                      clearTimeout(timeoutId);
                    }
                  };
                }

                // Static interval
                if (!refetchInterval) {
                  return;
                }

                const timer = setInterval(() => {
                  facts[triggerKey] = Date.now();
                }, refetchInterval as number);

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
