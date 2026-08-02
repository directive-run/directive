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
    ).toThrow("pricing.inputPerMillion must not be negative");
  });

  it("rejects a negative output rate", () => {
    const inner = makeRunner();
    expect(() =>
      withBudget(inner, {
        maxCostPerCall: 1,
        pricing: { inputPerMillion: 3, outputPerMillion: -15 },
      }),
    ).toThrow("pricing.outputPerMillion must not be negative");
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
    ).toThrow("budgets[day].pricing.inputPerMillion must not be negative");
  });

  it("rejects -0, which is not the same as 0", () => {
    const inner = makeRunner();
    expect(() =>
      withBudget(inner, {
        maxCostPerCall: 1,
        pricing: { inputPerMillion: -0, outputPerMillion: 15 },
      }),
    ).toThrow(/must not be -0 \(signed zero\)/);
  });

  it("explains why -0 is rejected and that plain 0 is accepted", () => {
    const inner = makeRunner();
    let message = "";
    try {
      withBudget(inner, {
        maxCostPerCall: 1,
        pricing: { inputPerMillion: -0, outputPerMillion: 15 },
      });
    } catch (err) {
      message = (err as Error).message;
    }

    // The old wording named a rule -0 satisfies: `-0 >= 0` is true, so
    // "must be a non-negative number (received -0)" reads as a contradiction.
    expect(message).not.toMatch(/non-negative number \(received -0\)/);
    expect(message).toMatch(/negative sign/);
    expect(message).toMatch(/plain 0/);
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
    ).toThrow(/must not be negative/);
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

  // "hello" is 5 characters, so 2 estimated input tokens and, at the default
  // 1.0 multiplier, 2 estimated output tokens: (2/1M)*3 + (2/1M)*15.
  const HELLO_ESTIMATE = (2 / 1_000_000) * 3 + (2 / 1_000_000) * 15;

  for (const [label, inputTokens, outputTokens] of POISON) {
    it(`charges the estimate for ${label} instead of poisoning the ledger`, async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const runner = withBudget(
        makeRunner(resultWithUsage(inputTokens, outputTokens)),
        {
          pricing: PRICING,
          budgets: [{ window: "hour", maxCost: 100, pricing: PRICING }],
        },
      );

      await runner(mockAgent(), "hello");

      expect(runner.getSpent("hour")).toBeCloseTo(HELLO_ESTIMATE, 12);
      expect(runner.getSpent("total")).toBeCloseTo(HELLO_ESTIMATE, 12);
      expect(Number.isFinite(runner.getSpent("hour"))).toBe(true);
      expect(runner.getUnpricedCallCount()).toBe(1);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("non-finite or negative token count"),
      );
      warn.mockRestore();
    });
  }

  it("rejects a poisoned cache token count, not just input and output", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const runner = withBudget(
      makeRunner({
        output: "hello",
        messages: [],
        toolCalls: [],
        totalTokens: 0,
        tokenUsage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: Number.NaN,
        },
      }),
      { pricing: PRICING },
    );

    await runner(mockAgent(), "hello");

    expect(Number.isFinite(runner.getSpent("total"))).toBe(true);
    expect(runner.getUnpricedCallCount()).toBe(1);
    warn.mockRestore();
  });

  it("warns once, not once per call", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const runner = withBudget(makeRunner(resultWithUsage(Number.NaN, 50)), {
      pricing: PRICING,
    });

    await runner(mockAgent(), "hello");
    await runner(mockAgent(), "hello");
    await runner(mockAgent(), "hello");

    expect(warn).toHaveBeenCalledOnce();
    // The one-shot warning is not the only signal: the count keeps rising.
    expect(runner.getUnpricedCallCount()).toBe(3);
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

    // (100K/1M)*3 + (100K/1M)*15 = $1.80 for the good call, plus the estimate
    // charged in place of the poisoned one.
    expect(runner.getSpent("total")).toBeCloseTo(1.8 + HELLO_ESTIMATE, 10);
    expect(runner.getUnpricedCallCount()).toBe(1);
    warn.mockRestore();
  });
});

// ============================================================================
// A runner that reports no usage at all
// ============================================================================

