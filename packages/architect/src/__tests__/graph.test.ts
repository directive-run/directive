import { describe, it, expect, vi } from "vitest";
import { extractSystemGraph } from "../graph.js";

function mockSystem(overrides: Record<string, unknown> = {}) {
  return {
    facts: { count: 0, status: "idle" },
    inspect: vi.fn(() => ({
      facts: { count: 0, status: "idle" },
      constraints: [
        { id: "c1", deps: ["count"], priority: 10, active: true },
        { id: "c2", deps: ["status"], priority: 5, active: false },
      ],
      resolvers: [
        { id: "r1", requirement: "FIX_COUNT" },
        { id: "r2", requirement: "FIX_STATUS" },
      ],
      derivations: [
        { id: "d1", deps: ["count", "status"] },
      ],
      effects: [
        { id: "e1" },
      ],
      ...overrides,
    })),
    constraints: { listDynamic: vi.fn(() => []) },
    resolvers: { listDynamic: vi.fn(() => []) },
    effects: { listDynamic: vi.fn(() => []) },
  };
}

describe("graph", () => {
  it("extracts fact nodes", () => {
    const system = mockSystem();
    const graph = extractSystemGraph(system as never);

    const factNodes = graph.nodes.filter((n) => n.type === "fact");

    expect(factNodes.length).toBeGreaterThanOrEqual(2);
    expect(factNodes.some((n) => n.label === "count")).toBe(true);
    expect(factNodes.some((n) => n.label === "status")).toBe(true);
  });

  it("extracts constraint nodes", () => {
    const system = mockSystem();
    const graph = extractSystemGraph(system as never);

    const constraintNodes = graph.nodes.filter((n) => n.type === "constraint");

    expect(constraintNodes).toHaveLength(2);
    expect(constraintNodes[0]!.label).toBe("c1");
  });

  it("extracts resolver nodes", () => {
    const system = mockSystem();
    const graph = extractSystemGraph(system as never);

    const resolverNodes = graph.nodes.filter((n) => n.type === "resolver");

    expect(resolverNodes).toHaveLength(2);
  });

  it("extracts derivation nodes", () => {
    const system = mockSystem();
    const graph = extractSystemGraph(system as never);

    const derivationNodes = graph.nodes.filter((n) => n.type === "derivation");

    expect(derivationNodes).toHaveLength(1);
    expect(derivationNodes[0]!.label).toBe("d1");
  });

  it("extracts effect nodes", () => {
    const system = mockSystem();
    const graph = extractSystemGraph(system as never);

    const effectNodes = graph.nodes.filter((n) => n.type === "effect");

    expect(effectNodes).toHaveLength(1);
  });

  it("creates depends-on edges for constraints", () => {
    const system = mockSystem();
    const graph = extractSystemGraph(system as never);

    const dependsOn = graph.edges.filter((e) => e.type === "depends-on" && e.source.startsWith("constraint"));

    expect(dependsOn.length).toBeGreaterThanOrEqual(2);
    expect(dependsOn.some((e) => e.target === "fact::count")).toBe(true);
    expect(dependsOn.some((e) => e.target === "fact::status")).toBe(true);
  });

  it("creates resolves edges for resolvers", () => {
    const system = mockSystem();
    const graph = extractSystemGraph(system as never);

    const resolves = graph.edges.filter((e) => e.type === "resolves");

    expect(resolves.length).toBeGreaterThan(0);
  });

  it("marks AI-created nodes", () => {
    const system = mockSystem();
    const dynamicIds = new Set(["constraint::c1", "resolver::r2"]);

    const graph = extractSystemGraph(system as never, { dynamicIds });

    const aiNodes = graph.nodes.filter((n) => n.aiCreated);

    expect(aiNodes).toHaveLength(2);
    expect(aiNodes.some((n) => n.id === "constraint::c1")).toBe(true);
    expect(aiNodes.some((n) => n.id === "resolver::r2")).toBe(true);
  });

  it("computes metadata correctly", () => {
    const system = mockSystem();
    const dynamicIds = new Set(["constraint::c1"]);

    const graph = extractSystemGraph(system as never, { dynamicIds });

    expect(graph.metadata.nodeCount).toBe(graph.nodes.length);
    expect(graph.metadata.edgeCount).toBe(graph.edges.length);
    expect(graph.metadata.aiNodeCount).toBe(1);
    expect(graph.metadata.extractedAt).toBeGreaterThan(0);
  });

  it("excludes facts when includeFacts is false", () => {
    const system = mockSystem();
    const graph = extractSystemGraph(system as never, { includeFacts: false });

    const factNodes = graph.nodes.filter((n) => n.type === "fact");

    expect(factNodes).toHaveLength(0);
  });

  it("excludes derivations when includeDerivations is false", () => {
    const system = mockSystem();
    const graph = extractSystemGraph(system as never, { includeDerivations: false });

    const derivationNodes = graph.nodes.filter((n) => n.type === "derivation");

    expect(derivationNodes).toHaveLength(0);
  });

  it("handles empty system", () => {
    const system = {
      facts: {},
      inspect: vi.fn(() => ({
        facts: {},
        constraints: [],
        resolvers: [],
        derivations: [],
        effects: [],
      })),
    };

    const graph = extractSystemGraph(system as never);

    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });

  it("does not duplicate nodes", () => {
    const system = mockSystem();
    const graph = extractSystemGraph(system as never);

    const ids = graph.nodes.map((n) => n.id);
    const uniqueIds = new Set(ids);

    expect(ids.length).toBe(uniqueIds.size);
  });
});
