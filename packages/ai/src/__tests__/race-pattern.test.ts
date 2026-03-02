import { describe, it, expect } from "vitest";
import {
  createTestMultiAgentOrchestrator,
} from "../testing.js";
import { race } from "../multi-agent-orchestrator.js";

// ============================================================================
// Tests
// ============================================================================

describe("race pattern", () => {
  it("first agent to complete wins", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        fast: { agent: { name: "fast" } },
        slow: { agent: { name: "slow" } },
      },
      mockResponses: {
        fast: { output: "fast result", totalTokens: 10, delay: 10 },
        slow: { output: "slow result", totalTokens: 20, delay: 100 },
      },
      patterns: {
        myRace: race(["fast", "slow"]),
      },
    });

    const result = await orchestrator.runPattern<{ winnerId: string; result: unknown }>("myRace", "go");

    // runPattern extracts the result, so we get the output directly
    expect(result).toBe("fast result");
  });

  it("slow agent wins if fast agent fails", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        fast: { agent: { name: "fast" } },
        slow: { agent: { name: "slow" } },
      },
      mockResponses: {
        fast: { output: "n/a", totalTokens: 0, delay: 10, error: new Error("Fast failed") },
        slow: { output: "slow wins", totalTokens: 20, delay: 50 },
      },
      patterns: {
        myRace: race(["fast", "slow"]),
      },
    });

    const result = await orchestrator.runPattern<string>("myRace", "go");

    expect(result).toBe("slow wins");
  });

  it("all agents fail throws aggregated error", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
      },
      mockResponses: {
        a: { output: "n/a", totalTokens: 0, error: new Error("A failed") },
        b: { output: "n/a", totalTokens: 0, error: new Error("B failed") },
      },
      patterns: {
        myRace: race(["a", "b"]),
      },
    });

    await expect(
      orchestrator.runPattern("myRace", "go"),
    ).rejects.toThrow("all 2 agents failed");
  });

  it("custom extract function", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
      },
      mockResponses: {
        a: { output: { data: "important", meta: "ignore" }, totalTokens: 10, delay: 10 },
        b: { output: { data: "other", meta: "also" }, totalTokens: 10, delay: 100 },
      },
    });

    const raceResult = await orchestrator.runRace(["a", "b"], "go", {
      extract: (result) => (result.output as { data: string }).data,
    });

    expect(raceResult.result).toBe("important");
    expect(raceResult.winnerId).toBe("a");
  });

  it("works with runPattern (declarative)", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        alpha: { agent: { name: "alpha" } },
        beta: { agent: { name: "beta" } },
      },
      mockResponses: {
        alpha: { output: "alpha-out", totalTokens: 10, delay: 10 },
        beta: { output: "beta-out", totalTokens: 10, delay: 100 },
      },
      patterns: {
        myRace: race(["alpha", "beta"]),
      },
    });

    const result = await orchestrator.runPattern<string>("myRace", "go");

    expect(result).toBe("alpha-out");
  });

  it("works with runRace (imperative)", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
      },
      mockResponses: {
        a: { output: "a-out", totalTokens: 10, delay: 10 },
        b: { output: "b-out", totalTokens: 20, delay: 100 },
      },
    });

    const result = await orchestrator.runRace(["a", "b"], "go");

    expect(result.winnerId).toBe("a");
    expect(result.result).toBe("a-out");
  });

  it("winner ID returned correctly", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        first: { agent: { name: "first" } },
        second: { agent: { name: "second" } },
      },
      mockResponses: {
        first: { output: "first-result", totalTokens: 5, delay: 10 },
        second: { output: "second-result", totalTokens: 5, delay: 200 },
      },
    });

    const result = await orchestrator.runRace(["first", "second"], "go");

    expect(result.winnerId).toBe("first");
    expect(result.result).toBe("first-result");
  });

  it("single agent race (degenerate case)", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        only: { agent: { name: "only" } },
      },
      mockResponses: {
        only: { output: "solo", totalTokens: 10 },
      },
    });

    const result = await orchestrator.runRace(["only"], "go");

    expect(result.winnerId).toBe("only");
    expect(result.result).toBe("solo");
  });

  it("timeline records race events", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
      },
      mockResponses: {
        a: { output: "a-out", totalTokens: 10, delay: 10 },
        b: { output: "b-out", totalTokens: 10, delay: 100 },
      },
      patterns: {
        myRace: race(["a", "b"]),
      },
      debug: true,
    });

    await orchestrator.runPattern("myRace", "go");

    const events = orchestrator.timeline!.getEvents();
    const raceStart = events.filter((e) => e.type === "race_start");
    const raceWinner = events.filter((e) => e.type === "race_winner");
    const raceCancelled = events.filter((e) => e.type === "race_cancelled");

    expect(raceStart).toHaveLength(1);
    expect(raceStart[0]).toMatchObject({
      type: "race_start",
      agents: ["a", "b"],
    });

    expect(raceWinner).toHaveLength(1);
    expect(raceWinner[0]).toMatchObject({
      type: "race_winner",
      winnerId: "a",
    });

    // Cancelled events for the loser(s)
    expect(raceCancelled.length).toBeGreaterThanOrEqual(1);
    expect(raceCancelled[0]).toMatchObject({
      type: "race_cancelled",
      reason: "winner_found",
    });
  });

  it("lifecycle hooks fire with patternType race", async () => {
    const hookEvents: Array<{ patternType: string }> = [];

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
      },
      mockResponses: {
        a: { output: "a-out", totalTokens: 10, delay: 10 },
        b: { output: "b-out", totalTokens: 10, delay: 100 },
      },
      patterns: {
        myRace: race(["a", "b"]),
      },
      hooks: {
        onPatternStart: (event) => hookEvents.push({ patternType: event.patternType }),
        onPatternComplete: (event) => hookEvents.push({ patternType: event.patternType }),
      },
    });

    await orchestrator.runPattern("myRace", "go");

    expect(hookEvents).toEqual([
      { patternType: "race" },
      { patternType: "race" },
    ]);
  });

  it("all agents fail error includes per-agent reasons", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        x: { agent: { name: "x" } },
        y: { agent: { name: "y" } },
      },
      mockResponses: {
        x: { output: "n/a", totalTokens: 0, error: new Error("X timeout") },
        y: { output: "n/a", totalTokens: 0, error: new Error("Y rate limited") },
      },
    });

    try {
      await orchestrator.runRace(["x", "y"], "go");
      expect.fail("Should have thrown");
    } catch (error) {
      const msg = (error as Error).message;
      expect(msg).toContain("x:");
      expect(msg).toContain("y:");
      expect(msg).toContain("X timeout");
      expect(msg).toContain("Y rate limited");
    }
  });

  it("timeout cancels all agents via abort (verifying pattern setup)", async () => {
    // Test that timeout option is properly set up in the pattern
    const pattern = race(["a", "b"], { timeout: 50 });

    expect(pattern.type).toBe("race");
    expect(pattern.handlers).toEqual(["a", "b"]);
    expect(pattern.timeout).toBe(50);
  });

  // ---- minSuccess tests ----

  it("minSuccess: 2 collects two results before resolving", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
        c: { agent: { name: "c" } },
      },
      mockResponses: {
        a: { output: "a-out", totalTokens: 10, delay: 10 },
        b: { output: "b-out", totalTokens: 10, delay: 30 },
        c: { output: "c-out", totalTokens: 10, delay: 100 },
      },
    });

    const result = await orchestrator.runRace(["a", "b", "c"], "go", { minSuccess: 2 });

    expect(result.winnerId).toBe("a");
    expect(result.result).toBe("a-out");
    expect(result.allResults).toBeDefined();
    expect(result.allResults).toHaveLength(2);
    expect(result.allResults![0]).toEqual({ agentId: "a", result: "a-out" });
    expect(result.allResults![1]).toEqual({ agentId: "b", result: "b-out" });
  });

  it("minSuccess: N where N = agents.length waits for all", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
      },
      mockResponses: {
        a: { output: "a-out", totalTokens: 10, delay: 10 },
        b: { output: "b-out", totalTokens: 10, delay: 30 },
      },
    });

    const result = await orchestrator.runRace(["a", "b"], "go", { minSuccess: 2 });

    expect(result.allResults).toHaveLength(2);
    // Both agents should be in allResults
    const agentIds = result.allResults!.map((r) => r.agentId).sort();
    expect(agentIds).toEqual(["a", "b"]);
  });

  it("minSuccess > agents.length throws validation error", () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
      },
      mockResponses: {
        a: { output: "a-out", totalTokens: 10 },
        b: { output: "b-out", totalTokens: 10 },
      },
    });

    expect(
      orchestrator.runRace(["a", "b"], "go", { minSuccess: 5 }),
    ).rejects.toThrow("minSuccess (5) exceeds agent count (2)");
  });

  it("minSuccess: 1 behaves identically to default (no allResults)", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
      },
      mockResponses: {
        a: { output: "a-out", totalTokens: 10, delay: 10 },
        b: { output: "b-out", totalTokens: 10, delay: 100 },
      },
    });

    const result = await orchestrator.runRace(["a", "b"], "go", { minSuccess: 1 });

    expect(result.winnerId).toBe("a");
    expect(result.result).toBe("a-out");
    expect(result.allResults).toBeUndefined();
  });
});
