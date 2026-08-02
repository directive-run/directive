import { describe, expect, it, vi } from "vitest";
import {
  BudgetExceededError,
  UnpricedCallLimitError,
  withBudget,
} from "../budget.js";
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
// Config Validation
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
// Callback Isolation
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
// BudgetRunner type
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

// ============================================================================
// Calls that reach the provider and then throw
// ============================================================================

/** $1 per token in either direction, so cost reads as a token count. */
const DOLLAR_PER_TOKEN = {
  inputPerMillion: 1_000_000,
  outputPerMillion: 1_000_000,
};

describe("withBudget – a call that throws after reaching the provider", () => {
  it("charges what the provider delivered before it failed", async () => {
    // A marker-stripping gateway: the response is generated, delivered and
    // billed, and the throw comes afterwards.
    const inner = vi.fn(async (_agent, _input, options) => {
      await options?.onToken?.("y".repeat(400));

      throw new Error("stream ended without a completion marker");
    }) as unknown as AgentRunner;
    const runner = withBudget(inner, {
      budgets: [{ window: "hour", maxCost: 1000, pricing: DOLLAR_PER_TOKEN }],
    });

    await expect(
      runner(mockAgent(), "x".repeat(40), { onToken: () => {} }),
    ).rejects.toThrow("completion marker");

    // 10 input tokens plus the 100 tokens of text that actually arrived.
    expect(runner.getSpent("hour")).toBeCloseTo(110, 5);
    expect(runner.getUnpricedCallCount()).toBe(1);
  });

  it("charges nothing for a failure that delivered nothing", async () => {
    // A DNS failure, a refused connection, a throw before dispatch: no bytes,
    // no observation, no charge. Charging these at a declared ceiling locked a
    // spend guard for an hour over an outage that cost nothing.
    const inner = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    }) as unknown as AgentRunner;
    const runner = withBudget(inner, {
      budgets: [{ window: "hour", maxCost: 20, pricing: DOLLAR_PER_TOKEN }],
    });

    for (let i = 0; i < 10; i++) {
      await expect(runner(mockAgent(), "Hi")).rejects.toThrow("ENOTFOUND");
    }

    expect(runner.getSpent("hour")).toBe(0);
    // Unknowable rather than free: still counted, so `maxUnpricedCalls` sees
    // them and a reader can tell the ledger has stopped measuring.
    expect(runner.getUnpricedCallCount()).toBe(10);
    expect(inner).toHaveBeenCalledTimes(10);
  });

  it("refuses on the unpriced-call limit rather than on unspent budget", async () => {
    const inner = vi.fn(async () => {
      throw new Error("boom");
    }) as unknown as AgentRunner;
    const runner = withBudget(inner, {
      budgets: [{ window: "hour", maxCost: 20, pricing: DOLLAR_PER_TOKEN }],
      maxUnpricedCalls: 3,
    });

    for (let i = 0; i < 3; i++) {
      await expect(runner(mockAgent(), "Hi")).rejects.toThrow("boom");
    }
    await expect(runner(mockAgent(), "Hi")).rejects.toThrow(
      UnpricedCallLimitError,
    );

    expect(inner).toHaveBeenCalledTimes(3);
  });

  it("does not charge for a call a nested budget refused to dispatch", async () => {
    const inner = makeRunner();
    // The inner budget refuses everything; nothing ever reaches a provider.
    const nested = withBudget(inner, {
      maxCostPerCall: 0,
      pricing: DOLLAR_PER_TOKEN,
    });
    const runner = withBudget(nested, {
      budgets: [{ window: "hour", maxCost: 100, pricing: DOLLAR_PER_TOKEN }],
    });

    await expect(runner(mockAgent(), "hello")).rejects.toThrow(
      BudgetExceededError,
    );

    expect(runner.getSpent("hour")).toBe(0);
    expect(runner.getUnpricedCallCount()).toBe(0);
  });

  it("does not charge or count a nested unpriced-call refusal", async () => {
    // The nested budget stops dispatching after one unpriced call. Its refusal
    // makes no HTTP request, so the outer ledger owes nothing for it – and
    // charging it cascaded the inner lockout outward.
    const inner = vi.fn(async () => {
      throw new Error("boom");
    }) as unknown as AgentRunner;
    const nested = withBudget(inner, { maxUnpricedCalls: 1 });
    const runner = withBudget(nested, {
      budgets: [{ window: "hour", maxCost: 100, pricing: DOLLAR_PER_TOKEN }],
    });

    await expect(runner(mockAgent(), "hello")).rejects.toThrow("boom");
    for (let i = 0; i < 20; i++) {
      await expect(runner(mockAgent(), "hello")).rejects.toThrow(
        UnpricedCallLimitError,
      );
    }

    expect(runner.getSpent("hour")).toBe(0);
    // One real dispatch that delivered nothing; twenty refusals that did not.
    expect(runner.getUnpricedCallCount()).toBe(1);
  });

  it("counts unpriced calls over a window rather than for the life of the runner", async () => {
    vi.useFakeTimers();
    try {
      const inner = vi.fn(async () => {
        throw new Error("boom");
      }) as unknown as AgentRunner;
      const runner = withBudget(inner, {
        budgets: [{ window: "hour", maxCost: 100, pricing: DOLLAR_PER_TOKEN }],
        maxUnpricedCalls: 2,
      });

      await expect(runner(mockAgent(), "Hi")).rejects.toThrow("boom");
      await expect(runner(mockAgent(), "Hi")).rejects.toThrow("boom");
      await expect(runner(mockAgent(), "Hi")).rejects.toThrow(
        UnpricedCallLimitError,
      );

      // The outage ends and its failures age out of the window.
      vi.advanceTimersByTime(60 * 60 * 1000 + 1);
      expect(runner.getUnpricedCallCount()).toBe(0);
      await expect(runner(mockAgent(), "Hi")).rejects.toThrow("boom");
    } finally {
      vi.useRealTimers();
    }
  });
});

