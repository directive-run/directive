import { describe, expect, it, vi } from "vitest";
import { createConstraintRouter } from "../provider-routing.js";
import type { AgentRunner, RunResult } from "../types.js";

// ============================================================================
// Helpers
// ============================================================================

function mockAgent() {
  return { name: "test-agent", instructions: "Be helpful." };
}

function successResult(output = "hello"): RunResult {
  return {
    output,
    messages: [{ role: "assistant", content: output }],
    toolCalls: [],
    totalTokens: 100,
    tokenUsage: { inputTokens: 50, outputTokens: 50 },
  };
}

function makeProviderRunner(name: string): AgentRunner {
  return vi.fn(async () => {
    return { ...successResult(), output: `from:${name}` };
  }) as unknown as AgentRunner;
}

function failingProviderRunner(name: string): AgentRunner {
  return vi.fn(async () => {
    throw new Error(`${name} failed`);
  }) as unknown as AgentRunner;
}

// ============================================================================
// createConstraintRouter
// ============================================================================

describe("createConstraintRouter", () => {
  it("routes to default provider when no constraints match", async () => {
    const runner = createConstraintRouter({
      providers: [
        { name: "openai", runner: makeProviderRunner("openai") },
        { name: "anthropic", runner: makeProviderRunner("anthropic") },
      ],
      defaultProvider: "openai",
    });

    const result = await runner(mockAgent(), "hello");
    expect(result.output).toBe("from:openai");
  });

  it("routes based on constraint match", async () => {
    const runner = createConstraintRouter({
      providers: [
        {
          name: "openai",
          runner: makeProviderRunner("openai"),
          pricing: { inputPerMillion: 5, outputPerMillion: 15 },
        },
        { name: "ollama", runner: makeProviderRunner("ollama") },
      ],
      defaultProvider: "openai",
      constraints: [
        { when: (facts) => facts.totalCost > 0.0001, provider: "ollama" },
      ],
    });

    // First call goes to openai (no cost yet)
    const r1 = await runner(mockAgent(), "hello");
    expect(r1.output).toBe("from:openai");

    // Second call should route to ollama (cost accumulated)
    const r2 = await runner(mockAgent(), "hello");
    expect(r2.output).toBe("from:ollama");
  });

  it("higher priority constraints win", async () => {
    const runner = createConstraintRouter({
      providers: [
        { name: "openai", runner: makeProviderRunner("openai") },
        { name: "anthropic", runner: makeProviderRunner("anthropic") },
        { name: "ollama", runner: makeProviderRunner("ollama") },
      ],
      defaultProvider: "openai",
      constraints: [
        { when: () => true, provider: "anthropic", priority: 1 },
        { when: () => true, provider: "ollama", priority: 10 },
      ],
    });

    const result = await runner(mockAgent(), "hello");
    expect(result.output).toBe("from:ollama");
  });

  it("tracks call count and error count", async () => {
    const runner = createConstraintRouter({
      providers: [
        { name: "openai", runner: failingProviderRunner("openai") },
        { name: "anthropic", runner: makeProviderRunner("anthropic") },
      ],
      defaultProvider: "openai",
    }) as ReturnType<typeof createConstraintRouter>;

    // First call fails (openai errors)
    await expect(runner(mockAgent(), "hello")).rejects.toThrow("openai failed");

    const facts = runner.facts;
    expect(facts.callCount).toBe(1);
    expect(facts.errorCount).toBe(1);
    expect(facts.providers.openai?.errorCount).toBe(1);
  });

  it("skips errored providers during cooldown", async () => {
    const runner = createConstraintRouter({
      providers: [
        // Same pricing so cheapest heuristic doesn't interfere
        {
          name: "openai",
          runner: failingProviderRunner("openai"),
          pricing: { inputPerMillion: 3, outputPerMillion: 15 },
        },
        {
          name: "anthropic",
          runner: makeProviderRunner("anthropic"),
          pricing: { inputPerMillion: 3, outputPerMillion: 15 },
        },
      ],
      defaultProvider: "openai",
      errorCooldownMs: 60000,
    });

    // First call: openai is default and cheapest-tied, so it's selected and errors
    await expect(runner(mockAgent(), "hello")).rejects.toThrow("openai failed");

    // Second call: openai is in cooldown, should route to anthropic
    const result = await runner(mockAgent(), "hello");
    expect(result.output).toBe("from:anthropic");
  });

  it("calls onProviderSelected callback", async () => {
    const onProviderSelected = vi.fn();
    const runner = createConstraintRouter({
      providers: [{ name: "openai", runner: makeProviderRunner("openai") }],
      defaultProvider: "openai",
      onProviderSelected,
    });

    await runner(mockAgent(), "hello");
    expect(onProviderSelected).toHaveBeenCalledWith("openai", "default");
  });

  it("reports constraint reason when constraint matches", async () => {
    const onProviderSelected = vi.fn();
    const runner = createConstraintRouter({
      providers: [
        { name: "openai", runner: makeProviderRunner("openai") },
        { name: "anthropic", runner: makeProviderRunner("anthropic") },
      ],
      defaultProvider: "openai",
      constraints: [{ when: () => true, provider: "anthropic" }],
      onProviderSelected,
    });

    await runner(mockAgent(), "hello");
    expect(onProviderSelected).toHaveBeenCalledWith("anthropic", "constraint");
  });

  it("tracks total cost across calls", async () => {
    const runner = createConstraintRouter({
      providers: [
        {
          name: "openai",
          runner: makeProviderRunner("openai"),
          pricing: { inputPerMillion: 10, outputPerMillion: 30 },
        },
      ],
      defaultProvider: "openai",
    }) as ReturnType<typeof createConstraintRouter>;

    await runner(mockAgent(), "hello");
    await runner(mockAgent(), "hello");

    // Each call: (50/1M)*10 + (50/1M)*30 = $0.0005 + $0.0015 = $0.002
    expect(runner.facts.totalCost).toBeCloseTo(0.004, 6);
    expect(runner.facts.callCount).toBe(2);
  });

  it("throws when default provider not in providers list", () => {
    expect(() =>
      createConstraintRouter({
        providers: [{ name: "openai", runner: makeProviderRunner("openai") }],
        defaultProvider: "nonexistent",
      }),
    ).toThrow("not found");
  });

  it("tracks average latency", async () => {
    const runner = createConstraintRouter({
      providers: [{ name: "openai", runner: makeProviderRunner("openai") }],
      defaultProvider: "openai",
    }) as ReturnType<typeof createConstraintRouter>;

    await runner(mockAgent(), "hello");

    expect(runner.facts.avgLatencyMs).toBeGreaterThanOrEqual(0);
    expect(runner.facts.lastProvider).toBe("openai");
  });

  it("prefers cheapest available provider when preferCheapest is true", async () => {
    const runner = createConstraintRouter({
      providers: [
        {
          name: "expensive",
          runner: makeProviderRunner("expensive"),
          pricing: { inputPerMillion: 100, outputPerMillion: 300 },
        },
        {
          name: "cheap",
          runner: makeProviderRunner("cheap"),
          pricing: { inputPerMillion: 1, outputPerMillion: 3 },
        },
      ],
      defaultProvider: "expensive",
      preferCheapest: true,
    });

    const result = await runner(mockAgent(), "hello");
    expect(result.output).toBe("from:cheap");
  });

  it("uses default provider when preferCheapest is false", async () => {
    const runner = createConstraintRouter({
      providers: [
        {
          name: "expensive",
          runner: makeProviderRunner("expensive"),
          pricing: { inputPerMillion: 100, outputPerMillion: 300 },
        },
        {
          name: "cheap",
          runner: makeProviderRunner("cheap"),
          pricing: { inputPerMillion: 1, outputPerMillion: 3 },
        },
      ],
      defaultProvider: "expensive",
    });

    const result = await runner(mockAgent(), "hello");
    expect(result.output).toBe("from:expensive");
  });
});

