import { describe, expect, it, vi } from "vitest";
import { BudgetExceededError, withBudget } from "../budget.js";
import type { AgentRunner, RunResult } from "../types.js";

// ============================================================================
// Helpers
// ============================================================================

function mockAgent() {
  return { name: "test-agent", instructions: "Be helpful." };
}

function successResult(inputTokens = 100, outputTokens = 50): RunResult {
  return {
    output: "hello",
    messages: [{ role: "assistant", content: "hello" }],
    toolCalls: [],
    totalTokens: inputTokens + outputTokens,
    tokenUsage: { inputTokens, outputTokens },
  };
}

function makeRunner(result: RunResult = successResult()): AgentRunner {
  return vi.fn(async () => result) as unknown as AgentRunner;
}

const PRICING = { inputPerMillion: 3, outputPerMillion: 15 };

// ============================================================================
// withBudget
// ============================================================================

describe("withBudget", () => {
  it("allows calls within per-call budget", async () => {
    const inner = makeRunner();
    const runner = withBudget(inner, {
      maxCostPerCall: 1.0,
      pricing: PRICING,
    });

    const result = await runner(mockAgent(), "short input");
    expect(result.output).toBe("hello");
    expect(inner).toHaveBeenCalledOnce();
  });

  it("blocks calls exceeding per-call budget", async () => {
    const inner = makeRunner();
    // Very long input to blow the per-call estimate
    const longInput = "x".repeat(40_000_000); // ~10M tokens at 4 chars/token
    const runner = withBudget(inner, {
      maxCostPerCall: 0.001,
      pricing: PRICING,
    });

    await expect(runner(mockAgent(), longInput)).rejects.toThrow(
      BudgetExceededError,
    );
    expect(inner).not.toHaveBeenCalled();
  });

  it("BudgetExceededError has correct properties", async () => {
    const inner = makeRunner();
    const longInput = "x".repeat(40_000_000);
    const runner = withBudget(inner, {
      maxCostPerCall: 0.001,
      pricing: PRICING,
    });

    try {
      await runner(mockAgent(), longInput);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BudgetExceededError);
      const budgetErr = err as BudgetExceededError;
      expect(budgetErr.window).toBe("per-call");
      expect(budgetErr.remaining).toBe(0.001);
      expect(budgetErr.estimated).toBeGreaterThan(0.001);
    }
  });

  it("tracks rolling hourly budget", async () => {
    const inner = makeRunner(successResult(500_000, 500_000)); // 1M tokens total
    const runner = withBudget(inner, {
      budgets: [{ window: "hour", maxCost: 0.05, pricing: PRICING }],
    });

    // First call succeeds
    await runner(mockAgent(), "hello");

    // Second call should fail — first call cost: (500K/1M)*3 + (500K/1M)*15 = $1.50 + $7.50 = $9.00
    await expect(runner(mockAgent(), "hello")).rejects.toThrow(
      BudgetExceededError,
    );
  });

  it("tracks rolling daily budget", async () => {
    const inner = makeRunner(successResult(100_000, 100_000));
    const runner = withBudget(inner, {
      budgets: [{ window: "day", maxCost: 0.01, pricing: PRICING }],
    });

    // First call: cost = (100K/1M)*3 + (100K/1M)*15 = $0.30 + $1.50 = $1.80
    await runner(mockAgent(), "hello");

    // Second call should fail
    await expect(runner(mockAgent(), "hello")).rejects.toThrow(
      BudgetExceededError,
    );
  });

  it("calls onBudgetExceeded callback", async () => {
    const onBudgetExceeded = vi.fn();
    const inner = makeRunner();
    const longInput = "x".repeat(40_000_000);
    const runner = withBudget(inner, {
      maxCostPerCall: 0.001,
      pricing: PRICING,
      onBudgetExceeded,
    });

    await expect(runner(mockAgent(), longInput)).rejects.toThrow(
      BudgetExceededError,
    );
    expect(onBudgetExceeded).toHaveBeenCalledOnce();
    expect(onBudgetExceeded).toHaveBeenCalledWith({
      estimated: expect.any(Number),
      remaining: 0.001,
      window: "per-call",
    });
  });

  it("passes through when no budget limits configured", async () => {
    const inner = makeRunner();
    const runner = withBudget(inner, {});

    const result = await runner(mockAgent(), "hello");
    expect(result.output).toBe("hello");
  });

  it("uses custom charsPerToken", async () => {
    const inner = makeRunner();
    // 100 chars / 2 chars per token = 50 tokens estimated
    const runner = withBudget(inner, {
      maxCostPerCall: 1.0,
      pricing: PRICING,
      charsPerToken: 2,
    });

    const result = await runner(mockAgent(), "x".repeat(100));
    expect(result.output).toBe("hello");
  });

  it("multiple budget windows checked independently", async () => {
    const inner = makeRunner(successResult(1_000_000, 1_000_000));
    const runner = withBudget(inner, {
      budgets: [
        { window: "hour", maxCost: 100, pricing: PRICING },
        { window: "day", maxCost: 0.01, pricing: PRICING },
      ],
    });

    // First call: high cost exceeds daily but not hourly
    await runner(mockAgent(), "hello");

    // Second call: daily budget exceeded
    try {
      await runner(mockAgent(), "hello");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BudgetExceededError);
      expect((err as BudgetExceededError).window).toBe("day");
    }
  });
});

