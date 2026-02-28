import { describe, it, expect } from "vitest";
import {
  validateGoal,
  planGoal,
  getDependencyGraph,
  explainGoal,
} from "../goal-utils.js";
import type { GoalResult, RelaxationRecord } from "../types.js";

// ============================================================================
// Helper: build a minimal GoalResult for explainGoal tests
// ============================================================================

function makeGoalResult(overrides: Partial<GoalResult> = {}): GoalResult {
  return {
    achieved: true,
    result: {},
    facts: {},
    executionOrder: ["a"],
    nodeResults: {},
    steps: 1,
    totalTokens: 100,
    durationMs: 500,
    stepMetrics: [
      {
        step: 1,
        nodesRun: ["a"],
        satisfaction: 1.0,
        satisfactionDelta: 1.0,
        tokensConsumed: 100,
        durationMs: 500,
        factsProduced: ["data"],
      },
    ],
    relaxations: [],
    ...overrides,
  };
}

// ============================================================================
// validateGoal
// ============================================================================

describe("validateGoal", () => {
  it("valid linear chain", () => {
    const result = validateGoal({
      fetcher: { produces: ["data"], requires: [] },
      analyzer: { produces: ["analysis"], requires: ["data"] },
      reporter: { produces: ["report"], requires: ["analysis"] },
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("empty agents → error", () => {
    const result = validateGoal({});

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("No agents declared");
  });

  it("circular dependency → error", () => {
    const result = validateGoal({
      a: { produces: ["x"], requires: ["y"] },
      b: { produces: ["y"], requires: ["x"] },
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Circular dependency"))).toBe(true);
  });

  it("duplicate producer → error", () => {
    const result = validateGoal({
      a: { produces: ["data"] },
      b: { produces: ["data"] },
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("produced by both"))).toBe(true);
  });

  it("agent with no produces → warning", () => {
    const result = validateGoal({
      watcher: { produces: [], requires: [] },
      worker: { produces: ["output"] },
    });

    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("no produces"))).toBe(true);
  });

  it("requires key that no agent produces → warning", () => {
    const result = validateGoal({
      analyzer: { produces: ["analysis"], requires: ["external-data"] },
    });

    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("no agent produces"))).toBe(true);
  });

  it("diamond pattern is valid (no false cycle)", () => {
    const result = validateGoal({
      source: { produces: ["raw"] },
      left: { produces: ["left-result"], requires: ["raw"] },
      right: { produces: ["right-result"], requires: ["raw"] },
      merge: { produces: ["final"], requires: ["left-result", "right-result"] },
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// ============================================================================
// planGoal
// ============================================================================

describe("planGoal", () => {
  it("linear chain produces 3 sequential steps", () => {
    const plan = planGoal({
      fetcher: { produces: ["data"] },
      analyzer: { produces: ["analysis"], requires: ["data"] },
      reporter: { produces: ["report"], requires: ["analysis"] },
    });

    expect(plan.feasible).toBe(true);
    expect(plan.unreachableAgents).toHaveLength(0);
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[0]!.agents).toEqual(["fetcher"]);
    expect(plan.steps[1]!.agents).toEqual(["analyzer"]);
    expect(plan.steps[2]!.agents).toEqual(["reporter"]);
  });

  it("parallel agents run in same step", () => {
    const plan = planGoal({
      a: { produces: ["x"] },
      b: { produces: ["y"] },
      c: { produces: ["z"], requires: ["x", "y"] },
    });

    expect(plan.feasible).toBe(true);
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0]!.agents).toContain("a");
    expect(plan.steps[0]!.agents).toContain("b");
    expect(plan.steps[1]!.agents).toEqual(["c"]);
  });

  it("initial facts unlock dependent agents immediately", () => {
    const plan = planGoal(
      {
        analyzer: { produces: ["analysis"], requires: ["data"] },
      },
      ["data"],
    );

    expect(plan.feasible).toBe(true);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]!.agents).toEqual(["analyzer"]);
  });

  it("unreachable agents with missing external deps", () => {
    const plan = planGoal({
      analyzer: { produces: ["analysis"], requires: ["missing-data"] },
    });

    expect(plan.feasible).toBe(false);
    expect(plan.unreachableAgents).toEqual(["analyzer"]);
    expect(plan.externalDeps).toContain("missing-data");
  });

  it("diamond pattern produces correct steps", () => {
    const plan = planGoal({
      source: { produces: ["raw"] },
      left: { produces: ["left-result"], requires: ["raw"] },
      right: { produces: ["right-result"], requires: ["raw"] },
      merge: { produces: ["final"], requires: ["left-result", "right-result"] },
    });

    expect(plan.feasible).toBe(true);
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[0]!.agents).toEqual(["source"]);
    expect(plan.steps[1]!.agents).toContain("left");
    expect(plan.steps[1]!.agents).toContain("right");
    expect(plan.steps[2]!.agents).toEqual(["merge"]);
  });

  it("respects maxSteps limit", () => {
    // 3-step chain but maxSteps=2 → only 2 steps run
    const plan = planGoal(
      {
        a: { produces: ["x"] },
        b: { produces: ["y"], requires: ["x"] },
        c: { produces: ["z"], requires: ["y"] },
      },
      [],
      2,
    );

    expect(plan.steps).toHaveLength(2);
    expect(plan.unreachableAgents).toEqual(["c"]);
    expect(plan.feasible).toBe(false);
  });

  it("producedFacts tracks new facts per step", () => {
    const plan = planGoal({
      a: { produces: ["x", "y"] },
      b: { produces: ["z"], requires: ["x"] },
    });

    expect(plan.steps[0]!.producedFacts).toContain("x");
    expect(plan.steps[0]!.producedFacts).toContain("y");
    expect(plan.steps[1]!.producedFacts).toEqual(["z"]);
  });
});

// ============================================================================
// getDependencyGraph
// ============================================================================

describe("getDependencyGraph", () => {
  it("returns topological order, roots, leaves, edges", () => {
    const graph = getDependencyGraph({
      fetcher: { produces: ["data"], requires: [] },
      analyzer: { produces: ["analysis"], requires: ["data"] },
      reporter: { produces: ["report"], requires: ["analysis"] },
    });

    expect(graph.order).toEqual(["fetcher", "analyzer", "reporter"]);
    expect(graph.roots).toEqual(["fetcher"]);
    expect(graph.leaves).toEqual(["reporter"]);
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges[0]).toEqual({ from: "fetcher", to: "analyzer", factKey: "data" });
    expect(graph.edges[1]).toEqual({ from: "analyzer", to: "reporter", factKey: "analysis" });
  });

  it("producers map is correct", () => {
    const graph = getDependencyGraph({
      a: { produces: ["x", "y"] },
      b: { produces: ["z"], requires: ["x"] },
    });

    expect(graph.producers.get("x")).toBe("a");
    expect(graph.producers.get("y")).toBe("a");
    expect(graph.producers.get("z")).toBe("b");
  });

  it("throws on circular dependency", () => {
    expect(() =>
      getDependencyGraph({
        a: { produces: ["x"], requires: ["y"] },
        b: { produces: ["y"], requires: ["x"] },
      }),
    ).toThrow("Circular dependency");
  });

  it("throws on duplicate producer", () => {
    expect(() =>
      getDependencyGraph({
        a: { produces: ["data"] },
        b: { produces: ["data"] },
      }),
    ).toThrow("produced by both");
  });

  it("diamond pattern — both branches are leaves when nothing depends on them", () => {
    const graph = getDependencyGraph({
      source: { produces: ["raw"] },
      left: { produces: ["left-result"], requires: ["raw"] },
      right: { produces: ["right-result"], requires: ["raw"] },
    });

    expect(graph.roots).toEqual(["source"]);
    expect(graph.leaves).toContain("left");
    expect(graph.leaves).toContain("right");
    expect(graph.leaves).not.toContain("source");
  });

  it("self-referencing requires are ignored", () => {
    // Agent that produces and requires the same key — edge should not form
    const graph = getDependencyGraph({
      a: { produces: ["x"], requires: ["x"] },
    });

    expect(graph.edges).toHaveLength(0);
    expect(graph.order).toEqual(["a"]);
  });

  it("returns defensive copies (mutations don't affect internal state)", () => {
    const graph = getDependencyGraph({
      a: { produces: ["x"] },
      b: { produces: ["y"], requires: ["x"] },
    });

    // Mutate returned arrays
    graph.order.push("bogus");
    graph.edges.push({ from: "x", to: "y", factKey: "z" });
    graph.roots.push("bogus");
    graph.leaves.push("bogus");
    graph.producers.set("bogus", "bogus");

    // Get fresh graph — should be clean
    const fresh = getDependencyGraph({
      a: { produces: ["x"] },
      b: { produces: ["y"], requires: ["x"] },
    });

    expect(fresh.order).toEqual(["a", "b"]);
    expect(fresh.edges).toHaveLength(1);
    expect(fresh.producers.has("bogus")).toBe(false);
  });
});

// ============================================================================
// explainGoal
// ============================================================================

describe("explainGoal", () => {
  it("basic explanation for achieved goal", () => {
    const explanation = explainGoal(makeGoalResult());

    expect(explanation.achieved).toBe(true);
    expect(explanation.summary).toContain("Goal achieved");
    expect(explanation.summary).toContain("1 step");
    expect(explanation.summary).toContain("100 tokens");
    expect(explanation.steps).toHaveLength(1);
    expect(explanation.steps[0]!.step).toBe(1);
    expect(explanation.steps[0]!.agents).toEqual(["a"]);
    expect(explanation.steps[0]!.satisfaction).toBe(1.0);
    expect(explanation.relaxations).toHaveLength(0);
  });

  it("not-achieved goal", () => {
    const explanation = explainGoal(makeGoalResult({ achieved: false }));

    expect(explanation.achieved).toBe(false);
    expect(explanation.summary).toContain("Goal not achieved");
  });

  it("handles 0 steps gracefully", () => {
    const explanation = explainGoal(
      makeGoalResult({
        steps: 0,
        stepMetrics: [],
        totalTokens: 0,
        durationMs: 0,
      }),
    );

    expect(explanation.steps).toHaveLength(0);
    expect(explanation.summary).toContain("0 step");
  });

  it("NaN satisfaction clamped to 0", () => {
    const explanation = explainGoal(
      makeGoalResult({
        stepMetrics: [
          {
            step: 1,
            nodesRun: ["a"],
            satisfaction: NaN,
            satisfactionDelta: NaN,
            tokensConsumed: 0,
            durationMs: 0,
            factsProduced: [],
          },
        ],
      }),
    );

    expect(explanation.steps[0]!.satisfaction).toBe(0);
    expect(explanation.steps[0]!.satisfactionDelta).toBe(0);
  });

  it("Infinity satisfaction clamped to 0", () => {
    const explanation = explainGoal(
      makeGoalResult({
        stepMetrics: [
          {
            step: 1,
            nodesRun: ["a"],
            satisfaction: Infinity,
            satisfactionDelta: -Infinity,
            tokensConsumed: 0,
            durationMs: 0,
            factsProduced: [],
          },
        ],
      }),
    );

    expect(explanation.steps[0]!.satisfaction).toBe(0);
    expect(explanation.steps[0]!.satisfactionDelta).toBe(0);
  });

  it("includes all 5 relaxation strategy descriptions", () => {
    const strategies: Array<RelaxationRecord["strategy"]> = [
      "allow_rerun",
      "inject_facts",
      "accept_partial",
      "alternative_nodes",
      "custom",
    ];

    const relaxations: RelaxationRecord[] = strategies.map((strategy, i) => ({
      step: i + 1,
      tierIndex: 0,
      label: `tier-${i}`,
      strategy,
    }));

    const explanation = explainGoal(
      makeGoalResult({ relaxations }),
    );

    expect(explanation.relaxations).toHaveLength(5);
    expect(explanation.relaxations[0]!.description).toContain("re-enabled completed nodes");
    expect(explanation.relaxations[1]!.description).toContain("injected fact values");
    expect(explanation.relaxations[2]!.description).toContain("accepted current facts");
    expect(explanation.relaxations[3]!.description).toContain("alternative nodes");
    expect(explanation.relaxations[4]!.description).toContain("custom recovery logic");
    expect(explanation.summary).toContain("5 relaxation(s) applied");
  });

  it("includes error note in summary", () => {
    const explanation = explainGoal(
      makeGoalResult({
        achieved: false,
        error: "Timeout exceeded",
      }),
    );

    expect(explanation.summary).toContain("Error: Timeout exceeded");
  });

  it("step description includes agent names and facts produced", () => {
    const explanation = explainGoal(
      makeGoalResult({
        stepMetrics: [
          {
            step: 1,
            nodesRun: ["fetcher", "analyzer"],
            satisfaction: 0.5,
            satisfactionDelta: 0.5,
            tokensConsumed: 200,
            durationMs: 1000,
            factsProduced: ["data", "analysis"],
          },
        ],
      }),
    );

    const desc = explanation.steps[0]!.description;

    expect(desc).toContain("fetcher, analyzer");
    expect(desc).toContain("data, analysis");
    expect(desc).toContain("200 tokens");
    expect(desc).toContain("1000ms");
  });

  it("multi-step satisfaction progression", () => {
    const explanation = explainGoal(
      makeGoalResult({
        steps: 3,
        totalTokens: 300,
        durationMs: 1500,
        stepMetrics: [
          { step: 1, nodesRun: ["a"], satisfaction: 0.3, satisfactionDelta: 0.3, tokensConsumed: 100, durationMs: 500, factsProduced: ["x"] },
          { step: 2, nodesRun: ["b"], satisfaction: 0.7, satisfactionDelta: 0.4, tokensConsumed: 100, durationMs: 500, factsProduced: ["y"] },
          { step: 3, nodesRun: ["c"], satisfaction: 1.0, satisfactionDelta: 0.3, tokensConsumed: 100, durationMs: 500, factsProduced: ["z"] },
        ],
      }),
    );

    expect(explanation.steps).toHaveLength(3);
    expect(explanation.summary).toContain("0.000 → 1.000");
    expect(explanation.totalTokens).toBe(300);
    expect(explanation.durationMs).toBe(1500);
  });
});
