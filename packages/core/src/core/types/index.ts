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

// Data-configuration predicates and templates
export type {
  ClauseResult,
  FactPredicate,
  FactTemplate,
  KeySelector,
  OperatorObject,
  PatchSpec,
  PayloadRef,
  PredicateClause,
  PredicateCombinator,
  PredicateCombinatorKey,
  PredicateObject,
  PredicateOp,
  PatchValue,
} from "./predicate.js";
// PREDICATE_COMBINATORS / PREDICATE_OPERATORS are @internal — not re-exported.

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

// Source types — typed external event sources (inbound dual of effects).
export type {
  SourceDef,
  SourcesDef,
  SourcePublish,
  SourceUnsubscribe,
} from "./sources.js";

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
  JitterStrategy,
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
  ObservationEvent,
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
  // Schema-extraction helpers for adapter authors
  SystemFacts,
  SystemDerived,
} from "./composition.js";

// Type guard functions
export { isSingleModuleSystem, isNamespacedSystem } from "./composition.js";

// ============================================================================
// RFC 0006 — `*Definition` aliases for the `*Def` cohort
// ============================================================================
//
// These aliases let consumers migrate from the abbreviated `*Def` names
// to the spelled-out `*Definition` names today, without breaking
// change. The `*Def` types stay canonical through 1.x; 2.0 swaps which
// name is canonical and which is the deprecated alias.
//
// Rationale (per RFC 0006): `*Def` is an abbreviation. The workspace's
// own `anti-patterns.md` entry #5 forbids abbreviating `context` to
// `ctx`; the same logic applies to type names. Minifiers handle the
// bytes; source-code readability does not.
//
// The re-export-with-rename pattern (`export type { X as Y }`)
// preserves the underlying type's generic parameters and TS inference
// rules — `ModuleDefinition<S>` resolves identically to `ModuleDef<S>`
// in mapped types, conditional distribution, tagged-union literals,
// and barrel re-exports.

export type {
  ConstraintDef as ConstraintDefinition,
  ConstraintsDef as ConstraintsDefinition,
} from "./requirements.js";

export type {
  DerivationDef as DerivationDefinition,
  DerivationDefWithMeta as DerivationDefinitionWithMeta,
  DerivationsDef as DerivationsDefinition,
} from "./derivations.js";

export type {
  EffectDef as EffectDefinition,
  EffectsDef as EffectsDefinition,
} from "./effects.js";

export type { EventsDef as EventsDefinition } from "./events.js";

export type {
  ModuleDef as ModuleDefinition,
  TypedEventsDef as TypedEventsDefinition,
  TypedDerivationsDef as TypedDerivationsDefinition,
  TypedConstraintDef as TypedConstraintDefinition,
  TypedConstraintsDef as TypedConstraintsDefinition,
  TypedResolverDef as TypedResolverDefinition,
  TypedResolversDef as TypedResolversDefinition,
  CrossModuleConstraintDef as CrossModuleConstraintDefinition,
  CrossModuleConstraintsDef as CrossModuleConstraintsDefinition,
  CrossModuleEffectDef as CrossModuleEffectDefinition,
  CrossModuleEffectsDef as CrossModuleEffectsDefinition,
  CrossModuleDerivationsDef as CrossModuleDerivationsDefinition,
} from "./module.js";

export type {
  ResolverDef as ResolverDefinition,
  ResolversDef as ResolversDefinition,
  SchemaTypedResolversDef as SchemaTypedResolversDefinition,
} from "./resolvers.js";

export type {
  DynamicConstraintDef as DynamicConstraintDefinition,
  DynamicResolverDef as DynamicResolverDefinition,
} from "./system.js";

export type {
  SourceDef as SourceDefinition,
  SourcesDef as SourcesDefinition,
  SourcePublish as SourcePublishFn,
  SourceUnsubscribe as SourceUnsubscribeFn,
} from "./sources.js";
