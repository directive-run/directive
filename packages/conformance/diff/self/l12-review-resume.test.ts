// The L12 principal review's history hole (2026-11-27): with "resume() does
// not clear a navigation-restored pause" planted in 2.0, the engine took 1
// snapshot where 1.35 took 4 and the case still showed 0 unexplained. Row
// (ay) keeps a pause through a navigation "until resume()", but its entries
// read the trigger `navigatedPaused`, which is true of the whole case, and
// its `ends` stop dropped every record after it. The harness now reads the
// row's entries by step (`pauseKept`): they excuse nothing from the
// `resume` step on, the history-record rule counts only snapshots of
// kept-pause steps, and a row (ay) stop still compares a snapshot only 1.35
// takes after a later resume (`resumedAfterStop`). No entry changed.
import { describe, expect, it } from "vitest";
import { type Difference, compareContract } from "../compare.js";
import type { Json } from "../normalize.js";
import type { TraceEntry } from "../record.js";
import {
  FUZZ_SCENARIO,
  PAUSE_KEPT_TRIGGER,
  covers,
  explain,
  pauseKept,
  readDivergences,
  resumedAfterStop,
  stepOps,
} from "../scenario.js";

const ALL = readDivergences();
const ON = ["navigatedPaused"];
const PAUSED = "l8-fuzz-ay-external-history-changed-paused";
const STOP = "l8-fuzz-ay-hook-onSnapshot-missing";
const UNANNOUNCED = "l8-fuzz-ay-hook-onSnapshot-missing-unannounced";
const FOLLOWS = "l12-fuzz-ay-external-history-changed-snapshots";

/** A fuzz step as the model records it: a history step is a labelled run. */
const opStep = (
  i: number,
  op: string,
  records: TraceEntry[] = [],
  after: TraceEntry[] = [],
) =>
  [
    {
      k: "step",
      i,
      step: ["pause", "resume", "goTo", "back"].includes(op)
        ? { op: "run", label: JSON.stringify({ op }) }
        : { op },
    },
    ...records,
    { k: "async", i },
    ...after,
  ] as TraceEntry[];
const history = (h: Record<string, Json>) =>
  ({
    k: "external",
    data: [
      "history",
      {
        changes: 1,
        ids: [1],
        index: 0,
        length: 1,
        ordered: true,
        paused: true,
        ...h,
      },
    ],
  }) as TraceEntry;
const snapshot = (id: number) =>
  ({
    k: "hook",
    hook: "onSnapshot",
    args: [
      {
        facts: { "a::f0": 3, "a::f1": 0 },
        id,
        trigger: "facts-changed:a::f0",
        ordered: true,
      },
    ],
  }) as TraceEntry;
const brief = (d: Difference) =>
  `${d.op} ${d.stream} ${d.kind} ${d.step}${d.path ? ` ${d.path}` : ""}`;
const judge = (v1: TraceEntry[], v2: TraceEntry[], triggers = ON) => {
  const r = explain(
    FUZZ_SCENARIO,
    compareContract(v1, v2, "v2"),
    ALL,
    triggers,
    stepOps(v1),
  );

  return {
    left: r.unexplained.map(brief).sort(),
    used: [...r.used].sort(),
    ended: r.ended.map((e) => `${e.id} ${e.at.step}`),
  };
};
const ONE = { ids: [1], index: 0, length: 1 };
const TWO = { ids: [1, 2], index: 1, length: 2 };
const THREE = { ids: [1, 2, 3], index: 2, length: 3 };

