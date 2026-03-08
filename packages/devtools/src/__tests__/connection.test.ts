// @vitest-environment happy-dom
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useDevToolsConnection } from "../hooks/use-devtools-connection";
import type { DebugEvent, ServerMessage } from "../lib/types";

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

let mockInstances: MockWebSocket[] = [];

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.OPEN;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  sent: string[] = [];
  url: string;

  constructor(url: string) {
    this.url = url;
    mockInstances.push(this);
    // Simulate async connection
    queueMicrotask(() => this.onopen?.(new Event("open")));
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    queueMicrotask(() => this.onclose?.(new CloseEvent("close")));
  }
}

// Mock requestAnimationFrame for event buffer flushing
vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
  const id = setTimeout(() => cb(Date.now()), 0);

  return id as unknown as number;
});
vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<DebugEvent> = {}): DebugEvent {
  return {
    id: 1,
    type: "agent_start",
    timestamp: Date.now(),
    snapshotId: null,
    ...overrides,
  };
}

/** Get the latest MockWebSocket instance */
function latestWs(): MockWebSocket {
  return mockInstances[mockInstances.length - 1];
}

/** Simulate server sending a message */
function serverSend(ws: MockWebSocket, msg: ServerMessage) {
  ws.onmessage?.({ data: JSON.stringify(msg) } as MessageEvent);
}

/** Connect and receive a welcome message in one step */
async function connectAndWelcome(
  result: { current: ReturnType<typeof useDevToolsConnection> },
  url = "ws://localhost:9229",
  token?: string,
) {
  await act(async () => {
    result.current.connect(url, token);
  });
  // Let queueMicrotask fire onopen
  await act(async () => {
    await Promise.resolve();
  });
  const ws = latestWs();
  await act(async () => {
    serverSend(ws, {
      type: "welcome",
      version: 1,
      sessionId: "sess-123",
      timestamp: Date.now(),
    });
  });

  return ws;
}

