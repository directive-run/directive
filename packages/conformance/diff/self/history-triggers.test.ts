/**
 * L8-pre (the L8 RFC's "The fuzz, designed in up front", rules 1, 5 and 9):
 * the `when` triggers and hand-named `$like` classes for the approved
 * history rows (ay) to (be), the (as) `moved` twins for `onSnapshot`, and
 * the `ignoresAbort` gate on the late-write entries. Each trigger matches a
 * case of its row's shape and not a near miss; each class matches its
 * row's value and not a near miss, and `generalize` never picks it.
 */

import { describe, expect, it } from "vitest";
import { FUZZ_TRIGGERS } from "../../lib/fuzz.js";
import { type Difference, type Position, compareContract } from "../compare.js";
import { LIKE, TEXT, generalizeValue } from "../fingerprint.js";
import { type FuzzSpec, specTriggers } from "../fuzz/model.js";
import type { Json } from "../normalize.js";
import { type TraceEntry, createRecorder } from "../record.js";
import {
  type Divergence,
  covers,
  fileMoves,
  readDivergences,
  stepOps,
} from "../scenario.js";

/** One module with one fact and one event, history on, no steps. */
const BASE: FuzzSpec = {
  modules: [
    {
      facts: 1,
      date: false,
      derivations: [],
      events: [{ target: 0, add: false }],
      constraints: [],
      effects: [],
      source: null,
    },
  ],
  boundary: null,
  history: true,
  trace: false,
  steps: [],
  batch: null,
} as unknown as FuzzSpec;

const has = (
  name: string,
  steps: FuzzSpec["steps"],
  more: Partial<FuzzSpec> = {},
) => specTriggers({ ...BASE, steps, ...more }).includes(name as never);

const set = { op: "set", module: 0, fact: 0, value: 1 } as const;

