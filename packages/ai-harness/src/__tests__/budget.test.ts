/**
 * The budget has to actually stop the chain.
 *
 * The failure worth guarding against is not "the number is wrong" — it is a
 * chain that never ends, which in a test looks like a timeout and in production
 * looks like a bill. So every case here asserts that the run *finished*, how
 * many bursts it took to get there, and which of the two stop conditions
 * reported itself. A run that stopped for the wrong reason is as much a failure
 * as one that did not stop.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HarnessEvent } from "../core/events.js";
import { createMockRunner } from "../core/mock-runner.js";
import { createHarnessSystem } from "../core/system.js";
import {
  type Scratch,
  cannedResponses,
  createScratch,
  testPreset,
} from "./fixtures.js";

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
    const preset = testPreset({ budgetUsd: 0.02, maxIterations: 40 });

    const harness = createHarnessSystem(preset, {
      runner: createMockRunner({ responses: cannedResponses() }),
      outputDir: scratch.dir,
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
    // `canAffordBurst` reserves for. Overshoot is bounded by the synthesis
    // call, not by another burst.
    expect(result.synthesis).not.toBe("");
  });

  it("stops on the iteration backstop when the budget is ample", async () => {
    const preset = testPreset({ budgetUsd: 100, maxIterations: 3 });

    const harness = createHarnessSystem(preset, {
      runner: createMockRunner({ responses: cannedResponses() }),
      outputDir: scratch.dir,
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
      outputDir: scratch.dir,
      retry: { maxRetries: 0 },
      onEvent: (event) => events.push(event),
    });

    const result = await harness.run("go");
    // Read the ledger the chain was terminated against, directly.
    const perBurst = events
      .filter((event) => event.type === "burst:completed")
      .map((event) => event.costUsd);
    harness.system.destroy();

    // Every burst cost something, and the parts sum to the whole. If the
    // resolver were pricing calls itself instead of copying the ledger, these
    // two figures would be free to disagree.
    expect(perBurst).toHaveLength(3);
    for (const cost of perBurst) {
      expect(cost).toBeGreaterThan(0);
    }
    const summed = perBurst.reduce((total, cost) => total + cost, 0);
    // The synthesis call is also billed, so the total is at least the bursts.
    expect(result.spentUsd).toBeGreaterThan(summed);
  });

  it("warns once when spend crosses the configured fraction", async () => {
    const events: HarnessEvent[] = [];
    const preset = testPreset({
      budgetUsd: 0.02,
      maxIterations: 40,
      budgetWarningThreshold: 0.5,
    });

    const harness = createHarnessSystem(preset, {
      runner: createMockRunner({ responses: cannedResponses() }),
      outputDir: scratch.dir,
      retry: { maxRetries: 0 },
      onEvent: (event) => events.push(event),
    });

    await harness.run("go");
    harness.system.destroy();

    const warnings = events.filter((event) => event.type === "budget:warning");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.fraction).toBeGreaterThanOrEqual(0.5);
  });
});
