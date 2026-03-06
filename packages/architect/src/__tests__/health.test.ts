import { describe, it, expect, vi } from "vitest";
import { computeHealthScore, analyzeGraph } from "../health.js";
import type { SystemGraph } from "../types.js";

function mockSystem(overrides: Record<string, unknown> = {}) {
  return {
    inspect: vi.fn(() => ({
      settled: true,
      pendingRequirements: [],
      constraints: [],
      resolvers: [],
      ...overrides,
    })),
  };
}

// ============================================================================
// computeHealthScore
// ============================================================================

describe("computeHealthScore", () => {
  it("returns 100 for a perfectly healthy system", () => {
    const system = mockSystem();
    const result = computeHealthScore(system as never);

    expect(result.score).toBe(100);
    expect(result.breakdown.settled).toBe(25);
    expect(result.breakdown.unmetRequirements).toBe(25);
    expect(result.breakdown.constraintHealth).toBe(25);
    expect(result.breakdown.resolverHealth).toBe(25);
    expect(result.warnings).toHaveLength(0);
  });

  it("returns 0 for a fully unhealthy system", () => {
    const system = mockSystem({
      settled: false,
      pendingRequirements: ["a", "b", "c", "d", "e", "f"],
      constraints: [{ active: false }, { active: false }],
      resolvers: [{ failed: true }, { error: "err" }],
    });

    const result = computeHealthScore(system as never);

    expect(result.score).toBe(0);
    expect(result.breakdown.settled).toBe(0);
    expect(result.breakdown.unmetRequirements).toBe(0);
    expect(result.breakdown.constraintHealth).toBe(0);
    expect(result.breakdown.resolverHealth).toBe(0);
  });

  it("scores partial health correctly", () => {
    const system = mockSystem({
      settled: true,
      pendingRequirements: ["a", "b"],
      constraints: [{ active: true }, { active: false }],
      resolvers: [{ failed: false }, { failed: true }],
    });

    const result = computeHealthScore(system as never);

    expect(result.breakdown.settled).toBe(25);
    expect(result.breakdown.unmetRequirements).toBe(15); // 25 - 2*5
    expect(result.breakdown.constraintHealth).toBe(13); // round(0.5 * 25) = 13
    expect(result.breakdown.resolverHealth).toBe(13); // round(0.5 * 25) = 13
  });

  it("gives full score when no constraints exist", () => {
    const system = mockSystem({ constraints: [] });

    const result = computeHealthScore(system as never);

    expect(result.breakdown.constraintHealth).toBe(25);
  });

  it("gives full score when no resolvers exist", () => {
    const system = mockSystem({ resolvers: [] });

    const result = computeHealthScore(system as never);

    expect(result.breakdown.resolverHealth).toBe(25);
  });

  it("generates warnings for each dimension", () => {
    const system = mockSystem({
      settled: false,
      pendingRequirements: ["a"],
      constraints: [{ active: true }, { active: false }],
      resolvers: [{ failed: true }],
    });

    const result = computeHealthScore(system as never);

    expect(result.warnings.length).toBe(4);
    expect(result.warnings.some((w) => w.includes("settled"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("unmet"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("constraint"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("resolver"))).toBe(true);
  });

  it("clamps unmetRequirements score at 0", () => {
    const system = mockSystem({
      pendingRequirements: Array.from({ length: 10 }, (_, i) => `r${i}`),
    });

    const result = computeHealthScore(system as never);

    expect(result.breakdown.unmetRequirements).toBe(0);
  });
});

// ============================================================================
// analyzeGraph
// ============================================================================

describe("analyzeGraph", () => {
  it("returns empty results for an empty graph", () => {
    const graph: SystemGraph = {
      nodes: [],
      edges: [],
      metadata: { nodeCount: 0, edgeCount: 0, aiNodeCount: 0, extractedAt: Date.now() },
    };

    const result = analyzeGraph(graph);

    expect(result.cycles).toHaveLength(0);
    expect(result.orphanConstraints).toHaveLength(0);
    expect(result.deadResolvers).toHaveLength(0);
  });

  it("returns clean for a well-connected graph", () => {
    const graph: SystemGraph = {
      nodes: [
        { id: "c1", type: "constraint", label: "C1", aiCreated: false },
        { id: "r1", type: "resolver", label: "R1", aiCreated: false },
      ],
      edges: [
        { source: "r1", target: "c1", type: "resolves" },
      ],
      metadata: { nodeCount: 2, edgeCount: 1, aiNodeCount: 0, extractedAt: Date.now() },
    };

    const result = analyzeGraph(graph);

    expect(result.cycles).toHaveLength(0);
    expect(result.orphanConstraints).toHaveLength(0);
    expect(result.deadResolvers).toHaveLength(0);
  });

  it("detects cycles using Tarjan's SCC", () => {
    const graph: SystemGraph = {
      nodes: [
        { id: "a", type: "constraint", label: "A", aiCreated: false },
        { id: "b", type: "resolver", label: "B", aiCreated: false },
      ],
      edges: [
        { source: "a", target: "b", type: "depends-on" },
        { source: "b", target: "a", type: "depends-on" },
      ],
      metadata: { nodeCount: 2, edgeCount: 2, aiNodeCount: 0, extractedAt: Date.now() },
    };

    const result = analyzeGraph(graph);

    expect(result.cycles.length).toBeGreaterThan(0);
    const cycleNodeIds = result.cycles[0]!;
    expect(cycleNodeIds).toContain("a");
    expect(cycleNodeIds).toContain("b");
  });

  it("detects orphan constraints", () => {
    const graph: SystemGraph = {
      nodes: [
        { id: "c1", type: "constraint", label: "C1", aiCreated: false },
        { id: "c2", type: "constraint", label: "C2", aiCreated: false },
        { id: "r1", type: "resolver", label: "R1", aiCreated: false },
      ],
      edges: [
        { source: "r1", target: "c1", type: "resolves" },
      ],
      metadata: { nodeCount: 3, edgeCount: 1, aiNodeCount: 0, extractedAt: Date.now() },
    };

    const result = analyzeGraph(graph);

    expect(result.orphanConstraints).toEqual(["c2"]);
  });

  it("detects dead resolvers", () => {
    const graph: SystemGraph = {
      nodes: [
        { id: "c1", type: "constraint", label: "C1", aiCreated: false },
        { id: "r1", type: "resolver", label: "R1", aiCreated: false },
        { id: "r2", type: "resolver", label: "R2", aiCreated: false },
      ],
      edges: [
        { source: "r1", target: "c1", type: "resolves" },
      ],
      metadata: { nodeCount: 3, edgeCount: 1, aiNodeCount: 0, extractedAt: Date.now() },
    };

    const result = analyzeGraph(graph);

    expect(result.deadResolvers).toEqual(["r2"]);
  });
});