describe("the history rows' triggers", () => {
  it("are all known trigger names", () => {
    for (const name of [
      "ignoresAbort",
      "navigatedPaused",
      "replayedOrImported",
      "imported",
      "changesetMoved",
      "importedEmpty",
      "restoredTwice",
      "changesetSteps",
    ]) {
      expect(FUZZ_TRIGGERS).toContain(name);
    }
  });

  it("ignoresAbort: every case but one that drew respectsAbort", () => {
    expect(has("ignoresAbort", [])).toBe(true);
    expect(has("ignoresAbort", [], { respectsAbort: false })).toBe(true);
    expect(has("ignoresAbort", [], { history: false })).toBe(true);
    expect(has("ignoresAbort", [], { respectsAbort: true })).toBe(false);
  });

  it("(ay) navigatedPaused: a navigation while a pause is set", () => {
    expect(has("navigatedPaused", [{ op: "pause" }, set, { op: "back" }])).toBe(
      true,
    );
    expect(
      has("navigatedPaused", [{ op: "pause" }, { op: "goTo", position: 0 }]),
    ).toBe(true);
    // Near misses: resumed first, paused after, no history.
    expect(
      has("navigatedPaused", [
        { op: "pause" },
        { op: "resume" },
        { op: "back" },
      ]),
    ).toBe(false);
    expect(has("navigatedPaused", [{ op: "back" }, { op: "pause" }])).toBe(
      false,
    );
    expect(
      has("navigatedPaused", [{ op: "pause" }, { op: "back" }], {
        history: false,
      }),
    ).toBe(false);
  });

  it("(az) replayedOrImported: a replay or an import", () => {
    expect(has("replayedOrImported", [{ op: "replay" }])).toBe(true);
    expect(has("replayedOrImported", [{ op: "roundtrip" }])).toBe(true);
    expect(has("replayedOrImported", [{ op: "goTo", position: 1 }])).toBe(
      false,
    );
    expect(
      has("replayedOrImported", [{ op: "replay" }], { history: false }),
    ).toBe(false);
  });

  it("(ba) imported: an import", () => {
    expect(has("imported", [set, { op: "roundtrip" }])).toBe(true);
    expect(has("imported", [set, { op: "replay" }])).toBe(false);
  });

  it("(bb) changesetMoved: a closed changeset, a step that can move snapshots, then a back or forward", () => {
    const closed = [{ op: "begin" }, set, { op: "end" }] as FuzzSpec["steps"];
    expect(has("changesetMoved", [...closed, set, { op: "back" }])).toBe(true);
    expect(
      has("changesetMoved", [
        ...closed,
        { op: "roundtrip" },
        { op: "forward" },
      ]),
    ).toBe(true);
    // Near misses: nothing moves the range before the navigation; the
    // changeset is never closed; the navigation comes first.
    expect(
      has("changesetMoved", [...closed, { op: "pause" }, { op: "back" }]),
    ).toBe(false);
    expect(
      has("changesetMoved", [{ op: "begin" }, set, set, { op: "back" }]),
    ).toBe(false);
    expect(has("changesetMoved", [...closed, { op: "back" }, set])).toBe(false);
    // A changeset that records no range (1.35's endChangeset needs the index
    // to rise): empty, paused throughout, or begun again with nothing after.
    const moveBack = [set, { op: "back" }] as FuzzSpec["steps"];
    expect(
      has("changesetMoved", [{ op: "begin" }, { op: "end" }, ...moveBack]),
    ).toBe(false);
    expect(
      has("changesetMoved", [
        { op: "pause" },
        { op: "begin" },
        set,
        { op: "end" },
        ...moveBack,
      ]),
    ).toBe(false);
    expect(
      has("changesetMoved", [
        { op: "begin" },
        set,
        { op: "begin" },
        { op: "end" },
        ...moveBack,
      ]),
    ).toBe(false);
    // A navigation clears the pause on 1.35, and a forward can raise the
    // index with no write: both can still record a range.
    expect(
      has("changesetMoved", [
        { op: "pause" },
        { op: "begin" },
        { op: "back" },
        set,
        { op: "end" },
        ...moveBack,
      ]),
    ).toBe(true);
    expect(
      has("changesetMoved", [
        { op: "begin" },
        { op: "forward" },
        { op: "end" },
        ...moveBack,
      ]),
    ).toBe(true);
    // An empty first changeset, then a recorded one: the write inside the
    // second is part of its range, not a move of it.
    expect(
      has("changesetMoved", [
        { op: "begin" },
        { op: "end" },
        { op: "begin" },
        set,
        { op: "end" },
        { op: "back" },
      ]),
    ).toBe(false);
  });

  it("(bc) importedEmpty: an import where the history can be empty", () => {
    const listed = {
      modules: [{ ...BASE.modules[0], snapshotEvents: [0] }],
    } as Partial<FuzzSpec>;
    expect(has("importedEmpty", [{ op: "roundtrip" }], listed)).toBe(true);
    expect(has("importedEmpty", [{ op: "roundtrip" }])).toBe(false);
    expect(has("importedEmpty", [{ op: "replay" }], listed)).toBe(false);
  });

  it("(bd) restoredTwice: two navigations in a case with a Date fact", () => {
    const dated = {
      modules: [{ ...BASE.modules[0], date: true }],
    } as Partial<FuzzSpec>;
    expect(
      has("restoredTwice", [{ op: "back" }, { op: "forward" }], dated),
    ).toBe(true);
    expect(has("restoredTwice", [{ op: "back" }], dated)).toBe(false);
    expect(has("restoredTwice", [{ op: "back" }, { op: "forward" }])).toBe(
      false,
    );
  });

  it("(be) changesetSteps: a multi-step back or forward after a closed changeset", () => {
    const closed = [{ op: "begin" }, set, { op: "end" }] as FuzzSpec["steps"];
    expect(has("changesetSteps", [...closed, { op: "back", steps: 2 }])).toBe(
      true,
    );
    expect(
      has("changesetSteps", [...closed, { op: "forward", steps: 3 }]),
    ).toBe(true);
    expect(has("changesetSteps", [...closed, { op: "back", steps: 1 }])).toBe(
      false,
    );
    expect(has("changesetSteps", [...closed, { op: "back" }])).toBe(false);
    expect(has("changesetSteps", [{ op: "back", steps: 2 }, ...closed])).toBe(
      false,
    );
    // A changeset that records no range: empty, or paused throughout.
    expect(
      has("changesetSteps", [
        { op: "begin" },
        { op: "end" },
        { op: "back", steps: 2 },
      ]),
    ).toBe(false);
    expect(
      has("changesetSteps", [
        { op: "pause" },
        { op: "begin" },
        set,
        { op: "end" },
        { op: "resume" },
        { op: "back", steps: 2 },
      ]),
    ).toBe(false);
  });
});

