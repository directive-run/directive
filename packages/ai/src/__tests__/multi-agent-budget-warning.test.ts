/**
 * `onBudgetWarning` on the multi-agent orchestrator.
 *
 * The single-agent orchestrator has covered this since it shipped. The
 * multi-agent one carries its own copy of the same logic and had no test at
 * all: disabling the threshold check entirely left the whole suite green.
 *
 * Money is the thing being guarded here, so the gap mattered more than most —
 * the callback is how a caller learns a run is approaching the ceiling, and a
 * warning that never arrives is indistinguishable from a run that stayed
 * cheap.
 */

import { describe, expect, it } from "vitest";
import { createTestMultiAgentOrchestrator } from "../testing.js";

interface BudgetWarning {
  currentTokens: number;
  maxBudget: number;
  percentage: number;
}

function makeOrchestrator(
  tokensPerCall: number,
  options: {
    maxTokenBudget?: number;
    budgetWarningThreshold?: number;
    onBudgetWarning?: (event: BudgetWarning) => void;
  },
) {
  return createTestMultiAgentOrchestrator({
    agents: {
      a: { agent: { name: "a" } },
      b: { agent: { name: "b" } },
    },
    mockResponses: {
      a: { output: "out-a", totalTokens: tokensPerCall },
      b: { output: "out-b", totalTokens: tokensPerCall },
    },
    ...options,
  } as never);
}

describe("multi-agent onBudgetWarning", () => {
  it("fires once the running total crosses the threshold", async () => {
    const warnings: BudgetWarning[] = [];
    const orchestrator = makeOrchestrator(90, {
      maxTokenBudget: 100,
      budgetWarningThreshold: 0.8,
      onBudgetWarning: (event) => {
        warnings.push(event);
      },
    });

    await orchestrator.runAgent("a", "input");

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.currentTokens).toBe(90);
    expect(warnings[0]?.maxBudget).toBe(100);
    expect(warnings[0]?.percentage).toBeCloseTo(0.9);
  });

  it("stays quiet while the total is under the threshold", async () => {
    const warnings: BudgetWarning[] = [];
    const orchestrator = makeOrchestrator(10, {
      maxTokenBudget: 1000,
      budgetWarningThreshold: 0.8,
      onBudgetWarning: (event) => {
        warnings.push(event);
      },
    });

    await orchestrator.runAgent("a", "input");
    await orchestrator.runAgent("b", "input");

    expect(warnings).toHaveLength(0);
  });

  it("counts every agent's spend toward one shared total", async () => {
    const warnings: BudgetWarning[] = [];
    // Neither agent crosses 80 on its own. Together they pass it, which is the
    // whole point of a shared budget and the thing a per-agent count misses.
    const orchestrator = makeOrchestrator(50, {
      maxTokenBudget: 100,
      budgetWarningThreshold: 0.8,
      onBudgetWarning: (event) => {
        warnings.push(event);
      },
    });

    await orchestrator.runAgent("a", "input");
    expect(warnings).toHaveLength(0);

    await orchestrator.runAgent("b", "input");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.currentTokens).toBe(100);
  });

  it("fires once, not on every call past the threshold", async () => {
    const warnings: BudgetWarning[] = [];
    const orchestrator = makeOrchestrator(50, {
      maxTokenBudget: 100,
      budgetWarningThreshold: 0.4,
      onBudgetWarning: (event) => {
        warnings.push(event);
      },
    });

    await orchestrator.runAgent("a", "input");
    await orchestrator.runAgent("b", "input");

    // A warning repeated on every subsequent call is noise, and noise is how a
    // real one gets ignored.
    expect(warnings).toHaveLength(1);
  });

  it("does not fire when no budget was set", async () => {
    const warnings: BudgetWarning[] = [];
    const orchestrator = makeOrchestrator(10_000, {
      onBudgetWarning: (event) => {
        warnings.push(event);
      },
    });

    await orchestrator.runAgent("a", "input");

    expect(warnings).toHaveLength(0);
  });
});
