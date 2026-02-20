import { describe, it, expect } from "vitest";
import {
  createTestMultiAgentOrchestrator,
} from "../testing.js";
import {
  reflect,
  debate,
  runDebate,
  composePatterns,
  spawnOnCondition,
  derivedConstraint,
  spawnPool,
} from "../multi-agent-orchestrator.js";
import type { CrossAgentSnapshot } from "../types.js";

// ============================================================================
// Item 7: Missing edge-case tests
// ============================================================================

describe("edge cases", () => {
  it("pre-aborted signal rejects reflect immediately", async () => {
    const controller = new AbortController();
    controller.abort();

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        producer: { agent: { name: "producer" } },
        evaluator: { agent: { name: "evaluator" } },
      },
      mockResponses: {
        producer: { output: "never", totalTokens: 10 },
        evaluator: {
          output: JSON.stringify({ passed: true }),
          totalTokens: 5,
        },
      },
      patterns: {
        review: reflect("producer", "evaluator", {
          maxIterations: 3,
          signal: controller.signal,
        }),
      },
    });

    // Pre-aborted signal should throw immediately since no producer output exists
    await expect(
      orchestrator.runPattern("review", "Go"),
    ).rejects.toThrow("aborted");
  });

  it("minSuccess with float throws validation error", async () => {
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

    await expect(
      orchestrator.runRace(["a", "b"], "go", { minSuccess: 1.5 }),
    ).rejects.toThrow("minSuccess");
  });

  it("minSuccess with NaN throws validation error", async () => {
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

    await expect(
      orchestrator.runRace(["a", "b"], "go", { minSuccess: NaN }),
    ).rejects.toThrow("minSuccess");
  });

  it("minSuccess with 0 throws validation error", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
      },
      mockResponses: {
        a: { output: "a-out", totalTokens: 10 },
      },
    });

    await expect(
      orchestrator.runRace(["a"], "go", { minSuccess: 0 }),
    ).rejects.toThrow("minSuccess");
  });
});

// ============================================================================
// Item 16: Structural equality for derivation change detection
// ============================================================================

