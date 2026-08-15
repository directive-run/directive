/**
 * One battery, run against every surface that turns caller-supplied rates into
 * dollars.
 *
 * The defenses these tests pin — reject a rate that cannot price anything, copy
 * the rates at construction rather than re-reading them per call, refuse a
 * token count that would poison a running total, bill all four token classes,
 * charge something rather than nothing when the provider reports nothing — were
 * each written for one call site and were each missing from the next. A guard
 * present in `withBudget` and absent in `createConstraintRouter` is not half a
 * guard; from the outside it is no guard at all, because the caller cannot tell
 * which surface they are holding.
 *
 * Adding a new pricing-taking surface means adding it to `SURFACES` below. If
 * it skipped any of this, these tests fail — and "every pricing module appears
 * in SURFACES" is itself asserted at the bottom of this file, because a registry
 * nobody is required to update is a registry that goes stale.
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { estimateCost } from "../agent-utils.js";
import {
  BudgetExceededError,
  type ModelPricing,
  type TokenPricing,
  toTokenPricingTable,
  withBudget,
} from "../budget.js";
import {
  type PricedCall,
  priceCall,
  requireModelPricing,
  snapshotTokenPricing,
} from "../pricing.js";
import { createConstraintRouter } from "../provider-routing.js";
import type { AgentRunner, RunResult, TokenUsage } from "../types.js";

const PRICING: TokenPricing = { inputPerMillion: 3, outputPerMillion: 15 };
const AGENT = { name: "test-agent", instructions: "Be helpful." };

/** 1M input + 1M output at PRICING is $3 + $15. */
const MILLION_EACH: TokenUsage = {
  inputTokens: 1_000_000,
  outputTokens: 1_000_000,
};
const MILLION_EACH_COST = 18;

function runnerReporting(tokenUsage?: TokenUsage): AgentRunner {
  return vi.fn(
    async (): Promise<RunResult> => ({
      output: "ok",
      messages: [],
      toolCalls: [],
      totalTokens: 0,
      ...(tokenUsage ? { tokenUsage } : {}),
    }),
  ) as unknown as AgentRunner;
}

/** A runner that fails before anything reaches the caller. */
function runnerThrowing(): AgentRunner {
  return vi.fn(async (): Promise<RunResult> => {
    throw new Error("structured output did not parse");
  }) as unknown as AgentRunner;
}

/**
 * A runner that delivers a response and *then* fails — a gateway stripping the
 * completion marker, a guardrail rejecting a completion the provider already
 * generated and billed. What arrived is charged; what never arrived is not.
 */
function runnerDeliveringThenThrowing(): AgentRunner {
  return vi.fn(async (_agent, _input, options) => {
    await (
      options as { onToken?: (token: string) => unknown } | undefined
    )?.onToken?.("a delivered and billed response");

    throw new Error("stream ended without a completion marker");
  }) as unknown as AgentRunner;
}

/** One surface, built and ready to run a call. */
interface BuiltSurface {
  /** Run one call and return the spend the surface recorded. */
  run: () => Promise<number>;
  /** How many of those calls the surface could not price from usage. */
  unpricedCalls: () => number;
}

/** A surface that accepts caller-supplied pricing and reports what it spent. */
interface PricingSurface {
  name: string;
  /** The module that owns this surface, relative to `packages/ai/src`. */
  module: string;
  build: (pricing: TokenPricing, inner: AgentRunner) => BuiltSurface;
}

const SURFACES: PricingSurface[] = [
  {
    name: "withBudget config.pricing",
    module: "budget.ts",
    build: (pricing, inner) => {
      const runner = withBudget(inner, { pricing });

      return {
        run: async () => {
          await runner(AGENT, "hello");

          return runner.getSpent("total");
        },
        unpricedCalls: () => runner.getUnpricedCallCount(),
      };
    },
  },
  {
    name: "withBudget budgets[].pricing",
    module: "budget.ts",
    build: (pricing, inner) => {
      const runner = withBudget(inner, {
        budgets: [{ window: "hour", maxCost: 1_000_000, pricing }],
      });

      return {
        run: async () => {
          await runner(AGENT, "hello");

          return runner.getSpent("hour");
        },
        unpricedCalls: () => runner.getUnpricedCallCount(),
      };
    },
  },
  {
    name: "createConstraintRouter providers[].pricing",
    module: "provider-routing.ts",
    build: (pricing, inner) => {
      const router = createConstraintRouter({
        providers: [{ name: "p", runner: inner, pricing }],
        defaultProvider: "p",
      });

      return {
        run: async () => {
          await router(AGENT, "hello");

          return router.facts.totalCost;
        },
        unpricedCalls: () => router.getUnpricedCallCount(),
      };
    },
  },
];

// ============================================================================
// Rates that cannot price anything are rejected at construction
// ============================================================================

const UNUSABLE_RATES: [string, TokenPricing][] = [
  ["a bare { input, output } pair", { input: 3, output: 15 } as never],
  ["a missing output rate", { inputPerMillion: 3 } as never],
  ["a NaN input rate", { inputPerMillion: Number.NaN, outputPerMillion: 15 }],
  [
    "an Infinity output rate",
    { inputPerMillion: 3, outputPerMillion: Number.POSITIVE_INFINITY },
  ],
  ["a negative input rate", { inputPerMillion: -1000, outputPerMillion: 15 }],
  ["a negative output rate", { inputPerMillion: 3, outputPerMillion: -15 }],
  ["a -0 input rate", { inputPerMillion: -0, outputPerMillion: 15 }],
  [
    "a negative cache-read rate",
    { inputPerMillion: 3, outputPerMillion: 15, cacheReadPerMillion: -1 },
  ],
  [
    "a NaN cache-write rate",
    {
      inputPerMillion: 3,
      outputPerMillion: 15,
      cacheWritePerMillion: Number.NaN,
    },
  ],
];

