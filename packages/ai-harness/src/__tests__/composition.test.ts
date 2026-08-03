/**
 * A composition is presets in a row, and the thing that crosses between them is
 * a finished document.
 *
 * The property worth testing is narrow and easy to lose: step two's personas
 * can see step one's *synthesis* and nothing else. If the composition ever
 * started forwarding transcripts, or stopped forwarding anything, the chain
 * would still run and still write files — so the assertions here read the
 * prompts the runner was actually handed rather than the results.
 */

import { readFile } from "node:fs/promises";
import type {
  AgentLike,
  AgentRunner,
  RunOptions,
  RunResult,
} from "@directive-run/ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runChain } from "../core/composition.js";
import type { HarnessEvent } from "../core/events.js";
import { createMockRunner } from "../core/mock-runner.js";
import type { PresetConfig } from "../core/preset-types.js";
import {
  type Scratch,
  cannedBurst,
  createScratch,
  testPreset,
} from "./fixtures.js";

const FIRST_MARKER = "FIRST-STEP-CONCLUSION-9f3a";
const SECOND_MARKER = "SECOND-STEP-CONCLUSION-11c7";

function stepPreset(id: string, synthName: string): PresetConfig {
  return testPreset({
    id,
    maxIterations: 2,
    budgetUsd: 5,
    synthesizer: {
      name: synthName,
      systemPrompt: "You synthesize.",
      promptTemplate: "Transcript:\n{{transcript}}",
      maxTokens: 1000,
    },
  });
}

interface Recorded {
  agent: string;
  input: string;
}

function recordingRunner(recorded: Recorded[]): AgentRunner {
  const base = createMockRunner({
    responses: {
      alpha: [1, 2, 3, 4].map((turn) => cannedBurst("alpha", turn)),
      beta: [1, 2, 3, 4].map((turn) => cannedBurst("beta", turn)),
      gamma: [1, 2, 3, 4].map((turn) => cannedBurst("gamma", turn)),
      "synth-one": [FIRST_MARKER],
      "synth-two": [SECOND_MARKER],
    },
  });

  return <T = unknown>(
    agent: AgentLike,
    input: string,
    options?: RunOptions,
  ): Promise<RunResult<T>> => {
    recorded.push({ agent: agent.name, input });

    return base<T>(agent, input, options);
  };
}

