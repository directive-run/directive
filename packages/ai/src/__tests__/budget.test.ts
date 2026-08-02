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
      phase: "pre-call",
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

// ============================================================================
// Pricing shape validation
// ============================================================================

describe("withBudget pricing validation", () => {
  // Regression pin. Provider tables export `{ input, output }`; TokenPricing
  // wants `{ inputPerMillion, outputPerMillion }`. Same units, different
  // names — so a mismatched object used to sail through, every cost came out
  // NaN, every `estimated > remaining` compared false, and the budget never
  // tripped. A budget guard that fails open is worse than no guard: spend was
  // unbounded exactly when the caller believed it was capped.
  const PROVIDER_TABLE_ENTRY = { input: 3, output: 15 };

  it("rejects a provider pricing table passed as config pricing", () => {
    const inner = makeRunner();
    expect(() =>
      withBudget(inner, {
        maxCostPerCall: 1,
        pricing: PROVIDER_TABLE_ENTRY as never,
      }),
    ).toThrow("pricing.inputPerMillion must be a finite number");
  });

  it("names the fix when it sees a bare rate pair", () => {
    const inner = makeRunner();
    expect(() =>
      withBudget(inner, {
        maxCostPerCall: 1,
        pricing: PROVIDER_TABLE_ENTRY as never,
      }),
    ).toThrow(/\*_PRICING/);
  });

  it("rejects a provider pricing table passed as budget-window pricing", () => {
    const inner = makeRunner();
    expect(() =>
      withBudget(inner, {
        budgets: [
          {
            window: "day",
            maxCost: 10,
            pricing: PROVIDER_TABLE_ENTRY as never,
          },
        ],
      }),
    ).toThrow("budgets[day].pricing.inputPerMillion must be a finite number");
  });

  it("rejects pricing missing outputPerMillion", () => {
    const inner = makeRunner();
    expect(() =>
      withBudget(inner, {
        maxCostPerCall: 1,
        pricing: { inputPerMillion: 3 } as never,
      }),
    ).toThrow("pricing.outputPerMillion must be a finite number");
  });

  it("rejects NaN rates", () => {
    const inner = makeRunner();
    expect(() =>
      withBudget(inner, {
        maxCostPerCall: 1,
        pricing: { inputPerMillion: Number.NaN, outputPerMillion: 15 },
      }),
    ).toThrow("pricing.inputPerMillion must be a finite number");
  });

  it("accepts a well-formed TokenPricing", () => {
    const inner = makeRunner();
    expect(() =>
      withBudget(inner, {
        maxCostPerCall: 1,
        pricing: PRICING,
        budgets: [{ window: "day", maxCost: 10, pricing: PRICING }],
      }),
    ).not.toThrow();
  });

  it("accepts zero rates (local models bill nothing)", () => {
    const inner = makeRunner();
    expect(() =>
      withBudget(inner, {
        maxCostPerCall: 1,
        pricing: { inputPerMillion: 0, outputPerMillion: 0 },
      }),
    ).not.toThrow();
  });
});

// ============================================================================
// Negative rates
// ============================================================================

describe("withBudget rejects negative pricing rates", () => {
  // `Number.isFinite(-1000)` is true, so a negative rate used to sail through.
  // Every cost then came out negative: `estimated > remaining` was never true,
  // and the window ledger *decreased* on every call. The guard failed open —
  // the exact failure it exists to prevent.
  it("rejects a negative input rate", () => {
    const inner = makeRunner();
    expect(() =>
      withBudget(inner, {
        maxCostPerCall: 1,
        pricing: { inputPerMillion: -1000, outputPerMillion: 15 },
      }),
    ).toThrow("pricing.inputPerMillion must be a non-negative number");
  });

  it("rejects a negative output rate", () => {
    const inner = makeRunner();
    expect(() =>
      withBudget(inner, {
        maxCostPerCall: 1,
        pricing: { inputPerMillion: 3, outputPerMillion: -15 },
      }),
    ).toThrow("pricing.outputPerMillion must be a non-negative number");
  });

  it("rejects a negative rate in a budget window", () => {
    const inner = makeRunner();
    expect(() =>
      withBudget(inner, {
        budgets: [
          {
            window: "day",
            maxCost: 10,
            pricing: { inputPerMillion: -3, outputPerMillion: 15 },
          },
        ],
      }),
    ).toThrow(
      "budgets[day].pricing.inputPerMillion must be a non-negative number",
    );
  });

  it("rejects -0, which is not the same as 0", () => {
    const inner = makeRunner();
    expect(() =>
      withBudget(inner, {
        maxCostPerCall: 1,
        pricing: { inputPerMillion: -0, outputPerMillion: 15 },
      }),
    ).toThrow(/must be a non-negative number \(received -0\)/);
  });

  it("a negative rate can no longer drive the ledger backwards", async () => {
    // Proof that the construction-time throw is load bearing: with the rate
    // accepted, this budget would never trip no matter how much was spent.
    const inner = makeRunner(successResult(1_000_000, 1_000_000));
    expect(() =>
      withBudget(inner, {
        budgets: [
          {
            window: "hour",
            maxCost: 0.01,
            pricing: { inputPerMillion: -3, outputPerMillion: -15 },
          },
        ],
      }),
    ).toThrow(/non-negative/);
  });
});

