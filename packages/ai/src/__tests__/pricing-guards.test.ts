/**
 * One battery, run against every surface that turns caller-supplied rates into
 * dollars.
 *
 * The defenses these tests pin — reject a rate that cannot price anything,
 * copy the rates at construction rather than re-reading them per call, refuse
 * a token count that would poison a running total, bill all four token classes
 * — were each written for one call site and were each missing from the next.
 * A guard present in `withBudget` and absent in `createConstraintRouter` is not
 * half a guard; from the outside it is no guard at all, because the caller
 * cannot tell which surface they are holding.
 *
 * Adding a new pricing-taking surface means adding it to `SURFACES` below. If
 * it skipped any of this, these tests fail.
 */

import { describe, expect, it, vi } from "vitest";
import { type TokenPricing, withBudget } from "../budget.js";
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

/** A surface that accepts caller-supplied pricing and reports what it spent. */
interface PricingSurface {
  name: string;
  /** Build a callable that runs one call and returns the spend it recorded. */
  build: (pricing: TokenPricing, inner: AgentRunner) => () => Promise<number>;
}

const SURFACES: PricingSurface[] = [
  {
    name: "withBudget config.pricing",
    build: (pricing, inner) => {
      const runner = withBudget(inner, { pricing });

      return async () => {
        await runner(AGENT, "hello");

        return runner.getSpent("total");
      };
    },
  },
  {
    name: "withBudget budgets[].pricing",
    build: (pricing, inner) => {
      const runner = withBudget(inner, {
        budgets: [{ window: "hour", maxCost: 1_000_000, pricing }],
      });

      return async () => {
        await runner(AGENT, "hello");

        return runner.getSpent("hour");
      };
    },
  },
  {
    name: "createConstraintRouter providers[].pricing",
    build: (pricing, inner) => {
      const router = createConstraintRouter({
        providers: [{ name: "p", runner: inner, pricing }],
        defaultProvider: "p",
      });

      return async () => {
        await router(AGENT, "hello");

        return router.facts.totalCost;
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
      const run = surface.build(mutable, runnerReporting(MILLION_EACH));

      mutable.inputPerMillion = Number.NaN;
      mutable.outputPerMillion = Number.NaN;

      expect(await run()).toBeCloseTo(MILLION_EACH_COST, 10);
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
      const run = surface.build(sneaky, runnerReporting(MILLION_EACH));
      const readsAfterConstruction = reads;

      expect(await run()).toBeCloseTo(MILLION_EACH_COST, 10);
      expect(reads).toBe(readsAfterConstruction);
    });

    it("a poisoned token count never lands in the total", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const run = surface.build(
        PRICING,
        runnerReporting({ inputTokens: Number.NaN, outputTokens: 50 }),
      );

      const spent = await run();

      expect(Number.isFinite(spent)).toBe(true);
      warn.mockRestore();
    });

    it("a poisoned cache token count is caught too, not just input and output", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const run = surface.build(
        PRICING,
        runnerReporting({
          inputTokens: 100,
          outputTokens: 50,
          cacheCreationTokens: Number.NEGATIVE_INFINITY,
        }),
      );

      const spent = await run();

      expect(Number.isFinite(spent)).toBe(true);
      warn.mockRestore();
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

      expect(await withCache()).toBeGreaterThan(await withoutCache());
    });

    it("prices cache tokens at the input rate when no cache rate is published", async () => {
      // Absent means "same as input" — conservative, and never free. Free is
      // the one answer that is always wrong: the provider bills them.
      const run = surface.build(
        PRICING,
        runnerReporting({
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 1_000_000,
          cacheCreationTokens: 1_000_000,
        }),
      );

      expect(await run()).toBeCloseTo(6, 10);
    });

    it("honors published cache rates over the input-rate default", async () => {
      const run = surface.build(
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

      expect(await run()).toBeCloseTo(4.05, 10);
    });

    it("an overflowing cost is never recorded as Infinity", async () => {
      // Rates and token counts both pass validation, but their product can
      // still overflow. One Infinity in a running total is permanent: every
      // later reading is Infinity and the surface never recovers. Blocking the
      // call outright is a fine outcome; recording Infinity is not.
      const run = surface.build(
        {
          inputPerMillion: Number.MAX_VALUE,
          outputPerMillion: Number.MAX_VALUE,
        },
        runnerReporting(MILLION_EACH),
      );

      let spent = 0;
      try {
        spent = await run();
      } catch {
        /* a pre-call block is fail-closed, and leaves nothing to record */
      }

      expect(Number.isFinite(spent)).toBe(true);
    });
  });
}
