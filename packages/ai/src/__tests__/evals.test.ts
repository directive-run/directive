import { describe, it, expect, vi } from "vitest";
import {
  createEvalSuite,
  evalCost,
  evalLatency,
  evalOutputLength,
  evalSafety,
  evalStructure,
  evalMatch,
  evalJudge,
  evalAssert,
  type EvalCase,
} from "../evals.js";
import type { AgentLike, AgentRunner, RunResult } from "../types.js";

// ============================================================================
// Test helpers
// ============================================================================

function mockAgent(name: string): AgentLike {
  return { name };
}

function mockRunner(outputs: Record<string, string | Record<string, unknown>>): AgentRunner {
  return (async (agent) => {
    const output = outputs[agent.name] ?? "";

    return {
      output: typeof output === "string" ? output : JSON.stringify(output),
      messages: [],
      toolCalls: [],
      totalTokens: 100,
    } as RunResult<unknown>;
  }) as AgentRunner;
}

function slowRunner(delayMs: number): AgentRunner {
  return (async () => {
    await new Promise((r) => setTimeout(r, delayMs));

    return {
      output: "done",
      messages: [],
      toolCalls: [],
      totalTokens: 50,
    };
  }) as AgentRunner;
}

const dataset: EvalCase[] = [
  { input: "What is AI?", expected: "artificial intelligence" },
  { input: "What is ML?", expected: "machine learning" },
];

// ============================================================================
// evalCost
// ============================================================================

describe("evalCost", () => {
  it("passes when tokens under budget", () => {
    const criterion = evalCost({ maxTokensPerRun: 500 });
    const result = criterion.fn({
      agent: mockAgent("a"),
      testCase: dataset[0]!,
      result: { output: "ok", messages: [], toolCalls: [], totalTokens: 100 },
      runDurationMs: 100,
    });

    expect(result).toMatchObject({ passed: true });
    expect((result as any).score).toBeGreaterThan(0.5);
  });

  it("fails when tokens over budget", () => {
    const criterion = evalCost({ maxTokensPerRun: 50 });
    const result = criterion.fn({
      agent: mockAgent("a"),
      testCase: dataset[0]!,
      result: { output: "ok", messages: [], toolCalls: [], totalTokens: 100 },
      runDurationMs: 100,
    });

    expect(result).toMatchObject({ passed: false });
  });

  it("returns 1.0 when tokens <= half budget", () => {
    const criterion = evalCost({ maxTokensPerRun: 400 });
    const result = criterion.fn({
      agent: mockAgent("a"),
      testCase: dataset[0]!,
      result: { output: "ok", messages: [], toolCalls: [], totalTokens: 100 },
      runDurationMs: 100,
    });

    expect((result as any).score).toBe(1.0);
  });

  it("returns 0.0 when tokens >= 2x budget", () => {
    const criterion = evalCost({ maxTokensPerRun: 50 });
    const result = criterion.fn({
      agent: mockAgent("a"),
      testCase: dataset[0]!,
      result: { output: "ok", messages: [], toolCalls: [], totalTokens: 200 },
      runDurationMs: 100,
    });

    expect((result as any).score).toBe(0.0);
  });
});

// ============================================================================
// evalLatency
// ============================================================================

describe("evalLatency", () => {
  it("passes when duration under max", () => {
    const criterion = evalLatency({ maxMs: 5000 });
    const result = criterion.fn({
      agent: mockAgent("a"),
      testCase: dataset[0]!,
      result: { output: "ok", messages: [], toolCalls: [], totalTokens: 100 },
      runDurationMs: 1000,
    });

    expect(result).toMatchObject({ passed: true });
  });

  it("fails when duration over max", () => {
    const criterion = evalLatency({ maxMs: 100 });
    const result = criterion.fn({
      agent: mockAgent("a"),
      testCase: dataset[0]!,
      result: { output: "ok", messages: [], toolCalls: [], totalTokens: 100 },
      runDurationMs: 500,
    });

    expect(result).toMatchObject({ passed: false });
  });
});

// ============================================================================
// evalOutputLength
// ============================================================================

