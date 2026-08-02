/**
 * An interrupt is a fact flip, and the cascade does the rest.
 *
 * The property under test is that interrupting takes the chain down the *same*
 * path the budget takes it down — it stops bursting and it still synthesizes.
 * If interrupting were a branch rather than a fact, "did synthesis still run"
 * would be a separate decision with its own answer, and this is the test that
 * would find the two answers disagreeing.
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

describe("interrupt", () => {
  let scratch: Scratch;

  beforeEach(async () => {
    scratch = await createScratch();
  });

  afterEach(async () => {
    await scratch.cleanup();
  });

  it("stops the chain mid-run and still reaches synthesis", async () => {
    const events: HarnessEvent[] = [];
    // Ample on both axes, so nothing but the interrupt can end this run.
    const preset = testPreset({ budgetUsd: 100, maxIterations: 30 });

    const harness = createHarnessSystem(preset, {
      runner: createMockRunner({ responses: cannedResponses() }),
      outputDir: scratch.dir,
      retry: { maxRetries: 0 },
      onEvent: (event) => {
        events.push(event);
        if (event.type === "burst:completed" && event.iteration === 1) {
          // Dispatched off the reconcile pass that produced this event — the
          // chain is mid-flight, not between runs.
          queueMicrotask(() => harness.abort());
        }
      },
    });

    const result = await harness.run("go");
    harness.system.destroy();

    expect(result.stopReason).toBe("interrupted");
    expect(result.phase).toBe("complete");
    expect(result.iterations).toBeGreaterThanOrEqual(2);
    expect(result.iterations).toBeLessThan(preset.maxIterations);
    expect(result.synthesis).toContain("SYNTHESIS");

    const types = events.map((event) => event.type);
    expect(types).toContain("synthesis:started");
    expect(types.at(-1)).toBe("chain:complete");
  });

  it("lets the burst in flight finish, so the transcript is never half a burst", async () => {
    const preset = testPreset({ budgetUsd: 100, maxIterations: 30 });

    const harness = createHarnessSystem(preset, {
      runner: createMockRunner({ responses: cannedResponses(), delayMs: 5 }),
      outputDir: scratch.dir,
      retry: { maxRetries: 0 },
      onEvent: (event) => {
        // Interrupt while a burst is streaming, not between bursts.
        if (event.type === "burst:delta" && event.iteration === 1) {
          queueMicrotask(() => harness.abort());
        }
      },
    });

    const result = await harness.run("go");
    const bursts = harness.transcript.bursts();
    harness.system.destroy();

    expect(result.stopReason).toBe("interrupted");
    // Every committed burst is whole — the one that was streaming when the
    // interrupt landed ran to completion rather than being torn up.
    for (const burst of bursts) {
      expect(burst.text).toContain(`end-of-${burst.persona}-`);
    }
    expect(bursts.length).toBe(result.iterations);
  });

  it("is idempotent — aborting twice is aborting once", async () => {
    const preset = testPreset({ budgetUsd: 100, maxIterations: 30 });

    const harness = createHarnessSystem(preset, {
      runner: createMockRunner({ responses: cannedResponses() }),
      outputDir: scratch.dir,
      retry: { maxRetries: 0 },
      onEvent: (event) => {
        if (event.type === "burst:completed" && event.iteration === 0) {
          queueMicrotask(() => {
            harness.abort();
            harness.abort();
          });
        }
      },
    });

    const result = await harness.run("go");
    harness.system.destroy();

    expect(result.stopReason).toBe("interrupted");
    expect(result.synthesis).toContain("SYNTHESIS");
  });
});