for (const surface of SURFACES) {
  describe(surface.name, () => {
    for (const [label, pricing] of UNUSABLE_RATES) {
      it(`rejects ${label}`, () => {
        expect(() => surface.build(pricing, runnerReporting())).toThrow(
          /\[Directive\]/,
        );
      });
    }

    it("accepts zero rates, which local models genuinely charge", () => {
      expect(() =>
        surface.build(
          { inputPerMillion: 0, outputPerMillion: 0 },
          runnerReporting(),
        ),
      ).not.toThrow();
    });

    it("a rate mutated to NaN after construction does not reach the cost math", async () => {
      const mutable = { inputPerMillion: 3, outputPerMillion: 15 };
      const built = surface.build(mutable, runnerReporting(MILLION_EACH));

      mutable.inputPerMillion = Number.NaN;
      mutable.outputPerMillion = Number.NaN;

      expect(await built.run()).toBeCloseTo(MILLION_EACH_COST, 10);
    });

    it("a getter is trusted once, at construction, and never read again", async () => {
      let reads = 0;
      const sneaky = {
        get inputPerMillion() {
          reads++;

          return reads > 4 ? Number.NaN : 3;
        },
        get outputPerMillion() {
          reads++;

          return reads > 4 ? Number.NaN : 15;
        },
      };
      const built = surface.build(sneaky, runnerReporting(MILLION_EACH));
      const readsAfterConstruction = reads;

      expect(await built.run()).toBeCloseTo(MILLION_EACH_COST, 10);
      expect(reads).toBe(readsAfterConstruction);
    });

    it("reads each rate property exactly once, including ones that only shape an error message", () => {
      const reads = new Map<string, number>();
      const counting = (name: string, value: number) => ({
        get: () => {
          reads.set(name, (reads.get(name) ?? 0) + 1);

          return value;
        },
        enumerable: true,
      });
      const watched = Object.defineProperties(
        {},
        {
          input: counting("input", 3),
          output: counting("output", 15),
          inputPerMillion: counting("inputPerMillion", 3),
          outputPerMillion: counting("outputPerMillion", 15),
          cacheReadPerMillion: counting("cacheReadPerMillion", 0.3),
          cacheWritePerMillion: counting("cacheWritePerMillion", 3.75),
        },
      ) as TokenPricing;

      surface.build(watched, runnerReporting());

      // `input` / `output` exist only to sharpen the "you passed a bare rate
      // pair" hint. They were read before the loop and again inside it, which
      // is the same check-then-use gap the snapshot exists to close - a getter
      // can answer the hint one way and the validator another.
      for (const [name, count] of reads) {
        expect(`${name}:${count}`).toBe(`${name}:1`);
      }
      expect(reads.size).toBe(6);
    });

    it("a poisoned token count never lands in the total", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const built = surface.build(
        PRICING,
        runnerReporting({ inputTokens: Number.NaN, outputTokens: 50 }),
      );

      const spent = await built.run();
      warn.mockRestore();

      expect(Number.isFinite(spent)).toBe(true);
    });

    it("a poisoned cache token count is caught too, not just input and output", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const built = surface.build(
        PRICING,
        runnerReporting({
          inputTokens: 100,
          outputTokens: 50,
          cacheCreationTokens: Number.NEGATIVE_INFINITY,
        }),
      );

      const spent = await built.run();
      warn.mockRestore();

      expect(Number.isFinite(spent)).toBe(true);
    });

    it("bills cache tokens rather than treating them as free", async () => {
      const withoutCache = surface.build(
        PRICING,
        runnerReporting(MILLION_EACH),
      );
      const withCache = surface.build(
        PRICING,
        runnerReporting({ ...MILLION_EACH, cacheReadTokens: 1_000_000 }),
      );

      expect(await withCache.run()).toBeGreaterThan(await withoutCache.run());
    });

    it("prices cache tokens at the input rate when no cache rate is published", async () => {
      // Absent means "same as input" — conservative, and never free. Free is
      // the one answer that is always wrong: the provider bills them.
      const built = surface.build(
        PRICING,
        runnerReporting({
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 1_000_000,
          cacheCreationTokens: 1_000_000,
        }),
      );

      expect(await built.run()).toBeCloseTo(6, 10);
    });

    it("honors published cache rates over the input-rate default", async () => {
      const built = surface.build(
        {
          inputPerMillion: 3,
          outputPerMillion: 15,
          cacheReadPerMillion: 0.3,
          cacheWritePerMillion: 3.75,
        },
        runnerReporting({
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 1_000_000,
          cacheCreationTokens: 1_000_000,
        }),
      );

      expect(await built.run()).toBeCloseTo(4.05, 10);
    });

    it("bills a cache write reported under the pricing side's spelling", async () => {
      // The count is `cacheCreationTokens`; the rate that prices it is
      // `cacheWritePerMillion`. A runner that followed the rate's spelling
      // reported a field nothing read, so ten million cache-write tokens billed
      // as $0 - past validation, uncounted, unwarned.
      const built = surface.build(
        {
          inputPerMillion: 3,
          outputPerMillion: 15,
          cacheWritePerMillion: 3.75,
        },
        runnerReporting({
          inputTokens: 0,
          outputTokens: 0,
          cacheWriteTokens: 10_000_000,
        }),
      );

      expect(await built.run()).toBeCloseTo(37.5, 10);
    });

    it("validates a cache write under either spelling", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const built = surface.build(
        PRICING,
        runnerReporting({
          inputTokens: 100,
          outputTokens: 50,
          cacheWriteTokens: Number.NaN,
        }),
      );

      const spent = await built.run();
      warn.mockRestore();

      expect(Number.isFinite(spent)).toBe(true);
      expect(built.unpricedCalls()).toBe(1);
    });

    it("an overflowing cost is never recorded as Infinity", async () => {
      // Rates and token counts both pass validation, but their product can
      // still overflow. One Infinity in a running total is permanent: every
      // later reading is Infinity and the surface never recovers. Blocking the
      // call outright is a fine outcome; recording Infinity is not.
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const built = surface.build(
        {
          inputPerMillion: Number.MAX_VALUE,
          outputPerMillion: Number.MAX_VALUE,
        },
        runnerReporting(MILLION_EACH),
      );

      let spent = 0;
      try {
        spent = await built.run();
      } catch {
        /* a pre-call block is fail-closed, and leaves nothing to record */
      }
      warn.mockRestore();

      expect(Number.isFinite(spent)).toBe(true);
    });

    // ========================================================================
    // A call the provider reported nothing for still costs something
    // ========================================================================

    it("charges the estimate for a call that reports no usage at all", async () => {
      // Zero is the one answer that is always wrong here. It reads as "this
      // call was free", which is indistinguishable from a local model that
      // genuinely bills nothing - so a spend total sits at 0 forever while real
      // money goes out, and any threshold read off it is unreachable.
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const built = surface.build(PRICING, runnerReporting());

      const spent = await built.run();
      warn.mockRestore();

      expect(spent).toBeGreaterThan(0);
    });

    it("counts a call it could not price, so the approximation is visible", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const built = surface.build(PRICING, runnerReporting());

      await built.run();
      await built.run();
      warn.mockRestore();

      expect(built.unpricedCalls()).toBe(2);
    });

    it("warns once when the runner never reports usage, not once per call", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const built = surface.build(PRICING, runnerReporting());

      await built.run();
      await built.run();
      await built.run();

      const notices = warn.mock.calls.filter((call) =>
        String(call[0]).includes("getUnpricedCallCount()"),
      );
      warn.mockRestore();

      expect(notices).toHaveLength(1);
    });

    it("does not count a call the provider priced normally", async () => {
      const built = surface.build(PRICING, runnerReporting(MILLION_EACH));

      await built.run();

      expect(built.unpricedCalls()).toBe(0);
    });
  });
}

