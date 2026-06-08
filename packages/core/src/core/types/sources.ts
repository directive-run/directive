/**
 * Source Types — typed external event sources.
 *
 * A `source` is the inbound dual of an {@link EffectDef effect}:
 *
 *   - **Effects** are outbound. They observe fact changes and push to the
 *     external world (DOM mutation, WebSocket send, logging, analytics).
 *     Effects cannot dispatch `system.events`.
 *   - **Sources** are inbound. They subscribe to an external event stream
 *     (Supabase realtime channel, WebSocket message stream, browser event,
 *     polling timer) and publish *into* the system's event queue. Sources
 *     never read facts.
 *
 * Sources sit on the same lifecycle plane as effects but mount once per
 * system instance (not on every fact change). `attach` runs at
 * `system.start()`; the returned unsubscribe runs at `system.stop()`.
 *
 * ## Why this exists
 *
 * The "hook-as-bridge" pattern — a `useEffect` that owns an external
 * subscription, maps incoming payloads, and dispatches `sys.events.X()` —
 * shows up in 7+ call sites across the Sizls workspace (Minglingo's
 * `useActiveRoundSystem`, `useBattleRoyaleSystem`, `eventClaims.realtime.ts`,
 * etc.). Each site re-derives the lifecycle plumbing.
 *
 * A `source` declares that plumbing as a first-class module field. The
 * engine owns the lifecycle; the author owns only the subscribe + publish
 * logic. The same shape works in non-React consumers (Workers, node, tests).
 *
 * @example Supabase realtime channel
 * ```typescript
 * sources: {
 *   gameUpdates: {
 *     attach: (publish) => {
 *       const channel = supabase.channel(`game:${gameId}`).on(
 *         'postgres_changes',
 *         { event: 'UPDATE', table: 'games', filter: `id=eq.${gameId}` },
 *         (payload) => publish('REALTIME_GAME_UPDATE', { gameState: map(payload.new) }),
 *       ).subscribe();
 *       return () => channel.unsubscribe();
 *     },
 *   },
 * }
 * ```
 *
 * @example Polling timer
 * ```typescript
 * sources: {
 *   heartbeat: {
 *     attach: (publish) => {
 *       const id = setInterval(() => publish('HEARTBEAT_TICK', undefined), 5000);
 *       return () => clearInterval(id);
 *     },
 *   },
 * }
 * ```
 *
 * @example No-op (test) source — note the `() => () => undefined` shape:
 * `attach` MUST return a function. Returning `() => undefined` (one level)
 * would return `undefined`, which the manager logs as "did not return an
 * unsubscribe function" and skips. Always two levels.
 * ```typescript
 * sources: {
 *   ignored: { attach: () => () => undefined },
 *   //                  ^^^^^^^^^^^^^^^^^^^
 *   //                  | the function that's the unsubscribe
 *   //                  the function that's `attach`'s return value
 * }
 * ```
 *
 * @example Typed publish — wrap once for compile-time event-name + payload safety
 * ```typescript
 * import type { SourcePublish } from '@directive-run/core';
 *
 * function createPublisher(publish: SourcePublish) {
 *   return {
 *     TICK: (delta: number) => publish('TICK', { delta }),
 *     HEARTBEAT: () => publish('HEARTBEAT'),
 *   };
 * }
 *
 * sources: {
 *   ticker: {
 *     attach: (publish) => {
 *       const p = createPublisher(publish);
 *       const id = setInterval(() => p.TICK(1), 1000); // ← typed
 *       return () => clearInterval(id);
 *     },
 *   },
 * }
 * ```
 */

import type { DefinitionMeta } from "./meta.js";

// ============================================================================
// Source Primitive Types
// ============================================================================

