/**
 * @directive-run/core
 *
 * Constraint-driven runtime for TypeScript.
 *
 * Also available:
 * - `@directive-run/core/internals` – Manager factories, engine, tracking, and internal types
 * - `@directive-run/core/plugins` – Logging, devtools, persistence, observability, circuit breaker
 * - `@directive-run/core/testing` – Mock resolvers, fake timers, assertion helpers
 * - `@directive-run/core/migration` – Redux/Zustand/XState migration scaffolding
 * - `@directive-run/core/adapter-utils` – Shared framework adapter utilities
 * - `@directive-run/core/worker` – Web Worker support
 *
 * @packageDocumentation
 */

// ============================================================================
// Core Types — what 90% of users need
// ============================================================================

export type {
  // Schema
  Schema,
  SchemaType,
  InferSchemaType,
  // Module Schema (consolidated)
  ModuleSchema,
  InferFacts,
  InferDerivations,
  InferSelectorState,
  InferEvents,
  InferRequirements,
  InferRequirementTypes,
  // Facts
  Facts,
  FactsSnapshot,
  // Requirements
  Requirement,
  RequirementWithId,
  // Constraints + Resolvers (config types)
  RetryPolicy,
  BatchConfig,
  // Plugins
  Plugin,
  Snapshot,
  // Errors
  ErrorBoundaryConfig,
  // Module
  ModuleDef,
  ModuleHooks,
  // System
  System,
  SystemConfig,
  SystemInspection,
  SystemSnapshot,
  MetaAccessor,
  MetaMatch,
  ObservationEvent,
  // Trace
  TraceEntry,
  TraceOption,
  // History
  HistoryOption,
  HistoryAPI,
  HistoryState,
  // Composition (Namespaced Multi-Module)
  ModulesMap,
  NamespacedSystem,
  CreateSystemOptionsNamed,
  // Single Module
  CreateSystemOptionsSingle,
  SingleModuleSystem,
  // Type Guards
  SystemMode,
  AnySystem,
  // Cross-Module Dependencies
  CrossModuleDeps,
  // Dynamic Definitions
  DynamicConstraintDef,
  DynamicEffectDef,
  DynamicResolverDef,
  // Definition Meta
  DefinitionMeta,
  DerivationDefWithMeta,
  // Data-configuration predicates and templates
  FactPredicate,
  FactTemplate,
  KeySelector,
  PatchSpec,
  PayloadRef,
  PatchValue,
  OperatorObject,
  PredicateObject,
  PredicateClause,
  PredicateCombinator,
  PredicateCombinatorKey,
  PredicateOp,
  ClauseResult,
  // Distributable Snapshots
  DistributableSnapshot,
  DistributableSnapshotOptions,
} from "./core/types.js";

// Predicate / template runtime
export {
  applyPatch,
  memoizePredicate,
  evaluateKeySelector,
  evaluatePredicate,
  evaluatePredicateExplained,
  evaluateTemplate,
  extractDeps,
  extractTemplateKeys,
  isPredicate,
  isTemplate,
  validatePredicate,
} from "./core/predicate.js";

// Predicate backtest — rule-change impact replay
export {
  MAX_REPLAY_FRAMES,
  framesFromHistory,
  framesFromSnapshots,
  replayUnder,
  toReplayFrames,
} from "./core/replay-under.js";
export type {
  PredicateBacktestReport,
  ReplayDiffSample,
  ReplayFrame,
  ReplayUnderOptions,
} from "./core/replay-under.js";

// Parameter sweep — grid-search predicate templates against recorded history
export { MAX_SWEEP_POINTS, sweepUnder } from "./core/sweep-under.js";
export type {
  SweepHole,
  SweepPoint,
  SweepReport,
  SweepUnderOptions,
} from "./core/sweep-under.js";

// Rules diff — structural diff of constraint whenSpec across two snapshots
export {
  diffClauses,
  diffRules,
  flattenPredicate,
  toRulesMap,
} from "./core/rules-diff.js";
export type {
  Change,
  ChangeKind,
  ConstraintDiff,
  ConstraintStatus,
  DiffRulesOptions,
  LeafClause,
  RulesDiffReport,
  RulesMapInput,
} from "./core/rules-diff.js";

// Schema introspection — runtime kind discriminant + operator matrix
export {
  getKind,
  getOperatorsForKind,
  getSchemaFieldKinds,
  listAllPredicateOperators,
} from "./core/schema-introspection.js";
export type {
  SchemaKind,
  SchemaKindNode,
} from "./core/schema-introspection.js";
export { validatePredicateAgainstSchema } from "./core/predicate.js";
export type {
  SchemaValidationError,
  SchemaValidationOptions,
  SchemaValidationResult,
} from "./core/predicate.js";

// predicateHash — content-addressed fingerprint for a FactPredicate
// (djb2 32-bit; SHA-256 reserved for v2)
export { predicateHash } from "./core/predicate-hash.js";

