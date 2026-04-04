/**
 * Resolver Types - Type definitions for resolvers
 */

import type { Facts, FactsSnapshot } from "./facts.js";
import type { DefinitionMeta } from "./meta.js";
import type {
  InferRequirementPayload,
  InferRequirementsFromSchema,
  Requirement,
  RequirementKeyFn,
  RequirementsSchema,
} from "./requirements.js";
import type { Schema } from "./schema.js";

// ============================================================================
// Resolver Configuration Types
// ============================================================================

/** Retry policy configuration */
export interface RetryPolicy {
  /** Maximum number of attempts */
  attempts: number;
  /** Backoff strategy */
  backoff: "none" | "linear" | "exponential";
  /** Initial delay in ms */
  initialDelay?: number;
  /** Maximum delay in ms */
  maxDelay?: number;
  /**
   * Optional predicate to decide whether to retry after an error.
   * Return `true` to retry, `false` to stop immediately.
   * If omitted, all errors are retried (up to `attempts`).
   *
   * @param error - The error that occurred
   * @param attempt - The attempt number that just failed (1-based)
   */
  shouldRetry?: (error: Error, attempt: number) => boolean;
}

/** Batch configuration */
export interface BatchConfig {
  /** Enable batching */
  enabled: boolean;
  /** Time window to collect requirements (ms) */
  windowMs: number;
  /** Maximum batch size. When reached, the batch flushes immediately instead of waiting for the timer. (default: unlimited) */
  maxSize?: number;
  /** Per-batch timeout in ms (overrides resolver timeout for batches) */
  timeoutMs?: number;
}

/**
 * Result for a single item in a batch resolution.
 */
export interface BatchItemResult<T = unknown> {
  /** Whether this item succeeded */
  success: boolean;
  /** Error if the item failed */
  error?: Error;
  /** Optional result value if the item succeeded */
  value?: T;
}

/**
 * Results from batch resolution with per-item status.
 * The array order must match the order of requirements passed in.
 */
export type BatchResolveResults<T = unknown> = Array<BatchItemResult<T>>;

/** Resolver context passed to resolve function */
export interface ResolverContext<S extends Schema = Schema> {
  readonly facts: Facts<S>;
  readonly signal: AbortSignal;
  /** Returns a read-only snapshot of the current facts state, useful for before/after comparisons inside resolvers. */
  readonly snapshot: () => FactsSnapshot<S>;
}

// ============================================================================
// Resolver Definition Types
// ============================================================================

/** Single resolver definition (untyped - use TypedResolversDef for type safety) */
export interface ResolverDef<
  S extends Schema,
  R extends Requirement = Requirement,
> {
  /**
   * Requirement type to handle.
   * - String: matches `req.type` directly (e.g., `requirement: "FETCH_USER"`)
   * - Function: type guard predicate (e.g., `requirement: (req) => req.type === "FETCH_USER"`)
   */
  requirement: string | ((req: Requirement) => req is R);
  /** Custom key function for deduplication */
  key?: RequirementKeyFn<R>;
  /** Retry policy */
  retry?: RetryPolicy;
  /** Timeout for resolver execution (ms) */
  timeout?: number;
  /** Batch configuration. Works with resolve() (individual fallback), resolveBatch(), or resolveBatchWithResults(). */
  batch?: BatchConfig;
  /** Resolve function for single requirement */
  resolve?: (req: R, ctx: ResolverContext<S>) => Promise<void>;
  /**
   * Resolve function for batched requirements (all-or-nothing).
   * If this throws, all requirements in the batch fail.
   */
  resolveBatch?: (reqs: R[], ctx: ResolverContext<S>) => Promise<void>;
  /**
   * Resolve function for batched requirements with per-item results.
   * Use this when you need to handle partial failures.
   * The returned array must match the order of input requirements.
   *
   * @example
   * ```typescript
   * resolveBatchWithResults: async (reqs, ctx) => {
   *   return Promise.all(reqs.map(async (req) => {
   *     try {
   *       await processItem(req);
   *       return { success: true };
   *     } catch (error) {
   *       return { success: false, error };
   *     }
   *   }));
   * }
   * ```
   */
  resolveBatchWithResults?: (
    reqs: R[],
    ctx: ResolverContext<S>,
  ) => Promise<BatchResolveResults>;
  /** Optional metadata for debugging and devtools (never read on hot path). */
  meta?: DefinitionMeta;
}

/**
 * Inferred requirement type helper.
 * Constructs a requirement type from a requirements schema entry.
 *
 * @typeParam R - The requirements schema
 * @typeParam T - The requirement type key
 *
 * @example
 * ```typescript
 * const requirements = {
 *   FETCH_USER: { userId: t.string() },
 *   SEND_EMAIL: { to: t.string(), subject: t.string() },
 * };
 *
 * // InferredReq<typeof requirements, "FETCH_USER"> = { type: "FETCH_USER"; userId: string }
 * ```
 */
export type InferredReq<
  R extends RequirementsSchema,
  T extends keyof R & string,
> = { type: T } & InferRequirementPayload<R[T]>;

/**
 * Typed resolver for a specific requirement type.
 */
type TypedResolverForType<
  S extends Schema,
  R extends RequirementsSchema,
  T extends keyof R & string,
> = {
  /** Requirement type to handle */
  requirement: T;
  /** Custom key function for deduplication */
  key?: (req: InferredReq<R, T>) => string;
  /** Retry policy */
  retry?: RetryPolicy;
  /** Timeout for resolver execution (ms) */
  timeout?: number;
  /** Batch configuration */
  batch?: BatchConfig;
  /** Resolve function for single requirement */
  resolve?: (req: InferredReq<R, T>, ctx: ResolverContext<S>) => Promise<void>;
  /** Resolve function for batched requirements (all-or-nothing) */
  resolveBatch?: (
    reqs: Array<InferredReq<R, T>>,
    ctx: ResolverContext<S>,
  ) => Promise<void>;
  /** Resolve function for batched requirements with per-item results */
  resolveBatchWithResults?: (
    reqs: Array<InferredReq<R, T>>,
    ctx: ResolverContext<S>,
  ) => Promise<BatchResolveResults>;
};

/**
 * Union of all typed resolver configurations for all requirement types.
 * TypeScript narrows based on the `requirement` literal value.
 */
type AnyTypedResolver<S extends Schema, R extends RequirementsSchema> = {
  [T in keyof R & string]: TypedResolverForType<S, R, T>;
}[keyof R & string];

/** Map of resolver definitions */
export type ResolversDef<S extends Schema> = Record<
  string,
  ResolverDef<S, Requirement>
>;

/**
 * Map of typed resolver definitions (schema-based variant).
 * Each resolver uses `requirement: "TYPE"` with types inferred from the requirements schema.
 *
 * @internal Use `TypedResolversDef` from `types/module.ts` for the public module-based API.
 */
export type SchemaTypedResolversDef<
  S extends Schema,
  R extends RequirementsSchema,
> = Record<
  string,
  | AnyTypedResolver<S, R>
  | ResolverDef<S, Requirement & InferRequirementsFromSchema<R>>
>;

/** Resolver status */
export type ResolverStatus =
  | { state: "idle" }
  | { state: "pending"; requirementId: string; startedAt: number }
  | {
      state: "running";
      requirementId: string;
      startedAt: number;
      attempt: number;
    }
  | {
      state: "success";
      requirementId: string;
      completedAt: number;
      duration: number;
    }
  | {
      state: "error";
      requirementId: string;
      error: Error;
      failedAt: number;
      attempts: number;
    }
  | { state: "canceled"; requirementId: string; canceledAt: number };
