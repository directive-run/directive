import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDebugTimeline } from "../debug-timeline.js";
import {
  type DevToolsClient,
  type DevToolsClientMessage,
  type DevToolsServerMessage,
  type DevToolsSnapshot,
  type DevToolsTransport,
  createDevToolsServer,
} from "../devtools-server.js";
import { createHealthMonitor } from "../health-monitor.js";
import type { BreakpointState } from "../types.js";

// ============================================================================
// Test helpers
// ============================================================================

interface MockClient {
  client: DevToolsClient;
  messages: DevToolsServerMessage[];
  closed: boolean;
  triggerMessage: (data: string) => void;
  triggerClose: () => void;
}

function createMockTransport(): {
  transport: DevToolsTransport;
  connect: () => MockClient;
  closed: boolean;
} {
  let connectionHandler:
    | ((
        client: DevToolsClient,
        onMessage: (handler: (data: string) => void) => void,
        onClose: (handler: () => void) => void,
      ) => void)
    | null = null;

  let closed = false;

  const result = {
    transport: {
      onConnection(
        handler: (
          client: DevToolsClient,
          onMessage: (handler: (data: string) => void) => void,
          onClose: (handler: () => void) => void,
        ) => void,
      ) {
        connectionHandler = handler;
      },
      close() {
        closed = true;
      },
    } satisfies DevToolsTransport,

    connect(): MockClient {
      const messages: DevToolsServerMessage[] = [];
      let messageHandler: ((data: string) => void) | null = null;
      let closeHandler: (() => void) | null = null;
      const isClosed = false;

      const mock: MockClient = {
        messages,
        closed: isClosed,
        triggerMessage(data: string) {
          messageHandler?.(data);
        },
        triggerClose() {
          closeHandler?.();
        },
        client: {
          send(data: string) {
            messages.push(JSON.parse(data));
          },
          close() {
            mock.closed = true;
          },
        },
      };

      connectionHandler?.(
        mock.client,
        (handler) => {
          messageHandler = handler;
        },
        (handler) => {
          closeHandler = handler;
        },
      );

      return mock;
    },

    get closed() {
      return closed;
    },
  };

  return result;
}

function sendCommand(client: MockClient, msg: DevToolsClientMessage): void {
  client.triggerMessage(JSON.stringify(msg));
}

// ============================================================================
// Tests
// ============================================================================