describe("row (ay) excuses nothing after an explicit resume (the L12 principal review)", () => {
  it("the planted shape: 2.0 still paused after resume, its record and missing snapshot both fail", () => {
    // pause, goTo, resume, then a write: 1.35 snapshots it; a 2.0 whose
    // resume() does not clear the pause the goTo put back does not.
    const v1 = [
      ...opStep(1, "pause", [history({})]),
      ...opStep(2, "goTo", [history({ paused: false })]),
      ...opStep(3, "resume", [history({ paused: false })]),
      ...opStep(4, "set", [], [snapshot(2)]),
      ...opStep(5, "pause", [history(TWO)]),
    ];
    const v2 = [
      ...opStep(1, "pause", [history({})]),
      ...opStep(2, "goTo", [history({})]),
      ...opStep(3, "resume", [history({})]),
      ...opStep(4, "set"),
      ...opStep(5, "pause", [history(ONE)]),
    ];
    const r = judge(v1, v2);
    expect(r.left).toEqual([
      "changed external history 3 data[1].paused",
      "changed external history 5 data[1].ids[1]",
      "changed external history 5 data[1].index",
      "changed external history 5 data[1].length",
      "missing hook onSnapshot 4",
    ]);
    // The row's own difference, the record after the goTo, is still excused.
    expect(r.used).toEqual([PAUSED]);
    expect(r.ended).toEqual([]);
  });

  it("control: the same case on a correct 2.0 is explained (only the goTo's record differs)", () => {
    const steps = (paused: boolean) => [
      ...opStep(1, "pause", [history({})]),
      ...opStep(2, "goTo", [history({ paused })]),
      ...opStep(3, "resume", [history({ paused: false })]),
      ...opStep(4, "set", [], [snapshot(2)]),
      ...opStep(5, "pause", [history(TWO)]),
    ];
    expect(judge(steps(false), steps(true))).toEqual({
      left: [],
      used: [PAUSED],
      ended: [],
    });
  });

  /** A write under the kept pause (row (ay)'s stop), a resume, then a write. */
  const stopped = (
    v2After: "snapshots" | "none",
    between: TraceEntry[] = [],
    announced = true,
  ) => ({
    v1: [
      ...opStep(1, "pause", [history({})]),
      ...opStep(2, "goTo", announced ? [history({ paused: false })] : []),
      ...opStep(3, "set", [], [snapshot(2)]),
      ...opStep(
        4,
        "resume",
        announced ? [history({ ...TWO, paused: false })] : [],
      ),
      ...between,
      ...opStep(6, "set", [], [snapshot(3)]),
      ...opStep(7, "pause", [history(THREE)]),
    ],
    v2: [
      ...opStep(1, "pause", [history({})]),
      ...opStep(2, "goTo", announced ? [history({})] : []),
      ...opStep(3, "set"),
      ...opStep(4, "resume", announced ? [history({ paused: false })] : []),
      ...between,
      ...opStep(6, "set", [], v2After === "snapshots" ? [snapshot(2)] : []),
      ...opStep(7, "pause", [history(v2After === "snapshots" ? TWO : ONE)]),
    ],
  });

  it("after a row (ay) stop, a snapshot only 1.35 takes after the resume still fails", () => {
    const { v1, v2 } = stopped("none");
    const r = judge(v1, v2);
    expect(r.ended).toEqual([`${STOP} 3`]);
    expect(r.left).toEqual(["missing hook onSnapshot 6"]);
  });

  it("control: after the stop, a 2.0 that snapshots again is explained", () => {
    const { v1, v2 } = stopped("snapshots");
    const r = judge(v1, v2);
    expect(r.ended).toEqual([`${STOP} 3`]);
    expect(r.left).toEqual([]);
  });

  it("the stop drops as before once a navigation follows it: the engines may stand on different snapshots", () => {
    const { v1, v2 } = stopped("none", opStep(5, "back"));
    const r = judge(v1, v2);
    expect(r.ended).toEqual([`${STOP} 3`]);
    expect(r.left).toEqual([]);
  });

  it("with no stop (no record between the goTo and the write), the later snapshot and the record still fail", () => {
    const { v1, v2 } = stopped("none", [], false);
    const r = judge(v1, v2);
    expect(r.ended).toEqual([]);
    expect(r.used).toEqual([UNANNOUNCED]);
    expect(r.left).toEqual([
      "changed external history 7 data[1].ids[1]",
      "changed external history 7 data[1].ids[2]",
      "changed external history 7 data[1].index",
      "changed external history 7 data[1].length",
      "missing hook onSnapshot 6",
    ]);
    expect(r.used).not.toContain(FOLLOWS);
  });

  it("pauseKept: from a navigation under a pause, up to the resume step", () => {
    const steps = (ops: string[]) => new Map(ops.map((op, i) => [i + 1, op]));
    const OPS = [
      "pause",
      "set",
      "goTo",
      "set",
      "resume",
      "set",
      "pause",
      "set",
    ];
    expect(
      [1, 2, 3, 4, 5, 6, 7, 8].map((i) => pauseKept(steps(OPS), i)),
    ).toEqual([false, false, true, true, false, false, false, false]);
    for (const nav of ["back", "forward", "goTo", "replay", "roundtrip"]) {
      expect(pauseKept(steps(["pause", nav, "set"]), 3)).toBe(true);
      expect(pauseKept(steps(["resume", nav, "set"]), 3)).toBe(false);
      expect(pauseKept(steps(["pause", "resume", nav, "set"]), 4)).toBe(false);
    }
    // A second kept pause after the resume.
    expect(
      pauseKept(steps(["pause", "goTo", "resume", "pause", "back", "set"]), 6),
    ).toBe(true);
    expect(pauseKept(undefined, 3)).toBe(false);
  });

  it("resumedAfterStop: a resume after the stop, and no navigation, destroy, twin or restore since the stop", () => {
    const steps = (ops: string[]) => new Map(ops.map((op, i) => [i + 1, op]));
    const OPS = ["pause", "goTo", "set", "set", "resume", "set"];
    expect(resumedAfterStop(steps(OPS), 3, 6)).toBe(true);
    expect(resumedAfterStop(steps(OPS), 3, 5)).toBe(true);
    expect(resumedAfterStop(steps(OPS), 3, 4)).toBe(false);
    expect(resumedAfterStop(steps(OPS), 5, 6)).toBe(false);
    for (const op of [
      "back",
      "forward",
      "goTo",
      "replay",
      "roundtrip",
      "destroy",
      "twin",
      "restore",
    ]) {
      expect(
        resumedAfterStop(
          steps(["pause", "goTo", "set", "resume", op, "set"]),
          3,
          6,
        ),
      ).toBe(false);
      expect(
        resumedAfterStop(
          steps(["pause", "goTo", "set", op, "resume", "set"]),
          3,
          6,
        ),
      ).toBe(false);
    }
    expect(resumedAfterStop(undefined, 3, 6)).toBe(false);
  });

  it("every navigatedPaused entry is read by step: none covers a difference of a step after the resume", () => {
    expect(PAUSE_KEPT_TRIGGER).toBe("navigatedPaused");
    const ids = ALL.filter((x) => x.when?.includes(PAUSE_KEPT_TRIGGER)).map(
      (x) => x.id,
    );
    expect(ids.sort()).toEqual(
      [
        PAUSED,
        STOP,
        UNANNOUNCED,
        "l10-fuzz-ay-hook-onSnapshot-missing",
        "l10-fuzz-ay-hook-onSnapshot-missing-unannounced",
        FOLLOWS,
      ].sort(),
    );
    const steps = new Map([
      [1, "pause"],
      [2, "goTo"],
      [3, "set"],
      [4, "resume"],
      [5, "set"],
    ]);
    const missing = (step: number) =>
      ({
        engine: "v2",
        stream: "hook",
        kind: "onSnapshot",
        step,
        phase: "async",
        op: "missing",
        reference: snapshot(2) as unknown as Json,
        at: { reference: 20 },
        where: {},
      }) as unknown as Difference;
    const entry = ALL.find((x) => x.id === UNANNOUNCED);
    if (entry === undefined) {
      throw new Error(`no entry ${UNANNOUNCED}`);
    }
    expect(covers(entry, FUZZ_SCENARIO, missing(3), ON, steps)).toBe(true);
    expect(covers(entry, FUZZ_SCENARIO, missing(5), ON, steps)).toBe(false);
    expect(covers(entry, FUZZ_SCENARIO, missing(3), ON, undefined)).toBe(false);
  });
});