const SNAPSHOT: Json = {
  facts: { "a::f0": 1, "b::when": { $date: "1970-01-01T00:00:00.000Z" } },
  id: 3,
  ordered: true,
  trigger: "facts-changed:a::f0",
};

describe("the history rows' classes", () => {
  it("snapshot: one onSnapshot argument of fuzz facts with 1.35's label", () => {
    expect(LIKE.snapshot?.(SNAPSHOT)).toBe(true);
    expect(
      LIKE.snapshot?.({
        ...(SNAPSHOT as object),
        trigger: "facts-changed:f0,f1,f2,f3,f4+2more",
      }),
    ).toBe(true);
    // Near misses: an extra key, a raw timestamp, a snapshot out of order,
    // a fact outside the model's names, id 0, a label of another shape.
    expect(LIKE.snapshot?.({ ...(SNAPSHOT as object), extra: 1 })).toBe(false);
    expect(
      LIKE.snapshot?.({
        facts: {},
        id: 3,
        timestamp: 40,
        trigger: "facts-changed:a::f0",
      }),
    ).toBe(false);
    expect(LIKE.snapshot?.({ ...(SNAPSHOT as object), ordered: false })).toBe(
      false,
    );
    expect(
      LIKE.snapshot?.({ ...(SNAPSHOT as object), facts: { secret: 1 } }),
    ).toBe(false);
    expect(LIKE.snapshot?.({ ...(SNAPSHOT as object), id: 0 })).toBe(false);
    expect(
      LIKE.snapshot?.({ ...(SNAPSHOT as object), trigger: "manual" }),
    ).toBe(false);
  });

  it("snapshotIdsRepeated: (ba)'s repeated id on 1.35", () => {
    expect(LIKE.snapshotIdsRepeated?.([1, 2, 3, 4, 2])).toBe(true);
    expect(LIKE.snapshotIdsRepeated?.([1, 4])).toBe(false);
  });

  it("historyIndexOutside: (bc)'s index outside the list on 1.35", () => {
    const record = { index: -1, length: 0, ids: [], paused: false };
    expect(LIKE.historyIndexOutside?.(record)).toBe(true);
    expect(
      LIKE.historyIndexOutside?.({ ...record, index: 99, length: 4 }),
    ).toBe(true);
    expect(LIKE.historyIndexOutside?.({ ...record, index: 3, length: 4 })).toBe(
      false,
    );
  });

  it("historyImportFailed: 1.35's import error, word for word", () => {
    expect(
      TEXT.historyImportFailed?.("[Directive] Failed to import history data:"),
    ).toBe(true);
    expect(
      TEXT.historyImportFailed?.("[Directive] Failed to import history data"),
    ).toBe(false);
  });

  it("generalize never picks a history class", () => {
    expect(generalizeValue([1, 1])).toEqual([
      { $like: "integer" },
      { $like: "integer" },
    ]);
    expect(JSON.stringify(generalizeValue(SNAPSHOT))).not.toMatch(
      /snapshot|historyIndexOutside/,
    );
  });
});

