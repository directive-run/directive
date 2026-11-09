/**
 * Differential fuzzing: random small systems × random step sequences must
 * trace identically on every engine (and twice on the reference).
 *
 * PR CI runs the fixed seed below for FUZZ_DEFAULT_RUNS (FUZZ_FLOOR + 5)
 * cases across every layer, so a run is reproducible and a couple of
 * runaways cannot drop the compared count under the floor, and adds the v2
 * share described below. The nightly workflow
 * (.github/workflows/diff-fuzz-nightly.yml) picks a random `DIFF_FUZZ_SEED`
 * and raises `DIFF_FUZZ_RUNS`. Fewer cases than the floor fail here and in
 * the census. On a failure fast-check shrinks the case and prints the seed
 * and path to replay it; the error also carries the shrunk spec and the
 * first divergence.
 *
 * A run has two phases of exact size (so the count is a guarantee, not a
 * probability) and the same replay: the seed and run count reproduce both.
 *
 * - RUNS cases are generated across every layer, the cases a run always
 *   had: v1 and the workspace engine are compared on all of them, v2 on those
 *   that happen to fit. Adding the v2 share never takes one of them away.
 * - On top of those, v2Cases(RUNS) more cases (FUZZ_V2_PERCENT of RUNS,
 *   lib/fuzz.ts) are generated with a ceiling at `current` in
 *   layers.rules.json, the highest layer core-next has built (model.ts
 *   `FEATURE_LAYERS`), so v2 takes part in them. Left to chance, nearly every
 *   case uses a feature above `current` and v2 sits out of it.
 *
 * Every engine run has a timer-callback budget (diff/scenario.ts
 * RUN_BUDGET). A case whose reference run passes it never settles on 1.35
 * itself (resolvers that keep re-triggering each other are legal there), so
 * it is discarded as a runaway and counted, not failed; the census floor
 * counts only compared cases. More than max(1% of cases, 2) runaways fail the
 * run (a generator drifting into runaways would compare nothing). A case the reference settles but an engine
 * under test does not is a hang, and fails, unless an `ends` divergence on
 * that engine had already ended the comparison before it ran away (before
 * its timer callbacks passed the reference's total): then it
 * is discarded like a reference runaway and counted toward the same limit
 * (Jason, 2026-11-02: "Discard after the stop"; diff/scenario.ts
 * `stopsBefore`).
 *
 * At a settle step both engines' clocks advance together until neither has
 * a batch still running, capped at 5 s (diff/scenario.ts `SettleDrain`;
 * Jason, 2026-11-07: "One shared wait (Recommended)"). A case whose
 * reference's batches are still live at the cap (with v2's or without)
 * never settles on 1.35 either (diff/scenario.ts `neverSettles`): it is
 * discarded too, but on its own count, never toward
 * the runaway limit, and more than maxNeverSettles (max(1% of the seed's
 * cases, 3)) fail the run (Jason, 2026-11-07: "Discard, own count
 * (Recommended)"; the cap, Jason, 2026-11-07: "Cap at 1% of cases, min 3
 * (Recommended)").
 *
 * A case an `ends` divergence stops (diff/scenario.ts `explain`: an approved
 * quirk whose consequences cascade) is compared up to that difference, and
 * counts as compared like any other (`tallyCase`).
 *
 * The cases compared on v2 are counted from what each run compared, not from
 * how the case was generated, and must reach FUZZ_V2_FLOOR (here and in the
 * census) whenever v2 has built a layer.
 */

import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  FUZZ_DEFAULT_RUNS,
  FUZZ_FLOOR,
  FUZZ_V2_FLOOR,
  maxNeverSettles,
  maxRunaways,
  v2Cases,
} from "../../lib/fuzz.js";
import {
  type FuzzTally,
  RUN_BUDGET,
  currentLayer,
  logFuzz,
  logResult,
  newFuzzTally,
  runScenario,
  tallyCase,
} from "../scenario.js";
import { type FuzzSpec, specArbitrary, toScenario } from "./model.js";

/**
 * Cases the ceiling phase runs before its random ones (fast-check
 * `examples`), on every seed: each shows one approved quirk whose fuzz
 * group (diff/divergences.json `group`) the fixed seed's random cases never
 * reach, so the census's stale check sees that group used on every PR run,
 * and finds it stale the day 2.0 stops showing the quirk.
 */
const PINNED = (
  JSON.parse(
    readFileSync(new URL("./pinned.json", import.meta.url), "utf8"),
  ) as { group: string; spec: FuzzSpec }[]
).map((p) => [p.spec] as [FuzzSpec]);

const SEED = Number(process.env.DIFF_FUZZ_SEED ?? 0x5eed);
const RUNS = Number(process.env.DIFF_FUZZ_RUNS ?? FUZZ_DEFAULT_RUNS);

/**
 * The second phase's seed: derived from the first, so one seed replays both
 * and the two phases do not draw the same numbers into similar arbitraries.
 */
