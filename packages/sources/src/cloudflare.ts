/**
 * @directive-run/sources/cloudflare
 *
 * Bridges Cloudflare-specific runtime primitives into the Directive
 * `source` primitive:
 *
 * - **`sourceFromDOAlarm`** — Durable Object alarms as a typed
 *   periodic source. Replaces hand-rolled `setInterval` inside `attach`
 *   (which dies on hibernation) with a storage-backed alarm that
 *   survives eviction.
 * - **`sourceFromWebSocketMessage`** — DO `WebSocket` connection
 *   (Cloudflare's `webSocketAccept` flow) as a typed message source.
 *
 * Both adapters integrate with the source primitive's lifecycle, so
 * `system.stop()` cleans up via the storage / socket teardown paths.
 *
 * @example DO alarm as a 30-second tick source
 * ```ts
 * import { sourceFromDOAlarm } from '@directive-run/sources/cloudflare';
 *
 * export class TickerDO {
 *   constructor(public state: DurableObjectState) {}
 *
 *   async fetch(req: Request) {
 *     const system = createSystem({
 *       module: createModule('ticker', {
 *         schema: {
 *           facts: { lastTick: t.number() },
 *           events: { TICK: { at: t.number() } },
 *         },
 *         init: (f) => { f.lastTick = 0; },
 *         events: { TICK: (f, p) => { f.lastTick = p.at; } },
 *         sources: {
 *           alarm: sourceFromDOAlarm({
 *             storage: this.state.storage,
 *             intervalMs: 30_000,
 *             eventName: 'TICK',
 *             payload: () => ({ at: Date.now() }),
 *           }),
 *         },
 *       }),
 *     });
 *     system.start();
 *     return new Response('ok');
 *   }
 *
 *   // DO runtime calls alarm() on each scheduled tick; the source
 *   // adapter's storage key triggers a publish on the active system.
 *   async alarm() {
 *     // The DO runtime calls this; the source publishes via the
 *     // shared module-level event bus (the active system observes).
 *   }
 * }
 * ```
 */

import type { SourceDef, SourcePublish } from "@directive-run/core";

// ============================================================================
// Type stubs for the Cloudflare Workers / DO API surface we touch
// ============================================================================

interface DurableObjectStorage {
  setAlarm(scheduledTime: number | Date): Promise<void>;
  deleteAlarm(): Promise<void>;
  getAlarm(): Promise<number | null>;
}

// ============================================================================
// sourceFromDOAlarm — Durable Object alarm as a periodic source
// ============================================================================

export interface DOAlarmSourceOptions {
  /** The DO's `state.storage` handle. */
  storage: DurableObjectStorage;
  /** Tick interval in milliseconds. Minimum 1ms. */
  intervalMs: number;
  /**
   * Event name to publish on every tick. Must match an event declared
   * on the module's schema (otherwise the engine drops the publish with
   * `lastDropReason: 'invalid-event-name'` per the R6 telemetry).
   */
  eventName: string;
  /**
   * Payload factory. Called on every tick. Default: `() => ({})`.
   */
  payload?: () => Record<string, unknown>;
  /**
   * Optional hook for the consumer to wire the DO's `alarm()` callback
   * back into this source. The adapter cannot intercept the DO runtime's
   * `alarm()` call directly (it's a class method); the consumer's
   * `alarm()` handler should call `adapter.tick()` to drive the publish.
   *
   * Returned from `sourceFromDOAlarm.exposeTick(source)` (see below).
   */
  onTickRegistered?: (tick: () => void) => void;
}

/**
 * Build a `SourceDef` that schedules a DO alarm every `intervalMs` and
 * publishes on every tick. The adapter manages alarm scheduling via
 * `state.storage.setAlarm()`; on `system.stop()` it clears the alarm.
 *
 * **Important wiring step:** the DO's `alarm()` instance method MUST
 * call the adapter's tick callback. Capture it via `onTickRegistered`
 * (or by stashing the source in a class field and invoking
 * `source.tick()` from your alarm method).
 *
 * @returns a `SourceDef` to drop into a module's `sources:` map.
 */
