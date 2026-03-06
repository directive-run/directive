import { describe, it, expect } from "vitest";
import {
  evaluatePolicies,
  getBlockingViolation,
  requiresApprovalOverride,
  maxConstraintsPerHour,
  protectFactKeys,
  requireApprovalAboveRisk,
} from "../policies.js";
import type { ArchitectPolicy, PolicyContext, ArchitectAction } from "../types.js";

function mockAction(overrides: Partial<ArchitectAction> = {}): ArchitectAction {
  return {
    id: "test-action",
    tool: "create_constraint",
    arguments: {},
    reasoning: { trigger: "demand", observation: "", justification: "", expectedOutcome: "", raw: "" },
    confidence: 0.8,
    risk: "low",
    requiresApproval: false,
    approvalStatus: "auto-approved",
    timestamp: Date.now(),
    ...overrides,
  };
}

function mockContext(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    actionsThisHour: 0,
    constraintsCreated: 0,
    resolversCreated: 0,
    effectsCreated: 0,
    derivationsCreated: 0,
    factKeysModified: [],
    budgetUsedPercent: 0,
    activeDefinitions: 0,
    currentAction: mockAction(),
    ...overrides,
  };
}

// ============================================================================
// evaluatePolicies
// ============================================================================

describe("evaluatePolicies", () => {
  it("returns empty array when no policies", () => {
    const result = evaluatePolicies([], mockContext());

    expect(result).toHaveLength(0);
  });

  it("returns violation for blocking policy", () => {
    const policy: ArchitectPolicy = {
      id: "block-all",
      description: "Block everything",
      when: () => true,
      action: "block",
    };

    const result = evaluatePolicies([policy], mockContext());

    expect(result).toHaveLength(1);
    expect(result[0]!.action).toBe("block");
    expect(result[0]!.policy.id).toBe("block-all");
  });

  it("returns violation for warn policy", () => {
    const policy: ArchitectPolicy = {
      id: "warn-all",
      description: "Warn on everything",
      when: () => true,
      action: "warn",
    };

    const result = evaluatePolicies([policy], mockContext());

    expect(result).toHaveLength(1);
    expect(result[0]!.action).toBe("warn");
  });

  it("returns violation for require-approval policy", () => {
    const policy: ArchitectPolicy = {
      id: "approve-all",
      description: "Require approval",
      when: () => true,
      action: "require-approval",
    };

    const result = evaluatePolicies([policy], mockContext());

    expect(result).toHaveLength(1);
    expect(result[0]!.action).toBe("require-approval");
  });

  it("swallows throwing policies", () => {
    const policies: ArchitectPolicy[] = [
      {
        id: "throwing",
        description: "Throws",
        when: () => { throw new Error("boom"); },
        action: "block",
      },
      {
        id: "normal",
        description: "Normal",
        when: () => true,
        action: "warn",
      },
    ];

    const result = evaluatePolicies(policies, mockContext());

    expect(result).toHaveLength(1);
    expect(result[0]!.policy.id).toBe("normal");
  });

  it("handles multiple violations", () => {
    const policies: ArchitectPolicy[] = [
      { id: "p1", description: "P1", when: () => true, action: "warn" },
      { id: "p2", description: "P2", when: () => false, action: "block" },
      { id: "p3", description: "P3", when: () => true, action: "require-approval" },
    ];

    const result = evaluatePolicies(policies, mockContext());

    expect(result).toHaveLength(2);
    expect(result.map((v) => v.policy.id)).toEqual(["p1", "p3"]);
  });
});

// ============================================================================
// getBlockingViolation / requiresApprovalOverride
// ============================================================================

