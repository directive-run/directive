/**
 * Module Types - Type definitions for modules with consolidated schema
 */

import type {
	ModuleSchema,
	DerivationsSchema,
	EventsSchema,
	RequirementsSchema,
	InferSchemaType,
	InferDerivations,
	InferRequirements,
	InferEventPayloadFromSchema,
	InferRequirementPayloadFromSchema,
} from "./schema.js";
import type { Facts } from "./facts.js";
import type { EffectsDef } from "./effects.js";
import type { DirectiveError } from "./errors.js";
import type { System } from "./system.js";
import type {
	CrossModuleDeps,
	CrossModuleFactsWithSelf,
} from "./composition.js";

// ============================================================================
// Module Hooks
// ============================================================================

/** Lifecycle hooks for modules */
export interface ModuleHooks<_M extends ModuleSchema> {
	// biome-ignore lint/suspicious/noExplicitAny: System type inference is complex
	onInit?: (system: System<any>) => void;
	// biome-ignore lint/suspicious/noExplicitAny: System type inference is complex
	onStart?: (system: System<any>) => void;
	// biome-ignore lint/suspicious/noExplicitAny: System type inference is complex
	onStop?: (system: System<any>) => void;
	onError?: (error: DirectiveError, context: unknown) => void;
}

// ============================================================================
// Typed Derivations Definition
// ============================================================================

/** Helper to get derivations schema, defaulting to empty */
type GetDerivationsSchema<M extends ModuleSchema> = M["derivations"] extends DerivationsSchema ? M["derivations"] : Record<string, never>;

/** Helper to get events schema, defaulting to empty */
type GetEventsSchema<M extends ModuleSchema> = M["events"] extends EventsSchema ? M["events"] : Record<string, never>;

/** Helper to get requirements schema, defaulting to empty */
type GetRequirementsSchema<M extends ModuleSchema> = M["requirements"] extends RequirementsSchema ? M["requirements"] : Record<string, never>;

/**
 * Derivation function with typed facts and derive accessor.
 * The derive accessor is typed from schema.derivations.
 * Supports both t.*() builders and type assertion {} as {} patterns.
 */
export type TypedDerivationFn<M extends ModuleSchema, K extends keyof GetDerivationsSchema<M>> = (
	facts: Facts<M["facts"]>,
	derive: InferDerivations<M>,
) => InferSchemaType<GetDerivationsSchema<M>[K]>;

/**
 * Typed derivations definition using the module schema.
 * Each derivation key must match schema.derivations and return the declared type.
 */
export type TypedDerivationsDef<M extends ModuleSchema> = {
	[K in keyof GetDerivationsSchema<M>]: TypedDerivationFn<M, K>;
};

// ============================================================================
// Typed Events Definition
// ============================================================================

/**
 * Event handler function with typed facts and payload.
 * Payload is typed from schema.events[K].
 */
export type TypedEventHandlerFn<M extends ModuleSchema, K extends keyof GetEventsSchema<M>> =
	keyof GetEventsSchema<M>[K] extends never
		? (facts: Facts<M["facts"]>) => void
		: (facts: Facts<M["facts"]>, payload: InferEventPayloadFromSchema<GetEventsSchema<M>[K]>) => void;

/**
 * Typed events definition using the module schema.
 * Each event key must match schema.events with the correct payload type.
 */
export type TypedEventsDef<M extends ModuleSchema> = {
	[K in keyof GetEventsSchema<M>]: TypedEventHandlerFn<M, K>;
};

// ============================================================================
// Typed Constraints Definition
// ============================================================================

/**
 * Requirement output from a constraint.
 */
export type RequirementOutput<R> = R | R[] | null;

/**
 * Constraint definition with typed requirements.
 */
export interface TypedConstraintDef<M extends ModuleSchema> {
	/** Priority for ordering (higher runs first) */
	priority?: number;
	/** Mark this constraint as async */
	async?: boolean;
	/** Condition function */
	when: (facts: Facts<M["facts"]>) => boolean | Promise<boolean>;
	/**
	 * Requirement(s) to produce when condition is met.
	 */
	require:
		| RequirementOutput<InferRequirements<M>>
		| ((facts: Facts<M["facts"]>) => RequirementOutput<InferRequirements<M>>);
	/** Timeout for async constraints (ms) */
	timeout?: number;
}

/**
 * Typed constraints definition using the module schema.
 */
export type TypedConstraintsDef<M extends ModuleSchema> = Record<string, TypedConstraintDef<M>>;

// ============================================================================
// Cross-Module Typed Definitions (for modules with crossModuleDeps)
// ============================================================================

/**
 * Constraint definition with cross-module typed facts.
 * Used when a module declares crossModuleDeps for type-safe access to other modules.
 *
 * At runtime, constraints receive facts with:
 * - `facts.self.*` for own module's facts
 * - `facts.{dep}.*` for cross-module facts
 */
export interface CrossModuleConstraintDef<
	M extends ModuleSchema,
	Deps extends CrossModuleDeps,
