/**
 * @directive-run/core/query
 *
 * Declarative data fetching built on Directive's constraint engine.
 *
 * - `createQuery` — define a data requirement
 * - `createMutation` — define a write operation with cache invalidation
 * - `withQueries` — merge queries into a module (PRIMARY API)
 *
 * @packageDocumentation
 */

export { createQuery } from "./create-query.js";
export { withQueries } from "./with-queries.js";

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