/** Flush the rAF-based event buffer by advancing fake timers */
async function flushEventBuffer() {
  await act(async () => {
    vi.advanceTimersByTime(16);
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  mockInstances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ======================= Initial State =======================
describe("Initial State", () => {
  it("status is 'disconnected'", () => {
    const { result } = renderHook(() => useDevToolsConnection());
    expect(result.current.status).toBe("disconnected");
  });

  it("events is empty array", () => {
    const { result } = renderHook(() => useDevToolsConnection());
    expect(result.current.events).toEqual([]);
  });

  it("sessionId is null", () => {
    const { result } = renderHook(() => useDevToolsConnection());
    expect(result.current.sessionId).toBeNull();
  });
});

// ======================= Connection =======================
describe("Connection", () => {
  it("connect changes status to 'connecting'", async () => {
    const { result } = renderHook(() => useDevToolsConnection());

    await act(async () => {
      result.current.connect("ws://localhost:9229");
    });

    expect(result.current.status).toBe("connecting");
  });

  it("receives welcome message -> status 'connected', sessionId set", async () => {
    const { result } = renderHook(() => useDevToolsConnection());
    await connectAndWelcome(result);

    expect(result.current.status).toBe("connected");
    expect(result.current.sessionId).toBe("sess-123");
  });

  it("sends authenticate message when token provided", async () => {
    const { result } = renderHook(() => useDevToolsConnection());

    await act(async () => {
      result.current.connect("ws://localhost:9229", "my-secret-token");
    });
    // Let queueMicrotask fire onopen
    await act(async () => {
      await Promise.resolve();
    });

    const ws = latestWs();
    const authMsg = ws.sent.find((s) => {
      const parsed = JSON.parse(s);

      return parsed.type === "authenticate";
    });
    expect(authMsg).toBeDefined();
    expect(JSON.parse(authMsg!)).toEqual({
      type: "authenticate",
      token: "my-secret-token",
    });
  });

  it("disconnect changes status to 'disconnected'", async () => {
    const { result } = renderHook(() => useDevToolsConnection());
    await connectAndWelcome(result);
    expect(result.current.status).toBe("connected");

    await act(async () => {
      result.current.disconnect();
    });

    expect(result.current.status).toBe("disconnected");
  });

  it("disconnect clears sessionId", async () => {
    const { result } = renderHook(() => useDevToolsConnection());
    await connectAndWelcome(result);
    expect(result.current.sessionId).toBe("sess-123");

    await act(async () => {
      result.current.disconnect();
    });

    expect(result.current.sessionId).toBeNull();
  });
});

// ======================= Message Handling =======================
describe("Message Handling", () => {
  it("'event' message adds event to events array", async () => {
    const { result } = renderHook(() => useDevToolsConnection());
    const ws = await connectAndWelcome(result);

    const evt = makeEvent({ id: 42, type: "agent_start" });
    await act(async () => {
      serverSend(ws, { type: "event", event: evt });
    });
    await flushEventBuffer();

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].id).toBe(42);
  });

  it("'event_batch' message adds multiple events", async () => {
    const { result } = renderHook(() => useDevToolsConnection());
    const ws = await connectAndWelcome(result);

    const events = [
      makeEvent({ id: 1 }),
      makeEvent({ id: 2 }),
      makeEvent({ id: 3 }),
    ];
    await act(async () => {
      serverSend(ws, { type: "event_batch", events });
    });
    await flushEventBuffer();

    expect(result.current.events).toHaveLength(3);
  });

  it("events capped at MAX_EVENTS (5000)", async () => {
    const { result } = renderHook(() => useDevToolsConnection());
    const ws = await connectAndWelcome(result);

    // Send a batch of 5001 events
    const events: DebugEvent[] = [];
    for (let i = 0; i < 5001; i++) {
      events.push(makeEvent({ id: i }));
    }
    await act(async () => {
      serverSend(ws, { type: "event_batch", events });
    });
    await flushEventBuffer();

    expect(result.current.events).toHaveLength(5000);
    // Should keep the last 5000 (ids 1..5000)
    expect(result.current.events[0].id).toBe(1);
    expect(result.current.events[4999].id).toBe(5000);
  });

  it("'snapshot' message sets snapshot", async () => {
    const { result } = renderHook(() => useDevToolsConnection());
    const ws = await connectAndWelcome(result);

    const snapshotData = {
      timestamp: Date.now(),
      agents: {},
      eventCount: 10,
    };
    await act(async () => {
      serverSend(ws, { type: "snapshot", data: snapshotData });
    });

    expect(result.current.snapshot).toEqual(snapshotData);
  });

  it("'breakpoints' message sets breakpointState", async () => {
    const { result } = renderHook(() => useDevToolsConnection());
    const ws = await connectAndWelcome(result);

    const state = {
      pending: [
        {
          id: "bp-1",
          type: "input",
          agentId: "agent-1",
          input: "test",
          requestedAt: Date.now(),
        },
      ],
      resolved: ["bp-0"],
      cancelled: [],
    };
    await act(async () => {
      serverSend(ws, { type: "breakpoints", state });
    });

    expect(result.current.breakpointState).toEqual(state);
  });

  it("'scratchpad_state' filters BLOCKED_KEYS", async () => {
    const { result } = renderHook(() => useDevToolsConnection());
    const ws = await connectAndWelcome(result);

    await act(async () => {
      serverSend(ws, {
        type: "scratchpad_state",
        data: {
          safe_key: "value",
          __proto__: "evil",
          constructor: "evil",
          prototype: "evil",
          another: 42,
        },
      });
    });

    expect(result.current.scratchpadState).toEqual({
      safe_key: "value",
      another: 42,
    });
    expect("__proto__" in result.current.scratchpadState).toBe(false);
    expect("constructor" in result.current.scratchpadState).toBe(false);
    expect("prototype" in result.current.scratchpadState).toBe(false);
  });

  it("'scratchpad_update' adds key to scratchpad state", async () => {
    const { result } = renderHook(() => useDevToolsConnection());
    const ws = await connectAndWelcome(result);

    await act(async () => {
      serverSend(ws, {
        type: "scratchpad_update",
        key: "myKey",
        value: "myValue",
      });
    });

    expect(result.current.scratchpadState).toHaveProperty("myKey", "myValue");
  });

  it("'scratchpad_update' ignores BLOCKED_KEYS", async () => {
    const { result } = renderHook(() => useDevToolsConnection());
    const ws = await connectAndWelcome(result);

    await act(async () => {
      serverSend(ws, {
        type: "scratchpad_update",
        key: "__proto__",
        value: "evil",
      });
    });

    expect(Object.keys(result.current.scratchpadState)).toHaveLength(0);
  });

  it("'derived_state' filters BLOCKED_KEYS", async () => {
    const { result } = renderHook(() => useDevToolsConnection());
    const ws = await connectAndWelcome(result);

    await act(async () => {
      serverSend(ws, {
        type: "derived_state",
        data: {
          isReady: true,
          __proto__: "evil",
          constructor: "evil",
        },
      });
    });

    expect(result.current.derivedState).toEqual({ isReady: true });
    expect("__proto__" in result.current.derivedState).toBe(false);
  });

  it("'derived_update' adds key to derived state", async () => {
    const { result } = renderHook(() => useDevToolsConnection());
    const ws = await connectAndWelcome(result);

    await act(async () => {
      serverSend(ws, {
        type: "derived_update",
        id: "computedValue",
        value: 99,
      });
    });

    expect(result.current.derivedState).toHaveProperty("computedValue", 99);
  });

  it("'error' message sets error string", async () => {
    const { result } = renderHook(() => useDevToolsConnection());
    const ws = await connectAndWelcome(result);

    await act(async () => {
      serverSend(ws, {
        type: "error",
        code: "AUTH_FAILED",
        message: "Invalid token",
      });
    });

    expect(result.current.error).toBe("AUTH_FAILED: Invalid token");
  });

  it("'pong' message doesn't change state", async () => {
    const { result } = renderHook(() => useDevToolsConnection());
    const ws = await connectAndWelcome(result);

    const statusBefore = result.current.status;
    const eventsBefore = result.current.events;
    const errorBefore = result.current.error;

    await act(async () => {
      serverSend(ws, { type: "pong", timestamp: Date.now() });
    });

    expect(result.current.status).toBe(statusBefore);
    expect(result.current.events).toBe(eventsBefore);
    expect(result.current.error).toBe(errorBefore);
  });
});

// ======================= Token Streaming =======================
describe("Token Streaming", () => {
  it("'token_stream' starts tracking agent", async () => {
    const { result } = renderHook(() => useDevToolsConnection());
    const ws = await connectAndWelcome(result);

    await act(async () => {
      serverSend(ws, {
        type: "token_stream",
        agentId: "agent-1",
        tokens: "Hello",
        tokenCount: 1,
      });
    });

    expect(result.current.streamingTokens.has("agent-1")).toBe(true);
    expect(result.current.streamingTokens.get("agent-1")!.tokens).toBe(
      "Hello",
    );
  });

  it("'token_stream' appends tokens for existing agent", async () => {
    const { result } = renderHook(() => useDevToolsConnection());
    const ws = await connectAndWelcome(result);

    await act(async () => {
      serverSend(ws, {
        type: "token_stream",
        agentId: "agent-1",
        tokens: "Hello",
        tokenCount: 1,
      });
    });
    await act(async () => {
      serverSend(ws, {
        type: "token_stream",
        agentId: "agent-1",
        tokens: " World",
        tokenCount: 2,
      });
    });

    expect(result.current.streamingTokens.get("agent-1")!.tokens).toBe(
      "Hello World",
    );
    expect(result.current.streamingTokens.get("agent-1")!.count).toBe(2);
  });

  it("'stream_done' removes agent from streaming", async () => {
    const { result } = renderHook(() => useDevToolsConnection());
    const ws = await connectAndWelcome(result);

    await act(async () => {
      serverSend(ws, {
        type: "token_stream",
        agentId: "agent-1",
        tokens: "Hello",
        tokenCount: 1,
      });
    });
    expect(result.current.streamingTokens.has("agent-1")).toBe(true);

    await act(async () => {
      serverSend(ws, {
        type: "stream_done",
        agentId: "agent-1",
        totalTokens: 5,
      });
    });

    expect(result.current.streamingTokens.has("agent-1")).toBe(false);
  });

  it("token buffer capped at 10KB per agent", async () => {
    const { result } = renderHook(() => useDevToolsConnection());
    const ws = await connectAndWelcome(result);

    // Send a chunk that exceeds 10KB
    const bigChunk = "x".repeat(11_000);
    await act(async () => {
      serverSend(ws, {
        type: "token_stream",
        agentId: "agent-1",
        tokens: bigChunk,
        tokenCount: 1,
      });
    });

    const stored = result.current.streamingTokens.get("agent-1")!;
    expect(stored.tokens.length).toBeLessThanOrEqual(10_000);
  });

  it("max 50 concurrent streaming agents", async () => {
    const { result } = renderHook(() => useDevToolsConnection());
    const ws = await connectAndWelcome(result);

    // Fill up to 50 agents
    for (let i = 0; i < 50; i++) {
      await act(async () => {
        serverSend(ws, {
          type: "token_stream",
          agentId: `agent-${i}`,
          tokens: "hi",
          tokenCount: 1,
        });
      });
    }
    expect(result.current.streamingTokens.size).toBe(50);

    // 51st agent should be rejected
    await act(async () => {
      serverSend(ws, {
        type: "token_stream",
        agentId: "agent-overflow",
        tokens: "nope",
        tokenCount: 1,
      });
    });

    expect(result.current.streamingTokens.size).toBe(50);
    expect(result.current.streamingTokens.has("agent-overflow")).toBe(false);
  });
});

// ======================= Pause/Resume =======================
describe("Pause/Resume", () => {
  it("togglePause sets isPaused to true", async () => {
    const { result } = renderHook(() => useDevToolsConnection());
    expect(result.current.isPaused).toBe(false);

    await act(async () => {
      result.current.togglePause();
    });

    expect(result.current.isPaused).toBe(true);
  });

  it("events buffered while paused (pendingCount updates)", async () => {
    const { result } = renderHook(() => useDevToolsConnection());
    const ws = await connectAndWelcome(result);

    // Pause
    await act(async () => {
      result.current.togglePause();
    });

    // Send events while paused
    await act(async () => {
      serverSend(ws, { type: "event", event: makeEvent({ id: 10 }) });
      serverSend(ws, { type: "event", event: makeEvent({ id: 11 }) });
    });
    await flushEventBuffer();

    // Events should NOT appear in the main events array
    expect(result.current.events).toHaveLength(0);
    // pendingCount should reflect buffered events
    expect(result.current.pendingCount).toBe(2);
  });

  it("unpause merges buffered events", async () => {
    const { result } = renderHook(() => useDevToolsConnection());
    const ws = await connectAndWelcome(result);

    // Pause
    await act(async () => {
      result.current.togglePause();
    });

    // Send events while paused
    await act(async () => {
      serverSend(ws, { type: "event", event: makeEvent({ id: 20 }) });
      serverSend(ws, { type: "event", event: makeEvent({ id: 21 }) });
    });
    await flushEventBuffer();
    expect(result.current.events).toHaveLength(0);

    // Unpause
    await act(async () => {
      result.current.togglePause();
    });

    expect(result.current.isPaused).toBe(false);
    expect(result.current.events).toHaveLength(2);
    expect(result.current.pendingCount).toBe(0);
  });

  it("pending buffer capped at 10,000", async () => {
    const { result } = renderHook(() => useDevToolsConnection());
    const ws = await connectAndWelcome(result);

    // Pause
    await act(async () => {
      result.current.togglePause();
    });

    // Send a batch exceeding 10,000
    const events: DebugEvent[] = [];
    for (let i = 0; i < 10_500; i++) {
      events.push(makeEvent({ id: i }));
    }
    await act(async () => {
      serverSend(ws, { type: "event_batch", events });
    });
    await flushEventBuffer();

    expect(result.current.pendingCount).toBeLessThanOrEqual(10_000);
  });
});

// ======================= Import Session =======================
describe("Import Session", () => {
  it("importSession with valid JSON sets events", async () => {
    const { result } = renderHook(() => useDevToolsConnection());

    const sessionData = {
      events: [
        makeEvent({ id: 1 }),
        makeEvent({ id: 2 }),
        makeEvent({ id: 3 }),
      ],
    };

    await act(async () => {
      result.current.importSession(JSON.stringify(sessionData));
    });

    expect(result.current.events).toHaveLength(3);
  });

  it("importSession with invalid JSON sets error", async () => {
    const { result } = renderHook(() => useDevToolsConnection());

    await act(async () => {
      result.current.importSession("not valid json {{{");
    });

    expect(result.current.error).toBe(
      "Invalid session file: could not parse JSON",
    );
  });

  it("importSession filters invalid events", async () => {
    const { result } = renderHook(() => useDevToolsConnection());

    const sessionData = {
      events: [
        makeEvent({ id: 1 }),
        { id: "not-a-number", type: "agent_start", timestamp: 123 }, // invalid: id not number
        { type: "agent_start", timestamp: 123 }, // invalid: no id
        makeEvent({ id: 4 }),
      ],
    };

    await act(async () => {
      result.current.importSession(JSON.stringify(sessionData));
    });

    expect(result.current.events).toHaveLength(2);
    expect(result.current.error).toContain("2/4 events");
    expect(result.current.error).toContain("2 invalid events skipped");
  });

  it("importSession with no events sets error", async () => {
    const { result } = renderHook(() => useDevToolsConnection());

    await act(async () => {
      result.current.importSession(JSON.stringify({ data: "no events key" }));
    });

    expect(result.current.error).toBe(
      "Invalid session file: missing events array",
    );
  });
});

// ======================= Fork =======================
describe("Fork", () => {
  it("forkFromSnapshot sends fork message", async () => {
    const { result } = renderHook(() => useDevToolsConnection());
    const ws = await connectAndWelcome(result);

    await act(async () => {
      result.current.forkFromSnapshot(42);
    });

    const forkMsg = ws.sent.find((s) => {
      const parsed = JSON.parse(s);

      return parsed.type === "fork_from_snapshot";
    });
    expect(forkMsg).toBeDefined();
    expect(JSON.parse(forkMsg!)).toEqual({
      type: "fork_from_snapshot",
      eventId: 42,
    });
  });

  it("forkFromSnapshot rejects invalid eventId (negative, NaN)", async () => {
    const { result } = renderHook(() => useDevToolsConnection());
    const ws = await connectAndWelcome(result);

    // Negative
    await act(async () => {
      result.current.forkFromSnapshot(-1);
    });
    expect(result.current.error).toBe("Invalid event ID for fork");

    // Clear error for next test
    await act(async () => {
      serverSend(ws, {
        type: "welcome",
        version: 1,
        sessionId: "sess-123",
        timestamp: Date.now(),
      });
    });
    expect(result.current.error).toBeNull();

    // NaN
    await act(async () => {
      result.current.forkFromSnapshot(NaN);
    });
    expect(result.current.error).toBe("Invalid event ID for fork");

    // Infinity
    await act(async () => {
      result.current.forkFromSnapshot(Infinity);
    });
    expect(result.current.error).toBe("Invalid event ID for fork");
  });
});
