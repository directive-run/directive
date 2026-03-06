/**
 * Plugin Types - Type definitions for plugins
 */

import type { DirectiveError, RecoveryStrategy } from "./errors.js";
import type { FactChange, FactsSnapshot } from "./facts.js";
import type { RequirementWithId } from "./requirements.js";
import type { ModuleSchema } from "./schema.js";
import type { RunChangelogEntry, System } from "./system.js";

// ============================================================================
// Plugin Hook Types
// ============================================================================

/** Reconcile result */
export interface ReconcileResult {
  unmet: RequirementWithId[];
  inflight: Array<{ id: string; resolverId: string; startedAt: number }>;
  completed: Array<{ id: string; resolverId: string; duration: number }>;
  canceled: Array<{ id: string; resolverId: string }>;
}

/** Snapshot for time-travel */
export interface Snapshot {
  id: number;
  timestamp: number;
  facts: Record<string, unknown>;
  trigger: string;
}

// ============================================================================
// Plugin Interface
// ============================================================================

/**
 * Plugin interface for extending Directive functionality.
 *
 * Plugins receive lifecycle hooks at every stage of the system's operation.
 * All hooks except `onInit` are synchronous - use them for logging, metrics,
 * or triggering external effects, not for async operations that should block.
 */
export interface Plugin<M extends ModuleSchema = ModuleSchema> {
  /** Unique name for this plugin (used in error messages and debugging) */
  name: string;

  // ============================================================================
  // Lifecycle Hooks
  // ============================================================================

  /**
   * Called once when the system is created, before start().
   * This is the only async hook - use it for async initialization.
   * @param system - The system instance
   */
  onInit?: (system: System<M>) => void | Promise<void>;

  /**
   * Called when system.start() is invoked.
   * Module init functions have already run at this point.
   * @param system - The system instance
   */
  onStart?: (system: System<M>) => void;

  /**
   * Called when system.stop() is invoked.
   * All resolvers have been canceled at this point.
   * @param system - The system instance
   */
  onStop?: (system: System<M>) => void;

  /**
   * Called when system.destroy() is invoked.
   * Use for final cleanup (closing connections, etc.).
   * @param system - The system instance
   */
  onDestroy?: (system: System<M>) => void;

  // ============================================================================
  // Fact Hooks
  // ============================================================================

  /**
   * Called when a single fact is set (not during batch).
   * @param key - The fact key that changed
   * @param value - The new value
   * @param prev - The previous value (undefined if new)
   */
  onFactSet?: (key: string, value: unknown, prev: unknown) => void;

  /**
   * Called when a fact is deleted.
   * @param key - The fact key that was deleted
   * @param prev - The previous value
   */
  onFactDelete?: (key: string, prev: unknown) => void;

  /**
   * Called after a batch of fact changes completes.
   * Use this instead of onFactSet for batched operations.
   * @param changes - Array of all changes in the batch
   */
  onFactsBatch?: (changes: FactChange[]) => void;

  // ============================================================================
  // Derivation Hooks
  // ============================================================================

  /**
   * Called when a derivation is computed (or recomputed).
   * @param id - The derivation ID
   * @param value - The computed value
   * @param deps - Array of fact keys this derivation depends on
   */
  onDerivationCompute?: (id: string, value: unknown, deps: string[]) => void;

  /**
   * Called when a derivation is invalidated (marked stale).
   * The derivation will be recomputed on next access.
   * @param id - The derivation ID
   */
  onDerivationInvalidate?: (id: string) => void;

  // ============================================================================
  // Reconciliation Hooks
  // ============================================================================

  /**
   * Called at the start of each reconciliation loop.
   * @param snapshot - Read-only snapshot of current facts
   */
  onReconcileStart?: (snapshot: FactsSnapshot<M["facts"]>) => void;

  /**
   * Called at the end of each reconciliation loop.
   * @param result - Summary of what happened (unmet, inflight, completed, canceled)
   */
  onReconcileEnd?: (result: ReconcileResult) => void;

  // ============================================================================
  // Constraint Hooks
  // ============================================================================

  /**
   * Called after a constraint's `when` function is evaluated.
   * @param id - The constraint ID
   * @param active - Whether the constraint is active (when returned true)
   */
  onConstraintEvaluate?: (id: string, active: boolean) => void;

  /**
   * Called when a constraint's `when` function throws an error.
   * @param id - The constraint ID
   * @param error - The error that was thrown
   */
  onConstraintError?: (id: string, error: unknown) => void;

  // ============================================================================
  // Requirement Hooks
  // ============================================================================

  /**
   * Called when a new requirement is created by a constraint.
   * @param req - The requirement with its computed ID
   */
  onRequirementCreated?: (req: RequirementWithId) => void;

