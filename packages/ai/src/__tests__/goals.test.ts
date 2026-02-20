import { describe, it, expect, vi } from "vitest";
import {
  createGoalEngine,
  buildDependencyGraph,
  type GoalAgentDeclaration,
} from "../goals.js";
import type { AgentRunner, RunResult } from "../types.js";

// ============================================================================
// Test helpers
// ============================================================================

function mockRunner(outputs: Record<string, unknown>): AgentRunner {
  return (async (agent, _input) => {
    const output = outputs[agent.name];

    return {
      output: typeof output === "string" ? output : JSON.stringify(output),
      messages: [],
      toolCalls: [],
      totalTokens: 100,
    } as RunResult<unknown>;
  }) as AgentRunner;
}

function makeAgents(defs: Record<string, { produces: string[]; requires: string[] }>): Record<string, GoalAgentDeclaration> {
  const result: Record<string, GoalAgentDeclaration> = {};
  for (const [id, def] of Object.entries(defs)) {
    result[id] = {
      agent: { name: id },
      produces: def.produces,
      requires: def.requires,
    };
  }

  return result;
}

// ============================================================================
// Tests
// ============================================================================

describe("buildDependencyGraph", () => {
  it("infers linear dependency chain", () => {
    const agents = makeAgents({
      researcher: { produces: ["findings"], requires: ["topic"] },
      writer: { produces: ["draft"], requires: ["findings"] },
      reviewer: { produces: ["approved"], requires: ["draft"] },
    });

    const graph = buildDependencyGraph(agents);

    expect(graph.order).toEqual(["researcher", "writer", "reviewer"]);
    expect(graph.roots).toEqual(["researcher"]);
    expect(graph.leaves).toEqual(["reviewer"]);
    expect(graph.edges).toHaveLength(2);
  });

  it("handles diamond dependencies", () => {
    const agents = makeAgents({
      source: { produces: ["data"], requires: [] },
      analyzer: { produces: ["analysis"], requires: ["data"] },
      summarizer: { produces: ["summary"], requires: ["data"] },
      merger: { produces: ["report"], requires: ["analysis", "summary"] },
    });

    const graph = buildDependencyGraph(agents);

    expect(graph.roots).toEqual(["source"]);
    expect(graph.leaves).toEqual(["merger"]);
    // source must come first, merger must come last
    expect(graph.order.indexOf("source")).toBe(0);
    expect(graph.order.indexOf("merger")).toBe(3);
  });

  it("supports multiple roots", () => {
    const agents = makeAgents({
      a: { produces: ["x"], requires: [] },
      b: { produces: ["y"], requires: [] },
      c: { produces: ["z"], requires: ["x", "y"] },
    });

    const graph = buildDependencyGraph(agents);

    expect(graph.roots).toContain("a");
    expect(graph.roots).toContain("b");
    expect(graph.order.indexOf("c")).toBe(2);
  });

  it("detects circular dependencies", () => {
    const agents = makeAgents({
      a: { produces: ["x"], requires: ["z"] },
      b: { produces: ["y"], requires: ["x"] },
      c: { produces: ["z"], requires: ["y"] },
    });

    expect(() => buildDependencyGraph(agents)).toThrow("Circular dependency");
  });

  it("detects duplicate producers", () => {
    const agents = makeAgents({
      a: { produces: ["x"], requires: [] },
      b: { produces: ["x"], requires: [] },
    });

    expect(() => buildDependencyGraph(agents)).toThrow('produced by both');
  });

  it("handles agents with external requires (initial facts)", () => {
    const agents = makeAgents({
      a: { produces: ["result"], requires: ["user_input"] },
    });

    const graph = buildDependencyGraph(agents);

    expect(graph.roots).toEqual(["a"]);
    expect(graph.edges).toHaveLength(0);
  });
});

