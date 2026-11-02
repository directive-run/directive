export {
  createGraph,
  Flags,
  Graph,
  Link,
  ReactiveNode,
} from "./graph.js";
export type {
  Equals,
  GraphOptions,
  NodeOptions,
  TrackOptions,
} from "./graph.js";
export { LANES, browserHosts, createScheduler } from "./scheduler.js";
export type {
  HostCallback,
  Lane,
  Scheduler,
  SchedulerOptions,
  SchedulerTarget,
} from "./scheduler.js";
export { createClock, createRng, createVirtualClock } from "./clock.js";
export type {
  Clock,
  RealClockOptions,
  Rng,
  TimerOptions,
  TimerRecord,
  VirtualClock,
} from "./clock.js";
export { KERNEL_VERSION, createKernel, serializeEvent } from "./kernel.js";
export type {
  EventKind,
  Hooks,
  Kernel,
  KernelEvent,
  KernelFeatures,
  KernelOptions,
  Listener,
} from "./kernel.js";
export { PHASES, withPhases } from "./phases.js";
export type { Ctx, Phase, Phases } from "./phases.js";
export { withSnapshot } from "./snapshot.js";
// The kernel snapshot, renamed: `Snapshot` is 1.35's plugin snapshot below.
export type { Snapshot as KernelSnapshot, SnapshotPart } from "./snapshot.js";

// The 1.35 public API (alphas keep it unchanged), built on the graph above.
export {
  DirectiveError,
  createModule,
  createModuleFactory,
  createSystem,
} from "./api/system.js";
export type { ErrorHandler } from "./api/errors.js";
export {
  RequirementSet,
  forType,
  generateRequirementId,
  isRequirementType,
  req,
} from "./api/requirements.js";
export { t } from "./api/schema-builders.js";
// Schema introspection (L6, B5): root exports only, so a system that does
// not call them bundles none of it.
export {
  getKind,
  getOperatorsForKind,
  getSchemaFieldKinds,
  listAllPredicateOperators,
} from "./api/schema-introspection.js";
export type {
  SchemaKind,
  SchemaKindNode,
} from "./api/schema-introspection.js";
export type * from "./api/schema-builders.js";
// core-next's own option and module types (not in 1.35).
export type {
  EventPayload,
  ModuleDefinition,
  ModuleFacts,
  SystemOptions,
} from "./api/types.js";
// 1.35's public types, exactly: copied from 1.35 into src/types/ (types only).
// Some describe features core-next has not built yet; see createSystem.
export type {
  AuditEntry,
  AuditEntryKind,
  AuditLedger,
  AuditLedgerOptions,
  AuditLedgerSink,
  QueryFilter,
  VerifyResult,
} from "./types/audit-ledger.js";
export type {
  CheckAbortOnFinding,
  CheckAbortOnResult,
  CheckAgainstResult,
  Contradiction,
  ContradictionType,
  ExistingConstraint,
} from "./types/doctor.js";
export type {
  AnySystem,
  BatchConfig,
  ClauseResult,
  CreateSystemOptionsNamed,
  CreateSystemOptionsSingle,
  CrossModuleDeps,
  CrossModuleResolverContext,
  CrossModuleResolversDef,
  DefinitionKind,
  DefinitionMeta,
  DerivationDefWithMeta,
  DistributableSnapshot,
  DistributableSnapshotOptions,
  DynamicConstraintDef,
  DynamicDefinitionKind,
  DynamicEffectDef,
  DynamicResolverDef,
  EffectDef,
  ErrorBoundaryConfig,
  ErrorSource,
  FactChange,
  FactOrigin,
  FactPredicate,
  FactTemplate,
  Facts,
  FactsSnapshot,
  FactsStore,
  HistoryAPI,
  HistoryOption,
  HistoryState,
  InferDerivations,
  InferEvents,
  InferFacts,
  InferRequirementTypes,
  InferRequirements,
  InferSchema,
  InferSchemaType,
  InferSelectorState,
  KeySelector,
  MetaAccessor,
  MetaMatch,
  ModuleDef,
  ModuleHooks,
  ModuleSchema,
  ModulesMap,
  NamespacedSystem,
  ObservationEvent,
  OperatorObject,
  PatchSpec,
  PatchValue,
  PayloadRef,
  Plugin,
  PredicateClause,
  PredicateCombinator,
  PredicateCombinatorKey,
  PredicateObject,
  PredicateOp,
  PredicateOverlapProof,
  RecoveryStrategy,
  Requirement,
  RequirementKeyFn,
  RequirementWithId,
  ResolverAbortReason,
  ResolverDeps,
  RetryLaterConfig,
  RetryPolicy,
  Schema,
  SchemaType,
  ShouldRetryContext,
  SingleModuleSystem,
  Snapshot,
  SourceDef,
  SourceDropReason,
  SourceGateFacts,
  SourcePublish,
  SourceReportError,
  SourceUnsubscribe,
  SourcesDef,
  System,
  SystemConfig,
  SystemDerived,
  SystemEvent,
  SystemFacts,
  SystemInspection,
  SystemMode,
  SystemSnapshot,
  TraceEntry,
  TraceOption,
} from "./types/index.js";
export type {
  ModuleConfig,
  ModuleConfigWithDeps,
} from "./types/module-config.js";
export type { DescribeOptions } from "./types/predicate-describe.js";
export type { PredicateToMongoOptions } from "./types/predicate-to-mongo.js";
export type { PredicateToPostgrestOptions } from "./types/predicate-to-pgrest.js";
export type {
  PredicateToSqlOptions,
  PredicateToSqlResult,
} from "./types/predicate-to-sql.js";
export type {
  SchemaValidationError,
  SchemaValidationOptions,
  SchemaValidationResult,
} from "./types/predicate-validation.js";
export type {
  PredictMissingChange,
  PredictResult,
} from "./types/predict.js";
export type {
  PredicateBacktestReport,
  ReplayDiffSample,
  ReplayFrame,
  ReplayUnderOptions,
} from "./types/replay-under.js";
export type { RequirementTypeStatus } from "./types/requirement-status.js";
export type {
  Change,
  ChangeKind,
  ConstraintDiff,
  ConstraintStatus,
  DiffRulesOptions,
  LeafClause,
  RulesDiffReport,
  RulesMapInput,
} from "./types/rules-diff.js";
export type {
  DistributableSnapshotLike,
  SignedSnapshot,
  SnapshotDiff,
  SnapshotDiffEntry,
} from "./types/snapshot-utils.js";
export type {
  SweepHole,
  SweepPoint,
  SweepReport,
  SweepUnderOptions,
} from "./types/sweep-under.js";
export {
  completeTimer,
  elapsedMs,
  initialTimerState,
  pauseTimer,
  registerRepeat,
  remainingMs,
  resetTimer,
  resumeTimer,
  startTimer,
  tickTimer,
  timerOps,
} from "./api/timer.js";
export type { TimerFactOpts, TimerFactState } from "./api/timer.js";
export { defaultClock, realClock, virtualClock } from "./api/clock.js";
export type { SignalClock } from "./api/clock.js";