// ============================================================================
// Pricing is snapshotted, not re-read
// ============================================================================

describe("withBudget snapshots pricing at construction", () => {
  // The validator ran against the caller's live object while the hot path
  // re-read it. Mutating a rate after construction — or supplying a getter or
  // a Proxy — reopened the NaN fail-open the validator exists to close.
  const LONG_INPUT = "x".repeat(40_000_000);

  it("a rate mutated after construction cannot disable the budget", async () => {
    const mutable = { inputPerMillion: 3, outputPerMillion: 15 };
    const runner = withBudget(makeRunner(), {
      maxCostPerCall: 0.001,
      pricing: mutable,
    });

    mutable.inputPerMillion = Number.NaN;
    mutable.outputPerMillion = Number.NaN;

    await expect(runner(mockAgent(), LONG_INPUT)).rejects.toThrow(
      BudgetExceededError,
    );
  });

  it("a rate mutated after construction cannot disable a window budget", async () => {
    const mutable = { inputPerMillion: 3, outputPerMillion: 15 };
    const runner = withBudget(makeRunner(), {
      budgets: [{ window: "hour", maxCost: 0.001, pricing: mutable }],
    });

    mutable.inputPerMillion = Number.NaN;
    mutable.outputPerMillion = Number.NaN;

    await expect(runner(mockAgent(), LONG_INPUT)).rejects.toThrow(
      BudgetExceededError,
    );
  });

  it("a getter that returns a valid rate once is only trusted once", async () => {
    let reads = 0;
    const sneaky = {
      get inputPerMillion() {
        reads++;

        return reads > 2 ? Number.NaN : 3;
      },
      get outputPerMillion() {
        reads++;

        return reads > 2 ? Number.NaN : 15;
      },
    };

    const runner = withBudget(makeRunner(), {
      maxCostPerCall: 0.001,
      pricing: sneaky,
    });

    const readsAfterConstruction = reads;
    await expect(runner(mockAgent(), LONG_INPUT)).rejects.toThrow(
      BudgetExceededError,
    );
    expect(reads).toBe(readsAfterConstruction);
  });

  it("a Proxy cannot inject a rate after validation", async () => {
    let validated = false;
    const proxied = new Proxy(
      { inputPerMillion: 3, outputPerMillion: 15 },
      {
        get(target, prop, receiver) {
          if (validated) {
            return Number.NaN;
          }

          return Reflect.get(target, prop, receiver);
        },
      },
    );

    const runner = withBudget(makeRunner(), {
      maxCostPerCall: 0.001,
      pricing: proxied,
    });
    validated = true;

    await expect(runner(mockAgent(), LONG_INPUT)).rejects.toThrow(
      BudgetExceededError,
    );
  });

  it("a budget cap mutated after construction is not honored", async () => {
    const budget = {
      window: "hour" as const,
      maxCost: 0.001,
      pricing: PRICING,
    };
    const runner = withBudget(makeRunner(), { budgets: [budget] });

    budget.maxCost = Number.POSITIVE_INFINITY;

    await expect(runner(mockAgent(), LONG_INPUT)).rejects.toThrow(
      BudgetExceededError,
    );
  });
});

// ============================================================================
// Provider-reported token usage is validated at ingest
// ============================================================================

