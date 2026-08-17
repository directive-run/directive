/**
 * Plugin Types - Type definitions for plugins
 */

import type { DirectiveError, RecoveryStrategy } from "./errors.js";
import type { FactChange, FactsSnapshot } from "./facts.js";
import type { ClauseResult } from "./predicate.js";
import type { RequirementWithId } from "./requirements.js";
import type { ModuleSchema } from "./schema.js";
import type { System, TraceEntry } from "./system.js";

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
   * @param whenExplain - For data-form constraints, the per-clause breakdown
   *   (which clauses passed, which failed, against what fact values). Omitted
   *   for function-form `when`.
   */
  onConstraintEvaluate?: (
    id: string,
    active: boolean,
    whenExplain?: ClauseResult[],
  ) => void;

  /**
   * Called when a constraint's `when` function throws an error.
   * @param id - The constraint ID
   * @param error - The error that was thrown
   */
  onConstraintError?: (id: string, error: unknown) => void;

  /**
   * Called when the engine silently disables a constraint's `abortOn:`
   * binding because the constraint is async. Pairs with the dev-mode
   * `console.warn` for SIEM-side visibility — without this signal, a
   * production constraint loses its clobber-protection with no
   * plugin / observer trail.
   *
   * - `"async-declared"` — the constraint def has `async: true`. The
   *   author opted in; treat as advisory.
   * - `"async-promoted"` — the constraint's `when()` returned a Promise
   *   at runtime, even though `async: true` was not set. The author
   *   probably did not realize. This is the dangerous case — escalate.
   *
   * Fired at most once per `getConstraintBinding` lookup; deduping
   * across reconcile ticks is the consumer's responsibility (the
   * audit-ledger plugin does this with a per-id sticky bit).
   *
   * @param id - The constraint ID whose binding was disabled
   * @param reason - Whether the async state was author-declared or runtime-promoted
   */
  onConstraintBindingDisabled?: (
    id: string,
    reason: "async-declared" | "async-promoted",
  ) => void;

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

  /**
   * Called when a resolver's write is rejected by the runtime. The only
   * `reason` today is `"clobbered"`: a bound resolver (RFC-0003) dropped a
   * write to an abort-bound fact (one listed in the constraint's
   * `abortOn:`) because the fact was changed by something outside the
   * resolver between the resolver's baseline and its next write — the
   * resolver's `AbortController` is aborted in the same step. See
   * {@link createBoundFacts} for the per-fact optimistic-concurrency model.
   * `reason` keeps the hook backend-neutral.
   *
   * The `event` is a discriminated union on `kind`:
   * - `"rejection"` — a real per-write rejection; carries
   *   `fact`/`expected`/`actual`.
   * - `"summary"` — the per-resolver suppression summary, emitted once when a
   *   single resolver instance exceeds the per-instance write-rejection cap
   *   (10); carries `dropped` (the count of suppressed `"rejection"` events).
   *
   * @param event - The write-rejection event (discriminated on `kind`).
   *
   * @example
   * ```ts
   * const myPlugin: Plugin = {
   *   name: "write-rejection-logger",
   *   onResolverWriteRejected(event) {
   *     if (event.kind === "summary") {
   *       console.warn(`[${event.resolver}] suppressed ${event.dropped} write rejections`);
   *       return;
   *     }
   *     console.warn(`[clobber] ${event.resolver}: ${event.fact} expected=${JSON.stringify(event.expected)} actual=${JSON.stringify(event.actual)}`);
   *   },
   * };
   * ```
   */
  onResolverWriteRejected?: (
    event:
      | {
          kind: "rejection";
          resolver: string;
          req: RequirementWithId;
          reason: "clobbered";
          fact: string;
          expected: unknown;
          actual: unknown;
        }
      | {
          kind: "summary";
          resolver: string;
          req: RequirementWithId;
          reason: "clobbered";
          dropped: number;
        },
  ) => void;

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
  // Source Hooks
  // ============================================================================

  /**
   * Called when a typed external event source attaches at `system.start()`
   * (or when a dynamically registered module brings new sources to an
   * already-running system).
   * @param id - The source ID (key on the module's `sources:` map).
   * @param moduleId - The owning module's id.
   */
  onSourceAttach?: (id: string, moduleId: string) => void;

  /**
   * Called when a source publishes an event into the system's event queue.
   * Fires BEFORE the event handler runs. Pair with `onFactChange` to trace
   * the downstream state mutation.
   * @param id - The source ID.
   * @param moduleId - The owning module's id.
   * @param eventName - The dispatched event name (the first arg to `publish`).
   */
  onSourcePublish?: (id: string, moduleId: string, eventName: string) => void;

  /**
   * Called when the engine OR the manager rejects a source publish.
   * Pairs with `onSourcePublish` so observers see both halves of the
   * publish path without polling `inspect().sources[i].dropCount`.
   *
   * `reason` mirrors `SourceInspectionRow.lastDropReason`:
   * - `"post-destroy"` / `"post-stop"` — leaked transport firing after teardown
   * - `"blocked-event-name"` / `"invalid-event-name"` — engine guard probe
   * - `"coalesced"` — manager debounced an in-tick same-event publish
   *
   * @param id - The source ID.
   * @param moduleId - The owning module's id.
   * @param eventName - The dispatched event name (the first arg to `publish`).
   * @param reason - Why the publish was rejected.
   */
  onSourceDrop?: (
    id: string,
    moduleId: string,
    eventName: string,
    reason: import("./sources.js").SourceDropReason,
  ) => void;

  /**
   * Called when a source detaches at `system.stop()` (reverse-registration
   * order across all modules).
   * @param id - The source ID.
   * @param moduleId - The owning module's id.
   */
  onSourceDetach?: (id: string, moduleId: string) => void;

  /**
   * Called when a source's `attach` or unsubscribe throws. Errors are
   * isolated (one bad source never blocks others) but observable here.
   * @param id - The source ID.
   * @param moduleId - The owning module's id.
   * @param phase - Which lifecycle stage threw.
   * @param error - The thrown value (normalized to Error inside the manager).
   */
  onSourceError?: (
    id: string,
    moduleId: string,
    phase: "attach" | "cleanup" | "runtime" | "gate",
    error: unknown,
  ) => void;

  // ============================================================================
  // Guardrail Hooks (RFC 0010)
  // ============================================================================

  /**
   * Called when a guardrail plugin (e.g. `createFactPIIGuardrail`)
   * detects a violation on an incoming value AND takes an action.
   * Surfaces as the `"guardrail.blocked"` `ObservationEvent` for
   * `system.observe()` subscribers + OTel / timeline / audit-ledger
   * backends. The guardrail's user-callback (`onBlocked`) still
   * fires independently; this hook is for backend wiring that should
   * not coordinate with consumer callbacks.
   *
   * @param plugin - The guardrail plugin's name (so observers can
   *   correlate across multiple guardrails in the same system).
   * @param key - The fact key the violation was found in.
   * @param kind - The action the guardrail took:
   *   `"redact"` (rewrote the value via a follow-up store write),
   *   `"alert"` (observed but did not mutate), or
   *   `"detect"` (observed but could not mutate — e.g. read-only
   *   structured types like `Error`).
   *
   *   **Note:** `Error`-typed fact values always surface as `"detect"`
   *   regardless of the guardrail's configured mode — the walker
   *   matches `Error.message`/`.cause` but cannot mint a redacted
   *   Error with guaranteed `.stack` parity. A subscriber counting
   *   PII redactions should treat `kind === "redact"` and
   *   `kind === "detect"` equivalently for compliance-incident
   *   counts.
   * @param count - Number of pattern matches in this batch.
   * @param category - Optional coarse classifier the guardrail
   *   provides so OTel exporters can label spans without parsing
   *   payloads.
   */
  onGuardrailBlocked?: (
    plugin: string,
    key: string,
    kind: "redact" | "alert" | "detect",
    count: number,
    category?: string,
  ) => void;

  /**
   * Called when a guardrail reports what it covers, rather than what it caught.
   *
   * `onGuardrailBlocked` fires on a match, so a guardrail covering nothing and
   * one covering everything cleanly are indistinguishable — both are silent.
   * This fires when a guardrail starts and whenever the answer it works from
   * changes, which makes the difference visible without a per-write metric.
   *
   * `screenedDigest` is a digest of the covered keys, not the keys: their names
   * are part of what is being protected.
   */
  onGuardrailCoverage?: (
    plugin: string,
    screenedCount: number,
    screenedDigest: string,
    reason: "start" | "tags-changed" | "unanswerable",
  ) => void;

  // ============================================================================
  // Clobber Loop Hooks (v1.23.0)
  // ============================================================================

  /**
   * Called when `clobberLoopPlugin` (or any equivalent detector) publishes
   * a structured loop event through `system.notify.clobberLoopDetected(...)`.
   * Surfaces as the `"resolver.clobber.loop.detected"` `ObservationEvent`
   * for `system.observe()` subscribers + audit-ledger + devtools, so
   * downstream backends can capture loops without taking a direct
   * dependency on `clobberLoopPlugin`.
   */
  onClobberLoopDetected?: (
    event: import("./system.js").ObservationEvent & {
      type: "resolver.clobber.loop.detected";
    },
  ) => void;

  /**
   * Called when a previously-detected loop is considered resolved (quiet
   * window elapsed, participant unregistered, or predicate narrowed).
   * Pairs with `onClobberLoopDetected` so dashboards can show "active
   * loops" rather than "historical loops."
   */
  onClobberLoopResolved?: (
    event: import("./system.js").ObservationEvent & {
      type: "resolver.clobber.loop.resolved";
    },
  ) => void;

  // ============================================================================
  // History Hooks
  // ============================================================================

  /**
   * Called when a history snapshot is taken.
   * @param snapshot - The snapshot that was captured
   */
  onSnapshot?: (snapshot: Snapshot) => void;

  /**
   * Called when history navigation occurs (undo/redo/goTo).
   * @param from - The index we navigated from
   * @param to - The index we navigated to
   */
  onHistoryNavigate?: (from: number, to: number) => void;

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
  onDefinitionAssign?: (
    type: string,
    id: string,
    def: unknown,
    original: unknown,
  ) => void;

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
  // Trace Hooks
  // ============================================================================

  /**
   * Called when a trace entry finalizes (all resolvers settled or no resolvers started).
   * Only fires when trace is enabled.
   * @param entry - The complete trace entry
   */
  onTraceComplete?: (entry: TraceEntry) => void;
}
