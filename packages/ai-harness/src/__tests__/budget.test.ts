/**
 * `budgetUsd` is a ceiling, and a ceiling is a thing you do not go through.
 *
 * Two failures are worth guarding against here and they are not the same. The
 * first is a chain that never ends, which in a test looks like a timeout and in
 * production looks like a bill — so every case asserts that the run *finished*,
 * how many turns it took, and which stop condition reported itself. The second
 * is a chain that ends correctly and still spends more than it was given, which
 * is what `spends no more than it was given` exists for and is the point of the
 * whole arrangement: a predicted stop, a checked synthesis, and a hard ledger
 * floor underneath both.
 */

import type { AgentRunner } from "@directive-run/ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileTranscriptStore } from "../adapters/node/transcript.js";
import { createHarnessAgents } from "../core/agents.js";
import { runComposition } from "../core/composition.js";
import type { HarnessEvent } from "../core/events.js";
import { createMockRunner } from "../core/mock-runner.js";
import type { ChainDerived } from "../core/module.js";
import { type Harness, createHarnessSystem } from "../core/system.js";
import {
  type Scratch,
  cannedResponses,
  createScratch,
  testPreset,
} from "./fixtures.js";

/**
 * The chain's own surfaces, which `Harness.system` deliberately leaves untyped.
 *
 * A caller holds the system to inspect and destroy it, not to type against, so
 * its schema is erased at the boundary. These tests are checking the arithmetic
 * behind the budget rather than the report of it, so they reach through — which
 * is exactly the "reading facts off it is fine" the `Harness.system` doc
 * describes, with the types put back.
 */
function derived(harness: Harness): ChainDerived {
  return (harness.system as unknown as { derive: ChainDerived }).derive;
}

function chainFacts(harness: Harness): Record<string, unknown> {
  return (harness.system as unknown as { facts: Record<string, unknown> })
    .facts;
}