describe("withBudget falls back to the estimate when tokenUsage is absent", () => {
  // Plenty of runners never populate tokenUsage. Counted as nothing, such a
  // runner reads as $0 spent forever while real money goes out, and every
  // window budget is silently inert — with no warning at all, since there was
  // no bad value to warn about.
  function resultWithoutUsage(): RunResult {
    return {
      output: "hello",
      messages: [],
      toolCalls: [],
      totalTokens: 0,
    };
  }

  const HELLO_ESTIMATE = (2 / 1_000_000) * 3 + (2 / 1_000_000) * 15;

  it("charges the pre-call estimate rather than nothing", async () => {
    const runner = withBudget(makeRunner(resultWithoutUsage()), {
      pricing: PRICING,
      budgets: [{ window: "hour", maxCost: 100, pricing: PRICING }],
    });

    await runner(mockAgent(), "hello");

    expect(runner.getSpent("hour")).toBeCloseTo(HELLO_ESTIMATE, 12);
    expect(runner.getSpent("total")).toBeCloseTo(HELLO_ESTIMATE, 12);
  });

  it("counts every estimated call, so the approximation is visible", async () => {
    const runner = withBudget(makeRunner(resultWithoutUsage()), {
      pricing: PRICING,
    });

    await runner(mockAgent(), "hello");
    await runner(mockAgent(), "hello");
    await runner(mockAgent(), "hello");

    expect(runner.getUnpricedCallCount()).toBe(3);
  });

  it("leaves the count at zero when every call reports usable usage", async () => {
    const runner = withBudget(makeRunner(successResult(100, 50)), {
      pricing: PRICING,
    });

    await runner(mockAgent(), "hello");
    await runner(mockAgent(), "hello");

    expect(runner.getUnpricedCallCount()).toBe(0);
  });

  it("still trips a window budget, because spend is no longer invisible", async () => {
    const runner = withBudget(makeRunner(resultWithoutUsage()), {
      pricing: PRICING,
      budgets: [
        { window: "hour", maxCost: HELLO_ESTIMATE * 1.5, pricing: PRICING },
      ],
    });

    await runner(mockAgent(), "hello");

    await expect(runner(mockAgent(), "hello")).rejects.toThrow(
      BudgetExceededError,
    );
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

  it("accrues from a budget window's pricing when there is no top-level pricing", async () => {
    // "hour" reading 1.80 while "total" read 0 was the same unobservable-spend
    // shape the "total" window was added to remove.
    const runner = withBudget(makeRunner(successResult(100_000, 100_000)), {
      budgets: [{ window: "hour", maxCost: 100, pricing: PRICING }],
    });

    await runner(mockAgent(), "hello");

    expect(runner.getSpent("hour")).toBeCloseTo(1.8, 10);
    expect(runner.getSpent("total")).toBeCloseTo(1.8, 10);
  });

  it("returns 0 when neither top-level pricing nor a budget window is configured", async () => {
    const runner = withBudget(makeRunner(successResult(100_000, 100_000)), {});

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
    // `estimated` is the pre-call estimate in both phases; `actual` is what
    // the provider billed. One field, one meaning.
    expect(onBudgetExceeded).toHaveBeenCalledWith({
      estimated: (2 / 1_000_000) * 3 + (2 / 1_000_000) * 15,
      actual: 18,
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

// ============================================================================
// Budget window configuration is validated and snapshotted
// ============================================================================

describe("withBudget budget window configuration", () => {
  it("rejects a window name it has no duration for", () => {
    expect(() =>
      withBudget(makeRunner(), {
        budgets: [{ window: "week" as never, maxCost: 0.01, pricing: PRICING }],
      }),
    ).toThrow(/window must be one of "hour", "day"/);
  });

  it("rejects a near-miss window name rather than silently ignoring the cap", async () => {
    // An unrecognized window has no duration to measure over, so every
    // comparison against it is false and the cap never trips — a config typo
    // that reads as configured and behaves as absent.
    expect(() =>
      withBudget(makeRunner(), {
        budgets: [
          { window: "hourly" as never, maxCost: 0.01, pricing: PRICING },
        ],
      }),
    ).toThrow(/hourly/);
  });

  it("names the valid windows in the message", () => {
    let message = "";
    try {
      withBudget(makeRunner(), {
        budgets: [{ window: "" as never, maxCost: 1, pricing: PRICING }],
      });
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toContain('"hour"');
    expect(message).toContain('"day"');
  });

  it("rejects a window name that resolves through the prototype chain", () => {
    expect(() =>
      withBudget(makeRunner(), {
        budgets: [
          { window: "__proto__" as never, maxCost: 0.01, pricing: PRICING },
        ],
      }),
    ).toThrow(/window must be one of/);
  });

  it("reads maxCost once, so a getter cannot store a value it never validated", async () => {
    // A getter returning 10, 10, NaN passed validation and stored NaN, which
    // makes `estimated > remaining` false forever: the cap is configured and
    // permanently inert.
    let reads = 0;
    const budget = {
      window: "hour" as const,
      get maxCost() {
        reads++;

        return reads > 1 ? Number.NaN : 10;
      },
      pricing: PRICING,
    };

    const runner = withBudget(makeRunner(successResult(1_000_000, 1_000_000)), {
      budgets: [budget],
    });

    // $18 a call against a $10 cap: the first lands, the second is blocked.
    await runner(mockAgent(), "hello");

    await expect(runner(mockAgent(), "hello")).rejects.toThrow(
      BudgetExceededError,
    );
    expect(reads).toBe(1);
  });
});

// ============================================================================
// A cap that no call can reach
// ============================================================================

describe("withBudget warns about caps that can never trip", () => {
  it("warns when a per-call cap is paired with all-zero rates", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    withBudget(makeRunner(), {
      maxCostPerCall: 5,
      pricing: { inputPerMillion: 0, outputPerMillion: 0 },
    });

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("maxCostPerCall"),
    );
    warn.mockRestore();
  });

  it("warns when a window cap is paired with all-zero rates", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    withBudget(makeRunner(), {
      budgets: [
        {
          window: "day",
          maxCost: 10,
          pricing: { inputPerMillion: 0, outputPerMillion: 0 },
        },
      ],
    });

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("budgets[day].maxCost"),
    );
    warn.mockRestore();
  });

  it("stays quiet when zero rates are paired with a zero cap", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    withBudget(makeRunner(), {
      maxCostPerCall: 0,
      pricing: { inputPerMillion: 0, outputPerMillion: 0 },
    });

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("stays quiet for real rates", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    withBudget(makeRunner(), { maxCostPerCall: 5, pricing: PRICING });

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ============================================================================
// The callback cannot rewrite the error it precedes
// ============================================================================

describe("withBudget onBudgetExceeded receives a copy", () => {
  const LONG_INPUT = "x".repeat(40_000_000);

  it("still throws BudgetExceededError when the callback rewrites its fields", async () => {
    // Sharing one object between the callback and the error let a callback set
    // `estimated` to a string, which made the error's own message template
    // throw a TypeError — so a hard budget block surfaced as a transient
    // failure and callers retried it.
    const runner = withBudget(makeRunner(), {
      maxCostPerCall: 0.001,
      pricing: PRICING,
      onBudgetExceeded: (details) => {
        (details as unknown as Record<string, unknown>).estimated = "0";
        (details as unknown as Record<string, unknown>).remaining = "0";
      },
    });

    await expect(runner(mockAgent(), LONG_INPUT)).rejects.toThrow(
      BudgetExceededError,
    );
  });

  it("hands the callback a frozen object", async () => {
    let frozen: boolean | null = null;
    const runner = withBudget(makeRunner(), {
      maxCostPerCall: 0.001,
      pricing: PRICING,
      onBudgetExceeded: (details) => {
        frozen = Object.isFrozen(details);
      },
    });

    await expect(runner(mockAgent(), LONG_INPUT)).rejects.toThrow(
      BudgetExceededError,
    );
    expect(frozen).toBe(true);
  });

  it("reports the numbers the error carries, unchanged by the callback", async () => {
    let seen: { estimated: number; remaining: number } | null = null;
    const runner = withBudget(makeRunner(), {
      maxCostPerCall: 0.001,
      pricing: PRICING,
      onBudgetExceeded: (details) => {
        seen = { estimated: details.estimated, remaining: details.remaining };
      },
    });

    let error: BudgetExceededError | null = null;
    try {
      await runner(mockAgent(), LONG_INPUT);
    } catch (err) {
      error = err as BudgetExceededError;
    }

    expect(error).toBeInstanceOf(BudgetExceededError);
    expect(seen!.estimated).toBe(error!.estimated);
    expect(seen!.remaining).toBe(error!.remaining);
  });
});

// ============================================================================
// Cache tokens are billed
// ============================================================================

describe("withBudget prices cache tokens", () => {
  function resultWithCache(usage: Record<string, number>): RunResult {
    return {
      output: "hello",
      messages: [],
      toolCalls: [],
      totalTokens: 0,
      tokenUsage: usage as unknown as RunResult["tokenUsage"],
    };
  }

  it("does not treat a heavily cached call as free", async () => {
    // With prompt caching on, inputTokens is only the uncached remainder. A
    // ledger that prices input and output alone reads a cached run as nearly
    // costless while the provider bills it in full.
    const runner = withBudget(
      makeRunner(
        resultWithCache({
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 1_000_000,
          cacheCreationTokens: 1_000_000,
        }),
      ),
      { pricing: PRICING },
    );

    await runner(mockAgent(), "hello");

    // Both cache classes default to the $3/M input rate.
    expect(runner.getSpent("total")).toBeCloseTo(6, 10);
  });

  it("uses published cache rates when the pricing carries them", async () => {
    const runner = withBudget(
      makeRunner(
        resultWithCache({
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 1_000_000,
          cacheCreationTokens: 1_000_000,
        }),
      ),
      {
        pricing: {
          inputPerMillion: 3,
          outputPerMillion: 15,
          cacheReadPerMillion: 0.3,
          cacheWritePerMillion: 3.75,
        },
      },
    );

    await runner(mockAgent(), "hello");

    expect(runner.getSpent("total")).toBeCloseTo(4.05, 10);
  });

  it("prices a cache write above plain input, as providers bill it", async () => {
    const pricing = {
      inputPerMillion: 3,
      outputPerMillion: 15,
      cacheWritePerMillion: 3.75,
    };
    const written = withBudget(
      makeRunner(
        resultWithCache({
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 1_000_000,
        }),
      ),
      { pricing },
    );
    const plain = withBudget(
      makeRunner(resultWithCache({ inputTokens: 1_000_000, outputTokens: 0 })),
      { pricing },
    );

    await written(mockAgent(), "hello");
    await plain(mockAgent(), "hello");

    expect(written.getSpent("total")).toBeGreaterThan(plain.getSpent("total"));
  });
});

// ============================================================================
// An overflowing cost does not brick the runner
// ============================================================================

describe("withBudget survives a cost that overflows", () => {
  it("keeps the ledger finite and keeps accepting calls", async () => {
    const runner = withBudget(makeRunner(successResult(1_000_000, 1_000_000)), {
      // Large enough that the pre-call estimate clears the gate, so the
      // overflow happens where it used to be recorded: after the call.
      maxCostPerCall: Number.MAX_VALUE,
      pricing: {
        inputPerMillion: Number.MAX_VALUE,
        outputPerMillion: Number.MAX_VALUE,
      },
    });

    await runner(mockAgent(), "hello");

    expect(Number.isFinite(runner.getSpent("total"))).toBe(true);

    // Infinity in the total used to make every later call throw forever.
    await expect(runner(mockAgent(), "hello")).resolves.toBeDefined();
  });

  it("counts the overflowing call as unpriced rather than swallowing it", async () => {
    const runner = withBudget(makeRunner(successResult(1_000_000, 1_000_000)), {
      maxCostPerCall: Number.MAX_VALUE,
      pricing: {
        inputPerMillion: Number.MAX_VALUE,
        outputPerMillion: Number.MAX_VALUE,
      },
    });

    await runner(mockAgent(), "hello");

    expect(runner.getUnpricedCallCount()).toBe(1);
  });
});

// ============================================================================
// Two budgets on one window are two caps over one running total
// ============================================================================

describe("withBudget records a call once per window", () => {
  /** 1M input + 1M output at PRICING is $3 + $15. */
  const CALL_COST = 18;

  function millionEachRunner(): AgentRunner {
    return makeRunner(successResult(1_000_000, 1_000_000));
  }

  it("does not double-charge a shared window ledger", async () => {
    const runner = withBudget(millionEachRunner(), {
      budgets: [
        { window: "hour", maxCost: 1_000_000, pricing: PRICING },
        { window: "hour", maxCost: 1_000_000, pricing: PRICING },
      ],
    });

    await runner(mockAgent(), "hello");

    expect(runner.getSpent("hour")).toBeCloseTo(CALL_COST, 10);
  });

  it("keeps getSpent honest across many calls on two budgets", async () => {
    const runner = withBudget(millionEachRunner(), {
      budgets: [
        { window: "hour", maxCost: 1_000_000, pricing: PRICING },
        { window: "hour", maxCost: 1_000_000, pricing: PRICING },
      ],
    });

    for (let call = 0; call < 10; call++) {
      await runner(mockAgent(), "hello");
    }

    // Reported to dashboards. Double-counting here reads as twice the burn
    // rate, on top of blocking at half the configured cap.
    expect(runner.getSpent("hour")).toBeCloseTo(CALL_COST * 10, 8);
  });

  it("spends the whole cap before blocking, not half of it", async () => {
    // $18 a call against a $100 hour. The gate compares an estimate, and these
    // prompts estimate at fractions of a cent, so the block lands on the first
    // call after real spend passes the cap - the seventh. Billed twice, the
    // ledger crossed $100 on the third call and the runner stopped at four,
    // having actually spent $54 against a $100 cap.
    const runner = withBudget(millionEachRunner(), {
      budgets: [
        { window: "hour", maxCost: 100, pricing: PRICING },
        { window: "hour", maxCost: 100, pricing: PRICING },
      ],
    });

    let completed = 0;
    for (let call = 0; call < 20; call++) {
      try {
        await runner(mockAgent(), "hello");
        completed++;
      } catch {
        break;
      }
    }

    expect(completed).toBe(6);
    expect(runner.getSpent("hour")).toBeCloseTo(CALL_COST * 6, 8);
  });

  it("still gates each budget on its own cap", async () => {
    const runner = withBudget(millionEachRunner(), {
      budgets: [
        { window: "hour", maxCost: 1_000_000, pricing: PRICING },
        { window: "hour", maxCost: 20, pricing: PRICING },
      ],
    });

    await runner(mockAgent(), "hello");

    // $18 recorded once against the shared hour, so the tighter cap has $2
    // left; a prompt estimating above that cannot fit inside it, while the
    // roomier budget on the same window would have taken it.
    await expect(runner(mockAgent(), "x".repeat(1_000_000))).rejects.toThrow(
      BudgetExceededError,
    );
  });
});

// ============================================================================
// A window cap overrun is reported, not only a per-call one
// ============================================================================

describe("withBudget reports post-call window overruns", () => {
  it("names the window a call pushed past", async () => {
    const seen: {
      window: string;
      phase: string;
      actual?: number;
      estimated: number;
    }[] = [];

    // The estimate reads the input string alone, so a short prompt that bills
    // 1M tokens clears the gate and lands over the cap.
    const runner = withBudget(makeRunner(successResult(1_000_000, 1_000_000)), {
      budgets: [{ window: "hour", maxCost: 5, pricing: PRICING }],
      onBudgetExceeded: (details) => {
        seen.push({
          window: details.window,
          phase: details.phase,
          actual: details.actual,
          estimated: details.estimated,
        });
      },
    });

    await runner(mockAgent(), "hi");

    expect(seen).toHaveLength(1);
    expect(seen[0]?.window).toBe("hour");
    expect(seen[0]?.phase).toBe("post-call");
    expect(seen[0]?.actual).toBeCloseTo(18, 10);
    expect(seen[0]?.estimated).toBeLessThan(1);
  });

  it("stays quiet for a call that fits inside the window", async () => {
    const seen: string[] = [];
    const runner = withBudget(makeRunner(successResult(1_000_000, 1_000_000)), {
      budgets: [{ window: "hour", maxCost: 1_000, pricing: PRICING }],
      onBudgetExceeded: (details) => seen.push(details.window),
    });

    await runner(mockAgent(), "hi");

    expect(seen).toEqual([]);
  });

  it("reports the window even when no per-call cap is configured", async () => {
    const phases: string[] = [];
    const runner = withBudget(makeRunner(successResult(1_000_000, 1_000_000)), {
      budgets: [{ window: "day", maxCost: 1, pricing: PRICING }],
      onBudgetExceeded: (details) =>
        phases.push(`${details.window}:${details.phase}`),
    });

    await runner(mockAgent(), "hi");

    expect(phases).toEqual(["day:post-call"]);
  });
});

// ============================================================================
// The estimate reads every rate dimension the pricing type carries
// ============================================================================

describe("withBudget estimates against cache rates too", () => {
  const CACHE_HEAVY = {
    inputPerMillion: 3,
    outputPerMillion: 0,
    cacheWritePerMillion: 3.75,
  };

  it("does not price the estimate below the highest input-side rate", async () => {
    const blocked = withBudget(makeRunner(), {
      // 1,000 characters is ~250 tokens. At the cache-write rate that is
      // $0.0009375; at the input rate alone, $0.00075. The cap sits between.
      maxCostPerCall: 0.0008,
      pricing: CACHE_HEAVY,
    });

    await expect(blocked(mockAgent(), "x".repeat(1000))).rejects.toThrow(
      BudgetExceededError,
    );
  });

  it("leaves the estimate unchanged when no cache rate is published", async () => {
    const estimates: number[] = [];
    const runner = withBudget(makeRunner(), {
      maxCostPerCall: 0,
      pricing: { inputPerMillion: 3, outputPerMillion: 15 },
      onBudgetExceeded: (details) => estimates.push(details.estimated),
    });

    await expect(runner(mockAgent(), "x".repeat(1000))).rejects.toThrow(
      BudgetExceededError,
    );

    // 250 input tokens at $3 plus 250 estimated output tokens at $15.
    expect(estimates[0]).toBeCloseTo(0.00075 + 0.00375, 12);
  });
});

// ============================================================================
// An inert cap is judged by what the estimate can produce
// ============================================================================

describe("withBudget warns about caps the estimate can never reach", () => {
  it("does not call a table with a non-zero cache rate zero-rated", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pricing = {
      inputPerMillion: 0,
      outputPerMillion: 0,
      cacheReadPerMillion: 5,
    };

    const runner = withBudget(makeRunner(), {
      maxCostPerCall: 0.01,
      pricing,
    });

    const inertWarnings = warn.mock.calls.filter((call) =>
      String(call[0]).includes("can never trip"),
    );
    warn.mockRestore();

    expect(inertWarnings).toEqual([]);

    // And the cap is not inert: the estimate charges the cache rate, so a large
    // enough input blocks. It used to sail through at $0 a call.
    await expect(runner(mockAgent(), "x".repeat(100_000))).rejects.toThrow(
      BudgetExceededError,
    );
  });

  it("still warns when every rate the estimate reads is zero", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    withBudget(makeRunner(), {
      maxCostPerCall: 0.01,
      pricing: { inputPerMillion: 0, outputPerMillion: 0 },
    });

    const inertWarnings = warn.mock.calls.filter((call) =>
      String(call[0]).includes("can never trip"),
    );
    warn.mockRestore();

    expect(inertWarnings).toHaveLength(1);
  });
});

// ============================================================================
// A runner that never reports usage says so once
// ============================================================================

describe("withBudget warns about a runner that reports no usage", () => {
  function usagelessRunner(): AgentRunner {
    return vi.fn(async () => ({
      output: "ok",
      messages: [],
      toolCalls: [],
      totalTokens: 0,
    })) as unknown as AgentRunner;
  }

  it("warns once, not once per call", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const runner = withBudget(usagelessRunner(), { pricing: PRICING });

    for (let call = 0; call < 5; call++) {
      await runner(mockAgent(), "hello");
    }

    const notices = warn.mock.calls.filter((call) =>
      String(call[0]).includes("no result.tokenUsage"),
    );
    warn.mockRestore();

    expect(notices).toHaveLength(1);
    expect(runner.getUnpricedCallCount()).toBe(5);
  });

  it("says something different about a poisoned count than about a missing one", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const results = [
      { output: "ok", messages: [], toolCalls: [], totalTokens: 0 },
      {
        output: "ok",
        messages: [],
        toolCalls: [],
        totalTokens: 0,
        tokenUsage: { inputTokens: Number.NaN, outputTokens: 50 },
      },
    ] as RunResult[];
    let next = 0;
    const inner = vi.fn(async () => results[next++]!) as unknown as AgentRunner;

    const runner = withBudget(inner, { pricing: PRICING });
    await runner(mockAgent(), "hello");
    await runner(mockAgent(), "hello");

    const notices = warn.mock.calls.map((call) => String(call[0]));
    warn.mockRestore();

    expect(
      notices.filter((notice) => notice.includes("no result.tokenUsage")),
    ).toHaveLength(1);
    expect(
      notices.filter((notice) =>
        notice.includes("non-finite or negative token count"),
      ),
    ).toHaveLength(1);
  });
});