// ============================================================================
// Config Validation (C1)
// ============================================================================

describe("createConstraintRouter config validation", () => {
  it("throws on negative errorCooldownMs", () => {
    expect(() =>
      createConstraintRouter({
        providers: [{ name: "openai", runner: makeProviderRunner("openai") }],
        defaultProvider: "openai",
        errorCooldownMs: -1,
      }),
    ).toThrow("errorCooldownMs must be a non-negative finite number");
  });

  it("throws on NaN errorCooldownMs", () => {
    expect(() =>
      createConstraintRouter({
        providers: [{ name: "openai", runner: makeProviderRunner("openai") }],
        defaultProvider: "openai",
        errorCooldownMs: Number.NaN,
      }),
    ).toThrow("errorCooldownMs must be a non-negative finite number");
  });
});

// ============================================================================
// Callback Isolation (C2)
// ============================================================================

describe("createConstraintRouter callback isolation", () => {
  it("throwing constraint.when is skipped silently", async () => {
    const runner = createConstraintRouter({
      providers: [
        { name: "openai", runner: makeProviderRunner("openai") },
        { name: "anthropic", runner: makeProviderRunner("anthropic") },
      ],
      defaultProvider: "openai",
      constraints: [
        {
          when: () => {
            throw new Error("constraint exploded");
          },
          provider: "anthropic",
        },
      ],
    });

    // Should fall through to default provider, not crash
    const result = await runner(mockAgent(), "hello");
    expect(result.output).toBe("from:openai");
  });

  it("throwing onProviderSelected does not crash routing", async () => {
    const runner = createConstraintRouter({
      providers: [{ name: "openai", runner: makeProviderRunner("openai") }],
      defaultProvider: "openai",
      onProviderSelected: () => {
        throw new Error("callback exploded");
      },
    });

    const result = await runner(mockAgent(), "hello");
    expect(result.output).toBe("from:openai");
  });
});