// ============================================================================
// Untrusted input is snapshotted once, not re-read per cap
// ============================================================================

describe("reading result.tokenUsage", () => {
  /** A usage object whose counts change on every read. */
  function shiftingUsage(): { usage: TokenUsage; reads: () => number } {
    let reads = 0;
    const counting = (first: number, rest: number) => ({
      get: () => {
        reads++;

        return reads <= 2 ? first : rest;
      },
      enumerable: true,
    });

    return {
      usage: Object.defineProperties(
        {},
        {
          inputTokens: counting(1_000_000, 0),
          outputTokens: counting(1_000_000, 0),
        },
      ) as TokenUsage,
      reads: () => reads,
    };
  }

  it("reads the provider's usage once per call, not once per cap", async () => {
    // withBudget prices one call against every window ledger and again for the
    // lifetime total. When each of those read result.tokenUsage itself, a usage
    // backed by getters answered each one differently and every answer looked
    // metered: one recorded run read $0 against an hourly cap while the
    // lifetime total read $1800, with no warning and the unpriced counter at 0.
    const { usage, reads } = shiftingUsage();
    const runner = withBudget(runnerReporting(usage), {
      pricing: PRICING,
      budgets: [
        { window: "hour", maxCost: 1_000_000, pricing: PRICING },
        { window: "day", maxCost: 1_000_000, pricing: PRICING },
      ],
    });

    await runner(AGENT, "hello");

    // Two counts, one read each — not one read per ledger plus one for total.
    expect(reads()).toBe(2);
  });

  it("bills every cap the same figure for one call", async () => {
    const { usage } = shiftingUsage();
    const runner = withBudget(runnerReporting(usage), {
      pricing: PRICING,
      budgets: [
        { window: "hour", maxCost: 1_000_000, pricing: PRICING },
        { window: "day", maxCost: 1_000_000, pricing: PRICING },
      ],
    });

    await runner(AGENT, "hello");

    const hour = runner.getSpent("hour");
    expect(runner.getSpent("day")).toBeCloseTo(hour, 10);
    expect(runner.getSpent("total")).toBeCloseTo(hour, 10);
    expect(hour).toBeCloseTo(MILLION_EACH_COST, 10);
  });

  it("does not accept a raw tokenUsage where a snapshot is required", () => {
    // The type is the guard. A caller cannot hand priceCall the provider's
    // object, so there is no second read site for one to exist in.
    const rates = snapshotTokenPricing(PRICING, "pricing", "test");

    // @ts-expect-error - priceCall takes a UsageSnapshot, never a TokenUsage.
    const misuse = () => priceCall(MILLION_EACH, rates, 0);

    expect(typeof misuse).toBe("function");
  });
});

// ============================================================================
// An all-zero metered report is not a price
// ============================================================================

describe("a call that reports zero of everything", () => {
  const ALL_ZERO: TokenUsage = { inputTokens: 0, outputTokens: 0 };

  for (const surface of SURFACES) {
    it(`${surface.name}: charges the estimate rather than nothing`, async () => {
      // A call that ran had a prompt, and a prompt has tokens. Every class at
      // zero is a gateway that dropped the usage block or an adapter defaulting
      // an absent field to 0 — the original fail-open through another door.
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const built = surface.build(PRICING, runnerReporting(ALL_ZERO));

      const spent = await built.run();
      warn.mockRestore();

      expect(spent).toBeGreaterThan(0);
      expect(built.unpricedCalls()).toBe(1);
    });

    it(`${surface.name}: says so, once`, async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const built = surface.build(PRICING, runnerReporting(ALL_ZERO));

      await built.run();
      await built.run();

      const notices = warn.mock.calls.filter((call) =>
        String(call[0]).includes("zero input, output, and cache tokens"),
      );
      warn.mockRestore();

      expect(notices).toHaveLength(1);
    });
  }

  it("leaves a genuinely free local model at zero", async () => {
    // Zero rates are the local-model case and must stay costless. The estimate
    // that stands in is computed at those same rates, so it is also zero.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const runner = withBudget(runnerReporting(ALL_ZERO), {
      pricing: { inputPerMillion: 0, outputPerMillion: 0 },
    });

    await runner(AGENT, "hello");
    warn.mockRestore();

    expect(runner.getSpent("total")).toBe(0);
  });
});

// ============================================================================
// A runner that throws has often already been billed
// ============================================================================