describe("the recorder keeps a snapshot's timestamp by order (rule 4)", () => {
  it("replaces it with whether it is at or after the engine's previous snapshot", () => {
    const recorder = createRecorder();
    const onSnapshot = recorder.plugin.onSnapshot as (s: unknown) => void;
    const take = (id: number, timestamp: number) =>
      onSnapshot({ id, timestamp, trigger: "manual", facts: {} });
    take(1, 40);
    take(2, 40);
    take(3, 50);
    take(4, 45);
    const args = recorder.trace.map((e) => (e as { args: Json[] }).args[0]);
    expect(args).toEqual([
      { id: 1, trigger: "manual", facts: {}, ordered: true },
      { id: 2, trigger: "manual", facts: {}, ordered: true },
      { id: 3, trigger: "manual", facts: {}, ordered: true },
      { id: 4, trigger: "manual", facts: {}, ordered: false },
    ]);
    // Another engine's recorder starts again: the clock of one is not the other's.
    const other = createRecorder();
    (other.plugin.onSnapshot as (s: unknown) => void)({
      id: 1,
      timestamp: 10,
      trigger: "manual",
      facts: {},
    });
    expect((other.trace[0] as { args: Json[] }).args[0]).toMatchObject({
      ordered: true,
    });
  });

  it("two engines whose clocks ended a wait at different times record the same", () => {
    const run = (stamps: number[]) => {
      const recorder = createRecorder();
      for (const [i, timestamp] of stamps.entries()) {
        (recorder.plugin.onSnapshot as (s: unknown) => void)({
          id: i + 1,
          timestamp,
          trigger: "manual",
          facts: {},
        });
      }

      return recorder.trace;
    };
    expect(compareContract(run([40, 50, 60]), run([7, 90, 91]), "v2")).toEqual(
      [],
    );
  });
});

