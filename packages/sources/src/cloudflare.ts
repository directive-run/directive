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
  /**
   * RFC 0009 eviction hook. Called by `system.evict(deadline?)` when the
   * DO runtime signals an upcoming hibernation. Clear the alarm here so
   * the DO doesn't wake just to fire a publish into a torn-down system.
   * The default `onEvict` (used when this option is omitted) deletes the
   * alarm via `storage.deleteAlarm()`; supply your own to add custom
   * pre-hibernation work (flush an audit log, signal the broker, etc.).
   */
  onEvict?: () => void | Promise<void>;
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
    onEvict,
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

  // Default onEvict: drop the pending alarm so the DO doesn't wake
  // post-hibernation just to fire into a torn-down system. RFC 0009
  // motivates the hook; this adapter is the literal target runtime.
  const evictHandler =
    onEvict ??
    (async () => {
      await storage.deleteAlarm();
    });

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
    onEvict: evictHandler,
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
  /**
   * RFC 0009 eviction hook. Called by `system.evict(deadline?)` when the
   * DO runtime signals an upcoming hibernation. The default `onEvict`
   * closes the socket with code 1001 (`"going-away"`) so the broker sees
   * a clean disconnect and a re-attach after hibernation negotiates a
   * fresh session. Supply your own to skip the close (e.g., when the
   * runtime is hibernating WebSockets natively and the broker holds the
   * connection for resumption) or to add custom pre-hibernation work.
   */
  onEvict?: () => void | Promise<void>;
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
    onEvict,
  } = options;

  // Default onEvict: close the socket so the broker sees a clean
  // disconnect ahead of the DO hibernating. Consumers who let the
  // runtime hibernate the WebSocket natively can opt out by supplying
  // their own no-op `onEvict`.
  const evictHandler =
    onEvict ??
    (() => {
      try {
        socket.close(1001, "going-away");
      } catch {
        // Already closed; ignore.
      }
    });

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
    onEvict: evictHandler,
    meta: {
      label: "Cloudflare WebSocket message stream",
      tags: ["source", "cloudflare", "websocket"],
    },
  };
}
