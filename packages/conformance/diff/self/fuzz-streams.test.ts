/**
 * The data forms (L11-pre) are drawn from their own stream, so adding them
 * changes no case a seed draws at L10 or below.
 *
 * Why: drawn inside the fuzz's "across every layer" phase, a third of its
 * cases took data forms and moved to L11, where v2 sits out, and the quirks
 * those cases had reached went unreached: the census at L10 listed 25 signed
 * diff/divergences.json entries as stale. Now that phase draws at
 * `BASE_CEILING` (`baseArbitrary`), and the data forms come from a phase and
 * seed of their own (`dataFormArbitrary`, diff/fuzz/fuzz.test.ts).
 *
 * The digests are of fad9b89a's `specArbitrary()` (the L10 gate's run 1, the
 * last model before the data forms), drawn with the PR seed 24301 at the PR
 * run count (205) and at 2000 cases.
 */

import { createHash } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  BASE_CEILING,
  type FuzzSpec,
  baseArbitrary,
  dataFormArbitrary,
  specLayer,
  withoutPredicates,
} from "../fuzz/model.js";

const digest = (specs: FuzzSpec[]) =>
  createHash("sha256").update(JSON.stringify(specs)).digest("hex").slice(0, 16);

/** fad9b89a's `specArbitrary()`, seed 24301. */
const BEFORE = { 205: "cd45b42ca5d48c12", 2000: "ba99713df91cc080" } as const;

describe("the fuzz's random streams", () => {
  it("draws seed 24301's cases up to L10 byte for byte as before the data forms", () => {
    expect(BASE_CEILING).toBe("L10");
    for (const numRuns of [205, 2000] as const) {
      const specs = fc.sample(baseArbitrary(), { seed: 24301, numRuns });
      expect(digest(specs), `${numRuns} cases`).toBe(BEFORE[numRuns]);
      expect(specs.every((s) => s.predicates === undefined)).toBe(true);
    }
  });

  it("draws the same with fc.check, as the fuzz test runs it", () => {
    const seen: FuzzSpec[] = [];
    fc.check(
      fc.property(baseArbitrary(), (s) => {
        seen.push(s);
      }),
      { seed: 24301, numRuns: 205 },
    );
    expect(digest(seen)).toBe(BEFORE[205]);
  });

  it("puts data forms in every data-form case, each at L11, over the same base case", () => {
    const forms = fc.sample(dataFormArbitrary(), { seed: 24301, numRuns: 300 });
    const base = fc.sample(baseArbitrary(), { seed: 24301, numRuns: 300 });
    for (const [i, s] of forms.entries()) {
      expect(s.predicates, `case ${i}`).toBeDefined();
      expect(specLayer(s), `case ${i}`).toBe("L11");
      expect(withoutPredicates(s), `case ${i}`).toEqual(base[i]);
    }
  });
});
