/**
 * What a run says about money it has already spent.
 *
 * Three separate ways the package used to report a figure that was not the
 * figure: a run that finished above its ceiling and said nothing, an accessor
 * that read a stale copy of the ledger, and a composition that read that
 * accessor to decide what the next step could have.
 */

import { describe, expect, it } from "vitest";
import type { HarnessEvent } from "../core/events.js";
import { createMockRunner } from "../core/mock-runner.js";
import { createHarnessSystem } from "../core/system.js";
import { cannedTurn, testPreset } from "./fixtures.js";

describe("spend a run finished with", () => {
  /**
   * A preset whose synthesizer will be dispatched three times and billed for
   * each — the shipped retry policy, on a budget just large enough to authorize
   * the first attempt.
   */
  function overrunPreset() {
    return testPreset({
      budgetUsd: 0.025,
      maxIterations: 1,
      tokensPerTurn: 50,
      synthesizer: {
        name: "synth",
        systemPrompt: "You synthesize.",
        promptTemplate: "Transcript:\n{{transcript}}",
        maxTokens: 1000,
      },
    });
  }

  it("says so when it finished above its ceiling", async () => {
    const events: HarnessEvent[] = [];
    const harness = createHarnessSystem(overrunPreset(), {
      runner: createMockRunner({
        responses: {
          alpha: [cannedTurn("alpha", 1)],
          synth: ["S".repeat(4000)],
        },
        chunkChars: 200,
        failures: [
          { agent: "synth", call: 1, afterDeltas: 19 },
          { agent: "synth", call: 2, afterDeltas: 19 },
        ],
      }),
      onEvent: (event) => events.push(event),
    });

    const result = await harness.run("subject");
    harness.system.destroy();

    // The premise. A synthesis authorized against a one-call reserve, retried,
    // and billed for every attempt puts the run past the number it was given —
    // the ledger floor bounds this at one call, it does not prevent it.
    expect(result.spentUsd).toBeGreaterThan(result.budgetUsd);

    // And the run is otherwise entirely ordinary: a complete phase, no failure,
    // nothing on the stream that reads as a problem. Which is exactly why the
    // overshoot has to be announced — there is no other way to find it.
    expect(result.phase).toBe("complete");

    const overrun = events.filter((event) => event.type === "budget:overrun");
    expect(overrun).toHaveLength(1);
    expect(overrun[0]).toMatchObject({
      type: "budget:overrun",
      spentUsd: result.spentUsd,
      budgetUsd: result.budgetUsd,
      overshootUsd: result.spentUsd - result.budgetUsd,
    });
    expect(
      (overrun[0] as Extract<HarnessEvent, { type: "budget:overrun" }>)
        .fraction,
    ).toBeGreaterThan(1);

    // Before `chain:complete`, so a surface rendering in order explains the
    // total before it prints it.
    const overrunAt = events.findIndex(
      (event) => event.type === "budget:overrun",
    );
    const completeAt = events.findIndex(
      (event) => event.type === "chain:complete",
    );
    expect(overrunAt).toBeLessThan(completeAt);
  });

  it("says nothing about an overrun on a run that stayed under", async () => {
    const events: HarnessEvent[] = [];
    const harness = createHarnessSystem(testPreset({ maxIterations: 2 }), {
      runner: createMockRunner({
        responses: {
          alpha: [cannedTurn("alpha", 1)],
          beta: [cannedTurn("beta", 1)],
          synth: ["a closing document"],
        },
      }),
      onEvent: (event) => events.push(event),
    });

    const result = await harness.run("subject");
    harness.system.destroy();

    expect(result.spentUsd).toBeLessThan(result.budgetUsd);
    expect(events.some((event) => event.type === "budget:overrun")).toBe(false);
  });
});

describe("spentUsd() mid-turn", () => {
  /**
   * The window where the two figures genuinely differ.
   *
   * `spentUsd` the fact is a copy, written on a resolver's way out. A turn that
   * streamed, failed, and is waiting out a retry backoff has been billed for
   * what it delivered — the ledger says so — and its resolver has not exited,
   * so nothing has copied that anywhere. Everything a caller can reach during
   * that window used to read the copy: the accessor, and the message a teardown
   * builds.
   */
  function retryingHarness() {
    return createHarnessSystem(testPreset({ maxIterations: 2 }), {
      runner: createMockRunner({
        responses: {
          alpha: [cannedTurn("alpha", 1)],
          beta: [cannedTurn("beta", 1)],
          synth: ["a closing document"],
        },
        failures: [{ agent: "alpha", call: 1, afterDeltas: 4 }],
      }),
      retry: { maxRetries: 1, baseDelayMs: 400, maxDelayMs: 400 },
    });
  }

  it("reports the ledger while a failed attempt waits out its backoff", async () => {
    const harness = retryingHarness();
    // The fact, reached the way nothing outside this package can — the public
    // handle is `System<never>` on purpose. Read here only to show the two
    // figures are different at this instant.
    const facts = (harness.system as unknown as { facts: { spentUsd: number } })
      .facts;

    const running = harness.run("subject");
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(facts.spentUsd).toBe(0);
    expect(harness.spentUsd()).toBeGreaterThan(0);

    await running;
    harness.system.destroy();
  });

  it("puts that figure in the message a teardown hands the caller", async () => {
    const harness = retryingHarness();

    const running = harness.run("subject");
    await new Promise((resolve) => setTimeout(resolve, 200));
    const billed = harness.spentUsd();
    harness.system.destroy();

    // Not `$0.0000`. A caller who reached for the kill switch is owed the
    // figure the run had actually reached, and the copy in the facts had not
    // moved since the run began.
    await expect(running).rejects.toThrow(
      new RegExp(`\\$${billed.toFixed(4)} are on the transcript`),
    );
    expect(billed).toBeGreaterThan(0);
  });
});
