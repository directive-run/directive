/**
 * Differential fuzzing: random small systems × random step sequences must
 * trace identically on every engine (and twice on the reference).
 *
 * PR CI runs the fixed seed below for FUZZ_FLOOR cases, so a run is
 * reproducible. The nightly workflow (.github/workflows/diff-fuzz-nightly.yml)
 * picks a random `DIFF_FUZZ_SEED` and raises `DIFF_FUZZ_RUNS`. Fewer cases
 * than the floor fail here and in the census. On a failure fast-check
 * shrinks the case and prints the seed and path to replay it; the error
 * also carries the shrunk spec and the first divergence.
 *
 * Every engine run has a timer-callback budget (diff/scenario.ts
 * RUN_BUDGET). A case whose reference run passes it never settles on 1.35
 * itself (resolvers that keep re-triggering each other are legal there), so
 * it is discarded as a runaway and counted, not failed; the census floor
 * counts only compared cases. A case the reference settles but an engine
 * under test does not is a hang, and fails.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FUZZ_FLOOR } from "../../lib/fuzz.js";
import { RUN_BUDGET, logFuzz, logResult, runScenario } from "../scenario.js";
import { specArbitrary, toScenario } from "./model.js";

const SEED = Number(process.env.DIFF_FUZZ_SEED ?? 0x5eed);
const RUNS = Number(process.env.DIFF_FUZZ_RUNS ?? FUZZ_FLOOR);

describe("differential fuzz", () => {
  it("random systems trace identically on every engine", async () => {
    expect(
      RUNS,
      `DIFF_FUZZ_RUNS must be at least ${FUZZ_FLOOR}`,
    ).toBeGreaterThanOrEqual(FUZZ_FLOOR);
    console.info(`[diff fuzz] seed ${SEED}, ${RUNS} runs`);
    let ran = 0;
    let runaway = 0;
    let mostFired = 0;
    const started = Date.now();
    try {
      await fc.assert(
        fc.asyncProperty(specArbitrary(), async (spec) => {
          ran++;
          const result = await runScenario(toScenario(spec));
          if (result.runaway) {
            runaway++;

            return;
          }
          mostFired = Math.max(mostFired, result.fired);
          logResult(result);
          if (!result.ok) {
            throw new Error(
              `${result.report}\n\nspec: ${JSON.stringify(spec)}`,
            );
          }
        }),
        { seed: SEED, numRuns: RUNS, endOnFailure: false },
      );
    } finally {
      console.info(
        `[diff fuzz] seed ${SEED}: ${ran} cases, ${runaway} runaway (reference passed ${RUN_BUDGET} timer callbacks; discarded), ${ran - runaway} compared; most callbacks in a compared case ${mostFired}; ${((Date.now() - started) / 1000).toFixed(1)} s`,
      );
      logFuzz(SEED, ran - runaway, runaway);
    }
  });
});