describe("a call that fails after the provider generated it", () => {
  it("withBudget charges a failed attempt that delivered, to every window and the total", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const runner = withBudget(runnerDeliveringThenThrowing(), {
      pricing: PRICING,
      budgets: [{ window: "hour", maxCost: 1_000_000, pricing: PRICING }],
    });

    await expect(
      runner(AGENT, "hello", { onToken: () => {} }),
    ).rejects.toThrow();
    warn.mockRestore();

    expect(runner.getSpent("hour")).toBeGreaterThan(0);
    expect(runner.getSpent("total")).toBeGreaterThan(0);
    expect(runner.getUnpricedCallCount()).toBe(1);
  });

  it("withBudget charges nothing for a failure that delivered nothing", async () => {
    // The other half of the same rule. A refused connection, a DNS failure, a
    // pre-flight throw: no bytes arrived, so there is no observation to price
    // and no money to record. Charging these at a predicted ceiling locked a
    // budget for a whole window over an outage that cost nothing. Still
    // counted, because a call that fails after dispatch may have been billed
    // for work whose size is unknowable from here.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const runner = withBudget(runnerThrowing(), {
      pricing: PRICING,
      budgets: [{ window: "hour", maxCost: 1_000_000, pricing: PRICING }],
    });

    await expect(runner(AGENT, "hello")).rejects.toThrow();
    warn.mockRestore();

    expect(runner.getSpent("hour")).toBe(0);
    expect(runner.getSpent("total")).toBe(0);
    expect(runner.getUnpricedCallCount()).toBe(1);
  });

  it("createConstraintRouter charges failed attempts to facts.totalCost", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const router = createConstraintRouter({
      providers: [{ name: "p", runner: runnerThrowing(), pricing: PRICING }],
      defaultProvider: "p",
    });

    await expect(router(AGENT, "hello")).rejects.toThrow();
    warn.mockRestore();

    expect(router.facts.totalCost).toBeGreaterThan(0);
    expect(router.facts.errorCount).toBe(1);
    expect(router.getUnpricedCallCount()).toBe(1);
  });

  it("reports the failed-attempt charge separately from real spend", async () => {
    // A charge measured off a delivery whose token count never arrived is not
    // the same fact as a charge the provider counted, and the single `getSpent`
    // figure could not tell them apart. Under retry the difference compounds: a
    // gateway that strips the completion marker fills a cap with responses that
    // were delivered and billed but never reported, and nothing said so.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const runner = withBudget(runnerDeliveringThenThrowing(), {
      pricing: PRICING,
      budgets: [{ window: "hour", maxCost: 1_000_000, pricing: PRICING }],
    });

    await expect(
      runner(AGENT, "hello", { onToken: () => {} }),
    ).rejects.toThrow();
    warn.mockRestore();

    expect(runner.getFailedCallSpend("hour")).toBe(runner.getSpent("hour"));
    expect(runner.getFailedCallSpend("total")).toBe(runner.getSpent("total"));
    expect(runner.getFailedCallSpend("total")).toBeGreaterThan(0);
  });

  it("leaves the failed-attempt figure at zero when calls succeed", async () => {
    const runner = withBudget(runnerReporting(MILLION_EACH), {
      pricing: PRICING,
      budgets: [{ window: "hour", maxCost: 1_000_000, pricing: PRICING }],
    });

    await runner(AGENT, "hello");

    expect(runner.getSpent("total")).toBeCloseTo(MILLION_EACH_COST, 10);
    expect(runner.getFailedCallSpend("total")).toBe(0);
    expect(runner.getFailedCallSpend("hour")).toBe(0);
  });

  it("charges nothing when a nested guard blocked the call before the provider", async () => {
    // The inner guard throws from its own pre-call check, before it invokes
    // the runner it wraps, so the provider was never contacted and the call
    // provably cost nothing. Charging it let a chain of guards bill each other
    // for calls none of them made — and the phantom charge was indistinguishable
    // from real spend, so it exhausted a real cap.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const inner = withBudget(runnerReporting(MILLION_EACH), {
      maxCostPerCall: 0,
      pricing: PRICING,
    });
    const outer = withBudget(inner, {
      pricing: PRICING,
      budgets: [{ window: "hour", maxCost: 1_000_000, pricing: PRICING }],
    });

    await expect(outer(AGENT, "hello")).rejects.toThrow(BudgetExceededError);
    warn.mockRestore();

    expect(outer.getSpent("total")).toBe(0);
    expect(outer.getSpent("hour")).toBe(0);
    expect(outer.getFailedCallSpend("total")).toBe(0);
    expect(outer.getUnpricedCallCount()).toBe(0);
  });

  it("createConstraintRouter reports the failed-attempt charge separately", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const router = createConstraintRouter({
      providers: [{ name: "p", runner: runnerThrowing(), pricing: PRICING }],
      defaultProvider: "p",
    });

    await expect(router(AGENT, "hello")).rejects.toThrow();
    warn.mockRestore();

    expect(router.getFailedCallSpend()).toBe(router.facts.totalCost);
    expect(router.getFailedCallSpend()).toBeGreaterThan(0);
  });

  it("createConstraintRouter charges nothing when a nested guard blocked the call", async () => {
    // The same parity the rest of this file exists to keep: a guard present in
    // withBudget and absent here is, from the outside, no guard at all. A
    // totalCost that moves on a call the provider never saw makes a
    // `facts.totalCost > N` failover fire on spend that never happened.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const blocked = withBudget(runnerReporting(MILLION_EACH), {
      maxCostPerCall: 0,
      pricing: PRICING,
    });
    const router = createConstraintRouter({
      providers: [{ name: "p", runner: blocked, pricing: PRICING }],
      defaultProvider: "p",
    });

    await expect(router(AGENT, "hello")).rejects.toThrow(BudgetExceededError);
    warn.mockRestore();

    expect(router.facts.totalCost).toBe(0);
    expect(router.getFailedCallSpend()).toBe(0);
    expect(router.getUnpricedCallCount()).toBe(0);
    // The call still failed, and the routing constraints must be able to see it.
    expect(router.facts.errorCount).toBe(1);
  });

  it("createConstraintRouter leaves the failed figure at zero when calls succeed", async () => {
    const router = createConstraintRouter({
      providers: [
        { name: "p", runner: runnerReporting(MILLION_EACH), pricing: PRICING },
      ],
      defaultProvider: "p",
    });

    await router(AGENT, "hello");

    expect(router.facts.totalCost).toBeCloseTo(MILLION_EACH_COST, 10);
    expect(router.getFailedCallSpend()).toBe(0);
  });
});

// ============================================================================
// Rates inherited from the prototype are not rates the caller supplied
// ============================================================================