/**
 * Cleanup function returned by a source's `attach`.
 *
 * Called once at `system.stop()`. On the next `system.start()` (the manager
 * supports the full start → stop → start lifecycle), the source's `attach`
 * runs again and returns a FRESH unsubscribe. Implementations SHOULD guard
 * repeated teardown defensively, but the manager will only invoke the
 * captured unsubscribe once per attach cycle.
 *
 * The name is intentional — sources are typically wrapping a stateful
 * external subscription (Supabase channel, WebSocket, browser listener), so
 * "unsubscribe" is the verb authors recognise. Note that effects use
 * `EffectCleanup` instead; the asymmetric naming captures the asymmetric
 * concern (an effect cleans up a side effect; a source unsubscribes from
 * an external stream).
 */
export type SourceUnsubscribe = () => void | Promise<void>;

/**
 * Typed event dispatcher passed to a source's `attach`. Calls into the same
 * dispatch queue used by `system.events.X(payload)`.
 *
 * The string event name is unchecked at this level (kept as `string` to
 * avoid coupling the source primitive to the consuming module's event
 * schema). The authoring module typically wraps `publish` in a typed helper
 * — see the {@link SourceDef} example for the recommended pattern. The
 * runtime semantics:
 *
 * - `publish('KNOWN_EVENT', payload)` — dispatches into the module's event
 *   handler. The payload is augmented with `{ type: eventName, ...payload }`
 *   before passing to the handler (same shape as `system.events.X(payload)`).
 * - `publish('UNKNOWN_EVENT', ...)` — in development, logs a
 *   `[Directive] Unknown event type` warning and drops the dispatch.
 *   In production, silently drops. **This is a footgun for sources** —
 *   strongly prefer wrapping `publish` in a typed factory (per the example).
 * - `publish(event, undefined)` — dispatches with an empty payload object.
 * - Calling `publish` after `system.destroy()` — silently no-ops. The
 *   engine guards against post-destroy dispatch so stale source callbacks
 *   cannot mutate a torn-down store.
 */
/**
 * Type-wrapped as an interface (rather than a bare function type) so
 * additive minors can attach optional methods (`error`, `complete` —
 * see RFC 0008 Observer-protocol posture) without a major bump. The
 * call signature is unchanged: existing `publish('EVENT', payload)`
 * call sites keep working.
 */
export interface SourcePublish {
  (event: string, payload?: unknown): void;
}

/**
 * A source definition — attaches an external event stream to the system
 * lifecycle.
 *
 * ## Lifecycle
 *
 * - `attach(publish)` runs once at `system.start()`. It is sync.
 * - The returned `SourceUnsubscribe` runs at `system.stop()`.
 * - Multiple sources per module are supported; ordering is registration
 *   order at `attach`, reverse-registration order at unsubscribe.
 *
 * ## Restrictions
 *
 * - `attach` is **synchronous**. Returning a `Promise<Unsubscribe>` does NOT
 *   work — the engine discards the Promise and treats it as "no cleanup
 *   function returned" (logs an error + skips the source). Do async setup
 *   inside the subscription's own internals; `attach` returns immediately
 *   with the synchronous unsubscribe function.
 * - Sources cannot subscribe to system facts. Use {@link EffectDef effects}
 *   for fact-reactive behavior. If you need to re-subscribe when a fact
 *   changes, use `system.registerModule()` to swap the source's owning
 *   module, OR drive the subscription via an effect that owns its own
 *   channel.
 * - The publish callback dispatches events normally — resolvers, fact
 *   handlers, and downstream effects all run. Authors SHOULD throttle /
 *   debounce inside the source if the inbound rate may exceed the system's
 *   reconciliation budget.
 * - **Don't subscribe to the same external channel from both a source AND
 *   an effect.** The effect will re-run on fact changes, the source mounts
 *   once — you'll get 2× messages with silent duplicates. Pick one.
 */
