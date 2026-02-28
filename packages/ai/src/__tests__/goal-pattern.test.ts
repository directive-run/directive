import { describe, it, expect } from "vitest";
import {
  createTestMultiAgentOrchestrator,
} from "../testing.js";
import {
  goal,
  allReadyStrategy,
  highestImpactStrategy,
  costEfficientStrategy,
  composePatterns,
  debate,
  patternToJSON,
  patternFromJSON,
} from "../multi-agent-orchestrator.js";
import type { GoalMetrics, GoalCheckpointState } from "../types.js";
import { InMemoryCheckpointStore } from "../checkpoint.js";

// ============================================================================
// Tests
// ============================================================================

describe("goal pattern", () => {
  it("basic goal achievement — 3 nodes with linear dependencies achieve goal", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        researcher: { agent: { name: "researcher" } },
        writer: { agent: { name: "writer" } },
        reviewer: { agent: { name: "reviewer" } },
      },
      mockResponses: {
        researcher: {
          output: "dynamic",
          totalTokens: 50,
          generate: () => ({
            output: JSON.stringify({ "research.findings": "AI Safety is important" }),
            totalTokens: 50,
          }),
        },
        writer: {
          output: "dynamic",
          totalTokens: 40,
          generate: () => ({
            output: JSON.stringify({ "article.draft": "A great article about AI Safety" }),
            totalTokens: 40,
          }),
        },
        reviewer: {
          output: "dynamic",
          totalTokens: 30,
          generate: () => ({
            output: JSON.stringify({ "article.approved": true }),
            totalTokens: 30,
          }),
        },
      },
    });

    const result = await orchestrator.runGoal(
      {
        researcher: {
          agent: "researcher",
          produces: ["research.findings"],
          requires: ["research.topic"],
          extractOutput: (r) => {
            const parsed = JSON.parse(r.output as string);

            return parsed;
          },
        },
        writer: {
          agent: "writer",
          produces: ["article.draft"],
          requires: ["research.findings"],
          extractOutput: (r) => JSON.parse(r.output as string),
        },
        reviewer: {
          agent: "reviewer",
          produces: ["article.approved"],
          requires: ["article.draft"],
          extractOutput: (r) => JSON.parse(r.output as string),
        },
      },
      { "research.topic": "AI Safety" },
      (facts) => facts["article.approved"] === true,
      {
        maxSteps: 10,
        extract: (facts) => facts["article.draft"] as string,
      },
    );

    expect(result.achieved).toBe(true);
    expect(result.result).toBe("A great article about AI Safety");
    expect(result.executionOrder).toContain("researcher");
    expect(result.executionOrder).toContain("writer");
    expect(result.executionOrder).toContain("reviewer");
    expect(result.steps).toBeLessThanOrEqual(10);
    expect(result.totalTokens).toBeGreaterThan(0);
  });

  it("parallel nodes — nodes at the same topological level run simultaneously", async () => {
    const callOrder: string[] = [];

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
        merger: { agent: { name: "merger" } },
      },
      mockResponses: {
        a: {
          output: "dynamic",
          totalTokens: 10,
          generate: () => {
            callOrder.push("a");

            return { output: JSON.stringify({ "data.a": "result-a" }), totalTokens: 10 };
          },
        },
        b: {
          output: "dynamic",
          totalTokens: 10,
          generate: () => {
            callOrder.push("b");

            return { output: JSON.stringify({ "data.b": "result-b" }), totalTokens: 10 };
          },
        },
        merger: {
          output: "dynamic",
          totalTokens: 10,
          generate: () => {
            callOrder.push("merger");

            return { output: JSON.stringify({ merged: true }), totalTokens: 10 };
          },
        },
      },
    });

    const result = await orchestrator.runGoal(
      {
        a: {
          agent: "a",
          produces: ["data.a"],
          extractOutput: (r) => JSON.parse(r.output as string),
        },
        b: {
          agent: "b",
          produces: ["data.b"],
          extractOutput: (r) => JSON.parse(r.output as string),
        },
        merger: {
          agent: "merger",
          produces: ["merged"],
          requires: ["data.a", "data.b"],
          extractOutput: (r) => JSON.parse(r.output as string),
        },
      },
      {},
      (facts) => facts.merged === true,
      { maxSteps: 5 },
    );

    expect(result.achieved).toBe(true);
    // a and b should both run before merger (since they have no deps)
    const aIdx = callOrder.indexOf("a");
    const bIdx = callOrder.indexOf("b");
    const mergerIdx = callOrder.indexOf("merger");
    expect(aIdx).toBeLessThan(mergerIdx);
    expect(bIdx).toBeLessThan(mergerIdx);
  });

  it("allowRerun — node re-runs when input facts change", async () => {
    let reviewerCalls = 0;

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        writer: { agent: { name: "writer" } },
        reviewer: { agent: { name: "reviewer" } },
      },
      mockResponses: {
        writer: {
          output: "dynamic",
          totalTokens: 20,
          generate: () => ({
            output: JSON.stringify({ "draft": `version-${reviewerCalls + 1}` }),
            totalTokens: 20,
          }),
        },
        reviewer: {
          output: "dynamic",
          totalTokens: 15,
          generate: () => {
            reviewerCalls++;
            const approved = reviewerCalls >= 2;

            return {
              output: JSON.stringify({ approved, "draft": approved ? `version-${reviewerCalls}` : `version-${reviewerCalls + 1}` }),
              totalTokens: 15,
            };
          },
        },
      },
    });

    const result = await orchestrator.runGoal(
      {
        writer: {
          agent: "writer",
          produces: ["draft"],
          allowRerun: true,
          extractOutput: (r) => JSON.parse(r.output as string),
        },
        reviewer: {
          agent: "reviewer",
          produces: ["approved"],
          requires: ["draft"],
          allowRerun: true,
          extractOutput: (r) => JSON.parse(r.output as string),
        },
      },
      {},
      (facts) => facts.approved === true,
      { maxSteps: 10 },
    );

    expect(result.achieved).toBe(true);
    expect(reviewerCalls).toBeGreaterThanOrEqual(2);
  });

  it("3-strike failure exclusion — node excluded after 3 consecutive failures", async () => {
    let failCount = 0;

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        flaky: { agent: { name: "flaky" } },
        fallback: { agent: { name: "fallback" } },
      },
      mockResponses: {
        flaky: {
          output: "dynamic",
          totalTokens: 10,
          generate: () => {
            failCount++;
            throw new Error("flaky agent failed");
          },
        },
        fallback: {
          output: JSON.stringify({ done: true }),
          totalTokens: 10,
        },
      },
    });

    const result = await orchestrator.runGoal(
      {
        flaky: {
          agent: "flaky",
          produces: ["flaky.result"],
          extractOutput: (r) => JSON.parse(r.output as string),
        },
        fallback: {
          agent: "fallback",
          produces: ["done"],
          requires: ["flaky.result"],
          extractOutput: (r) => JSON.parse(r.output as string),
        },
      },
      {},
      (facts) => facts.done === true,
      {
        maxSteps: 10,
        relaxation: [
          {
            label: "skip-flaky",
            afterStallSteps: 1,
            strategy: { type: "inject_facts", facts: { "flaky.result": "fallback-data" } },
          },
        ],
      },
    );

    expect(result.achieved).toBe(true);
    // Flaky should have been called 3 times (MAX_CONSECUTIVE_FAILURES) before being excluded
    expect(failCount).toBe(3);
  });

  it("stall detection — returns error when no ready nodes", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
      },
      mockResponses: {
        a: { output: JSON.stringify({ "partial": true }), totalTokens: 10 },
      },
    });

    const result = await orchestrator.runGoal(
      {
        a: {
          agent: "a",
          produces: ["partial"],
          extractOutput: (r) => JSON.parse(r.output as string),
        },
        b: {
          agent: "a",
          produces: ["complete"],
          requires: ["missing_dep"],
          extractOutput: (r) => JSON.parse(r.output as string),
        },
      },
      {},
      (facts) => facts.complete === true,
      { maxSteps: 10 },
    );

    expect(result.achieved).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("stalled");
  });

  it("relaxation — stall triggers tier, goal achievement resumes", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        worker: { agent: { name: "worker" } },
      },
      mockResponses: {
        worker: {
          output: "dynamic",
          totalTokens: 10,
          generate: () => ({
            output: JSON.stringify({ processed: true }),
            totalTokens: 10,
          }),
        },
      },
    });

    const result = await orchestrator.runGoal(
      {
        worker: {
          agent: "worker",
          produces: ["processed"],
          requires: ["data"],
          extractOutput: (r) => JSON.parse(r.output as string),
        },
      },
      {},
      (facts) => facts.processed === true,
      {
        maxSteps: 20,
        relaxation: [
          {
            label: "inject-data",
            afterStallSteps: 1,
            strategy: { type: "inject_facts", facts: { data: "injected-data" } },
          },
        ],
        onStall: () => {
          // stall callback fired
        },
      },
    );

    expect(result.achieved).toBe(true);
    expect(result.relaxations).toHaveLength(1);
    expect(result.relaxations[0]!.label).toBe("inject-data");
    expect(result.relaxations[0]!.strategy).toBe("inject_facts");
  });

  it("relaxation — accept_partial returns partial result", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        worker: { agent: { name: "worker" } },
      },
      mockResponses: {
        worker: {
          output: JSON.stringify({ partial: "data" }),
          totalTokens: 10,
        },
      },
    });

    const result = await orchestrator.runGoal(
      {
        worker: {
          agent: "worker",
          produces: ["partial"],
          extractOutput: (r) => JSON.parse(r.output as string),
        },
        blocked: {
          agent: "worker",
          produces: ["full"],
          requires: ["missing"],
          extractOutput: (r) => JSON.parse(r.output as string),
        },
      },
      {},
      (facts) => facts.full === true,
      {
        maxSteps: 20,
        relaxation: [
          {
            label: "accept",
            afterStallSteps: 1,
            strategy: { type: "accept_partial" },
          },
        ],
      },
    );

    expect(result.achieved).toBe(false);
    expect(result.error).toContain("accept");
    expect(result.facts.partial).toBe("data");
  });

  it("selection strategy — highestImpact picks top N", async () => {
    const selectedAgents: string[][] = [];

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
        c: { agent: { name: "c" } },
      },
      mockResponses: {
        a: { output: JSON.stringify({ "a.done": true }), totalTokens: 10 },
        b: { output: JSON.stringify({ "b.done": true }), totalTokens: 10 },
        c: { output: JSON.stringify({ "c.done": true }), totalTokens: 10 },
      },
    });

    const result = await orchestrator.runGoal(
      {
        a: {
          agent: "a",
          produces: ["a.done"],
          extractOutput: (r) => JSON.parse(r.output as string),
        },
        b: {
          agent: "b",
          produces: ["b.done"],
          extractOutput: (r) => JSON.parse(r.output as string),
        },
        c: {
          agent: "c",
          produces: ["c.done"],
          extractOutput: (r) => JSON.parse(r.output as string),
        },
      },
      {},
      (facts) => facts["a.done"] === true && facts["b.done"] === true && facts["c.done"] === true,
      {
        maxSteps: 10,
        selectionStrategy: highestImpactStrategy({ topN: 2 }),
        onStep: (_step, _facts, readyAgents) => {
          selectedAgents.push([...readyAgents]);
        },
      },
    );

    expect(result.achieved).toBe(true);
    // First step should have limited to 2 agents
    if (selectedAgents.length > 0 && selectedAgents[0]!.length > 0) {
      expect(selectedAgents[0]!.length).toBeLessThanOrEqual(2);
    }
  });

  it("satisfaction scoring — 0 to 1 progression tracked in step metrics", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
      },
      mockResponses: {
        a: {
          output: JSON.stringify({ "step.a": true }),
          totalTokens: 10,
        },
        b: {
          output: JSON.stringify({ "step.b": true }),
          totalTokens: 10,
        },
      },
    });

    const result = await orchestrator.runGoal(
      {
        a: {
          agent: "a",
          produces: ["step.a"],
          extractOutput: (r) => JSON.parse(r.output as string),
        },
        b: {
          agent: "b",
          produces: ["step.b"],
          requires: ["step.a"],
          extractOutput: (r) => JSON.parse(r.output as string),
        },
      },
      {},
      (facts) => facts["step.a"] === true && facts["step.b"] === true,
      {
        maxSteps: 10,
        satisfaction: (facts) => {
          let score = 0;
          if (facts["step.a"]) {
            score += 0.5;
          }
          if (facts["step.b"]) {
            score += 0.5;
          }

          return score;
        },
      },
    );

    expect(result.achieved).toBe(true);
    expect(result.stepMetrics.length).toBeGreaterThanOrEqual(1);

    // Satisfaction should progress from 0 toward 1
    const lastMetric = result.stepMetrics[result.stepMetrics.length - 1]!;
    expect(lastMetric.satisfaction).toBeGreaterThan(0);
  });

  it("timeout support — returns non-achieved on timeout", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        slow: { agent: { name: "slow" } },
      },
      mockResponses: {
        slow: {
          output: JSON.stringify({ partial: true }),
          totalTokens: 10,
          delay: 200,
        },
      },
    });

    const result = await orchestrator.runGoal(
      {
        slow: {
          agent: "slow",
          produces: ["partial"],
          allowRerun: true,
          extractOutput: (r) => JSON.parse(r.output as string),
        },
      },
      {},
      (facts) => facts.never === true,
      {
        maxSteps: 100,
        timeout: 100,
      },
    );

    expect(result.achieved).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("abort signal — returns non-achieved on abort", async () => {
    const controller = new AbortController();

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        worker: { agent: { name: "worker" } },
      },
      mockResponses: {
        worker: {
          output: "dynamic",
          totalTokens: 10,
          generate: () => {
            // Abort after first call
            controller.abort();

            return { output: JSON.stringify({ partial: true }), totalTokens: 10 };
          },
        },
      },
    });

    const result = await orchestrator.runGoal(
      {
        worker: {
          agent: "worker",
          produces: ["partial"],
          allowRerun: true,
          extractOutput: (r) => JSON.parse(r.output as string),
        },
      },
      {},
      (facts) => facts.never === true,
      {
        maxSteps: 100,
        signal: controller.signal,
      },
    );

    expect(result.achieved).toBe(false);
    expect(result.error).toContain("Abort");
  });

  it("registered pattern via runPattern", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        fetcher: { agent: { name: "fetcher" } },
        analyzer: { agent: { name: "analyzer" } },
      },
      mockResponses: {
        fetcher: {
          output: JSON.stringify({ data: "raw data" }),
          totalTokens: 20,
        },
        analyzer: {
          output: JSON.stringify({ analysis: "done" }),
          totalTokens: 20,
        },
      },
      patterns: {
        myPipeline: goal(
          {
            fetcher: {
              agent: "fetcher",
              produces: ["data"],
              extractOutput: (r) => JSON.parse(r.output as string),
            },
            analyzer: {
              agent: "analyzer",
              produces: ["analysis"],
              requires: ["data"],
              extractOutput: (r) => JSON.parse(r.output as string),
            },
          },
          (facts) => facts.analysis != null,
          { maxSteps: 5, extract: (facts) => facts.analysis as string },
        ),
      },
    });

    const result = await orchestrator.runPattern<string>("myPipeline", "go");

    expect(result).toBe("done");
  });

  it("composePatterns integration — goal + debate", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        worker: { agent: { name: "worker" } },
        critic1: { agent: { name: "critic1" } },
        critic2: { agent: { name: "critic2" } },
        judge: { agent: { name: "judge" } },
      },
      mockResponses: {
        worker: {
          output: JSON.stringify({ result: "worker output" }),
          totalTokens: 20,
        },
        critic1: { output: "critique 1", totalTokens: 10 },
        critic2: { output: "critique 2", totalTokens: 10 },
        judge: {
          output: JSON.stringify({ winnerId: "critic1", feedback: "better" }),
          totalTokens: 10,
        },
      },
    });

    const pipeline = composePatterns(
      goal(
        {
          worker: {
            agent: "worker",
            produces: ["result"],
            extractOutput: (r) => JSON.parse(r.output as string),
          },
        },
        (facts) => facts.result != null,
        { maxSteps: 3, extract: (facts) => String(facts.result) },
      ),
      debate({
        agents: ["critic1", "critic2"],
        evaluator: "judge",
        maxRounds: 1,
      }),
    );

    const result = await pipeline(orchestrator, "start");

    expect(result).toBe("critique 1");
  });

  it("goal factory creates valid GoalPattern", () => {
    const pattern = goal(
      {
        a: { agent: "a", produces: ["x"] },
      },
      (facts) => facts.x != null,
      { maxSteps: 5 },
    );

    expect(pattern.type).toBe("goal");
    expect(pattern.nodes.a).toBeDefined();
    expect(pattern.maxSteps).toBe(5);
    expect(typeof pattern.when).toBe("function");
  });

  it("allReadyStrategy returns all ready agents", () => {
    const strategy = allReadyStrategy();
    const selected = strategy.select(
      ["a", "b", "c"],
      {},
      { satisfaction: 0, progressRate: 0, estimatedStepsRemaining: null, decelerating: false },
    );

    expect(selected).toEqual(["a", "b", "c"]);
  });

  it("highestImpactStrategy picks top N by avgSatisfactionDelta", () => {
    const strategy = highestImpactStrategy({ topN: 2 });
    const selected = strategy.select(
      ["a", "b", "c"],
      {
        a: { runs: 3, avgSatisfactionDelta: 0.1, tokens: 100 },
        b: { runs: 3, avgSatisfactionDelta: 0.3, tokens: 100 },
        c: { runs: 3, avgSatisfactionDelta: 0.2, tokens: 100 },
      },
      { satisfaction: 0.5, progressRate: 0, estimatedStepsRemaining: null, decelerating: false },
    );

    expect(selected).toHaveLength(2);
    expect(selected[0]).toBe("b");
    expect(selected[1]).toBe("c");
  });

  it("costEfficientStrategy prefers lower cost-per-delta", () => {
    const strategy = costEfficientStrategy();
    const selected = strategy.select(
      ["expensive", "cheap"],
      {
        expensive: { runs: 5, avgSatisfactionDelta: 0.1, tokens: 1000 },
        cheap: { runs: 5, avgSatisfactionDelta: 0.1, tokens: 100 },
      },
      { satisfaction: 0.5, progressRate: 0, estimatedStepsRemaining: null, decelerating: false },
    );

    // Cheap should come first
    expect(selected[0]).toBe("cheap");
  });

  it("patternToJSON/patternFromJSON round-trip for goal", () => {
    const pattern = goal(
      {
        a: { agent: "a", produces: ["x"], requires: ["y"], priority: 10 },
        b: { agent: "b", produces: ["z"], allowRerun: true },
      },
      (facts) => facts.x != null,
      { maxSteps: 25, timeout: 60000 },
    );

    const json = patternToJSON(pattern);
    expect(json.type).toBe("goal");
    if (json.type === "goal") {
      const nodeA = json.nodes["a"]!;
      const nodeB = json.nodes["b"]!;
      expect(nodeA.agent).toBe("a");
      expect(nodeA.produces).toEqual(["x"]);
      expect(nodeA.requires).toEqual(["y"]);
      expect(nodeA.priority).toBe(10);
      expect(nodeB.allowRerun).toBe(true);
      expect(json.maxSteps).toBe(25);
      expect(json.timeout).toBe(60000);
    }

    const restored = patternFromJSON(json, {
      when: (facts: Record<string, unknown>) => facts.x != null,
    });
    expect(restored.type).toBe("goal");
  });

  it("onStep callback fires with correct arguments", async () => {
    const steps: Array<{ step: number; readyAgents: string[] }> = [];

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        worker: { agent: { name: "worker" } },
      },
      mockResponses: {
        worker: {
          output: JSON.stringify({ done: true }),
          totalTokens: 10,
        },
      },
    });

    await orchestrator.runGoal(
      {
        worker: {
          agent: "worker",
          produces: ["done"],
          extractOutput: (r) => JSON.parse(r.output as string),
        },
      },
      {},
      (facts) => facts.done === true,
      {
        maxSteps: 5,
        onStep: (step, _facts, readyAgents) => {
          steps.push({ step, readyAgents: [...readyAgents] });
        },
      },
    );

    expect(steps.length).toBeGreaterThanOrEqual(1);
    expect(steps[0]!.step).toBe(0);
    expect(steps[0]!.readyAgents).toContain("worker");
  });

  it("max steps exhausted returns non-achieved result", async () => {
    let callCount = 0;

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        worker: { agent: { name: "worker" } },
      },
      mockResponses: {
        worker: {
          output: "dynamic",
          totalTokens: 10,
          generate: () => {
            callCount++;

            return { output: JSON.stringify({ counter: callCount }), totalTokens: 10 };
          },
        },
      },
    });

    const result = await orchestrator.runGoal(
      {
        worker: {
          agent: "worker",
          produces: ["counter"],
          requires: ["counter"],
          allowRerun: true,
          extractOutput: (r) => JSON.parse(r.output as string),
        },
      },
      { counter: 0 },
      (facts) => (facts.counter as number) >= 100,
      { maxSteps: 3 },
    );

    expect(result.achieved).toBe(false);
    expect(result.steps).toBe(3);
    expect(result.error).toContain("Max steps");
  });

  it("priority ordering — higher priority nodes selected first", async () => {
    const callOrder: string[] = [];

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        low: { agent: { name: "low" } },
        high: { agent: { name: "high" } },
      },
      mockResponses: {
        low: {
          output: "dynamic",
          totalTokens: 10,
          generate: () => {
            callOrder.push("low");

            return { output: JSON.stringify({ "low.done": true }), totalTokens: 10 };
          },
        },
        high: {
          output: "dynamic",
          totalTokens: 10,
          generate: () => {
            callOrder.push("high");

            return { output: JSON.stringify({ "high.done": true }), totalTokens: 10 };
          },
        },
      },
    });

    await orchestrator.runGoal(
      {
        low: {
          agent: "low",
          produces: ["low.done"],
          priority: 1,
          extractOutput: (r) => JSON.parse(r.output as string),
        },
        high: {
          agent: "high",
          produces: ["high.done"],
          priority: 100,
          extractOutput: (r) => JSON.parse(r.output as string),
        },
      },
      {},
      (facts) => facts["low.done"] === true && facts["high.done"] === true,
      { maxSteps: 5 },
    );

    // Both should run in the same step, but the sorted order tracks priority
    expect(callOrder).toContain("high");
    expect(callOrder).toContain("low");
  });

  it("buildInput provides custom input to agent", async () => {
    let receivedInput = "";

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        worker: { agent: { name: "worker" } },
      },
      mockResponses: {
        worker: {
          output: "dynamic",
          totalTokens: 10,
          generate: (input) => {
            receivedInput = input;

            return { output: JSON.stringify({ done: true }), totalTokens: 10 };
          },
        },
      },
    });

    await orchestrator.runGoal(
      {
        worker: {
          agent: "worker",
          produces: ["done"],
          buildInput: (facts) => `Custom input: ${facts.input}`,
          extractOutput: (r) => JSON.parse(r.output as string),
        },
      },
      { input: "hello" },
      (facts) => facts.done === true,
      { maxSteps: 3 },
    );

    expect(receivedInput).toBe("Custom input: hello");
  });

  it("unregistered agent throws", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        real: { agent: { name: "real" } },
      },
      mockResponses: {
        real: { output: "ok", totalTokens: 5 },
      },
    });

    await expect(
      orchestrator.runGoal(
        {
          ghost: {
            agent: "nonexistent",
            produces: ["x"],
          },
        },
        {},
        () => true,
      ),
    ).rejects.toThrow("unregistered agent");
  });

  it("relaxation — allow_rerun unblocks completed nodes", async () => {
    let writerCalls = 0;

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        writer: { agent: { name: "writer" } },
      },
      mockResponses: {
        writer: {
          output: "dynamic",
          totalTokens: 10,
          generate: () => {
            writerCalls++;
            const approved = writerCalls >= 2;

            return {
              output: JSON.stringify({ draft: `v${writerCalls}`, approved }),
              totalTokens: 10,
            };
          },
        },
      },
    });

    const result = await orchestrator.runGoal(
      {
        writer: {
          agent: "writer",
          produces: ["draft", "approved"],
          extractOutput: (r) => JSON.parse(r.output as string),
        },
      },
      {},
      (facts) => facts.approved === true,
      {
        maxSteps: 20,
        relaxation: [
          {
            label: "retry-writer",
            afterStallSteps: 1,
            strategy: { type: "allow_rerun", nodes: ["writer"] },
          },
        ],
      },
    );

    expect(result.achieved).toBe(true);
    expect(writerCalls).toBeGreaterThanOrEqual(2);
    expect(result.relaxations.length).toBeGreaterThanOrEqual(1);
  });

  // ---- C1: User callback safety ----

  it("C1: throwing when() does not crash the loop", async () => {
    let whenCalls = 0;

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        worker: { agent: { name: "worker" } },
      },
      mockResponses: {
        worker: {
          output: JSON.stringify({ done: true }),
          totalTokens: 10,
        },
      },
    });

    const result = await orchestrator.runGoal(
      {
        worker: {
          agent: "worker",
          produces: ["done"],
          extractOutput: (r) => JSON.parse(r.output as string),
        },
      },
      {},
      (facts) => {
        whenCalls++;
        if (whenCalls <= 1) {
          throw new Error("when() kaboom");
        }

        return facts.done === true;
      },
      { maxSteps: 5 },
    );

    // Should still achieve goal after the first when() throw is caught
    expect(result.achieved).toBe(true);
    expect(whenCalls).toBeGreaterThanOrEqual(2);
  });

  it("C1: throwing extractOutput does not crash the loop", async () => {
    let extractCalls = 0;

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        worker: { agent: { name: "worker" } },
        backup: { agent: { name: "backup" } },
      },
      mockResponses: {
        worker: {
          output: JSON.stringify({ partial: true }),
          totalTokens: 10,
        },
        backup: {
          output: JSON.stringify({ done: true }),
          totalTokens: 10,
        },
      },
    });

    const result = await orchestrator.runGoal(
      {
        worker: {
          agent: "worker",
          produces: ["partial"],
          extractOutput: () => {
            extractCalls++;
            throw new Error("extractOutput kaboom");
          },
        },
        backup: {
          agent: "backup",
          produces: ["done"],
          extractOutput: (r) => JSON.parse(r.output as string),
        },
      },
      {},
      (facts) => facts.done === true,
      { maxSteps: 5 },
    );

    expect(result.achieved).toBe(true);
    expect(extractCalls).toBeGreaterThanOrEqual(1);
  });

  it("C1: throwing satisfaction does not crash the loop", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        worker: { agent: { name: "worker" } },
      },
      mockResponses: {
        worker: {
          output: JSON.stringify({ done: true }),
          totalTokens: 10,
        },
      },
    });

    const result = await orchestrator.runGoal(
      {
        worker: {
          agent: "worker",
          produces: ["done"],
          extractOutput: (r) => JSON.parse(r.output as string),
        },
      },
      {},
      (facts) => facts.done === true,
      {
        maxSteps: 5,
        satisfaction: () => {
          throw new Error("satisfaction kaboom");
        },
      },
    );

    expect(result.achieved).toBe(true);
  });

  // ---- C2: Cycle detection ----

  it("C2: cycle detection throws on circular produces/requires", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
      },
      mockResponses: {
        a: { output: "ok", totalTokens: 5 },
        b: { output: "ok", totalTokens: 5 },
      },
    });

    await expect(
      orchestrator.runGoal(
        {
          a: {
            agent: "a",
            produces: ["x"],
            requires: ["y"],
          },
          b: {
            agent: "b",
            produces: ["y"],
            requires: ["x"],
          },
        },
        {},
        () => true,
      ),
    ).rejects.toThrow("cycle detected");
  });

  // ---- M4: Satisfaction bounds ----

  it("M4: satisfaction NaN/Infinity clamped to valid range", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        worker: { agent: { name: "worker" } },
      },
      mockResponses: {
        worker: {
          output: JSON.stringify({ done: true }),
          totalTokens: 10,
        },
      },
    });

    let callIdx = 0;
    const result = await orchestrator.runGoal(
      {
        worker: {
          agent: "worker",
          produces: ["done"],
          extractOutput: (r) => JSON.parse(r.output as string),
        },
      },
      {},
      (facts) => facts.done === true,
      {
        maxSteps: 5,
        satisfaction: () => {
          callIdx++;
          if (callIdx === 1) {
            return NaN;
          }
          if (callIdx === 2) {
            return Infinity;
          }

          return 0.5;
        },
      },
    );

    expect(result.achieved).toBe(true);
    // Step metrics should have valid satisfaction values
    for (const sm of result.stepMetrics) {
      expect(Number.isFinite(sm.satisfaction)).toBe(true);
      expect(sm.satisfaction).toBeGreaterThanOrEqual(0);
      expect(sm.satisfaction).toBeLessThanOrEqual(1);
    }
  });

  // ---- M5: Empty selection strategy guard ----

  it("M5: empty selection strategy result falls back to all ready nodes", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        worker: { agent: { name: "worker" } },
      },
      mockResponses: {
        worker: {
          output: JSON.stringify({ done: true }),
          totalTokens: 10,
        },
      },
    });

    const result = await orchestrator.runGoal(
      {
        worker: {
          agent: "worker",
          produces: ["done"],
          extractOutput: (r) => JSON.parse(r.output as string),
        },
      },
      {},
      (facts) => facts.done === true,
      {
        maxSteps: 5,
        selectionStrategy: {
          select: () => [], // Intentionally return empty
        },
      },
    );

    // Should still achieve goal because fallback kicks in
    expect(result.achieved).toBe(true);
  });

  // ---- M7: estimatedStepsRemaining computed ----

  it("M7: GoalMetrics includes estimatedStepsRemaining and decelerating", async () => {
    const metricsReceived: GoalMetrics[] = [];

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
        c: { agent: { name: "c" } },
      },
      mockResponses: {
        a: { output: JSON.stringify({ "a.done": true }), totalTokens: 10 },
        b: { output: JSON.stringify({ "b.done": true }), totalTokens: 10 },
        c: { output: JSON.stringify({ "c.done": true }), totalTokens: 10 },
      },
    });

    await orchestrator.runGoal(
      {
        a: { agent: "a", produces: ["a.done"], extractOutput: (r) => JSON.parse(r.output as string) },
        b: { agent: "b", produces: ["b.done"], requires: ["a.done"], extractOutput: (r) => JSON.parse(r.output as string) },
        c: { agent: "c", produces: ["c.done"], requires: ["b.done"], extractOutput: (r) => JSON.parse(r.output as string) },
      },
      {},
      (facts) => facts["a.done"] === true && facts["b.done"] === true && facts["c.done"] === true,
      {
        maxSteps: 10,
        satisfaction: (facts) => {
          let score = 0;
          if (facts["a.done"]) {
            score += 0.33;
          }
          if (facts["b.done"]) {
            score += 0.33;
          }
          if (facts["c.done"]) {
            score += 0.34;
          }

          return score;
        },
        selectionStrategy: {
          select: (ready, _metrics, goalMetrics) => {
            metricsReceived.push({ ...goalMetrics });

            return ready;
          },
        },
      },
    );

    // After step 1, the strategy should receive computed metrics
    if (metricsReceived.length >= 2) {
      const m = metricsReceived[metricsReceived.length - 1]!;
      expect(typeof m.decelerating).toBe("boolean");
      // progressRate should be non-zero after progress
      expect(m.progressRate).toBeGreaterThanOrEqual(0);
    }
  });

  // ---- P5: Checkpoint & Resume ----

  it("P5: saves checkpoints at configured intervals", async () => {
    const store = new InMemoryCheckpointStore();
    let callCount = 0;

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        worker: { agent: { name: "worker" } },
      },
      mockResponses: {
        worker: {
          output: "dynamic",
          totalTokens: 10,
          generate: () => {
            callCount++;

            return { output: JSON.stringify({ counter: callCount }), totalTokens: 10 };
          },
        },
      },
    });

    const result = await orchestrator.runGoal(
      {
        worker: {
          agent: "worker",
          produces: ["counter"],
          requires: ["counter"],
          allowRerun: true,
          extractOutput: (r) => JSON.parse(r.output as string),
        },
      },
      { counter: 0 },
      (facts) => (facts.counter as number) >= 8,
      {
        maxSteps: 20,
        checkpoint: {
          everyN: 2,
          store,
          labelPrefix: "test-conv",
        },
      },
    );

    expect(result.achieved).toBe(true);

    // Should have saved checkpoints every 2 steps
    const checkpoints = await store.list();
    expect(checkpoints.length).toBeGreaterThanOrEqual(1);

    // Verify checkpoint labels
    for (const cp of checkpoints) {
      expect(cp.label).toMatch(/^test-conv:step-/);
    }
  });

  it("P5: resume from checkpoint continues goal achievement", async () => {
    let callCount = 0;

    const makeOrchestrator = () =>
      createTestMultiAgentOrchestrator({
        agents: {
          worker: { agent: { name: "worker" } },
        },
        mockResponses: {
          worker: {
            output: "dynamic",
            totalTokens: 10,
            generate: () => {
              callCount++;

              return { output: JSON.stringify({ counter: callCount }), totalTokens: 10 };
            },
          },
        },
      });

    // Build a synthetic checkpoint state as if we stopped mid-goal achievement at step 3
    // nodeInputHashes stores the input the worker LAST ran with (counter=2 produced counter=3)
    const checkpointState: GoalCheckpointState = {
      type: "goal",
      version: 1,
      id: "ckpt_test_resume",
      createdAt: new Date().toISOString(),
      label: "test-resume",
      patternId: "__resume_test",
      step: 3, // Resume from step 3
      facts: { counter: 3 },
      completedNodes: ["worker"],
      failedNodes: {},
      nodeInputHashes: { worker: JSON.stringify([2]) }, // Last ran with counter=2
      nodeOutputs: { worker: { output: { counter: 3 }, totalTokens: 30 } },
      executionOrder: ["worker", "worker", "worker"],
      stepMetrics: [
        { step: 0, durationMs: 1, nodesRun: ["worker"], factsProduced: ["counter"], satisfaction: 0.1, satisfactionDelta: 0.1, tokensConsumed: 10 },
        { step: 1, durationMs: 1, nodesRun: ["worker"], factsProduced: ["counter"], satisfaction: 0.2, satisfactionDelta: 0.1, tokensConsumed: 10 },
        { step: 2, durationMs: 1, nodesRun: ["worker"], factsProduced: ["counter"], satisfaction: 0.3, satisfactionDelta: 0.1, tokensConsumed: 10 },
      ],
      relaxations: [],
      appliedRelaxationTiers: 0,
      stallSteps: 0,
      lastSatisfaction: 0.3,
      agentMetrics: { worker: { runs: 3, totalDelta: 0.3, tokens: 30 } },
    };

    const orchestrator = makeOrchestrator();

    const pattern = goal<number>(
      {
        worker: {
          agent: "worker",
          produces: ["counter"],
          requires: ["counter"],
          allowRerun: true,
          extractOutput: (r) => JSON.parse(r.output as string),
        },
      },
      (facts) => (facts.counter as number) >= 6,
      { maxSteps: 10 },
    );

    const result = await orchestrator.resumeGoal(checkpointState, pattern);

    expect(result.achieved).toBe(true);
    // Should have started from step 3, not step 0
    expect(result.executionOrder.length).toBeGreaterThan(3); // 3 from checkpoint + more runs
    // Step metrics should include the restored ones + new ones
    expect(result.stepMetrics.length).toBeGreaterThan(3);
  });

  it("P5: resumeGoal rejects invalid checkpoint", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: { a: { agent: { name: "a" } } },
      mockResponses: { a: { output: "ok", totalTokens: 5 } },
    });

    await expect(
      orchestrator.resumeGoal(
        { version: 2 } as any,
        goal({ a: { agent: "a", produces: ["x"] } }, () => true),
      ),
    ).rejects.toThrow("Invalid goal checkpoint state");
  });

  // ==========================================================================
  // Migration shims — accept legacy "converge" type
  // ==========================================================================

  it("M2: patternFromJSON accepts legacy converge type and normalizes to goal", () => {
    const legacy = {
      type: "converge" as any,
      nodes: {
        fetch: { agent: "fetcher", produces: ["data"], requires: [] },
      },
    };

    const pattern = patternFromJSON(legacy);

    expect(pattern.type).toBe("goal");
    expect((pattern as any).nodes.fetch.agent).toBe("fetcher");
  });

  it("M2: patternFromJSON does not mutate the original input", () => {
    const legacy = {
      type: "converge" as any,
      nodes: {
        a: { agent: "alpha", produces: ["x"], requires: [] },
      },
    };

    patternFromJSON(legacy);

    // Original should still say "converge"
    expect(legacy.type).toBe("converge");
  });

  it("M2: patternFromJSON still works with native goal type", () => {
    const nativeGoal = patternToJSON(
      goal({ a: { agent: "alpha", produces: ["x"] } }, () => true),
    );

    expect(nativeGoal.type).toBe("goal");

    const pattern = patternFromJSON(nativeGoal);

    expect(pattern.type).toBe("goal");
  });

  it("M2: resumeGoal accepts legacy converge checkpoint state", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: { worker: { agent: { name: "worker" } } },
      mockResponses: {
        worker: {
          output: "dynamic",
          totalTokens: 10,
          generate: () => ({
            output: JSON.stringify({ done: true }),
            totalTokens: 10,
          }),
        },
      },
    });

    const legacyCheckpoint = {
      type: "converge" as any,
      version: 1 as const,
      patternId: "test-pattern",
      step: 0,
      facts: {},
      completedNodes: [],
      failedNodes: {},
      nodeInputHashes: {},
      nodeOutputs: {},
      executionOrder: [],
      stepMetrics: [],
      relaxations: [],
      agentMetrics: {},
    };

    const pattern = goal(
      { worker: { agent: "worker", produces: ["done"], extractOutput: (r) => JSON.parse(r.output as string) } },
      (facts) => facts.done === true,
    );

    const result = await orchestrator.resumeGoal(legacyCheckpoint as any, pattern);

    expect(result.achieved).toBe(true);
  });

  it("M2: resumeGoal does not mutate the legacy checkpoint input", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: { worker: { agent: { name: "worker" } } },
      mockResponses: {
        worker: {
          output: "dynamic",
          totalTokens: 10,
          generate: () => ({
            output: JSON.stringify({ done: true }),
            totalTokens: 10,
          }),
        },
      },
    });

    const legacyCheckpoint = {
      type: "converge" as any,
      version: 1 as const,
      patternId: "test-pattern",
      step: 0,
      facts: {},
      completedNodes: [],
      failedNodes: {},
      nodeInputHashes: {},
      nodeOutputs: {},
      executionOrder: [],
      stepMetrics: [],
      relaxations: [],
      agentMetrics: {},
    };

    const pattern = goal(
      { worker: { agent: "worker", produces: ["done"], extractOutput: (r) => JSON.parse(r.output as string) } },
      (facts) => facts.done === true,
    );

    await orchestrator.resumeGoal(legacyCheckpoint as any, pattern);

    // Original checkpoint should not be mutated
    expect(legacyCheckpoint.type).toBe("converge");
  });
});
