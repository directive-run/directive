/**
 * Copied from 1.35 (packages/core/src/core/sources.ts): its type declarations only,
 * unchanged. Types, no runtime code.
 */

import type { SourceDef, SourceDropReason } from "./sources.js";

/**
 * Engine-side dispatcher invoked when a source publishes an event. The
 * manager wraps each source's publish callback in a closure that closes
 * over the source id + moduleId so the engine cannot mis-attribute
 * publishes (a naive "look up the source by event name" approach fails
 * when multiple sources publish the same event).
 *
 * Returns a {@link SourceDispatchResult} indicating whether the engine
 * accepted the publish. The manager uses the result to gate counter bumps
 * + `onPublish` plugin emission: an accepted publish bumps `publishCount`
 * and fires `onPublish`; a rejected publish bumps `dropCount` /
 * `lastDropReason` and stays out of the plugin hook (otherwise observers
 * would see "publish happened" for events the engine swallowed).
 */
export type SourceDispatch = (
  sourceId: string,
  moduleId: string,
  eventName: string,
  payload: unknown,
) => SourceDispatchResult;

/**
 * Outcome of a single source publish handed back to the manager. `"accepted"`
 * means the engine dispatched into the event handler chain. Rejection
 * reasons name the specific drop path so per-source telemetry can attribute
 * the drop precisely:
 *
 * - `"post-destroy"` — publish arrived after `system.destroy()`.
 * - `"post-stop"` — publish arrived between `system.stop()` and the next
 *   `system.start()`.
 * - `"blocked-event-name"` — event name was `__proto__` / `constructor` /
 *   `prototype` (BLOCKED_PROPS guard, parity with `system.dispatch`).
 * - `"invalid-event-name"` — event name was non-string or empty string.
 *
 * `eventName`, when present, is the name the engine dispatched (a namespaced
 * source's bare `START` becomes `loop::START`); counters and plugin hooks
 * report it in place of the name the source published.
 */
export type SourceDispatchResult =
  | { accepted: true; eventName?: string }
  | { accepted: false; reason: SourceDropReason; eventName?: string };

/**
 * Per-source lifecycle callbacks the engine wires into the plugin manager.
 * All are optional — manager-only consumers can omit them. The manager
 * GUARANTEES:
 *
 * - `onAttach(id, moduleId)` runs ONLY when `attach()` returned a function
 *   (i.e. the source successfully attached). Sources that threw or returned
 *   non-functions invoke `onError` instead.
 * - `onPublish(id, moduleId, eventName)` runs BEFORE the engine's dispatch,
 *   per publish call, with correct per-source attribution.
 * - `onDetach(id, moduleId)` runs BEFORE the source's unsubscribe is called
 *   so observers see the detach intent before any teardown side effects.
 *   (If unsubscribe throws, `onError` fires afterward.)
 * - `onError(id, moduleId, phase, error)` runs on attach OR cleanup failures.
 *   Always logged via `console.error` regardless of whether this callback
 *   is supplied.
 */
export interface SourcesManagerCallbacks {
  readonly onAttach?: (id: string, moduleId: string) => void;
  readonly onPublish?: (
    id: string,
    moduleId: string,
    eventName: string,
  ) => void;
  /**
   * Fires when the engine OR the manager rejects a publish. Mirrors
   * `onPublish` so plugin observers can pair every accepted publish
   * with the drop side without polling `inspect().sources[i].dropCount`.
   *
   * `reason` matches the value the manager writes to `lastDropReason`
   * on the inspect row. Use this hook to drive alerting (a source whose
   * `lastDropReason: "blocked-event-name"` is a misconfiguration; a
   * source whose `lastDropReason: "coalesced"` is publishing too fast).
   */
  readonly onDrop?: (
    id: string,
    moduleId: string,
    eventName: string,
    reason: SourceDropReason,
  ) => void;
  readonly onDetach?: (id: string, moduleId: string) => void;
  readonly onError?: (
    id: string,
    moduleId: string,
    phase: "attach" | "cleanup" | "runtime" | "gate",
    error: Error,
  ) => void;
}

