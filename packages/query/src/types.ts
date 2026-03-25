/**
 * Types for Directive's declarative data fetching system.
 *
 * createQuery generates constraint/resolver/effect fragments that merge into
 * a module via withQueries. Cache is stored as facts (serializable,
 * time-travel-compatible). Status is a derivation.
 *
 * @packageDocumentation
 */

import type { RetryPolicy } from "@directive-run/core";

// ============================================================================
// Query Status
// ============================================================================

/** Query lifecycle status. Matches TanStack Query v5 conventions. */
export type QueryStatus = "pending" | "error" | "success";

// ============================================================================
// ResourceState
// ============================================================================

/**
 * The reactive state of a query, exposed as a derivation.
 *
 * Consumed via `useDerived(system, "queryName")` in any framework adapter.
 * Serializable for time-travel and SSR hydration.
 *
 * @typeParam T - The data type returned by the fetcher (after transform)
 * @typeParam E - The error type (default: Error)
 */
export interface ResourceState<T, E = Error> {
  /** The resolved data, or null if not yet fetched / errored. */
  data: T | null;
  /** Error from the last failed fetch, or null. */
  error: E | null;
  /** Current lifecycle status. */
  status: QueryStatus;
  /** True during the first fetch when no cached data exists. */
  isPending: boolean;
  /** True during any fetch (including background refetches with cached data). */
  isFetching: boolean;
  /** True when cached data is older than `refetchAfter`. */
  isStale: boolean;
  /** True when status is "success". */
  isSuccess: boolean;
  /** True when status is "error". */
  isError: boolean;
  /** True when showing previous key's data during a key transition. */
  isPreviousData: boolean;
  /** Timestamp (ms) when data was last successfully fetched. */
  dataUpdatedAt: number | null;
  /** Number of consecutive fetch failures. */
  failureCount: number;
  /** Error from the most recent failure (even if a retry succeeded after). */
  failureReason: E | null;
}

/** Create a default idle ResourceState. */
export function createIdleResourceState<T, E = Error>(): ResourceState<T, E> {
  return {
    data: null,
    error: null,
    status: "pending",
    isPending: true,
    isFetching: false,
    isStale: false,
    isSuccess: false,
    isError: false,
    isPreviousData: false,
    dataUpdatedAt: null,
    failureCount: 0,
    failureReason: null,
  };
}

// ============================================================================
// QueryOptions
// ============================================================================

/**
 * Configuration for a single query.
 *
 * The generic chain flows: `key()` returns `TKey` → `fetcher` receives `TKey`
 * → returns `Promise<TRaw>` → `transform` maps `TRaw` → `TData` →
 * `ResourceState<TData>` derivation → `useDerived(system, name)`.
 *
 * @typeParam TData - The cached/consumed data type (after transform)
 * @typeParam TRaw - The raw fetcher response type (before transform). Defaults to TData.
 * @typeParam TError - The error type. Defaults to Error.
 * @typeParam TKey - The key/params object type, inferred from the `key` function.
 */