describe("getBlockingViolation", () => {
  it("returns null when no blocking violations", () => {
    const result = getBlockingViolation([
      { policy: { id: "w", description: "", when: () => true, action: "warn" }, action: "warn" },
    ]);

    expect(result).toBeNull();
  });

  it("returns first blocking violation", () => {
    const result = getBlockingViolation([
      { policy: { id: "b", description: "", when: () => true, action: "block" }, action: "block" },
    ]);

    expect(result).not.toBeNull();
    expect(result!.policy.id).toBe("b");
  });
});

describe("requiresApprovalOverride", () => {
  it("returns false when no require-approval violations", () => {
    expect(requiresApprovalOverride([])).toBe(false);
  });

  it("returns true when require-approval violation exists", () => {
    const result = requiresApprovalOverride([
      { policy: { id: "ra", description: "", when: () => true, action: "require-approval" }, action: "require-approval" },
    ]);

    expect(result).toBe(true);
  });
});

// ============================================================================
// maxConstraintsPerHour
// ============================================================================

describe("maxConstraintsPerHour", () => {
  it("blocks at threshold", () => {
    const policy = maxConstraintsPerHour(3);
    const ctx = mockContext({
      constraintsCreated: 3,
      currentAction: mockAction({ tool: "create_constraint" }),
    });

    expect(policy.when(ctx)).toBe(true);
  });

  it("passes below threshold", () => {
    const policy = maxConstraintsPerHour(3);
    const ctx = mockContext({
      constraintsCreated: 2,
      currentAction: mockAction({ tool: "create_constraint" }),
    });

    expect(policy.when(ctx)).toBe(false);
  });

  it("ignores non-constraint tools", () => {
    const policy = maxConstraintsPerHour(3);
    const ctx = mockContext({
      constraintsCreated: 10,
      currentAction: mockAction({ tool: "create_resolver" }),
    });

    expect(policy.when(ctx)).toBe(false);
  });
});

// ============================================================================
// protectFactKeys
// ============================================================================

describe("protectFactKeys", () => {
  it("matches exact key", () => {
    const policy = protectFactKeys(["secret"]);
    const ctx = mockContext({ factKeysModified: ["secret"] });

    expect(policy.when(ctx)).toBe(true);
  });

  it("matches glob pattern", () => {
    const policy = protectFactKeys(["auth.*"]);
    const ctx = mockContext({ factKeysModified: ["auth.token"] });

    expect(policy.when(ctx)).toBe(true);
  });

  it("does not match non-matching key", () => {
    const policy = protectFactKeys(["auth.*"]);
    const ctx = mockContext({ factKeysModified: ["user.name"] });

    expect(policy.when(ctx)).toBe(false);
  });

  it("returns false with empty factKeysModified", () => {
    const policy = protectFactKeys(["auth.*"]);
    const ctx = mockContext({ factKeysModified: [] });

    expect(policy.when(ctx)).toBe(false);
  });
});

// ============================================================================
// requireApprovalAboveRisk
// ============================================================================

describe("requireApprovalAboveRisk", () => {
  it("requires approval for high risk when threshold is medium", () => {
    const policy = requireApprovalAboveRisk("medium");
    const ctx = mockContext({
      currentAction: mockAction({ risk: "high" }),
    });

    expect(policy.when(ctx)).toBe(true);
  });

  it("does not trigger for medium risk when threshold is medium", () => {
    const policy = requireApprovalAboveRisk("medium");
    const ctx = mockContext({
      currentAction: mockAction({ risk: "medium" }),
    });

    expect(policy.when(ctx)).toBe(false);
  });

  it("requires approval for medium risk when threshold is low", () => {
    const policy = requireApprovalAboveRisk("low");
    const ctx = mockContext({
      currentAction: mockAction({ risk: "medium" }),
    });

    expect(policy.when(ctx)).toBe(true);
  });

  it("does not trigger for low risk when threshold is low", () => {
    const policy = requireApprovalAboveRisk("low");
    const ctx = mockContext({
      currentAction: mockAction({ risk: "low" }),
    });

    expect(policy.when(ctx)).toBe(false);
  });
});
