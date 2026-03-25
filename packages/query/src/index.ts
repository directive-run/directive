/**
 * @directive-run/query
 *
 * Declarative data fetching built on Directive's constraint engine.
 *
 * - `createQuery` — define a data requirement (pull-based)
 * - `createMutation` — define a write operation with cache invalidation
 * - `withQueries` — merge queries into a module (PRIMARY API)
 * - `explainQuery` — human-readable causal chain for why a query fetched
 *
 * @packageDocumentation
 */

export { createQuery } from "./create-query.js";
export { createMutation } from "./create-mutation.js";
export { withQueries } from "./with-queries.js";
export { explainQuery } from "./explain.js";

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
export { createIdleResourceState } from "./types.js";
