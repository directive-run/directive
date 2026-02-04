/**
 * Requirement Types - Type definitions for requirements and constraints
 */

import type { Schema, SchemaType } from "./schema.js";
import type { Facts } from "./facts.js";

// ============================================================================
// Requirement Types
// ============================================================================

/** Base requirement structure */
export interface Requirement {
	readonly type: string;
	readonly [key: string]: unknown;
}

/** Requirement with computed identity */
export interface RequirementWithId {
	readonly requirement: Requirement;
	readonly id: string;
	readonly fromConstraint: string;
}

/** Requirement key function for custom deduplication */
export type RequirementKeyFn<R extends Requirement = Requirement> = (
	req: R,
) => string;

// ============================================================================
// Requirement Schema Types
// ============================================================================

/**
 * Requirement payload schema - maps property names to their types.
 */
export type RequirementPayloadSchema = Record<string, SchemaType<unknown>>;

/**
 * Requirements schema definition - maps requirement type names to their payload schemas.
 *
 * @example
 * ```typescript
 * const module = createModule("inventory", {
 *   requirements: {
 *     RESTOCK: { sku: t.string(), quantity: t.number() },
 *     ALERT: { message: t.string() },
 *   },
 * });
 * ```
 */
export type RequirementsSchema = Record<string, RequirementPayloadSchema>;

/**
 * Infer the requirement payload type from a requirement payload schema.
 */
export type InferRequirementPayload<P extends RequirementPayloadSchema> = {
	[K in keyof P]: P[K] extends SchemaType<infer T> ? T : never;
};

/**
 * Infer all requirements from a requirements schema as a discriminated union.
 */
export type InferRequirementsFromSchema<R extends RequirementsSchema> = {
	[K in keyof R]: { type: K } & InferRequirementPayload<R[K]>;
}[keyof R];

/**
 * Infer requirement type names from a requirements schema.
 */
export type InferRequirementTypes<R extends RequirementsSchema> = keyof R & string;

// ============================================================================
// Constraint Types
// ============================================================================

/**
 * Requirement output from a constraint - can be single, array, or null.
 * - Single requirement: `{ type: "RESTOCK", sku: "ABC" }`
 * - Multiple requirements: `[{ type: "RESTOCK", sku: "ABC" }, { type: "NOTIFY", message: "Low stock" }]`
 * - No requirements: `null` or `[]`
 */
export type RequirementOutput<R extends Requirement = Requirement> = R | R[] | null;

/** Constraint definition */
export interface ConstraintDef<S extends Schema, R extends Requirement = Requirement> {
	/** Priority for ordering (higher runs first) */
	priority?: number;
	/** Mark this constraint as async (avoids runtime detection) */
	async?: boolean;
	/** Condition function (sync or async) */
	when: (facts: Facts<S>) => boolean | Promise<boolean>;
	/**
	 * Requirement(s) to produce when condition is met.
	 * - Single requirement: `{ type: "RESTOCK", sku: "ABC" }`
	 * - Multiple requirements: `[{ type: "RESTOCK", sku: "ABC" }, { type: "NOTIFY", message: "Low" }]`
	 * - Function returning requirements: `(facts) => ({ type: "RESTOCK", sku: facts.sku })`
	 * - Function returning null/empty array for conditional no-op: `(facts) => facts.critical ? [...] : null`
	 */
	require: RequirementOutput<R> | ((facts: Facts<S>) => RequirementOutput<R>);
	/** Timeout for async constraints (ms) */
	timeout?: number;
}

/** Map of constraint definitions (generic) */
export type ConstraintsDef<S extends Schema> = Record<
	string,
	ConstraintDef<S, Requirement>
>;

/** Map of constraint definitions with typed requirements */
export type TypedConstraintsDef<
	S extends Schema,
	R extends RequirementsSchema,
> = Record<string, ConstraintDef<S, Requirement & InferRequirementsFromSchema<R>>>;

/** Internal constraint state */
export interface ConstraintState {
	id: string;
	priority: number;
	isAsync: boolean;
	lastResult: boolean | null;
	isEvaluating: boolean;
	error: Error | null;
}