describe("DevTools Server", () => {
  let timeline: ReturnType<typeof createDebugTimeline>;
  let mockTransport: ReturnType<typeof createMockTransport>;

  beforeEach(() => {
    timeline = createDebugTimeline({ maxEvents: 100 });
    mockTransport = createMockTransport();
  });

  describe("connection lifecycle", () => {
    it("sends welcome message on connection", () => {
      const server = createDevToolsServer({
        transport: mockTransport.transport,
        timeline,
      });

      const client = mockTransport.connect();
      expect(client.messages).toHaveLength(1);
      expect(client.messages[0]!.type).toBe("welcome");

      const welcome = client.messages[0] as Extract<
        DevToolsServerMessage,
        { type: "welcome" }
      >;
      expect(welcome.version).toBe(1);
      expect(welcome.sessionId).toMatch(/^devtools_/);
      expect(welcome.timestamp).toBeGreaterThan(0);

      server.close();
    });

    it("tracks client count", () => {
      const server = createDevToolsServer({
        transport: mockTransport.transport,
        timeline,
      });

      expect(server.clientCount).toBe(0);

      const client1 = mockTransport.connect();
      expect(server.clientCount).toBe(1);

      mockTransport.connect();
      expect(server.clientCount).toBe(2);

      client1.triggerClose();
      expect(server.clientCount).toBe(1);

      server.close();
    });

    it("closes all clients and transport on server close", () => {
      const server = createDevToolsServer({
        transport: mockTransport.transport,
        timeline,
      });

      const client1 = mockTransport.connect();
      const client2 = mockTransport.connect();

      server.close();

      expect(client1.closed).toBe(true);
      expect(client2.closed).toBe(true);
      expect(mockTransport.closed).toBe(true);
    });
  });

  describe("event streaming", () => {
    it("broadcasts timeline events to connected clients", () => {
      const server = createDevToolsServer({
        transport: mockTransport.transport,
        timeline,
      });

      const client = mockTransport.connect();
      // Clear welcome message
      client.messages.length = 0;

      timeline.record({
        type: "agent_start",
        timestamp: Date.now(),
        agentId: "test-agent",
        snapshotId: null,
        inputLength: 42,
      });

      expect(client.messages).toHaveLength(1);
      expect(client.messages[0]!.type).toBe("event");

      const msg = client.messages[0] as Extract<
        DevToolsServerMessage,
        { type: "event" }
      >;
      expect(msg.event.type).toBe("agent_start");
      expect(msg.event.agentId).toBe("test-agent");

      server.close();
    });

    it("does not send events when no clients connected", () => {
      const server = createDevToolsServer({
        transport: mockTransport.transport,
        timeline,
      });

      // Record event with no clients — should not throw
      timeline.record({
        type: "agent_start",
        timestamp: Date.now(),
        agentId: "test",
        snapshotId: null,
        inputLength: 10,
      });

      // Connect after — should only get welcome
      const client = mockTransport.connect();
      expect(client.messages).toHaveLength(1);
      expect(client.messages[0]!.type).toBe("welcome");

      server.close();
    });

    it("broadcasts to multiple clients", () => {
      const server = createDevToolsServer({
        transport: mockTransport.transport,
        timeline,
      });

      const client1 = mockTransport.connect();
      const client2 = mockTransport.connect();
      client1.messages.length = 0;
      client2.messages.length = 0;

      timeline.record({
        type: "agent_complete",
        timestamp: Date.now(),
        agentId: "agent-a",
        snapshotId: null,
        outputLength: 100,
        totalTokens: 500,
        durationMs: 1200,
      });

      expect(client1.messages).toHaveLength(1);
      expect(client2.messages).toHaveLength(1);

      server.close();
    });

    it("stops streaming after unsubscribe (server close)", () => {
      const server = createDevToolsServer({
        transport: mockTransport.transport,
        timeline,
      });

      const client = mockTransport.connect();
      client.messages.length = 0;

      server.close();

      timeline.record({
        type: "agent_start",
        timestamp: Date.now(),
        agentId: "test",
        snapshotId: null,
        inputLength: 5,
      });

      // No new messages after close
      expect(client.messages).toHaveLength(0);
    });
  });

  describe("event batching", () => {
    it("batches events when batchSize > 1", () => {
      vi.useFakeTimers();

      const server = createDevToolsServer({
        transport: mockTransport.transport,
        timeline,
        batchSize: 3,
        batchIntervalMs: 100,
      });

      const client = mockTransport.connect();
      client.messages.length = 0;

      // Record 2 events — not enough to flush
      timeline.record({
        type: "agent_start",
        timestamp: 1,
        agentId: "a",
        snapshotId: null,
        inputLength: 1,
      });
      timeline.record({
        type: "agent_start",
        timestamp: 2,
        agentId: "b",
        snapshotId: null,
        inputLength: 2,
      });
      expect(client.messages).toHaveLength(0);

      // 3rd event triggers flush
      timeline.record({
        type: "agent_start",
        timestamp: 3,
        agentId: "c",
        snapshotId: null,
        inputLength: 3,
      });
      expect(client.messages).toHaveLength(1);
      expect(client.messages[0]!.type).toBe("event_batch");

      const batch = client.messages[0] as Extract<
        DevToolsServerMessage,
        { type: "event_batch" }
      >;
      expect(batch.events).toHaveLength(3);

      server.close();
      vi.useRealTimers();
    });

    it("flushes remaining events on timer", () => {
      vi.useFakeTimers();

      const server = createDevToolsServer({
        transport: mockTransport.transport,
        timeline,
        batchSize: 10,
        batchIntervalMs: 50,
      });

      const client = mockTransport.connect();
      client.messages.length = 0;

      timeline.record({
        type: "agent_start",
        timestamp: 1,
        agentId: "a",
        snapshotId: null,
        inputLength: 1,
      });
      expect(client.messages).toHaveLength(0);

      vi.advanceTimersByTime(50);
      expect(client.messages).toHaveLength(1);
      // Single event sent as "event" not "event_batch"
      expect(client.messages[0]!.type).toBe("event");

      server.close();
      vi.useRealTimers();
    });
  });

  describe("client commands", () => {
    it("handles ping", () => {
      const server = createDevToolsServer({
        transport: mockTransport.transport,
        timeline,
      });

      const client = mockTransport.connect();
      client.messages.length = 0;

      sendCommand(client, { type: "ping" });
      expect(client.messages).toHaveLength(1);
      expect(client.messages[0]!.type).toBe("pong");

      server.close();
    });

    it("handles request_events", () => {
      const server = createDevToolsServer({
        transport: mockTransport.transport,
        timeline,
      });

      // Record some events before connecting
      timeline.record({
        type: "agent_start",
        timestamp: 1,
        agentId: "a",
        snapshotId: null,
        inputLength: 1,
      });
      timeline.record({
        type: "agent_complete",
        timestamp: 2,
        agentId: "a",
        snapshotId: null,
        outputLength: 10,
        totalTokens: 100,
        durationMs: 500,
      });

      const client = mockTransport.connect();
      client.messages.length = 0;

      sendCommand(client, { type: "request_events" });
      expect(client.messages).toHaveLength(1);
      expect(client.messages[0]!.type).toBe("event_batch");

      const batch = client.messages[0] as Extract<
        DevToolsServerMessage,
        { type: "event_batch" }
      >;
      expect(batch.events).toHaveLength(2);

      server.close();
    });

    it("handles request_events with since filter", () => {
      const server = createDevToolsServer({
        transport: mockTransport.transport,
        timeline,
      });

      timeline.record({
        type: "agent_start",
        timestamp: 1,
        agentId: "a",
        snapshotId: null,
        inputLength: 1,
      });
      timeline.record({
        type: "agent_complete",
        timestamp: 2,
        agentId: "a",
        snapshotId: null,
        outputLength: 10,
        totalTokens: 100,
        durationMs: 500,
      });

      const client = mockTransport.connect();
      client.messages.length = 0;

      // Request only events after id 0
      sendCommand(client, { type: "request_events", since: 0 });
      const batch = client.messages[0] as Extract<
        DevToolsServerMessage,
        { type: "event_batch" }
      >;
      expect(batch.events).toHaveLength(1);
      expect(batch.events[0]!.id).toBe(1);

      server.close();
    });

    it("handles request_snapshot", () => {
      const snapshot: DevToolsSnapshot = {
        timestamp: Date.now(),
        agents: {
          researcher: { status: "completed", totalTokens: 500, runCount: 1 },
        },
        eventCount: 5,
      };

      const server = createDevToolsServer({
        transport: mockTransport.transport,
        timeline,
        getSnapshot: () => snapshot,
      });

      const client = mockTransport.connect();
      client.messages.length = 0;

      sendCommand(client, { type: "request_snapshot" });
      expect(client.messages).toHaveLength(1);
      expect(client.messages[0]!.type).toBe("snapshot");

      const msg = client.messages[0] as Extract<
        DevToolsServerMessage,
        { type: "snapshot" }
      >;
      expect(msg.data.agents.researcher!.status).toBe("completed");

      server.close();
    });

    it("returns error when snapshot not configured", () => {
      const server = createDevToolsServer({
        transport: mockTransport.transport,
        timeline,
      });

      const client = mockTransport.connect();
      client.messages.length = 0;

      sendCommand(client, { type: "request_snapshot" });
      expect(client.messages[0]!.type).toBe("error");

      const err = client.messages[0] as Extract<
        DevToolsServerMessage,
        { type: "error" }
      >;
      expect(err.code).toBe("NO_SNAPSHOT");

      server.close();
    });

    it("handles request_health", () => {
      const monitor = createHealthMonitor();
      monitor.recordSuccess("agent-a", 100);

      const server = createDevToolsServer({
        transport: mockTransport.transport,
        timeline,
        healthMonitor: monitor,
      });

      const client = mockTransport.connect();
      client.messages.length = 0;

      sendCommand(client, { type: "request_health" });
      expect(client.messages).toHaveLength(1);
      expect(client.messages[0]!.type).toBe("health");

      const msg = client.messages[0] as Extract<
        DevToolsServerMessage,
        { type: "health" }
      >;
      expect(msg.metrics["agent-a"]).toBeDefined();
      expect(msg.metrics["agent-a"]!.healthScore).toBeGreaterThan(0);

      server.close();
    });

    it("handles request_breakpoints", () => {
      const bpState: BreakpointState = {
        pending: [
          {
            id: "bp_1",
            type: "pre_agent_run",
            agentId: "a",
            input: "test",
            requestedAt: Date.now(),
          },
        ],
        resolved: [],
        cancelled: [],
      };

      const server = createDevToolsServer({
        transport: mockTransport.transport,
        timeline,
        getBreakpointState: () => bpState,
      });

      const client = mockTransport.connect();
      client.messages.length = 0;

      sendCommand(client, { type: "request_breakpoints" });
      expect(client.messages).toHaveLength(1);
      expect(client.messages[0]!.type).toBe("breakpoints");

      const msg = client.messages[0] as Extract<
        DevToolsServerMessage,
        { type: "breakpoints" }
      >;
      expect(msg.state.pending).toHaveLength(1);
      expect(msg.state.pending[0]!.id).toBe("bp_1");

      server.close();
    });

    it("handles resume_breakpoint", () => {
      const onResume = vi.fn();

      const server = createDevToolsServer({
        transport: mockTransport.transport,
        timeline,
        onResumeBreakpoint: onResume,
      });

      const client = mockTransport.connect();
      sendCommand(client, {
        type: "resume_breakpoint",
        breakpointId: "bp_1",
        modifications: { input: "modified" },
      });

      expect(onResume).toHaveBeenCalledWith("bp_1", { input: "modified" });

      server.close();
    });

    it("handles cancel_breakpoint", () => {
      const onCancel = vi.fn();

      const server = createDevToolsServer({
        transport: mockTransport.transport,
        timeline,
        onCancelBreakpoint: onCancel,
      });

      const client = mockTransport.connect();
      sendCommand(client, {
        type: "cancel_breakpoint",
        breakpointId: "bp_1",
        reason: "not needed",
      });

      expect(onCancel).toHaveBeenCalledWith("bp_1", "not needed");

      server.close();
    });

    it("handles export_session", () => {
      const server = createDevToolsServer({
        transport: mockTransport.transport,
        timeline,
      });

      timeline.record({
        type: "agent_start",
        timestamp: 1,
        agentId: "a",
        snapshotId: null,
        inputLength: 1,
      });

      const client = mockTransport.connect();
      client.messages.length = 0;

      sendCommand(client, { type: "export_session" });
      expect(client.messages).toHaveLength(1);
      expect(client.messages[0]!.type).toBe("event_batch");

      server.close();
    });

    it("handles import_session", () => {
      const server = createDevToolsServer({
        transport: mockTransport.transport,
        timeline,
      });

      const exportData = JSON.stringify({
        version: 1,
        events: [
          {
            id: 0,
            type: "agent_start",
            timestamp: 100,
            agentId: "imported",
            snapshotId: null,
            inputLength: 5,
          },
        ],
        nextId: 1,
      });

      const client = mockTransport.connect();
      client.messages.length = 0;

      sendCommand(client, { type: "import_session", data: exportData });
      expect(client.messages).toHaveLength(1);
      expect(client.messages[0]!.type).toBe("event_batch");

      const batch = client.messages[0] as Extract<
        DevToolsServerMessage,
        { type: "event_batch" }
      >;
      expect(batch.events).toHaveLength(1);
      expect(batch.events[0]!.agentId).toBe("imported");

      server.close();
    });

    it("returns error for invalid JSON", () => {
      const server = createDevToolsServer({
        transport: mockTransport.transport,
        timeline,
      });

      const client = mockTransport.connect();
      client.messages.length = 0;

      client.triggerMessage("not json{{{");
      expect(client.messages).toHaveLength(1);
      expect(client.messages[0]!.type).toBe("error");

      const err = client.messages[0] as Extract<
        DevToolsServerMessage,
        { type: "error" }
      >;
      expect(err.code).toBe("INVALID_JSON");

      server.close();
    });

    it("returns error for unknown command", () => {
      const server = createDevToolsServer({
        transport: mockTransport.transport,
        timeline,
      });

      const client = mockTransport.connect();
      client.messages.length = 0;

      sendCommand(client, {
        type: "unknown_thing",
      } as unknown as DevToolsClientMessage);
      expect(client.messages).toHaveLength(1);
      expect(client.messages[0]!.type).toBe("error");

      const err = client.messages[0] as Extract<
        DevToolsServerMessage,
        { type: "error" }
      >;
      expect(err.code).toBe("UNKNOWN_COMMAND");

      server.close();
    });
  });

  describe("push methods", () => {
    it("pushHealth broadcasts metrics to all clients", () => {
      const monitor = createHealthMonitor();
      monitor.recordSuccess("agent-a", 50);

      const server = createDevToolsServer({
        transport: mockTransport.transport,
        timeline,
        healthMonitor: monitor,
      });

      const client = mockTransport.connect();
      client.messages.length = 0;

      server.pushHealth();

      expect(client.messages).toHaveLength(1);
      expect(client.messages[0]!.type).toBe("health");

      server.close();
    });

    it("pushBreakpoints broadcasts breakpoint state", () => {
      const bpState: BreakpointState = {
        pending: [],
        resolved: ["bp_1"],
        cancelled: [],
      };

      const server = createDevToolsServer({
        transport: mockTransport.transport,
        timeline,
        getBreakpointState: () => bpState,
      });

      const client = mockTransport.connect();
      client.messages.length = 0;

      server.pushBreakpoints();

      expect(client.messages).toHaveLength(1);
      expect(client.messages[0]!.type).toBe("breakpoints");

      server.close();
    });

    it("broadcast sends custom messages", () => {
      const server = createDevToolsServer({
        transport: mockTransport.transport,
        timeline,
      });

      const client = mockTransport.connect();
      client.messages.length = 0;

      server.broadcast({ type: "error", code: "CUSTOM", message: "test" });
      expect(client.messages).toHaveLength(1);
      expect(client.messages[0]!.type).toBe("error");

      server.close();
    });
  });

  describe("auto health push", () => {
    it("pushes health metrics on interval", () => {
      vi.useFakeTimers();

      const monitor = createHealthMonitor();
      monitor.recordSuccess("x", 10);

      const server = createDevToolsServer({
        transport: mockTransport.transport,
        timeline,
        healthMonitor: monitor,
        healthPushIntervalMs: 1000,
      });

      const client = mockTransport.connect();
      client.messages.length = 0;

      vi.advanceTimersByTime(1000);
      expect(client.messages).toHaveLength(1);
      expect(client.messages[0]!.type).toBe("health");

      vi.advanceTimersByTime(1000);
      expect(client.messages).toHaveLength(2);

      server.close();
      vi.useRealTimers();
    });
  });

  describe("timeline subscribe", () => {
    it("subscribe fires callback on record", () => {
      const cb = vi.fn();
      timeline.subscribe(cb);

      timeline.record({
        type: "agent_start",
        timestamp: Date.now(),
        agentId: "sub-test",
        snapshotId: null,
        inputLength: 1,
      });

      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb.mock.calls[0]![0].type).toBe("agent_start");
      expect(cb.mock.calls[0]![0].agentId).toBe("sub-test");
    });

    it("unsubscribe stops callbacks", () => {
      const cb = vi.fn();
      const unsub = timeline.subscribe(cb);

      timeline.record({
        type: "agent_start",
        timestamp: 1,
        agentId: "a",
        snapshotId: null,
        inputLength: 1,
      });
      expect(cb).toHaveBeenCalledTimes(1);

      unsub();

      timeline.record({
        type: "agent_start",
        timestamp: 2,
        agentId: "b",
        snapshotId: null,
        inputLength: 2,
      });
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it("throwing listener does not break other listeners", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const good = vi.fn();
      const bad = vi.fn(() => {
        throw new Error("boom");
      });

      timeline.subscribe(bad);
      timeline.subscribe(good);

      timeline.record({
        type: "agent_start",
        timestamp: 1,
        agentId: "a",
        snapshotId: null,
        inputLength: 1,
      });

      expect(bad).toHaveBeenCalledTimes(1);
      expect(good).toHaveBeenCalledTimes(1);

      errorSpy.mockRestore();
    });
  });

  describe("error resilience", () => {
    it("handles client send failure gracefully", () => {
      const server = createDevToolsServer({
        transport: mockTransport.transport,
        timeline,
      });

      const client = mockTransport.connect();

      // Override send to throw
      const originalSend = client.client.send;
      client.client.send = () => {
        throw new Error("connection closed");
      };

      // Should not throw
      timeline.record({
        type: "agent_start",
        timestamp: 1,
        agentId: "a",
        snapshotId: null,
        inputLength: 1,
      });

      // Client should be removed
      expect(server.clientCount).toBe(0);

      // Restore and verify new clients still work
      client.client.send = originalSend;

      server.close();
    });
  });
});