export interface QueryOptions<
  TData,
  TRaw = TData,
  TError = Error,
  TKey extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Unique query name. Becomes the derivation key consumers read via `useDerived`. */
  name: string;

  /**
   * Derive key/params from facts. Return `null` to skip (disable the query).
   * The returned object IS the typed params passed to `fetcher`.
   */
  key: (facts: Record<string, unknown>) => TKey | null;

  /**
   * Fetch data. Receives typed params from `key()` + an AbortSignal for cancellation.
   * Throw on failure — the error is caught and stored in `ResourceState.error`.
   */
  fetcher: (params: TKey, signal: AbortSignal) => Promise<TRaw>;

  /**
   * Transform raw fetcher response before caching.
   * Runs once per successful fetch. The result is what gets stored as a fact.
   */
  transform?: (raw: TRaw) => TData;

  // --- Caching ---

  /**
   * Duration (ms) after which fetched data is considered stale and eligible
   * for background refetch on the next trigger (focus, mount, interval).
   * @default 0 (always stale — refetches on every trigger)
   */
  refetchAfter?: number;

  /**
   * Duration (ms) after which an unused cache entry is garbage collected.
   * "Unused" means no component/derivation is reading this query.
   * @default 300_000 (5 minutes)
   */
  expireAfter?: number;

  // --- Conditions ---

  /**
   * Additional condition for when this query should be active.
   * The query fires only when BOTH `enabled` returns `true` AND `key` returns non-null.
   * @default () => true
   */
  enabled?: (facts: Record<string, unknown>) => boolean;

  /**
   * Wait for these queries to reach "success" status before this query fires.
   * Sugar for `enabled: (facts) => facts.$dep?.status === "success"`.
   */
  dependsOn?: string[];

  // --- Retry ---

  /**
   * Retry policy for failed fetches. Accepts a full RetryPolicy object
   * or a number (shorthand for `{ attempts: n, backoff: "exponential" }`).
   */
  retry?: RetryPolicy | number;

  /**
   * Custom retry delay function. Overrides the RetryPolicy's backoff calculation.
   * Useful for respecting `Retry-After` headers.
   */
  retryDelay?: (attempt: number, error: TError) => number;

  // --- Refetch Triggers ---

  /**
   * Refetch when the browser window regains focus.
   * `true` = refetch only when stale. `"always"` = refetch even when fresh.
   * @default true
   */
  refetchOnWindowFocus?: boolean | "always";

  /**
   * Refetch when the browser comes back online.
   * @default true
   */
  refetchOnReconnect?: boolean | "always";

  /**
   * Refetch when the query mounts (constraint first evaluates).
   * @default true
   */
  refetchOnMount?: boolean | "always";

  /**
   * Polling interval (ms). Set to `false` or `0` to disable.
   * Can be a function that returns a dynamic interval based on current data.
   */
  refetchInterval?: number | false | ((data: TData | undefined) => number | false);

  // --- Data ---

  /**
   * Placeholder data shown immediately while the real fetch runs.
   * NOT persisted to cache. The query still shows as "pending".
   * Can be a function that receives previous data (useful for key transitions).
   */
  placeholderData?: TData | ((previousData?: TData) => TData | undefined);

  /**
   * Initial data to pre-populate the cache. Treated as a real cache entry.
   * Use with `initialDataUpdatedAt` for SSR hydration.
   */
  initialData?: TData;

  /**
   * Timestamp (ms) when `initialData` was fetched. Used for staleness calculation
   * during SSR hydration. Without this, initial data is always considered fresh.
   */
  initialDataUpdatedAt?: number;

  // --- Tags ---

  /**
   * Cache invalidation tags. When a mutation invalidates a tag, all queries
   * with that tag refetch. Supports parameterized tags for granular invalidation.
   */
  tags?:
    | string[]
    | ((data: TData) => (string | { type: string; id?: string | number })[]);

  // --- Callbacks ---

  /** Called when the fetcher resolves successfully. */
  onSuccess?: (data: TData) => void;
  /** Called when the fetcher throws. */
  onError?: (error: TError) => void;
  /** Called when the fetcher settles (success or error). */
  onSettled?: (data: TData | undefined, error: TError | null) => void;

  // --- Advanced ---

  /**
   * Preserve object references when refetched data is deeply equal to cached data.
   * Prevents unnecessary re-renders in React/Vue/Svelte.
   * @default true
   */
  structuralSharing?: boolean;

  /**
   * Network mode controlling behavior when offline.
   * - `"online"` — only fetch when online (default)
   * - `"always"` — fetch regardless of network status
   * - `"offlineFirst"` — serve cache first, fetch when online
   * @default "online"
   */
  networkMode?: "online" | "always" | "offlineFirst";

  /**
   * Throw errors to the nearest React error boundary instead of
   * storing them in `ResourceState.error`.
   * @default false
   */
  throwOnError?: boolean;
}

// ============================================================================
// MutationOptions
// ============================================================================

/**
 * Configuration for a mutation (write operation with cache invalidation).
 *
 * @typeParam TData - The mutation response type
 * @typeParam TVariables - The input variables type
 * @typeParam TError - The error type
 * @typeParam TContext - The context type returned by `onMutate` for rollback
 */
export interface MutationOptions<
  TData,
  TVariables,
  TError = Error,
  TContext = unknown,
> {
  /** Unique mutation name. */
  name: string;

  /** Execute the mutation. Throw on failure. */
  mutator: (variables: TVariables, signal: AbortSignal) => Promise<TData>;

  /** Retry policy for failed mutations. */
  retry?: RetryPolicy | number;

  /**
   * Tags to invalidate after successful mutation.
   * All queries with matching tags will refetch.
   */
  invalidateTags?: (string | { type: string; id?: string | number })[];

  // --- Lifecycle callbacks (match TanStack v5) ---

  /**
   * Called before the mutator runs. Return a context object for rollback.
   * Use for optimistic updates: update cache, return previous data as context.
   */
  onMutate?: (variables: TVariables) => Promise<TContext> | TContext;

  /** Called on successful mutation. */
  onSuccess?: (
    data: TData,
    variables: TVariables,
    context: TContext,
  ) => void;

  /** Called on failed mutation. Use `context` from `onMutate` for rollback. */
  onError?: (
    error: TError,
    variables: TVariables,
    context: TContext | undefined,
  ) => void;

  /** Called when the mutation settles (success or error). */
  onSettled?: (
    data: TData | undefined,
    error: TError | null,
    variables: TVariables,
    context: TContext | undefined,
  ) => void;
}