describe("prototype-supplied rates", () => {
  function withPollutedPrototype(value: number, body: () => void): void {
    Object.defineProperty(Object.prototype, "cacheReadPerMillion", {
      value,
      configurable: true,
      writable: true,
      enumerable: false,
    });
    try {
      body();
    } finally {
      // biome-ignore lint/performance/noDelete: restoring the prototype is the point
      delete (Object.prototype as Record<string, unknown>).cacheReadPerMillion;
    }
  }

  for (const surface of SURFACES) {
    it(`${surface.name}: an inherited 0 does not make cache tokens free`, async () => {
      // The tables that omit cache rates - openai, gemini, ollama - are exactly
      // the objects a polluted prototype reaches. Without an own-property gate,
      // `Object.prototype.cacheReadPerMillion = 0` defeats the never-free
      // guarantee for all of them at once.
      let built: BuiltSurface | undefined;
      withPollutedPrototype(0, () => {
        built = surface.build(
          PRICING,
          runnerReporting({
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 10_000_000,
          }),
        );
      });

      expect(await built!.run()).toBeCloseTo(30, 10);
    });

    it(`${surface.name}: an inherited negative rate does not break construction`, () => {
      withPollutedPrototype(-1, () => {
        expect(() => surface.build(PRICING, runnerReporting())).not.toThrow();
      });
    });
  }
});

// ============================================================================
// Counts inherited from the prototype are not counts the provider reported
// ============================================================================

describe("prototype-supplied token counts", () => {
  function withPollutedPrototype(
    field: string,
    value: number,
    body: () => void,
  ): void {
    Object.defineProperty(Object.prototype, field, {
      value,
      configurable: true,
      writable: true,
      enumerable: false,
    });
    try {
      body();
    } finally {
      Reflect.deleteProperty(Object.prototype, field);
    }
  }

  for (const surface of SURFACES) {
    it(`${surface.name}: an inherited NaN cache-write count does not downgrade a metered call`, async () => {
      // Every usage object that omits a cache-write count is reachable this
      // way. Ungated, one polluted key turned every metered call into the
      // estimate: an $180 call billed at a cent, uniformly, silently.
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      let built: BuiltSurface | undefined;
      withPollutedPrototype("cacheWriteTokens", Number.NaN, () => {
        built = surface.build(PRICING, runnerReporting(MILLION_EACH));
      });

      const spent = await built!.run();
      warn.mockRestore();

      expect(spent).toBeCloseTo(MILLION_EACH_COST, 10);
      expect(built!.unpricedCalls()).toBe(0);
    });

    it(`${surface.name}: an inherited cache-read count does not inflate the bill`, async () => {
      // The mirror of the same hole: a large inherited count bills every call
      // for tokens nobody consumed, and every configured cap trips at once.
      let built: BuiltSurface | undefined;
      withPollutedPrototype("cacheReadTokens", 1e15, () => {
        built = surface.build(PRICING, runnerReporting(MILLION_EACH));
      });

      expect(await built!.run()).toBeCloseTo(MILLION_EACH_COST, 10);
    });
  }

  it("an inherited cacheRead rate does not zero a published table", async () => {
    // The documented JSON-table path. Ungated, `Object.prototype.cacheRead = 0`
    // gave every entry in every published table a zero cache-read rate, and a
    // hundred million cached tokens billed nothing.
    let table: Record<string, ModelPricing> | undefined;
    withPollutedPrototype("cacheRead", 0, () => {
      table = toTokenPricingTable({ m: { input: 3, output: 15 } });
    });

    const runner = withBudget(
      runnerReporting({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 100_000_000,
      }),
      { pricing: table!.m },
    );
    await runner(AGENT, "hello");

    // Absent means "same as input" — conservative, and never free.
    expect(runner.getSpent("total")).toBeCloseTo(300, 10);
  });

  it("an inherited cacheWrite rate does not brick table construction", () => {
    withPollutedPrototype("cacheWrite", -1, () => {
      const table = toTokenPricingTable({ m: { input: 3, output: 15 } });

      expect(() =>
        withBudget(runnerReporting(), { pricing: table.m }),
      ).not.toThrow();
    });
  });

  it("a published entry does not answer a rate off the prototype", () => {
    // The table was built before the pollution, so the read-time gate on the
    // way *in* cannot help. This is the documented `estimateCost(tokens,
    // rates.cacheRead)` path, which reads the field directly rather than
    // through a guard — the internal path was covered and the exported one,
    // which is the reason to publish a table at all, was not.
    const entry = toTokenPricingTable({ m: { input: 3, output: 15 } }).m!;

    withPollutedPrototype("cacheRead", 0, () => {
      expect(entry.cacheRead).toBeUndefined();
      expect(estimateCost(100_000_000, entry.cacheRead ?? entry.input)).toBe(
        300,
      );
    });
  });

  it("a published entry answers no inherited key at all", () => {
    // Not only the rates: the entry is a null-prototype object, so nothing
    // reaches it through `Object.prototype` — including a key added long after
    // the table was built.
    const entry = toTokenPricingTable({ m: { input: 3, output: 15 } }).m!;

    withPollutedPrototype("cacheWritePerMillion", 0, () => {
      expect(entry.cacheWritePerMillion).toBeUndefined();
    });
  });
});

// ============================================================================
// A token count is a non-negative integer, or it is not a count
// ============================================================================

describe("token counts that are not counts", () => {
  it("refuses a cache count reported as a string rather than zeroing it", async () => {
    // The asymmetry this closes: a non-numeric `inputTokens` was already
    // refused, while a non-numeric `cacheReadTokens` read as absent and
    // therefore as zero. Ten million cached tokens billed $0.00105 instead of
    // ~$30, labelled "metered", with the unpriced counter left at zero.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const runner = withBudget(
      runnerReporting({
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: "10000000" as unknown as number,
      }),
      { pricing: PRICING },
    );

    await runner(AGENT, "hello");
    const notices = warn.mock.calls.map((call) => String(call[0]));
    warn.mockRestore();

    expect(runner.getUnpricedCallCount()).toBe(1);
    expect(
      notices.filter((notice) => notice.includes("not a non-negative integer")),
    ).toHaveLength(1);
  });

  it("refuses a subnormal count that would otherwise bill nothing", async () => {
    // `5e-324` is finite, positive, and not zero, so it passed the finiteness
    // check *and* defeated the all-zero check that exists to catch a call
    // priced at nothing. Both guards held; the call still billed zero.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const runner = withBudget(
      runnerReporting({
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 5e-324,
      }),
      { pricing: PRICING },
    );

    await runner(AGENT, "hello");
    warn.mockRestore();

    expect(runner.getSpent("total")).toBeGreaterThan(0);
    expect(runner.getUnpricedCallCount()).toBe(1);
  });

  it("refuses a fractional count", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const runner = withBudget(
      runnerReporting({ inputTokens: 100.5, outputTokens: 50 }),
      { pricing: PRICING },
    );

    await runner(AGENT, "hello");
    warn.mockRestore();

    expect(runner.getUnpricedCallCount()).toBe(1);
  });

  it("still prices an ordinary whole-token report from usage", async () => {
    const runner = withBudget(runnerReporting(MILLION_EACH), {
      pricing: PRICING,
    });

    await runner(AGENT, "hello");

    expect(runner.getSpent("total")).toBeCloseTo(MILLION_EACH_COST, 10);
    expect(runner.getUnpricedCallCount()).toBe(0);
  });
});

