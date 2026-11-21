// The L12 gate's run-1 entries (GATE-12.md), each signed on the owner's
// instruction under its row's approval.
// - Row (bx) ("I approve you for to do everything", 2026-11-15):
//   `l12-bx-watch-hears-included-fact`, U1's one extra "watch" callback on
//   2.0, in step 3, carrying plan "pro". Another record, another step or a
//   second callback still fails.
// - Row (az) ("Approve all as recommended (Recommended)", 2026-11-10):
//   `l12-fuzz-az-external-ledger-navigate-entry`, a fuzz `ledger` step whose
//   two records differ only by inserted `system.history.navigate` entries
//   (`PAIR.ledgerNavigateInserted`). Any other change to the ledger records,
//   or a case without a replay or import, still fails.
import { describe, expect, it } from "vitest";
import { compareContract } from "../compare.js";
import { PAIR, pathWithin } from "../fingerprint.js";
import type { Json } from "../normalize.js";
import type { TraceEntry } from "../record.js";
import { FUZZ_SCENARIO, explain, readDivergences } from "../scenario.js";

const BX = "l12-bx-watch-hears-included-fact";
const AZ = "l12-fuzz-az-external-ledger-navigate-entry";
const entry = (id: string) => {
  const e = readDivergences().find((d) => d.id === id);
  if (!e) {
    throw new Error(`no entry ${id}`);
  }

  return e;
};

const stepped = (i: number, records: TraceEntry[]): TraceEntry[] => [
  { k: "step", i, step: `step ${i}` },
  ...records,
  { k: "async", i },
];

describe("row (bx): U1's one extra watch callback, and no other", () => {
  const U1 =
    "a watch misses an included fact's change until a derivation changes (U1)";
  const watch = (data: Json): TraceEntry =>
    ({ k: "external", data: ["watch", data, true] }) as TraceEntry;
  const left = (step: number, extra: TraceEntry[]) =>
    explain(
      U1,
      compareContract(stepped(step, []), stepped(step, extra), "v2"),
      [entry(BX)],
      [],
    ).unexplained.map((d) => `${d.op} ${d.kind} ${d.step}`);
  const pro = { display: "Ada (1)", plan: "pro" };

  it("is signed on the owner's instruction, quoting (bx)'s approval", () => {
    expect(entry(BX).reason).toContain(
      '"I approve you for to do everything" (2026-11-15)',
    );
    expect(entry(BX).approvedBy).toBe("Jason Comes");
  });

  it("control: the one plan-pro callback in step 3 is excused", () => {
    expect(left(3, [watch(pro)])).toEqual([]);
  });

  it("another payload, another step or a second callback fails", () => {
    expect(left(3, [watch({ display: "Ada (1)", plan: "free" })])).toEqual([
      "extra watch 3",
    ]);
    expect(left(3, [watch({ display: "Ada (5)", plan: "pro" })])).toEqual([
      "extra watch 3",
    ]);
    expect(left(4, [watch(pro)])).toEqual(["extra watch 4"]);
    expect(left(3, [watch(pro), watch(pro)])).not.toEqual([]);
  });
});

