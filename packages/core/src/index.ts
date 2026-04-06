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
  DirectiveObservationEvent,
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
  // Distributable Snapshots
  DistributableSnapshot,
  DistributableSnapshotOptions,
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
// Lower-level APIs — use "@directive-run/core/internals" for these
// ============================================================================
// Manager factories, engine, tracking, and internal types are available at:
//   import { createEngine, createFacts, withTracking } from "@directive-run/core/internals"
//
// Internal types (FactsStore, FactChange, DerivationState, ConstraintState,
// DerivationsDef, ConstraintsDef, ResolversDef, EventsDef, ReconcileResult,
// RecoveryStrategy, ErrorSource, etc.) are also in internals.

// Migration utilities available via "@directive-run/core/migration" subpath export.
