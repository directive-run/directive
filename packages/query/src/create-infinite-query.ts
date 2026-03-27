/**
 * createInfiniteQuery — Paginated/infinite scroll queries.
 *
 * Like createQuery but accumulates pages instead of replacing data.
 * Supports cursor-based and offset-based pagination, bidirectional
 * scrolling, and memory capping via maxPages.
 *
 * @module
 */

import type { RetryPolicy } from "@directive-run/core";
import { PREFIX, buildKey, serializeKey } from "./internal.js";
import type { ResourceState } from "./types.js";
import { createIdleResourceState } from "./types.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for an infinite/paginated query.
 *
 * @typeParam TData - The page data type
 * @typeParam TError - The error type
 * @typeParam TKey - The key/params type
 * @typeParam TPageParam - The page parameter type (cursor, offset, etc.)
 */
export interface InfiniteQueryOptions<
  TData,
  TError = Error,
  TKey extends Record<string, unknown> = Record<string, unknown>,
  TPageParam = unknown,
> {
  name: string;
  key: (facts: Record<string, unknown>) => TKey | null;
  fetcher: (
    params: TKey & { pageParam: TPageParam },
    signal: AbortSignal,
  ) => Promise<TData>;
  /** Extract the next page param from the last page. Return null = no more pages. */
  getNextPageParam: (lastPage: TData, allPages: TData[]) => TPageParam | null;
  /** Extract the previous page param. Return null = no previous pages. */
  getPreviousPageParam?: (
    firstPage: TData,
    allPages: TData[],
  ) => TPageParam | null;
  /** Initial page param for the first fetch. */
  initialPageParam: TPageParam;
  /** Maximum pages to keep in memory. Oldest pages are evicted. */
  maxPages?: number;

  // Inherited from QueryOptions
  enabled?: (facts: Record<string, unknown>) => boolean;
  dependsOn?: string[];
  refetchAfter?: number;
  /** Duration (ms) after which an idle query's cached data expires. @default 300_000 */
  expireAfter?: number;
  retry?: RetryPolicy | number;
  tags?: string[];
  onSuccess?: (data: TData[]) => void;
  onError?: (error: TError) => void;
  onSettled?: (data: TData[] | undefined, error: TError | null) => void;
}

/**
 * State for an infinite query — extends ResourceState with page management.
 */
export interface InfiniteResourceState<TData, TError = Error>
  extends ResourceState<TData[], TError> {
  /** All loaded pages. */
  pages: TData[];
  /** Page params used to fetch each page. */
  pageParams: unknown[];
  /** True if there are more pages to load. */
  hasNextPage: boolean;
  /** True if there are previous pages to load (bidirectional). */
  hasPreviousPage: boolean;
  /** True while fetching the next page. */
  isFetchingNextPage: boolean;
  /** True while fetching the previous page. */
  isFetchingPreviousPage: boolean;
}

/** Return type of createInfiniteQuery. */
export interface InfiniteQueryDefinition<TData = unknown> {
  readonly name: string;
  readonly schema: {
    readonly facts: Record<string, unknown>;
    readonly derivations: Record<string, unknown>;
  };
  readonly requirements: Record<string, Record<string, unknown>>;
  readonly init: (facts: Record<string, unknown>) => void;
  readonly derive: Record<string, (facts: Record<string, unknown>) => unknown>;
  readonly constraints: Record<string, unknown>;
  readonly resolvers: Record<string, unknown>;
  readonly effects: Record<string, unknown>;
  fetchNextPage: (facts: Record<string, unknown>) => void;
  fetchPreviousPage: (facts: Record<string, unknown>) => void;
  refetch: (facts: Record<string, unknown>) => void;
  /** @internal Type brand — ensures TData propagates through generics. */
  readonly _dataType?: TData;
}

// ============================================================================
// Internal helpers
// ============================================================================

function reqType(name: string, direction: string): string {
  return `QUERY_${name.toUpperCase()}_${direction}`;
}

/** Create a default infinite resource state. */
function createIdleInfiniteState<
  TData,
  TError = Error,
>(): InfiniteResourceState<TData, TError> {
  return {
    ...createIdleResourceState<TData[], TError>(),
    data: [],
    pages: [],
    pageParams: [],
    hasNextPage: false,
    hasPreviousPage: false,
    isFetchingNextPage: false,
    isFetchingPreviousPage: false,
  };
}

// ============================================================================
// createInfiniteQuery
// ============================================================================