// ============================================================================
// Budgets that share a window must agree on what a call costs
// ============================================================================

describe("budgets sharing a window", () => {
  it("rejects two budgets on one window with different rates", () => {
    // One ledger, one price. Recorded at the first budget's rates, fifty calls
    // costing $4,500 read as ten cents against a $100 cap that never tripped.
    expect(() =>
      withBudget(runnerReporting(MILLION_EACH), {
        budgets: [
          {
            window: "hour",
            maxCost: 1_000_000,
            pricing: { inputPerMillion: 0.001, outputPerMillion: 0.001 },
          },
          {
            window: "hour",
            maxCost: 100,
            pricing: { inputPerMillion: 15, outputPerMillion: 75 },
          },
        ],
      }),
    ).toThrow(/shares the "hour" window .* prices it differently/s);
  });

  it("accepts two budgets on one window at identical rates", () => {
    expect(() =>
      withBudget(runnerReporting(MILLION_EACH), {
        budgets: [
          { window: "hour", maxCost: 1_000, pricing: PRICING },
          { window: "hour", maxCost: 100, pricing: { ...PRICING } },
        ],
      }),
    ).not.toThrow();
  });

  it("treats a differing cache rate as differing rates", () => {
    // The cache rates price real tokens. Two budgets that agree on input and
    // output but not on cache reads still record two different figures.
    expect(() =>
      withBudget(runnerReporting(MILLION_EACH), {
        budgets: [
          { window: "day", maxCost: 1_000, pricing: PRICING },
          {
            window: "day",
            maxCost: 100,
            pricing: { ...PRICING, cacheReadPerMillion: 0.3 },
          },
        ],
      }),
    ).toThrow(/\[Directive\]/);
  });

  it("leaves budgets on different windows alone", () => {
    expect(() =>
      withBudget(runnerReporting(MILLION_EACH), {
        budgets: [
          { window: "hour", maxCost: 100, pricing: PRICING },
          {
            window: "day",
            maxCost: 1_000,
            pricing: { inputPerMillion: 15, outputPerMillion: 75 },
          },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects a top-level pricing that disagrees with a window", () => {
    // The same shape, one field over. `pricing` drives maxCostPerCall and the
    // lifetime total while the window's rates drive that window's ledger, so
    // this configuration reported getSpent("hour") of $450 beside a
    // getSpent("total") of a cent for the same run — and maxCostPerCall
    // estimated fifteen thousand times low, which is a cap that cannot trip.
    expect(() =>
      withBudget(runnerReporting(MILLION_EACH), {
        maxCostPerCall: 1,
        pricing: { inputPerMillion: 0.001, outputPerMillion: 0.001 },
        budgets: [
          {
            window: "hour",
            maxCost: 1_000,
            pricing: { inputPerMillion: 15, outputPerMillion: 75 },
          },
        ],
      }),
    ).toThrow(/pricing prices a call differently from budgets\["hour"\]/);
  });

  it("accepts a top-level pricing that matches every window", () => {
    expect(() =>
      withBudget(runnerReporting(MILLION_EACH), {
        maxCostPerCall: 1_000,
        pricing: PRICING,
        budgets: [
          { window: "hour", maxCost: 1_000, pricing: { ...PRICING } },
          { window: "day", maxCost: 10_000, pricing: { ...PRICING } },
        ],
      }),
    ).not.toThrow();
  });

  it("leaves a runner with no window budgets alone", () => {
    expect(() =>
      withBudget(runnerReporting(MILLION_EACH), {
        maxCostPerCall: 1,
        pricing: PRICING,
      }),
    ).not.toThrow();
  });
});

// ============================================================================
// A model with no row fails at the lookup, naming the model
// ============================================================================

describe("requireModelPricing", () => {
  const TABLE = toTokenPricingTable(
    { "known-model": { input: 3, output: 15 } },
    "TEST_PRICING",
  );

  it("returns the row when there is one", () => {
    expect(requireModelPricing(TABLE, "known-model").inputPerMillion).toBe(3);
  });

  it("names the model, the table, and what is in it", () => {
    // `TABLE["missing"]` is `undefined`, and undefined pricing surfaced much
    // later as a complaint about a missing rate — naming the field but not the
    // model, the table, or the actual mistake.
    expect(() => requireModelPricing(TABLE, "missing-model")).toThrow(
      /"missing-model".*TEST_PRICING.*known-model/s,
    );
  });

  it("does not answer from the prototype", () => {
    Object.defineProperty(Object.prototype, "ghost-model", {
      value: { inputPerMillion: 0, outputPerMillion: 0 },
      configurable: true,
      enumerable: false,
    });
    try {
      expect(() => requireModelPricing(TABLE, "ghost-model")).toThrow(
        /\[Directive\]/,
      );
    } finally {
      Reflect.deleteProperty(Object.prototype, "ghost-model");
    }
  });

  it("still fails usefully when pricing is threaded through as undefined", () => {
    expect(() =>
      withBudget(runnerReporting(), {
        budgets: [
          {
            window: "hour",
            maxCost: 10,
            pricing: undefined as unknown as TokenPricing,
          },
        ],
      }),
    ).toThrow(/requireModelPricing/);
  });
});

// ============================================================================
// The registry is enforced, not remembered
// ============================================================================

/**
 * Whether a module's source reads the shapes this battery guards.
 *
 * **Detection is by data shape, not by helper name.** Matching the guarded
 * helpers finds every module that already uses them — which is exactly the set
 * that does not need finding. The surfaces that went unguarded are the ones
 * that never imported a helper: a metrics counter reading `result.cost` bare,
 * two orchestrators reading `result.tokenUsage?.inputTokens ?? 0` inline. Both
 * sat inside modules the helper scan already matched, so the module-level
 * answer was "covered" while the read next door was not.
 *
 * So the field names are the signal: reading `.cost` or `.tokenUsage` or any
 * token count off an object is the thing that needs a guard, whatever the
 * module imports. Matched as a property access (`.field`, `?.field`,
 * `["field"]`) rather than as a bare word, so a local variable or a comment
 * that happens to say "cost" does not register.
 *
 * Probed by its own tests below: a scanner nobody probes is a scanner that
 * quietly stops matching.
 */
function readsGuardedShapes(source: string): boolean {
  // Reading a field that carries money or tokens off some object. This is the
  // primary detector — the other two are backstops for modules that hold the
  // shapes without dereferencing them.
  const FIELD_READS =
    /(\.|\["|\[')(cost|tokenUsage|inputTokens|outputTokens|cacheReadTokens|cacheCreationTokens|cacheWriteTokens)\b/;
  // Any import of a cost-path helper or type, however it is spelled.
  const HELPERS =
    /\b(snapshotTokenPricing|snapshotCallUsage|priceCall|estimateCallCost|estimateInputRate|isZeroRated|describeUnpricedReason|requireModelPricing|toTokenPricingTable|normalizeTokenUsage|readOwnNumber)\b/;
  // Any mention of a rate or usage type.
  const SHAPES =
    /\b(TokenPricing|ModelPricing|BareTokenRates|ResolvedPricing|ResolvedUsage|UsageSnapshot|PricedCall|UnpricedReason)\b/;

  return (
    FIELD_READS.test(source) || HELPERS.test(source) || SHAPES.test(source)
  );
}

/** Every `.ts` module under a directory, recursively, tests excluded. */
function sourceModules(root: string): string[] {
  const found: string[] = [];

  function walk(relative: string): void {
    for (const entry of readdirSync(`${root}${relative}`, {
      withFileTypes: true,
    })) {
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__" && entry.name !== "node_modules") {
          walk(`${relative}${entry.name}/`);
        }
        continue;
      }
      if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
        found.push(`${relative}${entry.name}`);
      }
    }
  }

  walk("");

  return found;
}

describe("pricing surface registry", () => {
  /**
   * Modules that touch the guarded shapes without enforcing anything, and so
   * have no surface to register.
   *
   * Every entry carries the reason it does not count. The list is meant to stay
   * short and to be read, not skimmed: "it's fine, that one doesn't count" is
   * precisely how the last surface came to be missing.
   */
  const NOT_A_SURFACE = new Map<string, string>([
    [
      "ai:pricing.ts",
      "Defines the shapes and owns the policy every surface calls into. It is the thing being enforced, not a place enforcement could be missing.",
    ],
    [
      "ai:index.ts",
      "Re-exports the public names. Prices nothing, reads nothing.",
    ],
    [
      "ai:types.ts",
      "Declares TokenUsage. Carries the field names but never reads them.",
    ],
    [
      "ai:agent-utils.ts",
      "Copies provider-reported cache counts onto TokenUsage while building a RunResult. It transports counts; it never turns them into money or metrics, and the surface that does re-reads nothing from it.",
    ],
    [
      "ai:adapters/anthropic.ts",
      "Publishes a rate table via toTokenPricingTable and forwards the provider's cache counts onto TokenUsage. Both are inputs to the cost path, validated by whichever surface consumes them; the adapter enforces no cap and keeps no ledger.",
    ],
    [
      "ai:adapters/shared.ts",
      "Copies a provider response's input/output counts onto TokenUsage while assembling a streaming RunResult. Pure transport, like agent-utils.ts: it moves counts, and the surface that bills them re-reads nothing from here.",
    ],
    [
      "ai:adapters/openai.ts",
      "Publishes a rate table via toTokenPricingTable. No cap, no ledger, no metrics.",
    ],
    [
      "ai:adapters/gemini.ts",
      "Publishes a rate table via toTokenPricingTable. No cap, no ledger, no metrics.",
    ],
    [
      "ai:adapters/ollama.ts",
      "Publishes an all-zero rate table via toTokenPricingTable — local models bill nothing. No cap, no ledger, no metrics.",
    ],
    [
      "ai:structured-output.ts",
      "Sums token counts across the attempts one call makes when a model's answer will not parse, so the caller learns what the whole call cost rather than what its last attempt cost. It holds no rates, keeps no ledger, and charges nothing — a surface downstream prices the total it reports. Reads through normalizeTokenUsage rather than off the object, so the two cache-write spellings are reconciled in the one place that owns that rule.",
    ],
    [
      "ai:streaming.ts",
      "Matched on the phrase `result.tokenUsage` in the doc comment that tells callers a chunk ordinal is not a token count. It reads no count and holds no rate: chunks carry text and an ordinal, and the authoritative usage lives on the awaited RunResult the surfaces above already read.",
    ],
    [
      "ai:debug-timeline.ts",
      "Owns timelineTokenCounts, which resolves a provider usage into the four counts an agent_complete event carries. Like token-usage.ts it is the guard, not a place one could be missing — and it charges nothing, since a timeline reports what happened rather than gating it.",
    ],
    [
      "ai:agent-orchestrator.ts",
      "Reads token counts for two things, neither of which is money: the debug timeline, via timelineTokenCounts, and a maxTokenBudget cap counted in tokens. It accepts no pricing and keeps no ledger, so there are no rates here to validate and no dollar total to corrupt.",
    ],
    [
      "ai:multi-agent-orchestrator.ts",
      "Same shape as agent-orchestrator.ts, per agent: timeline counts through timelineTokenCounts and a token-denominated budget. No rates, no ledger, no dollars.",
    ],
    [
      "ai:builtin-guardrails.ts",
      "Reads facts.agent.tokenUsage, which despite the name is a running token count on the fact store rather than a provider usage object. Compares it to a token budget; never sees rates or dollars.",
    ],
    [
      "ai:testing.ts",
      "Asserts on the same facts.agent.tokenUsage running count in test helpers. Reads a number that a surface already recorded; records nothing itself.",
    ],
    [
      "core:plugins/token-usage.ts",
      "Owns normalizeTokenUsage and readOwnNumber, the one function that reconciles the two cache-write spellings and the one door untrusted numbers arrive through. Like pricing.ts, it is the thing being enforced.",
    ],
    [
      "core:plugins/index.ts",
      "Re-exports the plugin surface, normalizeTokenUsage among it. Reads nothing.",
    ],
  ]);

  /**
   * Surfaces outside `@directive-run/ai` that consume token usage.
   *
   * The scan stops at a package boundary only if you let it, and letting it is
   * how a metrics surface in `@directive-run/core` came to accept one spelling
   * of the cache-write count while every shipped adapter emitted the other.
   */
  const CROSS_PACKAGE_SURFACES = new Set(["core:plugins/observability.ts"]);

  function scan(root: string, prefix: string): string[] {
    return sourceModules(root)
      .filter((name) =>
        readsGuardedShapes(readFileSync(`${root}${name}`, "utf8")),
      )
      .map((name) => `${prefix}:${name}`);
  }

  it("every module that reads a guarded shape is registered", () => {
    const aiRoot = fileURLToPath(new URL("../", import.meta.url));
    const coreRoot = fileURLToPath(
      new URL("../../../core/src/", import.meta.url),
    );

    const readers = [...scan(aiRoot, "ai"), ...scan(coreRoot, "core")];

    // Sanity: a scan that finds nothing proves nothing. The recursive walk has
    // to reach a subdirectory and the cross-package walk has to reach core.
    expect(readers).toContain("ai:adapters/anthropic.ts");
    expect(readers).toContain("core:plugins/observability.ts");

    const covered = new Set(SURFACES.map((surface) => `ai:${surface.module}`));
    const unregistered = readers.filter(
      (name) =>
        !covered.has(name) &&
        !NOT_A_SURFACE.has(name) &&
        !CROSS_PACKAGE_SURFACES.has(name),
    );

    expect(unregistered).toEqual([]);
  });

  it("every registered surface module exists", () => {
    const aiRoot = fileURLToPath(new URL("../", import.meta.url));
    const modules = new Set(sourceModules(aiRoot));

    for (const surface of SURFACES) {
      expect(modules.has(surface.module)).toBe(true);
    }
  });

  it("every NOT_A_SURFACE entry still exists and still reads a guarded shape", () => {
    // An exemption for a module that no longer reads anything is dead weight
    // that makes the list harder to take seriously.
    const roots: Record<string, string> = {
      ai: fileURLToPath(new URL("../", import.meta.url)),
      core: fileURLToPath(new URL("../../../core/src/", import.meta.url)),
    };

    for (const [entry, reason] of NOT_A_SURFACE) {
      const [prefix, module] = entry.split(":");
      const source = readFileSync(`${roots[prefix!]}${module}`, "utf8");
      expect(`${entry}: ${readsGuardedShapes(source)}`).toBe(`${entry}: true`);
      expect(reason.length).toBeGreaterThan(40);
    }
  });
});

describe("the surface scanner itself", () => {
  it("flags a module that imports the pricing helpers", () => {
    const decoy = `
      import { priceCall, snapshotTokenPricing } from "./pricing.js";
      export function chargeSomething() { return priceCall; }
    `;

    expect(readsGuardedShapes(decoy)).toBe(true);
  });

  it("flags a module typed indirectly, without naming the pricing type", () => {
    // The scan that only matched the type name let this through. It takes the
    // exact same object every registered surface takes.
    const decoy = `
      import { snapshotTokenPricing } from "./pricing.js";
      export function guard(rates: Parameters<typeof snapshotTokenPricing>[0]) {
        return rates;
      }
    `;

    expect(readsGuardedShapes(decoy)).toBe(true);
    expect(/\bTokenPricing\b/.test(decoy)).toBe(false);
  });

  it("flags a module that reads cache token counts for metrics rather than money", () => {
    // No pricing type, no pricing import — and this is exactly the shape of the
    // surface that under-reported a cached run by its whole cached prefix.
    const decoy = `
      export function report(usage: { cacheCreationTokens?: number }) {
        return usage.cacheCreationTokens ?? 0;
      }
    `;

    expect(readsGuardedShapes(decoy)).toBe(true);
  });

  it("flags a bare cost read that imports no helper at all", () => {
    // The shape the helper-name scan could not see: no pricing import, no
    // pricing type, no token field. Just a dollar amount off an object the
    // caller supplied, added to a cumulative counter.
    const decoy = `
      export function track(result: { cost?: number }) {
        if (result.cost !== undefined) {
          increment("agent.cost", result.cost);
        }
      }
    `;

    expect(readsGuardedShapes(decoy)).toBe(true);
  });

  it("flags an inline token read that drops the cache classes", () => {
    // Two live modules read exactly this and reported cached runs as tiny.
    const decoy = `
      export function record(result: { tokenUsage?: { inputTokens: number } }) {
        return { inputTokens: result.tokenUsage?.inputTokens ?? 0 };
      }
    `;

    expect(readsGuardedShapes(decoy)).toBe(true);
  });

  it("flags a bracket-notation read the dot-access pattern would miss", () => {
    const decoy = `
      export function total(result: Record<string, number>) {
        return result["cost"] + result['outputTokens'];
      }
    `;

    expect(readsGuardedShapes(decoy)).toBe(true);
  });

  it("does not flag a local named for a guarded field", () => {
    // Matching bare words would flag this, and every module that mentions cost
    // in a comment — a scan that flags everything is one nobody maintains.
    const innocent = `
      export function summarize(items: string[]): string {
        const cost = items.length;
        const inputTokens = cost * 2;

        return \`\${cost}/\${inputTokens}\`;
      }
    `;

    expect(readsGuardedShapes(innocent)).toBe(false);
  });

  it("does not flag a module with nothing to do with cost", () => {
    const innocent = `
      export function greet(name: string): string {
        return \`hello \${name}\`;
      }
    `;

    expect(readsGuardedShapes(innocent)).toBe(false);
  });
});

// ============================================================================
// The result shape a caller cannot drop on the floor
// ============================================================================

describe("PricedCall", () => {
  it("has no variant that means nothing to bill", () => {
    // @ts-expect-error - every PricedCall carries a cost. The defect this shape
    // replaces was a caller reading a null and returning 0.
    const nothingToBill: PricedCall = { basis: "unpriced" };

    expect(nothingToBill).toBeDefined();
  });

  it("forces a caller to say which basis it handled", () => {
    const priced = {
      basis: "estimated",
      cost: 1,
      reason: "missing-usage",
    } as PricedCall;

    // @ts-expect-error - `reason` exists only on the estimated branch, so a
    // caller cannot read it without first narrowing on `basis`.
    const reason = priced.reason;

    expect(reason).toBe("missing-usage");
  });
});
