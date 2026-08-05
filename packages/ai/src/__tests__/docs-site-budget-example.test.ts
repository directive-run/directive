import { describe, expect, it } from "vitest";
import { requireModelPricing, withBudget } from "../index.js";
import { ANTHROPIC_PRICING } from "../adapters/anthropic.js";

/**
 * The budget example published at /ai/guides/control-ai-costs. It shipped with
 * `{ inputPerToken, outputPerToken }` — field names that do not exist — and no
 * per-window `pricing`, so it threw at construction. Pinned here because the
 * guide is a copy-paste target and nothing else compiles it.
 */
describe("docs site: control-ai-costs budget example", () => {
  it("constructs", () => {
    const runner: any = {
      run: async () => ({ output: "", messages: [], toolCalls: [], totalTokens: 0 }),
    };
    const pricing = requireModelPricing(
      ANTHROPIC_PRICING,
      "claude-sonnet-4-5-20250929",
    );

    const budgeted = withBudget(runner, {
      maxCostPerCall: 0.5,
      budgets: [
        { window: "hour", maxCost: 10.0, pricing },
        { window: "day", maxCost: 100.0, pricing },
      ],
      pricing,
      onBudgetExceeded: (details) => {
        console.error(`Budget exceeded: ${details.reason}`);
      },
    });

    // Constructing at all is the point — the published version threw here.
    expect(budgeted.getSpent("hour")).toBe(0);
    expect(budgeted.getSpent("day")).toBe(0);
    expect(budgeted.getUnpricedCallCount()).toBe(0);
  });
});