const CEILING_SEED = (SEED ^ 0x7a3c91d5) | 0;

describe("differential fuzz", () => {
  it("random systems trace identically on every engine", async () => {
    expect(
      RUNS,
      `DIFF_FUZZ_RUNS must be at least ${FUZZ_FLOOR}`,
    ).toBeGreaterThanOrEqual(FUZZ_FLOOR);
    const current = currentLayer();
    const upToCurrent = current === null ? 0 : v2Cases(RUNS);
    const phases = [
      {
        label: "across every layer",
        runs: RUNS,
        seed: SEED,
        arbitrary: specArbitrary(),
        examples: [] as [FuzzSpec][],
      },
      ...(current === null
        ? []
        : [
            {
              label: `up to ${current}, where v2 takes part`,
              runs: upToCurrent,
              seed: CEILING_SEED,
              arbitrary: specArbitrary({ ceiling: current }),
              examples: PINNED,
            },
          ]),
    ];
    console.info(
      `[diff fuzz] seed ${SEED}, ${RUNS + upToCurrent} cases: ${phases.map((p) => `${p.runs} ${p.label}`).join(" + ")}`,
    );
    const tally: FuzzTally = newFuzzTally();
    const started = Date.now();
    try {
      for (const phase of phases) {
        try {
          await fc.assert(
            fc.asyncProperty(phase.arbitrary, async (spec) => {
              const result = await runScenario(toScenario(spec));
              tallyCase(tally, result);
              if (result.runaway || result.neverSettles) {
                return;
              }
              logResult(result);
              if (!result.ok) {
                throw new Error(
                  `${result.report}\n\nspec: ${JSON.stringify(spec)}`,
                );
              }
            }),
            {
              seed: phase.seed,
              numRuns: phase.runs,
              endOnFailure: false,
              examples: phase.examples,
            },
          );
        } catch (error) {
          if (error instanceof Error) {
            error.message = `[diff fuzz] failed in the phase ${phase.label}; replay both phases with DIFF_FUZZ_SEED=${SEED} DIFF_FUZZ_RUNS=${RUNS}\n${error.message}`;
          }
          throw error;
        }
      }
    } finally {
      const {
        ran,
        runaway,
        afterStop,
        onV2,
        mostFired,
        ended,
        drained,
        drainedDetached,
        sharedRerun,
        twoOnlyLive,
        bothLive,
        afterStopAtWait,
        afterStopBy,
        neverSettles,
      } = tally;
      console.info(
        `[diff fuzz] seed ${SEED}: ${ran} cases, ${runaway} runaway (discarded: ${runaway - afterStop} where the reference passed ${RUN_BUDGET} timer callbacks, ${afterStop} after a stop, where an engine under test passed them, or v2 alone was still live at the shared wait's cap (${afterStopAtWait} of them), once an \`ends\` divergence had ended the comparison${
          afterStop > 0
            ? `; stopped by ${Object.entries(afterStopBy)
                .map(([id, n]) => `${id} ×${n}`)
                .join(", ")}`
            : ""
        }), ${neverSettles} discarded because the reference never settles, ${ran - runaway - neverSettles} compared, ${onV2} of them on v2 too (v2 is built up to ${current ?? "nothing"}), ${ended} ended early by an \`ends\` divergence, the shared wait at a settle step advanced the reference's clock in ${drained} and v2's in ${drainedDetached}, ${sharedRerun} of them needing more than one round to find the common end time; most callbacks in a compared case ${mostFired}; ${((Date.now() - started) / 1000).toFixed(1)} s`,
      );
      console.info(
        `[diff fuzz] seed ${SEED}: ${neverSettles} never settles (discarded: the reference's batches were still live at the shared wait's 5 s cap at a settle step, ${bothLive} of them with v2's live too; at most ${maxNeverSettles(ran)} for this seed, max(1% of ${ran} cases, 3), not counted as runaways); ${twoOnlyLive} failed as 2.0-only live (v2 still live at the cap where the reference had finished, with no \`ends\` stop before v2 outworked the reference; Jason, 2026-11-08: "Use 'Discard after the stop' (Recommended)")`,
      );
      logFuzz(SEED, tally);
    }
    expect(
      tally.runaway,
      `too many runaway cases (limit max(1% of ${tally.ran}, 2))`,
    ).toBeLessThanOrEqual(maxRunaways(tally.ran));
    expect(
      tally.neverSettles,
      `too many cases whose reference never settles (limit max(1% of ${tally.ran}, 3); Jason, 2026-11-07: "Cap at 1% of cases, min 3 (Recommended)")`,
    ).toBeLessThanOrEqual(maxNeverSettles(tally.ran));
    if (current !== null) {
      expect(
        tally.onV2,
        `v2 is built up to ${current}, so at least ${FUZZ_V2_FLOOR} fuzz cases must be compared on it`,
      ).toBeGreaterThanOrEqual(FUZZ_V2_FLOOR);
    }
  });
});