export interface SourcesManager {
  registerDefinitions(
    moduleId: string,
    definitions: Record<string, SourceDef>,
  ): void;
  /**
   * Attach every registered source against the supplied dispatcher. Runs at
   * `system.start()`. On a re-start, this re-arms the manager: the previous
   * cycle's `attached` array is dropped and every source attaches afresh.
   *
   * The manager wraps each source's publish callback with a closure that
   * forwards to `dispatch(sourceId, moduleId, eventName, payload)`. Sources
   * that successfully attach also trigger the `onAttach` callback; failures
   * trigger `onError`.
   */
  attachAll(dispatch: SourceDispatch): void;
  /**
   * Invoke every recorded unsubscribe, in reverse-registration order. Runs at
   * `system.stop()`. Idempotent within a single attach cycle — calling twice
   * is a no-op on the second call. The flag clears at the next `attachAll`.
   *
   * `onDetach` fires BEFORE each unsubscribe runs. `onError` fires AFTER if
   * the unsubscribe throws.
   *
   * Sync variant kept for back-compat: async unsubscribes are kicked off
   * (the Promise is captured but not awaited). Use {@link cleanupAllAsync}
   * when you need to await the actual transport teardown (e.g. Supabase
   * `channel.unsubscribe()` returns a Promise that must complete before
   * the broker drops the subscription).
   */
  cleanupAll(): void;
  /**
   * RFC 0002: detach and forget every source owned by one module, leaving
   * every other module's sources attached and the manager's phase untouched.
   *
   * Distinct from {@link cleanupAll}, which stops the whole manager. A module
   * being unregistered is not the system stopping, so the phase must not move
   * — sources belonging to modules that are still running have to keep
   * publishing straight through.
   */
  cleanupModule(moduleId: string): void;
  /**
   * RFC 0009: async-aware cleanup. Awaits each source's unsubscribe in
   * reverse-registration order. Errors are caught + reported as
   * `phase: "cleanup"` so a single failing unsubscribe cannot block the
   * rest of the teardown.
   *
   * The host runtime calls this from `System.stopAsync()` /
   * `System.destroyAsync()`. For sync `system.stop()` callers, the sync
   * `cleanupAll` is still used (Promises from async unsubscribes are
   * fire-and-forget).
   */
  cleanupAllAsync(): Promise<void>;
  /**
   * RFC 0009: signal eviction to every source whose definition declares
   * `onEvict`. Runs in registration order so sources with downstream
   * dependencies close in the right order. Errors are caught + reported
   * as `phase: "runtime"`. After `evictAll`, the host runtime calls
   * `cleanupAllAsync`.
   */
  evictAll(): Promise<void>;
  /**
   * RFC 0012 — re-evaluate every GATED source's `key` / `active` gate
   * against the supplied committed-fact snapshot and reconcile its
   * subscription lifecycle:
   *
   * - `null → key` (rising edge): attach under the new key.
   * - `key → null` (falling) / `keyA → keyB` (re-key): tear the old
   *   subscription down BEFORE attaching the new one; honours
   *   `gateLingerMs` hysteresis on the falling / re-key edge.
   * - unchanged key: no-op.
   *
   * A gate that throws or returns a non-`(string | null)` fails CLOSED
   * (treated as `null`, reported via `onError` with `phase: "gate"`).
   *
   * Called once at `system.start()` (initial gated attach) and thereafter
   * on the post-commit effects plane after each reconcile. Teardown here is
   * SYNC fire-and-forget so it never blocks reconcile. Ungated sources are
   * untouched — they attach via `attachAll` as before.
   */
  evaluateGated(facts: Record<string, unknown>): void;
  /** Number of sources currently attached. Used by `system.inspect()`. */
  attachedCount(): number;
  /**
   * List the declared source definitions for `system.inspect()`. Returns
   * `{ id, moduleId, meta, attached, publishCount, lastPublishAt,
   * dropCount, lastDropReason, lastDropAt, errorCount, lastError,
   * attachedAt, detachedAt }` rows in registration order. Mirrors how
   * effects are surfaced, with per-source telemetry an operator can read
   * without registering a custom plugin.
   */
  listDefinitions(): SourceInspectionRow[];
}

/**
 * Public per-source telemetry row returned by
 * `SourcesManager.listDefinitions()` and surfaced unchanged on
 * `SystemInspection.sources[i]`. Exported so consumers can name the type
 * when writing helpers over the inspect output.
 */
export interface SourceInspectionRow {
  /**
   * The source's id in the system. In a namespaced system this is
   * prefixed with the module's namespace (`loop::boot`).
   */
  id: string;
  moduleId: string;
  /**
   * The id as the module declared it (`boot`), without the namespace. Equal
   * to `id` in a single-module system. Use it with `moduleId` for labels:
   * `${row.moduleId}/${row.localId}`.
   */
  localId: string;
  meta?: unknown;
  attached: boolean;
  publishCount: number;
  lastPublishAt: number | null;
  /**
   * Publishes the engine's dispatch guard rejected OR the manager
   * coalesced this cycle. Operators monitor this to spot misconfigured
   * sources (wrong event names) and to verify the coalesce strategy is
   * actually debouncing the high-frequency sources it was meant to.
   */
  dropCount: number;
  /**
   * Reason for the most recent rejected publish, or `null`.
   * - `"post-destroy"` / `"post-stop"` — leaked transport
   * - `"blocked-event-name"` / `"invalid-event-name"` — guard probe
   * - `"coalesced"` — manager debounced a same-event-name publish
   *   ahead of the microtask flush (only when `SourceDef.coalesce`
   *   is `"lastWriteWins"`)
   * - `"unknown-event"` — no handler is registered for the event name
   * - `"cross-module-event"` — a namespaced source published a name that
   *   already contains `::`; a source publishes only its own module's events
   */
  lastDropReason: SourceDropReason | null;
  /** Wall-clock ms of the most recent rejected publish, or `null`. */
  lastDropAt: number | null;
  errorCount: number;
  lastError: SourceLastError | null;
  attachedAt: number | null;
  detachedAt: number | null;
}

/**
 * The most recent attach or cleanup error a source has recorded this cycle.
 * `message` is truncated to a fixed length so a source that throws with a
 * payload-embedded message does not write unbounded data into inspect
 * output (and downstream into the audit ledger).
 */
export interface SourceLastError {
  phase: "attach" | "cleanup" | "runtime" | "gate";
  message: string;
  at: number;
}