describe("structural equality for derivations", () => {
  it("does not fire change callback when object is structurally equal", async () => {
    const changes: Array<{ id: string; value: unknown }> = [];

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
      },
      mockResponses: {
        a: { output: "out", totalTokens: 10 },
      },
      derive: {
        summary: (snap: CrossAgentSnapshot) => ({
          agentCount: Object.keys(snap.agents).length,
          status: "ok",
        }),
      },
    });

    orchestrator.onDerivedChange((id, value) => {
      changes.push({ id, value });
    });

    // Run twice — the derivation returns the same shape each time
    await orchestrator.runAgent("a", "input1");
    const changesAfterFirst = changes.length;

    await orchestrator.runAgent("a", "input2");
    // Second run should NOT fire change since the derivation output is structurally equal
    expect(changes.length).toBe(changesAfterFirst);
  });

  it("fires change callback when object values differ", async () => {
    let runCount = 0;
    const changes: Array<{ id: string; value: unknown }> = [];

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
      },
      mockResponses: {
        a: { output: "out", totalTokens: 10 },
      },
      derive: {
        counter: (_snap: CrossAgentSnapshot) => {
          runCount++;

          return { count: runCount };
        },
      },
    });

    orchestrator.onDerivedChange((id, value) => {
      changes.push({ id, value });
    });

    await orchestrator.runAgent("a", "input1");
    await orchestrator.runAgent("a", "input2");

    // Each run produces a different count, so both should fire
    expect(changes.length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================================
// Item 17: spawnOnCondition
// ============================================================================

describe("spawnOnCondition", () => {
  it("creates a valid constraint", () => {
    const constraint = spawnOnCondition({
      when: (facts) => (facts.confidence as number) < 0.5,
      agent: "reviewer",
      input: (facts) => `Review: ${facts.lastOutput}`,
    });

    expect(constraint.when).toBeTypeOf("function");
    expect(constraint.require).toBeTypeOf("function");
  });

  it("when() evaluates condition", () => {
    const constraint = spawnOnCondition({
      when: (facts) => (facts.score as number) > 100,
      agent: "alert",
      input: () => "High score alert",
    });

    expect(constraint.when({ score: 50 } as any)).toBe(false);
    expect(constraint.when({ score: 200 } as any)).toBe(true);
  });

  it("require() returns RUN_AGENT requirement", () => {
    const constraint = spawnOnCondition({
      when: () => true,
      agent: "worker",
      input: (facts) => `Process: ${facts.task}`,
      options: { priority: 10, context: { urgent: true } },
    });

    const requireFn = constraint.require as (facts: Record<string, unknown>) => unknown;
    const req = requireFn({ task: "do stuff" } as any);

    expect(req).toMatchObject({
      type: "RUN_AGENT",
      agent: "worker",
      input: "Process: do stuff",
      context: { urgent: true },
    });
    expect(constraint.priority).toBe(10);
  });
});

// ============================================================================
// Item 18: Debate pattern (runDebate)
// ============================================================================

describe("runDebate", () => {
  it("runs all agents and evaluator picks a winner", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        optimist: { agent: { name: "optimist" } },
        pessimist: { agent: { name: "pessimist" } },
        judge: { agent: { name: "judge" } },
      },
      mockResponses: {
        optimist: { output: "Things are great!", totalTokens: 10 },
        pessimist: { output: "Things are terrible!", totalTokens: 10 },
        judge: {
          output: JSON.stringify({ winnerId: "optimist", feedback: "More convincing", score: 0.8 }),
          totalTokens: 15,
        },
      },
    });

    const result = await runDebate(
      orchestrator,
      {
        agents: ["optimist", "pessimist"],
        evaluator: "judge",
        maxRounds: 1,
      },
      "Should we invest?",
    );

    expect(result.winnerId).toBe("optimist");
    expect(result.result).toBe("Things are great!");
    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0]!.proposals).toHaveLength(2);
    expect(result.rounds[0]!.judgement.winnerId).toBe("optimist");
    expect(result.rounds[0]!.judgement.score).toBe(0.8);
  });

  it("multi-round debate passes feedback", async () => {
    let judgeCallCount = 0;
    const judgeInputs: string[] = [];

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
        judge: { agent: { name: "judge" } },
      },
      mockResponses: {
        a: { output: "proposal-a", totalTokens: 10 },
        b: { output: "proposal-b", totalTokens: 10 },
        judge: {
          output: "dynamic",
          totalTokens: 10,
          generate: (input) => {
            judgeCallCount++;
            judgeInputs.push(input);

            return {
              output: JSON.stringify({
                winnerId: "a",
                feedback: judgeCallCount < 2 ? "Needs improvement" : undefined,
                score: judgeCallCount < 2 ? 0.5 : 0.9,
              }),
              totalTokens: 10,
            };
          },
        },
      },
    });

    const result = await runDebate(
      orchestrator,
      {
        agents: ["a", "b"],
        evaluator: "judge",
        maxRounds: 2,
      },
      "Compete",
    );

    expect(result.rounds).toHaveLength(2);
    expect(judgeCallCount).toBe(2);
  });

  it("throws with fewer than 2 agents", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        judge: { agent: { name: "judge" } },
      },
      mockResponses: {
        a: { output: "out", totalTokens: 10 },
        judge: { output: JSON.stringify({ winnerId: "a" }), totalTokens: 5 },
      },
    });

    await expect(
      runDebate(orchestrator, { agents: ["a"], evaluator: "judge" }, "go"),
    ).rejects.toThrow("at least 2 agents");
  });

  it("custom parseJudgement", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
        judge: { agent: { name: "judge" } },
      },
      mockResponses: {
        a: { output: "a-result", totalTokens: 10 },
        b: { output: "b-result", totalTokens: 10 },
        judge: { output: "WINNER:b", totalTokens: 5 },
      },
    });

    const result = await runDebate(
      orchestrator,
      {
        agents: ["a", "b"],
        evaluator: "judge",
        maxRounds: 1,
        parseJudgement: (output) => {
          const str = String(output);
          const winnerId = str.split(":")[1]!;

          return { winnerId };
        },
      },
      "go",
    );

    expect(result.winnerId).toBe("b");
    expect(result.result).toBe("b-result");
  });
});

// ============================================================================
// Item 19: derivedConstraint
// ============================================================================

describe("derivedConstraint", () => {
  it("when() reads derivation value from __derived", () => {
    const constraint = derivedConstraint(
      "totalCost",
      (value) => (value as number) > 5.0,
      {
        agent: "budget-manager",
        input: (value) => `Budget exceeded: $${value}`,
      },
    );

    // Simulates the orchestrator passing __derived in facts
    expect(constraint.when({ __derived: { totalCost: 3.0 } } as any)).toBe(false);
    expect(constraint.when({ __derived: { totalCost: 10.0 } } as any)).toBe(true);
  });

  it("require() returns RUN_AGENT with derived value", () => {
    const constraint = derivedConstraint(
      "risk",
      (value) => (value as number) > 0.8,
      {
        agent: "risk-handler",
        input: (value) => `Risk level: ${value}`,
        priority: 100,
        context: { source: "derivation" },
      },
    );

    // Trigger when() to capture value
    constraint.when({ __derived: { risk: 0.95 } } as any);

    const requireFn = constraint.require as (facts: Record<string, unknown>) => unknown;
    const req = requireFn({} as any);
    expect(req).toMatchObject({
      type: "RUN_AGENT",
      agent: "risk-handler",
      input: "Risk level: 0.95",
      context: { source: "derivation" },
    });
    expect(constraint.priority).toBe(100);
  });
});

