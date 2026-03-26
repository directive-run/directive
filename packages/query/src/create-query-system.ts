/**
 * createQuerySystem — One-call setup for query-based Directive systems.
 *
 * Combines inline query/mutation/subscription definitions, module config,
 * and system options into a started system with bound imperative handles.
 *
 * @module
 */

import { createModule, createSystem, t } from "@directive-run/core";
import type {
  ErrorBoundaryConfig,
  HistoryOption,
  ModuleSchema,
  Plugin,
  SingleModuleSystem,
  TraceOption,
} from "@directive-run/core";
import { createInfiniteQuery } from "./create-infinite-query.js";
import { createMutation } from "./create-mutation.js";
import { createQuery } from "./create-query.js";
import { createSubscription } from "./create-subscription.js";
import { explainQuery } from "./explain.js";
import type { QueryOptions } from "./types.js";
import type { MutationOptions } from "./types.js";
import { withQueries } from "./with-queries.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for createQuerySystem.
 *
 * Combines query definitions, module config, and system options in one object.
 * Facts types are inferred from the `facts` initial values.
 */
export interface QuerySystemConfig {
  /** Initial fact values. Types are inferred from the values. */
  facts: Record<string, unknown>;

  /** Init function for additional setup after default values. */
  init?: (facts: Record<string, unknown>) => void;

  /** Query definitions (pull-based data fetching). Key becomes the query name. */
  // biome-ignore lint/suspicious/noExplicitAny: Query options have varying generics
  queries?: Record<string, Omit<QueryOptions<any, any, any, any>, "name">>;

  /** Mutation definitions (write + cache invalidation). Key becomes the mutation name. */
  // biome-ignore lint/suspicious/noExplicitAny: Mutation options have varying generics
  mutations?: Record<
    string,
    Omit<MutationOptions<any, any, any, any>, "name"> & {
      invalidates?: string[];
    }
  >;

  /** Subscription definitions (push-based: WebSocket, SSE, AI streaming). Key becomes the subscription name. */
  subscriptions?: Record<
    string,
    {
      key: (facts: Record<string, unknown>) => Record<string, unknown> | null;
      subscribe: (
        params: Record<string, unknown>,
        callbacks: {
          onData: (data: unknown) => void;
          onError: (error: Error) => void;
          signal: AbortSignal;
        },
      ) => (() => void) | undefined;
      enabled?: (facts: Record<string, unknown>) => boolean;
    }
  >;

  /** Infinite query definitions (paginated data). Key becomes the query name. */
  // biome-ignore lint/suspicious/noExplicitAny: Infinite query options have varying generics
  infiniteQueries?: Record<
    string,
    Omit<Parameters<typeof createInfiniteQuery>[0], "name">
  >;

  // Module config pass-through
  derive?: Record<
    string,
    (
      facts: Record<string, unknown>,
      derived: Record<string, unknown>,
    ) => unknown
  >;
  // biome-ignore lint/suspicious/noExplicitAny: Event handler signatures vary
  events?: Record<string, any>;
  effects?: Record<string, unknown>;
  constraints?: Record<string, unknown>;
  resolvers?: Record<string, unknown>;

  // System config pass-through
  plugins?: Plugin[];
  history?: HistoryOption;
  trace?: TraceOption;
  errorBoundary?: ErrorBoundaryConfig;

  /**
   * Auto-start the system after creation.
   * Set to false for SSR (call system.start() manually).
   * @default true
   */
  autoStart?: boolean;

  /** Initial fact overrides applied before first reconciliation. */
  initialFacts?: Record<string, unknown>;
}

/** Bound query handle — no `facts` parameter needed. */
export interface BoundQueryHandle {
  refetch(): void;
  invalidate(): void;
  cancel(): void;
  setData(data: unknown): void;
}

/** Bound mutation handle — no `facts` parameter needed. */
export interface BoundMutationHandle {
  mutate(variables: unknown): void;
  mutateAsync(variables: unknown): Promise<unknown>;
  reset(): void;
}

