/**
 * A retry replays a response. The transcript must not replay with it.
 *
 * This is the reason bursts are buffered rather than appended per token. The
 * bug being guarded against is quiet: the transcript ends up holding the
 * abandoned half of a burst followed by the whole of it, as one contribution,
 * and every persona downstream reads that as context. Nothing errors, nothing
 * is missing, and the review just gets slightly worse.
 */

import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HarnessEvent } from "../core/events.js";
import { createMockRunner } from "../core/mock-runner.js";
import { createHarnessSystem } from "../core/system.js";
import { createTranscript } from "../core/transcript.js";
import {
  type Scratch,
  cannedBurst,
  cannedResponses,
  createScratch,
  testPreset,
} from "./fixtures.js";

/** How many times `needle` occurs in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("transcript", () => {
  let scratch: Scratch;

  beforeEach(async () => {
    scratch = await createScratch();
  });

  afterEach(async () => {
    await scratch.cleanup();
  });

  it("holds one copy of a burst that was retried mid-stream", async () => {
    const events: HarnessEvent[] = [];
    const preset = testPreset({ budgetUsd: 100, maxIterations: 3 });

    const harness = createHarnessSystem(preset, {
      runner: createMockRunner({
        responses: {
          ...cannedResponses(),
          // A fixed string rather than a cycling script: the replay returns
          // byte-for-byte what the failed attempt was delivering, which is what
          // a real provider does and what makes "exactly one copy" meaningful.
          alpha: cannedBurst("alpha", 1),
        },
        // Fail two deltas in, so the provider has already delivered text when
        // the call dies.
        failures: [{ agent: "alpha", call: 1, afterDeltas: 2 }],
      }),
      outputDir: scratch.dir,
      runId: "retry-run",
      retry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 2 },
      onEvent: (event) => events.push(event),
    });

    const result = await harness.run("go");
    harness.system.destroy();

    // The retry really did happen, and really did replay.
    const restarts = events.filter((event) => event.type === "burst:restarted");
    expect(restarts).toHaveLength(1);
    expect(restarts[0]?.iteration).toBe(0);
    expect(result.stopReason).toBe("max-iterations");
    expect(result.iterations).toBe(3);

    // One committed burst per iteration — the failed attempt committed nothing.
    const bursts = harness.transcript.bursts();
    expect(bursts).toHaveLength(3);
    expect(bursts[0]?.persona).toBe("alpha");

    // And the surviving text is exactly one burst, not one and a half.
    const expected = cannedBurst("alpha", 1);
    expect(bursts[0]?.text).toBe(expected);

    const markdown = await readFile(result.transcriptPath, "utf8");
    expect(countOccurrences(markdown, "end-of-alpha-1")).toBe(1);
    expect(countOccurrences(markdown, "## 1. alpha")).toBe(1);
    // The abandoned attempt's prefix appears once — as the start of the one
    // surviving burst, not a second time ahead of it.
    expect(countOccurrences(markdown, "[alpha#1]")).toBe(1);

    const sidecar = await readFile(result.jsonlPath, "utf8");
    expect(sidecar.trim().split("\n")).toHaveLength(3);
  });

  it("commits nothing for a burst that never completed", async () => {
    const preset = testPreset({ budgetUsd: 100, maxIterations: 3 });

    const harness = createHarnessSystem(preset, {
      runner: createMockRunner({
        responses: cannedResponses(),
        // Every attempt at beta's first burst fails, so it exhausts retries.
        failures: [
          { agent: "beta", call: 1, afterDeltas: 2 },
          { agent: "beta", call: 2, afterDeltas: 2 },
        ],
      }),
      outputDir: scratch.dir,
      retry: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 2 },
    });

    const result = await harness.run("go");
    const bursts = harness.transcript.bursts();
    harness.system.destroy();

    // The chain cut over to synthesis on what it had rather than stalling on an
    // unmet requirement, and reported why.
    expect(result.stopReason).toBe("error");
    expect(result.iterations).toBe(1);
    expect(bursts).toHaveLength(1);
    expect(bursts[0]?.persona).toBe("alpha");
    // Nothing from the failed burst leaked in.
    expect(bursts.some((burst) => burst.persona === "beta")).toBe(false);
    // The transcript it did have was still synthesized.
    expect(result.synthesis).toContain("SYNTHESIS");
  });

  it("appends the sidecar rather than rewriting it, and flushes idempotently", async () => {
    const transcript = createTranscript({ dir: scratch.dir, runId: "flush" });
    transcript.setInput("in");

    transcript.beginBurst();
    transcript.appendToken("hello ");
    transcript.appendToken("world");
    transcript.completeBurst({
      iteration: 0,
      persona: "alpha",
      text: "",
      costUsd: 0.1,
      at: 1,
    });

    await transcript.flush();
    await transcript.flush();
    await transcript.flush();

    const sidecar = await readFile(transcript.jsonlPath, "utf8");
    expect(sidecar.trim().split("\n")).toHaveLength(1);
    // The buffered deltas stood in for a runner that returned no text.
    expect(JSON.parse(sidecar.trim()).text).toBe("hello world");
  });

  it("discards the pending buffer on beginBurst, which is what a replay does", () => {
    const transcript = createTranscript({ dir: scratch.dir, runId: "buffer" });

    transcript.beginBurst();
    transcript.appendToken("abandoned half");
    expect(transcript.pending()).toBe("abandoned half");

    transcript.beginBurst();
    expect(transcript.pending()).toBe("");

    transcript.appendToken("the real thing");
    const record = transcript.completeBurst({
      iteration: 0,
      persona: "alpha",
      text: "",
      costUsd: 0,
      at: 0,
    });

    expect(record.text).toBe("the real thing");
    expect(transcript.pending()).toBe("");
  });
});
