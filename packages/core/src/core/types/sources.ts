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
export type SourceUnsubscribe = () => void;

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
export type SourcePublish = (event: string, payload?: unknown) => void;

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
export interface SourceDef {
  /**
   * Mount the source against the system. Runs once at `system.start()`.
   *
   * @param publish - dispatch typed events into the system's event queue.
   * @returns a cleanup function that runs at `system.stop()`.
   */
  attach: (publish: SourcePublish) => SourceUnsubscribe;
  /** Optional metadata for debugging and devtools (never read on hot path). */
  meta?: DefinitionMeta;
}

/**
 * Map of source definitions, keyed by source name. Collision rules match
 * effects/events/constraints: a source name must be unique across all
 * modules in a system.
 */
export type SourcesDef = Record<string, SourceDef>;
