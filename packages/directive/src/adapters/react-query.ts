/**
 * React Query Adapter - Constraint-driven prefetching and cache coordination
 *
 * Philosophy: "Use Directive WITH React Query"
 * - React Query handles HOW to fetch data + caching
 * - Directive decides WHEN to fetch with constraint-driven prefetching
 *
 * @example
 * ```typescript
 * import { QueryClient } from '@tanstack/react-query'
 * import { createQueryBridge } from 'directive/react-query'
 *
 * const queryClient = new QueryClient()
 *
 * const bridge = createQueryBridge(queryClient, {
 *   constraints: {
 *     prefetchUser: {
 *       when: (facts) => facts.profileOpen && !facts.userLoaded,
 *       require: { type: 'PREFETCH', queryKey: ['user', facts.userId] }
 *     }
 *   },
 *   resolvers: {
 *     prefetch: {
 *       handles: (req) => req.type === 'PREFETCH',
 *       resolve: (req) => queryClient.prefetchQuery({
 *         queryKey: req.queryKey,
 *         queryFn: () => api.fetch(req.queryKey)
 *       })
 *     }
 *   }
 * })
 * ```
 */

import type {
  Requirement,
  Schema,
  Plugin,
  System,
  Facts,
} from "../core/types.js";
import { createModule } from "../core/module.js";
import { createSystem } from "../core/system.js";
import { t } from "../core/facts.js";

// ============================================================================
// Types (React Query compatible, without direct dependency)
// ============================================================================

/** Simplified QueryClient interface for type compatibility */
export interface QueryClientLike {
  getQueryCache(): QueryCacheLike;
  prefetchQuery(options: PrefetchOptions): Promise<void>;
  fetchQuery<T>(options: FetchOptions): Promise<T>;
  invalidateQueries(filters?: InvalidateFilters): Promise<void>;
  setQueryData<T>(queryKey: QueryKey, data: T): void;
  getQueryData<T>(queryKey: QueryKey): T | undefined;
  getQueryState(queryKey: QueryKey): QueryStateLike | undefined;
  cancelQueries(filters?: InvalidateFilters): Promise<void>;
}

interface QueryCacheLike {
  subscribe(callback: (event: QueryCacheEvent) => void): () => void;
  findAll(filters?: { queryKey?: QueryKey }): Array<QueryLike>;
}

interface QueryLike {
  queryKey: QueryKey;
  state: QueryStateLike;
}

interface QueryStateLike {
  status: "pending" | "error" | "success";
  fetchStatus: "fetching" | "paused" | "idle";
  data?: unknown;
  error?: Error | null;
  dataUpdatedAt?: number;
}

interface QueryCacheEvent {
  type: "added" | "removed" | "updated";
  query: QueryLike;
}

type QueryKey = readonly unknown[];

interface PrefetchOptions {
  queryKey: QueryKey;
  queryFn?: () => Promise<unknown>;
  staleTime?: number;
}

interface FetchOptions extends PrefetchOptions {
  throwOnError?: boolean;
}

interface InvalidateFilters {
  queryKey?: QueryKey;
  exact?: boolean;
  predicate?: (query: QueryLike) => boolean;
}

// ============================================================================
// Bridge Types
// ============================================================================


/** Query state information stored in facts */
export interface QueryStateInfo {
  status: "pending" | "error" | "success";
  fetchStatus: "fetching" | "paused" | "idle";
  hasData: boolean;
  dataUpdatedAt: number | undefined;
  error: string | null;
}

/** Prefetch requirement */
export interface PrefetchRequirement extends Requirement {
  type: "PREFETCH";
  queryKey: QueryKey;
  queryFn?: () => Promise<unknown>;
  staleTime?: number;
}

/** Invalidate requirement */
export interface InvalidateRequirement extends Requirement {
  type: "INVALIDATE";
  queryKey?: QueryKey;
  exact?: boolean;
}

/** Constraint for query bridge */
export interface QueryConstraint<F extends Record<string, unknown>> {
  when: (facts: F & { queryStates: Record<string, QueryStateInfo> }) => boolean | Promise<boolean>;
  require:
    | Requirement
    | ((facts: F & { queryStates: Record<string, QueryStateInfo> }) => Requirement);
  priority?: number;
}

/** Resolver context for query bridge */
export interface QueryResolverContext<F extends Record<string, unknown>> {
  facts: Facts<Schema> & F & { queryStates: Record<string, QueryStateInfo> };
  queryClient: QueryClientLike;
  signal: AbortSignal;
}

