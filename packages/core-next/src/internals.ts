/**
 * `@directive-run/core/internals`: the managers behind the public API, as far
 * as core-next builds them. No semver promise, as in 1.35.
 */

export {
  BLOCKED_PROPS,
  createFactsProxy,
  isRunawayError,
} from "./api/facts.js";
export type { CreateFactsStoreOptions, Tracker } from "./api/facts.js";
export { createFacts, createFactsStore } from "./api/validate.js";
export type { StoreOptions, ValidatorOptions } from "./api/validate.js";
export { createEffectsManager } from "./api/effects.js";
export type { CreateEffectsOptions, EffectsManager } from "./api/effects.js";

// 1.35's public types for this entry, exactly: copied from 1.35 into
// src/types/ (types only, no runtime code).
export type {
  BatchItemResult,
  BatchResolveResults,
  ConstraintState,
  ConstraintsControl,
  ConstraintsDef,
  CrossModuleConstraintDef,
  CrossModuleConstraintsDef,
  CrossModuleDerivationFn,
  CrossModuleDerivationsDef,
  CrossModuleEffectDef,
  CrossModuleEffectsDef,
  CrossModuleFactsWithSelf,
  DerivationKeys,
  DerivationReturnType,
  DerivationState,
  DerivationsControl,
  DerivationsDef,
  DerivationsSchema,
  DeriveAccessor,
  DerivedValues,
  DispatchEventsFromSchema,
  DistributableSnapshot,
  DistributableSnapshotOptions,
  EffectCleanup,
  EffectsControl,
  EffectsDef,
  ErrorSource,
  EventPayloadSchema,
  EventsAccessor,
  EventsAccessorFromSchema,
  EventsDef,
  EventsSchema,
  FactChange,
  FactKeys,
  FactReturnType,
  FactsStore,
  FlexibleEventHandler,
  HistoryConfig,
  InferEventPayloadFromSchema,
  InferRequirementPayloadFromSchema,
  InferSchema,
  MutableNamespacedFacts,
  NamespacedDerivations,
  NamespacedEventsAccessor,
  NamespacedFacts,
  ObservableKeys,
  ReconcileResult,
  RecoveryStrategy,
  RequirementExplanation,
  RequirementKeyFn,
  RequirementOutput,
  RequirementPayloadSchema,
  RequirementsSchema,
  ResolverContext,
  ResolverStatus,
  ResolversControl,
  ResolversDef,
  RetryLaterConfig,
  SnapshotMeta,
  SystemEvent,
  TraceConfig,
  TypedConstraint,
  TypedConstraintDef,
  TypedConstraintsDef,
  TypedDerivationsDef,
  TypedEventsDef,
  TypedResolver,
  TypedResolverContext,
  TypedResolverDef,
  TypedResolversDef,
  UnionEvents,
} from "./types/index.js";
export type { PendingRetry } from "./types/internals-errors.js";
export type { InflightInfo } from "./types/internals-resolvers.js";
export type {
  SourceDispatch,
  SourceDispatchResult,
  SourceInspectionRow,
  SourceLastError,
  SourcesManager,
  SourcesManagerCallbacks,
} from "./types/internals-sources.js";