// ============================================================================
// Reflect: runReflect imperative API
// ============================================================================

describe("runReflect (imperative)", () => {
  it("returns result, iterations, and history", async () => {
    let evalCount = 0;

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        producer: { agent: { name: "producer" } },
        evaluator: { agent: { name: "evaluator" } },
      },
      mockResponses: {
        producer: { output: "essay", totalTokens: 20 },
        evaluator: {
          output: "dynamic",
          totalTokens: 8,
          generate: () => {
            evalCount++;

            return {
              output: evalCount >= 2
                ? JSON.stringify({ passed: true, score: 0.9 })
                : JSON.stringify({ passed: false, feedback: "Improve", score: 0.4 }),
              totalTokens: 8,
            };
          },
        },
      },
    });

    const result = await orchestrator.runReflect<string>("producer", "evaluator", "Write essay", {
      maxIterations: 3,
    });

    expect(result.result).toBe("essay");
    expect(result.iterations).toBe(2);
    expect(result.history).toHaveLength(2);
    expect(result.history[0]!.passed).toBe(false);
    expect(result.history[1]!.passed).toBe(true);
    expect(result.exhausted).toBe(false);
  });

  it("returns exhausted: true when maxIterations reached", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        producer: { agent: { name: "producer" } },
        evaluator: { agent: { name: "evaluator" } },
      },
      mockResponses: {
        producer: { output: "draft", totalTokens: 10 },
        evaluator: {
          output: JSON.stringify({ passed: false, feedback: "Not good enough", score: 0.3 }),
          totalTokens: 5,
        },
      },
    });

    const result = await orchestrator.runReflect<string>("producer", "evaluator", "Write essay", {
      maxIterations: 2,
    });

    expect(result.exhausted).toBe(true);
    expect(result.iterations).toBe(2);
    expect(result.result).toBe("draft"); // accept-last by default
  });

  it("accept-best picks highest-scored iteration", async () => {
    let evalCount = 0;

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        producer: { agent: { name: "producer" } },
        evaluator: { agent: { name: "evaluator" } },
      },
      mockResponses: {
        producer: {
          output: "dynamic",
          totalTokens: 10,
          generate: () => {
            evalCount++;

            return {
              output: `draft-v${evalCount}`,
              totalTokens: 10,
            };
          },
        },
        evaluator: {
          output: "dynamic",
          totalTokens: 5,
          generate: () => {
            // Scores: 0.7, 0.9, 0.6 — best is iteration 2 (0.9)
            const scores = [0.7, 0.9, 0.6];
            const score = scores[(evalCount - 1) % scores.length]!;

            return {
              output: JSON.stringify({ passed: false, feedback: "Try harder", score }),
              totalTokens: 5,
            };
          },
        },
      },
    });

    const result = await orchestrator.runReflect<string>("producer", "evaluator", "Write essay", {
      maxIterations: 3,
      onExhausted: "accept-best",
    });

    expect(result.exhausted).toBe(true);
    expect(result.result).toBe("draft-v2"); // Highest score was 0.9 at iteration 2
  });

  it("threshold overrides pass when score meets threshold", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        producer: { agent: { name: "producer" } },
        evaluator: { agent: { name: "evaluator" } },
      },
      mockResponses: {
        producer: { output: "good-enough", totalTokens: 10 },
        evaluator: {
          output: JSON.stringify({ passed: false, score: 0.75 }),
          totalTokens: 5,
        },
      },
    });

    const result = await orchestrator.runReflect<string>("producer", "evaluator", "Write essay", {
      maxIterations: 3,
      threshold: 0.7,
    });

    // Score 0.75 >= threshold 0.7, so it should pass on first iteration
    expect(result.iterations).toBe(1);
    expect(result.exhausted).toBe(false);
    expect(result.result).toBe("good-enough");
  });
});

// ============================================================================
// spawnPool
// ============================================================================

