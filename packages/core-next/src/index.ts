// Only 1.35's public names, entry by entry (contracts/api-surface.json; some
// are not built yet): the alphas promise the 1.35 API, and an addition needs
// a signed api-changes.json entry. The kernel layer (graph, scheduler, clock, kernel,
// phases, snapshot) and core-next's own option types stay internal: import
// them from their modules (bench/entry-ours.mjs reads dist/graph.js, a
// private build output that is not in the package's exports).
//
// These modules are still evaluated first, as when the root exported them:
// a bundle keeps its module order, so its bytes do not move.
import "./graph.js";
import "./scheduler.js";
import "./clock.js";
import "./kernel.js";
import "./phases.js";
import "./snapshot.js";
export {
  DirectiveError,
  createModule,
  createModuleFactory,
  createSystem,
} from "./api/system.js";
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
export type {
  Branded,
  ChainableArrayType,
  ChainableNumberType,
  ChainableObjectType,
  ChainableSchemaType,
  ChainableStringType,
  ExtendedSchemaType,
} from "./api/schema-builders.js";
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
  ErrorBoundaryConfig,
  FactPredicate,
  FactTemplate,
  Facts,
  FactsSnapshot,
  HistoryAPI,
  HistoryOption,
  HistoryState,
  InferDerivations,
  InferEvents,
  InferFacts,
  InferRequirementTypes,
  InferRequirements,
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
  Requirement,
  RequirementWithId,
  ResolverAbortReason,
  ResolverDeps,
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
