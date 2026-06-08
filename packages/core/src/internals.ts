/**
 * Lower-level APIs and internal types for advanced use cases.
 *
 * Import from `@directive-run/core/internals` when you need direct access
 * to individual manager factories, the engine, tracking utilities, or
 * internal type definitions.
 *
 * Most consumers should use `createModule` + `createSystem` from the main entry point.
 *
 * @internal Sub-path export for tools that need lower-level primitives.
 * **NO SEMVER GUARANTEE** — names, signatures, and exports here may change
 * in any release (including patch). For public, semver-stable APIs use
 * the main barrel (`import from "@directive-run/core"`).
 *
 * @packageDocumentation
 */

// ============================================================================
// Facts store
// ============================================================================

export {
  createFacts,
  createFactsStore,
  createFactsProxy,
} from "./core/facts.js";

// ============================================================================
// Manager factories
// ============================================================================

export { createDerivationsManager } from "./core/derivations.js";
export { createEffectsManager } from "./core/effects.js";
export { createConstraintsManager } from "./core/constraints.js";
export { createResolversManager, type InflightInfo } from "./core/resolvers.js";
export {
  createSourcesManager,
  type SourcesManager,
  type SourcesManagerCallbacks,
  type SourceDispatch,
  type SourceDispatchResult,
  type SourceInspectionRow,
  type SourceLastError,
} from "./core/sources.js";
export { createPluginManager } from "./core/plugins.js";
export {
  createErrorBoundaryManager,
  createRetryLaterManager,
  type PendingRetry,
} from "./core/errors.js";

// ============================================================================
// History
// ============================================================================

export {
  createHistoryManager,
  createDisabledHistory,
} from "./utils/history.js";

// ============================================================================
// Engine
// ============================================================================

export { createEngine } from "./core/engine.js";

// ============================================================================
// Tracking (for custom derivations)
// ============================================================================

export {
  getCurrentDeps,
  isTracking,
  withTracking,
  withoutTracking,
  trackAccess,
} from "./core/tracking.js";

// ============================================================================
// Internal Types (moved from main entry to reduce surface area)
// ============================================================================

export type {
  // Schema internals
  InferSchema,
  DerivationsSchema,
  EventsSchema,
  EventPayloadSchema,
  InferEventPayloadFromSchema,
  InferRequirementPayloadFromSchema,
  RequirementPayloadSchema,
  RequirementsSchema,
  // Facts internals
  FactsStore,
  FactChange,
  // Derivations internals
  DerivationsDef,
  DerivationState,
  DerivedValues,
  TypedDerivationsDef,
  // Effects internals
  EffectsDef,
  EffectCleanup,
  // Requirements internals
  RequirementKeyFn,
  RequirementOutput,
  // Constraints internals
  ConstraintsDef,
  ConstraintState,
  TypedConstraintDef,
  TypedConstraintsDef,
  // Resolvers internals
  ResolversDef,
  ResolverContext,
  ResolverStatus,
  BatchItemResult,
  BatchResolveResults,
  TypedResolverContext,
  TypedResolverDef,
  TypedResolversDef,
  // Plugin internals
  ReconcileResult,
  RecoveryStrategy,
  // Error internals
  ErrorSource,
  RetryLaterConfig,
  // Events internals
  EventsDef,
  SystemEvent,
  EventsAccessorFromSchema,
  DispatchEventsFromSchema,
  FlexibleEventHandler,
  TypedEventsDef,
  // System internals
  DistributableSnapshotOptions,
  DistributableSnapshot,
  HistoryConfig,
  SnapshotMeta,
  RequirementExplanation,
  TraceConfig,
  // Accessor types
  DeriveAccessor,
  EventsAccessor,
  FactKeys,
  FactReturnType,
  DerivationKeys,
  DerivationReturnType,
  ObservableKeys,
  // Runtime control types
  ConstraintsControl,
  DerivationsControl,
  EffectsControl,
  ResolversControl,
  // Typed helper utilities
  TypedConstraint,
  TypedResolver,
  // Cross-module composition internals
  NamespacedFacts,
  MutableNamespacedFacts,
  NamespacedDerivations,
  UnionEvents,
  NamespacedEventsAccessor,
  CrossModuleFactsWithSelf,
  CrossModuleDerivationFn,
  CrossModuleDerivationsDef,
  CrossModuleConstraintDef,
  CrossModuleConstraintsDef,
  CrossModuleEffectDef,
  CrossModuleEffectsDef,
} from "./core/types.js";

// Factory functions (also available from main entry as typedConstraint/typedResolver)
export {
  createConstraintFactory,
  createResolverFactory,
} from "./core/types.js";

// Shared utilities
export {
  safeStringify,
  hashObject,
  stableStringify,
  isPrototypeSafe,
} from "./utils/utils.js";

/**
 * Heuristic detector for catastrophic-backtracking regex patterns.
 *
 * Returns true for nested quantifiers like `(a+)+$`, `(.*)*`, `(\w+)+`,
 * and `(a|a)+` — patterns that can cause ReDoS at the database / regex
 * engine. Used internally to reject `$matches` operands that ship a
 * pathological pattern.
 *
 * @internal Defensive helper, not a primary public API. Subject to the
 * `@directive-run/core/internals` no-semver guarantee.
 */
export { dangerousRegex } from "./core/predicate.js";
