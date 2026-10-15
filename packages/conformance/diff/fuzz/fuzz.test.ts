/**
 * Differential fuzzing: random small systems × random step sequences must
 * trace identically on both engines (and twice on the reference).
 *
 * CI runs a fixed seed, so a run is reproducible; `DIFF_FUZZ_RUNS` raises the
 * count for a nightly run and `DIFF_FUZZ_SEED` explores other seeds. On a
 * failure fast-check shrinks the case and prints the seed and path to replay
 * it; the error also carries the shrunk spec and the first divergence.
 */

import fc from "fast-check";
import { describe, it } from "vitest";
import { logUsed, runScenario } from "../scenario.js";
import { specArbitrary, toScenario } from "./model.js";

const SEED = Number(process.env.DIFF_FUZZ_SEED ?? 0x5eed);
const RUNS = Number(process.env.DIFF_FUZZ_RUNS ?? 200);

describe("differential fuzz", () => {
  it("random systems trace identically on both engines", async () => {
    await fc.assert(
      fc.asyncProperty(specArbitrary(), async (spec) => {
        const result = await runScenario(toScenario(spec));
        logUsed(result.used);
        if (!result.ok) {
          throw new Error(`${result.report}\n\nspec: ${JSON.stringify(spec)}`);
        }
      }),
      { seed: SEED, numRuns: RUNS, endOnFailure: false },
    );
  });
});