/** Bound subscription handle. */
export interface BoundSubscriptionHandle {
  setData(data: unknown): void;
}

/** Bound infinite query handle. */
export interface BoundInfiniteQueryHandle {
  fetchNextPage(): void;
  fetchPreviousPage(): void;
  refetch(): void;
}

// ============================================================================
// createQuerySystem
// ============================================================================

/**
 * Create a query-based Directive system in one call.
 *
 * @param config - Queries, mutations, subscriptions, facts, and system options
 * @returns A started system with bound imperative handles
 *
 * @example
 * ```typescript
 * import { createQuerySystem } from "@directive-run/query";
 *
 * const app = createQuerySystem({
 *   facts: { userId: "" },
 *   queries: {
 *     user: {
 *       key: (f) => f.userId ? { userId: f.userId } : null,
 *       fetcher: async (p, signal) => (await fetch(`/api/users/${p.userId}`, { signal })).json(),
 *     },
 *   },
 * });
 *
 * app.facts.userId = "42";       // query fires automatically
 * app.queries.user.refetch();    // bound handle — no facts param
 * app.explain("user");           // causal chain
 * ```
 */
export function createQuerySystem(config: QuerySystemConfig) {
  const {
    facts: factsInit,
    init: userInit,
    queries: queryConfigs,
    mutations: mutationConfigs,
    subscriptions: subscriptionConfigs,
    infiniteQueries: infiniteQueryConfigs,
    derive,
    events,
    effects,
    constraints,
    resolvers,
    plugins,
    history,
    trace,
    errorBoundary,
    autoStart = true,
    initialFacts,
  } = config;

  // Build schema from facts init values
  const schemaFacts: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(factsInit)) {
    if (typeof value === "string") {
      schemaFacts[key] = t.string();
    } else if (typeof value === "number") {
      schemaFacts[key] = t.number();
    } else if (typeof value === "boolean") {
      schemaFacts[key] = t.boolean();
    } else if (Array.isArray(value)) {
      schemaFacts[key] = t.array();
    } else {
      schemaFacts[key] = t.object();
    }
  }

  // Convert inline configs to definitions
  // biome-ignore lint/suspicious/noExplicitAny: Definition types vary
  const allDefinitions: any[] = [];
  const queryDefs: Record<string, ReturnType<typeof createQuery>> = {};
  const mutationDefs: Record<string, ReturnType<typeof createMutation>> = {};
  const subscriptionDefs: Record<
    string,
    ReturnType<typeof createSubscription>
  > = {};

  if (queryConfigs) {
    for (const [name, opts] of Object.entries(queryConfigs)) {
      const def = createQuery({ ...opts, name } as Parameters<
        typeof createQuery
      >[0]);
      queryDefs[name] = def;
      allDefinitions.push(def);
    }
  }

  if (mutationConfigs) {
    for (const [name, opts] of Object.entries(mutationConfigs)) {
      const { invalidates, ...rest } = opts;
      const def = createMutation({
        ...rest,
        name,
        invalidateTags:
          invalidates ?? (rest as Record<string, unknown>).invalidateTags,
      } as Parameters<typeof createMutation>[0]);
      mutationDefs[name] = def;
      allDefinitions.push(def);
    }
  }

  if (subscriptionConfigs) {
    for (const [name, opts] of Object.entries(subscriptionConfigs)) {
      const def = createSubscription({ ...opts, name } as Parameters<
        typeof createSubscription
      >[0]);
      subscriptionDefs[name] = def;
      allDefinitions.push(def);
    }
  }

  const infiniteQueryDefs: Record<
    string,
    ReturnType<typeof createInfiniteQuery>
  > = {};
  if (infiniteQueryConfigs) {
    for (const [name, opts] of Object.entries(infiniteQueryConfigs)) {
      const def = createInfiniteQuery({ ...opts, name } as Parameters<
        typeof createInfiniteQuery
      >[0]);
      infiniteQueryDefs[name] = def;
      allDefinitions.push(def);
    }
  }

  // Build module config
  const moduleConfig: Record<string, unknown> = {
    schema: {
      facts: schemaFacts,
      derivations: {},
      events: events
        ? Object.fromEntries(Object.keys(events).map((k) => [k, {}]))
        : {},
      requirements: {},
    },
    init: (facts: Record<string, unknown>) => {
      // Set default values from factsInit
      for (const [key, value] of Object.entries(factsInit)) {
        facts[key] = value;
      }
      userInit?.(facts);
    },
  };

  if (derive) {
    moduleConfig.derive = derive;
  }
  if (events) {
    moduleConfig.events = events;
  }
  if (effects) {
    moduleConfig.effects = effects;
  }
  if (constraints) {
    moduleConfig.constraints = constraints;
  }
  if (resolvers) {
    moduleConfig.resolvers = resolvers;
  }

  // Merge query fragments + create module + create system
  const merged = withQueries(allDefinitions, moduleConfig);
  const mod = createModule("app", merged as Parameters<typeof createModule>[1]);
  // biome-ignore lint/suspicious/noExplicitAny: System type varies based on merged schema
  const system = createSystem({
    module: mod,
    plugins,
    history,
    trace,
    errorBoundary,
    initialFacts,
  } as any) as SingleModuleSystem<ModuleSchema>;

  // Build bound handles
  const boundQueries: Record<string, BoundQueryHandle> = {};
  for (const [name, def] of Object.entries(queryDefs)) {
    boundQueries[name] = {
      refetch: () => def.refetch(system.facts as Record<string, unknown>),
      invalidate: () => def.invalidate(system.facts as Record<string, unknown>),
      cancel: () => def.cancel(system.facts as Record<string, unknown>),
      setData: (data) =>
        def.setData(system.facts as Record<string, unknown>, data),
    };
  }

  const boundMutations: Record<string, BoundMutationHandle> = {};
  for (const [name, def] of Object.entries(mutationDefs)) {
    boundMutations[name] = {
      mutate: (variables) =>
        def.mutate(system.facts as Record<string, unknown>, variables),
      mutateAsync: (variables) =>
        def.mutateAsync(system.facts as Record<string, unknown>, variables),
      reset: () => def.reset(system.facts as Record<string, unknown>),
    };
  }

  const boundSubscriptions: Record<string, BoundSubscriptionHandle> = {};
  for (const [name, def] of Object.entries(subscriptionDefs)) {
    boundSubscriptions[name] = {
      setData: (data) =>
        def.setData(system.facts as Record<string, unknown>, data),
    };
  }

  const boundInfiniteQueries: Record<string, BoundInfiniteQueryHandle> = {};
  for (const [name, def] of Object.entries(infiniteQueryDefs)) {
    boundInfiniteQueries[name] = {
      fetchNextPage: () =>
        def.fetchNextPage(system.facts as Record<string, unknown>),
      fetchPreviousPage: () =>
        def.fetchPreviousPage(system.facts as Record<string, unknown>),
      refetch: () => def.refetch(system.facts as Record<string, unknown>),
    };
  }

  // Extend system with convenience properties
  const extended = system as typeof system & {
    queries: Record<string, BoundQueryHandle>;
    mutations: Record<string, BoundMutationHandle>;
    subscriptions: Record<string, BoundSubscriptionHandle>;
    infiniteQueries: Record<string, BoundInfiniteQueryHandle>;
    explain: (queryName: string) => string;
  };

  extended.queries = boundQueries;
  extended.mutations = boundMutations;
  extended.subscriptions = boundSubscriptions;
  extended.infiniteQueries = boundInfiniteQueries;
  extended.explain = (queryName: string) => explainQuery(system, queryName);

  if (autoStart) {
    system.start();
  }

  return extended;
}
