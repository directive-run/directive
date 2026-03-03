import { describe, expect, it } from "vitest";
import {
  assertDerivedValues,
  createTestMultiAgentOrchestrator,
} from "../testing.js";
import type { CrossAgentSnapshot } from "../types.js";

// ============================================================================
// Tests
// ============================================================================

describe("cross-agent derivations", () => {
  it("recomputes when agent completes", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
      },
      mockResponses: {
        a: { output: "result-a", totalTokens: 10 },
        b: { output: "result-b", totalTokens: 20 },
      },
      derive: {
        totalTokens: (snapshot: CrossAgentSnapshot) => {
          let sum = 0;
          for (const state of Object.values(snapshot.agents)) {
            sum += state.totalTokens;
          }

          return sum;
        },
      },
    });

    // Before any runs, total should be 0
    expect(orchestrator.derived.totalTokens).toBe(0);

    await orchestrator.runAgent("a", "input");
    expect(orchestrator.derived.totalTokens).toBe(10);

    await orchestrator.runAgent("b", "input");
    expect(orchestrator.derived.totalTokens).toBe(30);
  });

  it("provides correct snapshot shape", async () => {
    let capturedSnapshot: CrossAgentSnapshot | undefined;

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        agent1: { agent: { name: "agent1" } },
      },
      mockResponses: {
        agent1: { output: "hello", totalTokens: 42 },
      },
      derive: {
        check: (snapshot: CrossAgentSnapshot) => {
          capturedSnapshot = snapshot;

          return true;
        },
      },
    });

    await orchestrator.runAgent("agent1", "test input");

    expect(capturedSnapshot).toBeDefined();
    expect(capturedSnapshot!.agents).toHaveProperty("agent1");
    expect(capturedSnapshot!.agents.agent1).toMatchObject({
      status: "completed",
      runCount: 1,
      totalTokens: 42,
    });
    expect(capturedSnapshot!.coordinator).toHaveProperty("globalTokens");
    expect(capturedSnapshot!.coordinator).toHaveProperty("status");
  });

  it("multiple derivations update atomically", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
      },
      mockResponses: {
        a: { output: "done", totalTokens: 10 },
      },
      derive: {
        count: (snapshot: CrossAgentSnapshot) => {
          let count = 0;
          for (const state of Object.values(snapshot.agents)) {
            if (state.status === "completed") {
              count++;
            }
          }

          return count;
        },
        allDone: (snapshot: CrossAgentSnapshot) =>
          Object.values(snapshot.agents).every((s) => s.status === "completed"),
      },
    });

    await orchestrator.runAgent("a", "input");

    // Both derivations should reflect the completed state
    expect(orchestrator.derived.count).toBe(1);
    expect(orchestrator.derived.allDone).toBe(true);
  });

  it("throwing derivation does not crash orchestrator", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
      },
      mockResponses: {
        a: { output: "result", totalTokens: 10 },
      },
      derive: {
        broken: () => {
          throw new Error("Derivation exploded");
        },
        healthy: (snapshot: CrossAgentSnapshot) =>
          Object.values(snapshot.agents).length,
      },
    });

    // Should not throw
    const result = await orchestrator.runAgent("a", "input");

    expect(result.output).toBe("result");
    // Healthy derivation still works
    expect(orchestrator.derived.healthy).toBe(1);
  });

  it("derived reflects latest values", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
      },
      mockResponses: {
        a: { output: "out", totalTokens: 5 },
      },
      derive: {
        runs: (snapshot: CrossAgentSnapshot) =>
          snapshot.agents.a?.runCount ?? 0,
      },
    });

    expect(orchestrator.derived.runs).toBe(0);

    await orchestrator.runAgent("a", "1");
    expect(orchestrator.derived.runs).toBe(1);

    await orchestrator.runAgent("a", "2");
    expect(orchestrator.derived.runs).toBe(2);
  });

  it("onDerivedChange fires on value change", async () => {
    const changes: Array<{ id: string; value: unknown }> = [];

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
      },
      mockResponses: {
        a: { output: "out", totalTokens: 10 },
      },
      derive: {
        completedCount: (snapshot: CrossAgentSnapshot) => {
          let count = 0;
          for (const state of Object.values(snapshot.agents)) {
            if (state.status === "completed") {
              count++;
            }
          }

          return count;
        },
      },
    });

    const unsub = orchestrator.onDerivedChange((id, value) => {
      changes.push({ id, value });
    });

    await orchestrator.runAgent("a", "input");

    expect(changes).toEqual([{ id: "completedCount", value: 1 }]);

    // Running again should still fire since runCount changes (derivation recomputes)
    // But completedCount stays at 1, so no change should fire
    await orchestrator.runAgent("a", "input again");

    // completedCount is still 1, so no additional change event
    expect(changes).toHaveLength(1);

    unsub();
  });

  it("zero overhead when not configured", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
      },
      mockResponses: {
        a: { output: "out", totalTokens: 10 },
      },
      // No derive option
    });

    // derived should be an empty frozen object
    expect(orchestrator.derived).toEqual({});
    expect(Object.isFrozen(orchestrator.derived)).toBe(true);

    // Should not throw
    await orchestrator.runAgent("a", "input");
  });

  it("works with reset", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
      },
      mockResponses: {
        a: { output: "out", totalTokens: 10 },
      },
      derive: {
        tokens: (snapshot: CrossAgentSnapshot) =>
          snapshot.agents.a?.totalTokens ?? 0,
      },
    });

    await orchestrator.runAgent("a", "input");
    expect(orchestrator.derived.tokens).toBe(10);

    orchestrator.reset();
    // After reset, agent states are cleared
    expect(orchestrator.derived.tokens).toBe(0);
  });

  it("works with registerAgent and unregisterAgent", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
      },
      mockResponses: {
        a: { output: "out", totalTokens: 10 },
      },
      derive: {
        agentCount: (snapshot: CrossAgentSnapshot) =>
          Object.keys(snapshot.agents).length,
      },
    });

    expect(orchestrator.derived.agentCount).toBe(1);

    orchestrator.registerAgent("b", { agent: { name: "b" } });
    expect(orchestrator.derived.agentCount).toBe(2);

    orchestrator.unregisterAgent("b");
    expect(orchestrator.derived.agentCount).toBe(1);
  });

  it("timeline records derivation_update events", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
      },
      mockResponses: {
        a: { output: "out", totalTokens: 10 },
      },
      derive: {
        myDeriv: (snapshot: CrossAgentSnapshot) =>
          snapshot.agents.a?.runCount ?? 0,
      },
      debug: true,
    });

    await orchestrator.runAgent("a", "input");

    const events = orchestrator.timeline!.getEvents();
    const derivEvents = events.filter((e) => e.type === "derivation_update");

    expect(derivEvents.length).toBeGreaterThanOrEqual(1);
    expect(derivEvents[0]).toMatchObject({
      type: "derivation_update",
      derivationId: "myDeriv",
    });
  });

  it("lifecycle hook fires on derivation change", async () => {
    const hookEvents: Array<{ derivationId: string; value: unknown }> = [];

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
      },
      mockResponses: {
        a: { output: "out", totalTokens: 10 },
      },
      derive: {
        status: (snapshot: CrossAgentSnapshot) =>
          snapshot.agents.a?.status ?? "idle",
      },
      hooks: {
        onDerivationUpdate: (event) => {
          hookEvents.push({
            derivationId: event.derivationId,
            value: event.value,
          });
        },
      },
    });

    await orchestrator.runAgent("a", "input");

    expect(hookEvents.length).toBeGreaterThanOrEqual(1);
    expect(hookEvents[hookEvents.length - 1]).toMatchObject({
      derivationId: "status",
      value: "completed",
    });
  });

  it("includes scratchpad in snapshot when configured", async () => {
    let capturedSnapshot: CrossAgentSnapshot | undefined;

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
      },
      mockResponses: {
        a: { output: "out", totalTokens: 10 },
      },
      scratchpad: { init: { "plan.status": "draft" } },
      derive: {
        check: (snapshot: CrossAgentSnapshot) => {
          capturedSnapshot = snapshot;

          return true;
        },
      },
    });

    await orchestrator.runAgent("a", "input");

    expect(capturedSnapshot).toBeDefined();
    expect(capturedSnapshot!.scratchpad).toEqual({ "plan.status": "draft" });
  });

  it("assertDerivedValues helper works", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
      },
      mockResponses: {
        a: { output: "out", totalTokens: 10 },
      },
      derive: {
        value: () => 42,
        label: () => "hello",
      },
    });

    await orchestrator.runAgent("a", "input");

    // Should not throw
    assertDerivedValues(orchestrator, { value: 42, label: "hello" });

    // Should throw on mismatch
    expect(() => assertDerivedValues(orchestrator, { value: 99 })).toThrow();
  });
});