describe("withBudget validates result.tokenUsage", () => {
  // `tokenUsage` is whatever the provider put on the result. One non-finite or
  // negative count added to a running total is permanent: every later
  // getSpent() inherits it and no subsequent call washes it out.
  function resultWithUsage(
    inputTokens: number,
    outputTokens: number,
  ): RunResult {
    return {
      output: "hello",
      messages: [],
      toolCalls: [],
      totalTokens: 0,
      tokenUsage: { inputTokens, outputTokens },
    };
  }

  const POISON: [string, number, number][] = [
    ["NaN input", Number.NaN, 50],
    ["NaN output", 100, Number.NaN],
    ["Infinity input", Number.POSITIVE_INFINITY, 50],
    ["negative input", -100, 50],
    ["negative output", 100, -50],
  ];

  for (const [label, inputTokens, outputTokens] of POISON) {
    it(`ignores ${label} instead of poisoning the ledger`, async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const runner = withBudget(
        makeRunner(resultWithUsage(inputTokens, outputTokens)),
        {
          pricing: PRICING,
          budgets: [{ window: "hour", maxCost: 100, pricing: PRICING }],
        },
      );

      await runner(mockAgent(), "hello");

      expect(runner.getSpent("hour")).toBe(0);
      expect(runner.getSpent("total")).toBe(0);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("non-finite or negative token count"),
      );
      warn.mockRestore();
    });
  }

  it("warns once, not once per call", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const runner = withBudget(makeRunner(resultWithUsage(Number.NaN, 50)), {
      pricing: PRICING,
    });

    await runner(mockAgent(), "hello");
    await runner(mockAgent(), "hello");
    await runner(mockAgent(), "hello");

    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("a poisoned call does not stop later good calls from being counted", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let bad = true;
    const inner = vi.fn(async () => {
      const result = bad
        ? resultWithUsage(Number.NaN, 50)
        : resultWithUsage(100_000, 100_000);
      bad = false;

      return result;
    }) as unknown as AgentRunner;

    const runner = withBudget(inner, { pricing: PRICING });

    await runner(mockAgent(), "hello");
    await runner(mockAgent(), "hello");

    // (100K/1M)*3 + (100K/1M)*15 = $1.80 — finite, and exactly the good call.
    expect(runner.getSpent("total")).toBeCloseTo(1.8, 10);
    warn.mockRestore();
  });
});

// ============================================================================
// Total spend is observable
// ============================================================================

describe("BudgetRunner getSpent('total')", () => {
  it("reports spend when no budget windows are configured", async () => {
    const runner = withBudget(makeRunner(successResult(100_000, 100_000)), {
      pricing: PRICING,
    });

    expect(runner.getSpent("total")).toBe(0);

    await runner(mockAgent(), "hello");

    // (100K/1M)*3 + (100K/1M)*15 = $1.80
    expect(runner.getSpent("total")).toBeCloseTo(1.8, 10);
  });

  it("accumulates across calls alongside window ledgers", async () => {
    const runner = withBudget(makeRunner(successResult(100_000, 100_000)), {
      pricing: PRICING,
      budgets: [{ window: "hour", maxCost: 100, pricing: PRICING }],
    });

    await runner(mockAgent(), "hello");
    await runner(mockAgent(), "hello");

    expect(runner.getSpent("total")).toBeCloseTo(3.6, 10);
    expect(runner.getSpent("hour")).toBeCloseTo(3.6, 10);
  });

  it("returns 0 when there is no top-level pricing to price a call with", async () => {
    const runner = withBudget(makeRunner(successResult(100_000, 100_000)), {
      budgets: [{ window: "hour", maxCost: 100, pricing: PRICING }],
    });

    await runner(mockAgent(), "hello");

    expect(runner.getSpent("total")).toBe(0);
  });
});

// ============================================================================
// Post-call enforcement of maxCostPerCall
// ============================================================================

describe("withBudget maxCostPerCall post-call enforcement", () => {
  // The pre-call check gates an estimate. A call estimated at a cent that
  // bills five dollars clears the gate; without this it is absorbed in silence.
  it("reports an actual cost that overruns the per-call cap", async () => {
    const onBudgetExceeded = vi.fn();
    const runner = withBudget(makeRunner(successResult(1_000_000, 1_000_000)), {
      maxCostPerCall: 0.01,
      pricing: PRICING,
      onBudgetExceeded,
    });

    // Short input: the pre-call estimate is far under the cap, so the call runs.
    const result = await runner(mockAgent(), "hello");

    expect(result.output).toBe("hello");
    expect(onBudgetExceeded).toHaveBeenCalledOnce();
    expect(onBudgetExceeded).toHaveBeenCalledWith({
      estimated: 18,
      remaining: 0.01,
      window: "per-call",
      phase: "post-call",
    });
  });

  it("does not throw — the call already completed and the money is spent", async () => {
    const runner = withBudget(makeRunner(successResult(1_000_000, 1_000_000)), {
      maxCostPerCall: 0.01,
      pricing: PRICING,
    });

    await expect(runner(mockAgent(), "hello")).resolves.toBeDefined();
  });

  it("stays quiet when the actual cost is within the cap", async () => {
    const onBudgetExceeded = vi.fn();
    const runner = withBudget(makeRunner(successResult(100, 50)), {
      maxCostPerCall: 1,
      pricing: PRICING,
      onBudgetExceeded,
    });

    await runner(mockAgent(), "hello");

    expect(onBudgetExceeded).not.toHaveBeenCalled();
  });

  it("a throwing callback does not break the post-call path", async () => {
    const runner = withBudget(makeRunner(successResult(1_000_000, 1_000_000)), {
      maxCostPerCall: 0.01,
      pricing: PRICING,
      onBudgetExceeded: () => {
        throw new Error("callback exploded");
      },
    });

    await expect(runner(mockAgent(), "hello")).resolves.toBeDefined();
  });
});
