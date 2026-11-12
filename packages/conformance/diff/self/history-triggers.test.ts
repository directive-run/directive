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
import { type Difference, compareContract } from "../compare.js";
import { LIKE, TEXT, generalizeValue } from "../fingerprint.js";
import { type FuzzSpec, specTriggers } from "../fuzz/model.js";
import type { Json } from "../normalize.js";
import type { TraceEntry } from "../record.js";
import { covers, fileMoves, readDivergences } from "../scenario.js";

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
  });
});

const SNAPSHOT: Json = {
  facts: { "a::f0": 1, "b::when": { $date: "1970-01-01T00:00:00.000Z" } },
  id: 3,
  timestamp: 40,
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
    // Near misses: an extra key, a fact outside the model's names, id 0,
    // a label of another shape.
    expect(LIKE.snapshot?.({ ...(SNAPSHOT as object), extra: 1 })).toBe(false);
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

describe("the (as) moved twins for onSnapshot (rule 5)", () => {
  const MOVED = "l8-fuzz-as-hook-onSnapshot-moved";
  const STAMP = "l8-fuzz-as-hook-onSnapshot-changed-timestamp";
  const entries = readDivergences().filter(
    (e) => e.id === MOVED || e.id === STAMP,
  );

  /** Steps 0 to 2, with an onSnapshot call in the step given. */
  function trace(at: number, snapshot: Json = SNAPSHOT): TraceEntry[] {
    const out: TraceEntry[] = [];
    for (const i of [0, 1, 2]) {
      out.push({ k: "step", i, step: { op: "tick" } } as TraceEntry);
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
    fileMoves("fuzz", compareContract(ref, cand, "v2"), entries, t);
  const covered = (ds: Difference[], t = ["batched"]) =>
    ds.map(
      (d) =>
        entries.find((e) => covers(e, "fuzz", d, t, undefined, ds))?.id ?? null,
    );

  it("are in the (as) group, signed for the row's approval", () => {
    expect(entries).toHaveLength(2);
    for (const e of entries) {
      expect(e.group).toBe("row-as");
      expect(e.when).toEqual(["batched"]);
      expect(e.reason).toContain('"Approve (Recommended)", 2026-11-05');
    }
  });

  it("cover a snapshot one step earlier on 2.0, and its timestamp, in a batched case", () => {
    const ds = filed(trace(2), trace(1));
    expect(ds.map((d) => [d.op, d.kind, d.step])).toEqual([
      ["moved", "onSnapshot", 2],
    ]);
    expect(covered(ds)).toEqual([MOVED]);
    const later = filed(
      trace(2, { ...(SNAPSHOT as object), timestamp: 50 }),
      trace(1),
    );
    expect(later.map((d) => [d.op, d.path ?? ""])).toEqual([
      ["moved", ""],
      ["changed", "args[0].timestamp"],
    ]);
    expect(covered(later)).toEqual([MOVED, STAMP]);
  });

  it("cover no snapshot one step later on 2.0, a missing one, another field, or a case without a batch", () => {
    // One step later on 2.0: a move the other way, which (as) cannot
    // make, stays a missing and an extra, neither covered.
    expect(covered(filed(trace(1), trace(2)))).toEqual([null, null]);
    // Missing on 2.0.
    const missing = compareContract(trace(1), trace(-1), "v2");
    expect(missing.map((d) => d.op)).toEqual(["missing"]);
    expect(covered(missing)).toEqual([null]);
    // A moved snapshot whose facts differ: the facts stay compared.
    const facts = filed(
      trace(2, { ...(SNAPSHOT as object), facts: { "a::f0": 2 } }),
      trace(1),
    );
    expect(covered(facts)).toContain(null);
    // Without the batched resolver.
    expect(covered(filed(trace(2), trace(1), []), [])).toEqual([null, null]);
    // The timestamp alone, with no move: not covered.
    const stamp = compareContract(
      trace(1, { ...(SNAPSHOT as object), timestamp: 50 }),
      trace(1),
      "v2",
    );
    expect(covered(stamp)).toEqual([null]);
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

  it("a case whose handlers respect their abort is outside every one of them", () => {
    const entries = readDivergences().filter((e) =>
      LATE.includes(e.group as string),
    );
    for (const e of entries) {
      const triggers = (e.when as string[]).filter((t) => t !== "ignoresAbort");
      const d = {
        engine: "v2",
        stream: e.stream,
        kind: e.kind,
        op: e.op,
        step: 1,
      } as unknown as Difference;
      // Whatever the difference, the entry cannot cover it without the trigger.
      expect(covers(e, "fuzz", d, triggers), e.id).toBe(false);
    }
  });
});
