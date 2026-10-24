/**
 * Differential fuzzing: random small systems × random step sequences must
 * trace identically on every engine (and twice on the reference).
 *
 * PR CI runs the fixed seed below for FUZZ_DEFAULT_RUNS (FUZZ_FLOOR + 5)
 * cases, so a run is reproducible and a couple of runaways cannot drop the
 * compared count under the floor. The nightly workflow (.github/workflows/diff-fuzz-nightly.yml)
 * picks a random `DIFF_FUZZ_SEED` and raises `DIFF_FUZZ_RUNS`. Fewer cases
 * than the floor fail here and in the census. On a failure fast-check
 * shrinks the case and prints the seed and path to replay it; the error
 * also carries the shrunk spec and the first divergence.
 *
 * A run has two phases of exact size (so the split is a guarantee, not a
 * probability) and the same replay: the seed and run count reproduce both.
 *
 * - FUZZ_V2_PERCENT of the cases (lib/fuzz.ts) are generated with a ceiling
 *   at `current` in layers.rules.json, the highest layer core-next has built
 *   (model.ts `FEATURE_LAYERS`), so v2 takes part in them. Left to chance,
 *   nearly every case uses a feature above `current` and v2 sits out of it.
 * - The rest are generated across every layer, as before: v1 and the
 *   workspace engine are compared on all of them, v2 on those that happen to
 *   fit.
 *
 * Every engine run has a timer-callback budget (diff/scenario.ts
 * RUN_BUDGET). A case whose reference run passes it never settles on 1.35
 * itself (resolvers that keep re-triggering each other are legal there), so
 * it is discarded as a runaway and counted, not failed; the census floor
 * counts only compared cases. More than max(1% of cases, 2) runaways fail the
 * run (a generator drifting into runaways would compare nothing). A case the reference settles but an engine
 * under test does not is a hang, and fails.
 *
 * The cases compared on v2 are counted from what each run compared, not from
 * how the case was generated, and must reach FUZZ_V2_FLOOR (here and in the
 * census) whenever v2 has built a layer.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  FUZZ_DEFAULT_RUNS,
  FUZZ_FLOOR,
  FUZZ_V2_FLOOR,
  maxRunaways,
  v2Cases,
} from "../../lib/fuzz.js";
import {
  RUN_BUDGET,
  currentLayer,
  logFuzz,
  logResult,
  runScenario,
} from "../scenario.js";
import { specArbitrary, toScenario } from "./model.js";

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
        runs: RUNS - upToCurrent,
        seed: SEED,
        arbitrary: specArbitrary(),
      },
      ...(current === null
        ? []
        : [
            {
              label: `up to ${current}, where v2 takes part`,
              runs: upToCurrent,
              seed: CEILING_SEED,
              arbitrary: specArbitrary({ ceiling: current }),
            },
          ]),
    ];
    console.info(
      `[diff fuzz] seed ${SEED}, ${RUNS} runs: ${phases.map((p) => `${p.runs} ${p.label}`).join(", ")}`,
    );
    let ran = 0;
    let runaway = 0;
    let onV2 = 0;
    let mostFired = 0;
    const started = Date.now();
    try {
      for (const phase of phases) {
        try {
          await fc.assert(
            fc.asyncProperty(phase.arbitrary, async (spec) => {
              ran++;
              const result = await runScenario(toScenario(spec));
              if (result.runaway) {
                runaway++;

                return;
              }
              if (result.compared.includes("v2")) {
                onV2++;
              }
              mostFired = Math.max(mostFired, result.fired);
              logResult(result);
              if (!result.ok) {
                throw new Error(
                  `${result.report}\n\nspec: ${JSON.stringify(spec)}`,
                );
              }
            }),
            { seed: phase.seed, numRuns: phase.runs, endOnFailure: false },
          );
        } catch (error) {
          if (error instanceof Error) {
            error.message = `[diff fuzz] failed in the phase ${phase.label}; replay both phases with DIFF_FUZZ_SEED=${SEED} DIFF_FUZZ_RUNS=${RUNS}\n${error.message}`;
          }
          throw error;
        }
      }
    } finally {
      console.info(
        `[diff fuzz] seed ${SEED}: ${ran} cases, ${runaway} runaway (reference passed ${RUN_BUDGET} timer callbacks; discarded), ${ran - runaway} compared, ${onV2} of them on v2 too (v2 is built up to ${current ?? "nothing"}); most callbacks in a compared case ${mostFired}; ${((Date.now() - started) / 1000).toFixed(1)} s`,
      );
      logFuzz(SEED, ran - runaway, runaway, onV2);
    }
    expect(
      runaway,
      `too many runaway cases (limit max(1% of ${ran}, 2))`,
    ).toBeLessThanOrEqual(maxRunaways(ran));
    if (current !== null) {
      expect(
        onV2,
        `v2 is built up to ${current}, so at least ${FUZZ_V2_FLOOR} fuzz cases must be compared on it`,
      ).toBeGreaterThanOrEqual(FUZZ_V2_FLOOR);
    }
  });
});
