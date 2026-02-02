/**
 * Directive - Constraint-driven runtime for TypeScript
 *
 * Declare requirements. Let the runtime resolve them.
 *
 * @packageDocumentation
 */

// ============================================================================
// Core Types
// ============================================================================

export type {
	// Schema
	Schema,
	SchemaType,
	InferSchema,
	// Facts
	Facts,
	FactsSnapshot,
	FactsStore,
	FactChange,
	// Derivations
	DerivationsDef,
	DerivationState,
	DerivedValues,
	// Effects
	EffectsDef,
	// Requirements
	Requirement,
	RequirementWithId,
	RequirementKeyFn,
	// Constraints
	ConstraintsDef,
	ConstraintState,
	// Resolvers
	ResolversDef,
	ResolverContext,
	ResolverStatus,
	RetryPolicy,
	BatchConfig,
	// Plugins
	Plugin,
	ReconcileResult,
	Snapshot,
	RecoveryStrategy,
	// Errors
	ErrorSource,
	ErrorBoundaryConfig,
	// Module
	ModuleDef,
	ModuleHooks,
	EventsDef,
	// System
	System,
	SystemConfig,
	SystemEvent,
	SystemInspection,
	DebugConfig,
	TimeTravelAPI,
	RequirementExplanation,
	// Typed Events
	TypedEvent,
	TypedEventHandler,
	TypedEventHandlers,
} from "./types.js";

// ============================================================================
// Core Classes
// ============================================================================

export { DirectiveError } from "./types.js";

// ============================================================================
// Schema Type Builders
// ============================================================================

export { t } from "./facts.js";

// ============================================================================
// Module & System
// ============================================================================

export { createModule, type ModuleConfig } from "./module.js";
export { createSystem, type CreateSystemOptions } from "./system.js";

// ============================================================================
// Requirements Helpers
// ============================================================================

export {
	req,
	forType,
	isRequirementType,
	generateRequirementId,
	RequirementSet,
} from "./requirements.js";

// ============================================================================
// Lower-level APIs (for advanced use)
// ============================================================================

export { createFacts, createFactsStore, createFactsProxy } from "./facts.js";
export { createDerivationsManager } from "./derivations.js";
export { createEffectsManager } from "./effects.js";
export { createConstraintsManager } from "./constraints.js";
export { createResolversManager, type InflightInfo } from "./resolvers.js";
export { createPluginManager } from "./plugins.js";
export { createErrorBoundaryManager } from "./errors.js";
export { createTimeTravelManager, createDisabledTimeTravel } from "./time-travel.js";
export { createEngine } from "./engine.js";

// ============================================================================
// Tracking (for custom derivations)
// ============================================================================

export {
	getCurrentTracker,
	isTracking,
	withTracking,
	withoutTracking,
	trackAccess,
} from "./tracking.js";
