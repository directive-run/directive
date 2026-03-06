import { describe, it, expect, vi } from "vitest";
import { createWhatIfAnalysis } from "../what-if.js";
import type { ArchitectAction } from "../types.js";

function mockSystem(facts: Record<string, unknown> = {}) {
  return {
    facts: { count: 0, status: "idle", ...facts },
    inspect: vi.fn(() => ({ facts: {}, constraints: [], resolvers: [] })),
    constraints: {
      register: vi.fn(),
      unregister: vi.fn(),
      listDynamic: vi.fn(() => []),
    },
    resolvers: {
      register: vi.fn(),
      unregister: vi.fn(),
      listDynamic: vi.fn(() => []),
    },
    effects: {
      register: vi.fn(),
      unregister: vi.fn(),
      listDynamic: vi.fn(() => []),
    },
  };
}

function makeAction(overrides: Partial<ArchitectAction>): ArchitectAction {
  return {
    id: "test-action",
    tool: "observe_system",
    arguments: {},
    reasoning: {
      trigger: "demand",
      observation: "",
      justification: "",
      expectedOutcome: "",
      raw: "",
    },
    confidence: 0.8,
    risk: "low",
    requiresApproval: false,
    approvalStatus: "auto-approved",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("what-if analysis", () => {
  it("analyzes create_constraint — would fire", async () => {
    const system = mockSystem({ count: 10 });

    const action = makeAction({
      tool: "create_constraint",
      arguments: {
        id: "high-count",
        whenCode: "facts.count > 5",
        require: { type: "REDUCE_COUNT" },
      },
    });

    const result = await createWhatIfAnalysis(system as never, action);

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]!.description).toContain("FIRE immediately");
    expect(result.steps[0]!.constraintsFiring).toHaveLength(1);
    expect(result.riskScore).toBeGreaterThan(0);
  });

  it("analyzes create_constraint — would not fire", async () => {
    const system = mockSystem({ count: 1 });

    const action = makeAction({
      tool: "create_constraint",
      arguments: {
        id: "high-count",
        whenCode: "facts.count > 5",
        require: { type: "REDUCE_COUNT" },
      },
    });

    const result = await createWhatIfAnalysis(system as never, action);

    expect(result.steps[0]!.description).toContain("NOT fire");
    expect(result.steps[0]!.constraintsFiring).toHaveLength(0);
  });

  it("analyzes create_resolver — predicts fact changes", async () => {
    const system = mockSystem({ count: 5 });

    const action = makeAction({
      tool: "create_resolver",
      arguments: {
        id: "reset-count",
        requirement: "REDUCE_COUNT",
        resolveCode: "facts.count = 0;",
      },
    });

    const result = await createWhatIfAnalysis(system as never, action);

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]!.factChanges.length).toBeGreaterThan(0);
    expect(result.steps[0]!.factChanges[0]!.key).toBe("count");
    expect(result.steps[0]!.factChanges[0]!.from).toBe(5);
    expect(result.steps[0]!.factChanges[0]!.to).toBe(0);
  });

  it("analyzes set_fact — before/after diff", async () => {
    const system = mockSystem({ status: "idle" });

    const action = makeAction({
      tool: "set_fact",
      arguments: {
        key: "status",
        value: '"active"',
      },
    });

    const result = await createWhatIfAnalysis(system as never, action);

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]!.factChanges).toHaveLength(1);
    expect(result.steps[0]!.factChanges[0]!.from).toBe("idle");
    expect(result.steps[0]!.factChanges[0]!.to).toBe("active");
  });

  it("analyzes set_fact — no-op when same value", async () => {
    const system = mockSystem({ status: "idle" });

    const action = makeAction({
      tool: "set_fact",
      arguments: {
        key: "status",
        value: '"idle"',
      },
    });

    const result = await createWhatIfAnalysis(system as never, action);

    expect(result.steps[0]!.factChanges).toHaveLength(0);
    expect(result.steps[0]!.description).toContain("no-op");
  });

  it("analyzes remove_definition", async () => {
    const system = mockSystem();

    const action = makeAction({
      tool: "remove_definition",
      arguments: {
        type: "constraint",
        id: "old-constraint",
      },
    });

    const result = await createWhatIfAnalysis(system as never, action);

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]!.description).toContain("Remove constraint");
    expect(result.riskScore).toBe(3);
  });

  it("handles unknown tools gracefully", async () => {
    const system = mockSystem();

    const action = makeAction({
      tool: "unknown_tool",
      arguments: {},
    });

    const result = await createWhatIfAnalysis(system as never, action);

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]!.description).toContain("cannot be predicted");
  });

  it("computes risk score", async () => {
    const system = mockSystem({ count: 10 });

    const action = makeAction({
      tool: "create_constraint",
      arguments: {
        id: "test",
        whenCode: "facts.count > 5",
        require: { type: "FIX" },
      },
    });

    const result = await createWhatIfAnalysis(system as never, action);

    // Should fire: constraintsFiring.length * 3 = 3, plus resolver hint
    expect(result.riskScore).toBeGreaterThan(0);
  });

  it("returns correct structure", async () => {
    const system = mockSystem();

    const action = makeAction({
      tool: "observe_system",
    });

    const result = await createWhatIfAnalysis(system as never, action);

    expect(result.action).toBe(action);
    expect(result.steps).toBeDefined();
    expect(typeof result.riskScore).toBe("number");
    expect(result.summary).toBeUndefined(); // No runner provided
  });
});