/** Resolver for query bridge */
export interface QueryResolver<F extends Record<string, unknown>, R extends Requirement = Requirement> {
  handles: (req: Requirement) => req is R;
  key?: (req: R) => string;
  resolve: (req: R, ctx: QueryResolverContext<F>) => void | Promise<void>;
}

/** Options for creating a query bridge */
export interface QueryBridgeOptions<F extends Record<string, unknown>> {
  /** Application-level facts schema */
  factsSchema?: Record<string, { _type: unknown; _validators: [] }>;
  /** Initialize application facts */
  init?: (facts: F & { queryStates: Record<string, QueryStateInfo> }) => void;
  /** Constraints that produce requirements based on facts */
  constraints?: Record<string, QueryConstraint<F>>;
  /** Resolvers that fulfill requirements */
  resolvers?: Record<string, QueryResolver<F, Requirement>>;
  /** Plugins to add to the Directive system */
  plugins?: Array<Plugin<Schema>>;
  /** Enable time-travel debugging */
  debug?: boolean;
  /** Auto-start the system (default: true) */
  autoStart?: boolean;
  /** Sync interval for cache state (ms, default: 100) */
  syncIntervalMs?: number;
}

/** Query bridge instance */
export interface QueryBridge<F extends Record<string, unknown>> {
  /** The underlying Directive system */
  system: System<Schema>;
  /** Application-level facts */
  facts: F & { queryStates: Record<string, QueryStateInfo> };
  /** Start syncing cache events to facts */
  startSync(): void;
  /** Stop syncing cache events */
  stopSync(): void;
  /** Wait for system to settle */
  settle(): Promise<void>;
  /** Destroy the bridge */
  destroy(): void;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create a bridge between React Query and Directive.
 *
 * @example
 * ```typescript
 * const bridge = createQueryBridge(queryClient, {
 *   factsSchema: {
 *     profileOpen: { _type: false, _validators: [] },
 *     userId: { _type: null as string | null, _validators: [] },
 *   },
 *   init: (facts) => {
 *     facts.profileOpen = false;
 *     facts.userId = null;
 *   },
 *   constraints: {
 *     prefetchUserProfile: {
 *       when: (facts) => facts.profileOpen && facts.userId !== null,
 *       require: (facts) => ({
 *         type: 'PREFETCH',
 *         queryKey: ['user', facts.userId],
 *       }),
 *     },
 *   },
 * });
 * ```
 */
export function createQueryBridge<F extends Record<string, unknown> = Record<string, never>>(
  queryClient: QueryClientLike,
  options: QueryBridgeOptions<F> = {}
): QueryBridge<F> {
  const {
    factsSchema = {},
    init,
    constraints = {},
    resolvers = {},
    plugins = [],
    debug = false,
    autoStart = true,
    syncIntervalMs = 100,
  } = options;

  // Build the combined schema
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schema: any = {
    queryStates: t.object<Record<string, QueryStateInfo>>(),
    ...factsSchema,
  };

  // Convert constraints to Directive format
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const directiveConstraints: Record<string, any> = {};
  for (const [id, constraint] of Object.entries(constraints)) {
    directiveConstraints[id] = {
      priority: constraint.priority ?? 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      when: (facts: any) => constraint.when(facts as F & { queryStates: Record<string, QueryStateInfo> }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      require: (facts: any) =>
        typeof constraint.require === "function"
          ? constraint.require(facts as F & { queryStates: Record<string, QueryStateInfo> })
          : constraint.require,
    };
  }

  // Add built-in prefetch and invalidate resolvers
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const directiveResolvers: Record<string, any> = {
    // Built-in prefetch resolver
    __prefetch: {
      handles: (req: Requirement): req is PrefetchRequirement => req.type === "PREFETCH",
      key: (req: PrefetchRequirement) => `prefetch:${stringifyQueryKey(req.queryKey)}`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
      resolve: async (req: PrefetchRequirement, _ctx: any) => {
        await queryClient.prefetchQuery({
          queryKey: req.queryKey as QueryKey,
          queryFn: req.queryFn as (() => Promise<unknown>) | undefined,
          staleTime: req.staleTime as number | undefined,
        });
      },
    },
    // Built-in invalidate resolver
    __invalidate: {
      handles: (req: Requirement): req is InvalidateRequirement => req.type === "INVALIDATE",
      key: (req: InvalidateRequirement) => `invalidate:${req.queryKey ? stringifyQueryKey(req.queryKey as QueryKey) : "all"}`,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      resolve: async (req: InvalidateRequirement) => {
        await queryClient.invalidateQueries({
          queryKey: req.queryKey as QueryKey | undefined,
          exact: req.exact as boolean | undefined,
        });
      },
    },
  };

  // Add user-defined resolvers
  for (const [id, resolver] of Object.entries(resolvers)) {
    directiveResolvers[id] = {
      handles: resolver.handles,
      key: resolver.key,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolve: async (req: Requirement, ctx: any) => {
        const queryCtx: QueryResolverContext<F> = {
          facts: ctx.facts as unknown as Facts<Schema> & F & { queryStates: Record<string, QueryStateInfo> },
          queryClient,
          signal: ctx.signal,
        };
        await resolver.resolve(req, queryCtx);
      },
    };
  }

  // Create the Directive module
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const queryBridgeModule = createModule("react-query-bridge", {
    schema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    init: (facts: any) => {
      facts.queryStates = {};
      init?.(facts as unknown as F & { queryStates: Record<string, QueryStateInfo> });
    },
    constraints: directiveConstraints as unknown as Parameters<typeof createModule>[1]["constraints"],
    resolvers: directiveResolvers as unknown as Parameters<typeof createModule>[1]["resolvers"],
  });

  // Create the Directive system
  // Use type assertion to work around Schema generic variance issues
  const system = createSystem({
    modules: [queryBridgeModule as unknown as Parameters<typeof createSystem>[0]["modules"][0]],
    plugins: plugins as unknown as Array<Plugin<Schema>>,
    debug: debug ? { timeTravel: true } : undefined,
  });

  // Cache sync functionality
  let syncUnsubscribe: (() => void) | null = null;
  let syncInterval: ReturnType<typeof setInterval> | null = null;

  const syncCacheToFacts = () => {
    const queries = queryClient.getQueryCache().findAll();
    const newStates: Record<string, QueryStateInfo> = {};

    for (const query of queries) {
      const key = stringifyQueryKey(query.queryKey);
      newStates[key] = {
        status: query.state.status,
        fetchStatus: query.state.fetchStatus,
        hasData: query.state.data !== undefined,
        dataUpdatedAt: query.state.dataUpdatedAt,
        error: query.state.error?.message ?? null,
      };
    }

    // Only update if changed
    const currentStates = system.facts.queryStates as Record<string, QueryStateInfo>;
    if (JSON.stringify(currentStates) !== JSON.stringify(newStates)) {
      system.facts.queryStates = newStates;
    }
  };

  const startSync = () => {
    if (syncUnsubscribe) return;

    // Subscribe to cache events
    syncUnsubscribe = queryClient.getQueryCache().subscribe((event) => {
      const key = stringifyQueryKey(event.query.queryKey);
      const states = { ...(system.facts.queryStates as Record<string, QueryStateInfo>) };

      if (event.type === "removed") {
        delete states[key];
      } else {
        states[key] = {
          status: event.query.state.status,
          fetchStatus: event.query.state.fetchStatus,
          hasData: event.query.state.data !== undefined,
          dataUpdatedAt: event.query.state.dataUpdatedAt,
          error: event.query.state.error?.message ?? null,
        };
      }

      system.facts.queryStates = states;
    });

    // Also poll periodically for any missed updates
    syncInterval = setInterval(syncCacheToFacts, syncIntervalMs);

    // Initial sync
    syncCacheToFacts();
  };

  const stopSync = () => {
    syncUnsubscribe?.();
    syncUnsubscribe = null;
    if (syncInterval) {
      clearInterval(syncInterval);
      syncInterval = null;
    }
  };

  // Auto-start if enabled
  if (autoStart) {
    system.start();
    startSync();
  }

  return {
    system: system as System<Schema>,
    facts: system.facts as unknown as F & { queryStates: Record<string, QueryStateInfo> },
    startSync,
    stopSync,
    settle: () => system.settle(),
    destroy: () => {
      stopSync();
      system.destroy();
    },
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Stringify a query key for use as a facts key.
 */
function stringifyQueryKey(queryKey: QueryKey): string {
  return JSON.stringify(queryKey);
}

/**
 * Check if a query is loading (pending or fetching).
 */
export function isQueryLoading(state: QueryStateInfo | undefined): boolean {
  if (!state) return false;
  return state.status === "pending" || state.fetchStatus === "fetching";
}

/**
 * Check if a query has fresh data (not stale).
 */
export function isQueryFresh(
  state: QueryStateInfo | undefined,
  staleTime: number
): boolean {
  if (!state || !state.hasData || !state.dataUpdatedAt) return false;
  return Date.now() - state.dataUpdatedAt < staleTime;
}

/**
 * Check if a query has an error.
 */
export function isQueryError(state: QueryStateInfo | undefined): boolean {
  return state?.status === "error";
}

/**
 * Create a prefetch requirement.
 */
export function prefetch(
  queryKey: QueryKey,
  options?: { queryFn?: () => Promise<unknown>; staleTime?: number }
): PrefetchRequirement {
  return {
    type: "PREFETCH",
    queryKey,
    ...options,
  };
}

/**
 * Create an invalidate requirement.
 */
export function invalidate(
  queryKey?: QueryKey,
  options?: { exact?: boolean }
): InvalidateRequirement {
  return {
    type: "INVALIDATE",
    queryKey,
    ...options,
  };
}

/**
 * Constraint helper: require prefetch when condition is met.
 *
 * @example
 * ```typescript
 * constraints: {
 *   userProfile: whenThenPrefetch(
 *     (facts) => facts.profileOpen && facts.userId,
 *     (facts) => ['user', facts.userId]
 *   ),
 * }
 * ```
 */
export function whenThenPrefetch<F extends Record<string, unknown>>(
  when: (facts: F & { queryStates: Record<string, QueryStateInfo> }) => boolean,
  queryKey: (facts: F & { queryStates: Record<string, QueryStateInfo> }) => QueryKey,
  options?: { queryFn?: () => Promise<unknown>; staleTime?: number; priority?: number }
): QueryConstraint<F> {
  return {
    when,
    require: (facts) => prefetch(queryKey(facts), options),
    priority: options?.priority,
  };
}

/**
 * Constraint helper: require invalidate when condition is met.
 *
 * @example
 * ```typescript
 * constraints: {
 *   invalidateOnLogout: whenThenInvalidate(
 *     (facts) => facts.justLoggedOut,
 *     () => ['user'] // Invalidate all user queries
 *   ),
 * }
 * ```
 */
export function whenThenInvalidate<F extends Record<string, unknown>>(
  when: (facts: F & { queryStates: Record<string, QueryStateInfo> }) => boolean,
  queryKey?: (facts: F & { queryStates: Record<string, QueryStateInfo> }) => QueryKey,
  options?: { exact?: boolean; priority?: number }
): QueryConstraint<F> {
  return {
    when,
    require: (facts) => invalidate(queryKey?.(facts), options),
    priority: options?.priority,
  };
}

// ============================================================================
// React Hooks (if using with React)
// ============================================================================

// These hooks are provided for convenience but require React to be installed
// They are type-safe wrappers around the bridge functionality

/**
 * Create React hooks for a query bridge.
 * Returns typed hooks that can be used in React components.
 *
 * @example
 * ```typescript
 * const bridge = createQueryBridge(queryClient, { ... });
 * const { useFacts, useQueryState } = createQueryBridgeHooks(bridge);
 *
 * function Component() {
 *   const { profileOpen } = useFacts();
 *   const userState = useQueryState(['user', userId]);
 *   return <div>{userState?.status}</div>;
 * }
 * ```
 */
export function createQueryBridgeHooks<F extends Record<string, unknown>>(
  bridge: QueryBridge<F>
) {
  // Dynamic import check for React
  let React: typeof import("react") | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    React = require("react");
  } catch {
    // React not available
  }

  if (!React) {
    throw new Error(
      "[Directive] createQueryBridgeHooks requires React to be installed"
    );
  }

  const { useSyncExternalStore, useCallback } = React;

  /**
   * Subscribe to all application facts.
   */
  function useFacts(): F & { queryStates: Record<string, QueryStateInfo> } {
    const subscribe = useCallback(
      (onStoreChange: () => void) => {
        return bridge.system.facts.$store.subscribeAll(onStoreChange);
      },
      []
    );

    const getSnapshot = useCallback(() => {
      return bridge.facts;
    }, []);

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  }

  /**
   * Subscribe to a specific query's state.
   */
  function useQueryState(queryKey: QueryKey): QueryStateInfo | undefined {
    const key = stringifyQueryKey(queryKey);

    const subscribe = useCallback(
      (onStoreChange: () => void) => {
        return bridge.system.facts.$store.subscribe(["queryStates"], onStoreChange);
      },
      []
    );

    const getSnapshot = useCallback(() => {
      return (bridge.facts.queryStates as Record<string, QueryStateInfo>)[key];
    }, [key]);

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  }

  return {
    useFacts,
    useQueryState,
  };
}