// ============================================================================
// What the estimate is made of
// ============================================================================

describe("withBudget – estimating a call the provider did not count", () => {
  function unreportedRunner(output: string): AgentRunner {
    return vi.fn(async () => ({
      output,
      messages: [{ role: "assistant" as const, content: output }],
      toolCalls: [],
      totalTokens: 0,
      tokenUsage: { inputTokens: 0, outputTokens: 0 },
      usageReported: false,
    })) as unknown as AgentRunner;
  }

  it("measures the output it has, rather than scaling the input", async () => {
    // The shape that over-charged: a large retrieval prompt, a short answer.
    const input = "x".repeat(4_000); // 1000 input tokens
    const output = "y".repeat(40); // 10 output tokens
    const runner = withBudget(unreportedRunner(output), {
      budgets: [{ window: "hour", maxCost: 10_000, pricing: DOLLAR_PER_TOKEN }],
    });

    await runner(mockAgent(), input);

    // 1000 in + 10 out. Scaling output from input would have charged 2000.
    expect(runner.getSpent("hour")).toBeCloseTo(1010, 5);
  });

  it("charges nothing when the call produced nothing", async () => {
    const inner = vi.fn(async () => {
      throw new Error("connection reset");
    }) as unknown as AgentRunner;
    const runner = withBudget(inner, {
      budgets: [{ window: "hour", maxCost: 10_000, pricing: DOLLAR_PER_TOKEN }],
    });
    // A declared ceiling used to be charged here, so a failure that cost
    // nothing recorded four thousand dollars against the window.
    const agent = { ...mockAgent(), maxTokens: 4096 };

    await expect(runner(agent, "Hi")).rejects.toThrow("connection reset");

    expect(runner.getSpent("hour")).toBe(0);
    expect(runner.getUnpricedCallCount()).toBe(1);
  });

  it("ignores a declared ceiling when admitting a call", async () => {
    const inner = makeRunner();
    const runner = withBudget(inner, {
      maxCostPerCall: 0.05,
      pricing: DOLLAR_PER_TOKEN,
    });
    // `maxTokens: 1` shrank the pre-call estimate to $1.000001 and bought
    // admission for a call that then cost eighteen dollars. The field is
    // written by the caller being limited, so nothing here reads it.
    const agent = { ...mockAgent(), maxTokens: 1 };

    await expect(runner(agent, "x".repeat(400))).rejects.toThrow(
      BudgetExceededError,
    );
    expect(inner).not.toHaveBeenCalled();
  });

  it("scales the pre-call estimate from the multiplier the budget declares", async () => {
    const inner = makeRunner();
    // The retrieval shape – a large prompt, a short answer – is described by
    // the budget's own multiplier, which the spender does not write.
    const runner = withBudget(inner, {
      maxCostPerCall: 150,
      pricing: DOLLAR_PER_TOKEN,
      estimatedOutputMultiplier: 0.05,
    });

    await runner(mockAgent(), "x".repeat(400));

    expect(inner).toHaveBeenCalledOnce();
  });

  it("charges a long answer from the answer, not from the prompt that asked for it", async () => {
    // The pre-call estimate cannot know a one-line prompt will be answered at
    // length. The charge is made from what came back, so the window accrues
    // the real figure and the next call is checked against it.
    const runner = withBudget(unreportedRunner("y".repeat(16_384)), {
      budgets: [{ window: "hour", maxCost: 10_000, pricing: DOLLAR_PER_TOKEN }],
    });

    await runner(mockAgent(), "Hi");

    // 1 in + 4096 out, measured off the text that arrived.
    expect(runner.getSpent("hour")).toBeCloseTo(4097, 5);
  });

  it("scales the input when there is nothing else to go on, pre-call", async () => {
    const inner = makeRunner();
    const runner = withBudget(inner, {
      maxCostPerCall: 25,
      pricing: DOLLAR_PER_TOKEN,
      estimatedOutputMultiplier: 2,
    });

    // 10 in + 20 out estimated: $30 against a $25 ceiling.
    await expect(runner(mockAgent(), "x".repeat(40))).rejects.toThrow(
      BudgetExceededError,
    );
  });
});