describe("spawnPool", () => {
  it("creates a valid constraint with static count", () => {
    const constraint = spawnPool(
      (facts) => (facts.pending as number) > 0,
      {
        agent: "worker",
        count: 3,
        input: (_facts, i) => `Task ${i}`,
      },
    );

    expect(constraint.when).toBeTypeOf("function");
    expect(constraint.require).toBeTypeOf("function");
  });

  it("when() evaluates condition", () => {
    const constraint = spawnPool(
      (facts) => (facts.load as number) > 10,
      {
        agent: "worker",
        count: 2,
        input: () => "do work",
      },
    );

    expect(constraint.when({ load: 5 } as any)).toBe(false);
    expect(constraint.when({ load: 15 } as any)).toBe(true);
  });

  it("require() returns RUN_AGENT requirement", () => {
    const constraint = spawnPool(
      () => true,
      {
        agent: "worker",
        count: 3,
        input: (_facts, i) => `Task ${i}`,
        priority: 50,
        context: { pool: true },
      },
    );

    const requireFn = constraint.require as (facts: Record<string, unknown>) => unknown;
    const req = requireFn({} as any);

    expect(req).toMatchObject({
      type: "RUN_AGENT",
      agent: "worker",
      input: "Task 0",
      context: { pool: true },
    });
    expect(constraint.priority).toBe(50);
  });

  it("dynamic count uses function", () => {
    const constraint = spawnPool(
      () => true,
      {
        agent: "worker",
        count: (facts) => (facts.pending as number),
        input: (_facts, i) => `Job ${i}`,
      },
    );

    // The constraint returns a single RUN_AGENT requirement per evaluation cycle
    const requireFn = constraint.require as (facts: Record<string, unknown>) => unknown;
    const req = requireFn({ pending: 5 } as any);

    expect(req).toMatchObject({
      type: "RUN_AGENT",
      agent: "worker",
      input: "Job 0",
    });
  });
});

// ============================================================================
// spawnOnCondition flattened options
// ============================================================================

describe("spawnOnCondition flattened options", () => {
  it("accepts top-level priority and context", () => {
    const constraint = spawnOnCondition({
      when: () => true,
      agent: "reviewer",
      input: () => "review this",
      priority: 42,
      context: { urgent: true },
    });

    expect(constraint.priority).toBe(42);
    const requireFn = constraint.require as (facts: Record<string, unknown>) => unknown;
    const req = requireFn({} as any);
    expect(req).toMatchObject({
      context: { urgent: true },
    });
  });

  it("deprecated options still work", () => {
    const constraint = spawnOnCondition({
      when: () => true,
      agent: "reviewer",
      input: () => "review this",
      options: { priority: 10, context: { legacy: true } },
    });

    expect(constraint.priority).toBe(10);
    const requireFn = constraint.require as (facts: Record<string, unknown>) => unknown;
    const req = requireFn({} as Record<string, unknown>);
    expect(req).toMatchObject({
      context: { legacy: true },
    });
  });

  it("top-level overrides deprecated options", () => {
    const constraint = spawnOnCondition({
      when: () => true,
      agent: "reviewer",
      input: () => "review this",
      priority: 99,
      context: { modern: true },
      options: { priority: 10, context: { legacy: true } },
    });

    expect(constraint.priority).toBe(99);
    const requireFn = constraint.require as (facts: Record<string, unknown>) => unknown;
    const req = requireFn({} as Record<string, unknown>);
    expect(req).toMatchObject({
      context: { modern: true },
    });
  });
});

// ============================================================================
// AE Round 4: runDebate with signal
// ============================================================================

describe("runDebate with AbortSignal", () => {
  it("pre-aborted signal stops debate immediately", async () => {
    const controller = new AbortController();
    controller.abort();

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
        judge: { agent: { name: "judge" } },
      },
      mockResponses: {
        a: { output: "A proposal", totalTokens: 5 },
        b: { output: "B proposal", totalTokens: 5 },
        judge: { output: JSON.stringify({ winnerId: "a" }), totalTokens: 5 },
      },
    });

    await expect(runDebate(orchestrator, {
      agents: ["a", "b"],
      evaluator: "judge",
      maxRounds: 3,
      signal: controller.signal,
    }, "test")).rejects.toThrow("Debate aborted before any round completed");
  });
});

// ============================================================================
// AE Round 4: composePatterns with debate
// ============================================================================