// ============================================================================
// Config Validation (C1)
// ============================================================================

describe("withBudget config validation", () => {
  it("throws on non-positive charsPerToken", () => {
    const inner = makeRunner();
    expect(() => withBudget(inner, { charsPerToken: 0 })).toThrow(
      "charsPerToken must be a positive finite number",
    );
  });

  it("throws on negative charsPerToken", () => {
    const inner = makeRunner();
    expect(() => withBudget(inner, { charsPerToken: -1 })).toThrow(
      "charsPerToken must be a positive finite number",
    );
  });

  it("throws on NaN charsPerToken", () => {
    const inner = makeRunner();
    expect(() => withBudget(inner, { charsPerToken: Number.NaN })).toThrow(
      "charsPerToken must be a positive finite number",
    );
  });

  it("throws on negative maxCostPerCall", () => {
    const inner = makeRunner();
    expect(() =>
      withBudget(inner, { maxCostPerCall: -1, pricing: PRICING }),
    ).toThrow("maxCostPerCall must be a non-negative finite number");
  });

  it("throws on Infinity maxCostPerCall", () => {
    const inner = makeRunner();
    expect(() =>
      withBudget(inner, {
        maxCostPerCall: Number.POSITIVE_INFINITY,
        pricing: PRICING,
      }),
    ).toThrow("maxCostPerCall must be a non-negative finite number");
  });

  it("throws on negative estimatedOutputMultiplier", () => {
    const inner = makeRunner();
    expect(() =>
      withBudget(inner, { estimatedOutputMultiplier: -0.5 }),
    ).toThrow("estimatedOutputMultiplier must be a non-negative finite number");
  });

  it("throws on negative window maxCost", () => {
    const inner = makeRunner();
    expect(() =>
      withBudget(inner, {
        budgets: [{ window: "hour", maxCost: -1, pricing: PRICING }],
      }),
    ).toThrow("maxCost must be a non-negative finite number");
  });

  it("warns when maxCostPerCall set without pricing", () => {
    const inner = makeRunner();
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    withBudget(inner, { maxCostPerCall: 1.0 });
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("maxCostPerCall has no effect without pricing"),
    );
    spy.mockRestore();
  });
});

// ============================================================================
// Callback Isolation (C2)
// ============================================================================

describe("withBudget callback isolation", () => {
  it("throwing onBudgetExceeded does not block budget error", async () => {
    const inner = makeRunner();
    const longInput = "x".repeat(40_000_000);
    const runner = withBudget(inner, {
      maxCostPerCall: 0.001,
      pricing: PRICING,
      onBudgetExceeded: () => {
        throw new Error("callback exploded");
      },
    });

    // Should still throw BudgetExceededError, not the callback error
    await expect(runner(mockAgent(), longInput)).rejects.toThrow(
      BudgetExceededError,
    );
  });
});

// ============================================================================
// BudgetRunner type (C3)
// ============================================================================

describe("BudgetRunner getSpent", () => {
  it("getSpent is accessible on the returned runner", async () => {
    const inner = makeRunner(successResult(100_000, 100_000));
    const runner = withBudget(inner, {
      budgets: [{ window: "hour", maxCost: 100, pricing: PRICING }],
    });

    // getSpent should work directly (no type cast needed at runtime)
    expect(runner.getSpent("hour")).toBe(0);

    await runner(mockAgent(), "hello");

    expect(runner.getSpent("hour")).toBeGreaterThan(0);
  });

  it("getSpent returns 0 for unconfigured windows", () => {
    const inner = makeRunner();
    const runner = withBudget(inner, {
      budgets: [{ window: "hour", maxCost: 100, pricing: PRICING }],
    });

    // "day" is not configured
    expect(runner.getSpent("day")).toBe(0);
  });
});