  /**
   * Called when a requirement is fulfilled by a resolver.
   * @param req - The requirement that was met
   * @param byResolver - The ID of the resolver that fulfilled it
   */
  onRequirementMet?: (req: RequirementWithId, byResolver: string) => void;

  /**
   * Called when a requirement is canceled (constraint no longer active).
   * @param req - The requirement that was canceled
   */
  onRequirementCanceled?: (req: RequirementWithId) => void;

  // ============================================================================
  // Resolver Hooks
  // ============================================================================

  /**
   * Called when a resolver starts processing a requirement.
   * @param resolver - The resolver ID
   * @param req - The requirement being resolved
   */
  onResolverStart?: (resolver: string, req: RequirementWithId) => void;

  /**
   * Called when a resolver successfully completes.
   * @param resolver - The resolver ID
   * @param req - The requirement that was resolved
   * @param duration - Time in ms to complete
   */
  onResolverComplete?: (
    resolver: string,
    req: RequirementWithId,
    duration: number,
  ) => void;

  /**
   * Called when a resolver fails (after all retries exhausted).
   * @param resolver - The resolver ID
   * @param req - The requirement that failed
   * @param error - The final error
   */
  onResolverError?: (
    resolver: string,
    req: RequirementWithId,
    error: unknown,
  ) => void;

  /**
   * Called when a resolver is about to retry after failure.
   * @param resolver - The resolver ID
   * @param req - The requirement being retried
   * @param attempt - The attempt number (2 for first retry, etc.)
   */
  onResolverRetry?: (
    resolver: string,
    req: RequirementWithId,
    attempt: number,
  ) => void;

  /**
   * Called when a resolver is canceled (requirement no longer needed).
   * @param resolver - The resolver ID
   * @param req - The requirement that was canceled
   */
  onResolverCancel?: (resolver: string, req: RequirementWithId) => void;

  // ============================================================================
  // Effect Hooks
  // ============================================================================

  /**
   * Called when an effect runs.
   * @param id - The effect ID
   */
  onEffectRun?: (id: string) => void;

  /**
   * Called when an effect throws an error.
   * @param id - The effect ID
   * @param error - The error that was thrown
   */
  onEffectError?: (id: string, error: unknown) => void;

  // ============================================================================
  // Time-Travel Hooks
  // ============================================================================

  /**
   * Called when a time-travel snapshot is taken.
   * @param snapshot - The snapshot that was captured
   */
  onSnapshot?: (snapshot: Snapshot) => void;

  /**
   * Called when time-travel navigation occurs.
   * @param from - The index we navigated from
   * @param to - The index we navigated to
   */
  onTimeTravel?: (from: number, to: number) => void;

  // ============================================================================
  // Error Boundary Hooks
  // ============================================================================

  /**
   * Called when any error occurs in the system.
   * @param error - The DirectiveError with source and context
   */
  onError?: (error: DirectiveError) => void;

  /**
   * Called when error recovery is attempted.
   * @param error - The error that triggered recovery
   * @param strategy - The recovery strategy used
   */
  onErrorRecovery?: (error: DirectiveError, strategy: RecoveryStrategy) => void;

  // ============================================================================
  // Dynamic Definition Hooks
  // ============================================================================

  /**
   * Called when a definition is dynamically registered at runtime.
   * @param type - The definition type: "constraint", "resolver", "derivation", or "effect"
   * @param id - The definition ID
   * @param def - The definition object
   */
  onDefinitionRegister?: (type: string, id: string, def: unknown) => void;

  /**
   * Called when a definition is assigned (overridden) at runtime.
   * @param type - The definition type: "constraint", "resolver", "derivation", or "effect"
   * @param id - The definition ID
   * @param def - The new definition object
   * @param original - The previous definition that was overridden
   */
  onDefinitionAssign?: (type: string, id: string, def: unknown, original: unknown) => void;

  /**
   * Called when a dynamically registered definition is removed.
   * @param type - The definition type: "constraint", "resolver", "derivation", or "effect"
   * @param id - The definition ID
   */
  onDefinitionUnregister?: (type: string, id: string) => void;

  /**
   * Called when a definition is manually invoked via `call()`.
   * @param type - The definition type: "constraint", "resolver", "derivation", or "effect"
   * @param id - The definition ID
   * @param props - Optional props passed to the call
   */
  onDefinitionCall?: (type: string, id: string, props?: unknown) => void;

  // ============================================================================
  // Run History Hooks
  // ============================================================================

  /**
   * Called when a run finalizes (all resolvers settled or no resolvers started).
   * Only fires when debug.runHistory is enabled.
   * @param run - The complete run changelog entry
   */
  onRunComplete?: (run: RunChangelogEntry) => void;
}