describe("composePatterns with debate", () => {
  it("composes a debate pattern in a sequence", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
        judge: { agent: { name: "judge" } },
      },
      mockResponses: {
        a: { output: "Proposal A", totalTokens: 10 },
        b: { output: "Proposal B", totalTokens: 10 },
        judge: { output: JSON.stringify({ winnerId: "a" }), totalTokens: 5 },
      },
    });

    const composed = composePatterns(
      debate({ agents: ["a", "b"], evaluator: "judge", maxRounds: 1 }),
    );

    const result = await composed(orchestrator, "test input");
    expect(result).toBe("Proposal A");
  });

  it("composePatterns throws on unknown pattern type", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: { a: { agent: { name: "a" } } },
    });

    const composed = composePatterns(
      { type: "nonexistent" as any, agents: ["a"] },
    );

    await expect(composed(orchestrator, "test")).rejects.toThrow("unknown pattern type");
  });
});

// ============================================================================
// AE Round 4: scratchpad prototype pollution guard
// ============================================================================

describe("scratchpad prototype pollution guard", () => {
  it("has() returns false for __proto__", () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: { a: { agent: { name: "a" } } },
      scratchpad: { init: { safe: "value" } },
    });

    const sp = orchestrator.scratchpad!;
    expect(sp.has("safe")).toBe(true);
    expect(sp.has("__proto__")).toBe(false);
    expect(sp.has("constructor")).toBe(false);
    expect(sp.has("prototype")).toBe(false);
  });
});

// ============================================================================
// AE Round 4: runDebate method on orchestrator instance
// ============================================================================

describe("orchestrator.runDebate", () => {
  it("runs debate via orchestrator method", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
        judge: { agent: { name: "judge" } },
      },
      mockResponses: {
        a: { output: "A says yes", totalTokens: 5 },
        b: { output: "B says no", totalTokens: 5 },
        judge: { output: JSON.stringify({ winnerId: "b" }), totalTokens: 5 },
      },
    });

    const result = await orchestrator.runDebate(
      ["a", "b"],
      "judge",
      "question",
      { maxRounds: 1 },
    );

    expect(result.winnerId).toBe("b");
    expect(result.rounds).toHaveLength(1);
  });
});

// ============================================================================
// AE Round 5 E5: Additional debate tests
// ============================================================================

describe("debate factory validation", () => {
  it("debate() with fewer than 2 agents throws", () => {
    expect(() => debate({ agents: ["a"], evaluator: "judge" })).toThrow("at least 2");
  });

  it("debate() with maxRounds 0 throws", () => {
    expect(() => debate({ agents: ["a", "b"], evaluator: "judge", maxRounds: 0 })).toThrow("maxRounds");
  });

  it("debate() with maxRounds -1 throws", () => {
    expect(() => debate({ agents: ["a", "b"], evaluator: "judge", maxRounds: -1 })).toThrow("maxRounds");
  });
});

describe("debate with extract", () => {
  it("applies extract function to winner output", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
        judge: { agent: { name: "judge" } },
      },
      mockResponses: {
        a: { output: JSON.stringify({ value: 42 }), totalTokens: 10 },
        b: { output: JSON.stringify({ value: 99 }), totalTokens: 10 },
        judge: { output: JSON.stringify({ winnerId: "b" }), totalTokens: 5 },
      },
    });

    const result = await runDebate(
      orchestrator,
      {
        agents: ["a", "b"],
        evaluator: "judge",
        maxRounds: 1,
        extract: (output) => {
          const parsed = JSON.parse(String(output));

          return parsed.value as number;
        },
      },
      "go",
    );

    expect(result.result).toBe(99);
  });
});

describe("debate maxRounds validation (imperative)", () => {
  it("runDebate with maxRounds 0 throws", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
        judge: { agent: { name: "judge" } },
      },
      mockResponses: {
        a: { output: "out", totalTokens: 5 },
        b: { output: "out", totalTokens: 5 },
        judge: { output: JSON.stringify({ winnerId: "a" }), totalTokens: 5 },
      },
    });

    await expect(
      runDebate(orchestrator, { agents: ["a", "b"], evaluator: "judge", maxRounds: 0 }, "go"),
    ).rejects.toThrow("maxRounds");
  });

  it("orchestrator.runDebate with maxRounds -1 throws", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
        judge: { agent: { name: "judge" } },
      },
      mockResponses: {
        a: { output: "out", totalTokens: 5 },
        b: { output: "out", totalTokens: 5 },
        judge: { output: JSON.stringify({ winnerId: "a" }), totalTokens: 5 },
      },
    });

    await expect(
      orchestrator.runDebate(["a", "b"], "judge", "go", { maxRounds: -1 }),
    ).rejects.toThrow("maxRounds");
  });
});
