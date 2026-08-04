/**
 * What a surface that throws while rendering can and cannot do to a run.
 *
 * The answer has to be "nothing", and for the composition it was "stop it
 * permanently". A composition opens its step counter, announces the step, and
 * closes the counter in a `finally` further down; an announcement that threw
 * skipped everything in between, so `stepInFlight` stayed true, the composition
 * never settled, and the watchdog that exists to end a run which will not
 * finish could not fire — its own quiet test reads that counter.
 */

import { describe, expect, it } from "vitest";
import { runComposition } from "../core/composition.js";
import type { HarnessEvent } from "../core/events.js";
import { createMockRunner } from "../core/mock-runner.js";
import { createHarnessSystem } from "../core/system.js";
import { createMemoryTranscriptStore } from "../core/transcript.js";
import { cannedTurn, testPreset } from "./fixtures.js";

function runner() {
  return createMockRunner({
    responses: {
      alpha: [cannedTurn("alpha", 1), cannedTurn("alpha", 2)],
      beta: [cannedTurn("beta", 1), cannedTurn("beta", 2)],
      gamma: [cannedTurn("gamma", 1)],
      synth: ["a closing document"],
    },
  });
}

describe("a listener that throws", () => {
  it("does not stop a composition, and is reported on the stream", async () => {
    const seen: HarnessEvent[] = [];

    // Throws on the one event emitted in the window that used to be
    // unprotected: after the step counter opens and before the `try` that
    // closes it.
    const result = await runComposition(
      [testPreset({ id: "one", maxIterations: 1, budgetUsd: 5 })],
      "a subject",
      {
        runner: runner(),
        transcripts: createMemoryTranscriptStore(),
        onEvent: (event) => {
          seen.push(event);
          if (event.type === "composition:step:started") {
            throw new Error("the surface fell over");
          }
        },
      },
    );

    // It finished at all, which is the whole assertion. Before this it did not
    // — no `composition:complete`, no settle, and the watchdog structurally
    // unable to notice.
    expect(result.steps).toHaveLength(1);
    expect(result.synthesis).not.toBe("");

    // And the throw was neither swallowed nor turned into the run's failure.
    const reported = seen.filter(
      (event) => event.type === "error" && event.scope === "listener",
    );
    expect(reported.length).toBeGreaterThan(0);
    expect(reported[0]).toMatchObject({
      type: "error",
      scope: "listener",
      message: "the surface fell over",
    });
    expect(result.failure).toBe("");
  }, 20_000);

  it("does not stop a single chain either", async () => {
    const seen: HarnessEvent[] = [];
    const harness = createHarnessSystem(
      testPreset({ maxIterations: 1, budgetUsd: 5 }),
      {
        runner: runner(),
        onEvent: (event) => {
          seen.push(event);
          if (event.type === "turn:started") {
            throw new Error("the surface fell over");
          }
        },
      },
    );

    const result = await harness.run("a subject");
    harness.system.destroy();

    expect(result.phase).toBe("complete");
    expect(
      seen.some(
        (event) => event.type === "error" && event.scope === "listener",
      ),
    ).toBe(true);
  }, 20_000);

  it("reports its own failure once rather than looping", async () => {
    const seen: HarnessEvent[] = [];
    const harness = createHarnessSystem(
      testPreset({ maxIterations: 1, budgetUsd: 5 }),
      {
        runner: runner(),
        onEvent: (event) => {
          seen.push(event);
          // Throws on everything, including the report of its own throw.
          throw new Error("always");
        },
      },
    );

    await harness.run("a subject");
    harness.system.destroy();

    // One report per event that failed, and no report of a report — the
    // recursion is one level deep by construction.
    const listenerErrors = seen.filter(
      (event) => event.type === "error" && event.scope === "listener",
    );
    expect(listenerErrors.length).toBeGreaterThan(0);
    expect(listenerErrors.length).toBeLessThan(seen.length);
  }, 20_000);
});
