/**
 * The fuzz generator's ceiling does what the fuzzer relies on (diff/fuzz/
 * fuzz.test.ts): with a ceiling at `current`, every case is one v2 runs, a
 * failing case still shrinks to one, and with nothing above the ceiling the
 * generator is the one with no ceiling at all.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  FEATURE_LAYERS,
  type FuzzSpec,
  specArbitrary,
  specLayer,
  toScenario,
} from "../fuzz/model.js";
import { currentLayer, v2Runs } from "../scenario.js";

const sample = (ceiling?: string, numRuns = 400): FuzzSpec[] =>
  fc.sample(specArbitrary(ceiling === undefined ? {} : { ceiling }), {
    seed: 4242,
    numRuns,
  });

const layer = (spec: FuzzSpec) => Number(specLayer(spec).slice(1));

describe("fuzz generator ceiling", () => {
  it("uses nothing built above the ceiling", () => {
    for (let n = 0; n <= 13; n++) {
      for (const spec of sample(`L${n}`)) {
        expect(layer(spec), `ceiling L${n}`).toBeLessThanOrEqual(n);
      }
    }
  });

  it("still uses nothing above the ceiling once a failing case shrinks", () => {
    // fast-check shrinks a failure through the same arbitrary; a minimal case
    // that sat above the ceiling would not run on v2 either.
    const shrunk = (fails: (spec: FuzzSpec) => boolean) => {
      const result = fc.check(
        fc.property(specArbitrary({ ceiling: "L1" }), (spec) => !fails(spec)),
        { seed: 7, numRuns: 100 },
      );
      expect(result.failed).toBe(true);

      return (result as { counterexample: [FuzzSpec] }).counterexample[0];
    };

    for (const spec of [
      shrunk((s) => s.modules.length > 1),
      shrunk((s) => s.modules.some((m) => m.effects.length > 0)),
      shrunk((s) => s.steps.length > 3),
    ]) {
      expect(layer(spec)).toBeLessThanOrEqual(1);
    }
  });

  it("is the generator with no ceiling when nothing is above it", () => {
    // A ceiling only takes features out: draw for draw, the same cases.
    expect(sample("L13")).toEqual(sample());
  });

  it("uses every feature when there is no ceiling", () => {
    const specs = sample(undefined, 1500);
    const steps = (...ops: string[]) =>
      specs.some((s) => s.steps.some((x) => ops.includes(x.op)));
    const used: Record<keyof typeof FEATURE_LAYERS, boolean> = {
      modules: specs.some((s) => s.modules.length > 1),
      constraints: specs.some((s) =>
        s.modules.some((m) => m.constraints.length > 0),
      ),
      boundary: specs.some((s) => s.boundary !== null),
      lifecycle: steps("stop", "start", "destroy", "twin"),
      effectControls: specs.some((s) =>
        s.modules.some((m) =>
          m.effects.some((e) => e.cleanup || e.explicitDeps),
        ),
      ),
      sources: specs.some((s) => s.modules.some((m) => m.source !== null)),
      snapshots: steps("snapshot", "restore"),
      history: specs.some((s) => s.history) && steps("back", "forward"),
      trace: specs.some((s) => s.trace),
    };

    expect(Object.keys(used).sort()).toEqual(
      Object.keys(FEATURE_LAYERS).sort(),
    );
    expect(Object.entries(used).filter(([, seen]) => !seen)).toEqual([]);
  });

  it("yields only cases v2 runs at the current layer", () => {
    const current = currentLayer();
    if (current === null) {
      return;
    }
    for (const spec of sample(current)) {
      expect(v2Runs(toScenario(spec).layer)).toBe(true);
    }
  });

  it("refuses a ceiling that is not a layer", () => {
    expect(() => specArbitrary({ ceiling: "1" })).toThrow(/not a layer/);
    expect(() => specArbitrary({ ceiling: "L" })).toThrow(/not a layer/);
  });
});
