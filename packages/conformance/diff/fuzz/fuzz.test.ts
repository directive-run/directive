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
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FUZZ_FLOOR } from "../../lib/fuzz.js";
import { logFuzz, logResult, runScenario } from "../scenario.js";
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
    try {
      await fc.assert(
        fc.asyncProperty(specArbitrary(), async (spec) => {
          ran++;
          const result = await runScenario(toScenario(spec));
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
      logFuzz(SEED, ran);
    }
  });
});
