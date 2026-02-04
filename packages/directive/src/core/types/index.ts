/**
 * Core Types - Barrel export for all type definitions
 *
 * This file re-exports all types from the focused type files.
 * Import from here for convenience, or import from specific files for clarity.
 */

// Schema types
export type {
	Schema,
	SchemaType,
	InferSchema,
	InferSchemaType,
	// Consolidated module schema
	ModuleSchema,
	EventPayloadSchema,
	EventsSchema,
	DerivationsSchema,
	RequirementPayloadSchema,
	// Schema inference utilities
	InferFacts,
	InferDerivations,
	InferEventPayloadFromSchema,
	InferEvents,
	InferRequirementPayloadFromSchema,
	InferRequirements,
	InferRequirementTypes,
} from "./schema.js";

// Re-export RequirementsSchema from requirements.ts
export type { RequirementsSchema } from "./requirements.js";

// Facts types
export type { Facts, FactsSnapshot, FactsStore, FactChange } from "./facts.js";

// Derivation types
export type {
	TrackingContext,
	DerivationDef,
	DerivationsDef,
	DerivedValues,
	DerivationState,
} from "./derivations.js";

// Effect types
export type { EffectDef, EffectsDef } from "./effects.js";

// Event types
export type {
	// Events accessor from schema
	EventsAccessorFromSchema,
	DispatchEventsFromSchema,
	// System event types
	SystemEvent,
	EventHandler,
	FlexibleEventHandler,
	EventsDef,
} from "./events.js";

// Requirement types
export type {
	Requirement,
	RequirementWithId,
	RequirementKeyFn,
	ConstraintDef,
	ConstraintsDef,
	ConstraintState,
} from "./requirements.js";

// Resolver types
export type {
	RetryPolicy,
	BatchConfig,
	ResolverContext,
	ResolverDef,
	InferredReq,
	ResolversDef,
	ResolverStatus,
} from "./resolvers.js";

// Plugin types
export type { ReconcileResult, Snapshot, Plugin } from "./plugins.js";

// Error types
export { DirectiveError } from "./errors.js";
export type { ErrorSource, RecoveryStrategy, ErrorBoundaryConfig } from "./errors.js";

// Module types
export type {
	ModuleDef,
	ModuleHooks,
	TypedDerivationFn,
	TypedDerivationsDef,
	TypedEventHandlerFn,
	TypedEventsDef,
	TypedConstraintDef,
	TypedConstraintsDef,
	TypedResolverContext,
	TypedResolverDef,
	TypedResolversDef,
	RequirementOutput,
} from "./module.js";

// System types
export type {
	// Accessors
	DeriveAccessor,
	EventsAccessor,
	DerivationKeys,
	DerivationReturnType,
	// Debug & time-travel
	DebugConfig,
	TimeTravelAPI,
	// Inspection
	SystemInspection,
	RequirementExplanation,
	SystemSnapshot,
	// System interfaces
	System,
	SystemConfig,
} from "./system.js";

// Helper types for external constraint/resolver definitions
export type {
	TypedConstraint,
	TypedResolver,
} from "./helpers.js";
export {
	constraintFactory,
	resolverFactory,
	typedConstraint,
	typedResolver,
} from "./helpers.js";

// Adapter utility types
export type {
	MergedSchema,
	BridgeSchema,
	AdapterConstraint,
	AdapterResolver,
	AdapterResolverContext,
	AdapterCallbacks,
} from "./adapter-utils.js";
export {
	createBridgeSchema,
	setFact,
	setBridgeFact,
	getBridgeFact,
	convertConstraints,
	convertResolvers,
	createCallbackPlugin,
	asConstraints,
	asResolvers,
	requirementGuard,
	requirementGuardMultiple,
} from "./adapter-utils.js";
