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
 * shows up in 7+ call sites in the production app we dogfood Directive
 * on (multiple realtime hooks plus a per-event-stream realtime adapter,
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
 * Why a source publish was rejected. Mirrored across the three
 * surfaces that report drops:
 *
 * - `SourceInspectionRow.lastDropReason` (operator-facing, on inspect())
 * - `Plugin.onSourceDrop` (plugin hook)
 * - `ObservationEvent` `source.drop` variant (system.observe())
 *
 * Centralizing the union here keeps the three from drifting when a
 * new drop path is added to the engine.
 */
export type SourceDropReason =
  | "post-destroy"
  | "post-stop"
  | "blocked-event-name"
  | "invalid-event-name"
  | "coalesced"
  | "gate-closed";

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
 * - `attach` cannot read system facts, and a source writes NO facts. For
 *   fact-reactive OUTPUT use {@link EffectDef effects}. To gate or re-key a
 *   source's subscription lifecycle ON facts (RFC 0010), declare a pure
 *   `key` / `active` gate — it reads facts to decide whether, and under what
 *   identity, the transport is subscribed, then hands the resolved key to
 *   `attach` via `ctx.key`. The gate is a pure fact read (no writes); the
 *   attach act + published events remain non-replayable inputs.
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

/**
 * Context handed to a keyed source's `attach` as its optional 3rd
 * argument (RFC 0010). Carries the resolved gate key so a keyed source
 * builds its subscription from it — e.g. `supabase.channel(\`game:${ctx.key}\`)`.
 *
 * Only supplied when the source is gated (declares `key` or `active`).
 * Ungated sources never receive it, so their `attach(publish, reportError)`
 * signature is untouched.
 */
export interface SourceAttachContext {
  /** The non-null key the source is currently attached under. */
  readonly key: string;
}

/**
 * Read-only fact snapshot handed to a gated source's `key` / `active`
 * gate (RFC 0010). A gate is a PURE fact read: it may inspect facts to
 * decide whether — and under what identity — the source should be
 * subscribed, but it MUST NOT write facts (the gate is a fact-only
 * derivation; writing would break the determinism invariant that lets
 * replay re-derive the key without re-attaching the transport).
 */
export type SourceGateFacts = Readonly<Record<string, unknown>>;

export interface SourceDef {
  /**
   * Mount the source against the system. Runs once at `system.start()`
   * for ungated sources, or once per rising gate edge for keyed sources.
   *
   * @param publish - dispatch typed events into the system's event queue.
   * @param reportError - report a runtime error from the source's
   *   underlying stream. Fires `source.error` observation events with
   *   `phase: "runtime"` (distinct from `"attach"`, `"cleanup"`, and
   *   `"gate"`) so observers can attribute the failure correctly.
   *   Optional — sources that never error mid-flight don't need it.
   * @param ctx - RFC 0010: for a KEYED source (declares `key`/`active`),
   *   carries `{ key }` — the resolved gate key this attach is running
   *   under — so the subscription can be built from it. Undefined for
   *   ungated sources. `attach` still CANNOT read facts (use `key`/`active`
   *   for that) and the source still writes NO facts.
   * @returns a cleanup function that runs at `system.stop()` (or at the
   *   next falling / re-key gate edge for keyed sources).
   */
  attach: (
    publish: SourcePublish,
    reportError?: SourceReportError,
    ctx?: SourceAttachContext,
  ) => SourceUnsubscribe;
  /**
   * RFC 0010 — gate + identity. A PURE fact read (no writes) that decides
   * this source's subscription lifecycle from module facts:
   *
   * - returns `null` → the source is DETACHED (its transport is torn down
   *   / never opened).
   * - returns a non-null string → the source is ATTACHED under that key.
   *   The key flows to `attach` as `ctx.key`.
   * - returns a DIFFERENT string than last time → the old subscription is
   *   torn down (teardown-old-BEFORE-attach-new) and re-attached under the
   *   new key. This is the "re-key" edge — use it to move a realtime
   *   channel from `game:A` to `game:B` when a fact changes.
   *
   * The gate is evaluated on the post-commit effects plane (after each
   * reconcile) and once at `system.start()`. It runs behind the same
   * replay / time-travel guard effects use: time-travel re-derives the key
   * value but NEVER re-attaches the transport (determinism invariant).
   *
   * Mutually exclusive with {@link SourceDef.active} — declaring both throws
   * a dev error at registration.
   *
   * @example Re-keyed realtime channel
   * ```typescript
   * sources: {
   *   gameChannel: {
   *     key: (facts) => (facts.gameId ? `game:${facts.gameId}` : null),
   *     attach: (publish, _reportError, ctx) => {
   *       const channel = supabase.channel(ctx!.key)
   *         .on('postgres_changes', { ... }, (p) => publish('GAME_UPDATE', p.new))
   *         .subscribe();
   *       return () => channel.unsubscribe();
   *     },
   *   },
   * }
   * ```
   */
  key?: (facts: SourceGateFacts) => string | null;
  /**
   * RFC 0010 — sugar for a simple on/off gate. `active: f => cond` is
   * normalized at registration to `key: f => cond ? "__on__" : null`, so
   * the source attaches while the predicate is true and detaches when it
   * turns false. Use this when the source has no identity to re-key on —
   * just a "should it be running right now?" question.
   *
   * Mutually exclusive with {@link SourceDef.key} — declaring both throws a
   * dev error at registration.
   *
   * @example Only subscribe while the tab is focused
   * ```typescript
   * sources: {
   *   presence: {
   *     active: (facts) => facts.tabFocused === true,
   *     attach: (publish) => { ...; return () => ...; },
   *   },
   * }
   * ```
   */
  active?: (facts: SourceGateFacts) => boolean;
  /**
   * RFC 0010 — hysteresis (in ms) on a FALLING gate edge (key → null) or a
   * re-key edge (key A → key B). When set, the manager WAITS this long
   * before tearing the old subscription down; if the gate returns to the
   * SAME prior key within the window, the pending teardown is CANCELLED and
   * the subscription is kept alive untouched. Prevents thrashing a costly
   * transport on transient fact flaps (a WebSocket that reconnects, a
   * gameId that briefly clears during navigation).
   *
   * Only affects falling / re-key edges. A RISING edge (null → key) always
   * attaches immediately. Default `0` = tear down immediately, no linger.
   */
  gateLingerMs?: number;
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

  /**
   * Per-source lifecycle timeout in milliseconds. Caps how long the
   * manager waits for THIS source's `unsubscribe()` or `onEvict()`
   * during teardown / eviction before declaring it hung and moving on.
   *
   * Defaults to 5000ms — comfortable for healthy transports, short
   * enough for ops to recognize a hang. Override per source for
   * legitimate long-tail teardowns:
   *
   * - Supabase channel that flushes a backlog before closing → 15000
   * - OpenTelemetry batch span exporter draining a queue → 10000
   * - Cloudflare DO storage flush awaiting D1 commit → 8000
   *
   * Sources that timeout still have their underlying work continue in
   * the background — the manager just unblocks the rest of teardown.
   * Setting this to `Infinity` disables the cap for this source only.
   */
  evictTimeoutMs?: number;
}

/**
 * Map of source definitions, keyed by source name. Collision rules match
 * effects/events/constraints: a source name must be unique across all
 * modules in a system.
 */
export type SourcesDef = Record<string, SourceDef>;
