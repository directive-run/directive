import { describe, it, expect } from "vitest";
import { createWhatIfAnalysis } from "../what-if.js";
import { createTestSystem } from "../testing.js";
import type { ArchitectAction } from "../types.js";

function makeAction(overrides: Partial<ArchitectAction> = {}): ArchitectAction {
  return {
    id: "test-action",
    tool: "set_fact",
    arguments: { key: "status", value: '"active"' },
    reasoning: {
      trigger: "demand",
      observation: "test",
      justification: "test",
      expectedOutcome: "test",
      raw: "",
    },
    confidence: 0.8,
    risk: "low",
    requiresApproval: false,
    approvalStatus: "approved",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("what-if cascade simulation", () => {
  it("cascadeSteps: 1 produces no cascade (backward compat)", async () => {
    const system = createTestSystem({ phase: "running" });

    const result = await createWhatIfAnalysis(
      system as any,
      makeAction(),
      undefined,
      { cascadeSteps: 1 },
    );

    expect(result.cascade).toBeUndefined();
    expect(result.steps.length).toBeGreaterThan(0);
  });

  it("cascadeSteps defaults to 1 (no cascade)", async () => {
    const system = createTestSystem({ phase: "running" });

    const result = await createWhatIfAnalysis(
      system as any,
      makeAction(),
    );

    expect(result.cascade).toBeUndefined();
  });

  it("cascade with cascadeSteps > 1 produces cascade result", async () => {
    const system = createTestSystem({ phase: "running" });

    const result = await createWhatIfAnalysis(
      system as any,
      makeAction(),
      undefined,
      { cascadeSteps: 3 },
    );

    expect(result.cascade).toBeDefined();
    expect(result.cascade!.rounds.length).toBeGreaterThan(0);
    expect(result.cascade!.finalFacts).toBeDefined();
    expect(typeof result.cascade!.totalConstraintsFired).toBe("number");
    expect(typeof result.cascade!.totalResolversActivated).toBe("number");
    expect(typeof result.cascade!.settled).toBe("boolean");
  });

  it("settled is true when no constraints fire", async () => {
    const system = createTestSystem({ phase: "running" });

    // set_fact on a test system with no dynamic constraints
    // should settle immediately (no constraints to fire)
    const result = await createWhatIfAnalysis(
      system as any,
      makeAction(),
      undefined,
      { cascadeSteps: 3 },
    );

    expect(result.cascade!.settled).toBe(true);
    expect(result.cascade!.totalConstraintsFired).toBe(0);
  });

  it("respects max cascadeSteps (clamped to 5)", async () => {
    const system = createTestSystem({ phase: "running" });

    const result = await createWhatIfAnalysis(
      system as any,
      makeAction(),
      undefined,
      { cascadeSteps: 100 }, // Will be clamped to 5
    );

    expect(result.cascade).toBeDefined();
    // Should not have more than 5 rounds
    expect(result.cascade!.rounds.length).toBeLessThanOrEqual(5);
  });

  it("deep-clone isolation: original system facts unchanged", async () => {
    const system = createTestSystem({ phase: "running" });
    const originalPhase = system.facts.phase;

    await createWhatIfAnalysis(
      system as any,
      makeAction({ arguments: { key: "phase", value: '"destroyed"' } }),
      undefined,
      { cascadeSteps: 3 },
    );

    // Original facts should be untouched
    expect(system.facts.phase).toBe(originalPhase);
  });

  it("riskScore increases with cascade (vs static analysis)", async () => {
    const system = createTestSystem({ phase: "running" });

    const staticResult = await createWhatIfAnalysis(
      system as any,
      makeAction(),
      undefined,
      { cascadeSteps: 1 },
    );

    const cascadeResult = await createWhatIfAnalysis(
      system as any,
      makeAction(),
      undefined,
      { cascadeSteps: 3 },
    );

    // Cascade adds risk from rounds (even empty ones count as round risk)
    expect(cascadeResult.riskScore).toBeGreaterThanOrEqual(staticResult.riskScore);
  });

  it("empty cascade round (no constraints fire) has correct structure", async () => {
    const system = createTestSystem({ phase: "running" });

    const result = await createWhatIfAnalysis(
      system as any,
      makeAction(),
      undefined,
      { cascadeSteps: 2 },
    );

    expect(result.cascade!.rounds.length).toBeGreaterThan(0);

    const round = result.cascade!.rounds[0]!;
    expect(round.round).toBe(1);
    expect(round.factsSnapshot).toBeDefined();
    expect(Array.isArray(round.constraintsFired)).toBe(true);
    expect(Array.isArray(round.resolversActivated)).toBe(true);
    expect(Array.isArray(round.factChanges)).toBe(true);
  });

  it("cascade with observe_system action still works", async () => {
    const system = createTestSystem({ phase: "running" });

    const result = await createWhatIfAnalysis(
      system as any,
      makeAction({ tool: "observe_system", arguments: {} }),
      undefined,
      { cascadeSteps: 2 },
    );

    expect(result.cascade).toBeDefined();
    expect(result.cascade!.settled).toBe(true);
  });

  it("cascade with create_constraint action works", async () => {
    const system = createTestSystem({ phase: "running" });

    const result = await createWhatIfAnalysis(
      system as any,
      makeAction({
        tool: "create_constraint",
        arguments: {
          id: "test-constraint",
          whenCode: 'facts.phase === "running"',
          require: { type: "TEST_REQ" },
        },
      }),
      undefined,
      { cascadeSteps: 2 },
    );

    expect(result.cascade).toBeDefined();
    expect(result.steps.length).toBeGreaterThan(0);
  });

  it("respects simulation timeout", async () => {
    const system = createTestSystem({ phase: "running" });

    // Very short timeout — should complete without error
    const result = await createWhatIfAnalysis(
      system as any,
      makeAction(),
      undefined,
      { cascadeSteps: 5, simulationTimeout: 1 },
    );

    expect(result.cascade).toBeDefined();
    // May have fewer rounds due to timeout
    expect(result.cascade!.rounds.length).toBeLessThanOrEqual(5);
  });

  it("cascade finalFacts reflects accumulated changes", async () => {
    const system = createTestSystem({ phase: "running" });

    const result = await createWhatIfAnalysis(
      system as any,
      makeAction({ arguments: { key: "newFact", value: "42" } }),
      undefined,
      { cascadeSteps: 2 },
    );

    // finalFacts should include the set_fact change
    expect(result.cascade!.finalFacts.newFact).toBe(42);
  });
});
