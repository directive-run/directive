/**
 * The fuzz generator's ceiling does what the fuzzer relies on (diff/fuzz/
 * fuzz.test.ts): with a ceiling at `current`, every case is one v2 runs, a
 * failing case still shrinks to one, and with nothing above the ceiling the
 * generator is the one with no ceiling at all.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { engines } from "../engines.js";
import {
  FEATURE_LAYERS,
  type FuzzEffect,
  type FuzzModule,
  type FuzzSpec,
  specArbitrary,
  specLayer,
  toScenario,
} from "../fuzz/model.js";
import type { TraceEntry } from "../record.js";
import { currentLayer, runScenario, v2Runs } from "../scenario.js";

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
      lifecycle: steps("stop", "start", "destroy"),
      effectCleanups: specs.some((s) =>
        s.modules.some((m) => m.effects.some((e) => e.cleanup)),
      ),
      effectDeps: specs.some((s) =>
        s.modules.some((m) => m.effects.some((e) => e.explicitDeps)),
      ),
      sources: specs.some((s) => s.modules.some((m) => m.source !== null)),
      snapshots: steps("snapshot", "restore"),
      twin: steps("twin"),
      history: specs.some((s) => s.history) && steps("back", "forward"),
      trace: specs.some((s) => s.trace),
    };

    expect(Object.keys(used).sort()).toEqual(
      Object.keys(FEATURE_LAYERS).sort(),
    );
    expect(Object.entries(used).filter(([, seen]) => !seen)).toEqual([]);
  });

  it("keeps the L0 effect cleanups in play at the lowest ceiling", () => {
    // Basic effects (run, cleanup, auto-tracking) are L0 in layers.rules.json;
    // only explicit deps are L4. Cleanups once sat with the deps, so a ceiling
    // below L4 never generated one and v2 never saw a cleanup.
    const effects = sample("L0").flatMap((s) =>
      s.modules.flatMap((m) => m.effects),
    );

    expect(effects.some((e) => e.cleanup)).toBe(true);
    expect(effects.some((e) => e.explicitDeps)).toBe(false);
  });

  it("places a case by what its steps and effects call", () => {
    const base: FuzzSpec = {
      modules: [
        {
          facts: 1,
          date: false,
          derivations: [],
          events: [{ target: 0, add: true }],
          constraints: [],
          effects: [],
          source: null,
        },
      ],
      boundary: null,
      history: false,
      trace: false,
      steps: [{ op: "settle" }],
    };
    const withEffect = (effect: Partial<FuzzEffect>): FuzzSpec => ({
      ...base,
      modules: [
        {
          ...(base.modules[0] as FuzzModule),
          effects: [
            {
              reads: [0],
              explicitDeps: false,
              cleanup: false,
              throwsAt: null,
              ...effect,
            },
          ],
        },
      ],
    });

    expect(specLayer(base)).toBe("L0");
    expect(specLayer(withEffect({ cleanup: true }))).toBe("L0");
    expect(specLayer(withEffect({ explicitDeps: true }))).toBe("L4");
    // The twin step reads a second system's getSnapshot, which lib/layers.ts
    // places at L6 (MEMBER_LAYERS), above the lifecycle steps it also uses.
    expect(specLayer({ ...base, steps: [{ op: "twin" }] })).toBe("L6");
    expect(specLayer({ ...base, steps: [{ op: "snapshot" }] })).toBe("L6");
    expect(specLayer({ ...base, steps: [{ op: "stop" }] })).toBe("L3");
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

describe("fuzz model abort records", () => {
  // One resolver that takes 5 ms under a 3 ms timeout: its attempt times out.
  const timedOut: FuzzSpec = {
    modules: [
      {
        facts: 1,
        date: false,
        derivations: [],
        events: [{ target: 0, add: false }],
        constraints: [
          {
            fact: 0,
            atLeast: 0,
            crossAtLeast: null,
            priority: 0,
            writes: 0,
            value: 1,
            delay: 5,
            fails: 0,
            retry: 0,
            timeout: 3,
          },
        ],
        effects: [],
        source: null,
      },
    ],
    boundary: "skip",
    history: false,
    trace: false,
    steps: [{ op: "settle" }],
  };
  const records = (trace: TraceEntry[], tag: string) =>
    trace.flatMap((e) =>
      e.k === "external" && Array.isArray(e.data) && e.data[0] === tag
        ? [e.data]
        : [],
    );

  it("records an abort whose reason is the timeout error as a timeout, on the engine that aborts on one", async () => {
    for (const engine of engines().slice(1)) {
      const result = await runScenario(toScenario(timedOut), {
        candidates: [engine],
      });
      // 1.35 (the reference, and the workspace engine) never aborts on a
      // timeout: no record of either kind.
      expect(records(result.traces.reference, "timeout")).toEqual([]);
      expect(records(result.traces.reference, "aborted")).toEqual([]);
      const own = result.traces.candidate;
      if (engine.name === "v2") {
        // Row n: 2.0 aborts the timed-out attempt with the timeout error.
        expect(records(own, "timeout")).toEqual([["timeout", "a.r0", 1]]);
        expect(records(own, "aborted")).toEqual([]);
      } else {
        expect(records(own, "timeout")).toEqual([]);
      }
    }
  });
});