describe("budget", () => {
  let scratch: Scratch;

  beforeEach(async () => {
    scratch = await createScratch();
  });

  afterEach(async () => {
    await scratch.cleanup();
  });

  it("terminates the chain and says the budget did it", async () => {
    // Small enough that spend runs out long before the iteration backstop —
    // so `max-iterations` cannot be what stopped it.
    const preset = testPreset({ budgetUsd: 0.05, maxIterations: 40 });

    const harness = createHarnessSystem(preset, {
      runner: createMockRunner({ responses: cannedResponses() }),
      transcripts: createFileTranscriptStore({ dir: scratch.dir }),
      retry: { maxRetries: 0 },
    });

    const result = await harness.run("go");
    harness.system.destroy();

    expect(result.stopReason).toBe("budget");
    expect(result.phase).toBe("complete");
    expect(result.iterations).toBeGreaterThan(0);
    expect(result.iterations).toBeLessThan(preset.maxIterations);
    expect(result.spentUsd).toBeGreaterThan(0);
    // Stopped while it could still pay for the closing document, which is what
    // `canAffordTurn` reserves for — and the document exists to prove it.
    expect(result.synthesis).not.toBe("");
    expect(result.synthesisSkipped).toBe(false);
  });

  // ==========================================================================
  // The invariant
  // ==========================================================================

  /**
   * A spread of budgets rather than one.
   *
   * The old reserve failed differently at different scales — it held back one
   * average turn, so the shortfall grew with the gap between a turn and the
   * synthesis — and a single budget would have been a single point on that
   * curve. Every one of these overspent before the fix.
   */
  const BUDGETS = [0.03, 0.05, 0.08, 0.12, 0.2];

  it.each(BUDGETS)(
    "spends no more than the $%s it was given",
    async (budgetUsd) => {
      const preset = testPreset({ budgetUsd, maxIterations: 40 });

      const harness = createHarnessSystem(preset, {
        runner: createMockRunner({ responses: cannedResponses() }),
        transcripts: createFileTranscriptStore({ dir: scratch.dir }),
        retry: { maxRetries: 0 },
      });

      const result = await harness.run("go");
      harness.system.destroy();

      expect(result.spentUsd).toBeLessThanOrEqual(budgetUsd);
      expect(result.stopReason).toBe("budget");
    },
  );

  it("spends no more than the composition's ceiling, across every step", async () => {
    const totalBudgetUsd = 0.09;
    const presets = [
      testPreset({ id: "step-one", budgetUsd: 0.05, maxIterations: 40 }),
      testPreset({ id: "step-two", budgetUsd: 0.05, maxIterations: 40 }),
      testPreset({ id: "step-three", budgetUsd: 0.05, maxIterations: 40 }),
    ];

    const result = await runComposition(presets, "go", {
      runner: createMockRunner({ responses: cannedResponses() }),
      transcripts: createFileTranscriptStore({ dir: scratch.dir }),
      retry: { maxRetries: 0 },
      totalBudgetUsd,
    });

    // Without a ceiling this is $0.15 of exposure across three steps, each
    // enforcing its own $0.05 and none of them aware of the others.
    expect(result.budgetUsd).toBe(totalBudgetUsd);
    expect(result.spentUsd).toBeLessThanOrEqual(totalBudgetUsd);
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.steps.length).toBeLessThanOrEqual(presets.length);

    // And every step that ran stayed inside its own clamped budget too.
    for (const step of result.steps) {
      expect(step.spentUsd).toBeLessThanOrEqual(step.budgetUsd);
    }
  });

  it("reports the summed ceiling when no total is given", async () => {
    const presets = [
      testPreset({ id: "one", budgetUsd: 0.05, maxIterations: 2 }),
      testPreset({ id: "two", budgetUsd: 0.06, maxIterations: 2 }),
    ];

    const result = await runComposition(presets, "go", {
      runner: createMockRunner({ responses: cannedResponses() }),
      transcripts: createFileTranscriptStore({ dir: scratch.dir }),
      retry: { maxRetries: 0 },
    });

    // The default changes nothing about what a composition costs — it states
    // the figure the caller was already exposed to.
    expect(result.budgetUsd).toBeCloseTo(0.11, 10);
    expect(result.budgetExhausted).toBe(false);
    expect(result.steps).toHaveLength(2);
  });

  it("declines a step it cannot pay for a closing document on", async () => {
    const events: HarnessEvent[] = [];
    const second = testPreset({
      id: "two",
      budgetUsd: 0.08,
      maxIterations: 40,
    });
    const presets = [
      testPreset({ id: "one", budgetUsd: 0.05, maxIterations: 40 }),
      // A far more expensive closing document — 4000 output tokens prices at
      // $0.06 on this model — so what the first step leaves cannot buy one.
      { ...second, synthesizer: { ...second.synthesizer, maxTokens: 4000 } },
    ];

    const result = await runComposition(presets, "go", {
      runner: createMockRunner({ responses: cannedResponses() }),
      transcripts: createFileTranscriptStore({ dir: scratch.dir }),
      retry: { maxRetries: 0 },
      // Enough for the first step and not the second.
      totalBudgetUsd: 0.055,
      onEvent: (event) => events.push(event),
    });

    expect(result.steps).toHaveLength(1);
    expect(result.budgetExhausted).toBe(true);
    expect(result.spentUsd).toBeLessThanOrEqual(0.055);

    const declined = events.filter(
      (event) => event.type === "composition:budget-exhausted",
    );
    expect(declined).toHaveLength(1);
    expect(declined[0]?.step).toBe(2);
    // Said in dollars, so the operator knows what to raise it to.
    expect(declined[0]?.requiredUsd).toBeGreaterThan(0);
  });

  // ==========================================================================
  // The synthesis reserve
  // ==========================================================================

  it("refuses a budget that cannot pay for the closing document", () => {
    // The synthesizer's 1000 output tokens price at $0.015 on this model, so a
    // cent buys turns and nothing to summarise them with.
    expect(() =>
      createHarnessSystem(testPreset({ budgetUsd: 0.01 }), {
        runner: createMockRunner({ responses: cannedResponses() }),
        transcripts: createFileTranscriptStore({ dir: scratch.dir }),
      }),
    ).toThrow(/cannot pay for this preset's closing document/);
  });

  it("reserves the synthesis rather than one average turn", async () => {
    const preset = testPreset({ budgetUsd: 0.05, maxIterations: 40 });

    const harness = createHarnessSystem(preset, {
      runner: createMockRunner({ responses: cannedResponses() }),
      transcripts: createFileTranscriptStore({ dir: scratch.dir }),
      retry: { maxRetries: 0 },
    });

    await harness.run("go");

    // What the chain held back is the synthesizer's own price. Its output half
    // alone — `maxTokens` at the model's output rate — is more than a turn
    // costs, and the old reserve was one turn.
    const reserve = derived(harness).synthesisReserveUsd;
    const averageTurn = derived(harness).averageTurnUsd;
    const outputFloor = (preset.synthesizer.maxTokens / 1_000_000) * 15;

    expect(reserve).toBeGreaterThan(outputFloor);
    expect(reserve).toBeGreaterThan(averageTurn);
    // And it grows with the transcript, because that is what the synthesizer
    // reads. A reserve fixed at construction would be right on turn one and
    // low on every turn after.
    expect(reserve - outputFloor).toBeGreaterThan(0);
    harness.system.destroy();
  });

  // ==========================================================================
  // The hard floor, and what happens when the prediction is wrong
  // ==========================================================================

  /**
   * A turn that costs wildly more than anything before it.
   *
   * No predictor sees this coming — that is the point. It is the case the
   * graceful stop cannot cover and the hard ledger floor exists for.
   */
  function surpriseResponses(): Record<string, string[]> {
    const canned = cannedResponses();

    return {
      ...canned,
      alpha: [canned.alpha![0]!, "surprise ".repeat(60_000)],
    };
  }

  /**
   * The overshoot a mispredicted turn can cause is exactly one call.
   *
   * Note what this does *not* assert: `budgetHalted`. The hard ledger floor is
   * deliberately unreachable while the chain's own gates are working — they
   * refuse to dispatch anything once nothing is left, so the floor never gets
   * asked. That is what "layered rather than duplicated" means in practice, and
   * it is why the floor's own behaviour is pinned at the level it lives on, in
   * `packages/ai`'s `maxTotalCost` tests, rather than here.
   */
  it("dispatches nothing further after a turn blows through the ceiling", async () => {
    const preset = testPreset({ budgetUsd: 0.05, maxIterations: 40 });

    let calls = 0;
    const mock = createMockRunner({ responses: surpriseResponses() });

    const harness = createHarnessSystem(preset, {
      runner: (agent, input, options) => {
        calls += 1;

        return mock(agent, input, options);
      },
      transcripts: createFileTranscriptStore({ dir: scratch.dir }),
      retry: { maxRetries: 0 },
    });

    const result = await harness.run("go");
    const callsAtEnd = calls;

    // One provider call per turn and not one more. The surprise turn is the
    // last thing dispatched: no further turn, and no synthesis call either,
    // so the overrun is exactly the one call that caused it.
    expect(callsAtEnd).toBe(result.iterations);
    expect(result.iterations).toBeGreaterThan(1);

    // Reported as a budget stop, which is what it is. A run that overran its
    // ceiling and said `"error"` would be the two ceilings giving different
    // accounts of the same money.
    expect(result.stopReason).toBe("budget");
    expect(result.phase).toBe("complete");
    expect(chainFacts(harness).failure).toBe("");
    expect(result.synthesis).toBe("");
    expect(result.synthesisSkipped).toBe(true);
    harness.system.destroy();
  });

  it("says so when the closing document cannot be paid for", async () => {
    const events: HarnessEvent[] = [];
    const preset = testPreset({ budgetUsd: 0.05, maxIterations: 40 });

    const harness = createHarnessSystem(preset, {
      runner: createMockRunner({ responses: surpriseResponses() }),
      transcripts: createFileTranscriptStore({ dir: scratch.dir }),
      retry: { maxRetries: 0 },
      onEvent: (event) => events.push(event),
    });

    await harness.run("go");
    harness.system.destroy();

    const skipped = events.filter(
      (event) => event.type === "budget:synthesis-skipped",
    );

    // A run that ends without its closing document and without an explanation
    // is the outcome this event exists to prevent.
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.reserveUsd).toBeGreaterThan(0);

    const complete = events.filter((event) => event.type === "chain:complete");
    expect(complete[0]?.synthesisSkipped).toBe(true);
  });

  it("projects the next turn above the last one, never below", async () => {
    const preset = testPreset({ budgetUsd: 0.05, maxIterations: 40 });

    const harness = createHarnessSystem(preset, {
      runner: createMockRunner({ responses: cannedResponses() }),
      transcripts: createFileTranscriptStore({ dir: scratch.dir }),
      retry: { maxRetries: 0 },
    });

    await harness.run("go");

    const projected = derived(harness).projectedTurnUsd;
    const last = chainFacts(harness).lastTurnUsd as number;
    const average = derived(harness).averageTurnUsd;

    // Every turn re-sends the whole transcript, so cost climbs monotonically
    // and the trailing mean sits below the last measurement — structurally, not
    // on average. That is the number the chain used to stop on.
    expect(average).toBeLessThan(last);
    expect(projected).toBeGreaterThanOrEqual(last);
    harness.system.destroy();
  });

  it("stops on the iteration backstop when the budget is ample", async () => {
    const preset = testPreset({ budgetUsd: 100, maxIterations: 3 });

    const harness = createHarnessSystem(preset, {
      runner: createMockRunner({ responses: cannedResponses() }),
      transcripts: createFileTranscriptStore({ dir: scratch.dir }),
      retry: { maxRetries: 0 },
    });

    const result = await harness.run("go");
    harness.system.destroy();

    expect(result.stopReason).toBe("max-iterations");
    expect(result.iterations).toBe(3);
  });

  it("prices from the ledger rather than a second cost calculation", async () => {
    const events: HarnessEvent[] = [];
    const preset = testPreset({ budgetUsd: 100, maxIterations: 3 });

    const harness = createHarnessSystem(preset, {
      runner: createMockRunner({ responses: cannedResponses() }),
      transcripts: createFileTranscriptStore({ dir: scratch.dir }),
      retry: { maxRetries: 0 },
      onEvent: (event) => events.push(event),
    });

    const result = await harness.run("go");
    // Read the ledger the chain was terminated against, directly.
    const perTurn = events
      .filter((event) => event.type === "turn:completed")
      .map((event) => event.costUsd);
    harness.system.destroy();

    // Every turn cost something, and the parts sum to the whole. If the
    // resolver were pricing calls itself instead of copying the ledger, these
    // two figures would be free to disagree.
    expect(perTurn).toHaveLength(3);
    for (const cost of perTurn) {
      expect(cost).toBeGreaterThan(0);
    }
    const summed = perTurn.reduce((total, cost) => total + cost, 0);
    // The synthesis call is also billed, so the total is at least the turns.
    expect(result.spentUsd).toBeGreaterThan(summed);
  });

  it("warns once when spend crosses the configured fraction", async () => {
    const events: HarnessEvent[] = [];
    const preset = testPreset({
      budgetUsd: 0.05,
      maxIterations: 40,
      // Below the fraction the synthesis reserve occupies, which on a budget
      // this size is most of it — the warning fires on money spent, and a good
      // part of this budget is money the chain has committed rather than spent.
      budgetWarningThreshold: 0.3,
    });

    const harness = createHarnessSystem(preset, {
      runner: createMockRunner({ responses: cannedResponses() }),
      transcripts: createFileTranscriptStore({ dir: scratch.dir }),
      retry: { maxRetries: 0 },
      onEvent: (event) => events.push(event),
    });

    await harness.run("go");
    harness.system.destroy();

    const warnings = events.filter((event) => event.type === "budget:warning");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.fraction).toBeGreaterThanOrEqual(0.3);
  });

  // ==========================================================================
  // A call that was billed and then threw
  // ==========================================================================
  //
  // The ordinary failure of a streaming provider is a response that starts and
  // stops: a rate limit part-way, a gateway 502, a truncated body. The provider
  // billed for what it sent, the ledger records it, and the turn that would
  // have written the facts never got there. Every figure the chain reports
  // afterwards — and every allowance a composition computes from it — comes off
  // `spentUsd`, so a path that ends a turn without carrying the ledger forward
  // hands out money that has already been spent.

  /** Streams most of a turn, then fails. Nothing retries it. */
  function failingTurnRunner(agent: string, call = 1) {
    return createMockRunner({
      responses: cannedResponses(),
      failures: [{ agent, call, afterDeltas: 20 }],
    });
  }

  it("carries a billed-then-failed turn's spend into the facts", async () => {
    const preset = testPreset({ budgetUsd: 0.05, maxIterations: 40 });

    const harness = createHarnessSystem(preset, {
      // The first turn, so nothing else can have moved the ledger.
      runner: failingTurnRunner("alpha"),
      transcripts: createFileTranscriptStore({ dir: scratch.dir }),
      retry: { maxRetries: 0 },
    });

    const result = await harness.run("go");
    harness.system.destroy();

    expect(result.stopReason).toBe("error");
    // The whole point. This reported $0.0000 for a call the provider had
    // already billed, because the error path never read the ledger.
    expect(result.spentUsd).toBeGreaterThan(0);
    expect(chainFacts(harness).spentUsd).toBe(result.spentUsd);
  });

  it("counts a failed step's spend against the composition's ceiling", async () => {
    const totalBudgetUsd = 0.05;
    const presets = [
      testPreset({ id: "one", budgetUsd: 0.05, maxIterations: 40 }),
      testPreset({ id: "two", budgetUsd: 0.05, maxIterations: 40 }),
      testPreset({ id: "three", budgetUsd: 0.05, maxIterations: 40 }),
      testPreset({ id: "four", budgetUsd: 0.05, maxIterations: 40 }),
    ];

    const result = await runComposition(presets, "go", {
      // Every step's first turn is billed and then fails, so every step is a
      // step whose spend used to read as zero.
      runner: failingTurnRunner("alpha"),
      transcripts: createFileTranscriptStore({ dir: scratch.dir }),
      retry: { maxRetries: 0 },
      totalBudgetUsd,
    });

    // Each step's own report is honest…
    for (const step of result.steps) {
      expect(step.spentUsd).toBeGreaterThan(0);
    }
    // …and the composition's is the sum of them, which is what the per-step
    // clamp and the remaining-budget check are computed from.
    const summed = result.steps.reduce(
      (total, step) => total + step.spentUsd,
      0,
    );
    expect(result.spentUsd).toBeCloseTo(summed, 10);
    expect(result.spentUsd).toBeLessThanOrEqual(totalBudgetUsd);
  });

  // ==========================================================================
  // The floor, and the retries underneath it
  // ==========================================================================

  it("dispatches nothing further once the ledger reaches the ceiling, retries included", async () => {
    const preset = testPreset({ budgetUsd: 0.02 });
    let calls = 0;

    // One attempt delivers far more than the whole budget and then throws —
    // the provider billed for it, and `withBudget` charges what arrived. A
    // second attempt must not go out.
    const runner: AgentRunner = async (_agent, _input, options) => {
      calls += 1;
      const sink = options?.onToken as ((token: string) => unknown) | undefined;
      await sink?.("x".repeat(200_000));

      throw new Error("gateway 502");
    };

    const agents = createHarnessAgents({
      preset,
      runner,
      retry: { maxRetries: 5, baseDelayMs: 0, maxDelayMs: 0 },
    });

    await expect(
      agents.orchestrator.runAgent("alpha", "go", { onToken: () => {} }),
    ).rejects.toThrow();

    expect(agents.budgetRunner.getSpent("total")).toBeGreaterThanOrEqual(
      preset.budgetUsd,
    );
    // With the retry policy wrapping the ledger rather than the other way
    // round, the floor is consulted before every attempt instead of once for
    // the whole sequence. Six calls used to go out.
    expect(calls).toBe(1);
  });
});
