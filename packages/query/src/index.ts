/**
 * @directive-run/query
 *
 * Declarative data fetching built on Directive's constraint engine.
 *
 * - `createQuerySystem` — one-call setup with bound handles (SIMPLE PATH)
 * - `createQueryModule` — query module for multi-module systems
 * - `createQuery` / `createMutation` / `createSubscription` — individual definitions
 * - `withQueries` — merge definitions into a module config (ADVANCED)
 * - `explainQuery` — human-readable causal chain for why a query fetched
 *
 * @packageDocumentation
 */

// Convenience wrappers (simple path)
export { createQuerySystem } from "./create-query-system.js";
export type {
  QuerySystemConfig,
  BoundQueryHandle,
  BoundMutationHandle,
  BoundSubscriptionHandle,
  BoundInfiniteQueryHandle,
  TypedQuerySystem,
  TypedBoundQueryHandle,
  TypedBoundMutationHandle,
  TypedBoundSubscriptionHandle,
} from "./create-query-system.js";
export { createQueryModule } from "./create-query-module.js";

// Individual definition creators (advanced path)
export { createQuery } from "./create-query.js";
export { createMutation, createIdleMutationState } from "./create-mutation.js";
export { createSubscription } from "./create-subscription.js";
export { createInfiniteQuery } from "./create-infinite-query.js";
export { createBaseQuery } from "./create-base-query.js";
export {
  createGraphQLQuery,
  createGraphQLClient,
} from "./create-graphql-query.js";

// Composition + debugging
export { withQueries } from "./with-queries.js";
export type { AnyQueryDefinition } from "./with-queries.js";
export { explainQuery } from "./explain.js";

// Types
export type {
  ResourceState,
  QueryStatus,
  QueryOptions,
  QueryDefinition,
  MutationOptions,
  MutationState,
  MutationStatus,
  MutationDefinition,
} from "./types.js";
export type {
  SubscriptionOptions,
  SubscriptionCallbacks,
  SubscriptionDefinition,
} from "./create-subscription.js";
export type {
  InfiniteQueryOptions,
  InfiniteResourceState,
  InfiniteQueryDefinition,
} from "./create-infinite-query.js";
export type {
  BaseQueryConfig,
  BaseQueryArgs,
  BaseQueryFetcher,
} from "./create-base-query.js";
export type {
  GraphQLQueryOptions,
  GraphQLClientOptions,
  GraphQLError,
  TypedDocumentNode,
  ResultOf,
  VariablesOf,
} from "./create-graphql-query.js";
export { createIdleResourceState } from "./types.js";

// Re-export t from core for single-import convenience
export { t } from "@directive-run/core";
