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
  InferSelectorState,
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

// Meta types
export type { DefinitionMeta } from "./meta.js";
export { freezeMeta, isDerivationWithMeta } from "./meta.js";

// Derivation types
export type {
  DerivationDef,
  DerivationsDef,
  DerivationDefWithMeta,
  DerivationDefOrMeta,
  DerivedValues,
  DerivationState,
} from "./derivations.js";

// Effect types
export type { EffectDef, EffectsDef, EffectCleanup } from "./effects.js";

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
  BatchItemResult,
  BatchResolveResults,
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
export type {
  ErrorSource,
  RecoveryStrategy,
  ErrorBoundaryConfig,
  RetryLaterConfig,
} from "./errors.js";

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
  // Cross-module typed definitions
  CrossModuleDerivationFn,
  CrossModuleDerivationsDef,
  CrossModuleConstraintDef,
  CrossModuleConstraintsDef,
  CrossModuleEffectDef,
  CrossModuleEffectsDef,
} from "./module.js";

// System types
export type {
  // Accessors
  DeriveAccessor,
  EventsAccessor,
  MetaAccessor,
  MetaMatch,
  DirectiveObservationEvent,
  FactKeys,
  FactReturnType,
  DerivationKeys,
  DerivationReturnType,
  ObservableKeys,
  // History & trace
  HistoryConfig,
  HistoryOption,
  TraceConfig,
  TraceOption,
  HistoryAPI,
  HistoryState,
  SnapshotMeta,
  // Inspection
  SystemInspection,
  RequirementExplanation,
  SystemSnapshot,
  // Distributable snapshots
  DistributableSnapshotOptions,
  DistributableSnapshot,
  // Trace entries
  TraceEntry,
  // Runtime controls
  ConstraintsControl,
  DerivationsControl,
  EffectsControl,
  ResolversControl,
  // Dynamic definition types
  DynamicConstraintDef,
  DynamicEffectDef,
  DynamicResolverDef,
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
  createConstraintFactory,
  createResolverFactory,
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

// Composition types for multi-module systems
export type {
  // Cross-module type helpers (for module-level type hints)
  SchemasMap,
  CrossModuleFacts,
  CrossModuleDerivations,
  // Cross-module dependencies (for module-level crossModuleDeps)
  CrossModuleDeps,
  CrossModuleFactsWithSelf,
  // System composition types
  ExtractSchema,
  ModulesMap,
  NamespacedFacts,
  MutableNamespacedFacts,
  NamespacedDerivations,
  UnionEvents,
  CreateSystemOptionsNamed,
  NamespacedSystem,
  NamespacedEventsAccessor,
  MergedModuleSchema,
  // Single module types (no namespace)
  CreateSystemOptionsSingle,
  SingleModuleSystem,
  // Type guards
  SystemMode,
  AnySystem,
} from "./composition.js";

// Type guard functions
export { isSingleModuleSystem, isNamespacedSystem } from "./composition.js";