describe("the (as) moved twin for onSnapshot (rule 5)", () => {
  const MOVED = "l8-fuzz-as-hook-onSnapshot-moved";
  const entries = readDivergences().filter((e) => e.id === MOVED);

  /** Steps 0 to 2 (ops given), with an onSnapshot call in the step given. */
  function trace(
    at: number,
    ops = ["tick", "settle", "tick"],
    snapshot: Json = SNAPSHOT,
  ): TraceEntry[] {
    const out: TraceEntry[] = [];
    for (const i of [0, 1, 2]) {
      out.push({ k: "step", i, step: { op: ops[i] } } as TraceEntry);
      if (i === at) {
        out.push({
          k: "hook",
          hook: "onSnapshot",
          args: [snapshot],
        } as TraceEntry);
      }
      out.push({ k: "async", i } as TraceEntry);
    }

    return out;
  }
  const filed = (ref: TraceEntry[], cand: TraceEntry[], t = ["batched"]) =>
    fileMoves(
      "fuzz",
      compareContract(ref, cand, "v2"),
      entries,
      t,
      stepOps(ref),
    );
  const covered = (
    ds: Difference[],
    ref: TraceEntry[] = trace(0),
    t = ["batched"],
  ) =>
    ds.map(
      (d) =>
        entries.find((e) => covers(e, "fuzz", d, t, stepOps(ref), ds))?.id ??
        null,
    );

  it("is in the (as) group, in a settle step, signed for the row's approval", () => {
    expect(entries).toHaveLength(1);
    const [e] = entries as [Divergence];
    expect(e.group).toBe("row-as");
    expect(e.when).toEqual(["batched"]);
    expect(e.during).toBe("settle");
    expect(e.reason).toContain('"Approve (Recommended)", 2026-11-05');
    expect(e.date).toBe("2026-11-12");
    // The timestamp twin is gone: the recorder no longer records the value.
    expect(
      readDivergences().some((x) => x.id.includes("onSnapshot-changed-ts")),
    ).toBe(false);
    expect(readDivergences().some((x) => x.path === "args[0].timestamp")).toBe(
      false,
    );
  });

  it("covers a snapshot one step earlier on 2.0 when that step is a settle step", () => {
    // 1.35's snapshot in step 2, 2.0's in step 1, a settle step.
    const ds = filed(trace(2), trace(1));
    expect(ds.map((d) => [d.op, d.kind, d.step])).toEqual([
      ["moved", "onSnapshot", 2],
    ]);
    expect(covered(ds, trace(2))).toEqual([MOVED]);
  });

  it("covers no snapshot one step earlier outside a settle step, a later one, a missing one, another field, or a case without a batch", () => {
    // One step earlier, but 2.0's step is not a settle step: the move is not
    // filed (so the pair stays a missing and an extra) and the entry covers
    // neither. The settle step is the reference's, not 2.0's: step 1 is a
    // settle step in both cases below, 2.0's record is in step 0 or 2.
    const ticks = ["tick", "tick", "tick"];
    const outside = filed(trace(2, ticks), trace(1, ticks));
    expect(outside.map((d) => d.op)).toEqual(["extra", "missing"]);
    expect(covered(outside, trace(2, ticks))).toEqual([null, null]);
    const refSettle = filed(trace(1), trace(0));
    expect(refSettle.map((d) => d.op)).toEqual(["extra", "missing"]);
    expect(covered(refSettle, trace(1))).toEqual([null, null]);
    // The move itself, read as `covers` reads it: against 2.0's own step.
    const [hand] = filed(trace(2), trace(1)) as [Difference];
    expect(hand.op).toBe("moved");
    const reads = (ref: TraceEntry[]) =>
      covers(
        entries[0] as Divergence,
        "fuzz",
        hand,
        ["batched"],
        stepOps(ref),
        [hand],
      );
    expect(reads(trace(2))).toBe(true);
    expect(reads(trace(2, ticks))).toBe(false);
    // The reference's step (2) being a settle step is not enough.
    expect(reads(trace(2, ["tick", "tick", "settle"]))).toBe(false);
    // One step later on 2.0: a move the other way, which (as) cannot make,
    // stays a missing and an extra, neither covered.
    expect(covered(filed(trace(1), trace(2)), trace(1))).toEqual([null, null]);
    // Missing on 2.0.
    const missing = compareContract(trace(1), trace(-1), "v2");
    expect(missing.map((d) => d.op)).toEqual(["missing"]);
    expect(covered(missing, trace(1))).toEqual([null]);
    // A moved snapshot whose facts differ: the facts stay compared.
    const facts = filed(
      trace(2, undefined, { ...(SNAPSHOT as object), facts: { "a::f0": 2 } }),
      trace(1),
    );
    expect(covered(facts, trace(2))).toContain(null);
    // Without the batched resolver.
    expect(covered(filed(trace(2), trace(1), []), trace(2), [])).toEqual([
      null,
      null,
    ]);
  });
});