describe("evalOutputLength", () => {
  it("passes when within range", () => {
    const criterion = evalOutputLength({ minLength: 5, maxLength: 100 });
    const result = criterion.fn({
      agent: mockAgent("a"),
      testCase: dataset[0]!,
      result: { output: "hello world", messages: [], toolCalls: [], totalTokens: 10 },
      runDurationMs: 100,
    });

    expect(result).toMatchObject({ passed: true, score: 1.0 });
  });

  it("fails when too short", () => {
    const criterion = evalOutputLength({ minLength: 50 });
    const result = criterion.fn({
      agent: mockAgent("a"),
      testCase: dataset[0]!,
      result: { output: "hi", messages: [], toolCalls: [], totalTokens: 10 },
      runDurationMs: 100,
    });

    expect(result).toMatchObject({ passed: false });
    expect((result as any).score).toBeLessThan(1.0);
  });

  it("fails when too long", () => {
    const criterion = evalOutputLength({ maxLength: 5 });
    const result = criterion.fn({
      agent: mockAgent("a"),
      testCase: dataset[0]!,
      result: { output: "this is way too long", messages: [], toolCalls: [], totalTokens: 10 },
      runDurationMs: 100,
    });

    expect(result).toMatchObject({ passed: false });
  });
});

// ============================================================================
// evalSafety
// ============================================================================

describe("evalSafety", () => {
  it("passes when no unsafe patterns found", () => {
    const criterion = evalSafety();
    const result = criterion.fn({
      agent: mockAgent("a"),
      testCase: dataset[0]!,
      result: { output: "AI is fascinating", messages: [], toolCalls: [], totalTokens: 10 },
      runDurationMs: 100,
    });

    expect(result).toMatchObject({ passed: true, score: 1.0 });
  });

  it("fails when SSN-like pattern found", () => {
    const criterion = evalSafety();
    const result = criterion.fn({
      agent: mockAgent("a"),
      testCase: dataset[0]!,
      result: { output: "My SSN is 123-45-6789", messages: [], toolCalls: [], totalTokens: 10 },
      runDurationMs: 100,
    });

    expect(result).toMatchObject({ passed: false, score: 0.0 });
  });

  it("supports custom blocked patterns", () => {
    const criterion = evalSafety({ blockedPatterns: [/secret/i] });
    const result = criterion.fn({
      agent: mockAgent("a"),
      testCase: dataset[0]!,
      result: { output: "The SECRET code is 42", messages: [], toolCalls: [], totalTokens: 10 },
      runDurationMs: 100,
    });

    expect(result).toMatchObject({ passed: false, score: 0.0 });
  });
});

// ============================================================================
// evalStructure
// ============================================================================

describe("evalStructure", () => {
  it("passes valid JSON with required keys", () => {
    const criterion = evalStructure({ type: "json", requiredKeys: ["name", "age"] });
    const result = criterion.fn({
      agent: mockAgent("a"),
      testCase: dataset[0]!,
      result: { output: '{"name":"Alice","age":30}', messages: [], toolCalls: [], totalTokens: 10 },
      runDurationMs: 100,
    });

    expect(result).toMatchObject({ passed: true, score: 1.0 });
  });

  it("fails on missing keys", () => {
    const criterion = evalStructure({ type: "json", requiredKeys: ["name", "age", "email"] });
    const result = criterion.fn({
      agent: mockAgent("a"),
      testCase: dataset[0]!,
      result: { output: '{"name":"Alice"}', messages: [], toolCalls: [], totalTokens: 10 },
      runDurationMs: 100,
    });

    expect(result).toMatchObject({ passed: false });
    expect((result as any).reason).toContain("age");
    expect((result as any).reason).toContain("email");
  });

  it("fails on invalid JSON", () => {
    const criterion = evalStructure({ type: "json" });
    const result = criterion.fn({
      agent: mockAgent("a"),
      testCase: dataset[0]!,
      result: { output: "not json", messages: [], toolCalls: [], totalTokens: 10 },
      runDurationMs: 100,
    });

    expect(result).toMatchObject({ passed: false, score: 0.0 });
  });

  it("passes non-empty string when type not specified", () => {
    const criterion = evalStructure({});
    const result = criterion.fn({
      agent: mockAgent("a"),
      testCase: dataset[0]!,
      result: { output: "some output", messages: [], toolCalls: [], totalTokens: 10 },
      runDurationMs: 100,
    });

    expect(result).toMatchObject({ passed: true, score: 1.0 });
  });
});

// ============================================================================
// evalMatch
// ============================================================================

