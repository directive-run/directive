/**
 * What the exit code says about a run that did not go to plan.
 *
 * A shell cannot read a screen, so the outcome has to be on the code. The cases
 * here are the ones where the code and the screen used to disagree — a run that
 * failed outright and exited as though the budget had been the problem, a
 * composition that ran one step of three and exited clean, and a transcript
 * that was never written under a path the command had already printed.
 *
 * The mapping is read directly rather than through a provider, because every
 * case below is a shape of the event stream and standing up a run that produces
 * each one would be testing the mock.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ExitCode,
  emptyOutcome,
  exitCodeFor,
  observeOutcome,
  resolveInput,
} from "../adapters/cli/index.js";
import type { CliArgs } from "../adapters/cli/index.js";
import type { HarnessEvent, StopReason } from "../core/events.js";

function chainComplete(
  overrides: Partial<Extract<HarnessEvent, { type: "chain:complete" }>> = {},
): HarnessEvent {
  return {
    type: "chain:complete",
    runId: "run-1",
    phase: "complete",
    stopReason: "max-iterations" as StopReason,
    iterations: 2,
    spentUsd: 0.1,
    budgetUsd: 1,
    synthesis: "a closing document",
    synthesisSkipped: false,
    transcriptPath: "memory://run-1.md",
    jsonlPath: "memory://run-1.jsonl",
    at: 0,
    ...overrides,
  };
}

function codeFor(events: readonly HarnessEvent[]): number {
  const outcome = emptyOutcome();
  for (const event of events) {
    observeOutcome(outcome, event);
  }

  return exitCodeFor(outcome);
}

describe("the exit code", () => {
  it("is clean for a run that produced its closing document", () => {
    expect(codeFor([chainComplete()])).toBe(ExitCode.ok);
    expect(codeFor([chainComplete()])).toBe(0);
  });

  it("calls a failed turn a failure rather than an empty run", () => {
    // A first turn whose provider refused every attempt. The chain records the
    // failure and stops; with nothing in the transcript there is no synthesis
    // to run, so the phase is `"complete"` and only `stopReason` knows. Reading
    // the phase alone exited 2, whose own documentation says nothing failed and
    // a larger budget is usually the answer — while the screen, correctly, said
    // it was not a budget problem.
    const code = codeFor([
      chainComplete({ stopReason: "error", synthesis: "", iterations: 0 }),
    ]);

    expect(code).toBe(ExitCode.failed);
    expect(code).toBe(3);
  });

  it("calls a failed turn a failure even when the chain still synthesized", () => {
    // A later turn that failed. The chain cuts over to synthesis and produces a
    // real document, which used to exit 0 — the document is real and so is the
    // gap in the transcript underneath it.
    expect(
      codeFor([chainComplete({ stopReason: "error", iterations: 3 })]),
    ).toBe(ExitCode.failed);
  });

  it("still calls a synthesizer failure a failure", () => {
    expect(
      codeFor([
        chainComplete({ phase: "failed", stopReason: "", synthesis: "" }),
      ]),
    ).toBe(ExitCode.failed);
  });

  it("calls a run that produced nothing an empty run", () => {
    expect(
      codeFor([
        chainComplete({
          synthesis: "",
          synthesisSkipped: true,
          stopReason: "budget",
        }),
      ]),
    ).toBe(ExitCode.noOutput);
  });

  it("calls a composition that could not afford every step a short run", () => {
    // One step of three, each whole, and nothing failed. It exited 0, so
    // `harness … && ship` shipped on a third of the analysis it asked for.
    const code = codeFor([
      chainComplete(),
      {
        type: "composition:budget-exhausted",
        runId: "run-1",
        step: 2,
        total: 3,
        presetId: "pre-mortem",
        spentUsd: 0.9,
        budgetUsd: 1,
        requiredUsd: 0.4,
        at: 0,
      },
    ]);

    expect(code).toBe(ExitCode.noOutput);
    expect(code).toBe(2);
  });

  it("calls a transcript that could not be written a failure", () => {
    // The command prints the transcript path either way. A caller who reads
    // one that was never written has been told something untrue, and exiting 0
    // is how they come to believe it.
    expect(
      codeFor([
        chainComplete(),
        {
          type: "error",
          scope: "transcript",
          message: "ENOSPC: no space left on device",
          at: 0,
        },
      ]),
    ).toBe(ExitCode.failed);
  });

  it("still calls a step that could not run a failure", () => {
    expect(
      codeFor([
        { type: "error", scope: "step", message: "could not build", at: 0 },
      ]),
    ).toBe(ExitCode.failed);
  });

  it("does not let a surface's own bug become the run's exit code", () => {
    // A listener that threw is reported on the same stream. It is not the
    // run's failure and must not be read as one.
    expect(
      codeFor([
        chainComplete(),
        { type: "error", scope: "listener", message: "render threw", at: 0 },
      ]),
    ).toBe(ExitCode.ok);
  });
});

// ============================================================================
// Input
// ============================================================================

function cliArgs(overrides: Partial<CliArgs> = {}): CliArgs {
  return {
    presets: ["code-review"],
    listPresets: false,
    dryRun: false,
    outDir: ".",
    verbose: false,
    ...overrides,
  };
}

describe("resolveInput with nowhere to read from", () => {
  let wasTTY: boolean | undefined;

  beforeEach(() => {
    wasTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: wasTTY,
      configurable: true,
    });
  });

  it("gives up rather than waiting on a pipe nobody writes to", async () => {
    // The CI shape: no TTY, stdin inherited and never closed. The read had no
    // clock on it, so a step that should have exited with the usage code hung
    // until the runner killed the job.
    await expect(
      resolveInput(cliArgs(), { stdinFirstByteMs: 50 }),
    ).rejects.toThrow(/no input/);
  }, 10_000);

  it("does not consult stdin at all when --input was given", async () => {
    await expect(
      resolveInput(cliArgs({ input: "a subject" }), { stdinFirstByteMs: 1 }),
    ).resolves.toBe("a subject");
  });
});
