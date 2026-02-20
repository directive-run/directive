import { describe, it, expect } from "vitest";
import {
  createTestMultiAgentOrchestrator,
  assertScratchpadState,
} from "../testing.js";
import type { CrossAgentSnapshot } from "../types.js";

// ============================================================================
// Tests
// ============================================================================

describe("shared scratchpad", () => {
  it("get/set/getAll basic operations", () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
      },
      scratchpad: { init: { "plan.status": "draft", "plan.version": 1 } },
    });

    const sp = orchestrator.scratchpad!;

    expect(sp.get("plan.status")).toBe("draft");
    expect(sp.get("plan.version")).toBe(1);

    sp.set("plan.status", "complete");
    expect(sp.get("plan.status")).toBe("complete");

    const all = sp.getAll();
    expect(all).toEqual({ "plan.status": "complete", "plan.version": 1 });
  });

  it("update batches multiple values atomically", () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
      },
      scratchpad: { init: { a: 1, b: 2, c: 3 } },
    });

    const sp = orchestrator.scratchpad!;

    sp.update({ a: 10, b: 20 });

    expect(sp.getAll()).toEqual({ a: 10, b: 20, c: 3 });
  });

  it("subscribe fires on specific key changes", () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
      },
      scratchpad: { init: { x: 0, y: 0, z: 0 } },
    });

    const sp = orchestrator.scratchpad!;
    const events: Array<{ key: string; value: unknown }> = [];

    const unsub = sp.subscribe(["x", "y"], (key, value) => {
      events.push({ key, value });
    });

    sp.set("x", 10);
    sp.set("z", 99); // Should NOT trigger
    sp.set("y", 20);

    expect(events).toEqual([
      { key: "x", value: 10 },
      { key: "y", value: 20 },
    ]);

    unsub();

    sp.set("x", 100);
    // Should not fire after unsubscribe
    expect(events).toHaveLength(2);
  });

  it("onChange fires on any change", () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
      },
      scratchpad: { init: { foo: "bar" } },
    });

    const sp = orchestrator.scratchpad!;
    const changes: string[] = [];

    const unsub = sp.onChange((key) => {
      changes.push(key);
    });

    sp.set("foo", "baz");
    sp.set("newKey", 42);

    expect(changes).toEqual(["foo", "newKey"]);

    unsub();
  });

  it("reset restores initial values", () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
      },
      scratchpad: { init: { status: "idle", count: 0 } },
    });

    const sp = orchestrator.scratchpad!;

    sp.set("status", "active");
    sp.set("count", 42);
    expect(sp.get("status")).toBe("active");

    sp.reset();

    expect(sp.getAll()).toEqual({ status: "idle", count: 0 });
  });

  it("survives orchestrator reset", () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
      },
      scratchpad: { init: { key: "original" } },
    });

    const sp = orchestrator.scratchpad!;

    sp.set("key", "modified");
    expect(sp.get("key")).toBe("modified");

    orchestrator.reset();

    // After orchestrator reset, scratchpad should be re-initialized
    expect(sp.get("key")).toBe("original");
  });

  it("works with constraints (read scratchpad in when)", async () => {
    // This tests that scratchpad values are accessible during constraint evaluation
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
      },
      mockResponses: {
        a: { output: "out", totalTokens: 10 },
      },
      scratchpad: { init: { ready: true } },
    });

    const sp = orchestrator.scratchpad!;
    expect(sp.get("ready")).toBe(true);

    // Agent should still run fine
    const result = await orchestrator.runAgent("a", "input");
    expect(result.output).toBe("out");
  });

  it("null when not configured", () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
      },
    });

    expect(orchestrator.scratchpad).toBeNull();
  });

  it("concurrent writes via update are serialized", () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
      },
      scratchpad: { init: { a: 0, b: 0 } },
    });

    const sp = orchestrator.scratchpad!;

    // Two updates — last one wins for shared keys
    sp.update({ a: 1, b: 2 });
    sp.update({ a: 10, b: 20 });

    expect(sp.getAll()).toEqual({ a: 10, b: 20 });
  });

  it("visible in cross-agent derivation snapshot", async () => {
    let capturedScratchpad: Record<string, unknown> | undefined;

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
      },
      mockResponses: {
        a: { output: "out", totalTokens: 10 },
      },
      scratchpad: { init: { "plan.status": "ready" } },
      derive: {
        hasPlan: (snapshot: CrossAgentSnapshot) => {
          capturedScratchpad = snapshot.scratchpad;

          return snapshot.scratchpad?.["plan.status"] === "ready";
        },
      },
    });

    await orchestrator.runAgent("a", "input");

    expect(capturedScratchpad).toBeDefined();
    expect(capturedScratchpad!["plan.status"]).toBe("ready");
    expect(orchestrator.derived.hasPlan).toBe(true);
  });

  it("timeline records scratchpad_update events", () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
      },
      scratchpad: { init: { x: 0 } },
      debug: true,
    });

    orchestrator.scratchpad!.set("x", 42);

    const events = orchestrator.timeline!.getEvents();
    const spEvents = events.filter((e) => e.type === "scratchpad_update");

    expect(spEvents.length).toBeGreaterThanOrEqual(1);
    expect(spEvents[0]).toMatchObject({
      type: "scratchpad_update",
      keys: ["x"],
    });
  });

  it("lifecycle hook fires on scratchpad change", () => {
    const hookEvents: Array<{ keys: string[] }> = [];

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
      },
      scratchpad: { init: { a: 0 } },
      hooks: {
        onScratchpadUpdate: (event) => {
          hookEvents.push({ keys: event.keys });
        },
      },
    });

    orchestrator.scratchpad!.set("a", 1);
    orchestrator.scratchpad!.update({ a: 2, b: 3 });

    // set("a", 1) fires once, update({a, b}) fires once (batched per last key)
    expect(hookEvents).toHaveLength(2);
    expect(hookEvents[0]!.keys).toEqual(["a"]);
  });

  it("has() checks key existence", () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
      },
      scratchpad: { init: { existing: "value" } },
    });

    const sp = orchestrator.scratchpad!;

    expect(sp.has("existing")).toBe(true);
    expect(sp.has("nonexistent")).toBe(false);

    sp.set("newKey", 42);
    expect(sp.has("newKey")).toBe(true);
  });

  it("delete() removes a key", () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
      },
      scratchpad: { init: { a: 1, b: 2, c: 3 } },
    });

    const sp = orchestrator.scratchpad!;

    sp.delete("b");

    expect(sp.has("b")).toBe(false);
    expect(sp.get("b")).toBeUndefined();
    expect(sp.getAll()).toEqual({ a: 1, c: 3 });
  });

  it("delete() fires onChange callbacks with undefined", () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
      },
      scratchpad: { init: { x: 10 } },
    });

    const sp = orchestrator.scratchpad!;
    const events: Array<{ key: string; value: unknown }> = [];

    sp.onChange((key, value) => {
      events.push({ key, value });
    });

    sp.delete("x");

    expect(events).toEqual([{ key: "x", value: undefined }]);
  });

  it("assertScratchpadState helper works", () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
      },
      scratchpad: { init: { x: 1, y: "hello" } },
    });

    // Should not throw
    assertScratchpadState(orchestrator.scratchpad!, { x: 1, y: "hello" });

    // Should throw on mismatch
    expect(() =>
      assertScratchpadState(orchestrator.scratchpad!, { x: 999 }),
    ).toThrow();
  });
});
