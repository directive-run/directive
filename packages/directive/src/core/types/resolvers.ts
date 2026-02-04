/**
 * Resolver Types - Type definitions for resolvers
 */

import type { Schema } from "./schema.js";
import type { Facts, FactsSnapshot } from "./facts.js";
import type {
	Requirement,
	RequirementKeyFn,
	RequirementsSchema,
	InferRequirementPayload,
	InferRequirementsFromSchema,
} from "./requirements.js";

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
}

/** Batch configuration */
export interface BatchConfig {
	/** Enable batching */
	enabled: boolean;
	/** Time window to collect requirements (ms) */
	windowMs: number;
}

/** Resolver context passed to resolve function */
export interface ResolverContext<S extends Schema = Schema> {
	readonly facts: Facts<S>;
	readonly signal: AbortSignal;
	readonly snapshot: () => FactsSnapshot<S>;
}

// ============================================================================
// Resolver Definition Types
// ============================================================================

/** Single resolver definition (untyped - use TypedResolversDef for type safety) */
export interface ResolverDef<S extends Schema, R extends Requirement = Requirement> {
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
	/** Batch configuration (mutually exclusive with regular resolve) */
	batch?: BatchConfig;
	/** Resolve function for single requirement */
	resolve?: (req: R, ctx: ResolverContext<S>) => Promise<void>;
	/** Resolve function for batched requirements */
	resolveBatch?: (reqs: R[], ctx: ResolverContext<S>) => Promise<void>;
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
export type InferredReq<R extends RequirementsSchema, T extends keyof R & string> =
	{ type: T } & InferRequirementPayload<R[T]>;

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
	/** Batch configuration (mutually exclusive with regular resolve) */
	batch?: BatchConfig;
	/** Resolve function for single requirement */
	resolve?: (req: InferredReq<R, T>, ctx: ResolverContext<S>) => Promise<void>;
	/** Resolve function for batched requirements */
	resolveBatch?: (reqs: Array<InferredReq<R, T>>, ctx: ResolverContext<S>) => Promise<void>;
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
 * Map of typed resolver definitions.
 * Each resolver uses `requirement: "TYPE"` with types inferred from the requirements schema.
 */
export type TypedResolversDef<
	S extends Schema,
	R extends RequirementsSchema,
> = Record<string, AnyTypedResolver<S, R> | ResolverDef<S, Requirement & InferRequirementsFromSchema<R>>>;

/** Resolver status */
export type ResolverStatus =
	| { state: "idle" }
	| { state: "pending"; requirementId: string; startedAt: number }
	| { state: "running"; requirementId: string; startedAt: number; attempt: number }
	| { state: "success"; requirementId: string; completedAt: number; duration: number }
	| { state: "error"; requirementId: string; error: Error; failedAt: number; attempts: number }
	| { state: "canceled"; requirementId: string; canceledAt: number };