/**
 * Create a paginated/infinite scroll query.
 *
 * @example
 * ```typescript
 * const feed = createInfiniteQuery({
 *   name: "feed",
 *   key: (facts) => facts.userId ? { userId: facts.userId } : null,
 *   fetcher: async (params, signal) => {
 *     const res = await fetch(`/api/feed?user=${params.userId}&cursor=${params.pageParam ?? ""}`, { signal });
 *     return res.json();
 *   },
 *   getNextPageParam: (lastPage) => lastPage.nextCursor,
 *   initialPageParam: null,
 * });
 *
 * // Load more:
 * feed.fetchNextPage(system.facts);
 * ```
 */
export function createInfiniteQuery<
  TData,
  TError = Error,
  TKey extends Record<string, unknown> = Record<string, unknown>,
  TPageParam = unknown,
>(
  options: InfiniteQueryOptions<TData, TError, TKey, TPageParam>,
): InfiniteQueryDefinition<TData> {
  const {
    name,
    key: keyFn,
    fetcher,
    getNextPageParam,
    getPreviousPageParam,
    initialPageParam,
    maxPages,
    enabled,
    dependsOn,
    retry,
    refetchAfter = 0,
    expireAfter = 300_000,
    onSuccess,
    onError,
    onSettled,
  } = options;

  const stateKey = buildKey(name, "state");
  const keyKey = buildKey(name, "key");
  const triggerKey = buildKey(name, "trigger"); // "initial" | "next" | "prev" | timestamp
  const reqInitial = reqType(name, "INITIAL");
  const reqNext = reqType(name, "NEXT");
  const reqPrev = reqType(name, "PREV");

  const retryPolicy =
    typeof retry === "number"
      ? { attempts: retry, backoff: "exponential" as const }
      : retry;

  /** Build the derivation from internal state. */
  function buildState(
    facts: Record<string, unknown>,
  ): InfiniteResourceState<TData, TError> {
    const trigger = facts[triggerKey] as string;

    // Cache expired – return idle state
    if (trigger === "expired") {
      return createIdleInfiniteState<TData, TError>();
    }

    const state = facts[stateKey] as
      | InfiniteResourceState<TData, TError>
      | undefined;
    if (!state) {
      return createIdleInfiniteState<TData, TError>();
    }

    return state;
  }

  /** Check if initial fetch should fire. */
  function shouldFetchInitial(facts: Record<string, unknown>): boolean {
    const currentKey = keyFn(facts);
    if (currentKey === null) {
      return false;
    }
    if (enabled && !enabled(facts)) {
      return false;
    }
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

    const prevKey = facts[keyKey] as string | null;
    const serializedKey = serializeKey(currentKey);

    // Key changed → reset and refetch
    if (prevKey !== serializedKey) {
      return true;
    }

    const state = facts[stateKey] as
      | InfiniteResourceState<TData, TError>
      | undefined;

    // No data yet
    if (!state || state.pages.length === 0) {
      return true;
    }

    // Manual trigger for refetch
    const trigger = facts[triggerKey] as string;
    if (trigger === "initial") {
      return true;
    }

    // Staleness
    if (refetchAfter > 0 && state.dataUpdatedAt !== null) {
      if (Date.now() - state.dataUpdatedAt >= refetchAfter) {
        return true;
      }
    }

    return false;
  }

  /** Check if next page fetch should fire. */
  function shouldFetchNext(facts: Record<string, unknown>): boolean {
    const trigger = facts[triggerKey] as string;
    if (trigger !== "next") {
      return false;
    }

    const state = facts[stateKey] as
      | InfiniteResourceState<TData, TError>
      | undefined;

    return state?.hasNextPage === true && !state.isFetchingNextPage;
  }

  /** Check if previous page fetch should fire. */
  function shouldFetchPrev(facts: Record<string, unknown>): boolean {
    const trigger = facts[triggerKey] as string;
    if (trigger !== "prev") {
      return false;
    }

    const state = facts[stateKey] as
      | InfiniteResourceState<TData, TError>
      | undefined;

    return state?.hasPreviousPage === true && !state.isFetchingPreviousPage;
  }

  return {
    name,

    schema: {
      facts: {
        [stateKey]: { _type: null as unknown },
        [keyKey]: { _type: "" as unknown },
        [triggerKey]: { _type: "" as unknown },
      },
      derivations: {
        [name]: { _type: null as unknown },
      },
    },

    requirements: {
      [reqInitial]: {},
      [reqNext]: {},
      [reqPrev]: {},
    },

    init: (facts: Record<string, unknown>) => {
      facts[stateKey] = createIdleInfiniteState<TData, TError>();
      facts[keyKey] = null;
      facts[triggerKey] = "";
    },

    derive: {
      [name]: buildState,
    },

    constraints: {
      [`${PREFIX}${name}_initial`]: {
        when: shouldFetchInitial,
        require: (facts: Record<string, unknown>) => {
          const currentKey = keyFn(facts);

          return {
            type: reqInitial,
            key: currentKey ? serializeKey(currentKey) : "",
            params: currentKey,
          };
        },
        priority: 50,
      },
      [`${PREFIX}${name}_next`]: {
        when: shouldFetchNext,
        require: () => ({ type: reqNext }),
        priority: 40,
      },
      ...(getPreviousPageParam
        ? {
            [`${PREFIX}${name}_prev`]: {
              when: shouldFetchPrev,
              require: () => ({ type: reqPrev }),
              priority: 40,
            },
          }
        : {}),
    },

    resolvers: {
      // Initial fetch (reset pages)
      [`${PREFIX}${name}_initial_resolve`]: {
        requirement: reqInitial,
        key: (req: Record<string, unknown>) => `${reqInitial}:${req.key}`,
        retry: retryPolicy,
        resolve: async (
          req: Record<string, unknown>,
          context: { facts: Record<string, unknown>; signal: AbortSignal },
        ) => {
          const { facts, signal } = context;
          const params = req.params as TKey;
          facts[keyKey] = req.key;
          facts[triggerKey] = "";

          const prevState = facts[stateKey] as InfiniteResourceState<
            TData,
            TError
          >;
          facts[stateKey] = { ...prevState, isFetching: true };

          try {
            const page = await fetcher(
              { ...params, pageParam: initialPageParam } as TKey & {
                pageParam: TPageParam;
              },
              signal,
            );
            const pages = [page];
            const pageParams = [initialPageParam];
            const nextParam = getNextPageParam(page, pages);
            const prevParam = getPreviousPageParam?.(page, pages) ?? null;

            facts[stateKey] = {
              data: pages,
              error: null,
              status: "success",
              isPending: false,
              isFetching: false,
              isStale: false,
              isSuccess: true,
              isError: false,
              isPreviousData: false,
              dataUpdatedAt: Date.now(),
              failureCount: 0,
              failureReason: null,
              pages,
              pageParams,
              hasNextPage: nextParam !== null,
              hasPreviousPage: prevParam !== null,
              isFetchingNextPage: false,
              isFetchingPreviousPage: false,
            } satisfies InfiniteResourceState<TData, TError>;

            onSuccess?.(pages);
            onSettled?.(pages, null);
          } catch (error) {
            if (signal.aborted) {
              return;
            }
            const typedError = error as TError;
            const currentState = facts[stateKey] as InfiniteResourceState<
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
              failureCount: currentState.failureCount + 1,
              failureReason: typedError,
            };
            onError?.(typedError);
            onSettled?.(undefined, typedError);
          }
        },
      },

      // Next page fetch (append)
      [`${PREFIX}${name}_next_resolve`]: {
        requirement: reqNext,
        retry: retryPolicy,
        resolve: async (
          _req: Record<string, unknown>,
          context: { facts: Record<string, unknown>; signal: AbortSignal },
        ) => {
          const { facts, signal } = context;
          facts[triggerKey] = "";

          const state = facts[stateKey] as InfiniteResourceState<TData, TError>;
          if (!state || state.pages.length === 0) {
            return;
          }

          const lastPage = state.pages[state.pages.length - 1]!;
          const nextParam = getNextPageParam(lastPage, state.pages);
          if (nextParam === null) {
            return;
          }

          facts[stateKey] = { ...state, isFetchingNextPage: true };

          try {
            const currentKey = keyFn(facts);
            if (!currentKey) {
              return;
            }

            const page = await fetcher(
              { ...currentKey, pageParam: nextParam } as TKey & {
                pageParam: TPageParam;
              },
              signal,
            );

            const currentState = facts[stateKey] as InfiniteResourceState<
              TData,
              TError
            >;
            let pages = [...currentState.pages, page];
            let pageParams = [...currentState.pageParams, nextParam];

            // Enforce maxPages
            if (maxPages && pages.length > maxPages) {
              pages = pages.slice(-maxPages);
              pageParams = pageParams.slice(-maxPages);
            }

            const newNextParam = getNextPageParam(page, pages);
            const newPrevParam =
              getPreviousPageParam?.(pages[0]!, pages) ?? null;

            facts[stateKey] = {
              ...currentState,
              data: pages,
              pages,
              pageParams,
              hasNextPage: newNextParam !== null,
              hasPreviousPage: newPrevParam !== null,
              isFetchingNextPage: false,
              dataUpdatedAt: Date.now(),
            };

            onSuccess?.(pages);
            onSettled?.(pages, null);
          } catch (error) {
            if (signal.aborted) {
              return;
            }
            const typedError = error as TError;
            const currentState = facts[stateKey] as InfiniteResourceState<
              TData,
              TError
            >;
            facts[stateKey] = {
              ...currentState,
              isFetchingNextPage: false,
              failureCount: currentState.failureCount + 1,
              failureReason: typedError,
            };

            onError?.(typedError);
            onSettled?.(undefined, typedError);
          }
        },
      },

      // Previous page fetch (prepend) — only if getPreviousPageParam provided
      ...(getPreviousPageParam
        ? {
            [`${PREFIX}${name}_prev_resolve`]: {
              requirement: reqPrev,
              retry: retryPolicy,
              resolve: async (
                _req: Record<string, unknown>,
                context: {
                  facts: Record<string, unknown>;
                  signal: AbortSignal;
                },
              ) => {
                const { facts, signal } = context;
                facts[triggerKey] = "";

                const state = facts[stateKey] as InfiniteResourceState<
                  TData,
                  TError
                >;
                if (!state || state.pages.length === 0) {
                  return;
                }

                const firstPage = state.pages[0]!;
                const prevParam = getPreviousPageParam(firstPage, state.pages);
                if (prevParam === null) {
                  return;
                }

                facts[stateKey] = { ...state, isFetchingPreviousPage: true };

                try {
                  const currentKey = keyFn(facts);
                  if (!currentKey) {
                    return;
                  }

                  const page = await fetcher(
                    { ...currentKey, pageParam: prevParam } as TKey & {
                      pageParam: TPageParam;
                    },
                    signal,
                  );

                  const currentState = facts[stateKey] as InfiniteResourceState<
                    TData,
                    TError
                  >;
                  let pages = [page, ...currentState.pages];
                  let pageParams = [prevParam, ...currentState.pageParams];

                  if (maxPages && pages.length > maxPages) {
                    pages = pages.slice(0, maxPages);
                    pageParams = pageParams.slice(0, maxPages);
                  }

                  const newPrevParam = getPreviousPageParam(pages[0]!, pages);

                  facts[stateKey] = {
                    ...currentState,
                    data: pages,
                    pages,
                    pageParams,
                    hasPreviousPage: newPrevParam !== null,
                    isFetchingPreviousPage: false,
                    dataUpdatedAt: Date.now(),
                  };

                  onSuccess?.(pages);
                  onSettled?.(pages, null);
                } catch (error) {
                  if (signal.aborted) {
                    return;
                  }
                  const typedError = error as TError;
                  const currentState = facts[stateKey] as InfiniteResourceState<
                    TData,
                    TError
                  >;
                  facts[stateKey] = {
                    ...currentState,
                    isFetchingPreviousPage: false,
                    failureCount: currentState.failureCount + 1,
                    failureReason: typedError,
                  };

                  onError?.(typedError);
                  onSettled?.(undefined, typedError);
                }
              },
            },
          }
        : {}),
    },

    effects: {
      // Cache expiration (garbage collection)
      ...(expireAfter > 0 && expireAfter !== Number.POSITIVE_INFINITY
        ? {
            [`${PREFIX}${name}_gc`]: {
              run: (facts: Record<string, unknown>) => {
                const state = facts[stateKey] as
                  | InfiniteResourceState<TData, TError>
                  | undefined;
                if (
                  !state ||
                  state.status !== "success" ||
                  !state.dataUpdatedAt
                ) {
                  return;
                }

                const checkInterval = Math.min(expireAfter, 5000);
                const interval = setInterval(() => {
                  const currentKeyVal = keyFn(facts);
                  if (currentKeyVal !== null) {
                    return;
                  }

                  const currentState = facts[stateKey] as
                    | InfiniteResourceState<TData, TError>
                    | undefined;
                  if (
                    currentState?.dataUpdatedAt &&
                    Date.now() - currentState.dataUpdatedAt >= expireAfter
                  ) {
                    facts[triggerKey] = "expired";
                    facts[keyKey] = null;
                    clearInterval(interval);
                  }
                }, checkInterval);

                return () => clearInterval(interval);
              },
            },
          }
        : {}),
    },

    // --- Imperative handles ---

    fetchNextPage: (facts: Record<string, unknown>) => {
      facts[triggerKey] = "next";
    },

    fetchPreviousPage: (facts: Record<string, unknown>) => {
      facts[triggerKey] = "prev";
    },

    refetch: (facts: Record<string, unknown>) => {
      facts[triggerKey] = "initial";
    },
  };
}
