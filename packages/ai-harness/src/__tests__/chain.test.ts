import { readFile } from "node:fs/promises";
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

describe("chain", () => {
  let scratch: Scratch;

  beforeEach(async () => {
    scratch = await createScratch();
  });

  afterEach(async () => {
    await scratch.cleanup();
  });

  it("runs to completion offline and emits a well-formed event sequence", async () => {
    const events: HarnessEvent[] = [];
    const preset = testPreset({ maxIterations: 4, budgetUsd: 5 });

    const harness = createHarnessSystem(preset, {
      runner: createMockRunner({ responses: cannedResponses() }),
      outputDir: scratch.dir,
      runId: "chain-run",
      onEvent: (event) => events.push(event),
      retry: { maxRetries: 0 },
    });

    const result = await harness.run("review this diff");
    harness.system.destroy();

    // ---- the run itself ----
    expect(result.phase).toBe("complete");
    expect(result.stopReason).toBe("max-iterations");
    expect(result.iterations).toBe(4);
    expect(result.synthesis).toContain("SYNTHESIS");
    expect(result.spentUsd).toBeGreaterThan(0);

    const types = events.map((event) => event.type);

    // ---- boundaries ----
    expect(types[0]).toBe("chain:started");
    expect(types.at(-1)).toBe("chain:complete");
    expect(types.filter((type) => type === "chain:complete")).toHaveLength(1);

    // ---- one started/completed pair per iteration, in order ----
    const started = events.filter((event) => event.type === "burst:started");
    const completed = events.filter(
      (event) => event.type === "burst:completed",
    );
    expect(started.map((event) => event.iteration)).toEqual([0, 1, 2, 3]);
    expect(completed.map((event) => event.iteration)).toEqual([0, 1, 2, 3]);

    // ---- turn order wraps over the persona list ----
    expect(completed.map((event) => event.persona)).toEqual([
      "alpha",
      "beta",
      "gamma",
      "alpha",
    ]);

    // ---- every burst is announced before it is completed ----
    for (const iteration of [0, 1, 2, 3]) {
      const startIndex = events.findIndex(
        (event) =>
          event.type === "burst:started" && event.iteration === iteration,
      );
      const endIndex = events.findIndex(
        (event) =>
          event.type === "burst:completed" && event.iteration === iteration,
      );
      expect(startIndex).toBeGreaterThanOrEqual(0);
      expect(endIndex).toBeGreaterThan(startIndex);
    }

    // ---- the running total only ever moves forward ----
    const costs = events
      .filter((event) => event.type === "cost:updated")
      .map((event) => event.spentUsd);
    expect(costs).toHaveLength(4);
    expect([...costs].sort((a, b) => a - b)).toEqual(costs);

    // ---- phase transitions, derived and announced exactly once each ----
    const steps = events.filter((event) => event.type === "step:complete");
    expect(steps.map((event) => `${event.from}->${event.to}`)).toEqual([
      "idle->bursting",
      "bursting->synthesizing",
      "synthesizing->complete",
    ]);

    // ---- synthesis streamed, and after the last burst ----
    expect(types.indexOf("synthesis:started")).toBeGreaterThan(
      types.lastIndexOf("burst:completed"),
    );
    expect(
      types.filter((type) => type === "synthesis:chunk").length,
    ).toBeGreaterThan(0);

    expect(types).not.toContain("error");
  });

  it("writes the transcript and a one-line-per-burst sidecar", async () => {
    const preset = testPreset({ maxIterations: 3, budgetUsd: 5 });
    const harness = createHarnessSystem(preset, {
      runner: createMockRunner({ responses: cannedResponses() }),
      outputDir: scratch.dir,
      runId: "files-run",
      retry: { maxRetries: 0 },
    });

    const result = await harness.run("the input");
    harness.system.destroy();

    const markdown = await readFile(result.transcriptPath, "utf8");
    expect(markdown).toContain("**Input:** the input");
    expect(markdown).toContain("## 1. alpha");
    expect(markdown).toContain("## 3. gamma");
    expect(markdown).toContain("# Synthesis");

    const sidecar = await readFile(result.jsonlPath, "utf8");
    const lines = sidecar.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines.map((line) => JSON.parse(line).persona)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  it("gives every persona the whole transcript, not just the last burst", async () => {
    const prompts: string[] = [];
    const preset = testPreset({ maxIterations: 3, budgetUsd: 5 });

    const base = createMockRunner({ responses: cannedResponses() });
    const harness = createHarnessSystem(preset, {
      runner: (agent, input, options) => {
        prompts.push(input);

        return base(agent, input, options);
      },
      outputDir: scratch.dir,
      retry: { maxRetries: 0 },
    });

    await harness.run("the input");
    harness.system.destroy();

    // The third persona's prompt carries both earlier bursts.
    const third = prompts[2] ?? "";
    expect(third).toContain("end-of-alpha-1");
    expect(third).toContain("end-of-beta-1");
  });

  it("refuses a second run rather than writing two chains into one transcript", async () => {
    const harness = createHarnessSystem(testPreset({ maxIterations: 1 }), {
      runner: createMockRunner({ responses: cannedResponses() }),
      outputDir: scratch.dir,
      retry: { maxRetries: 0 },
    });

    await harness.run("first");
    await expect(harness.run("second")).rejects.toThrow(/already been run/);
    harness.system.destroy();
  });
});