// ============================================================================
// MutationState
// ============================================================================

/** Mutation lifecycle status. */
export type MutationStatus = "idle" | "pending" | "success" | "error";

/**
 * The reactive state of a mutation, exposed as a derivation.
 *
 * @typeParam TData - The mutation response type
 * @typeParam TError - The error type
 */
export interface MutationState<TData, TError = Error> {
  /** Current lifecycle status. */
  status: MutationStatus;
  /** True while the mutator is in-flight. */
  isPending: boolean;
  /** True after successful mutation. */
  isSuccess: boolean;
  /** True after failed mutation. */
  isError: boolean;
  /** True before the first mutation call. */
  isIdle: boolean;
  /** Response data from the last successful mutation. */
  data: TData | null;
  /** Error from the last failed mutation. */
  error: TError | null;
  /** Variables from the last mutation call. */
  variables: unknown;
}

// ============================================================================
// QueryDefinition (return type of createQuery)
// ============================================================================

/**
 * A query definition — portable value containing constraint/resolver/effect
 * fragments ready to merge into a module via `withQueries`.
 *
 * @typeParam TData - The cached/consumed data type
 */
export interface QueryDefinition<TData> {
  /** The query name (matches the derivation key). */
  readonly name: string;

  /** Schema fragments to merge into a module. */
  readonly schema: {
    readonly facts: Record<string, unknown>;
    readonly derivations: Record<string, unknown>;
  };

  /** Requirement type entries to merge. */
  readonly requirements: Record<string, Record<string, unknown>>;

  /** Init function fragment — sets up default ResourceState. */
  readonly init: (facts: Record<string, unknown>) => void;

  /** Derivation fragments to merge. */
  readonly derive: Record<
    string,
    (facts: Record<string, unknown>) => unknown
  >;

  /** Constraint fragments to merge. */
  readonly constraints: Record<string, unknown>;

  /** Resolver fragments to merge. */
  readonly resolvers: Record<string, unknown>;

  /** Effect fragments to merge (focus, reconnect, polling). */
  readonly effects: Record<string, unknown>;

  // --- Imperative handles ---

  /** Trigger a manual refetch for this query. */
  refetch: (facts: Record<string, unknown>) => void;

  /** Invalidate this query's cache, triggering refetch on next evaluation. */
  invalidate: (facts: Record<string, unknown>) => void;

  /** Cancel any in-flight fetch for this query. */
  cancel: (facts: Record<string, unknown>) => void;

  /** Set cached data directly (for optimistic updates). */
  setData: (facts: Record<string, unknown>, data: TData) => void;

  /** Prefetch data for a specific key (warms cache before the query is active). */
  prefetch: (
    facts: Record<string, unknown>,
    params: Record<string, unknown>,
  ) => void;
}

// ============================================================================
// MutationDefinition (return type of createMutation)
// ============================================================================

/**
 * A mutation definition — portable value containing resolver fragments.
 *
 * @typeParam TData - The mutation response type
 * @typeParam TVariables - The input variables type
 */
export interface MutationDefinition<TData, TVariables> {
  /** The mutation name. */
  readonly name: string;

  /** Schema fragments to merge. */
  readonly schema: {
    readonly facts: Record<string, unknown>;
    readonly derivations: Record<string, unknown>;
  };

  /** Requirement type entries to merge. */
  readonly requirements: Record<string, Record<string, unknown>>;

  /** Init function fragment. */
  readonly init: (facts: Record<string, unknown>) => void;

  /** Derivation fragments to merge. */
  readonly derive: Record<
    string,
    (facts: Record<string, unknown>) => unknown
  >;

  /** Constraint fragments (mutation trigger). */
  readonly constraints: Record<string, unknown>;

  /** Resolver fragments (mutation execution). */
  readonly resolvers: Record<string, unknown>;

  /** Effect fragments. */
  readonly effects: Record<string, unknown>;

  // --- Imperative handles ---

  /** Execute the mutation with the given variables. */
  mutate: (facts: Record<string, unknown>, variables: TVariables) => void;

  /** Execute and return a promise that resolves with the result. */
  mutateAsync: (
    facts: Record<string, unknown>,
    variables: TVariables,
  ) => Promise<TData>;

  /** Reset the mutation state back to idle. */
  reset: (facts: Record<string, unknown>) => void;
}