describe("createGoalEngine", () => {
  it("converges a linear pipeline", async () => {
    const engine = createGoalEngine({
      runner: mockRunner({
        researcher: { findings: "AI safety is important" },
        writer: { draft: "An article about AI safety" },
      }),
      agents: makeAgents({
        researcher: { produces: ["findings"], requires: ["topic"] },
        writer: { produces: ["draft"], requires: ["findings"] },
      }),
      goals: {
        articleReady: {
          when: (facts) => facts.draft != null,
        },
      },
    });

    const result = await engine.converge("articleReady", { topic: "AI Safety" });

    expect(result.converged).toBe(true);
    expect(result.executionOrder).toEqual(["researcher", "writer"]);
    expect(result.totalTokens).toBe(200);
    expect(result.facts.draft).toBeDefined();
    expect(result.steps).toBeLessThanOrEqual(2);
  });

  it("handles parallel-ready agents", async () => {
    const engine = createGoalEngine({
      runner: (async (agent) => {
        const outputs: Record<string, unknown> = {
          a: { a_out: "a done" },
          b: { b_out: "b done" },
          merger: { final: "merged" },
        };

        return {
          output: JSON.stringify(outputs[agent.name]),
          messages: [],
          toolCalls: [],
          totalTokens: 50,
        };
      }) as AgentRunner,
      agents: makeAgents({
        a: { produces: ["a_out"], requires: ["input"] },
        b: { produces: ["b_out"], requires: ["input"] },
        merger: { produces: ["final"], requires: ["a_out", "b_out"] },
      }),
      goals: {
        done: { when: (facts) => facts.final != null },
      },
    });

    const result = await engine.converge("done", { input: "start" });

    expect(result.converged).toBe(true);
    // a and b should run in parallel (same step), then merger
    expect(result.executionOrder).toContain("a");
    expect(result.executionOrder).toContain("b");
    expect(result.executionOrder).toContain("merger");
    expect(result.executionOrder.indexOf("merger")).toBe(2);
  });

  it("returns stuck result when facts are missing", async () => {
    const engine = createGoalEngine({
      runner: mockRunner({}),
      agents: makeAgents({
        writer: { produces: ["draft"], requires: ["findings"] },
      }),
      goals: {
        done: { when: (facts) => facts.draft != null },
      },
    });

    const result = await engine.converge("done", { topic: "test" });

    expect(result.converged).toBe(false);
    expect(result.error).toContain("No agents ready");
    expect(result.error).toContain("findings");
  });

  it("respects maxSteps and reports stuck when no agents ready", async () => {
    const engine = createGoalEngine({
      runner: (async () => ({
        output: JSON.stringify({ data: "done" }),
        messages: [],
        toolCalls: [],
        totalTokens: 10,
      })) as AgentRunner,
      agents: makeAgents({
        worker: { produces: ["data"], requires: [] },
        consumer: { produces: ["result"], requires: ["data", "missing_key"] },
      }),
      goals: {
        done: {
          when: (facts) => facts.result != null,
          maxSteps: 5,
        },
      },
    });

    const result = await engine.converge("done", {});

    expect(result.converged).toBe(false);
    // Worker runs but consumer can't because "missing_key" is never produced
    expect(result.error).toContain("No agents ready");
    expect(result.error).toContain("missing_key");
  });

  it("throws on unknown goal", async () => {
    const engine = createGoalEngine({
      runner: mockRunner({}),
      agents: makeAgents({ a: { produces: ["x"], requires: [] } }),
      goals: { myGoal: { when: () => true } },
    });

    await expect(engine.converge("nonexistent", {})).rejects.toThrow("Unknown goal");
  });

  it("fires lifecycle callbacks", async () => {
    const onStart = vi.fn();
    const onComplete = vi.fn();
    const onStep = vi.fn();

    const engine = createGoalEngine({
      runner: mockRunner({
        agent: { result: "done" },
      }),
      agents: makeAgents({
        agent: { produces: ["result"], requires: [] },
      }),
      goals: {
        done: { when: (facts) => facts.result != null },
      },
      onAgentStart: onStart,
      onAgentComplete: onComplete,
      onStep,
    });

    await engine.converge("done", {});

    expect(onStart).toHaveBeenCalledWith("agent", expect.any(String));
    expect(onComplete).toHaveBeenCalledWith("agent", expect.objectContaining({ totalTokens: 100 }));
    expect(onStep).toHaveBeenCalled();
  });

  it("supports custom buildInput", async () => {
    let receivedInput = "";

    const engine = createGoalEngine({
      runner: (async (_agent, input) => {
        receivedInput = input;

        return { output: "ok", messages: [], toolCalls: [], totalTokens: 10 };
      }) as AgentRunner,
      agents: {
        custom: {
          agent: { name: "custom" },
          produces: ["result"],
          requires: ["topic"],
          buildInput: (facts) => `Research this: ${facts.topic}`,
          extractOutput: () => ({ result: "done" }),
        },
      },
      goals: {
        done: { when: (facts) => facts.result != null },
      },
    });

    await engine.converge("done", { topic: "AI" });

    expect(receivedInput).toBe("Research this: AI");
  });

  it("supports custom extractOutput", async () => {
    const engine = createGoalEngine({
      runner: (async () => ({
        output: "raw text output",
        messages: [],
        toolCalls: [],
        totalTokens: 10,
      })) as AgentRunner,
      agents: {
        agent: {
          agent: { name: "agent" },
          produces: ["parsed"],
          requires: [],
          extractOutput: (result) => ({ parsed: (result.output as string).toUpperCase() }),
        },
      },
      goals: {
        done: { when: (facts) => facts.parsed != null },
      },
    });

    const result = await engine.converge("done", {});

    expect(result.facts.parsed).toBe("RAW TEXT OUTPUT");
  });

  it("handles agent errors gracefully", async () => {
    const engine = createGoalEngine({
      runner: (async (agent) => {
        if (agent.name === "flaky") {
          throw new Error("Network timeout");
        }

        return { output: "{}", messages: [], toolCalls: [], totalTokens: 10 };
      }) as AgentRunner,
      agents: makeAgents({
        flaky: { produces: ["data"], requires: [] },
        consumer: { produces: ["result"], requires: ["data"] },
      }),
      goals: {
        done: {
          when: (facts) => facts.result != null,
          maxSteps: 2,
        },
      },
    });

    const result = await engine.converge("done", {});

    expect(result.converged).toBe(false);
  });

  it("supports abort signal", async () => {
    const controller = new AbortController();

    const engine = createGoalEngine({
      runner: (async () => {
        controller.abort();

        return { output: "{}", messages: [], toolCalls: [], totalTokens: 10 };
      }) as AgentRunner,
      agents: makeAgents({
        agent: { produces: ["x"], requires: [] },
      }),
      goals: {
        done: { when: () => false, maxSteps: 100 },
      },
    });

    const result = await engine.converge("done", {}, controller.signal);

    expect(result.converged).toBe(false);
    expect(result.error).toBe("Aborted");
  });

  it("validates configuration", () => {
    const engine = createGoalEngine({
      runner: mockRunner({}),
      agents: makeAgents({
        a: { produces: ["x"], requires: [] },
      }),
      goals: { g: { when: () => true } },
    });

    const result = engine.validate();

    expect(result.valid).toBe(true);
  });

  it("returns dependency graph", () => {
    const engine = createGoalEngine({
      runner: mockRunner({}),
      agents: makeAgents({
        a: { produces: ["x"], requires: [] },
        b: { produces: ["y"], requires: ["x"] },
      }),
      goals: { g: { when: () => true } },
    });

    const graph = engine.getDependencyGraph();

    expect(graph.order).toEqual(["a", "b"]);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]!.from).toBe("a");
    expect(graph.edges[0]!.to).toBe("b");
    expect(graph.edges[0]!.factKey).toBe("x");
  });

  it("single-produce agent uses raw output as fact value", async () => {
    const engine = createGoalEngine({
      runner: (async () => ({
        output: "raw string not json",
        messages: [],
        toolCalls: [],
        totalTokens: 10,
      })) as AgentRunner,
      agents: {
        simple: {
          agent: { name: "simple" },
          produces: ["output"],
          requires: [],
        },
      },
      goals: {
        done: { when: (facts) => facts.output != null },
      },
    });

    const result = await engine.converge("done", {});

    expect(result.converged).toBe(true);
    expect(result.facts.output).toBe("raw string not json");
  });
});

