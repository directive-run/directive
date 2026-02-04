/**
 * Schema Types - Type definitions for fact schemas and consolidated module schemas
 */

// ============================================================================
// Base Schema Types
// ============================================================================

/** Primitive type definitions for schema */
export interface SchemaType<T> {
	readonly _type: T;
	// biome-ignore lint/suspicious/noExplicitAny: Validators must use any for covariance
	readonly _validators: Array<(value: any) => boolean>;
	validate(fn: (value: T) => boolean): SchemaType<T>;
}

/**
 * Schema definition mapping keys to types.
 * Supports both:
 * - Schema builders: `{ count: t.number() }`
 * - Type assertions: `{} as { count: number }`
 */
export type Schema = Record<string, SchemaType<unknown> | unknown>;

/**
 * Infer a single type from a SchemaType, Zod schema, or plain type.
 * - If it has `_type` (our SchemaType), extract it
 * - If it has `_output` (Zod schema), extract it
 * - Otherwise use the type directly (type assertion)
 */
export type InferSchemaType<T> =
	T extends SchemaType<infer U> ? U :
	T extends { _output: infer Z } ? Z :
	T;

/** Extract the TypeScript type from a schema (removes readonly from const type params) */
export type InferSchema<S extends Schema> = {
	-readonly [K in keyof S]: InferSchemaType<S[K]>;
};

// ============================================================================
// Consolidated Module Schema Types
// ============================================================================

/**
 * Event payload schema - maps property names to their types.
 * Empty object `{}` means no payload.
 * Supports both `t.*()` builders and plain types.
 */
export type EventPayloadSchema = Record<string, SchemaType<unknown> | unknown>;

/**
 * Events schema - maps event names to their payload schemas.
 * Supports type assertion: `{} as { eventName: { prop: Type } }`
 */
export type EventsSchema = Record<string, EventPayloadSchema>;

/**
 * Derivations schema - maps derivation names to their return types.
 * Supports both:
 * - `{ doubled: t.number() }`
 * - `{} as { doubled: number }`
 */
export type DerivationsSchema = Record<string, SchemaType<unknown> | unknown>;

/**
 * Requirement payload schema - maps property names to their types.
 * Supports both `t.*()` builders and plain types.
 */
export type RequirementPayloadSchema = Record<string, SchemaType<unknown> | unknown>;

/**
 * Requirements schema - maps requirement type names to their payload schemas.
 * Supports type assertion: `{} as { REQ_NAME: { prop: Type } }`
 */
export type RequirementsSchema = Record<string, RequirementPayloadSchema>;

/**
 * Consolidated module schema - single source of truth for all types.
 *
 * Only `facts` is required. Other sections default to empty:
 * - `derivations` - Omit if no computed values
 * - `events` - Omit if no event handlers
 * - `requirements` - Omit if no constraints/resolvers
 *
 * Supports two patterns for defining types:
 *
 * @example
 * ```typescript
 * // Pattern 1: Schema builders (with optional runtime validation)
 * createModule("counter", {
 *   schema: {
 *     facts: { count: t.number(), phase: t.string<"a" | "b">() },
 *     derivations: { doubled: t.number() },
 *     events: { increment: {}, setPhase: { phase: t.string<"a" | "b">() } },
 *     requirements: { FETCH: { id: t.string() } },
 *   },
 *   // ...
 * });
 *
 * // Pattern 2: Type assertions (type-only, no validation)
 * createModule("counter", {
 *   schema: {
 *     facts: {} as { count: number; phase: "a" | "b" },
 *     derivations: {} as { doubled: number },
 *     events: {} as { increment: {}; setPhase: { phase: "a" | "b" } },
 *     requirements: {} as { FETCH: { id: string } },
 *   },
 *   // ...
 * });
 * ```
 */
export interface ModuleSchema {
	/** Facts (state) schema - required */
	facts: Schema;
	/** Derivation return types - optional, defaults to {} */
	derivations?: DerivationsSchema;
	/** Event payload schemas - optional, defaults to {} */
	events?: EventsSchema;
	/** Requirement payload schemas - optional, defaults to {} */
	requirements?: RequirementsSchema;
}

// ============================================================================
// Schema Inference Utilities
// ============================================================================

/** Helper to get derivations, defaulting to empty */
type GetDerivations<M extends ModuleSchema> = M["derivations"] extends DerivationsSchema ? M["derivations"] : Record<string, never>;

/** Helper to get events, defaulting to empty */
type GetEvents<M extends ModuleSchema> = M["events"] extends EventsSchema ? M["events"] : Record<string, never>;

/** Helper to get requirements, defaulting to empty */
type GetRequirements<M extends ModuleSchema> = M["requirements"] extends RequirementsSchema ? M["requirements"] : Record<string, never>;

/**
 * Infer the facts type from a module schema.
 */
export type InferFacts<M extends ModuleSchema> = InferSchema<M["facts"]>;

/**
 * Infer derivation values from a module schema.
 * Each key maps to the return type declared in schema.derivations.
 */
export type InferDerivations<M extends ModuleSchema> = {
	readonly [K in keyof GetDerivations<M>]: InferSchemaType<GetDerivations<M>[K]>;
};

/**
 * Infer event payload type from an event payload schema.
 */
export type InferEventPayloadFromSchema<P extends EventPayloadSchema> = {
	[K in keyof P]: InferSchemaType<P[K]>;
};

/**
 * Infer all events from a module schema as a discriminated union.
 */
export type InferEvents<M extends ModuleSchema> = {
	[K in keyof GetEvents<M>]: keyof GetEvents<M>[K] extends never
		? { type: K }
		: { type: K } & InferEventPayloadFromSchema<GetEvents<M>[K]>;
}[keyof GetEvents<M>];

/**
 * Infer requirement payload type from a requirement payload schema.
 */
export type InferRequirementPayloadFromSchema<P extends RequirementPayloadSchema> = {
	[K in keyof P]: InferSchemaType<P[K]>;
};

/**
 * Infer all requirements from a module schema as a discriminated union.
 */
export type InferRequirements<M extends ModuleSchema> = {
	[K in keyof GetRequirements<M>]: { type: K } & InferRequirementPayloadFromSchema<GetRequirements<M>[K]>;
}[keyof GetRequirements<M>];

/**
 * Infer requirement type names from a module schema.
 */
export type InferRequirementTypes<M extends ModuleSchema> = keyof GetRequirements<M> & string;