describe("runChain", () => {
  let scratch: Scratch;

  beforeEach(async () => {
    scratch = await createScratch();
  });

  afterEach(async () => {
    await scratch.cleanup();
  });

  it("hands each step's synthesis to the next one as prior context", async () => {
    const recorded: Recorded[] = [];
    const presets = [
      stepPreset("first", "synth-one"),
      stepPreset("second", "synth-two"),
    ];

    const result = await runChain(presets, "the original subject", {
      runner: recordingRunner(recorded),
      outputDir: scratch.dir,
      runId: "compose",
      retry: { maxRetries: 0 },
    });

    expect(result.steps.map((step) => step.presetId)).toEqual([
      "first",
      "second",
    ]);
    expect(result.synthesis).toContain(SECOND_MARKER);

    // Step one saw the input and nothing else.
    const firstPersona = recorded.find((entry) => entry.agent === "alpha");
    expect(firstPersona?.input).toContain("the original subject");
    expect(firstPersona?.input).not.toContain(FIRST_MARKER);

    // Step two's personas saw step one's conclusion — and only its conclusion.
    const stepTwoStart = recorded.findIndex(
      (entry) => entry.agent === "synth-one",
    );
    const stepTwoPrompts = recorded
      .slice(stepTwoStart + 1)
      .filter((entry) => entry.agent === "alpha");
    expect(stepTwoPrompts.length).toBeGreaterThan(0);
    expect(stepTwoPrompts[0]?.input).toContain(FIRST_MARKER);
    expect(stepTwoPrompts[0]?.input).toContain("the original subject");
    // Step one's bursts are not forwarded — only what its synthesizer made of
    // them.
    expect(stepTwoPrompts[0]?.input).not.toContain("end-of-alpha-1");
  });

  it("gives every step its own transcript and writes one combined document", async () => {
    const presets = [
      stepPreset("first", "synth-one"),
      stepPreset("second", "synth-two"),
    ];

    const result = await runChain(presets, "the subject", {
      runner: recordingRunner([]),
      outputDir: scratch.dir,
      runId: "files",
      retry: { maxRetries: 0 },
    });

    const paths = result.steps.map((step) => step.transcriptPath);
    expect(new Set(paths).size).toBe(2);
    expect(paths[0]).toContain("files-1-first");
    expect(paths[1]).toContain("files-2-second");

    for (const path of paths) {
      expect(await readFile(path, "utf8")).toContain("# Synthesis");
    }

    const combined = await readFile(result.combinedPath, "utf8");
    expect(combined).toContain("**Input:** the subject");
    expect(combined).toContain("## 1. first");
    expect(combined).toContain("## 2. second");
    expect(combined).toContain(FIRST_MARKER);
    expect(combined).toContain(SECOND_MARKER);
  });

  it("brackets every step's chain events with a step-scoped pair", async () => {
    const events: HarnessEvent[] = [];
    const presets = [
      stepPreset("first", "synth-one"),
      stepPreset("second", "synth-two"),
    ];

    await runChain(presets, "the subject", {
      runner: recordingRunner([]),
      outputDir: scratch.dir,
      runId: "events",
      retry: { maxRetries: 0 },
      onEvent: (event) => events.push(event),
    });

    const types = events.map((event) => event.type);
    expect(types[0]).toBe("composition:started");
    expect(types.at(-1)).toBe("composition:complete");

    const started = events.filter(
      (event) => event.type === "composition:step:started",
    );
    expect(started.map((event) => event.presetId)).toEqual(["first", "second"]);
    expect(started.map((event) => event.step)).toEqual([1, 2]);
    expect(started.every((event) => event.total === 2)).toBe(true);

    // Every chain event sits inside exactly one step's bracket, which is what
    // lets a surface attribute a burst without the burst carrying a step field.
    const firstOpen = types.indexOf("composition:step:started");
    const firstClose = types.indexOf("composition:step:complete");
    const chainStarts = types
      .map((type, index) => (type === "chain:started" ? index : -1))
      .filter((index) => index >= 0);
    expect(chainStarts).toHaveLength(2);
    expect(chainStarts[0]).toBeGreaterThan(firstOpen);
    expect(chainStarts[0]).toBeLessThan(firstClose);
    expect(chainStarts[1]).toBeGreaterThan(firstClose);
  });

  it("sums spend across steps", async () => {
    const presets = [
      stepPreset("first", "synth-one"),
      stepPreset("second", "synth-two"),
    ];

    const result = await runChain(presets, "the subject", {
      runner: recordingRunner([]),
      outputDir: scratch.dir,
      retry: { maxRetries: 0 },
    });

    const summed = result.steps.reduce(
      (total, step) => total + step.spentUsd,
      0,
    );
    expect(result.spentUsd).toBeCloseTo(summed, 10);
    expect(result.spentUsd).toBeGreaterThan(0);
  });

  it("stops the whole composition when a step is interrupted, and still synthesizes", async () => {
    const controller = new AbortController();
    const events: HarnessEvent[] = [];
    const presets = [
      stepPreset("first", "synth-one"),
      stepPreset("second", "synth-two"),
    ];
    presets[0] = { ...(presets[0] as PresetConfig), maxIterations: 20 };

    const result = await runChain(presets, "the subject", {
      runner: recordingRunner([]),
      outputDir: scratch.dir,
      retry: { maxRetries: 0 },
      signal: controller.signal,
      onEvent: (event) => {
        events.push(event);
        if (event.type === "burst:completed" && event.iteration === 0) {
          queueMicrotask(() => controller.abort());
        }
      },
    });

    expect(result.interrupted).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.stopReason).toBe("interrupted");
    // Interrupting asks for the closing document early; it does not throw the
    // transcript away.
    expect(result.steps[0]?.synthesis).toContain(FIRST_MARKER);

    const started = events.filter(
      (event) => event.type === "composition:step:started",
    );
    expect(started).toHaveLength(1);
  });

  it("starts nothing at all when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await runChain([stepPreset("first", "synth-one")], "x", {
      runner: recordingRunner([]),
      outputDir: scratch.dir,
      retry: { maxRetries: 0 },
      signal: controller.signal,
    });

    expect(result.steps).toHaveLength(0);
    expect(result.spentUsd).toBe(0);
    expect(result.interrupted).toBe(true);
  });

  it("refuses an empty composition", async () => {
    await expect(runChain([], "x", { outputDir: scratch.dir })).rejects.toThrow(
      /at least one preset/,
    );
  });
});
