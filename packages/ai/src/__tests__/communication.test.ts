import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAgentNetwork,
  createDelegator,
  createMessageBus,
  createResponder,
} from "../communication.js";
import type {
  DelegationResultMessage,
  MessageBus,
  ResponseMessage,
  TypedAgentMessage,
} from "../communication.js";

// ============================================================================
// Helpers
// ============================================================================

/** Let async delivery settle (publish is fire-and-forget). */
function tick(ms = 10): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function publishInform(
  bus: MessageBus,
  from: string,
  to: string | string[] | "*",
  extra: Record<string, unknown> = {},
): string {
  return bus.publish({
    type: "INFORM",
    from,
    to,
    topic: "test",
    content: "hello",
    ...extra,
  } as Omit<TypedAgentMessage, "id" | "timestamp">);
}

// ============================================================================
// createMessageBus
// ============================================================================

describe("createMessageBus", () => {
  it("publish() returns a message ID", () => {
    const bus = createMessageBus();
    const id = publishInform(bus, "a", "b");

    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("subscribe() receives published messages matching the target agent", async () => {
    const bus = createMessageBus();
    const received: TypedAgentMessage[] = [];
    bus.subscribe("writer", (msg) => {
      received.push(msg);
    });

    publishInform(bus, "researcher", "writer");
    await tick();

    expect(received).toHaveLength(1);
    expect(received[0]!.from).toBe("researcher");
  });

  it("messages not addressed to subscriber are not delivered", async () => {
    const bus = createMessageBus();
    const received: TypedAgentMessage[] = [];
    bus.subscribe("writer", (msg) => {
      received.push(msg);
    });

    publishInform(bus, "researcher", "reviewer");
    await tick();

    expect(received).toHaveLength(0);
  });

  it("broadcast ('*') delivers to all subscribers", async () => {
    const bus = createMessageBus();
    const writerMsgs: TypedAgentMessage[] = [];
    const reviewerMsgs: TypedAgentMessage[] = [];
    bus.subscribe("writer", (msg) => {
      writerMsgs.push(msg);
    });
    bus.subscribe("reviewer", (msg) => {
      reviewerMsgs.push(msg);
    });

    publishInform(bus, "researcher", "*");
    await tick();

    expect(writerMsgs).toHaveLength(1);
    expect(reviewerMsgs).toHaveLength(1);
  });

  it("multiple recipients (array) delivers to each", async () => {
    const bus = createMessageBus();
    const writerMsgs: TypedAgentMessage[] = [];
    const reviewerMsgs: TypedAgentMessage[] = [];
    bus.subscribe("writer", (msg) => {
      writerMsgs.push(msg);
    });
    bus.subscribe("reviewer", (msg) => {
      reviewerMsgs.push(msg);
    });

    publishInform(bus, "researcher", ["writer", "reviewer"]);
    await tick();

    expect(writerMsgs).toHaveLength(1);
    expect(reviewerMsgs).toHaveLength(1);
  });

  // --------------------------------------------------------------------------
  // MessageFilter
  // --------------------------------------------------------------------------

  describe("MessageFilter", () => {
    it("filters by type", async () => {
      const bus = createMessageBus();
      const received: TypedAgentMessage[] = [];
      bus.subscribe("agent", (msg) => { received.push(msg); }, {
        types: ["REQUEST"],
      });

      // Publish an INFORM — should be filtered out
      publishInform(bus, "other", "agent");
      await tick();

      expect(received).toHaveLength(0);
    });

    it("filters by from", async () => {
      const bus = createMessageBus();
      const received: TypedAgentMessage[] = [];
      bus.subscribe("agent", (msg) => { received.push(msg); }, { from: "alice" });

      publishInform(bus, "bob", "agent");
      publishInform(bus, "alice", "agent");
      await tick();

      expect(received).toHaveLength(1);
      expect(received[0]!.from).toBe("alice");
    });

    it("filters by priority", async () => {
      const bus = createMessageBus();
      const received: TypedAgentMessage[] = [];
      bus.subscribe("agent", (msg) => { received.push(msg); }, {
        priority: ["urgent"],
      });

      publishInform(bus, "a", "agent", { priority: "low" });
      publishInform(bus, "a", "agent", { priority: "urgent" });
      await tick();

      expect(received).toHaveLength(1);
      expect(received[0]!.priority).toBe("urgent");
    });

    it("filters by custom function", async () => {
      const bus = createMessageBus();
      const received: TypedAgentMessage[] = [];
      bus.subscribe("agent", (msg) => { received.push(msg); }, {
        custom: (msg) => msg.from === "vip",
      });

      publishInform(bus, "nobody", "agent");
      publishInform(bus, "vip", "agent");
      await tick();

      expect(received).toHaveLength(1);
    });
  });

  // --------------------------------------------------------------------------
  // getHistory
  // --------------------------------------------------------------------------

  describe("getHistory", () => {
    it("returns all messages without filter", () => {
      const bus = createMessageBus();
      publishInform(bus, "a", "b");
      publishInform(bus, "c", "d");

      const history = bus.getHistory();

      expect(history).toHaveLength(2);
    });

    it("applies filter to history", () => {
      const bus = createMessageBus();
      publishInform(bus, "alice", "b");
      publishInform(bus, "bob", "b");

      const history = bus.getHistory({ from: "alice" });

      expect(history).toHaveLength(1);
      expect(history[0]!.from).toBe("alice");
    });

    it("respects limit", () => {
      const bus = createMessageBus();
      for (let i = 0; i < 10; i++) {
        publishInform(bus, "a", "b");
      }

      const history = bus.getHistory(undefined, 3);

      expect(history).toHaveLength(3);
    });
  });

  // --------------------------------------------------------------------------
  // getMessage
  // --------------------------------------------------------------------------

  it("getMessage returns a message by ID", () => {
    const bus = createMessageBus();
    const id = publishInform(bus, "a", "b");

    const msg = bus.getMessage(id);

    expect(msg).toBeDefined();
    expect(msg!.id).toBe(id);
  });

  it("getMessage returns undefined for expired messages", () => {
    vi.useFakeTimers();
    try {
      const bus = createMessageBus({ defaultTtlMs: 100 });
      const id = publishInform(bus, "a", "b");

      vi.advanceTimersByTime(200);
      const msg = bus.getMessage(id);

      expect(msg).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  // --------------------------------------------------------------------------
  // getPending / pending delivery
  // --------------------------------------------------------------------------

  it("getPending returns queued messages for offline agents", async () => {
    const bus = createMessageBus();

    // No subscriber for "offline-agent"
    publishInform(bus, "sender", "offline-agent");
    await tick();

    const pending = bus.getPending("offline-agent");

    expect(pending).toHaveLength(1);
  });

  it("delivers pending messages when agent subscribes", async () => {
    const bus = createMessageBus();

    publishInform(bus, "sender", "lazy-agent");
    await tick();

    const received: TypedAgentMessage[] = [];
    bus.subscribe("lazy-agent", (msg) => {
      received.push(msg);
    });
    // Pending delivery is synchronous in subscribe()
    await tick();

    expect(received).toHaveLength(1);
    expect(bus.getPending("lazy-agent")).toHaveLength(0);
  });

  it("maxPendingPerAgent caps queue with FIFO eviction", async () => {
    const bus = createMessageBus({ maxPendingPerAgent: 2 });

    publishInform(bus, "a", "offline", { content: "msg-1" });
    publishInform(bus, "a", "offline", { content: "msg-2" });
    publishInform(bus, "a", "offline", { content: "msg-3" });
    await tick();

    const pending = bus.getPending("offline");

    expect(pending).toHaveLength(2);
    // Oldest (msg-1) should have been evicted
    expect((pending[0] as any).content).toBe("msg-2");
    expect((pending[1] as any).content).toBe("msg-3");
  });

  // --------------------------------------------------------------------------
  // maxHistory
  // --------------------------------------------------------------------------

  it("maxHistory caps message history", () => {
    const bus = createMessageBus({ maxHistory: 3 });

    for (let i = 0; i < 5; i++) {
      publishInform(bus, "a", "b", { content: `msg-${i}` });
    }

    const history = bus.getHistory();

    expect(history).toHaveLength(3);
    // Oldest messages should have been trimmed
    expect((history[0] as any).content).toBe("msg-2");
  });

  // --------------------------------------------------------------------------
  // TTL expiration
  // --------------------------------------------------------------------------

  it("TTL expiration excludes expired messages from history and getPending", () => {
    vi.useFakeTimers();
    try {
      const bus = createMessageBus({ defaultTtlMs: 500 });

      publishInform(bus, "a", "b");
      publishInform(bus, "a", "offline-agent");

      vi.advanceTimersByTime(600);

      expect(bus.getHistory()).toHaveLength(0);
      expect(bus.getPending("offline-agent")).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // --------------------------------------------------------------------------
  // Callbacks
  // --------------------------------------------------------------------------

  it("onDelivery callback fires with recipients", async () => {
    const onDelivery = vi.fn();
    const bus = createMessageBus({ onDelivery });

    bus.subscribe("writer", () => {});
    publishInform(bus, "researcher", "writer");
    await tick();

    expect(onDelivery).toHaveBeenCalledTimes(1);
    expect(onDelivery.mock.calls[0]![1]).toContain("writer");
  });

  it("onDeliveryError callback fires on handler error", async () => {
    const onDeliveryError = vi.fn();
    const bus = createMessageBus({ onDeliveryError });

    bus.subscribe("writer", () => {
      throw new Error("handler boom");
    });

    publishInform(bus, "researcher", "writer");
    await tick();

    expect(onDeliveryError).toHaveBeenCalledTimes(1);
    expect(onDeliveryError.mock.calls[0]![1]).toBeInstanceOf(Error);
    expect((onDeliveryError.mock.calls[0]![1] as Error).message).toBe("handler boom");
  });

  // --------------------------------------------------------------------------
  // clear / destroy
  // --------------------------------------------------------------------------

  it("clear() removes history and pending but keeps subscriptions", async () => {
    const bus = createMessageBus();

    bus.subscribe("agent", () => {});
    publishInform(bus, "a", "b");
    publishInform(bus, "a", "offline");
    await tick();

    bus.clear();

    expect(bus.getHistory()).toHaveLength(0);
    expect(bus.getPending("offline")).toHaveLength(0);

    // Subscriptions still work
    const received: TypedAgentMessage[] = [];
    bus.subscribe("agent2", (msg) => { received.push(msg); });
    publishInform(bus, "x", "agent2");
    await tick();

    expect(received).toHaveLength(1);
  });

  it("destroy() clears everything including subscriptions", async () => {
    const bus = createMessageBus();
    const received: TypedAgentMessage[] = [];

    bus.subscribe("agent", (msg) => { received.push(msg); });
    publishInform(bus, "a", "agent");
    await tick();

    expect(received).toHaveLength(1);

    bus.destroy();

    expect(bus.getHistory()).toHaveLength(0);
    // After destroy, new publishes to the same agent won't deliver (sub cleared)
    publishInform(bus, "a", "agent");
    await tick();

    expect(received).toHaveLength(1); // Still 1, no new delivery
  });
});

// ============================================================================
// createAgentNetwork
// ============================================================================

describe("createAgentNetwork", () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = createMessageBus();
  });

  afterEach(() => {
    bus.destroy();
  });

  // --------------------------------------------------------------------------
  // Agent registration
  // --------------------------------------------------------------------------

  it("register and unregister agents", () => {
    const network = createAgentNetwork({ bus });
    network.register("writer", { capabilities: ["draft"] });

    expect(network.getAgent("writer")).toBeDefined();
    expect(network.getAgent("writer")!.status).toBe("online");

    network.unregister("writer");

    expect(network.getAgent("writer")!.status).toBe("offline");
  });

  it("getAgent returns undefined for unknown agent", () => {
    const network = createAgentNetwork({ bus });

    expect(network.getAgent("nope")).toBeUndefined();
  });

  it("getAgents returns all registered agents", () => {
    const network = createAgentNetwork({
      bus,
      agents: {
        a: { capabilities: ["x"] },
        b: { capabilities: ["y"] },
      },
    });

    expect(network.getAgents()).toHaveLength(2);
  });

  it("findByCapability only returns online agents", () => {
    const network = createAgentNetwork({ bus });
    network.register("a", { capabilities: ["search"] });
    network.register("b", { capabilities: ["search", "write"] });
    network.register("c", { capabilities: ["write"] });
    network.unregister("b");

    const searchers = network.findByCapability("search");

    expect(searchers).toHaveLength(1);
    expect(searchers[0]!.id).toBe("a");
  });

  // --------------------------------------------------------------------------
  // send / broadcast
  // --------------------------------------------------------------------------

  it("send() publishes via bus", async () => {
    const network = createAgentNetwork({ bus });
    const received: TypedAgentMessage[] = [];
    bus.subscribe("target", (msg) => { received.push(msg); });

    network.send("sender", "target", { type: "INFORM", topic: "hi", content: "yo" });
    await tick();

    expect(received).toHaveLength(1);
    expect(received[0]!.from).toBe("sender");
  });

  it("broadcast() publishes to '*'", async () => {
    const network = createAgentNetwork({ bus });
    const aMsgs: TypedAgentMessage[] = [];
    const bMsgs: TypedAgentMessage[] = [];
    bus.subscribe("a", (msg) => { aMsgs.push(msg); });
    bus.subscribe("b", (msg) => { bMsgs.push(msg); });

    network.broadcast("sender", { type: "INFORM", topic: "alert", content: "!" });
    await tick();

    expect(aMsgs).toHaveLength(1);
    expect(bMsgs).toHaveLength(1);
  });

  // --------------------------------------------------------------------------
  // request() — happy path and timeout
  // --------------------------------------------------------------------------

  it("request() resolves with response on happy path", async () => {
    const network = createAgentNetwork({ bus, defaultTimeout: 5000 });

    // Set up a responder that replies to REQUEST messages
    bus.subscribe("target", async (msg) => {
      if (msg.type === "REQUEST") {
        bus.publish({
          type: "RESPONSE",
          from: "target",
          to: msg.from,
          success: true,
          result: "done",
          correlationId: msg.correlationId ?? msg.id,
          replyTo: msg.correlationId ?? msg.id,
        } as Omit<ResponseMessage, "id" | "timestamp">);
      }
    });

    const response = await network.request("requester", "target", "doStuff", {
      key: "val",
    });

    expect(response.success).toBe(true);
    expect(response.result).toBe("done");
  });

  it("request() rejects on timeout", async () => {
    vi.useFakeTimers();
    try {
      const network = createAgentNetwork({ bus, defaultTimeout: 200 });

      // No responder — will time out
      const promise = network.request("requester", "nobody", "doStuff", {});

      vi.advanceTimersByTime(300);

      await expect(promise).rejects.toThrow("Request timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  // --------------------------------------------------------------------------
  // delegate() — happy path
  // --------------------------------------------------------------------------

  it("delegate() resolves with delegation result", async () => {
    const network = createAgentNetwork({ bus });

    bus.subscribe("worker", async (msg) => {
      if (msg.type === "DELEGATION") {
        bus.publish({
          type: "DELEGATION_RESULT",
          from: "worker",
          to: msg.from,
          success: true,
          result: { output: "task done" },
          metrics: { durationMs: 42 },
          correlationId: msg.correlationId ?? msg.id,
          replyTo: msg.correlationId ?? msg.id,
        } as Omit<DelegationResultMessage, "id" | "timestamp">);
      }
    });

    const result = await network.delegate("boss", "worker", "write report", {
      topic: "AI",
    });

    expect(result.success).toBe(true);
    expect(result.result).toEqual({ output: "task done" });
  });

  // --------------------------------------------------------------------------
  // query() — happy path
  // --------------------------------------------------------------------------

  it("query() resolves with response", async () => {
    const network = createAgentNetwork({ bus });

    bus.subscribe("expert", async (msg) => {
      if (msg.type === "QUERY") {
        bus.publish({
          type: "RESPONSE",
          from: "expert",
          to: msg.from,
          success: true,
          result: "42",
          correlationId: msg.correlationId ?? msg.id,
          replyTo: msg.correlationId ?? msg.id,
        } as Omit<ResponseMessage, "id" | "timestamp">);
      }
    });

    const response = await network.query(
      "curious",
      "expert",
      "What is the answer?",
      { context: "universe" },
    );

    expect(response.success).toBe(true);
    expect(response.result).toBe("42");
  });

  // --------------------------------------------------------------------------
  // listen()
  // --------------------------------------------------------------------------

  it("listen() subscribes via bus", async () => {
    const network = createAgentNetwork({ bus });
    network.register("listener", { capabilities: [] });
    const received: TypedAgentMessage[] = [];

    network.listen("listener", (msg) => { received.push(msg); });

    publishInform(bus, "sender", "listener");
    await tick();

    expect(received).toHaveLength(1);
  });

  it("listen() marks agent as online", () => {
    const onAgentOnline = vi.fn();
    const network = createAgentNetwork({
      bus,
      agents: { myAgent: { capabilities: [] } },
      onAgentOnline,
    });

    network.listen("myAgent", () => {});

    expect(network.getAgent("myAgent")!.status).toBe("online");
    expect(onAgentOnline).toHaveBeenCalledWith("myAgent");
  });

  // --------------------------------------------------------------------------
  // destroy()
  // --------------------------------------------------------------------------

  it("destroy() cleans up waiters and agents", () => {
    const network = createAgentNetwork({ bus });
    network.register("a", { capabilities: [] });
    network.register("b", { capabilities: [] });

    network.destroy();

    expect(network.getAgents()).toHaveLength(0);
  });
});

// ============================================================================
// createResponder
// ============================================================================

describe("createResponder", () => {
  it("responds to requests with registered handler", async () => {
    const bus = createMessageBus();
    const network = createAgentNetwork({ bus });

    const responder = createResponder(network, "worker");
    responder.onRequest("greet", async (payload) => ({
      success: true,
      result: `Hello, ${payload.name}!`,
    }));

    // Make a request from "client" to "worker"
    const response = await network.request("client", "worker", "greet", {
      name: "World",
    });

    expect(response.success).toBe(true);
    expect(response.result).toBe("Hello, World!");

    responder.destroy();
    bus.destroy();
  });

  it("responds with error for unknown action", async () => {
    const bus = createMessageBus();
    const network = createAgentNetwork({ bus });

    const responder = createResponder(network, "worker");

    const response = await network.request("client", "worker", "unknown", {});

    expect(response.success).toBe(false);
    expect(response.error).toContain("Unknown action");

    responder.destroy();
    bus.destroy();
  });

  it("responds with error when handler throws", async () => {
    const bus = createMessageBus();
    const network = createAgentNetwork({ bus });

    const responder = createResponder(network, "worker");
    responder.onRequest("fail", async () => {
      throw new Error("handler crashed");
    });

    const response = await network.request("client", "worker", "fail", {});

    expect(response.success).toBe(false);
    expect(response.error).toBe("handler crashed");

    responder.destroy();
    bus.destroy();
  });
});

// ============================================================================
// createDelegator
// ============================================================================

describe("createDelegator", () => {
  it("handles delegation and returns result", async () => {
    const bus = createMessageBus();
    const network = createAgentNetwork({ bus });

    const delegator = createDelegator(network, "worker");
    delegator.onDelegation(async (task, context) => ({
      success: true,
      result: { task, summary: context.topic },
    }));

    const result = await network.delegate("boss", "worker", "write report", {
      topic: "testing",
    });

    expect(result.success).toBe(true);
    expect(result.result).toEqual({
      task: "write report",
      summary: "testing",
    });
    expect(result.metrics).toBeDefined();

    delegator.destroy();
    bus.destroy();
  });

  it("returns error when delegation handler throws", async () => {
    const bus = createMessageBus();
    const network = createAgentNetwork({ bus });

    const delegator = createDelegator(network, "worker");
    delegator.onDelegation(async () => {
      throw new Error("task failed");
    });

    const result = await network.delegate("boss", "worker", "impossible", {});

    expect(result.success).toBe(false);
    expect(result.error).toBe("task failed");

    delegator.destroy();
    bus.destroy();
  });

  it("offDelegation removes the handler", async () => {
    vi.useFakeTimers();
    try {
      const bus = createMessageBus();
      const network = createAgentNetwork({ bus, defaultTimeout: 200 });

      const delegator = createDelegator(network, "worker");
      delegator.onDelegation(async () => ({
        success: true,
        result: "ok",
      }));
      delegator.offDelegation();

      // With no handler, delegation should time out
      const promise = network.delegate("boss", "worker", "task", {});
      vi.advanceTimersByTime(300);

      await expect(promise).rejects.toThrow("Delegation timeout");

      delegator.destroy();
      bus.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});
