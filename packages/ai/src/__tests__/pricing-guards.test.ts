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
import { type TokenPricing, withBudget } from "../budget.js";
import type { PricedCall } from "../pricing.js";
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
// The registry is enforced, not remembered
// ============================================================================

describe("pricing surface registry", () => {
  /**
   * Modules that name the pricing type without pricing a call, and so have no
   * surface to register. Each is here on purpose; the list is short by design,
   * because "it's fine, that one doesn't count" is how the last surface came to
   * be missing.
   */
  const NOT_A_SURFACE = new Set([
    // Defines the type and owns the shared policy every surface calls into.
    "pricing.ts",
    // Re-exports the public names; prices nothing itself.
    "index.ts",
  ]);

  it("every module that takes a pricing object is covered by SURFACES", () => {
    const sourceDir = fileURLToPath(new URL("../", import.meta.url));
    const covered = new Set(SURFACES.map((surface) => surface.module));

    const pricingModules = readdirSync(sourceDir)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".d.ts"))
      .filter((name) =>
        /\bTokenPricing\b/.test(readFileSync(`${sourceDir}${name}`, "utf8")),
      );

    // Sanity: the scan itself has to find something, or it proves nothing.
    expect(pricingModules.length).toBeGreaterThan(0);

    const unregistered = pricingModules.filter(
      (name) => !covered.has(name) && !NOT_A_SURFACE.has(name),
    );

    expect(unregistered).toEqual([]);
  });

  it("every registered surface module exists", () => {
    const sourceDir = fileURLToPath(new URL("../", import.meta.url));
    const files = new Set(readdirSync(sourceDir));

    for (const surface of SURFACES) {
      expect(files.has(surface.module)).toBe(true);
    }
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