describe("evalMatch", () => {
  it("matches substring (default)", () => {
    const criterion = evalMatch();
    const result = criterion.fn({
      agent: mockAgent("a"),
      testCase: { input: "test", expected: "hello" },
      result: { output: "say hello world", messages: [], toolCalls: [], totalTokens: 10 },
      runDurationMs: 100,
    });

    expect(result).toMatchObject({ passed: true, score: 1.0 });
  });

  it("fails on no match", () => {
    const criterion = evalMatch();
    const result = criterion.fn({
      agent: mockAgent("a"),
      testCase: { input: "test", expected: "goodbye" },
      result: { output: "hello world", messages: [], toolCalls: [], totalTokens: 10 },
      runDurationMs: 100,
    });

    expect(result).toMatchObject({ passed: false, score: 0.0 });
  });

  it("exact match mode", () => {
    const criterion = evalMatch({ mode: "exact" });
    const partialResult = criterion.fn({
      agent: mockAgent("a"),
      testCase: { input: "test", expected: "hello" },
      result: { output: "hello world", messages: [], toolCalls: [], totalTokens: 10 },
      runDurationMs: 100,
    });

    expect(partialResult).toMatchObject({ passed: false });

    const exactResult = criterion.fn({
      agent: mockAgent("a"),
      testCase: { input: "test", expected: "hello" },
      result: { output: "hello", messages: [], toolCalls: [], totalTokens: 10 },
      runDurationMs: 100,
    });

    expect(exactResult).toMatchObject({ passed: true });
  });

  it("regex match mode", () => {
    const criterion = evalMatch({ mode: "regex" });
    const result = criterion.fn({
      agent: mockAgent("a"),
      testCase: { input: "test", expected: "\\d{3}" },
      result: { output: "code 123 here", messages: [], toolCalls: [], totalTokens: 10 },
      runDurationMs: 100,
    });

    expect(result).toMatchObject({ passed: true, score: 1.0 });
  });

  it("passes when no expected output", () => {
    const criterion = evalMatch();
    const result = criterion.fn({
      agent: mockAgent("a"),
      testCase: { input: "test" },
      result: { output: "anything", messages: [], toolCalls: [], totalTokens: 10 },
      runDurationMs: 100,
    });

    expect(result).toMatchObject({ passed: true, score: 1.0 });
  });
});

// ============================================================================
// evalJudge
// ============================================================================

describe("evalJudge", () => {
  it("uses LLM judge to score output", async () => {
    const judgeRunner = (async () => ({
      output: '{"score": 0.8, "reason": "Good answer"}',
      messages: [],
      toolCalls: [],
      totalTokens: 50,
    })) as AgentRunner;

    const criterion = evalJudge({
      runner: judgeRunner,
      judge: mockAgent("judge"),
    });

    const result = await criterion.fn({
      agent: mockAgent("a"),
      testCase: { input: "What is AI?", expected: "artificial intelligence" },
      result: { output: "AI is a field of computer science", messages: [], toolCalls: [], totalTokens: 100 },
      runDurationMs: 200,
    });

    expect(result.score).toBe(0.8);
    expect(result.passed).toBe(true);
    expect(result.reason).toBe("Good answer");
  });

  it("handles judge errors gracefully", async () => {
    const judgeRunner = (async () => {
      throw new Error("Judge unavailable");
    }) as AgentRunner;

    const criterion = evalJudge({
      runner: judgeRunner,
      judge: mockAgent("judge"),
    });

    const result = await criterion.fn({
      agent: mockAgent("a"),
      testCase: { input: "test" },
      result: { output: "output", messages: [], toolCalls: [], totalTokens: 10 },
      runDurationMs: 100,
    });

    expect(result.score).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("Judge error");
  });

  it("clamps score to [0, 1]", async () => {
    const judgeRunner = (async () => ({
      output: '{"score": 5.0, "reason": "over"}',
      messages: [],
      toolCalls: [],
      totalTokens: 50,
    })) as AgentRunner;

    const criterion = evalJudge({
      runner: judgeRunner,
      judge: mockAgent("judge"),
    });

    const result = await criterion.fn({
      agent: mockAgent("a"),
      testCase: { input: "test" },
      result: { output: "output", messages: [], toolCalls: [], totalTokens: 10 },
      runDurationMs: 100,
    });

    expect(result.score).toBe(1);
  });
});

// ============================================================================
// createEvalSuite
// ============================================================================