/**
 * Source-side runtime-error reporter. Optional second argument to
 * `attach` per RFC 0008. Authors call this when the underlying stream
 * errors mid-flight (WebSocket disconnect, Supabase channel goes
 * stale, polling fetch throws) instead of publishing magic event names
 * like `STREAM_ERROR`. The manager forwards the error through the same
 * sinks as attach/cleanup failures, with `phase: "runtime"`.
 *
 * @example
 * ```ts
 * sources: {
 *   ws: {
 *     attach: (publish, reportError) => {
 *       const sock = new WebSocket(url);
 *       sock.addEventListener('error', () => reportError(new Error('WS error')));
 *       sock.addEventListener('message', (e) => publish('MSG', JSON.parse(e.data)));
 *       return () => sock.close();
 *     },
 *   },
 * }
 * ```
 */
export type SourceReportError = (error: Error) => void;

export interface SourceDef {
  /**
   * Mount the source against the system. Runs once at `system.start()`.
   *
   * @param publish - dispatch typed events into the system's event queue.
   * @param reportError - report a runtime error from the source's
   *   underlying stream. Fires `source.error` observation events with
   *   `phase: "runtime"` (distinct from `"attach"` and `"cleanup"`)
   *   so observers can attribute the failure correctly. Optional —
   *   sources that never error mid-flight don't need it.
   * @returns a cleanup function that runs at `system.stop()`.
   */
  attach: (publish: SourcePublish, reportError?: SourceReportError) => SourceUnsubscribe;
  /** Optional metadata for debugging and devtools (never read on hot path). */
  meta?: DefinitionMeta;
  /**
   * How the manager absorbs publishes that would overwhelm the
   * reconcile loop. Default: `"none"` — every publish dispatches
   * straight through to the engine.
   *
   * Set `"lastWriteWins"` for high-frequency sources (cursor movement,
   * sensor telemetry, channel storms). The manager coalesces publishes
   * with the same event name within a single microtask: only the last
   * payload of the cycle dispatches; earlier ones bump `dropCount` and
   * record `lastDropReason: "coalesced"` per source so operators can
   * see the rate of debouncing on `system.inspect().sources`.
   *
   * `"all"` is a no-op equivalent to `"none"` — it names the intent
   * (no coalesce, every publish counts) for readers.
   *
   * Choose `"none"` (default) for low-frequency lifecycle sources
   * (MCP connect, DO alarm, WebSocket open/close). Choose
   * `"lastWriteWins"` for any source that could publish faster than
   * the reconcile loop can drain. See `RFC 0007` for throughput
   * budgets per coalesce strategy and the rationale.
   *
   * Coalescing applies per-event-name: two different event names from
   * the same source coalesce independently, so a `"priceTick"` storm
   * doesn't drop a one-shot `"connected"` event.
   *
   * **Limitation:** the coalesce STRATEGY is uniform across all event
   * names on a source — you can't mix (e.g. `lastWriteWins` for
   * `priceTick` and `none` for `connected` from the same source).
   * Workaround: split into two source declarations on the module if
   * the strategies must differ. A future RFC may add per-event-name
   * strategy overrides.
   */
  coalesce?: "none" | "lastWriteWins" | "all";
  /**
   * Called when the host runtime signals the isolate is about to be
   * evicted (Cloudflare DO hibernation, Workers memory pressure, etc.).
   * Use this to actively close external subscriptions BEFORE the
   * isolate dies, so the broker / remote service doesn't accumulate
   * ghost subscriptions visible as "phantom presence" bugs at fleet
   * scale.
   *
   * Distinct from `unsubscribe()`: eviction can fire WITHOUT a
   * `system.stop()` having been called. The host runtime invokes this
   * via `system.evict()`, which fires every source's `onEvict()` in
   * registration order, then `destroyAsync()`. The entire call is
   * awaitable up to a runtime-supplied deadline.
   *
   * Optional — sources whose underlying transport is short-lived
   * (browser WebSocket, in-process EventEmitter) don't need it. RFC
   * 0009 documents the full DO-eviction recipe.
   */
  onEvict?: () => void | Promise<void>;
}

/**
 * Map of source definitions, keyed by source name. Collision rules match
 * effects/events/constraints: a source name must be unique across all
 * modules in a system.
 */
export type SourcesDef = Record<string, SourceDef>;
