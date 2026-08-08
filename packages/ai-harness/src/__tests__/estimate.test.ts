/**
 * The estimate and the run are one piece of arithmetic.
 *
 * `--list-presets` tells an operator which of a preset's two ceilings will stop
 * it and roughly what that costs. It can only say so because it replays the
 * chain's own stopping rules — and it *is* a replay only for as long as both
 * sides call the same functions. They had already come apart once: the chain
 * asks whether the next turn is affordable before it asks whether the ceiling
 * is reached, and the replay asked the other way round, so a run that spent its
 * last dollar on the turn that reached its ceiling was advertised as stopping
 * "well under the cap".
 *
 * The last case runs a preset for real and compares the outcome to what was
 * predicted for it, which is the only assertion here that would survive the two
 * being reimplemented apart from each other again.
 */

import { describe, expect, it } from "vitest";
import { CHARS_PER_TOKEN, resolvePresetPricing } from "../core/agents.js";
import { estimateRun } from "../core/estimate.js";
import { createMockRunner } from "../core/mock-runner.js";
import type { PresetConfig } from "../core/preset-types.js";
import {
  aPrioriTurnUsd,
  projectTurnUsd,
  synthesisReserveUsd,
} from "../core/projection.js";
import { createHarnessSystem } from "../core/system.js";
import { testPreset } from "./fixtures.js";

const pricingFor = (preset: PresetConfig) => resolvePresetPricing(preset);

describe("the offline replay", () => {
  it("reports the budget when the last affordable turn is also the last permitted one", () => {
    // A ceiling low enough that the chain reaches it, and a budget tuned so the
    // turn that reaches it is also the last one affordable. Both stops apply at
    // once; the chain reports `"budget"`, because that is the one that would
    // surprise an operator reading "stops on the turn ceiling, well under the
    // cap".
    const preset = testPreset({ budgetUsd: 0.05, maxIterations: 40 });
    const estimate = estimateRun(preset, pricingFor(preset));

    expect(estimate.limit).toBe("budget");
    expect(estimate.turns).toBeGreaterThan(0);
    expect(estimate.expectedUsd).toBeLessThanOrEqual(preset.budgetUsd);
  });

  it("still reports the ceiling when money is not the constraint", () => {
    const preset = testPreset({ budgetUsd: 100, maxIterations: 3 });
    const estimate = estimateRun(preset, pricingFor(preset));

    expect(estimate.limit).toBe("iterations");
    expect(estimate.turns).toBe(3);
    expect(estimate.synthesis).toBe(true);
  });

  it("prices the first turn rather than treating it as free", () => {
    const preset = testPreset();
    const pricing = pricingFor(preset);
    const size = { transcriptChars: 0, inputChars: 0 };

    const first = projectTurnUsd(preset, pricing, {
      iteration: 0,
      lastTurnUsd: 0,
      previousTurnUsd: 0,
      ...size,
    });

    // Zero was the claim that the first turn costs nothing, and the chain
    // authorizes that turn against a reserve computed on it.
    expect(first).toBe(aPrioriTurnUsd(preset, pricing, size));
    expect(first).toBeGreaterThan(
      (preset.tokensPerTurn / 1_000_000) * pricing.outputPerMillion,
    );
  });

  it("carries the input length into the reserve, which the replay assumes away", () => {
    const preset = testPreset();
    const pricing = pricingFor(preset);
    const empty = synthesisReserveUsd(preset, pricing, {
      transcriptChars: 0,
      inputChars: 0,
    });
    const withSubject = synthesisReserveUsd(preset, pricing, {
      transcriptChars: 0,
      inputChars: 40_000,
    });

    // The estimator's "empty input" assumption is an argument at its call site
    // rather than a term that quietly went missing from its copy of the sum.
    expect(withSubject).toBeGreaterThan(empty);
  });

  // ==========================================================================
  // The replay against a run
  // ==========================================================================

  /**
   * A runner that answers at exactly the length the estimate assumes.
   *
   * The replay assumes every turn uses its full token allowance and that the
   * subject is empty. A mock that answers at some other length is testing the
   * mock, not the arithmetic — so this one produces `tokensPerTurn` worth of
   * characters, and the run is given an empty input.
   */
  function calibratedRunner(preset: PresetConfig) {
    return createMockRunner({
      defaultResponse: "x".repeat(preset.tokensPerTurn * CHARS_PER_TOKEN),
      responses: {
        [preset.synthesizer.name]: "y".repeat(
          preset.synthesizer.maxTokens * CHARS_PER_TOKEN,
        ),
      },
      chunkChars: 4096,
    });
  }

  it.each([
    ["a budget stop", testPreset({ budgetUsd: 0.05, maxIterations: 40 })],
    ["a ceiling stop", testPreset({ budgetUsd: 100, maxIterations: 3 })],
  ])("predicts %s the run then produces", async (_label, preset) => {
    const estimate = estimateRun(preset, pricingFor(preset));

    const harness = createHarnessSystem(preset, {
      runner: calibratedRunner(preset),
      retry: { maxRetries: 0 },
    });
    const result = await harness.run("");
    harness.system.destroy();

    // Which ceiling stopped it, in the run's own vocabulary.
    expect(result.stopReason).toBe(
      estimate.limit === "iterations" ? "max-iterations" : "budget",
    );
    // How many turns. Within one, because the replay approximates the prompt's
    // assembled length — the fences, the marker, the rendered template — and
    // the run measures it.
    expect(Math.abs(result.iterations - estimate.turns)).toBeLessThanOrEqual(1);
    // And whether there is a closing document at the end of it.
    expect(result.synthesis !== "").toBe(estimate.synthesis);
    expect(result.spentUsd).toBeLessThanOrEqual(preset.budgetUsd);
  });
});
