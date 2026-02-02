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
	SystemSnapshot,
	DebugConfig,
	TimeTravelAPI,
	RequirementExplanation,
	// Typed Events
	TypedEvent,
	TypedEventHandler,
	TypedEventHandlers,
} from "./core/types.js";

// ============================================================================
// Core Classes
// ============================================================================

export { DirectiveError } from "./core/types.js";

// ============================================================================
// Schema Type Builders
// ============================================================================

/**
 * Schema type builders for defining fact types.
 *
 * @example
 * ```ts
 * import { t } from 'directive';
 * // or for discoverability:
 * import { schema } from 'directive';
 *
 * const mySchema = {
 *   count: t.number(),
 *   name: t.string(),
 *   active: t.boolean(),
 * };
 * ```
 */
export { t } from "./core/facts.js";

/**
 * Alias for `t` - Schema type builders for defining fact types.
 * Use this for better discoverability if you prefer explicit naming.
 *
 * @see {@link t} for the shorter alias
 */
export { t as schema } from "./core/facts.js";

// ============================================================================
// Module & System
// ============================================================================

export { createModule, type ModuleConfig } from "./core/module.js";
export { createSystem, type CreateSystemOptions } from "./core/system.js";

// ============================================================================
// Requirements Helpers
// ============================================================================

export {
	req,
	forType,
	isRequirementType,
	generateRequirementId,
	RequirementSet,
} from "./core/requirements.js";

// ============================================================================
// Constants
// ============================================================================

/**
 * Backoff strategy constants for retry policies.
 * Use for autocomplete when configuring resolver retry policies.
 *
 * @example
 * ```ts
 * import { Backoff } from 'directive';
 *
 * const resolver = {
 *   handles: forType("FETCH_DATA"),
 *   retry: {
 *     attempts: 3,
 *     backoff: Backoff.Exponential, // Autocomplete-friendly!
 *     initialDelay: 100,
 *   },
 *   resolve: async (req, ctx) => { ... },
 * };
 * ```
 */
export const Backoff = {
	/** No delay between retries */
	None: "none",
	/** Linear delay increase (initialDelay * attempt) */
	Linear: "linear",
	/** Exponential delay increase (initialDelay * 2^attempt) */
	Exponential: "exponential",
} as const;

// ============================================================================
// Lower-level APIs (for advanced use)
// ============================================================================

export { createFacts, createFactsStore, createFactsProxy } from "./core/facts.js";
export { createDerivationsManager } from "./core/derivations.js";
export { createEffectsManager } from "./core/effects.js";
export { createConstraintsManager } from "./core/constraints.js";
export { createResolversManager, type InflightInfo } from "./core/resolvers.js";
export { createPluginManager } from "./core/plugins.js";
export { createErrorBoundaryManager } from "./core/errors.js";
export { createTimeTravelManager, createDisabledTimeTravel } from "./utils/time-travel.js";
export { createEngine } from "./core/engine.js";

// ============================================================================
// Tracking (for custom derivations)
// ============================================================================

export {
	getCurrentTracker,
	isTracking,
	withTracking,
	withoutTracking,
	trackAccess,
} from "./core/tracking.js";
