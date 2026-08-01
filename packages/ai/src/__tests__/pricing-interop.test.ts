/**
 * Pins the interop between the adapter pricing tables and `withBudget`.
 *
 * Every adapter publishes its rates twice: `{ input, output }` for
 * `estimateCost`, which takes a bare per-million rate, and
 * `{ inputPerMillion, outputPerMillion }` for `withBudget` and
 * `withProviderRouting`, which are typed against `TokenPricing`. The numbers
 * are the same — both are dollars per million tokens — so the only difference
 * is the field names.
 *
 * That made for a nasty failure mode. Handing a `*_PRICING` entry to
 * `withBudget` left both rate fields `undefined`, so every cost computed to
 * `NaN`, every `estimated > remaining` comparison comes out `false`, and the
 * budget never tripped. Spend was unbounded precisely when the caller believed
 * it was capped, and nothing in the logs said so.
 *
 * These tests hold both halves of the fix: the wrong shape now fails loudly at
 * construction, and the right shape composes with no conversion code in the
 * consumer.
 */

import { describe, expect, it, vi } from "vitest";
import {
  ANTHROPIC_PRICING,
  ANTHROPIC_TOKEN_PRICING,
} from "../adapters/anthropic.js";
import { GEMINI_PRICING, GEMINI_TOKEN_PRICING } from "../adapters/gemini.js";
import { OLLAMA_PRICING, OLLAMA_TOKEN_PRICING } from "../adapters/ollama.js";
import { OPENAI_PRICING, OPENAI_TOKEN_PRICING } from "../adapters/openai.js";
import { withBudget } from "../budget.js";
import type { AgentRunner } from "../types.js";

function makeRunner(): AgentRunner {
  return vi.fn(async () => ({
    output: "ok",
    messages: [],
    toolCalls: [],
    totalTokens: 0,
  })) as unknown as AgentRunner;
}

const TABLES = {
  ANTHROPIC: {
    legacy: ANTHROPIC_PRICING,
    tokenShaped: ANTHROPIC_TOKEN_PRICING,
  },
  OPENAI: { legacy: OPENAI_PRICING, tokenShaped: OPENAI_TOKEN_PRICING },
  GEMINI: { legacy: GEMINI_PRICING, tokenShaped: GEMINI_TOKEN_PRICING },
  OLLAMA: { legacy: OLLAMA_PRICING, tokenShaped: OLLAMA_TOKEN_PRICING },
};

describe("provider pricing tables compose with withBudget", () => {
  for (const [provider, { legacy, tokenShaped }] of Object.entries(TABLES)) {
    describe(provider, () => {
      it("exposes a non-empty TokenPricing table", () => {
        expect(Object.keys(tokenShaped).length).toBeGreaterThan(0);
      });

      it("carries the same rates as the estimateCost table", () => {
        for (const [model, rates] of Object.entries(legacy)) {
          expect(tokenShaped[model]).toEqual({
            inputPerMillion: rates.input,
            outputPerMillion: rates.output,
          });
        }
      });

      it("every model is accepted by withBudget with no conversion", () => {
        for (const [model, pricing] of Object.entries(tokenShaped)) {
          expect(
            () =>
              withBudget(makeRunner(), {
                pricing,
                maxCostPerCall: 1,
                budgets: [{ window: "day", maxCost: 10, pricing }],
              }),
            `${provider}_TOKEN_PRICING[${model}] should be usable as-is`,
          ).not.toThrow();
        }
      });

      it("the estimateCost table is rejected loudly, not silently", () => {
        const [model, rates] = Object.entries(legacy)[0]!;
        expect(
          () =>
            withBudget(makeRunner(), {
              pricing: rates as never,
              maxCostPerCall: 1,
            }),
          `${provider}_PRICING[${model}] should throw, not produce NaN costs`,
        ).toThrow(/TOKEN_PRICING/);
      });
    });
  }
});

describe("budget math is finite for real provider rates", () => {
  it("a real budget actually trips instead of comparing against NaN", async () => {
    const pricing = ANTHROPIC_TOKEN_PRICING["claude-opus-4-20250514"]!;
    const runner = withBudget(makeRunner(), {
      pricing,
      // Opus is $15/M input. A 400-char input estimates ~100 input tokens and,
      // at the default 1.0 output multiplier, ~100 output tokens — roughly
      // $0.009. A $0.0001 ceiling is comfortably below that.
      maxCostPerCall: 0.0001,
    });

    await expect(
      runner({ name: "a", instructions: "" }, "x".repeat(400)),
    ).rejects.toThrow(/Budget exceeded/);
  });

  it("zero-cost local models never trip a budget", async () => {
    const pricing = OLLAMA_TOKEN_PRICING.llama3!;
    const runner = withBudget(makeRunner(), {
      pricing,
      maxCostPerCall: 0,
    });

    await expect(
      runner({ name: "a", instructions: "" }, "x".repeat(10_000)),
    ).resolves.toBeDefined();
  });
});
