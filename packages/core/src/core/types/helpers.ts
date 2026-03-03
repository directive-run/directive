/**
 * Type Helpers - External typed constraint and resolver definitions
 *
 * These types enable defining constraints and resolvers with full type safety
 * outside of module definitions, while maintaining proper type inference.
 */

import type { Facts } from "./facts.js";
import type { Requirement, RequirementOutput } from "./requirements.js";
import type { BatchConfig, ResolverContext, RetryPolicy } from "./resolvers.js";
import type { Schema } from "./schema.js";

// ============================================================================
// Typed Constraint Definition
// ============================================================================

/**
 * External constraint definition with full typing.
 * Use this when defining constraints outside of createModule().
 *
 * @typeParam S - The schema type
 * @typeParam R - The requirement type (defaults to Requirement)
 *
 * @example
 * ```typescript
 * // Define a typed constraint factory
 * const createMaxCountConstraint = <S extends Schema>(
 *   maxCount: number
 * ): TypedConstraint<S, { type: "RESET_COUNT" }> => ({
 *   priority: 10,
 *   when: (facts) => (facts as { count: number }).count > maxCount,
 *   require: { type: "RESET_COUNT" },
 * });
 *
 * // Use in module
 * const module = createModule("counter", {
 *   schema: { count: t.number() },
 *   constraints: {
 *     maxCount: createMaxCountConstraint(100),
 *   },
 * });
 * ```
 */
export interface TypedConstraint<
  S extends Schema,
  R extends Requirement = Requirement,
> {
  /** Priority for ordering (higher runs first) */
  priority?: number;
  /** Mark this constraint as async (avoids runtime detection) */
  async?: boolean;
  /** Condition function (sync or async) */
  when: (facts: Facts<S>) => boolean | Promise<boolean>;
  /**
   * Requirement(s) to produce when condition is met.
   */
  require: RequirementOutput<R> | ((facts: Facts<S>) => RequirementOutput<R>);
  /** Timeout for async constraints (ms) */
  timeout?: number;
  /**
   * Constraint IDs whose resolvers must complete before this constraint is evaluated.
   * - If dependency's `when()` returns false, this constraint proceeds (nothing to wait for)
   * - If dependency's resolver fails, this constraint remains blocked until it succeeds
   * - Cross-module: use the constraint ID as it appears in the merged system
   */
  after?: string[];
}

// ============================================================================
// Typed Resolver Definition
// ============================================================================

/**
 * External resolver definition with full typing.
 * Use this when defining resolvers outside of createModule().
 *
 * @typeParam S - The schema type
 * @typeParam R - The requirement type (defaults to Requirement)
 *
 * @example
 * ```typescript
 * // Define a typed resolver factory
 * interface FetchUserReq extends Requirement {
 *   type: "FETCH_USER";
 *   userId: string;
 * }
 *
 * const createFetchUserResolver = <S extends Schema>(
 *   fetchFn: (userId: string) => Promise<User>
 * ): TypedResolver<S, FetchUserReq> => ({
 *   requirement: (req): req is FetchUserReq => req.type === "FETCH_USER",
 *   key: (req) => `fetch-user-${req.userId}`,
 *   retry: { attempts: 3, backoff: "exponential" },
 *   resolve: async (req, ctx) => {
 *     const user = await fetchFn(req.userId);
 *     (ctx.facts as { user: User }).user = user;
 *   },
 * });
 * ```
 */
export interface TypedResolver<
  S extends Schema,
  R extends Requirement = Requirement,
> {
  /**
   * Requirement type to handle.
   * - String: matches `req.type` directly (e.g., `requirement: "FETCH_USER"`)
   * - Function: type guard predicate (e.g., `requirement: (req) => req.type === "FETCH_USER"`)
   */
  requirement: R["type"] | ((req: Requirement) => req is R);
  /** Custom key function for deduplication */
  key?: (req: R) => string;
  /** Retry policy */
  retry?: RetryPolicy;
  /** Timeout for resolver execution (ms) */
  timeout?: number;
  /** Batch configuration */
  batch?: BatchConfig;
  /** Resolve function for single requirement */
  resolve?: (req: R, ctx: ResolverContext<S>) => Promise<void>;
  /** Resolve function for batched requirements */
  resolveBatch?: (reqs: R[], ctx: ResolverContext<S>) => Promise<void>;
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a typed constraint factory for a specific schema.
 * This enables creating reusable constraint definitions with proper typing.
 *
 * @example
 * ```typescript
 * const schema = { count: t.number(), threshold: t.number() };
 * const factory = constraintFactory<typeof schema>();
 *
 * const maxCountConstraint = factory.create({
 *   when: (facts) => facts.count > facts.threshold,
 *   require: { type: "RESET" },
 * });
 * ```
 */
export function constraintFactory<S extends Schema>() {
  return {
    /**
     * Create a typed constraint
     */
    create<R extends Requirement = Requirement>(
      constraint: TypedConstraint<S, R>,
    ): TypedConstraint<S, R> {
      return constraint;
    },
  };
}

/**
 * Create a typed resolver factory for a specific schema.
 * This enables creating reusable resolver definitions with proper typing.
 *
 * @example
 * ```typescript
 * const schema = { user: t.object<User>() };
 * const factory = resolverFactory<typeof schema>();
 *
 * const fetchUserResolver = factory.create<FetchUserReq>({
 *   requirement: (req): req is FetchUserReq => req.type === "FETCH_USER",
 *   resolve: async (req, ctx) => {
 *     ctx.facts.user = await fetchUser(req.userId);
 *   },
 * });
 * ```
 */
export function resolverFactory<S extends Schema>() {
  return {
    /**
     * Create a typed resolver
     */
    create<R extends Requirement = Requirement>(
      resolver: TypedResolver<S, R>,
    ): TypedResolver<S, R> {
      return resolver;
    },
  };
}

// ============================================================================
// Simple Helper Functions
// ============================================================================

/**
 * Type-safe constraint creator.
 * Simpler alternative to constraintFactory when you don't need a factory pattern.
 *
 * @example
 * ```typescript
 * const constraint = typedConstraint<typeof schema, { type: "RESET" }>({
 *   when: (facts) => facts.count > 100,
 *   require: { type: "RESET" },
 * });
 * ```
 */
export function typedConstraint<
  S extends Schema,
  R extends Requirement = Requirement,
>(constraint: TypedConstraint<S, R>): TypedConstraint<S, R> {
  return constraint;
}

/**
 * Type-safe resolver creator.
 * Simpler alternative to resolverFactory when you don't need a factory pattern.
 *
 * @example
 * ```typescript
 * const resolver = typedResolver<typeof schema, FetchUserReq>({
 *   requirement: (req): req is FetchUserReq => req.type === "FETCH_USER",
 *   resolve: async (req, ctx) => {
 *     ctx.facts.user = await fetchUser(req.userId);
 *   },
 * });
 * ```
 */
export function typedResolver<
  S extends Schema,
  R extends Requirement = Requirement,
>(resolver: TypedResolver<S, R>): TypedResolver<S, R> {
  return resolver;
}
