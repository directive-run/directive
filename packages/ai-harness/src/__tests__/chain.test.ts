import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileTranscriptStore } from "../adapters/node/transcript.js";
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
      transcripts: createFileTranscriptStore({ dir: scratch.dir }),
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
    const started = events.filter((event) => event.type === "turn:started");
    const completed = events.filter((event) => event.type === "turn:completed");
    expect(started.map((event) => event.iteration)).toEqual([0, 1, 2, 3]);
    expect(completed.map((event) => event.iteration)).toEqual([0, 1, 2, 3]);

    // ---- turn order wraps over the persona list ----
    expect(completed.map((event) => event.persona)).toEqual([
      "alpha",
      "beta",
      "gamma",
      "alpha",
    ]);

    // ---- every turn is announced before it is completed ----
    for (const iteration of [0, 1, 2, 3]) {
      const startIndex = events.findIndex(
        (event) =>
          event.type === "turn:started" && event.iteration === iteration,
      );
      const endIndex = events.findIndex(
        (event) =>
          event.type === "turn:completed" && event.iteration === iteration,
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
      "idle->taking-turns",
      "taking-turns->synthesizing",
      "synthesizing->complete",
    ]);

    // ---- synthesis streamed, and after the last turn ----
    expect(types.indexOf("synthesis:started")).toBeGreaterThan(
      types.lastIndexOf("turn:completed"),
    );
    expect(
      types.filter((type) => type === "synthesis:chunk").length,
    ).toBeGreaterThan(0);

    expect(types).not.toContain("error");
  });

  it("writes the transcript and a one-line-per-turn sidecar", async () => {
    const preset = testPreset({ maxIterations: 3, budgetUsd: 5 });
    const harness = createHarnessSystem(preset, {
      runner: createMockRunner({ responses: cannedResponses() }),
      transcripts: createFileTranscriptStore({ dir: scratch.dir }),
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

    // The two artefacts number turns the same way, so joining them on the
    // number attributes each turn to the persona that took it. The sidecar
    // used to carry the zero-based `iteration` beside a markdown heading that
    // counts from one, and nothing said so.
    const records = lines.map((line) => JSON.parse(line));
    expect(records.map((record) => record.turn)).toEqual([1, 2, 3]);
    for (const record of records) {
      expect(markdown).toContain(`## ${record.turn}. ${record.persona}`);
    }
  });

  it("gives every persona the whole transcript, not just the last turn", async () => {
    const prompts: string[] = [];
    const preset = testPreset({ maxIterations: 3, budgetUsd: 5 });

    const base = createMockRunner({ responses: cannedResponses() });
    const harness = createHarnessSystem(preset, {
      runner: (agent, input, options) => {
        prompts.push(input);

        return base(agent, input, options);
      },
      transcripts: createFileTranscriptStore({ dir: scratch.dir }),
      retry: { maxRetries: 0 },
    });

    await harness.run("the input");
    harness.system.destroy();

    // The third persona's prompt carries both earlier turns.
    const third = prompts[2] ?? "";
    expect(third).toContain("end-of-alpha-1");
    expect(third).toContain("end-of-beta-1");
  });

  it("refuses a second run rather than writing two chains into one transcript", async () => {
    const harness = createHarnessSystem(testPreset({ maxIterations: 1 }), {
      runner: createMockRunner({ responses: cannedResponses() }),
      transcripts: createFileTranscriptStore({ dir: scratch.dir }),
      retry: { maxRetries: 0 },
    });

    await harness.run("first");
    await expect(harness.run("second")).rejects.toThrow(/already been run/);
    harness.system.destroy();
  });

  /**
   * A surface that throws while rendering used to reach a `console.error` in
   * the core — invisible to a surface that swapped stdout for a socket, which
   * is every surface that is not the bundled command line. The chain has one
   * channel and this now goes down it.
   */
  it("reports a listener that throws on the stream, and finishes anyway", async () => {
    const seen: HarnessEvent[] = [];
    let thrown = 0;

    const harness = createHarnessSystem(
      testPreset({ maxIterations: 2, budgetUsd: 5 }),
      {
        runner: createMockRunner({ responses: cannedResponses() }),
        transcripts: createFileTranscriptStore({ dir: scratch.dir }),
        retry: { maxRetries: 0 },
        onEvent: (event) => {
          seen.push(event);
          // Throws on the first turn only, so the failure report itself is
          // delivered to a listener that is by then behaving.
          if (event.type === "turn:completed" && thrown === 0) {
            thrown += 1;
            throw new Error("the renderer fell over");
          }
        },
      },
    );

    const result = await harness.run("go");
    harness.system.destroy();

    expect(result.phase).toBe("complete");
    expect(result.iterations).toBe(2);

    const reported = seen.filter(
      (event) => event.type === "error" && event.scope === "listener",
    );
    expect(reported).toHaveLength(1);
    expect(reported[0]?.type === "error" && reported[0].message).toBe(
      "the renderer fell over",
    );
  });
});