// ============================================================================
// The unpriced-call ceiling
// ============================================================================

describe("withBudget – maxUnpricedCalls", () => {
  function unpriceableRunner(): AgentRunner {
    return vi.fn(async () => ({
      output: "hi",
      messages: [{ role: "assistant" as const, content: "hi" }],
      toolCalls: [],
      totalTokens: 0,
      tokenUsage: { inputTokens: 0, outputTokens: 0 },
      usageReported: false,
    })) as unknown as AgentRunner;
  }

  it("refuses further calls once the tolerance is reached", async () => {
    const inner = unpriceableRunner();
    const runner = withBudget(inner, {
      budgets: [{ window: "hour", maxCost: 1_000_000, pricing: PRICING }],
      maxUnpricedCalls: 3,
    });

    for (let i = 0; i < 3; i++) {
      await runner(mockAgent(), "Hi");
    }

    await expect(runner(mockAgent(), "Hi")).rejects.toThrow(
      UnpricedCallLimitError,
    );
    expect(inner).toHaveBeenCalledTimes(3);
  });

  it("is off by default, leaving the count advisory", async () => {
    const inner = unpriceableRunner();
    const runner = withBudget(inner, {
      budgets: [{ window: "hour", maxCost: 1_000_000, pricing: PRICING }],
    });

    for (let i = 0; i < 50; i++) {
      await runner(mockAgent(), "Hi");
    }

    expect(runner.getUnpricedCallCount()).toBe(50);
  });

  it("never triggers when the provider reports usage", async () => {
    const inner = makeRunner();
    const runner = withBudget(inner, {
      budgets: [{ window: "hour", maxCost: 1_000_000, pricing: PRICING }],
      maxUnpricedCalls: 1,
    });

    for (let i = 0; i < 10; i++) {
      await runner(mockAgent(), "Hi");
    }

    expect(runner.getUnpricedCallCount()).toBe(0);
  });

  it("rejects a negative tolerance at construction", () => {
    expect(() => withBudget(makeRunner(), { maxUnpricedCalls: -1 })).toThrow(
      "maxUnpricedCalls",
    );
  });
});