describe("createEvalSuite", () => {
  it("runs all agents against all cases", async () => {
    const suite = createEvalSuite({
      criteria: {
        cost: evalCost({ maxTokensPerRun: 500 }),
      },
      agents: [mockAgent("agent1"), mockAgent("agent2")],
      runner: mockRunner({ agent1: "hello AI", agent2: "hello ML" }),
      dataset,
    });

    const results = await suite.run();

    expect(Object.keys(results.summary)).toHaveLength(2);
    expect(results.details).toHaveLength(4); // 2 agents x 2 cases
    expect(results.totalTokens).toBe(400); // 4 runs x 100 tokens
  });

  it("computes per-agent summary", async () => {
    const suite = createEvalSuite({
      criteria: {
        cost: evalCost({ maxTokensPerRun: 500 }),
      },
      agents: [mockAgent("a")],
      runner: mockRunner({ a: "output" }),
      dataset,
    });

    const results = await suite.run();
    const summary = results.summary["a"]!;

    expect(summary.agentName).toBe("a");
    expect(summary.totalCases).toBe(2);
    expect(summary.totalTokens).toBe(200);
    expect(summary.criterionAverages["cost"]).toBeDefined();
    expect(summary.criterionPassRates["cost"]).toBeDefined();
  });

  it("fires onCaseComplete callback", async () => {
    const onCaseComplete = vi.fn();

    const suite = createEvalSuite({
      criteria: {
        cost: evalCost({ maxTokensPerRun: 500 }),
      },
      agents: [mockAgent("a")],
      runner: mockRunner({ a: "output" }),
      dataset,
      onCaseComplete,
    });

    await suite.run();

    expect(onCaseComplete).toHaveBeenCalledTimes(2);
  });

  it("fires onAgentComplete callback", async () => {
    const onAgentComplete = vi.fn();

    const suite = createEvalSuite({
      criteria: {
        cost: evalCost({ maxTokensPerRun: 500 }),
      },
      agents: [mockAgent("a"), mockAgent("b")],
      runner: mockRunner({ a: "output", b: "output" }),
      dataset,
      onAgentComplete,
    });

    await suite.run();

    expect(onAgentComplete).toHaveBeenCalledTimes(2);
  });

  it("handles agent errors gracefully", async () => {
    const runner = (async (agent) => {
      if (agent.name === "failing") {
        throw new Error("Agent crashed");
      }

      return { output: "ok", messages: [], toolCalls: [], totalTokens: 50 };
    }) as AgentRunner;

    const suite = createEvalSuite({
      criteria: {
        cost: evalCost({ maxTokensPerRun: 500 }),
      },
      agents: [mockAgent("failing")],
      runner,
      dataset,
    });

    const results = await suite.run();

    expect(results.summary["failing"]!.passRate).toBe(0);
    for (const detail of results.details) {
      expect(detail.allPassed).toBe(false);
      expect(detail.scores["cost"]!.reason).toContain("Agent error");
    }
  });

  it("supports running a single agent", async () => {
    const suite = createEvalSuite({
      criteria: {
        cost: evalCost({ maxTokensPerRun: 500 }),
      },
      agents: [mockAgent("a"), mockAgent("b")],
      runner: mockRunner({ a: "output", b: "output" }),
      dataset,
    });

    const summary = await suite.runAgent("a");

    expect(summary.agentName).toBe("a");
    expect(summary.totalCases).toBe(2);
  });

  it("throws on unknown agent in runAgent", async () => {
    const suite = createEvalSuite({
      criteria: { cost: evalCost({ maxTokensPerRun: 500 }) },
      agents: [mockAgent("a")],
      runner: mockRunner({ a: "output" }),
      dataset,
    });

    await expect(suite.runAgent("unknown")).rejects.toThrow("Unknown agent");
  });

  it("returns accessor methods", () => {
    const suite = createEvalSuite({
      criteria: {
        cost: evalCost({ maxTokensPerRun: 500 }),
        latency: evalLatency({ maxMs: 3000 }),
      },
      agents: [mockAgent("a"), mockAgent("b")],
      runner: mockRunner({}),
      dataset,
    });

    expect(suite.getAgents()).toHaveLength(2);
    expect(suite.getCriteria()).toEqual(["cost", "latency"]);
    expect(suite.getDataset()).toHaveLength(2);
  });

  it("supports multiple criteria per suite", async () => {
    const suite = createEvalSuite({
      criteria: {
        cost: evalCost({ maxTokensPerRun: 500 }),
        safety: evalSafety(),
        length: evalOutputLength({ minLength: 1 }),
      },
      agents: [mockAgent("a")],
      runner: mockRunner({ a: "clean safe output" }),
      dataset,
    });

    const results = await suite.run();

    const detail = results.details[0]!;

    expect(Object.keys(detail.scores)).toHaveLength(3);
    expect(detail.scores["cost"]!.passed).toBe(true);
    expect(detail.scores["safety"]!.passed).toBe(true);
    expect(detail.scores["length"]!.passed).toBe(true);
    expect(detail.allPassed).toBe(true);
  });

  it("handles criterion function as shorthand", async () => {
    const suite = createEvalSuite({
      criteria: {
        custom: (context) => ({
          score: context.result.totalTokens < 200 ? 1.0 : 0.0,
          passed: context.result.totalTokens < 200,
          durationMs: 0,
        }),
      },
      agents: [mockAgent("a")],
      runner: mockRunner({ a: "output" }),
      dataset,
    });

    const results = await suite.run();

    expect(results.details[0]!.scores["custom"]!.score).toBe(1.0);
  });

  it("respects abort signal", async () => {
    const controller = new AbortController();
    controller.abort();

    const suite = createEvalSuite({
      criteria: { cost: evalCost({ maxTokensPerRun: 500 }) },
      agents: [mockAgent("a")],
      runner: mockRunner({ a: "output" }),
      dataset,
      signal: controller.signal,
    });

    const results = await suite.run();

    // Aborted before any runs — summary should be empty
    expect(Object.keys(results.summary)).toHaveLength(0);
  });

  it("records timestamps", async () => {
    const suite = createEvalSuite({
      criteria: { cost: evalCost({ maxTokensPerRun: 500 }) },
      agents: [mockAgent("a")],
      runner: mockRunner({ a: "output" }),
      dataset,
    });

    const results = await suite.run();

    expect(results.startedAt).toBeLessThanOrEqual(results.completedAt);
    expect(results.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("handles abort during semaphore acquire gracefully", async () => {
    const controller = new AbortController();

    const suite = createEvalSuite({
      criteria: { cost: evalCost({ maxTokensPerRun: 500 }) },
      agents: [mockAgent("a")],
      runner: slowRunner(500),
      dataset,
      concurrency: 1,
      signal: controller.signal,
    });

    // Abort immediately so the semaphore acquire rejects
    controller.abort();

    const results = await suite.run();

    // All cases should have zero scores due to abort, not throw
    for (const detail of results.details) {
      expect(detail.allPassed).toBe(false);
    }
  });
});

// ============================================================================
// evalAssert
// ============================================================================

describe("evalAssert", () => {
  it("passes when all criteria met", async () => {
    const suite = createEvalSuite({
      criteria: { cost: evalCost({ maxTokensPerRun: 500 }) },
      agents: [mockAgent("a")],
      runner: mockRunner({ a: "output" }),
      dataset,
    });

    const results = await suite.run();

    // Should not throw
    expect(() => evalAssert(results, { minScore: 0.5 })).not.toThrow();
  });

  it("throws when minScore not met", async () => {
    const suite = createEvalSuite({
      criteria: { cost: evalCost({ maxTokensPerRun: 10 }) }, // very tight budget
      agents: [mockAgent("a")],
      runner: mockRunner({ a: "output" }),
      dataset,
    });

    const results = await suite.run();

    expect(() => evalAssert(results, { minScore: 0.99 })).toThrow();
  });

  it("throws when minPassRate not met", async () => {
    const suite = createEvalSuite({
      criteria: { cost: evalCost({ maxTokensPerRun: 10 }) },
      agents: [mockAgent("a")],
      runner: mockRunner({ a: "output" }),
      dataset,
    });

    const results = await suite.run();

    expect(() => evalAssert(results, { minPassRate: 1.0 })).toThrow();
  });

  it("throws when failOn criterion fails", async () => {
    const suite = createEvalSuite({
      criteria: { cost: evalCost({ maxTokensPerRun: 10 }) },
      agents: [mockAgent("a")],
      runner: mockRunner({ a: "output" }),
      dataset,
    });

    const results = await suite.run();

    expect(() => evalAssert(results, { failOn: ["cost"] })).toThrow();
  });

  it("passes with generous thresholds", async () => {
    const suite = createEvalSuite({
      criteria: { cost: evalCost({ maxTokensPerRun: 500 }) },
      agents: [mockAgent("a")],
      runner: mockRunner({ a: "output" }),
      dataset,
    });

    const results = await suite.run();

    expect(() => evalAssert(results, {
      minScore: 0.0,
      minPassRate: 0.0,
    })).not.toThrow();
  });
});