> {
	/** Priority for ordering (higher runs first) */
	priority?: number;
	/** Mark this constraint as async */
	async?: boolean;
	/** Condition function with cross-module facts access */
	when: (facts: CrossModuleFactsWithSelf<M, Deps>) => boolean | Promise<boolean>;
	/**
	 * Requirement(s) to produce when condition is met.
	 */
	require:
		| RequirementOutput<InferRequirements<M>>
		| ((facts: CrossModuleFactsWithSelf<M, Deps>) => RequirementOutput<InferRequirements<M>>);
	/** Timeout for async constraints (ms) */
	timeout?: number;
}

/**
 * Cross-module constraints definition.
 */
export type CrossModuleConstraintsDef<
	M extends ModuleSchema,
	Deps extends CrossModuleDeps,
> = Record<string, CrossModuleConstraintDef<M, Deps>>;

/**
 * Effect definition with cross-module typed facts.
 * Used when a module declares crossModuleDeps for type-safe access to other modules.
 *
 * At runtime, effects receive facts with:
 * - `facts.self.*` for own module's facts
 * - `facts.{dep}.*` for cross-module facts
 */
export interface CrossModuleEffectDef<
	M extends ModuleSchema,
	Deps extends CrossModuleDeps,
> {
	/** Effect function with cross-module facts access */
	run: (
		facts: CrossModuleFactsWithSelf<M, Deps>,
		prev: CrossModuleFactsWithSelf<M, Deps> | undefined,
	) => void | Promise<void>;
	/** Optional dependency keys to filter when effect runs */
	deps?: string[];
}

/**
 * Cross-module effects definition.
 */
export type CrossModuleEffectsDef<
	M extends ModuleSchema,
	Deps extends CrossModuleDeps,
> = Record<string, CrossModuleEffectDef<M, Deps>>;

/**
 * Derivation function with cross-module typed facts.
 * Used when a module declares crossModuleDeps for type-safe access to other modules' facts.
 *
 * At runtime, derivations receive facts with:
 * - `facts.self.*` for own module's facts
 * - `facts.{dep}.*` for cross-module facts (read-only)
 */
export type CrossModuleDerivationFn<
	M extends ModuleSchema,
	Deps extends CrossModuleDeps,
	K extends keyof GetDerivationsSchema<M>,
> = (
	facts: CrossModuleFactsWithSelf<M, Deps>,
	derive: InferDerivations<M>,
) => InferSchemaType<GetDerivationsSchema<M>[K]>;

/**
 * Cross-module derivations definition.
 */
export type CrossModuleDerivationsDef<
	M extends ModuleSchema,
	Deps extends CrossModuleDeps,
> = {
	[K in keyof GetDerivationsSchema<M>]: CrossModuleDerivationFn<M, Deps, K>;
};

// ============================================================================
// Typed Resolvers Definition
// ============================================================================

/**
 * Retry policy configuration.
 */
export interface RetryPolicy {
	attempts: number;
	backoff: "none" | "linear" | "exponential";
	initialDelay?: number;
	maxDelay?: number;
}

/**
 * Resolver context with typed facts.
 */
export interface TypedResolverContext<M extends ModuleSchema> {
	readonly facts: Facts<M["facts"]>;
	readonly signal: AbortSignal;
}

/**
 * Helper to extract a specific requirement type from the schema.
 */
type ExtractRequirement<M extends ModuleSchema, T extends keyof GetRequirementsSchema<M>> =
	{ type: T } & InferRequirementPayloadFromSchema<GetRequirementsSchema<M>[T]>;

/**
 * Typed resolver definition for a specific requirement type.
 */
export interface TypedResolverDef<M extends ModuleSchema, T extends keyof GetRequirementsSchema<M> & string> {
	/** Requirement type to handle */
	requirement: T;
	/** Custom key function for deduplication */
	key?: (req: ExtractRequirement<M, T>) => string;
	/** Retry policy */
	retry?: RetryPolicy;
	/** Timeout for resolver execution (ms) */
	timeout?: number;
	/** Resolve function */
	resolve: (req: ExtractRequirement<M, T>, ctx: TypedResolverContext<M>) => Promise<void>;
}

/**
 * Union of all typed resolver definitions for all requirement types.
 */
type AnyTypedResolverDef<M extends ModuleSchema> = {
	[T in keyof GetRequirementsSchema<M> & string]: TypedResolverDef<M, T>;
}[keyof GetRequirementsSchema<M> & string];

/**
 * Typed resolvers definition using the module schema.
 */
export type TypedResolversDef<M extends ModuleSchema> = Record<string, AnyTypedResolverDef<M>>;

// ============================================================================
// Module Definition
// ============================================================================

/**
 * Module definition using consolidated schema.
 * This provides full type inference for all module components.
 *
 * derive and events are optional when the schema has no derivations/events.
 */
export interface ModuleDef<M extends ModuleSchema = ModuleSchema> {
	id: string;
	schema: M;
	init?: (facts: Facts<M["facts"]>) => void;
	derive?: TypedDerivationsDef<M>;
	events?: TypedEventsDef<M>;
	effects?: EffectsDef<M["facts"]>;
	constraints?: TypedConstraintsDef<M>;
	resolvers?: TypedResolversDef<M>;
	hooks?: ModuleHooks<M>;
	/**
	 * Cross-module dependencies (runtime marker).
	 * When present, constraints/effects receive `facts.self.*` + `facts.{dep}.*`.
	 * @internal
	 */
	crossModuleDeps?: CrossModuleDeps;
}
