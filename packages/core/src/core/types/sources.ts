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
 * @example No-op (test) source
 * ```typescript
 * sources: {
 *   ignored: { attach: () => () => undefined },
 * }
 * ```
 */

import type { DefinitionMeta } from "./meta.js";

// ============================================================================
// Source Primitive Types
// ============================================================================

/**
 * Cleanup function returned by a source's `attach`.
 * Called once at `system.stop()` (or before re-attach, currently unsupported).
 * Idempotent: callers may invoke it multiple times safely; implementations
 * SHOULD guard repeated teardown.
 */
export type SourceUnsubscribe = () => void;

/**
 * Typed event dispatcher passed to a source's `attach`. Calls into the same
 * dispatch queue used by `system.events.X(payload)`.
 *
 * The string event name is unchecked at this level (kept as `string` to avoid
 * coupling the source primitive to the consuming module's event schema). The
 * authoring module typically wraps `publish` in a typed helper or uses string
 * literals matching its own `events:` map.
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
 * - `attach` is synchronous. Async setup (await an auth refresh, fetch a
 *   token) belongs inside the subscription's own internals — `attach` returns
 *   immediately with the unsubscribe function.
 * - Sources cannot subscribe to system facts. Use {@link EffectDef effects}
 *   for fact-reactive behavior.
 * - The publish callback dispatches events normally — resolvers, fact
 *   handlers, and downstream effects all run. Authors SHOULD throttle /
 *   debounce inside the source if the inbound rate may exceed the system's
 *   reconciliation budget.
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
