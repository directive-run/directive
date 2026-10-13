/**
 * Every adapter's default model must be one its own rate table prices.
 *
 * The Gemini runner defaulted to `gemini-2.0-flash` for months after that model
 * was shut down. Nothing noticed: the default is only exercised when a caller
 * names no model, the failure arrives from the provider rather than from here,
 * and it reads as a network problem rather than a stale constant. The rate
 * table is the one place in this package that has to be kept current, so
 * agreeing with it is a cheap proxy for "this model still exists".
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_GEMINI_MODEL, GEMINI_PRICING } from "../adapters/gemini.js";

const DEFAULTS = [
  {
    adapter: "gemini",
    model: DEFAULT_GEMINI_MODEL,
    table: GEMINI_PRICING,
  },
];

describe("adapter default models", () => {
  it.each(DEFAULTS)(
    "$adapter defaults to a model its rate table prices",
    ({ model, table, adapter }) => {
      expect(
        Object.keys(table),
        `${adapter} defaults to "${model}", which its rate table does not price. Either the model was retired and the default needs moving, or the table is missing a row.`,
      ).toContain(model);
    },
  );

  it.each(DEFAULTS)(
    "$adapter's default is priced above zero",
    ({ table, model }) => {
      // A zero rate is legitimate for a local runner and wrong for a hosted one.
      // Gemini is hosted, so a zero here means the row was added as a placeholder.
      const rates = table[model]!;

      expect(rates.input).toBeGreaterThan(0);
      expect(rates.output).toBeGreaterThan(0);
    },
  );
});
