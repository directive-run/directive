import { describe, it, expect, vi } from "vitest";
import { exportPattern, importPattern } from "../federation.js";
import type { ArchitectAction } from "../types.js";

function makeAction(overrides: Partial<ArchitectAction> = {}): ArchitectAction {
  return {
    id: "test-action-1",
    tool: "create_constraint",
    arguments: {
      id: "auto-fix",
      whenCode: "facts.count > 5",
      require: { type: "FIX" },
    },
    reasoning: {
      trigger: "error",
      observation: "Count exceeded threshold",
      justification: "Prevent overflow",
      expectedOutcome: "Count stays bounded",
      raw: "",
    },
    confidence: 0.9,
    risk: "low",
    requiresApproval: false,
    approvalStatus: "auto-approved",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("exportPattern", () => {
  it("exports a constraint action as a pattern", () => {
    const action = makeAction();
    const result = exportPattern(action);

    expect(result.success).toBe(true);
    expect(result.pattern.type).toBe("constraint");
    expect(result.pattern.hash).toMatch(/^[0-9a-f]{8}$/);
    expect(result.pattern.effectiveness).toBe(0.5);
    expect(result.pattern.useCount).toBe(0);
  });

  it("anonymizes code in template", () => {
    const action = makeAction({
      arguments: {
        id: "test",
        whenCode: 'facts.userName === "admin" && facts.count > 10',
      },
    });

    const result = exportPattern(action);

    expect(result.pattern.template).not.toContain("userName");
    expect(result.pattern.template).not.toContain("admin");
    expect(result.pattern.template).not.toContain("10");
    expect(result.pattern.template).toContain("$FACT");
    expect(result.pattern.template).toContain("$VALUE");
    expect(result.pattern.template).toContain("$NUM");
  });

  it("uses justification as description", () => {
    const action = makeAction();
    const result = exportPattern(action);

    expect(result.pattern.description).toBe("Prevent overflow");
  });

  it("applies custom tags and effectiveness", () => {
    const action = makeAction();
    const result = exportPattern(action, {
      tags: ["rate-limiting", "protection"],
      effectiveness: 0.95,
    });

    expect(result.pattern.tags).toEqual(["rate-limiting", "protection"]);
    expect(result.pattern.effectiveness).toBe(0.95);
  });

  it("infers type from tool name", () => {
    const resolver = makeAction({ tool: "create_resolver" });
    const result = exportPattern(resolver);

    expect(result.pattern.type).toBe("resolver");
  });

  it("uses definition type when available", () => {
    const action = makeAction({
      definition: { type: "effect", id: "log-it" },
    });
    const result = exportPattern(action);

    expect(result.pattern.type).toBe("effect");
  });

  it("fails for unknown tool types", () => {
    const action = makeAction({ tool: "unknown_tool" });
    const result = exportPattern(action);

    expect(result.success).toBe(false);
  });

  it("produces deterministic hashes", () => {
    const a = makeAction();
    const b = makeAction();

    const hashA = exportPattern(a).pattern.hash;
    const hashB = exportPattern(b).pattern.hash;

    expect(hashA).toBe(hashB);
  });

  it("produces different hashes for different actions", () => {
    const a = makeAction({ arguments: { id: "a", whenCode: "facts.x > 1" } });
    const b = makeAction({ arguments: { id: "b", whenCode: "facts.y < 0" } });

    const hashA = exportPattern(a).pattern.hash;
    const hashB = exportPattern(b).pattern.hash;

    expect(hashA).not.toBe(hashB);
  });

  it("handles resolver actions with resolveCode", () => {
    const action = makeAction({
      tool: "create_resolver",
      arguments: {
        id: "fix-count",
        resolveCode: "facts.count = 0;",
      },
    });

    const result = exportPattern(action);

    expect(result.success).toBe(true);
    expect(result.pattern.template).toContain("resolve:");
    expect(result.pattern.template).toContain("$FACT");
  });
});

describe("importPattern", () => {
  it("imports a pattern via LLM", async () => {
    const mockRunner = vi.fn().mockResolvedValue({
      output: "Adapted constraint for local system",
      toolCalls: [
        {
          name: "create_constraint",
          arguments: JSON.stringify({
            id: "imported-fix",
            whenCode: "facts.localCount > 5",
            require: { type: "FIX" },
          }),
        },
      ],
      totalTokens: 50,
    });

    const mockSystem = {
      facts: { localCount: 0, status: "idle" },
    };

    const pattern = exportPattern(makeAction()).pattern;
    const result = await importPattern(
      pattern,
      mockSystem as never,
      mockRunner as never,
    );

    expect(result.success).toBe(true);
    expect(result.action).toBeDefined();
    expect(result.action!.id).toContain("federated-");
    expect(result.action!.requiresApproval).toBe(true);
    expect(result.action!.approvalStatus).toBe("pending");
  });

  it("fails when LLM returns no tool calls", async () => {
    const mockRunner = vi.fn().mockResolvedValue({
      output: "Cannot adapt this pattern",
      toolCalls: [],
      totalTokens: 20,
    });

    const mockSystem = { facts: {} };
    const pattern = exportPattern(makeAction()).pattern;

    const result = await importPattern(
      pattern,
      mockSystem as never,
      mockRunner as never,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("could not be adapted");
  });

  it("handles LLM errors gracefully", async () => {
    const mockRunner = vi.fn().mockRejectedValue(new Error("LLM failed"));

    const mockSystem = { facts: { x: 1 } };
    const pattern = exportPattern(makeAction()).pattern;

    const result = await importPattern(
      pattern,
      mockSystem as never,
      mockRunner as never,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("LLM failed");
  });

  it("handles invalid tool call arguments", async () => {
    const mockRunner = vi.fn().mockResolvedValue({
      output: "",
      toolCalls: [{ name: "create_constraint", arguments: "not-json{" }],
      totalTokens: 10,
    });

    const mockSystem = { facts: {} };
    const pattern = exportPattern(makeAction()).pattern;

    const result = await importPattern(
      pattern,
      mockSystem as never,
      mockRunner as never,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("parse");
  });

  it("passes local fact keys to LLM prompt", async () => {
    const mockRunner = vi.fn().mockResolvedValue({
      output: "",
      toolCalls: [],
      totalTokens: 10,
    });

    const mockSystem = { facts: { alpha: 1, beta: 2, gamma: 3 } };
    const pattern = exportPattern(makeAction()).pattern;

    await importPattern(pattern, mockSystem as never, mockRunner as never);

    const prompt = mockRunner.mock.calls[0]![1] as string;

    expect(prompt).toContain("alpha");
    expect(prompt).toContain("beta");
    expect(prompt).toContain("gamma");
  });
});