export function sourceFromDOAlarm(
  options: DOAlarmSourceOptions,
): SourceDef & { tick(): void } {
  const {
    storage,
    intervalMs,
    eventName,
    payload = () => ({}),
    onTickRegistered,
  } = options;

  if (intervalMs < 1) {
    throw new Error(
      `[Directive] sourceFromDOAlarm: intervalMs must be >= 1, got ${intervalMs}`,
    );
  }

  let activePublish: SourcePublish | null = null;

  function tick(): void {
    if (!activePublish) return;
    activePublish(eventName, payload());
    // Schedule the next alarm. Fire-and-forget — the host runtime
    // handles delivery; failures land via the source primitive's
    // observation events.
    void storage.setAlarm(Date.now() + intervalMs);
  }

  const def: SourceDef & { tick(): void } = {
    attach: (publish: SourcePublish) => {
      activePublish = publish;
      // Schedule the first alarm. The DO's `alarm()` method must call
      // `tick()` to drive subsequent publishes.
      void storage.setAlarm(Date.now() + intervalMs);
      onTickRegistered?.(tick);
      return () => {
        activePublish = null;
        // Clear any pending alarm so the DO doesn't wake the dead
        // system after stop.
        void storage.deleteAlarm();
      };
    },
    tick,
    meta: {
      label: `DO alarm: ${eventName} every ${intervalMs}ms`,
      tags: ["source", "cloudflare", "alarm"],
    },
  };

  return def;
}

// ============================================================================
// sourceFromWebSocketMessage — DO WebSocket message stream as a source
// ============================================================================

interface CloudflareWebSocket {
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: "message" | "close" | "error",
    handler: (event: {
      data?: unknown;
      code?: number;
      reason?: string;
    }) => void,
  ): void;
  removeEventListener(
    type: "message" | "close" | "error",
    handler: (event: {
      data?: unknown;
      code?: number;
      reason?: string;
    }) => void,
  ): void;
}

export interface WebSocketMessageSourceOptions {
  /** The Cloudflare WebSocket (`server` half of the pair from `webSocketAccept`). */
  socket: CloudflareWebSocket;
  /**
   * Decode each `MessageEvent.data` into a typed Directive event.
   * Return `null` to drop the message (e.g. ping frames).
   */
  decode: (
    data: unknown,
  ) => { name: string; payload: Record<string, unknown> } | null;
  /**
   * Event name to publish when the socket closes. Default `"WEBSOCKET_CLOSED"`.
   * Set `null` to skip publishing on close.
   */
  closeEvent?: string | null;
  /**
   * Event name to publish on socket errors. Default `"WEBSOCKET_ERROR"`.
   * Set `null` to skip publishing on error.
   */
  errorEvent?: string | null;
}

/**
 * Build a `SourceDef` that listens on a Cloudflare WebSocket and
 * publishes each decoded message as a typed Directive event. Wraps
 * the standard `addEventListener('message' | 'close' | 'error')`
 * surface.
 *
 * @returns a `SourceDef` to drop into a module's `sources:` map.
 */
export function sourceFromWebSocketMessage(
  options: WebSocketMessageSourceOptions,
): SourceDef {
  const {
    socket,
    decode,
    closeEvent = "WEBSOCKET_CLOSED",
    errorEvent = "WEBSOCKET_ERROR",
  } = options;

  return {
    attach: (publish: SourcePublish) => {
      const onMessage = (event: { data?: unknown }) => {
        const decoded = decode(event.data);
        if (decoded === null) return;
        publish(decoded.name, decoded.payload);
      };
      const onClose = (event: { code?: number; reason?: string }) => {
        if (closeEvent === null) return;
        publish(closeEvent, {
          code: event.code ?? 1000,
          reason: event.reason ?? "",
        });
      };
      const onError = () => {
        if (errorEvent === null) return;
        publish(errorEvent, {});
      };

      socket.addEventListener("message", onMessage);
      socket.addEventListener("close", onClose);
      socket.addEventListener("error", onError);

      return () => {
        socket.removeEventListener("message", onMessage);
        socket.removeEventListener("close", onClose);
        socket.removeEventListener("error", onError);
      };
    },
    meta: {
      label: "Cloudflare WebSocket message stream",
      tags: ["source", "cloudflare", "websocket"],
    },
  };
}
