/**
 * Pins the interop between the adapter pricing tables and the cost surfaces
 * that consume them.
 *
 * Every adapter used to publish its rates twice: `{ input, output }` for
 * `estimateCost`, and `{ inputPerMillion, outputPerMillion }` for `withBudget`
 * and `createConstraintRouter`. Same numbers, different field names — so
 * handing a `*_PRICING` entry to a budget left both rate fields `undefined`,
 * every cost computed to `NaN`, every `estimated > remaining` comparison came
 * out `false`, and the budget never tripped. Spend was unbounded precisely when
 * the caller believed it was capped, and nothing in the logs said so.
 *
 * The split is gone. Each entry now carries both field pairs, derived from one
 * source, so there is no wrong constant to grab and no second list of rates to
 * drift. These tests hold that: every table entry works with every consumer,
 * and the two pairs always agree.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  ANTHROPIC_PRICING,
  ANTHROPIC_TOKEN_PRICING,
} from "../adapters/anthropic.js";
import { GEMINI_PRICING, GEMINI_TOKEN_PRICING } from "../adapters/gemini.js";
import { OLLAMA_PRICING, OLLAMA_TOKEN_PRICING } from "../adapters/ollama.js";
import { OPENAI_PRICING, OPENAI_TOKEN_PRICING } from "../adapters/openai.js";
import * as adapterShared from "../adapters/shared.js";
import { estimateCost } from "../agent-utils.js";
import { toTokenPricingTable, withBudget } from "../budget.js";
import { createConstraintRouter } from "../provider-routing.js";
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
  ANTHROPIC: { table: ANTHROPIC_PRICING, alias: ANTHROPIC_TOKEN_PRICING },
  OPENAI: { table: OPENAI_PRICING, alias: OPENAI_TOKEN_PRICING },
  GEMINI: { table: GEMINI_PRICING, alias: GEMINI_TOKEN_PRICING },
  OLLAMA: { table: OLLAMA_PRICING, alias: OLLAMA_TOKEN_PRICING },
};

describe("provider pricing tables carry both field pairs", () => {
  for (const [provider, { table, alias }] of Object.entries(TABLES)) {
    describe(provider, () => {
      it("exposes a non-empty table", () => {
        expect(Object.keys(table).length).toBeGreaterThan(0);
      });

      it("every entry carries both spellings of every rate it publishes", () => {
        for (const [model, rates] of Object.entries(table)) {
          expect(
            rates,
            `${provider}_PRICING[${model}] should carry both field pairs`,
          ).toEqual({
            input: rates.input,
            output: rates.output,
            inputPerMillion: rates.input,
            outputPerMillion: rates.output,
            ...(rates.cacheRead !== undefined
              ? {
                  cacheRead: rates.cacheRead,
                  cacheReadPerMillion: rates.cacheRead,
                }
              : {}),
            ...(rates.cacheWrite !== undefined
              ? {
                  cacheWrite: rates.cacheWrite,
                  cacheWritePerMillion: rates.cacheWrite,
                }
              : {}),
          });
          expect(typeof rates.input).toBe("number");
          expect(typeof rates.output).toBe("number");
        }
      });

      it("the table container itself is frozen and has no prototype", () => {
        // Freezing only the entries left the container swappable: replacing an
        // entry with an all-zero one passes validation (zero is legal for local
        // models) and leaves a configured cap permanently unreachable.
        expect(Object.isFrozen(table)).toBe(true);
        expect(Object.getPrototypeOf(table)).toBeNull();
      });

      it("every entry is frozen", () => {
        for (const [model, rates] of Object.entries(table)) {
          expect(Object.isFrozen(rates), `${provider}_PRICING[${model}]`).toBe(
            true,
          );
        }
      });

      it("*_TOKEN_PRICING is an alias for the same table, not a copy", () => {
        expect(alias).toBe(table);
      });

      it("every entry is accepted by withBudget with no conversion", () => {
        for (const [model, pricing] of Object.entries(table)) {
          expect(
            () =>
              withBudget(makeRunner(), {
                pricing,
                maxCostPerCall: 1,
                budgets: [{ window: "day", maxCost: 10, pricing }],
              }),
            `${provider}_PRICING[${model}] should be usable as-is`,
          ).not.toThrow();
        }
      });

      it("every entry feeds estimateCost with a finite result", () => {
        for (const [model, rates] of Object.entries(table)) {
          const cost =
            estimateCost(1_000_000, rates.input) +
            estimateCost(1_000_000, rates.output);
          expect(
            Number.isFinite(cost),
            `${provider}_PRICING[${model}] should price finitely`,
          ).toBe(true);
        }
      });

      it("every entry is accepted as constraint-router pricing", () => {
        for (const [model, pricing] of Object.entries(table)) {
          expect(
            () =>
              createConstraintRouter({
                providers: [{ name: model, runner: makeRunner(), pricing }],
                defaultProvider: model,
              }),
            `${provider}_PRICING[${model}] should route as-is`,
          ).not.toThrow();
        }
      });
    });
  }
});

describe("budget math is finite for real provider rates", () => {
  it("a real budget actually trips instead of comparing against NaN", async () => {
    const pricing = ANTHROPIC_PRICING["claude-opus-4-20250514"]!;
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
    const pricing = OLLAMA_PRICING.llama3!;
    const runner = withBudget(makeRunner(), {
      pricing,
      maxCostPerCall: 0,
    });

    await expect(
      runner({ name: "a", instructions: "" }, "x".repeat(10_000)),
    ).resolves.toBeDefined();
  });

  it("the router prices a call with the same table the budget uses", async () => {
    const pricing = ANTHROPIC_PRICING["claude-opus-4-20250514"]!;
    const inner = vi.fn(async () => ({
      output: "ok",
      messages: [],
      toolCalls: [],
      totalTokens: 2_000_000,
      tokenUsage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
    })) as unknown as AgentRunner;

    const router = createConstraintRouter({
      providers: [{ name: "anthropic", runner: inner, pricing }],
      defaultProvider: "anthropic",
    });

    await router({ name: "a", instructions: "" }, "hello");

    // $15/M input + $75/M output on 1M each.
    expect(router.facts.totalCost).toBeCloseTo(90, 10);
  });
});

describe("toTokenPricingTable lives with TokenPricing", () => {
  it("is exported from budget.ts, where the type it produces is declared", () => {
    expect(typeof toTokenPricingTable).toBe("function");
  });

  it("no longer sits in the adapters' SSE/HTTP plumbing module", () => {
    expect("toTokenPricingTable" in adapterShared).toBe(false);
  });

  it("widens a bare rate table into both field pairs", () => {
    const widened = toTokenPricingTable({
      "my-model": { input: 3, output: 15 },
    });

    expect(widened["my-model"]).toEqual({
      input: 3,
      output: 15,
      inputPerMillion: 3,
      outputPerMillion: 15,
    });
  });

  it("carries optional cache rates through under both spellings", () => {
    const widened = toTokenPricingTable({
      "my-model": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    });

    expect(widened["my-model"]).toEqual({
      input: 3,
      output: 15,
      inputPerMillion: 3,
      outputPerMillion: 15,
      cacheRead: 0.3,
      cacheReadPerMillion: 0.3,
      cacheWrite: 3.75,
      cacheWritePerMillion: 3.75,
    });
  });

  it("an own __proto__ key cannot reroute the table's prototype", () => {
    const fromJson = JSON.parse(
      '{"__proto__": {"input": 0, "output": 0}, "my-model": {"input": 3, "output": 15}}',
    ) as Record<string, { input: number; output: number }>;

    const widened = toTokenPricingTable(fromJson);

    expect(Object.getPrototypeOf(widened)).toBeNull();
    expect(widened["my-model"]?.inputPerMillion).toBe(3);
  });

  it("produces entries a budget accepts without conversion", () => {
    const widened = toTokenPricingTable({
      "my-model": { input: 3, output: 15 },
    });

    expect(() =>
      withBudget(makeRunner(), {
        maxCostPerCall: 1,
        pricing: widened["my-model"]!,
      }),
    ).not.toThrow();
  });
});

// ============================================================================
// Documented APIs must exist
// ============================================================================

describe("no phantom APIs are cited in docs or JSDoc", () => {
  // A routing helper that never existed was named in the README and in four
  // adapters' JSDoc as though it shipped; the real export is
  // `createConstraintRouter`. A reader following the docs got a
  // module-resolution error, which is the cheapest possible way to lose trust
  // in every other line of the same document.
  //
  // The name is assembled rather than written out so this file does not
  // register as its own violation.
  const PHANTOM = `with${"Provider"}Routing`;
  const packageRoot = fileURLToPath(new URL("../../", import.meta.url));

  function collectSourceFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== "node_modules" && entry !== "dist") {
          collectSourceFiles(full, acc);
        }
        continue;
      }
      if (entry.endsWith(".ts") || entry.endsWith(".md")) {
        acc.push(full);
      }
    }

    return acc;
  }

  it("the phantom routing helper appears nowhere in the shipped package", () => {
    const files = [
      ...collectSourceFiles(join(packageRoot, "src")),
      join(packageRoot, "README.md"),
    ];

    const offenders = files.filter((file) =>
      readFileSync(file, "utf8").includes(PHANTOM),
    );

    expect(offenders.map((file) => file.slice(packageRoot.length))).toEqual([]);
  });

  it("createConstraintRouter — the real export — is importable", () => {
    expect(typeof createConstraintRouter).toBe("function");
  });
});