// predict — "would this predicate fire, and if not, which facts must change?"
export { predict } from "./core/predict.js";
export type { PredictMissingChange, PredictResult } from "./core/predict.js";

// doctor — structural contradiction detection between a candidate predicate and existing constraints
export { doctor } from "./core/doctor.js";
export type {
  CheckAgainstResult,
  CheckOwnsFinding,
  CheckOwnsResult,
  Contradiction,
  ContradictionType,
  ExistingConstraint,
} from "./core/doctor.js";

// createAuditLedger — append-only, queryable, hash-chained audit log (djb2; SHA-256 reserved for v2)
export {
  createAuditLedger,
  memorySink,
} from "./plugins/audit-ledger/index.js";
export type {
  AuditEntry,
  AuditEntryKind,
  AuditLedger,
  AuditLedgerOptions,
  AuditLedgerSink,
  QueryFilter,
  VerifyResult,
} from "./plugins/audit-ledger/index.js";

// describePredicate — render any FactPredicate as English / algebraic prose
export { describePredicate } from "./core/predicate-describe.js";
export type { DescribeOptions } from "./core/predicate-describe.js";

// Predicate codegen — one predicate, run on client AND server
export { predicateToSQL, predicateToWhere } from "./core/predicate-to-sql.js";
export type {
  PredicateToSqlOptions,
  PredicateToSqlResult,
} from "./core/predicate-to-sql.js";
export { predicateToMongo } from "./core/predicate-to-mongo.js";
export type { PredicateToMongoOptions } from "./core/predicate-to-mongo.js";
export { predicateToPostgrest } from "./core/predicate-to-pgrest.js";
export type { PredicateToPostgrestOptions } from "./core/predicate-to-pgrest.js";

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
 * import { t } from '@directive-run/core';
 *
 * const schema = {
 *   facts: {
 *     count: t.number().min(0).default(0),
 *     name: t.string(),
 *     status: t.enum("idle", "loading", "error"),
 *     user: t.object<User>().nullable(),
 *   },
 *   derivations: { doubled: t.number() },
 *   events: { increment: {} },
 *   requirements: { FETCH_USER: {} },
 * };
 * ```
 */
export {
  t,
  type Branded,
  type ExtendedSchemaType,
  type ChainableSchemaType,
} from "./core/schema-builders.js";

// ============================================================================
// Module & System
// ============================================================================

export {
  createModule,
  createModuleFactory,
  type ModuleConfig,
  type ModuleConfigWithDeps,
} from "./core/module.js";
export { createSystem } from "./core/system.js";
export { createSystemWithStatus } from "./utils/system-with-status.js";

// Helper factory functions for typed constraint/resolver definitions
export {
  typedConstraint,
  typedResolver,
} from "./core/types.js";

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
// Type Guards
// ============================================================================

export {
  isSingleModuleSystem,
  isNamespacedSystem,
} from "./core/types/composition.js";

// ============================================================================
// Constants
// ============================================================================

/**
 * Backoff strategy constants for retry policies.
 *
 * @example
 * ```ts
 * import { Backoff } from '@directive-run/core';
 *
 * retry: { attempts: 3, backoff: Backoff.Exponential, initialDelay: 100 }
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
// Requirement Status Utilities
// ============================================================================

export {
  createRequirementStatusPlugin,
  createStatusHook,
  type RequirementTypeStatus,
} from "./utils/requirement-status.js";

// ============================================================================
// Snapshot Utilities
// ============================================================================

export {
  shallowEqual,
  isSnapshotExpired,
  validateSnapshot,
  diffSnapshots,
  signSnapshot,
  verifySnapshotSignature,
  isSignedSnapshot,
  type DistributableSnapshotLike,
  type SnapshotDiff,
  type SnapshotDiffEntry,
  type SignedSnapshot,
} from "./utils/utils.js";

// ============================================================================
// Clock + Timer (RFC 0001 v0.1)
// ============================================================================

export {
  type SignalClock,
  realClock,
  virtualClock,
  defaultClock,
} from "./core/clock.js";

export {
  type TimerFactState,
  type TimerFactOpts,
  initialTimerState,
  elapsedMs,
  remainingMs,
  startTimer,
  pauseTimer,
  resumeTimer,
  resetTimer,
  completeTimer,
  registerRepeat,
  tickTimer,
  timerOps,
} from "./core/timer.js";

// ============================================================================
// Lower-level APIs — use "@directive-run/core/internals" for these
// ============================================================================
// Manager factories, engine, tracking, and internal types are available at:
//   import { createEngine, createFacts, withTracking } from "@directive-run/core/internals"
//
// Internal types (FactsStore, FactChange, DerivationState, ConstraintState,
// DerivationsDef, ConstraintsDef, ResolversDef, EventsDef, ReconcileResult,
// RecoveryStrategy, ErrorSource, etc.) are also in internals.

// Migration utilities available via "@directive-run/core/migration" subpath export.