describe("the ignoresAbort gate on the late-write entries", () => {
  const LATE = [
    "quirk-n",
    "quirk-n-batch",
    "row-352",
    "quirk-g",
    "quirk-g-fails",
  ];

  it("every row n, 2/352 and quirk g entry lists it, re-signed with its quote", () => {
    const entries = readDivergences().filter((e) =>
      LATE.includes(e.group as string),
    );
    expect(entries).toHaveLength(44);
    for (const e of entries) {
      expect(e.when, e.id).toContain("ignoresAbort");
      expect(e.reason, e.id).toMatch(
        /Re-signed 2026-11-12: narrowed to a handler that ignores its abort .*\("[^"]+"\)\.$/,
      );
      expect(e.date, e.id).toBe("2026-11-12");
    }
  });

  /** A sample of each `$like` class the 44 entries' patterns name. */
  const SAMPLES: Json[] = [
    1,
    "r0",
    "c0",
    "A0",
    "A0:{}",
    "a.r0",
    "a.x0",
    "f0",
    "rb",
    "b0",
    "AB",
    'AB:{"item":"0.1"}',
    "0.1",
    "a.rb",
  ];

  /** A concrete value a bound pattern admits (a `$like` class gets a sample of it). */
  function instance(pattern: Json | undefined): Json | undefined {
    if (Array.isArray(pattern)) {
      return pattern.map((p) => instance(p) as Json);
    }
    if (pattern !== null && typeof pattern === "object") {
      const keys = Object.keys(pattern);
      if (keys.length === 1 && keys[0] === "$like") {
        const name = pattern.$like as string;
        if (name === "absent") {
          return undefined;
        }
        const hit = SAMPLES.find((v) => LIKE[name]?.(v));
        if (hit === undefined) {
          throw new Error(`no sample for the $like class "${name}"`);
        }

        return hit;
      }
      if (keys.some((k) => k.startsWith("$"))) {
        throw new Error(`no instance for ${JSON.stringify(pattern)}`);
      }

      return Object.fromEntries(
        keys.map((k) => [k, instance(pattern[k] as Json)]),
      ) as Json;
    }

    return pattern;
  }

  const pos = (step: number): Position => [step, 1, 0, 0];

  /**
   * A difference the entry really covers, with the case's other differences
   * and steps it needs: the first record its bound admits, in step 3, after
   * the `destroy` step its `afterOp` names, with a 2.0 timeout record at
   * step 1 where it `requires` one.
   */
  function witness(e: Divergence) {
    const first = (e.bound?.match[0] ?? {}) as Record<string, Json>;
    const base = {
      engine: e.engine ?? "v2",
      stream: e.stream,
      kind: e.kind,
      step: 3,
      phase: "sync",
      at: { reference: 30, candidate: 30 },
      shared: { reference: 0, candidate: 0 },
    };
    const d = (e.op === "changed"
      ? {
          ...base,
          op: "changed",
          path: String(first.path).replace(/\[\*\]/g, "[0]"),
          reference: instance(first.from as Json),
          candidate: instance(first.to as Json),
          ...(first.record ? { record: instance(first.record as Json) } : {}),
          where: { reference: pos(3), candidate: pos(3) },
        }
      : e.op === "missing"
        ? {
            ...base,
            op: "missing",
            reference: instance(first),
            where: { reference: pos(3) },
          }
        : {
            ...base,
            op: "extra",
            candidate: instance(first),
            where: { candidate: pos(3) },
          }) as unknown as Difference;
    const need = e.requires;
    const context = need
      ? [
          {
            ...base,
            stream: need.stream,
            kind: need.kind,
            op: need.op,
            step: 1,
            at: { candidate: 10 },
            candidate: instance(need.bound?.match[0]),
            where: { candidate: pos(1) },
          } as unknown as Difference,
        ]
      : [];
    const steps = new Map<number, string>(e.afterOp ? [[1, e.afterOp]] : []);

    return { d, context: [d, ...context], steps };
  }

  it("a case whose handlers respect their abort is outside every one of them", () => {
    const entries = readDivergences().filter((e) =>
      LATE.includes(e.group as string),
    );
    expect(entries).toHaveLength(44);
    for (const e of entries) {
      const { d, context, steps } = witness(e);
      const when = e.when as string[];
      // A difference the entry really covers, in a case that draws the trigger.
      expect(covers(e, "fuzz", d, when, steps, context), e.id).toBe(true);
      // The same difference in a case whose handlers respect their abort: the
      // other triggers all hold, so only the gate can be what excludes it.
      const respects = when.filter((t) => t !== "ignoresAbort");
      expect(covers(e, "fuzz", d, respects, steps, context), e.id).toBe(false);
    }
  });
});
