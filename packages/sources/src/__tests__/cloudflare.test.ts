/**
 * Tests for `sourceFromDOAlarm` and `sourceFromWebSocketMessage`.
 *
 * Both adapters use fake DO storage / WebSocket so the optional
 * Cloudflare peer-dep doesn't need to be installed.
 */

import { createModule, createSystem, t } from "@directive-run/core";
import { describe, expect, it, vi } from "vitest";
import {
  sourceFromDOAlarm,
  sourceFromWebSocketMessage,
} from "../cloudflare.js";

function makeFakeStorage() {
  let scheduled: number | null = null;
  return {
    setAlarm: vi.fn(async (at: number) => {
      scheduled = at;
    }),
    deleteAlarm: vi.fn(async () => {
      scheduled = null;
    }),
    getAlarm: vi.fn(async () => scheduled),
  };
}

describe("sourceFromDOAlarm", () => {
  it("schedules an alarm on attach + publishes on tick", () => {
    const storage = makeFakeStorage();
    const handler = vi.fn();
    let registeredTick: undefined | (() => void);

    const module = createModule("ticker", {
      schema: {
        facts: { count: t.number() },
        events: { TICK: { at: t.number() } },
      },
      init: (f) => {
        f.count = 0;
      },
      events: {
        TICK: (f) => {
          handler();
          f.count += 1;
        },
      },
      sources: {
        alarm: sourceFromDOAlarm({
          storage,
          intervalMs: 30_000,
          eventName: "TICK",
          payload: () => ({ at: 12345 }),
          onTickRegistered: (tick) => {
            registeredTick = tick;
          },
        }),
      },
    });
    const system = createSystem({ module });
    system.start();
    // setAlarm called once at attach.
    expect(storage.setAlarm).toHaveBeenCalledTimes(1);
    // Simulate the DO runtime calling the registered tick.
    expect(registeredTick).not.toBeNull();
    registeredTick?.();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(system.facts.count).toBe(1);
    // Tick schedules the NEXT alarm.
    expect(storage.setAlarm).toHaveBeenCalledTimes(2);
    system.destroy();
  });

  it("system.stop() clears the alarm", () => {
    const storage = makeFakeStorage();
    let registeredTick: undefined | (() => void);
    const module = createModule("cleanup", {
      schema: {
        facts: { v: t.number() },
        events: { TICK: { at: t.number() } },
      },
      init: (f) => {
        f.v = 0;
      },
      events: {
        TICK: (f, p) => {
          f.v = p.at;
        },
      },
      sources: {
        alarm: sourceFromDOAlarm({
          storage,
          intervalMs: 1_000,
          eventName: "TICK",
          onTickRegistered: (tick) => {
            registeredTick = tick;
          },
        }),
      },
    });
    const system = createSystem({ module });
    system.start();
    system.stop();
    expect(storage.deleteAlarm).toHaveBeenCalledTimes(1);
    // After stop, calling the captured tick is a no-op (publish is
    // dropped at engine boundary, and the adapter's activePublish is
    // cleared).
    registeredTick?.();
    expect(system.facts.v).toBe(0);
    system.destroy();
  });

  it("rejects intervalMs < 1", () => {
    const storage = makeFakeStorage();
    expect(() =>
      sourceFromDOAlarm({
        storage,
        intervalMs: 0,
        eventName: "TICK",
      }),
    ).toThrow(/intervalMs must be >= 1/);
  });
});

describe("sourceFromWebSocketMessage", () => {
  interface Listener {
    type: "message" | "close" | "error";
    handler: (event: {
      data?: unknown;
      code?: number;
      reason?: string;
    }) => void;
  }
  function makeFakeSocket() {
    const listeners: Listener[] = [];
    return {
      send: vi.fn(),
      close: vi.fn(),
      addEventListener(type: Listener["type"], handler: Listener["handler"]) {
        listeners.push({ type, handler });
      },
      removeEventListener(
        type: Listener["type"],
        handler: Listener["handler"],
      ) {
        const idx = listeners.findIndex(
          (l) => l.type === type && l.handler === handler,
        );
        if (idx >= 0) listeners.splice(idx, 1);
      },
      fire(type: Listener["type"], event: Parameters<Listener["handler"]>[0]) {
        for (const l of listeners) {
          if (l.type === type) l.handler(event);
        }
      },
      get listenerCount() {
        return listeners.length;
      },
    };
  }

  it("publishes decoded messages", () => {
    const socket = makeFakeSocket();
    const handler = vi.fn();
    const module = createModule("ws", {
      schema: {
        facts: { last: t.string() },
        events: {
          MSG: { content: t.string() },
          WEBSOCKET_CLOSED: { code: t.number(), reason: t.string() },
          WEBSOCKET_ERROR: {},
        },
      },
      init: (f) => {
        f.last = "";
      },
      events: {
        MSG: (f, p) => {
          handler();
          f.last = p.content;
        },
        WEBSOCKET_CLOSED: () => undefined,
        WEBSOCKET_ERROR: () => undefined,
      },
      sources: {
        s: sourceFromWebSocketMessage({
          socket: socket as unknown as Parameters<
            typeof sourceFromWebSocketMessage
          >[0]["socket"],
          decode: (data) => {
            if (typeof data !== "string") return null;
            return { name: "MSG", payload: { content: data } };
          },
        }),
      },
    });
    const system = createSystem({ module });
    system.start();
    socket.fire("message", { data: "hello" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(system.facts.last).toBe("hello");
    // close event fires the close publish.
    socket.fire("close", { code: 1006, reason: "abnormal" });
    system.destroy();
  });

  it("removes listeners on cleanup", () => {
    const socket = makeFakeSocket();
    const module = createModule("ws2", {
      schema: {
        facts: { v: t.string() },
        events: { MSG: { v: t.string() } },
      },
      init: (f) => {
        f.v = "";
      },
      events: {
        MSG: (f, p) => {
          f.v = p.v;
        },
      },
      sources: {
        s: sourceFromWebSocketMessage({
          socket: socket as unknown as Parameters<
            typeof sourceFromWebSocketMessage
          >[0]["socket"],
          decode: (data) => ({ name: "MSG", payload: { v: String(data) } }),
          closeEvent: null,
          errorEvent: null,
        }),
      },
    });
    const system = createSystem({ module });
    system.start();
    expect(socket.listenerCount).toBe(3);
    system.stop();
    expect(socket.listenerCount).toBe(0);
    system.destroy();
  });
});