// ============================================================================
// Deep-clone RoutingFacts (C4)
// ============================================================================

describe("RoutingFacts immutability", () => {
  it("mutating returned facts does not affect internal state", async () => {
    const runner = createConstraintRouter({
      providers: [
        {
          name: "openai",
          runner: makeProviderRunner("openai"),
          pricing: { inputPerMillion: 5, outputPerMillion: 15 },
        },
      ],
      defaultProvider: "openai",
    }) as ReturnType<typeof createConstraintRouter>;

    await runner(mockAgent(), "hello");

    // Get facts and mutate them
    const facts1 = runner.facts;
    facts1.totalCost = 999999;
    facts1.callCount = 999999;
    facts1.providers.openai!.errorCount = 999999;

    // Get facts again — should reflect actual internal state, not our mutations
    const facts2 = runner.facts;
    expect(facts2.totalCost).not.toBe(999999);
    expect(facts2.callCount).toBe(1);
    expect(facts2.providers.openai!.errorCount).toBe(0);
  });
});

// ============================================================================
// Pre-sorted Constraints (M9)
// ============================================================================

describe("constraint priority sorting", () => {
  it("constraints are pre-sorted by priority at construction time", async () => {
    // Add constraints in reverse priority order — highest should still win
    const runner = createConstraintRouter({
      providers: [
        { name: "openai", runner: makeProviderRunner("openai") },
        { name: "anthropic", runner: makeProviderRunner("anthropic") },
        { name: "ollama", runner: makeProviderRunner("ollama") },
      ],
      defaultProvider: "openai",
      constraints: [
        { when: () => true, provider: "anthropic", priority: 1 },
        { when: () => true, provider: "ollama", priority: 100 },
      ],
    });

    const result = await runner(mockAgent(), "hello");
    expect(result.output).toBe("from:ollama"); // Highest priority wins
  });
});

// ============================================================================
// Provider pricing is validated and snapshotted
// ============================================================================