describe("row (az): the ledger's inserted navigate entries, and nothing else", () => {
  const LABEL = JSON.stringify({ op: "ledger" });
  const base = { hashAlgo: "djb2-1", schemaVersion: 2, ts: 0 };
  // 1.35's trail, oldest first; `query({})` lists it newest first.
  const init = { ...base, kind: "system.init", prevHash: null, seq: 0 };
  const fact = {
    ...base,
    key: "f0",
    kind: "fact.change",
    next: 0,
    origin: "authored",
    prevHash: "e75c7e2",
    seq: 1,
  };
  const start = { ...base, kind: "system.start", prevHash: "7b361ed5", seq: 2 };
  const nav = (seq: number, prevHash = "bd200710") => ({
    ...base,
    from: 0,
    kind: "system.history.navigate",
    prevHash,
    seq,
    to: 0,
  });
  const verify = (entryCount: number, valid = true) =>
    ({
      k: "external",
      data: [LABEL, { entryCount, marksChecked: true, valid }],
    }) as TraceEntry;
  const entries = (oldestFirst: Json[]) =>
    ({
      k: "external",
      data: [LABEL, "entries", [...oldestFirst].reverse()],
    }) as TraceEntry;
  const left = (
    reference: TraceEntry[],
    candidate: TraceEntry[],
    triggers = ["replayedOrImported"],
  ) =>
    explain(
      FUZZ_SCENARIO,
      compareContract(stepped(4, reference), stepped(4, candidate), "v2"),
      [entry(AZ)],
      triggers,
    ).unexplained.map((d) => `${d.op} ${d.path ?? ""}`);
  const v1 = [verify(3), entries([init, fact, start])];

  it("is signed on the owner's instruction, quoting (az)'s approval", () => {
    expect(entry(AZ).reason).toContain(
      '"Approve all as recommended (Recommended)", 2026-11-10',
    );
    expect(entry(AZ).approvedBy).toBe("Jason Comes");
    expect(entry(AZ).when).toEqual(["replayedOrImported"]);
  });

  it("control: a navigate entry appended (the gate's case) is excused", () => {
    expect(left(v1, [verify(4), entries([init, fact, start, nav(3)])])).toEqual(
      [],
    );
  });

  it("control: one inserted mid-trail, the later entries' seq and prevHash moved, is excused", () => {
    const moved = { ...start, prevHash: "1a2b3c4d", seq: 3 };
    expect(
      left(v1, [verify(4), entries([init, fact, nav(2, "e75c7e3"), moved])]),
    ).toEqual([]);
  });

  it("outside replayedOrImported it fails", () => {
    expect(
      left(v1, [verify(4), entries([init, fact, start, nav(3)])], []),
    ).not.toEqual([]);
  });

  it("any other ledger change fails", () => {
    const wrong: Array<[string, TraceEntry[]]> = [
      ["a lower count", [verify(2), entries([init, fact, start])]],
      ["valid false", [verify(4, false), entries([init, fact, start, nav(3)])]],
      [
        "another inserted kind",
        [
          verify(4),
          entries([init, fact, start, { ...nav(3), kind: "system.snapshot" }]),
        ],
      ],
      [
        "a navigate entry with an extra field",
        [verify(4), entries([init, fact, start, { ...nav(3), trigger: "x" }])],
      ],
      [
        "a 1.35 entry changed beside the insertion",
        [verify(4), entries([init, { ...fact, next: 1 }, start, nav(3)])],
      ],
      [
        "a 1.35 entry dropped for the insertion",
        [verify(3), entries([init, fact, nav(2, "e75c7e3")])],
      ],
      [
        "a seq not moved past the insertion",
        [
          verify(4),
          entries([init, fact, nav(2, "e75c7e3"), { ...start, prevHash: "1" }]),
        ],
      ],
      [
        "a prevHash changed before any insertion",
        [
          verify(4),
          entries([init, { ...fact, prevHash: "ffff" }, start, nav(3)]),
        ],
      ],
    ];
    for (const [why, candidate] of wrong) {
      expect(left(v1, candidate), why).not.toEqual([]);
    }
  });

  it("the pair class reads only a ledger step's records", () => {
    const pair = PAIR.ledgerNavigateInserted as (a: Json, b: Json) => boolean;
    const r = {
      k: "external",
      data: ["other", { entryCount: 1, valid: true }],
    };
    const c = {
      k: "external",
      data: ["other", { entryCount: 2, valid: true }],
    };
    expect(pair(r, c)).toBe(false);
    expect(pathWithin("data[2]", "data[2][0].kind")).toBe(true);
    expect(pathWithin("data[2]", "data[20]")).toBe(false);
  });
});

describe("rows (az) and (bi) in the logging plugin: one log line each, and no other", () => {
  const log = (level: string, message: string): TraceEntry =>
    ({ k: "external", data: ["log", level, message] }) as TraceEntry;
  const JUMP = log("info", "[Directive] timetravel.jump");
  const TRACE = log("debug", "[Directive] trace.complete");
  const shared = [
    log("error", "[Directive] resolver.error"),
    log("debug", "[Directive] reconcile.start"),
    log("debug", "[Directive] reconcile.end"),
  ];
  const ids = [
    "l12-fuzz-az-external-log-timetravel-jump-extra",
    "l12-fuzz-bi-external-log-trace-complete-extra",
  ];
  const left = (candidate: TraceEntry[], triggers: string[]) =>
    explain(
      FUZZ_SCENARIO,
      compareContract(stepped(0, shared), stepped(0, candidate), "v2"),
      ids.map(entry),
      triggers,
    ).unexplained.map((d) => `${d.op} ${d.path ?? ""}`.trim());
  const [error, start, end] = shared as [TraceEntry, TraceEntry, TraceEntry];

  it("an extra line pairs by text: only it is extra, the later lines pair with their own", () => {
    expect(left([error, TRACE, start, end], [])).toEqual(["extra"]);
  });

  it("control: each line is excused under its own trigger", () => {
    expect(left([error, TRACE, start, end], ["traceRing"])).toEqual([]);
    expect(left([JUMP, error, start, end], ["replayedOrImported"])).toEqual([]);
  });

  it("under the other row's trigger, another line, or a second line, it fails", () => {
    expect(left([JUMP, error, start, end], ["traceRing"])).toEqual(["extra"]);
    expect(left([error, TRACE, start, end], ["replayedOrImported"])).toEqual([
      "extra",
    ]);
    expect(
      left(
        [error, log("info", "[Directive] trace.complete"), start, end],
        ["traceRing"],
      ),
    ).toEqual(["extra"]);
    expect(
      left(
        [error, log("debug", "[Directive] effect.run"), start, end],
        ["traceRing", "replayedOrImported"],
      ),
    ).toEqual(["extra"]);
    expect(left([error, start, end, end], ["traceRing"])).toEqual(["extra"]);
  });
});
