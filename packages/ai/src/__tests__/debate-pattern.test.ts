import { describe, it, expect } from "vitest";
import {
  createTestMultiAgentOrchestrator,
} from "../testing.js";
import { debate, runDebate } from "../multi-agent-orchestrator.js";
import type { DebateResult } from "../multi-agent-orchestrator.js";

// ============================================================================
// Tests
// ============================================================================

describe("debate pattern", () => {
  it("single-round debate — two agents propose, evaluator picks winner", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        optimist: { agent: { name: "optimist" } },
        pessimist: { agent: { name: "pessimist" } },
        judge: { agent: { name: "judge" } },
      },
      mockResponses: {
        optimist: { output: "it will work great", totalTokens: 20 },
        pessimist: { output: "it will fail", totalTokens: 20 },
        judge: {
          output: JSON.stringify({ winnerId: "optimist", feedback: "More positive outlook" }),
          totalTokens: 10,
        },
      },
      patterns: {
        myDebate: debate({
          handlers: ["optimist", "pessimist"],
          evaluator: "judge",
          maxRounds: 1,
        }),
      },
    });

    const result = await orchestrator.runPattern<DebateResult<unknown>>("myDebate", "Should we proceed?");

    // runPattern for debate extracts result so returns the winning output
    expect(result).toBe("it will work great");
  });

  it("single-round debate — DebateResult shape via runDebate", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
        judge: { agent: { name: "judge" } },
      },
      mockResponses: {
        a: { output: "proposal A", totalTokens: 15 },
        b: { output: "proposal B", totalTokens: 15 },
        judge: {
          output: JSON.stringify({ winnerId: "a", score: 0.8 }),
          totalTokens: 10,
        },
      },
    });

    const result = await orchestrator.runDebate(
      ["a", "b"],
      "judge",
      "debate topic",
      { maxRounds: 1 },
    );

    expect(result.winnerId).toBe("a");
    expect(result.result).toBe("proposal A");
    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0]!.proposals).toHaveLength(2);
    expect(result.rounds[0]!.proposals.find((p) => p.agentId === "a")?.output).toBe("proposal A");
    expect(result.rounds[0]!.proposals.find((p) => p.agentId === "b")?.output).toBe("proposal B");
    expect(result.rounds[0]!.judgement.winnerId).toBe("a");
    expect(result.rounds[0]!.judgement.score).toBe(0.8);
  });

  it("multi-round debate — proposals from each round in rounds[], feedback propagated", async () => {
    let evaluatorCallCount = 0;
    const producerInputs: string[] = [];

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        alpha: { agent: { name: "alpha" } },
        beta: { agent: { name: "beta" } },
        judge: { agent: { name: "judge" } },
      },
      mockResponses: {
        alpha: {
          output: "dynamic",
          totalTokens: 20,
          generate: (input) => {
            producerInputs.push(input);

            return { output: `alpha-proposal`, totalTokens: 20 };
          },
        },
        beta: { output: "beta-proposal", totalTokens: 20 },
        judge: {
          output: "dynamic",
          totalTokens: 10,
          generate: () => {
            evaluatorCallCount++;
            const isLastRound = evaluatorCallCount >= 3;

            return {
              output: JSON.stringify({
                winnerId: "alpha",
                feedback: isLastRound ? undefined : "Be more specific",
                score: isLastRound ? 0.9 : 0.5,
              }),
              totalTokens: 10,
            };
          },
        },
      },
    });

    const result = await orchestrator.runDebate(
      ["alpha", "beta"],
      "judge",
      "Make an argument",
      { maxRounds: 3 },
    );

    expect(result.rounds).toHaveLength(3);
    expect(result.winnerId).toBe("alpha");

    // Each round has proposals from both agents
    for (const round of result.rounds) {
      expect(round.proposals).toHaveLength(2);
      expect(round.proposals.some((p) => p.agentId === "alpha")).toBe(true);
      expect(round.proposals.some((p) => p.agentId === "beta")).toBe(true);
    }

    // Feedback from round 1 should propagate into round 2's input
    expect(producerInputs[1]).toContain("Be more specific");
  });

  it("custom parseJudgement — evaluator returns custom format, transformed correctly", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        left: { agent: { name: "left" } },
        right: { agent: { name: "right" } },
        judge: { agent: { name: "judge" } },
      },
      mockResponses: {
        left: { output: "left argument", totalTokens: 10 },
        right: { output: "right argument", totalTokens: 10 },
        judge: { output: "WINNER:right", totalTokens: 5 },
      },
    });

    const result = await orchestrator.runDebate(
      ["left", "right"],
      "judge",
      "Pick a side",
      {
        maxRounds: 1,
        parseJudgement: (output) => {
          const str = String(output);
          const id = str.replace("WINNER:", "").trim();

          return { winnerId: id, score: 1.0 };
        },
      },
    );

    expect(result.winnerId).toBe("right");
    expect(result.result).toBe("right argument");
    expect(result.rounds[0]!.judgement.score).toBe(1.0);
  });

  it("invalid winnerId fallback — evaluator returns unknown agent, falls back to first agent", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
        judge: { agent: { name: "judge" } },
      },
      mockResponses: {
        a: { output: "a-proposal", totalTokens: 10 },
        b: { output: "b-proposal", totalTokens: 10 },
        judge: {
          output: JSON.stringify({ winnerId: "nonexistent-agent" }),
          totalTokens: 5,
        },
      },
    });

    const result = await orchestrator.runDebate(
      ["a", "b"],
      "judge",
      "topic",
      { maxRounds: 1 },
    );

    // Falls back to first agent in the list
    expect(result.winnerId).toBe("a");
    expect(result.result).toBe("a-proposal");
  });

  it("debate via runPattern (declarative) — register pattern, run by id", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        pro: { agent: { name: "pro" } },
        con: { agent: { name: "con" } },
        arbiter: { agent: { name: "arbiter" } },
      },
      mockResponses: {
        pro: { output: "pro argument", totalTokens: 15 },
        con: { output: "con argument", totalTokens: 15 },
        arbiter: {
          output: JSON.stringify({ winnerId: "pro" }),
          totalTokens: 8,
        },
      },
      patterns: {
        theDebate: debate({
          handlers: ["pro", "con"],
          evaluator: "arbiter",
          maxRounds: 1,
        }),
      },
    });

    const result = await orchestrator.runPattern<string>("theDebate", "Should we do this?");

    expect(result).toBe("pro argument");
  });

  it("runDebate imperative — call runDebate() directly from module", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        x: { agent: { name: "x" } },
        y: { agent: { name: "y" } },
        evaluator: { agent: { name: "evaluator" } },
      },
      mockResponses: {
        x: { output: "x output", totalTokens: 10 },
        y: { output: "y output", totalTokens: 10 },
        evaluator: {
          output: JSON.stringify({ winnerId: "y" }),
          totalTokens: 5,
        },
      },
    });

    const result = await runDebate(
      orchestrator,
      {
        handlers: ["x", "y"],
        evaluator: "evaluator",
        maxRounds: 1,
      },
      "input prompt",
    );

    expect(result.winnerId).toBe("y");
    expect(result.result).toBe("y output");
    expect(result.rounds).toHaveLength(1);
  });

  it("AbortSignal cancels mid-debate — aborted before any round completes, throws", async () => {
    const controller = new AbortController();

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        slow1: { agent: { name: "slow1" } },
        slow2: { agent: { name: "slow2" } },
        judge: { agent: { name: "judge" } },
      },
      mockResponses: {
        slow1: { output: "slow1-result", totalTokens: 10, delay: 200 },
        slow2: { output: "slow2-result", totalTokens: 10, delay: 200 },
        judge: {
          output: JSON.stringify({ winnerId: "slow1" }),
          totalTokens: 5,
        },
      },
    });

    // Abort immediately — signal is already aborted before any round runs
    controller.abort();

    await expect(
      orchestrator.runDebate(
        ["slow1", "slow2"],
        "judge",
        "debate topic",
        { maxRounds: 3, signal: controller.signal },
      ),
    ).rejects.toThrow("Debate aborted before any round completed");
  });

  it("timeout — short timeout aborts debate, returns partial result", async () => {
    createTestMultiAgentOrchestrator({
      agents: {
        slow1: { agent: { name: "slow1" } },
        slow2: { agent: { name: "slow2" } },
        judge: { agent: { name: "judge" } },
      },
      mockResponses: {
        slow1: { output: "slow1-result", totalTokens: 10, delay: 300 },
        slow2: { output: "slow2-result", totalTokens: 10, delay: 300 },
        judge: {
          output: JSON.stringify({ winnerId: "slow1" }),
          totalTokens: 5,
        },
      },
    });

    // 5ms timeout — agents take 300ms, should abort before first round finishes
    const pattern = debate({
      handlers: ["slow1", "slow2"],
      evaluator: "judge",
      maxRounds: 2,
      timeout: 5,
    });

    expect(pattern.timeout).toBe(5);
    expect(pattern.type).toBe("debate");
    expect(pattern.handlers).toEqual(["slow1", "slow2"]);
  });

  it("lifecycle hooks fire with patternType debate", async () => {
    const hookEvents: Array<{ patternType: string; phase: "start" | "complete" }> = [];

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
        judge: { agent: { name: "judge" } },
      },
      mockResponses: {
        a: { output: "a-out", totalTokens: 10 },
        b: { output: "b-out", totalTokens: 10 },
        judge: {
          output: JSON.stringify({ winnerId: "a" }),
          totalTokens: 5,
        },
      },
      patterns: {
        d: debate({ handlers: ["a", "b"], evaluator: "judge", maxRounds: 1 }),
      },
      hooks: {
        onPatternStart: (event) => hookEvents.push({ patternType: event.patternType, phase: "start" }),
        onPatternComplete: (event) => hookEvents.push({ patternType: event.patternType, phase: "complete" }),
      },
    });

    await orchestrator.runPattern("d", "go");

    expect(hookEvents).toEqual([
      { patternType: "debate", phase: "start" },
      { patternType: "debate", phase: "complete" },
    ]);
  });

  it("timeline records debate_round events", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
        judge: { agent: { name: "judge" } },
      },
      mockResponses: {
        a: { output: "a-out", totalTokens: 10 },
        b: { output: "b-out", totalTokens: 10 },
        judge: {
          output: JSON.stringify({ winnerId: "b", score: 0.7 }),
          totalTokens: 5,
        },
      },
      patterns: {
        d: debate({ handlers: ["a", "b"], evaluator: "judge", maxRounds: 2 }),
      },
      debug: true,
    });

    await orchestrator.runPattern("d", "go");

    const events = orchestrator.timeline!.getEvents();
    const debateRounds = events.filter((e) => e.type === "debate_round");

    expect(debateRounds).toHaveLength(2);
    expect(debateRounds[0]).toMatchObject({
      type: "debate_round",
      round: 1,
      totalRounds: 2,
      winnerId: "b",
      score: 0.7,
      agentCount: 2,
    });
    expect(debateRounds[1]).toMatchObject({
      type: "debate_round",
      round: 2,
      totalRounds: 2,
    });
  });

  it("extract function transforms winning output", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
        judge: { agent: { name: "judge" } },
      },
      mockResponses: {
        a: { output: { value: 42, label: "answer" }, totalTokens: 10 },
        b: { output: { value: 7, label: "other" }, totalTokens: 10 },
        judge: {
          output: JSON.stringify({ winnerId: "a" }),
          totalTokens: 5,
        },
      },
    });

    const result = await orchestrator.runDebate<number>(
      ["a", "b"],
      "judge",
      "pick one",
      {
        maxRounds: 1,
        extract: (output) => (output as { value: number }).value,
      },
    );

    expect(result.result).toBe(42);
    expect(result.winnerId).toBe("a");
  });

  it("requires at least 2 handlers — throws on single handler", () => {
    expect(() => {
      debate({ handlers: ["only"], evaluator: "judge" });
    }).toThrow("debate requires at least 2 handlers");
  });

  it("requires maxRounds >= 1 — throws on zero", () => {
    expect(() => {
      debate({ handlers: ["a", "b"], evaluator: "judge", maxRounds: 0 });
    }).toThrow("maxRounds must be >= 1");
  });
});