describe("createConstraintRouter provider pricing", () => {
  function runnerReporting(
    tokenUsage: Record<string, number> | undefined,
  ): AgentRunner {
    return vi.fn(async () => ({
      output: "ok",
      messages: [],
      toolCalls: [],
      totalTokens: 0,
      ...(tokenUsage ? { tokenUsage } : {}),
    })) as unknown as AgentRunner;
  }

  it("rejects a negative rate, which would win preferCheapest on every call", () => {
    // A negative rate sorts below every real provider and drives totalCost
    // downwards without limit, so a cost-based failover constraint can never
    // fire.
    expect(() =>
      createConstraintRouter({
        providers: [
          {
            name: "cheap",
            runner: makeProviderRunner("cheap"),
            pricing: { inputPerMillion: -1000, outputPerMillion: 15 },
          },
        ],
        defaultProvider: "cheap",
      }),
    ).toThrow(
      /providers\[cheap\].pricing.inputPerMillion must not be negative/,
    );
  });

  it("rejects a NaN rate", () => {
    expect(() =>
      createConstraintRouter({
        providers: [
          {
            name: "openai",
            runner: makeProviderRunner("openai"),
            pricing: { inputPerMillion: Number.NaN, outputPerMillion: 15 },
          },
        ],
        defaultProvider: "openai",
      }),
    ).toThrow(/must be a finite number/);
  });

  it("names createConstraintRouter, not another wrapper, in the message", () => {
    let message = "";
    try {
      createConstraintRouter({
        providers: [
          {
            name: "openai",
            runner: makeProviderRunner("openai"),
            pricing: { inputPerMillion: Number.NaN, outputPerMillion: 15 },
          },
        ],
        defaultProvider: "openai",
      });
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toContain("createConstraintRouter");
    expect(message).not.toContain("withBudget");
  });

  it("keeps routing on cost after the caller mutates the pricing object", async () => {
    const mutable = { inputPerMillion: 3, outputPerMillion: 15 };
    const router = createConstraintRouter({
      providers: [
        {
          name: "primary",
          runner: runnerReporting({
            inputTokens: 1_000_000,
            outputTokens: 1_000_000,
          }),
          pricing: mutable,
        },
      ],
      defaultProvider: "primary",
    });

    mutable.inputPerMillion = Number.NaN;
    mutable.outputPerMillion = Number.NaN;

    await router(mockAgent(), "hello");

    expect(router.facts.totalCost).toBeCloseTo(18, 10);
  });

  it("a failover constraint keeps firing after a call reports poisoned usage", async () => {
    // NaN in facts.totalCost makes `facts.totalCost > 1` false forever, so the
    // failover silently stops working and never recovers.
    const router = createConstraintRouter({
      providers: [
        {
          name: "primary",
          runner: runnerReporting({
            inputTokens: Number.NaN,
            outputTokens: 50,
          }),
          pricing: { inputPerMillion: 3, outputPerMillion: 15 },
        },
        { name: "backup", runner: makeProviderRunner("backup") },
      ],
      defaultProvider: "primary",
      constraints: [
        { when: (facts) => facts.totalCost > 1, provider: "backup" },
      ],
    });

    await router(mockAgent(), "hello");

    expect(Number.isFinite(router.facts.totalCost)).toBe(true);
    expect(router.facts.providers.primary?.totalCost).toBe(0);
  });

  it("bills cache tokens into facts.totalCost", async () => {
    const router = createConstraintRouter({
      providers: [
        {
          name: "primary",
          runner: runnerReporting({
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 1_000_000,
            cacheCreationTokens: 1_000_000,
          }),
          pricing: {
            inputPerMillion: 3,
            outputPerMillion: 15,
            cacheReadPerMillion: 0.3,
            cacheWritePerMillion: 3.75,
          },
        },
      ],
      defaultProvider: "primary",
    });

    await router(mockAgent(), "hello");

    expect(router.facts.totalCost).toBeCloseTo(4.05, 10);
  });

  it("reads each provider field once, so a getter cannot rename a provider mid-flight", async () => {
    let reads = 0;
    const provider = {
      get name() {
        reads++;

        return reads > 1 ? "ghost" : "primary";
      },
      runner: makeProviderRunner("primary"),
    };

    const router = createConstraintRouter({
      providers: [provider],
      defaultProvider: "primary",
    });

    await router(mockAgent(), "hello");

    expect(router.facts.lastProvider).toBe("primary");
    expect(Object.keys(router.facts.providers)).toEqual(["primary"]);
  });
});
