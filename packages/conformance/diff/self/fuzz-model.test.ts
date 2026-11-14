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
  type FuzzBatch,
  type FuzzEffect,
  type FuzzModule,
  type FuzzSpec,
  HISTORY_OPS,
  abortsAgree,
  specArbitrary,
  specLayer,
  specTriggers,
  toScenario,
  withoutHistory,
} from "../fuzz/model.js";
import type { TraceEntry } from "../record.js";
import { currentLayer, runScenario, v2Runs } from "../scenario.js";

const sample = (ceiling?: string, numRuns = 400): FuzzSpec[] =>
  fc.sample(specArbitrary(ceiling === undefined ? {} : { ceiling }), {
    seed: 4242,
    numRuns,
  });

const layer = (spec: FuzzSpec) => Number(specLayer(spec).slice(1));

const batchOf = (over: Partial<FuzzBatch>): FuzzBatch => ({
  sources: [{ fact: 0, atLeast: 1, items: 1, abortOn: false }],
  handler: "batch",
  failing: "all",
  windowMs: 1,
  maxSize: null,
  delay: 0,
  fails: 0,
  retry: 0,
  timeout: null,
  writes: 0,
  value: 0,
  ...over,
});

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
      batch: specs.some((s) => s.batch != null),
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
    // A batched resolver is L7 (lib/layers.ts: `resolvers.<id>.batch`).
    expect(specLayer({ ...base, batch: batchOf({}) })).toBe("L7");
    expect(specLayer({ ...base, batch: null })).toBe("L0");
  });

  it("generates batches that can show quirks g, h, i and k, not only the happy path", () => {
    const batches = sample(undefined, 1500).flatMap((s) =>
      s.batch ? [{ batch: s.batch, steps: s.steps }] : [],
    );
    const reach = {
      // g: a write can retract one requirement of a running batch and keep
      // a sibling: a source with three items (the third needs one more than
      // the first two), a wait, and a later set.
      g: batches.some(
        ({ batch, steps }) =>
          batch.delay > 0 &&
          batch.sources.some((src) => src.items > 2) &&
          steps.some((x) => x.op === "set"),
      ),
      // h: a with-results call fails every item.
      h: batches.some(
        ({ batch }) =>
          batch.handler === "results" &&
          batch.failing === "all" &&
          batch.fails > 0,
      ),
      // i: a with-results call fails some items: every second one, so it
      // needs a call of two or more.
      i: batches.some(
        ({ batch }) =>
          batch.handler === "results" &&
          batch.failing === "some" &&
          batch.fails > 0 &&
          batch.sources.reduce((n, src) => n + src.items, 0) > 1,
      ),
      // k: a batch can mix two constraints that bind to the written fact.
      k: batches.some(
        ({ batch }) =>
          batch.handler !== "fallback" &&
          batch.sources.length === 2 &&
          batch.sources.some((src) => src.abortOn),
      ),
    };

    expect(reach).toEqual({ g: true, h: true, i: true, k: true });
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

describe("fuzz history reach (L8-pre; the L8 RFC's reach table)", () => {
  const histories = () =>
    sample("L8", 1500).filter((s) => s.history) as FuzzSpec[];

  it("draws every history step and option at L8, with steps from 1 to 3", () => {
    const specs = histories();
    const ops = new Set(specs.flatMap((s) => s.steps.map((x) => x.op)));
    const navSteps = new Set(
      specs.flatMap((s) =>
        s.steps.flatMap((x) =>
          (x.op === "back" || x.op === "forward") && x.steps !== undefined
            ? [x.steps]
            : [],
        ),
      ),
    );
    const triggers = new Set(specs.flatMap((s) => specTriggers(s)));

    expect(HISTORY_OPS.filter((op) => !ops.has(op))).toEqual([]);
    expect([...navSteps].sort()).toEqual([1, 2, 3]);
    expect(new Set(specs.map((s) => s.maxSnapshots))).toEqual(
      new Set([3, 5, 20]),
    );
    expect(specs.some((s) => s.modules.some((m) => m.snapshotEvents))).toBe(
      true,
    );
    expect(
      specs.some((s) =>
        s.modules.some((m) => m.effects.some((e) => e.onNavigate === "skip")),
      ),
    ).toBe(true);
    // Rule 9: respecting by default where the engines' aborts agree (no
    // timeout, no batch; diff/self/abort-draw.test.ts), the ignoring handler
    // a minority there, and the only one in a case with either.
    const agreeing = specs.filter((s) => abortsAgree(s));
    const respecting = agreeing.filter((s) => s.respectsAbort === true).length;
    const ignoring = agreeing.filter((s) => s.respectsAbort === false).length;
    expect(
      specs.filter((s) => s.respectsAbort === true).length +
        specs.filter((s) => s.respectsAbort === false).length,
    ).toBe(specs.length);
    expect(ignoring).toBeGreaterThan(0);
    expect(ignoring).toBeLessThan(respecting);
    expect(triggers.has("navigated")).toBe(true);
    expect(triggers.has("navigatedBusy")).toBe(true);
    // Every one of them places the case at L8.
    expect(specs.every((s) => specLayer(s) === "L8" || layer(s) > 8)).toBe(
      true,
    );
  });

  it("draws none of it without history, nor below L8", () => {
    const added = (s: FuzzSpec) =>
      s.maxSnapshots !== undefined ||
      s.respectsAbort !== undefined ||
      s.modules.some(
        (m) =>
          m.snapshotEvents !== undefined ||
          m.effects.some((e) => e.onNavigate !== undefined),
      ) ||
      s.steps.some(
        (x) =>
          ((x.op === "back" || x.op === "forward") && x.steps !== undefined) ||
          (HISTORY_OPS.slice(2) as readonly string[]).includes(x.op),
      );

    expect(sample("L8", 600).filter((s) => !s.history && added(s))).toEqual([]);
    expect(sample("L7", 600).filter(added)).toEqual([]);
    // Taking the additions out gives back a case without history.
    for (const s of histories().slice(0, 50)) {
      const plain = withoutHistory(s);
      expect(added(plain)).toBe(false);
      expect(specLayer(plain)).not.toBe("L8");
    }
  });

  it("places each addition at L8 on its own", () => {
    const base: FuzzSpec = {
      modules: [
        {
          facts: 1,
          date: false,
          derivations: [],
          events: [{ target: 0, add: true }],
          constraints: [],
          effects: [
            { reads: [0], explicitDeps: false, cleanup: false, throwsAt: null },
          ],
          source: null,
        },
      ],
      boundary: null,
      history: false,
      trace: false,
      steps: [{ op: "settle" }],
    };
    const m = base.modules[0] as FuzzModule;

    for (const op of HISTORY_OPS) {
      const step = (op === "goTo" ? { op, position: 0 } : { op }) as never;
      expect(specLayer({ ...base, steps: [step] })).toBe("L8");
    }
    expect(specLayer({ ...base, maxSnapshots: 3 })).toBe("L8");
    expect(specLayer({ ...base, respectsAbort: true })).toBe("L8");
    expect(
      specLayer({ ...base, modules: [{ ...m, snapshotEvents: [0] }] }),
    ).toBe("L8");
    expect(
      specLayer({
        ...base,
        modules: [
          {
            ...m,
            effects: [{ ...(m.effects[0] as FuzzEffect), onNavigate: "skip" }],
          },
        ],
      }),
    ).toBe("L8");
  });

  it("reads navigatedBusy as a navigation before a settle, in a case with a resolver", () => {
    const base = sample("L8", 400).find(
      (s) => s.history && s.modules[0]?.constraints.length,
    ) as FuzzSpec;
    const withSteps = (steps: FuzzSpec["steps"]): FuzzSpec => ({
      ...base,
      steps,
    });

    expect(specTriggers(withSteps([{ op: "back", steps: 1 }]))).toContain(
      "navigatedBusy",
    );
    expect(
      specTriggers(
        withSteps([{ op: "settle" }, { op: "pause" }, { op: "back" }]),
      ),
    ).not.toContain("navigatedBusy");
    expect(
      specTriggers(
        withSteps([{ op: "settle" }, { op: "pause" }, { op: "back" }]),
      ),
    ).toContain("navigated");
    expect(
      specTriggers(
        withSteps([
          { op: "settle" },
          { op: "tick" },
          { op: "goTo", position: 0 },
        ]),
      ),
    ).toContain("navigatedBusy");
    expect(specTriggers(withSteps([{ op: "pause" }]))).not.toContain(
      "navigated",
    );
    expect(
      specTriggers({ ...withSteps([{ op: "back" }]), history: false }),
    ).not.toContain("navigated");
  });

  /**
   * Rule 9's U14 note: an ignoring handler with history on. The resolver
   * starts at `f0 = 1` and waits 20 ms; `f0 = 0` retracts it and aborts its
   * signal; the ignoring handler writes `f1 = 5` late, and that write takes a
   * snapshot. A respecting handler writes nothing, and takes none.
   */
  const lateWriter = (respectsAbort: boolean): FuzzSpec => ({
    modules: [
      {
        facts: 2,
        date: false,
        derivations: [],
        events: [{ target: 0, add: false }],
        constraints: [
          {
            fact: 0,
            atLeast: 1,
            crossAtLeast: null,
            priority: 0,
            writes: 1,
            value: 5,
            delay: 20,
            fails: 0,
            retry: 0,
            timeout: null,
          },
        ],
        effects: [],
        source: null,
      },
    ],
    boundary: null,
    history: true,
    trace: false,
    steps: [
      { op: "settle" },
      { op: "set", module: 0, fact: 0, value: 1 },
      { op: "advance", ms: 1 },
      { op: "set", module: 0, fact: 0, value: 0 },
      { op: "advance", ms: 25 },
      { op: "settle" },
      { op: "pause" },
    ],
    maxSnapshots: 20,
    respectsAbort,
  });
  const historyAt = (trace: TraceEntry[]) =>
    records(trace, "history").map((r) => (r as unknown[])[1]);
  const records = (trace: TraceEntry[], tag: string) =>
    trace.flatMap((e) =>
      e.k === "external" && Array.isArray(e.data) && e.data[0] === tag
        ? [e.data]
        : [],
    );

  it("pins an ignoring handler with history on: its late write is a snapshot, on 1.35 and the workspace engine alike", async () => {
    const ignoring = await runScenario(toScenario(lateWriter(false)));
    const respecting = await runScenario(toScenario(lateWriter(true)));

    expect(ignoring.report).toBe("");
    expect(ignoring.ok).toBe(true);
    expect(respecting.ok).toBe(true);
    for (const result of [ignoring, respecting]) {
      expect(records(result.traces.reference, "aborted")).toEqual([
        ["aborted", "a.r0", 1],
      ]);
    }
    expect(records(ignoring.traces.reference, "wrote")).toEqual([
      ["wrote", "a.r0", 1],
    ]);
    expect(records(respecting.traces.reference, "wrote")).toEqual([]);
    const late = historyAt(ignoring.traces.reference)[0] as { length: number };
    const none = historyAt(respecting.traces.reference)[0] as {
      length: number;
    };
    expect(late.length).toBe(none.length + 1);
  });
});
