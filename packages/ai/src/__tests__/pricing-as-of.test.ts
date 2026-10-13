/**
 * Every published rate table carries the date it was last checked, and this
 * refuses to let a rate move without the date moving with it.
 *
 * A rate change is the quietest defect in the package. Nothing throws, nothing
 * is missing, no shape changes — every cost this package reports simply drifts
 * by a constant factor, in the same direction, for every caller. There was no
 * constant to compare against, so there was nothing a check could hold onto.
 *
 * The fingerprints below are that constant. They are not a second copy of the
 * rates to keep in sync by hand: changing a rate is *expected* to fail this
 * test, and the fix is to update the fingerprint and the `AS_OF` date in the
 * same commit, which is precisely the moment a human should be looking at what
 * the new number costs.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ANTHROPIC_PRICING,
  ANTHROPIC_PRICING_AS_OF,
} from "../adapters/anthropic.js";
import { GEMINI_PRICING, GEMINI_PRICING_AS_OF } from "../adapters/gemini.js";
import { OLLAMA_PRICING, OLLAMA_PRICING_AS_OF } from "../adapters/ollama.js";
import { OPENAI_PRICING, OPENAI_PRICING_AS_OF } from "../adapters/openai.js";
import type { ModelPricing } from "../pricing.js";

/**
 * A stable digest of every model and every rate in a table.
 *
 * Sorted by model name so a reordering is not mistaken for a repricing, and
 * built from the numbers themselves so an added model, a removed model, or a
 * single changed digit all move it.
 */
function fingerprint(table: Record<string, ModelPricing>): string {
  const rows = Object.keys(table)
    .sort()
    .map((model) => {
      const rates = table[model]!;

      return [
        model,
        rates.input,
        rates.output,
        rates.cacheRead ?? "-",
        rates.cacheWrite ?? "-",
      ].join(":");
    });

  return createHash("sha256").update(rows.join("|")).digest("hex").slice(0, 16);
}

const TABLES = [
  {
    name: "ANTHROPIC_PRICING",
    table: ANTHROPIC_PRICING,
    asOf: ANTHROPIC_PRICING_AS_OF,
    fingerprint: "",
  },
  {
    name: "OPENAI_PRICING",
    table: OPENAI_PRICING,
    asOf: OPENAI_PRICING_AS_OF,
    fingerprint: "",
  },
  {
    name: "GEMINI_PRICING",
    table: GEMINI_PRICING,
    asOf: GEMINI_PRICING_AS_OF,
    fingerprint: "",
  },
  {
    name: "OLLAMA_PRICING",
    table: OLLAMA_PRICING,
    asOf: OLLAMA_PRICING_AS_OF,
    fingerprint: "",
  },
];

describe("published rate tables", () => {
  /**
   * How long a checked-on date may stand before it stops meaning anything.
   *
   * The date says a person compared these numbers to the provider's page. That
   * claim decays: providers reprice, retire models, and end promotional rates,
   * and none of it produces a signal here. Without a ceiling the date ages
   * silently and a table checked once keeps asserting freshness forever —
   * which is how four wrong rates shipped under a same-day claim.
   *
   * Ninety days is a working guess, not a derived number. The point is that
   * the claim expires at all.
   */
  const MAX_AGE_DAYS = 90;

  it.each(TABLES)(
    "$name was checked recently enough to mean it",
    ({ asOf }) => {
      const ageDays = (Date.now() - Date.parse(asOf)) / 86_400_000;

      expect(
        ageDays,
        `${asOf} is ${Math.round(ageDays)} days old. Re-check this table against the provider's pricing page, correct any rate that moved, then update both the date and the pinned digest.`,
      ).toBeLessThan(MAX_AGE_DAYS);
    },
  );

  it.each(TABLES)("$name carries a plausible checked-on date", ({ asOf }) => {
    expect(asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const checked = Date.parse(asOf);
    expect(Number.isNaN(checked)).toBe(false);

    // A date in the future means someone typed it rather than looked.
    expect(checked).toBeLessThanOrEqual(Date.now());
  });

  it.each(TABLES)("$name is not empty", ({ table }) => {
    expect(Object.keys(table).length).toBeGreaterThan(0);
  });

  it.each(TABLES)("$name prices every model it lists", ({ table }) => {
    for (const [model, rates] of Object.entries(table)) {
      expect(Number.isFinite(rates.input), `${model} input rate`).toBe(true);
      expect(Number.isFinite(rates.output), `${model} output rate`).toBe(true);
      expect(rates.input, `${model} input rate`).toBeGreaterThanOrEqual(0);
      expect(rates.output, `${model} output rate`).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("a rate cannot move without its date moving", () => {
  // Regenerate with the value the failure prints, and move the matching
  // `_PRICING_AS_OF` in the same commit.
  // Literals on purpose. Computing these from the same tables they check would
  // make them agree with anything, which is the failure this whole file is
  // about: a check that cannot go red is not a check.
  const PINNED: Record<string, string> = {
    ANTHROPIC_PRICING: "5fd4d231ad8f25a2",
    OPENAI_PRICING: "5dacdbb0a433f50a",
    GEMINI_PRICING: "38cc87759ab22df0",
    OLLAMA_PRICING: "f81daede7c795e7c",
  };

  it.each(TABLES)("$name matches its pinned rates", ({ name, table }) => {
    expect(fingerprint(table)).toBe(PINNED[name]);
  });

  it("notices a changed rate", () => {
    const before = fingerprint(ANTHROPIC_PRICING);
    const repriced = Object.fromEntries(
      Object.entries(ANTHROPIC_PRICING).map(([model, rates], index) =>
        index === 0
          ? [model, { ...rates, input: rates.input + 1 }]
          : [model, rates],
      ),
    ) as Record<string, ModelPricing>;

    // Without this, the pinning above would be a green check that has never
    // been red, which is the thing it exists to prevent.
    expect(fingerprint(repriced)).not.toBe(before);
  });
});
