/**
 * An interrupt is a fact flip, and the cascade does the rest.
 *
 * The property under test is that interrupting takes the chain down the *same*
 * path the budget takes it down — it stops taking turns and it still synthesizes.
 * If interrupting were a branch rather than a fact, "did synthesis still run"
 * would be a separate decision with its own answer, and this is the test that
 * would find the two answers disagreeing.
 */

import type { AgentRunner } from "@directive-run/ai";
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
      transcripts: createFileTranscriptStore({ dir: scratch.dir }),
      retry: { maxRetries: 0 },
      onEvent: (event) => {
        events.push(event);
        if (event.type === "turn:completed" && event.iteration === 1) {
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

  it("lets the turn in flight finish, so the transcript is never half a turn", async () => {
    const preset = testPreset({ budgetUsd: 100, maxIterations: 30 });

    const harness = createHarnessSystem(preset, {
      runner: createMockRunner({ responses: cannedResponses(), delayMs: 5 }),
      transcripts: createFileTranscriptStore({ dir: scratch.dir }),
      retry: { maxRetries: 0 },
      onEvent: (event) => {
        // Interrupt while a turn is streaming, not between turns.
        if (event.type === "turn:delta" && event.iteration === 1) {
          queueMicrotask(() => harness.abort());
        }
      },
    });

    const result = await harness.run("go");
    const turns = harness.transcript.turns();
    harness.system.destroy();

    expect(result.stopReason).toBe("interrupted");
    // Every committed turn is whole — the one that was streaming when the
    // interrupt landed ran to completion rather than being torn up.
    for (const turn of turns) {
      expect(turn.text).toContain(`end-of-${turn.persona}-`);
    }
    expect(turns.length).toBe(result.iterations);
  });

  it("does not start the synthesis alongside the turn it interrupted", async () => {
    // Ample budget, so the only thing that ends this run is the interrupt and
    // the only thing that can put the ledger and the report out of step is the
    // turn still in flight when the synthesis is authorized.
    const preset = testPreset({ budgetUsd: 100, maxIterations: 30 });
    /** Every prompt the synthesizer was given. */
    const synthesisPrompts: string[] = [];

    const scripted = createMockRunner({
      responses: cannedResponses(),
      delayMs: 5,
    });
    const runner: AgentRunner = async (agent, input, options) => {
      if (agent.name === "synth") {
        synthesisPrompts.push(input);
      }

      return scripted(agent, input, options);
    };

    const turnCosts: number[] = [];
    const harness = createHarnessSystem(preset, {
      runner,
      transcripts: createFileTranscriptStore({ dir: scratch.dir }),
      retry: { maxRetries: 0 },
      onEvent: (event) => {
        if (event.type === "turn:completed") {
          turnCosts.push(event.costUsd);
        }
        // Mid-stream, so the interrupt lands while the turn is being billed.
        if (event.type === "turn:delta" && event.iteration === 1) {
          queueMicrotask(() => harness.abort());
        }
      },
    });

    const result = await harness.run("go");
    const billed = harness.spentUsd();
    const turns = harness.transcript.turns();
    harness.system.destroy();

    expect(result.stopReason).toBe("interrupted");
    expect(result.synthesis).toContain("SYNTHESIS");

    // The document was written from the transcript the artefact holds.
    // Dispatching the synthesis alongside the turn assembled its prompt from a
    // transcript missing that turn, while the turn landed in the markdown — so
    // the closing document described a conversation the artefact contradicted.
    expect(synthesisPrompts).toHaveLength(1);
    const [prompt] = synthesisPrompts;
    expect(turns.length).toBe(result.iterations);
    for (const turn of turns) {
      expect(prompt).toContain(`end-of-${turn.persona}-`);
      expect(prompt).toContain(turn.text);
    }

    // And the figure the caller was given covers every turn plus the closing
    // document, rather than being the total as it stood before the interrupted
    // turn was billed.
    const turnTotal = turnCosts.reduce((total, cost) => total + cost, 0);
    expect(result.spentUsd).toBeGreaterThan(turnTotal);
    expect(result.spentUsd).toBe(billed);
    expect(result.spentUsd).toBeLessThanOrEqual(preset.budgetUsd);
  });

  it("is idempotent — aborting twice is aborting once", async () => {
    const preset = testPreset({ budgetUsd: 100, maxIterations: 30 });

    const harness = createHarnessSystem(preset, {
      runner: createMockRunner({ responses: cannedResponses() }),
      transcripts: createFileTranscriptStore({ dir: scratch.dir }),
      retry: { maxRetries: 0 },
      onEvent: (event) => {
        if (event.type === "turn:completed" && event.iteration === 0) {
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