describe("validation", () => {
  it("fails on circular deps", () => {
    expect(() => createGoalEngine({
      runner: mockRunner({}),
      agents: makeAgents({
        a: { produces: ["x"], requires: ["y"] },
        b: { produces: ["y"], requires: ["x"] },
      }),
      goals: { g: { when: () => true } },
    })).toThrow("Circular dependency");
  });

  it("fails on duplicate producers", () => {
    expect(() => createGoalEngine({
      runner: mockRunner({}),
      agents: makeAgents({
        a: { produces: ["x"], requires: [] },
        b: { produces: ["x"], requires: [] },
      }),
      goals: { g: { when: () => true } },
    })).toThrow("produced by both");
  });

  it("warns on unreachable requires", () => {
    const engine = createGoalEngine({
      runner: mockRunner({}),
      agents: makeAgents({
        a: { produces: ["x"], requires: ["external_input"] },
      }),
      goals: { g: { when: () => true } },
    });

    const result = engine.validate();

    expect(result.valid).toBe(true);
    expect(result.warnings).toContainEqual(expect.stringContaining("external_input"));
  });
});

// ============================================================================
// plan() dry-run
// ============================================================================

describe("plan()", () => {
  it("returns steps for a linear pipeline", () => {
    const engine = createGoalEngine({
      runner: mockRunner({}),
      agents: makeAgents({
        researcher: { produces: ["findings"], requires: ["topic"] },
        writer: { produces: ["draft"], requires: ["findings"] },
      }),
      goals: { done: { when: () => true } },
    });

    const plan = engine.plan("done", ["topic"]);

    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0]!.agents).toEqual(["researcher"]);
    expect(plan.steps[0]!.producedFacts).toEqual(["findings"]);
    expect(plan.steps[1]!.agents).toEqual(["writer"]);
    expect(plan.steps[1]!.producedFacts).toEqual(["draft"]);
    expect(plan.feasible).toBe(true);
    expect(plan.unreachableAgents).toEqual([]);
  });

  it("identifies parallel agents in the same step", () => {
    const engine = createGoalEngine({
      runner: mockRunner({}),
      agents: makeAgents({
        a: { produces: ["x"], requires: ["input"] },
        b: { produces: ["y"], requires: ["input"] },
        merger: { produces: ["result"], requires: ["x", "y"] },
      }),
      goals: { done: { when: () => true } },
    });

    const plan = engine.plan("done", ["input"]);

    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0]!.agents).toContain("a");
    expect(plan.steps[0]!.agents).toContain("b");
    expect(plan.steps[1]!.agents).toEqual(["merger"]);
    expect(plan.feasible).toBe(true);
  });

  it("detects unreachable agents", () => {
    const engine = createGoalEngine({
      runner: mockRunner({}),
      agents: makeAgents({
        a: { produces: ["x"], requires: [] },
        b: { produces: ["y"], requires: ["missing_fact"] },
      }),
      goals: { done: { when: () => true } },
    });

    const plan = engine.plan("done", []);

    expect(plan.unreachableAgents).toEqual(["b"]);
    expect(plan.feasible).toBe(false);
  });

  it("identifies external dependencies", () => {
    const engine = createGoalEngine({
      runner: mockRunner({}),
      agents: makeAgents({
        a: { produces: ["x"], requires: ["user_input", "config"] },
      }),
      goals: { done: { when: () => true } },
    });

    const plan = engine.plan("done", ["user_input", "config"]);

    expect(plan.externalDeps).toContain("user_input");
    expect(plan.externalDeps).toContain("config");
    expect(plan.feasible).toBe(true);
  });

  it("throws on unknown goal", () => {
    const engine = createGoalEngine({
      runner: mockRunner({}),
      agents: makeAgents({ a: { produces: ["x"], requires: [] } }),
      goals: { g: { when: () => true } },
    });

    expect(() => engine.plan("nonexistent", [])).toThrow("Unknown goal");
  });

  it("step numbers are 1-based", () => {
    const engine = createGoalEngine({
      runner: mockRunner({}),
      agents: makeAgents({
        a: { produces: ["x"], requires: [] },
      }),
      goals: { done: { when: () => true } },
    });

    const plan = engine.plan("done", []);

    expect(plan.steps[0]!.step).toBe(1);
  });
});
