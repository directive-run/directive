// The L12 gate's run-5 entries and harness additions (GATE-12.md), on the
// owner's "Yes, run 5 (Recommended)" (2026-11-22). Six groups, each in its
// narrowest form, each with another shape that still fails:
// - quirk b's batch pairing (PR seed 15): a single run's error paired with
//   a batch run's, only where 1.35 left a batch error unpaired;
// - row (bx)'s error pairing (PR seed 6) and compute pairing (PR seed 11,
//   deep seed 24301): a changed pair is excused only where 2.0 made 1.35's
//   record again, unpaired (`requires.same` on a changed difference,
//   `pairedHalf`);
// - row t's cancel of a completed batch run (PR seed 17), only after both
//   engines reported the requirement met (`afterMet`, `markAfterMet`);
// - row t's error shape for a batch run (PR seed 17's second shrink): the
//   cancel 1.35 adds after the run's own error, only after both engines
//   reported that error (`afterError`, `markAfterError`);
// - 1.35's second cancel of a finished batch run after a goTo (PR seed 17's
//   fourth shrink; the owner's "2.0's single cancel; sign it (Recommended)",
//   2026-11-23): only after a history move (a goTo, back or forward step;
//   the owner's "Any history move (Recommended)", 2026-11-26, for PR seed
//   17's ninth case, `pr17i`), and only after both engines
//   reported the run complete, the requirement met and one cancel of it
//   (`afterCancel`, `markAfterCancel`), each engine read in its own record
//   order, so the trace option's crossed pairings (PR seed 17's sixth case,
//   `pr17f`) are explained as well;
// - row t's shared mispairing rule (PR seed 17's eighth case, `pr17h`; the
//   owner's "Apply it to all row t cancels (Recommended)", 2026-11-26):
//   wherever an approved row t entry explains a cancel only 1.35 makes, the
//   pairing of that cancel with 2.0's cancel of another requirement both
//   engines cancel is explained too (`mispaired`, `extraCancelOf`,
//   `markMispaired`); a wrong-request cancel on 2.0, or a mispairing with
//   no approved extra cancel, still fails;
// - row (bx)'s compute inside a trace run (deep seed 1,
//   `PAIR.traceRunRecomputeInserted`);
// - row (bx)'s unknown-key warning and the re-registered derivation (deep
//   seed 2, `TEXT.distributableUnknownKeys`, `markStale`'s register rule).
// - row (ay)'s knock-on in the history record (PR seed 17's eleventh case,
//   `pr17k`; the owner's "Approve (ay) knock-on, keep going (Recommended)",
//   2026-11-27): after a paused goTo, a history record's ids, index and
//   length may differ only by the snapshots row (ay)'s entries explain as
//   missing (`snapshotFollows`, `historyFollows`); any other history
//   difference still fails.
// - the gate PR's review (2026-11-27): in the mispaired form 2.0's cancel of
//   the other requirement must equal 1.35's own unpaired record of it, as
//   compared (`mispairedForm`, `sameAsCompared`); the same id under a wrong
//   resolver, constraint or requirement type still fails.
// Every (bx) entry applies only with a fact-including watch: the same
// records without one still fail.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkDivergences, checkExcuses } from "../../lib/census.js";
import { type Difference, compareContract } from "../compare.js";
import { PAIR, PLUGIN_COUNTERS, TEXT, admits } from "../fingerprint.js";
import type { Json } from "../normalize.js";
import type { TraceEntry } from "../record.js";
import {
  FUZZ_SCENARIO,
  counterOf,
  covers,
  explain,
  fileMoves,
  historyFollows,
  markAfterCancel,
  markAfterError,
  markAfterMet,
  markMispaired,
  markStale,
  mispairedForm,
  pairedHalf,
  readDivergences,
  sameAsCompared,
  stepOps,
  unpairedHalf,
} from "../scenario.js";

const ALL = readDivergences();
const B_IDS = [
  "l12-fuzz-b-batch-pair-hook-onError-changed",
  "l12-fuzz-b-batch-pair-hook-onErrorRecovery-changed",
  "l12-fuzz-b-batch-pair-hook-onResolverError-changed",
  "l12-fuzz-b-batch-pair-observe-resolver-error-changed",
];
const T_IDS = [
  "l12-cand-t-batch-completed-hook-onResolverCancel-missing",
  "l12-cand-t-batch-completed-hook-onRequirementCanceled-missing",
  "l12-cand-t-batch-completed-observe-requirement-canceled-missing",
];
const TE_IDS = [
  "l12-cand-t-batch-error-hook-onResolverCancel-missing",
  "l12-cand-t-batch-error-hook-onRequirementCanceled-missing",
  "l12-cand-t-batch-error-observe-requirement-canceled-missing",
];
const TC_IDS = [
  "l12-cand-t-batch-second-cancel-hook-onResolverCancel-missing",
  "l12-cand-t-batch-second-cancel-hook-onRequirementCanceled-missing",
  "l12-cand-t-batch-second-cancel-observe-requirement-canceled-missing",
];
/** The second-cancel group's mispaired form (pr17g): the pairs, then the cancel left unpaired. */
const TG_CHANGED = [
  "l12-cand-t-batch-second-cancel-hook-onResolverCancel-changed",
  "l12-cand-t-batch-second-cancel-hook-onRequirementCanceled-changed",
  "l12-cand-t-batch-second-cancel-observe-requirement-canceled-changed",
];
const TG_UNPAIRED = [
  "l12-cand-t-batch-second-cancel-hook-onResolverCancel-unpaired-missing",
  "l12-cand-t-batch-second-cancel-hook-onRequirementCanceled-unpaired-missing",
  "l12-cand-t-batch-second-cancel-observe-requirement-canceled-unpaired-missing",
];
/** Row t's shared mispairing rule (pr17h): the pairs, then the cancel left unpaired. */
const TM_SLUGS = [
  "hook-onResolverCancel",
  "hook-onRequirementCanceled",
  "observe-requirement-canceled",
];
const TM_CHANGED = TM_SLUGS.map(
  (slug) => `l12-cand-t-mispaired-cancel-${slug}-changed`,
);
const TM_UNPAIRED = TM_SLUGS.map(
  (slug) => `l12-cand-t-mispaired-cancel-${slug}-unpaired-missing`,
);
/** Row t's first fuzz entries: a single run's cancel 2.0 lacks. */
const L3_MISSING = TM_SLUGS.map((slug) => `l3-cand-t-fuzz-${slug}-missing`);
const BX_IDS = [
  "l12-fuzz-bx-hook-onError-repaired-changed",
  "l12-fuzz-bx-hook-onErrorRecovery-repaired-changed",
  "l12-fuzz-bx-hook-onDerivationCompute-repaired-changed",
  "l12-fuzz-bx-observe-derivation-compute-repaired-changed",
  "l12-fuzz-bx-hook-onTraceComplete-recompute-inserted",
  "l12-fuzz-bx-state-settle-trace-recompute-inserted",
  "l12-fuzz-bx-state-end-trace-recompute-inserted",
  "l12-fuzz-bx-console-warn-distributable-unknown-keys-extra",
];
const byId = (id: string) => {
  const d = ALL.find((x) => x.id === id);
  if (d === undefined) {
    throw new Error(`no entry ${id}`);
  }

  return d;
};
const ON = ["watchIncludesFacts", "distributableWatch"];
const NO_FACTS = ["distributableWatch"];

const step = (i: number, records: TraceEntry[], after: TraceEntry[] = []) =>
  [
    { k: "step", i, step: `step ${i}` },
    ...records,
    { k: "async", i },
    ...after,
  ] as TraceEntry[];
/** The requirement id a cancel record names. */
const canceledId = (record: Json | undefined) => {
  const r = record as {
    args?: ({ id?: string } | string)[];
    event?: { id?: string };
  };
  const named = r?.event ?? r?.args?.find((a) => typeof a === "object");

  return typeof named === "object" ? named.id : undefined;
};
const brief = (d: Difference) =>
  `${d.op} ${d.stream} ${d.kind} ${d.step}${d.path ? ` ${d.path}` : ""}`;

/** What 2.0's trace leaves unexplained against 1.35's, by every signed entry. */
const left = (
  reference: TraceEntry[],
  candidate: TraceEntry[],
  triggers: string[],
) => {
  // As runScenario judges a case: every marker, and the steps' ops.
  const steps = stepOps(reference);
  const diffs = fileMoves(
    FUZZ_SCENARIO,
    markMispaired(
      markAfterCancel(
        markAfterError(
          markAfterMet(
            markStale(compareContract(reference, candidate, "v2"), reference),
            reference,
            candidate,
          ),
          reference,
          candidate,
        ),
        reference,
        candidate,
      ),
      reference,
      candidate,
    ),
    ALL,
    triggers,
    steps,
  );

  return explain(FUZZ_SCENARIO, diffs, ALL, triggers, steps)
    .unexplained.map(brief)
    .sort();
};

/** A hand-made difference of v2, in step 1's async phase, at trace index `n`. */
const diff = (n: number, over: Partial<Difference>): Difference =>
  ({
    engine: "v2",
    step: 1,
    phase: "async",
    at:
      over.op === "missing"
        ? { reference: n }
        : over.op === "extra"
          ? { candidate: n }
          : { reference: n, candidate: n },
    where:
      over.op === "missing"
        ? { reference: [1, 2, n, 1] }
        : over.op === "extra"
          ? { candidate: [1, 2, n, 1] }
          : { reference: [1, 2, n, 0], candidate: [1, 2, n, 0] },
    shared: { reference: n - 1, candidate: n - 1 },
    ...over,
  }) as Difference;
/** What hand-made differences leave unexplained, and which entries covered any. */
const judge = (diffs: Difference[], triggers: string[]) => {
  const r = explain(FUZZ_SCENARIO, diffs, ALL, triggers);

  return { left: r.unexplained.map(brief).sort(), used: r.used };
};

describe("run 5: every entry is signed on the owner's instruction", () => {
  it("quotes the row's approval and the run-5 answer with its date", () => {
    for (const id of [...B_IDS, ...T_IDS, ...BX_IDS]) {
      const d = byId(id);
      expect(d.approvedBy).toBe("Jason Comes");
      expect(d.date).toBe("2026-11-22");
      expect(d.engine).toBe("v2");
      expect(d.ends).toBe(B_IDS.includes(id) ? true : undefined);
      expect(d.reason).toContain("Signed on the owner's instruction");
      expect(d.reason).toContain('"Yes, run 5 (Recommended)" (2026-11-22)');
    }
    for (const id of [...B_IDS, ...T_IDS]) {
      expect(byId(id).reason).toContain(
        '"If all are better or non user facing they are all approved"',
      );
    }
    for (const id of BX_IDS) {
      const d = byId(id);
      expect(d.when).toEqual(["watchIncludesFacts"]);
      expect(d.group).toBe("row-bx");
      expect(d.reason).toContain(
        '"Yes, widen (bx) to its knock-on effects (Recommended)" (2026-11-22)',
      );
      expect(d.reason).toContain(
        '"I approve you for to do everything" (2026-11-15)',
      );
    }
  });
});

describe("requires.same on a changed difference reads 1.35's whole record", () => {
  const changed = diff(5, {
    stream: "hook",
    kind: "onError",
    op: "changed",
    path: "args[0]",
    reference: 1,
    candidate: 2,
    record: { k: "hook", hook: "onError", args: [1] },
    candidateRecord: { k: "hook", hook: "onError", args: [2] },
  });

  it("1.35's record for a changed pair, its own record otherwise", () => {
    expect(pairedHalf(changed)).toEqual(changed.record);
    const missing = diff(6, { op: "missing", reference: { k: "x" } });
    expect(pairedHalf(missing)).toEqual({ k: "x" });
    const extra = diff(7, { op: "extra", candidate: { k: "y" } });
    expect(pairedHalf(extra)).toEqual({ k: "y" });
  });

  it("a changed difference without that record reads as undefined", () => {
    expect(pairedHalf({ ...changed, record: undefined })).toBeUndefined();
  });
});

describe("quirk b's batch pairing (PR seed 15), and no other", () => {
  const B_ON = ["resolverRejects", "batched", "batchFails"];
  const single = {
    $error: {
      name: "DirectiveError",
      message: "a.r0 attempt 1",
      context: {
        fromConstraint: "a::c0",
        id: "A0:{}",
        requirement: { type: "A0" },
      },
      recoverable: true,
      source: "resolver",
      sourceId: "a::r0",
    },
  };
  const batch = (item = "0.0") => ({
    $error: {
      name: "DirectiveError",
      message: `a.rb ${item} attempt 1`,
      context: {
        fromConstraint: "a::b0",
        id: `AB:{"item":"${item}"}`,
        requirement: { item, type: "AB" },
      },
      recoverable: true,
      source: "resolver",
      sourceId: "a::rb",
    },
  });
  const record = (e: Json) => ({ k: "hook", hook: "onError", args: [e] });
  const PATHS: [string, Json | undefined, Json][] = [
    ["context.fromConstraint", "a::c0", "a::b0"],
    ["context.id", "A0:{}", 'AB:{"item":"0.0"}'],
    ["context.requirement.item", undefined, "0.0"],
    ["context.requirement.type", "A0", "AB"],
    ["message", "a.r0 attempt 1", "a.rb 0.0 attempt 1"],
    ["sourceId", "a::r0", "a::rb"],
  ];
  /** 1.35's single-run error paired with 2.0's batch error, field by field. */
  const pairing = (reverse = false) =>
    PATHS.map(([path, from, to]) =>
      diff(46, {
        stream: "hook",
        kind: "onError",
        op: "changed",
        path: `args[0].$error.${path}`,
        reference: reverse ? to : from,
        candidate: reverse ? from : to,
        record: record(reverse ? batch() : single),
        candidateRecord: record(reverse ? single : batch()),
      }),
    );
  /** 1.35's own batch error, left unpaired. */
  const unpaired = (item = "0.0") =>
    diff(51, {
      stream: "hook",
      kind: "onError",
      op: "missing",
      reference: record(batch(item)),
    });

  it("each entry needs a batch error only 1.35 made, and ends the case as quirk b's others do", () => {
    for (const id of B_IDS) {
      const d = byId(id);
      expect(d.requires?.op).toBe("missing");
      expect(d.requires?.kind).toBe(d.kind);
      expect(d.requires?.bound).toBeDefined();
      expect(d.when).toEqual(B_ON);
    }
  });

  it("control: the pairing with 1.35's batch error unpaired is excused, and ends the case", () => {
    const diffs = [...pairing(), unpaired()];
    const r = explain(FUZZ_SCENARIO, diffs, ALL, B_ON);
    expect(r.unexplained).toEqual([]);
    expect(r.used).toContain(B_IDS[0]);
    expect(r.ended.map((e) => e.id)).toEqual([B_IDS[0]]);
    // Two batch items (PR seed 15's second shrink): the unpaired one is the next item's.
    expect(judge([...pairing(), unpaired("0.1")], B_ON).left).toEqual([]);
  });

  it("with no unpaired batch error on 1.35 the same change fails", () => {
    expect(judge(pairing(), B_ON).left).toHaveLength(6);
  });

  it("with only a single run's error unpaired on 1.35 it fails", () => {
    const other = diff(51, {
      stream: "hook",
      kind: "onError",
      op: "missing",
      reference: record({
        $error: { ...single.$error, message: "a.r1 attempt 1" },
      }),
    });
    expect(
      judge([...pairing(), other], B_ON).left.length,
    ).toBeGreaterThanOrEqual(6);
  });

  it("the other way round, or without a failing batch, it fails", () => {
    expect(
      judge([...pairing(true), unpaired()], B_ON).left.length,
    ).toBeGreaterThanOrEqual(6);
    expect(
      judge([...pairing(), unpaired()], ["resolverRejects"]).left.length,
    ).toBeGreaterThanOrEqual(6);
    expect(
      judge([...pairing(), unpaired()], ["resolverRejects", "batched"]).left
        .length,
    ).toBeGreaterThanOrEqual(6);
  });
});

describe("row (bx)'s error pairing (PR seed 6), and no other", () => {
  const error = (n: number, source = "derivation") => ({
    $error: {
      name: "DirectiveError",
      message: `a.d${n} throws at 5`,
      context: { $undefined: true },
      recoverable: true,
      source,
      sourceId: `d${n}`,
    },
  });
  const record = (n: number, source?: string) => ({
    k: "hook",
    hook: "onError",
    args: [error(n, source)],
  });
  /** 1.35's d1 error paired with 2.0's d2 error. */
  const pairing = (source?: string) =>
    (
      [
        ["message", "a.d1 throws at 5", "a.d2 throws at 5"],
        ["sourceId", "d1", "d2"],
      ] as const
    ).map(([path, from, to]) =>
      diff(31, {
        stream: "hook",
        kind: "onError",
        op: "changed",
        path: `args[0].$error.${path}`,
        reference: from,
        candidate: to,
        record: record(1, source),
        candidateRecord: record(2, source),
      }),
    );
  /** 2.0's extra read: its own onError of derivation `n`, and its warning. */
  const extraRead = (n: number) => [
    diff(24, {
      stream: "hook",
      kind: "onError",
      op: "extra",
      candidate: record(n),
    }),
    diff(26, {
      stream: "console",
      kind: "warn",
      op: "extra",
      candidate: {
        k: "console",
        level: "warn",
        args: [{ $incidental: "string" }, { $incidental: "object" }],
      },
      raw: {
        k: "console",
        level: "warn",
        args: [
          `[Directive] getDistributableSnapshot: Skipping derivation "d${n}" due to error:`,
          { $error: { name: "Error", message: `a.d${n} throws at 5` } },
        ],
      },
    }),
  ];

  it("control: with 2.0's own extra d1 error the pairing is excused", () => {
    const r = judge([...extraRead(1), ...pairing()], ON);
    expect(r.left).toEqual([]);
    expect(r.used).toContain("l12-fuzz-bx-hook-onError-repaired-changed");
  });

  it("without a fact-including watch the same records fail", () => {
    expect(judge([...extraRead(1), ...pairing()], NO_FACTS).left).toHaveLength(
      4,
    );
    expect(judge([...extraRead(1), ...pairing()], []).left).toHaveLength(4);
  });

  it("with no extra error equal to 1.35's the change fails", () => {
    // 1.35 reported d1 once; 2.0 reported d2 twice and d1 never.
    expect(judge([...extraRead(2), ...pairing()], ON).left).toEqual([
      "changed hook onError 1 args[0].$error.message",
      "changed hook onError 1 args[0].$error.sourceId",
    ]);
    expect(judge(pairing(), ON).left).toHaveLength(2);
  });

  it("an error of another source fails", () => {
    expect(
      judge([...extraRead(1), ...pairing("effect")], ON).left,
    ).toHaveLength(2);
  });
});

describe("row t: a completed batch run's cancel, only after met (PR seed 17)", () => {
  const T_ON = ["writeRetracts", "batched"];
  const ID = 'AB:{"item":"0.0"}';
  const full = {
    fromConstraint: "a::b0",
    id: ID,
    requirement: { item: "0.0", type: "AB" },
  };
  const hook = (name: string, args: Json[]) =>
    ({ k: "hook", hook: name, args }) as TraceEntry;
  const observe = (event: Json) => ({ k: "observe", event }) as TraceEntry;
  const created = [
    hook("onRequirementCreated", [full]),
    observe({ id: ID, requirementType: "AB", type: "requirement.created" }),
  ];
  const met = [
    hook("onResolverComplete", ["a::rb", full, 0]),
    hook("onRequirementMet", [full, "a::rb"]),
    observe({ byResolver: "a::rb", id: ID, type: "requirement.met" }),
  ];
  const cancel = [
    hook("onResolverCancel", ["a::rb", { id: ID }]),
    hook("onRequirementCanceled", [{ id: ID }]),
    observe({ id: ID, type: "requirement.canceled" }),
  ];
  const end = hook("onReconcileEnd", [{ canceled: [{ id: ID }] }]);
  const CANCELS = [
    "missing hook onRequirementCanceled 2",
    "missing hook onResolverCancel 2",
    "missing observe requirement.canceled 2",
  ];

  it("each entry is op missing with afterMet", () => {
    for (const id of T_IDS) {
      expect(byId(id).afterMet).toBe(true);
      expect(byId(id).op).toBe("missing");
      expect(byId(id).when).toEqual(T_ON);
    }
  });

  it("control: after both engines reported it met, 1.35's cancel is excused", () => {
    const v1 = [...step(1, created), ...step(2, [...met, ...cancel, end])];
    const v2 = [...step(1, created), ...step(2, [...met, end])];
    expect(left(v1, v2, T_ON)).toEqual([]);
  });

  it("a cancel 2.0 lacks while the batch run is still in flight fails", () => {
    const v1 = [...step(1, created), ...step(2, [...cancel, end])];
    const v2 = [...step(1, created), ...step(2, [end])];
    expect(left(v1, v2, T_ON)).toEqual(CANCELS);
  });

  it("met on 1.35 only fails", () => {
    const v1 = [...step(1, created), ...step(2, [...met, ...cancel, end])];
    const v2 = [...step(1, created), ...step(2, [end])];
    expect(left(v1, v2, T_ON)).toEqual(expect.arrayContaining(CANCELS));
  });

  it("created again after met, on both engines, fails", () => {
    const v1 = [
      ...step(1, created),
      ...step(2, [...met, ...created, ...cancel, end]),
    ];
    const v2 = [...step(1, created), ...step(2, [...met, ...created, end])];
    expect(left(v1, v2, T_ON)).toEqual(CANCELS);
  });

  it("a second cancel after one both engines reported fails", () => {
    const v1 = [
      ...step(1, created),
      ...step(2, [...met, ...cancel, end]),
      ...step(3, [...cancel, end]),
    ];
    const v2 = [
      ...step(1, created),
      ...step(2, [...met, ...cancel, end]),
      ...step(3, [end]),
    ];
    expect(left(v1, v2, T_ON)).toEqual(
      CANCELS.map((x) => x.replace(/2$/, "3")),
    );
  });

  it("without a batch in the case it fails", () => {
    const v1 = [...step(1, created), ...step(2, [...met, ...cancel, end])];
    const v2 = [...step(1, created), ...step(2, [...met, end])];
    expect(left(v1, v2, ["writeRetracts"])).toEqual(CANCELS);
  });

  it("markAfterMet marks only a missing cancel record", () => {
    const v1 = [...step(1, created), ...step(2, [...met, ...cancel, end])];
    const v2 = [...step(1, created), ...step(2, [...met, end])];
    const marked = markAfterMet(compareContract(v1, v2, "v2"), v1, v2);
    expect(marked.map((d) => [d.kind, d.afterMet])).toEqual([
      ["onResolverCancel", true],
      ["onRequirementCanceled", true],
      ["requirement.canceled", true],
    ]);
    // The other way round (2.0 cancels, 1.35 does not) is an extra: unmarked.
    const extra = markAfterMet(compareContract(v2, v1, "v2"), v2, v1);
    expect(extra.every((d) => d.afterMet === undefined)).toBe(true);
  });
});

describe("row t's error shape: an errored batch run's cancel, only after its own error (PR seed 17's second shrink)", () => {
  const TE_ON = ["writeRetracts", "batched", "batchFails"];
  const ID = 'AB:{"item":"0.0"}';
  const OTHER = 'AB:{"item":"0.1"}';
  const full = (id: string) => ({
    fromConstraint: "a::b0",
    id,
    requirement: { item: id === ID ? "0.0" : "0.1", type: "AB" },
  });
  const hook = (name: string, args: Json[]) =>
    ({ k: "hook", hook: name, args }) as TraceEntry;
  const observe = (event: Json) => ({ k: "observe", event }) as TraceEntry;
  const created = (id = ID) => [
    hook("onRequirementCreated", [full(id)]),
    observe({ id, requirementType: "AB", type: "requirement.created" }),
  ];
  const failure = { $error: { name: "Error", message: "a.rb 0.0 attempt 1" } };
  const errored = (id = ID, resolver = "a::rb") => [
    hook("onResolverError", [resolver, full(id), failure]),
    observe({
      error: failure,
      requirementId: id,
      resolver,
      type: "resolver.error",
    }),
  ];
  const cancel = (resolver = "a::rb") => [
    hook("onResolverCancel", [resolver, { id: ID }]),
    hook("onRequirementCanceled", [{ id: ID }]),
    observe({ id: ID, type: "requirement.canceled" }),
  ];
  const end = hook("onReconcileEnd", [{ canceled: [{ id: ID }] }]);
  const CANCELS = [
    "missing hook onRequirementCanceled 2",
    "missing hook onResolverCancel 2",
    "missing observe requirement.canceled 2",
  ];

  it("each entry is op missing with afterError, in a case with a failing batch", () => {
    for (const id of TE_IDS) {
      expect(byId(id).afterError).toBe(true);
      expect(byId(id).afterMet).toBeUndefined();
      expect(byId(id).op).toBe("missing");
      expect(byId(id).when).toEqual(TE_ON);
    }
  });

  it("control: after both engines reported the run's error, 1.35's cancel is excused", () => {
    const v1 = [
      ...step(1, created()),
      ...step(2, [...errored(), ...cancel(), end]),
    ];
    const v2 = [...step(1, created()), ...step(2, [...errored(), end])];
    expect(left(v1, v2, TE_ON)).toEqual([]);
  });

  it("the same cancel without the preceding error on that run fails", () => {
    const v1 = [...step(1, created()), ...step(2, [...cancel(), end])];
    const v2 = [...step(1, created()), ...step(2, [end])];
    expect(left(v1, v2, TE_ON)).toEqual(CANCELS);
  });

  it("an error of another batch run, not the canceled one's own, fails", () => {
    const both = [...created(), ...created(OTHER)];
    const v1 = [
      ...step(1, both),
      ...step(2, [...errored(OTHER), ...cancel(), end]),
    ];
    const v2 = [...step(1, both), ...step(2, [...errored(OTHER), end])];
    expect(left(v1, v2, TE_ON)).toEqual(CANCELS);
  });

  it("the error on 1.35 only fails", () => {
    const v1 = [
      ...step(1, created()),
      ...step(2, [...errored(), ...cancel(), end]),
    ];
    const v2 = [...step(1, created()), ...step(2, [end])];
    // Quirk b's signed batch entries (l7-fuzz-b-*-batchFails) cover the
    // error 2.0 lacks and end the case there, so the cancel is judged here
    // by its marker and by the row-t error entries alone.
    const diffs = markAfterError(compareContract(v1, v2, "v2"), v1, v2);
    expect(diffs.every((d) => d.afterError === undefined)).toBe(true);
    const own = TE_IDS.map(byId);
    expect(
      explain(FUZZ_SCENARIO, diffs, own, TE_ON).unexplained.map(brief).sort(),
    ).toEqual(expect.arrayContaining(CANCELS));
    expect(explain(FUZZ_SCENARIO, diffs, ALL, TE_ON).used).toEqual(
      expect.arrayContaining([
        "l7-fuzz-b-hook-onResolverError-missing-batchFails",
      ]),
    );
  });

  it("created again after the error, on both engines, fails", () => {
    const v1 = [
      ...step(1, created()),
      ...step(2, [...errored(), ...created(), ...cancel(), end]),
    ];
    const v2 = [
      ...step(1, created()),
      ...step(2, [...errored(), ...created(), end]),
    ];
    expect(left(v1, v2, TE_ON)).toEqual(CANCELS);
  });

  it("a second cancel after one both engines reported fails", () => {
    const v1 = [
      ...step(1, created()),
      ...step(2, [...errored(), ...cancel(), end]),
      ...step(3, [...cancel(), end]),
    ];
    const v2 = [
      ...step(1, created()),
      ...step(2, [...errored(), ...cancel(), end]),
      ...step(3, [end]),
    ];
    expect(left(v1, v2, TE_ON)).toEqual(
      CANCELS.map((x) => x.replace(/2$/, "3")),
    );
  });

  it("the logging plugin's lines between the cancel's records change nothing", () => {
    const line = (text: string) =>
      ({ k: "external", data: ["log", "debug", text] }) as TraceEntry;
    const [resolverCancel, requirementCanceled, canceled] = cancel();
    const logged = [
      line("[Directive] resolver.cancel"),
      resolverCancel,
      line("[Directive] requirement.canceled"),
      requirementCanceled,
      canceled,
    ] as TraceEntry[];
    const v1 = [
      ...step(1, created()),
      ...step(2, [...errored(), ...logged, end]),
    ];
    const v2 = [...step(1, created()), ...step(2, [...errored(), end])];
    const marked = markAfterError(compareContract(v1, v2, "v2"), v1, v2);
    expect(marked.map((d) => [d.kind, d.afterError])).toEqual([
      ["onResolverCancel", true],
      ["onRequirementCanceled", true],
      ["requirement.canceled", true],
    ]);
    // Any other record between them is another cancel's or another run's.
    const apart = [
      resolverCancel,
      hook("onReconcileStart", [{}]),
      requirementCanceled,
      canceled,
    ] as TraceEntry[];
    const w1 = [
      ...step(1, created()),
      ...step(2, [...errored(), ...apart, end]),
    ];
    const w2 = [
      ...step(1, created()),
      ...step(2, [...errored(), hook("onReconcileStart", [{}]), end]),
    ];
    const split = markAfterError(compareContract(w1, w2, "v2"), w1, w2);
    expect(split.map((d) => [d.kind, d.afterError])).toEqual([
      ["onResolverCancel", true],
      ["onRequirementCanceled", undefined],
      ["requirement.canceled", undefined],
    ]);
  });

  it("an onResolverCancel naming another resolver than the error's fails", () => {
    const v1 = [
      ...step(1, created()),
      ...step(2, [...errored(), ...cancel("b::rb"), end]),
    ];
    const v2 = [...step(1, created()), ...step(2, [...errored(), end])];
    expect(left(v1, v2, TE_ON)).toContain("missing hook onResolverCancel 2");
  });

  it("without a failing batch in the case it fails", () => {
    const v1 = [
      ...step(1, created()),
      ...step(2, [...errored(), ...cancel(), end]),
    ];
    const v2 = [...step(1, created()), ...step(2, [...errored(), end])];
    expect(left(v1, v2, ["writeRetracts", "batched"])).toEqual(CANCELS);
    expect(left(v1, v2, ["batched", "batchFails"])).toEqual(CANCELS);
  });

  it("markAfterError marks only a missing cancel record after the error", () => {
    const v1 = [
      ...step(1, created()),
      ...step(2, [...errored(), ...cancel(), end]),
    ];
    const v2 = [...step(1, created()), ...step(2, [...errored(), end])];
    const marked = markAfterError(compareContract(v1, v2, "v2"), v1, v2);
    expect(marked.map((d) => [d.kind, d.afterError, d.afterMet])).toEqual([
      ["onResolverCancel", true, undefined],
      ["onRequirementCanceled", true, undefined],
      ["requirement.canceled", true, undefined],
    ]);
    // The other way round (2.0 cancels, 1.35 does not) is an extra: unmarked.
    const extra = markAfterError(compareContract(v2, v1, "v2"), v2, v1);
    expect(extra.every((d) => d.afterError === undefined)).toBe(true);
    // A cancel after met is row t's third path, not its error shape.
    const metV1 = [
      ...step(1, created()),
      ...step(2, [
        hook("onRequirementMet", [full(ID), "a::rb"]),
        ...cancel(),
        end,
      ]),
    ];
    const metV2 = [
      ...step(1, created()),
      ...step(2, [hook("onRequirementMet", [full(ID), "a::rb"]), end]),
    ];
    const met = markAfterError(
      compareContract(metV1, metV2, "v2"),
      metV1,
      metV2,
    );
    expect(met.every((d) => d.afterError === undefined)).toBe(true);
  });
});

describe("1.35's further cancels of a finished or failed batch run after a goTo (PR seed 17's fourth and fifth shrinks), and no other", () => {
  // pr17d's own triggers.
  const TC_ON = [
    "settleStop",
    "writeRetracts",
    "batched",
    "batchMaxSize",
    "navigated",
    "navigatedBusy",
    "ignoresAbort",
  ];
  // pr17e's own triggers: pr17d's, with a failing batch.
  const TC_FAILS = [
    ...TC_ON,
    "resolverRejects",
    "batchWithResults",
    "batchFails",
    "batchAllFail",
  ];
  const ID = 'AB:{"item":"0.0"}';
  const OTHER = 'AB:{"item":"0.1"}';
  const full = (id: string) => ({
    fromConstraint: "a::b0",
    id,
    requirement: { item: id === ID ? "0.0" : "0.1", type: "AB" },
  });
  const hook = (name: string, args: Json[]) =>
    ({ k: "hook", hook: name, args }) as TraceEntry;
  const observe = (event: Json) => ({ k: "observe", event }) as TraceEntry;
  /** A history step, as the fuzz model labels one. */
  const history = (i: number, op: Json) =>
    [
      { k: "step", i, step: { op: "run", label: JSON.stringify(op) } },
      { k: "async", i },
    ] as TraceEntry[];
  const goTo = (i = 1) => history(i, { op: "goTo", position: 0 });
  /** The history moves the second-cancel entries take (`afterOp`). */
  const HISTORY_MOVES = ["goTo", "back", "forward"];
  /** `trace` with its first step, a goTo, replaced by another history step. */
  const moved = (trace: TraceEntry[], op: Json) => [
    ...history(1, op),
    ...trace.slice(goTo().length),
  ];
  const created = (id = ID) => [
    hook("onRequirementCreated", [full(id)]),
    observe({ id, requirementType: "AB", type: "requirement.created" }),
  ];
  const finished = (id = ID, resolver = "a::rb") => [
    hook("onResolverComplete", [resolver, full(id), 5]),
    observe({
      duration: 5,
      requirementId: id,
      resolver,
      type: "resolver.complete",
    }),
    hook("onRequirementMet", [full(id), resolver]),
    observe({ byResolver: resolver, id, type: "requirement.met" }),
  ];
  /** 1.35's cancel, carrying only the id (row (aq)). */
  const cancel = (id = ID, resolver = "a::rb") => [
    hook("onResolverCancel", [resolver, { id }]),
    hook("onRequirementCanceled", [{ id }]),
    observe({ id, type: "requirement.canceled" }),
  ];
  /** 2.0's cancel, carrying the whole requirement. */
  const cancel2 = (id = ID) => [
    hook("onResolverCancel", ["a::rb", full(id)]),
    hook("onRequirementCanceled", [full(id)]),
    observe({ id, type: "requirement.canceled" }),
  ];
  const failure = { $error: { name: "Error", message: "a.rb 0.0 attempt 1" } };
  const errored = (resolver = "a::rb") => [
    hook("onResolverError", [resolver, full(ID), failure]),
    observe({
      error: failure,
      requirementId: ID,
      resolver,
      type: "resolver.error",
    }),
  ];
  const end = hook("onReconcileEnd", [{ canceled: [{ id: ID }] }]);
  const CANCELS = [
    "missing hook onRequirementCanceled 3",
    "missing hook onResolverCancel 3",
    "missing observe requirement.canceled 3",
  ];
  const CANCEL_KINDS = [
    "onResolverCancel",
    "onRequirementCanceled",
    "requirement.canceled",
  ];
  /** A case of three steps: a goTo, the requirement created, then `records`. */
  const caseOf = (records: TraceEntry[]) => [
    ...goTo(),
    ...step(2, created()),
    ...step(3, [...records, end]),
  ];
  /** pr17e's shape: a goTo, then the failed run canceled once, and again on 1.35. */
  const e1 = caseOf([...errored(), ...cancel(), ...cancel()]);
  const e2 = caseOf([...errored(), ...cancel2()]);
  /** pr17d's shape: a goTo, then the finished run canceled once, and again on 1.35. */
  const v1 = [
    ...goTo(),
    ...step(2, created()),
    ...step(3, [...finished(), ...cancel(), ...cancel(), end]),
  ];
  const v2 = [
    ...goTo(),
    ...step(2, created()),
    ...step(3, [...finished(), ...cancel2(), end]),
  ];
  const marks = (reference: TraceEntry[], candidate: TraceEntry[]) =>
    markAfterCancel(
      compareContract(reference, candidate, "v2"),
      reference,
      candidate,
    )
      .filter((d) => d.op === "missing")
      .map((d) => [d.kind, d.afterCancel]);
  const YES = CANCEL_KINDS.map((kind) => [kind, true]);
  /** The records 2.0 lacks that the three entries alone leave unexplained. */
  const missingByOwn = (
    reference: TraceEntry[],
    candidate: TraceEntry[],
    triggers: string[],
  ) =>
    explain(
      FUZZ_SCENARIO,
      markAfterCancel(
        compareContract(reference, candidate, "v2"),
        reference,
        candidate,
      ),
      TC_IDS.map(byId),
      triggers,
      stepOps(reference),
    )
      .unexplained.filter((d) => d.op === "missing")
      .map(brief)
      .sort();

  it("each entry is signed on the owner's two answers, next to rows t and (av)", () => {
    for (const id of TC_IDS) {
      const d = byId(id);
      expect(d.approvedBy).toBe("Jason Comes");
      expect(d.date).toBe("2026-11-23");
      expect(d.engine).toBe("v2");
      expect(d.op).toBe("missing");
      expect(d.ends).toBeUndefined();
      expect(d.afterCancel).toBe(true);
      expect(d.afterMet).toBeUndefined();
      expect(d.afterError).toBeUndefined();
      expect(d.afterOp).toEqual(HISTORY_MOVES);
      expect(d.when).toEqual(["batched", "navigated", "navigatedBusy"]);
      expect(d.group).toBe("quirk-t-batch-second-cancel");
      expect(d.reason).toContain("Signed on the owner's instruction");
      expect(d.reason).toContain(
        '"2.0\'s single cancel; sign it (Recommended)" (2026-11-23)',
      );
      expect(d.reason).toContain(
        '"Widen to any outcome (Recommended)" (2026-11-23)',
      );
      expect(d.reason).toContain("Row t was owner-approved 2026-11-01");
      expect(d.reason).toContain('"Approve: once (Recommended)" (2026-11-07)');
    }
  });

  it("control: after a goTo, a finished run both engines canceled once, 1.35's second cancel is excused", () => {
    expect(marks(v1, v2)).toEqual([
      ["onResolverCancel", true],
      ["onRequirementCanceled", true],
      ["requirement.canceled", true],
    ]);
    expect(left(v1, v2, TC_ON)).toEqual([]);
    // The same with the first cancel in one shape on both engines.
    const same = [
      ...goTo(),
      ...step(2, created()),
      ...step(3, [...finished(), ...cancel(), end]),
    ];
    expect(left(v1, same, TC_ON)).toEqual([]);
  });

  it("control: the same after a run that failed (pr17e), 1.35's second cancel is excused", () => {
    expect(marks(e1, e2)).toEqual(YES);
    expect(left(e1, e2, TC_FAILS)).toEqual([]);
    // The run failed twice: its last error, then the cancel.
    const twice1 = caseOf([
      ...errored(),
      ...errored(),
      ...cancel(),
      ...cancel(),
    ]);
    const twice2 = caseOf([...errored(), ...errored(), ...cancel2()]);
    expect(marks(twice1, twice2)).toEqual(YES);
    expect(left(twice1, twice2, TC_FAILS)).toEqual([]);
  });

  it("1.35's third cancel is excused as its second is, after either outcome", () => {
    const third = caseOf([
      ...finished(),
      ...cancel(),
      ...cancel(),
      ...cancel(),
    ]);
    expect(marks(third, v2)).toEqual([...YES, ...YES]);
    expect(left(third, v2, TC_ON)).toEqual([]);
    const thirdFailed = caseOf([
      ...errored(),
      ...cancel(),
      ...cancel(),
      ...cancel(),
    ]);
    expect(marks(thirdFailed, e2)).toEqual([...YES, ...YES]);
    expect(left(thirdFailed, e2, TC_FAILS)).toEqual([]);
  });

  it("after a failed run, a second cancel with no cancel reported before it on 2.0 fails", () => {
    const none = caseOf(errored());
    // 2.0 lacks both cancels. The first is row t's error shape (after the
    // error, l12-cand-t-batch-error-*); the second stays unexplained.
    expect(marks(e1, none).map(([, mark]) => mark)).toEqual(
      new Array(6).fill(undefined),
    );
    expect(left(e1, none, TC_FAILS)).toEqual(CANCELS);
    const own = TC_IDS.map(byId);
    const diffs = markAfterCancel(compareContract(e1, none, "v2"), e1, none);
    expect(
      explain(FUZZ_SCENARIO, diffs, own, TC_FAILS, stepOps(e1)).unexplained,
    ).toHaveLength(6);
  });

  it("after a failed run, without a history move it fails", () => {
    // No navigation in the case.
    const off = TC_FAILS.filter((t) => !t.startsWith("navigated"));
    expect(left(e1, e2, off)).toEqual(CANCELS);
    // No history step before the cancels' step.
    expect(left(e1.slice(2), e2.slice(2), TC_FAILS)).toEqual(CANCELS);
    // A history step that is not a move.
    for (const op of [
      { op: "replay" },
      { op: "roundtrip" },
      { op: "begin" },
    ] as Json[]) {
      expect(left(moved(e1, op), moved(e2, op), TC_FAILS)).toEqual(CANCELS);
    }
  });

  it("after a failed run, a back (pr17i) or a forward step is a history move, as a goTo is (the owner's 2026-11-26 answer)", () => {
    // Held as failing before the owner's "Any history move (Recommended)"
    // (2026-11-26); his answer makes back and forward qualify.
    for (const op of [
      { op: "back", steps: 1 },
      { op: "back" },
      { op: "forward", steps: 1 },
      { op: "forward" },
    ] as Json[]) {
      const [r, c] = [moved(e1, op), moved(e2, op)];
      expect(marks(r, c)).toEqual(YES);
      expect(left(r, c, TC_FAILS)).toEqual([]);
      // An extra cancel on 2.0 after the same move still fails.
      expect(
        left(c, r, TC_FAILS).filter((line) => line.startsWith("extra ")),
      ).toHaveLength(3);
      // So does the move with no navigation that ran while work was in flight.
      expect(
        left(
          r,
          c,
          TC_FAILS.filter((t) => t !== "navigatedBusy"),
        ),
      ).toEqual(CANCELS);
    }
  });

  it("an extra cancel on 2.0 instead of 1.35 fails", () => {
    // 2.0 cancels twice, 1.35 once: extras on 2.0, which nothing marks.
    for (const [once, twice, on] of [
      [v2, v1, TC_ON],
      [e2, e1, TC_FAILS],
    ] as [TraceEntry[], TraceEntry[], string[]][]) {
      const extra = markAfterCancel(
        compareContract(once, twice, "v2"),
        once,
        twice,
      );
      expect(extra.every((d) => d.afterCancel === undefined)).toBe(true);
      expect(
        left(once, twice, on).filter((line) => line.startsWith("extra ")),
      ).toHaveLength(3);
    }
    // 2.0 cancels twice and 1.35 three times: 2.0 reported more than one.
    const three = caseOf([...errored(), ...cancel(), ...cancel(), ...cancel()]);
    const two = caseOf([...errored(), ...cancel2(), ...cancel2()]);
    expect(marks(three, two).map(([, mark]) => mark)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(left(three, two, TC_FAILS)).toEqual(CANCELS);
  });

  it("any other record that differs fails", () => {
    // 1.35 creates the requirement again after its second cancel: the
    // cancels are excused, the create's records are not.
    const again = caseOf([
      ...finished(),
      ...cancel(),
      ...cancel(),
      ...created(),
    ]);
    expect(left(again, v2, TC_ON)).toEqual([
      "missing hook onRequirementCreated 3",
      "missing observe requirement.created 3",
    ]);
    // 1.35 reports the run's error once more after its second cancel: the
    // three entries cover the cancel's records and never the error's.
    const more = caseOf([...errored(), ...cancel(), ...cancel(), ...errored()]);
    expect(missingByOwn(more, e2, TC_FAILS)).toEqual([
      "missing hook onResolverError 3",
      "missing observe resolver.error 3",
    ]);
    // 2.0 lacks the run's error: no outcome on 2.0, so the cancel fails too.
    const silent = caseOf(cancel2());
    expect(missingByOwn(e1, silent, TC_FAILS)).toEqual(
      [
        ...CANCELS,
        "missing hook onResolverError 3",
        "missing observe resolver.error 3",
      ].sort(),
    );
    // 1.35's second cancel in 2.0's whole-requirement shape: not the id-only record.
    const whole = caseOf([...errored(), ...cancel(), ...cancel2()]);
    expect(left(whole, e2, TC_FAILS)).toEqual(CANCELS.slice(0, 2));
  });

  it("the outcome must be the same on both engines, from the resolver the cancel names", () => {
    // Failed on 1.35, finished on 2.0.
    const ofCancels = marks(e1, v2).filter(([kind]) =>
      CANCEL_KINDS.includes(kind as string),
    );
    expect(ofCancels.map(([, mark]) => mark)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(missingByOwn(e1, v2, TC_FAILS)).toEqual(
      expect.arrayContaining(CANCELS),
    );
    // Failed in another resolver than the one the cancels name.
    const other1 = caseOf([...errored("b::rb"), ...cancel(), ...cancel()]);
    const other2 = caseOf([...errored("b::rb"), ...cancel2()]);
    expect(left(other1, other2, TC_FAILS)).toEqual(CANCELS);
  });

  it("a second cancel with no cancel reported before it on 2.0 fails", () => {
    const none = [
      ...goTo(),
      ...step(2, created()),
      ...step(3, [...finished(), end]),
    ];
    // 2.0 lacks both cancels. The first is row t's third path (after met,
    // l12-cand-t-batch-completed-*); the second stays unexplained.
    expect(marks(v1, none).map(([, mark]) => mark)).toEqual(
      new Array(6).fill(undefined),
    );
    expect(left(v1, none, TC_ON)).toEqual(CANCELS);
    const own = TC_IDS.map(byId);
    const diffs = markAfterCancel(compareContract(v1, none, "v2"), v1, none);
    expect(
      explain(FUZZ_SCENARIO, diffs, own, TC_ON, stepOps(v1)).unexplained,
    ).toHaveLength(6);
  });

  it("without a history move it fails", () => {
    // No navigation in the case.
    const off = TC_ON.filter((t) => !t.startsWith("navigated"));
    expect(left(v1, v2, off)).toEqual(CANCELS);
    expect(left(v1.slice(2), v2.slice(2), off)).toEqual(CANCELS);
    // No history step before the cancels' step, the triggers as they are.
    expect(left(v1.slice(2), v2.slice(2), TC_ON)).toEqual(CANCELS);
    // A navigation that never ran while work was in flight.
    expect(
      left(
        v1,
        v2,
        TC_ON.filter((t) => t !== "navigatedBusy"),
      ),
    ).toEqual(CANCELS);
    // A history step that is not a move.
    for (const op of [
      { op: "replay" },
      { op: "roundtrip" },
      { op: "end" },
    ] as Json[]) {
      expect(left(moved(v1, op), moved(v2, op), TC_ON)).toEqual(CANCELS);
    }
    // A history move only after the second cancel's step.
    for (const op of [
      { op: "goTo", position: 0 },
      { op: "back", steps: 1 },
      { op: "forward", steps: 1 },
    ] as Json[]) {
      expect(
        left(
          [...v1.slice(2), ...history(4, op)],
          [...v2.slice(2), ...history(4, op)],
          TC_ON,
        ),
      ).toEqual(CANCELS);
    }
  });

  it("after a finished run, a back or a forward step is a history move, as a goTo is (the owner's 2026-11-26 answer)", () => {
    // Held as failing ("another navigation than a goTo") before the owner's
    // "Any history move (Recommended)" (2026-11-26).
    for (const op of [
      { op: "back", steps: 1 },
      { op: "forward", steps: 1 },
    ] as Json[]) {
      const [r, c] = [moved(v1, op), moved(v2, op)];
      expect(marks(r, c)).toEqual(YES);
      expect(left(r, c, TC_ON)).toEqual([]);
      expect(
        left(c, r, TC_ON).filter((line) => line.startsWith("extra ")),
      ).toHaveLength(3);
    }
  });

  it("on a run with no outcome reported, or one from another resolver, it fails", () => {
    // Still in flight: canceled once on both engines, again on 1.35.
    const flight1 = [
      ...goTo(),
      ...step(2, created()),
      ...step(3, [...cancel(), ...cancel(), end]),
    ];
    const flight2 = [
      ...goTo(),
      ...step(2, created()),
      ...step(3, [...cancel2(), end]),
    ];
    expect(marks(flight1, flight2).map(([, mark]) => mark)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(left(flight1, flight2, TC_ON)).toEqual(CANCELS);
    expect(left(flight1, flight2, TC_FAILS)).toEqual(CANCELS);
    // Completed by another resolver than the one the cancel names.
    const other1 = [
      ...goTo(),
      ...step(2, created()),
      ...step(3, [...finished(ID, "b::rb"), ...cancel(), ...cancel(), end]),
    ];
    const other2 = [
      ...goTo(),
      ...step(2, created()),
      ...step(3, [...finished(ID, "b::rb"), ...cancel2(), end]),
    ];
    expect(left(other1, other2, TC_ON)).toEqual(CANCELS);
  });

  it("created again after the first cancel, on both engines, fails", () => {
    const again1 = [
      ...goTo(),
      ...step(2, created()),
      ...step(3, [...finished(), ...cancel(), ...created(), ...cancel(), end]),
    ];
    const again2 = [
      ...goTo(),
      ...step(2, created()),
      ...step(3, [...finished(), ...cancel2(), ...created(), end]),
    ];
    expect(left(again1, again2, TC_ON)).toEqual(CANCELS);
  });

  it("another requirement's cancel, whose own run did not finish, fails", () => {
    const both = [...created(), ...created(OTHER)];
    const o1 = [
      ...goTo(),
      ...step(2, both),
      ...step(3, [...finished(), ...cancel(), ...cancel(OTHER), end]),
    ];
    const o2 = [
      ...goTo(),
      ...step(2, both),
      ...step(3, [...finished(), ...cancel2(), end]),
    ];
    expect(left(o1, o2, TC_ON)).toEqual(CANCELS);
  });

  it("a second onResolverCancel naming another resolver fails", () => {
    const named = [
      ...goTo(),
      ...step(2, created()),
      ...step(3, [...finished(), ...cancel(), ...cancel(ID, "b::rb"), end]),
    ];
    expect(left(named, v2, TC_ON)).toContain("missing hook onResolverCancel 3");
  });

  describe("with the trace on, where the hook and observe pairings cross (PR seed 17's sixth case, pr17f)", () => {
    // pr17f's own triggers: pr17d's, with the trace on and a ring of 3.
    const TC_TRACE = [...TC_ON, "traceRing"];
    const run = (chain: string, resolvers: Json[]) =>
      hook("onTraceComplete", [
        {
          causalChain: chain,
          constraintsHit: [],
          derivationsRecomputed: [],
          duration: 1,
          effectErrors: [],
          effectsRun: [],
          factChanges: [],
          id: 1,
          requirementsAdded: [],
          requirementsRemoved: [],
          resolversCompleted: resolvers.map((r) => ({
            ...(r as Record<string, Json>),
            duration: 1,
          })),
          resolversErrored: [],
          resolversStarted: resolvers,
          status: "settled",
          timestamp: 0,
        },
      ]);
    /** A run both engines report, after the cancels. */
    const reported = run("a::f0 changed", []);
    /** Row (bi)'s run, which only 2.0 reports, before the cancels. */
    const evicted = run("b::c0 constraint hit", [
      { meta: { $undefined: true }, requirementId: "B0:{}", resolver: "b::r0" },
    ]);
    const first = cancel();
    const second = cancel();
    const own = cancel2();
    /** pr17d's shape with the trace on: `before` and the cancels in step 3. */
    const traced = (
      before: TraceEntry[],
      cancels: TraceEntry[],
      later: TraceEntry[] = [],
    ) => [
      ...goTo(),
      ...step(2, created()),
      ...step(3, [...before, ...finished(), ...cancels, end, reported]),
      ...step(4, later),
    ];
    const f1 = traced([], [...first, ...second]);
    const f2 = traced([evicted], own);
    const missing = (reference: TraceEntry[], candidate: TraceEntry[]) =>
      markAfterCancel(
        compareContract(reference, candidate, "v2"),
        reference,
        candidate,
      ).filter((d) => d.op === "missing");

    it("control: pr17f's shape is explained, whichever cancel of 1.35's each stream pairs", () => {
      const diffs = missing(f1, f2);
      // The pairings cross: 2.0's cancel hooks pair with 1.35's second
      // cancel (its first cancel's hooks are missing: row t's third path,
      // after met), and 2.0's cancel event pairs with 1.35's first (its
      // second cancel's event is missing).
      expect(diffs.map((d) => [d.kind, d.at.reference, d.afterCancel])).toEqual(
        [
          ["onResolverCancel", f1.indexOf(first[0] as TraceEntry), undefined],
          [
            "onRequirementCanceled",
            f1.indexOf(first[1] as TraceEntry),
            undefined,
          ],
          ["requirement.canceled", f1.indexOf(second[2] as TraceEntry), true],
        ],
      );
      // No point between the two engines' cancels is shared: the last one
      // before 1.35's second cancel event is before 2.0's whole cancel.
      expect((diffs[2] as Difference).shared.candidate).toBeLessThan(
        f2.indexOf(own[0] as TraceEntry),
      );
      expect(left(f1, f2, TC_TRACE)).toEqual([]);
      // The same after a run that failed.
      const failed = (before: TraceEntry[], cancels: TraceEntry[]) => [
        ...goTo(),
        ...step(2, created()),
        ...step(3, [...before, ...errored(), ...cancels, end, reported]),
      ];
      const g1 = failed([], [...cancel(), ...cancel()]);
      const g2 = failed([evicted], cancel2());
      expect(missing(g1, g2).map((d) => [d.kind, d.afterCancel])).toEqual([
        ["onResolverCancel", undefined],
        ["onRequirementCanceled", undefined],
        ["requirement.canceled", true],
      ]);
      expect(left(g1, g2, [...TC_FAILS, "traceRing"])).toEqual([]);
    });

    it("the same with no cancel reported on 2.0 fails", () => {
      const none = traced([evicted], []);
      // 2.0 lacks both cancels. The first is row t's third path (after
      // met); the second stays unexplained, in both streams.
      expect(missing(f1, none).map((d) => d.afterCancel)).toEqual(
        new Array(6).fill(undefined),
      );
      expect(left(f1, none, TC_TRACE)).toEqual(CANCELS);
    });

    it("a cancel 2.0 reports only in a later step fails", () => {
      const late = traced([evicted], [], cancel2());
      const marks = missing(f1, late).map((d) => d.afterCancel);
      expect(marks).toEqual(new Array(6).fill(undefined));
      expect(left(f1, late, TC_TRACE)).toEqual(expect.arrayContaining(CANCELS));
    });

    it("a second cancel on 2.0 fails, whichever of 1.35's three is left", () => {
      const three = traced([], [...cancel(), ...cancel(), ...cancel()]);
      const two = traced([evicted], [...cancel2(), ...cancel2()]);
      expect(missing(three, two).map((d) => d.afterCancel)).toEqual(
        new Array(3).fill(undefined),
      );
    });

    it("without a goTo, or without the trace's run on 2.0 signed, it fails", () => {
      const off = TC_TRACE.filter((t) => !t.startsWith("navigated"));
      expect(left(f1, f2, off)).toContain(
        "missing observe requirement.canceled 3",
      );
      expect(left(f1.slice(2), f2.slice(2), TC_TRACE)).toContain(
        "missing observe requirement.canceled 3",
      );
      // Row (bi)'s run is covered only with a trace ring.
      expect(left(f1, f2, TC_ON)).toEqual(["extra hook onTraceComplete 3"]);
    });
  });

  describe("the mispaired form: another requirement canceled in the same pass, on both engines (PR seed 17's seventh case, pr17g)", () => {
    const B0 = "B0:{}";
    const single = {
      fromConstraint: "b::c0",
      id: B0,
      requirement: { type: "B0" },
    };
    /** A single resolver's cancel of another requirement, the same on both engines. */
    const cancelB = () => [
      hook("onResolverCancel", ["b::r0", single]),
      hook("onRequirementCanceled", [single]),
      observe({ id: B0, type: "requirement.canceled" }),
    ];
    /** pr17g's shape: pr17d's, and both engines then cancel B0. */
    const g1 = caseOf([...finished(), ...cancel(), ...cancel(), ...cancelB()]);
    const g2 = caseOf([...finished(), ...cancel2(), ...cancelB()]);
    /** The pairing of 1.35's second batch cancel with 2.0's B0 cancel. */
    const PAIRED = [
      "changed hook onRequirementCanceled 3 args[0].fromConstraint",
      "changed hook onRequirementCanceled 3 args[0].id",
      "changed hook onRequirementCanceled 3 args[0].requirement",
      "changed hook onResolverCancel 3 args[0]",
      "changed hook onResolverCancel 3 args[1].fromConstraint",
      "changed hook onResolverCancel 3 args[1].id",
      "changed hook onResolverCancel 3 args[1].requirement",
      "changed observe requirement.canceled 3 event.id",
    ];
    // pr17g's own triggers are pr17d's; without writeRetracts row t's third
    // path (l3-cand-t-fuzz-*) no longer takes the unpaired cancel.
    const NO_WR = TC_ON.filter((t) => t !== "writeRetracts");
    const marked = (reference: TraceEntry[], candidate: TraceEntry[]) =>
      markAfterCancel(
        compareContract(reference, candidate, "v2"),
        reference,
        candidate,
      );
    /** As `left`, with the entries that covered any difference. */
    const run = (
      reference: TraceEntry[],
      candidate: TraceEntry[],
      triggers: string[],
    ) => {
      const steps = stepOps(reference);
      const r = explain(
        FUZZ_SCENARIO,
        fileMoves(
          FUZZ_SCENARIO,
          markMispaired(
            markAfterError(
              markAfterMet(marked(reference, candidate), reference, candidate),
              reference,
              candidate,
            ),
            reference,
            candidate,
          ),
          ALL,
          triggers,
          steps,
        ),
        ALL,
        triggers,
        steps,
      );

      return { left: r.unexplained.map(brief).sort(), used: r.used };
    };

    it("each twin is signed on the owner's 2026-11-24 answer, next to his two earlier ones", () => {
      for (const [i, id] of TG_CHANGED.entries()) {
        const d = byId(id);
        const unpaired = byId(TG_UNPAIRED[i] as string);
        expect(d.op).toBe("changed");
        expect(d.afterCancel).toBe(true);
        expect(d.requires).toBeUndefined();
        expect(unpaired.op).toBe("missing");
        expect(unpaired.afterCancel).toBeUndefined();
        expect(unpaired.requires).toEqual({
          stream: d.stream,
          kind: d.kind,
          op: "changed",
          bound: d.bound,
        });
        for (const e of [d, unpaired]) {
          expect(e.approvedBy).toBe("Jason Comes");
          expect(e.date).toBe("2026-11-24");
          expect(e.engine).toBe("v2");
          expect(e.ends).toBeUndefined();
          expect(e.afterMet).toBeUndefined();
          expect(e.afterError).toBeUndefined();
          expect(e.afterOp).toEqual(HISTORY_MOVES);
          expect(e.when).toEqual(["batched", "navigated", "navigatedBusy"]);
          expect(e.group).toBe("quirk-t-batch-second-cancel");
          expect(e.reason).toContain("Signed on the owner's instruction");
          expect(e.reason).toContain(
            '"Extend the exception, not the pairing (Recommended)" (2026-11-24)',
          );
          expect(e.reason).toContain(
            '"2.0\'s single cancel; sign it (Recommended)" (2026-11-23)',
          );
          expect(e.reason).toContain(
            '"Widen to any outcome (Recommended)" (2026-11-23)',
          );
          expect(e.reason).toContain("Row t was owner-approved 2026-11-01");
          expect(e.reason).toContain(
            '"Approve: once (Recommended)" (2026-11-07)',
          );
        }
      }
    });

    it("control: pr17g's shape is explained, the pair by the changed twins", () => {
      const diffs = marked(g1, g2);
      // The comparison does pair 1.35's second batch cancel with 2.0's B0
      // cancel, and leaves 1.35's own B0 cancel unpaired.
      expect(
        diffs
          .filter((d) => d.afterCancel === true)
          .map(brief)
          .sort(),
      ).toEqual(PAIRED);
      const unpaired = diffs.filter((d) => d.op === "missing");
      expect(unpaired.map(brief).sort()).toEqual(CANCELS);
      expect(unpaired.map((d) => canceledId(d.reference))).toEqual([
        B0,
        B0,
        B0,
      ]);
      expect(unpaired.every((d) => d.afterCancel === undefined)).toBe(true);
      const all = run(g1, g2, TC_ON);
      expect(all.left).toEqual([]);
      expect(all.used).toEqual(expect.arrayContaining(TG_CHANGED));
    });

    it("control: the cancel left unpaired is explained by its own twin where row t's third path does not apply", () => {
      const all = run(g1, g2, NO_WR);
      expect(all.left).toEqual([]);
      expect(all.used).toEqual(
        expect.arrayContaining([...TG_CHANGED, ...TG_UNPAIRED]),
      );
    });

    describe("2.0's cancel of the other requirement must equal 1.35's own (the gate PR's review)", () => {
      /** 2.0's B0 cancel, reported with `resolver` and `body` (1.35's are b::r0 and `single`). */
      const cancelBAs = (resolver: string, body: Json) =>
        caseOf([
          ...finished(),
          ...cancel2(),
          hook("onResolverCancel", [resolver, body]),
          hook("onRequirementCanceled", [body]),
          observe({ id: B0, type: "requirement.canceled" }),
        ]);
      const wrongResolver = cancelBAs("b::r1", single);
      const wrongConstraint = cancelBAs("b::r0", {
        ...single,
        fromConstraint: "b::c1",
      });
      const wrongType = cancelBAs("b::r0", {
        ...single,
        requirement: { type: "B1" },
      });
      /** The kinds of the pairs `markAfterCancel` marks. */
      const markedKinds = (candidate: TraceEntry[]) => [
        ...new Set(
          marked(g1, candidate)
            .filter((d) => d.afterCancel === true)
            .map((d) => d.kind),
        ),
      ];

      it("the wrong resolver under the right id fails", () => {
        // Only the onResolverCancel record names the resolver.
        expect(markedKinds(wrongResolver).sort()).toEqual([
          "onRequirementCanceled",
          "requirement.canceled",
        ]);
        expect(run(g1, wrongResolver, NO_WR).left).toEqual(PAIRED.slice(3, 7));
        expect(run(g1, wrongResolver, TC_ON).left).toEqual(PAIRED.slice(3, 7));
        // Without 1.35's extra cancel the same records pair, and fail.
        expect(run(g2, wrongResolver, NO_WR).left).toEqual([
          "changed hook onResolverCancel 3 args[0]",
        ]);
      });

      it("the wrong fromConstraint under the right id fails", () => {
        // Both hooks carry the requirement; the event carries only the id.
        expect(markedKinds(wrongConstraint)).toEqual(["requirement.canceled"]);
        expect(run(g1, wrongConstraint, NO_WR).left).toEqual(
          PAIRED.slice(0, 7),
        );
        expect(run(g1, wrongConstraint, TC_ON).left).toEqual(
          PAIRED.slice(0, 7),
        );
        expect(run(g2, wrongConstraint, NO_WR).left).toEqual([
          "changed hook onRequirementCanceled 3 args[0].fromConstraint",
          "changed hook onResolverCancel 3 args[1].fromConstraint",
        ]);
      });

      it("the wrong requirement.type under the right id fails", () => {
        expect(markedKinds(wrongType)).toEqual(["requirement.canceled"]);
        expect(run(g1, wrongType, NO_WR).left).toEqual(PAIRED.slice(0, 7));
        expect(run(g1, wrongType, TC_ON).left).toEqual(PAIRED.slice(0, 7));
        expect(run(g2, wrongType, NO_WR).left).toEqual([
          "changed hook onRequirementCanceled 3 args[0].requirement.type",
          "changed hook onResolverCancel 3 args[1].requirement.type",
        ]);
      });
    });

    it("2.0 canceling a requirement 1.35 never cancels (a real wrong-request cancel) fails", () => {
      const never = caseOf([...finished(), ...cancel(), ...cancel()]);
      expect(marked(never, g2).some((d) => d.afterCancel === true)).toBe(false);
      expect(run(never, g2, TC_ON).left).toEqual(PAIRED);
      expect(run(never, g2, NO_WR).left).toEqual(PAIRED);
    });

    it("2.0 canceling the other requirement more often than 1.35 fails", () => {
      const twice = caseOf([
        ...finished(),
        ...cancel2(),
        ...cancelB(),
        ...cancelB(),
      ]);
      expect(marked(g1, twice).some((d) => d.afterCancel === true)).toBe(false);
      expect(run(g1, twice, TC_ON).left).toEqual(
        expect.arrayContaining(PAIRED),
      );
    });

    it("the same mispairing with no approved second cancel on 1.35 fails", () => {
      // 1.35's only cancel of the batch run, where 2.0 reported none of it.
      const first1 = caseOf([...finished(), ...cancel(), ...cancelB()]);
      const first2 = caseOf([...finished(), ...cancelB()]);
      expect(marked(first1, first2).some((d) => d.afterCancel === true)).toBe(
        false,
      );
      // With row t's batch-completed triggers (writeRetracts, batched) this
      // is that row's shape, mispaired: pr17h. It has no second cancel, but
      // an approved extra cancel all the same, so the shared rule (the
      // owner's 2026-11-26 answer) explains it, where it failed before that
      // answer. Without that row's trigger it fails as it did.
      const completed = run(first1, first2, TC_ON);
      expect(completed.left).toEqual([]);
      expect(completed.used).toEqual(expect.arrayContaining(TM_CHANGED));
      expect(completed.used.some((id) => TG_CHANGED.includes(id))).toBe(false);
      expect(run(first1, first2, NO_WR).left).toEqual(PAIRED);
      // Two cancels on 1.35, one on 2.0, of a run with no outcome reported.
      const flight1 = caseOf([...cancel(), ...cancel(), ...cancelB()]);
      const flight2 = caseOf([...cancel2(), ...cancelB()]);
      expect(marked(flight1, flight2).some((d) => d.afterCancel === true)).toBe(
        false,
      );
      expect(run(flight1, flight2, TC_ON).left).toEqual(PAIRED);
      // Two cancels on 1.35 of a finished run that 2.0 never canceled. The
      // first is row t's batch-completed cancel, mispaired, which the shared
      // rule now explains (as above); the second, with no cancel of the run
      // on 2.0, still fails.
      const none = run(g1, first2, TC_ON).left;
      expect(none).toEqual(CANCELS);
      expect(run(g1, first2, NO_WR).left).toEqual(
        expect.arrayContaining(PAIRED),
      );
    });

    it("without a history move it fails", () => {
      // Held a back step as failing before the owner's "Any history move
      // (Recommended)" (2026-11-26); a step that is no move still fails.
      const replay = (trace: TraceEntry[]) => moved(trace, { op: "replay" });
      expect(run(replay(g1), replay(g2), TC_ON).left).toEqual(PAIRED);
      expect(run(replay(g1), replay(g2), NO_WR).left).toEqual(
        [...PAIRED, ...CANCELS].sort(),
      );
      const none = (trace: TraceEntry[]) => trace.slice(goTo().length);
      expect(run(none(g1), none(g2), TC_ON).left).toEqual(PAIRED);
    });

    it("after a back or a forward step it is explained, as after a goTo (the owner's 2026-11-26 answer)", () => {
      for (const op of [
        { op: "back" },
        { op: "forward", steps: 1 },
      ] as Json[]) {
        expect(run(moved(g1, op), moved(g2, op), TC_ON).left).toEqual([]);
        const all = run(moved(g1, op), moved(g2, op), NO_WR);
        expect(all.left).toEqual([]);
        expect(all.used).toEqual(
          expect.arrayContaining([...TG_CHANGED, ...TG_UNPAIRED]),
        );
      }
    });

    it("the changed twins admit only a batch id-only record paired with a single resolver's, and only when marked", () => {
      const asJson = (e: TraceEntry | undefined) => e as unknown as Json;
      const only = (over: Partial<Difference>) =>
        explain(
          FUZZ_SCENARIO,
          [
            diff(40, {
              stream: "hook",
              kind: "onResolverCancel",
              op: "changed",
              step: 3,
              path: "args[1].id",
              reference: ID,
              candidate: B0,
              record: asJson(cancel()[0]),
              candidateRecord: asJson(cancelB()[0]),
              afterCancel: true,
              ...over,
            }),
          ],
          TG_CHANGED.map(byId),
          TC_ON,
          stepOps(g1),
        ).unexplained.length;
      expect(only({})).toBe(0);
      expect(only({ afterCancel: undefined })).toBe(1);
      // Between two batch requirements: not these entries'.
      expect(
        only({ candidate: OTHER, candidateRecord: asJson(cancel2(OTHER)[0]) }),
      ).toBe(1);
      // 1.35's record in the whole-requirement shape: not its id-only cancel.
      expect(only({ record: asJson(cancel2()[0]) })).toBe(1);
      // The other way round: 2.0's batch cancel against 1.35's single one.
      expect(
        only({
          reference: B0,
          candidate: ID,
          record: asJson(cancelB()[0]),
          candidateRecord: asJson(cancel()[0]),
        }),
      ).toBe(1);
      // Without a navigation that can run while work is in flight.
      expect(
        explain(
          FUZZ_SCENARIO,
          marked(g1, g2),
          TG_CHANGED.map(byId),
          TC_ON.filter((t) => t !== "navigatedBusy"),
          stepOps(g1),
        )
          .unexplained.filter((d) => d.op === "changed")
          .map(brief)
          .sort(),
      ).toEqual(expect.arrayContaining(PAIRED));
    });

    it("the unpaired twin alone never excuses a single resolver's cancel 2.0 lacks", () => {
      // 1.35 cancels the batch run once, as 2.0 does, and B0; 2.0 does not cancel B0.
      const lacks1 = caseOf([...finished(), ...cancel(), ...cancelB()]);
      const lacks2 = caseOf([...finished(), ...cancel2()]);
      expect(run(lacks1, lacks2, NO_WR).left).toEqual(CANCELS);
    });
  });

  it("markAfterCancel marks only a missing cancel record; the other markers leave it", () => {
    const all = markAfterError(
      markAfterMet(compareContract(v1, v2, "v2"), v1, v2),
      v1,
      v2,
    );
    expect(
      all.every((d) => d.afterMet === undefined && d.afterError === undefined),
    ).toBe(true);
    // The other way round (2.0 cancels twice, 1.35 once) is an extra: unmarked.
    const extra = markAfterCancel(compareContract(v2, v1, "v2"), v2, v1);
    expect(extra.every((d) => d.afterCancel === undefined)).toBe(true);
    expect(left(v2, v1, TC_ON)).not.toEqual([]);
  });
});

describe("row (bx)'s compute pairing (PR seed 11, deep seed 24301), and no other", () => {
  const record = (id: string, value: Json) => ({
    k: "hook",
    hook: "onDerivationCompute",
    args: [id, value, ["a::f0"]],
  });
  /** 1.35's one compute (false) paired with 2.0's first (true). */
  const pairing = diff(13, {
    stream: "hook",
    kind: "onDerivationCompute",
    op: "changed",
    path: "args[1]",
    reference: false,
    candidate: true,
    record: record("a::d0", false),
  });
  /** 2.0's second compute, unpaired, of a derivation 1.35 has not computed. */
  const second = (id = "a::d0", value: Json = false) =>
    diff(20, {
      stream: "hook",
      kind: "onDerivationCompute",
      op: "extra",
      stale: true,
      candidate: record(id, value),
    });

  it("each entry needs 2.0's unpaired copy of 1.35's whole record", () => {
    for (const id of BX_IDS.slice(0, 4)) {
      const d = byId(id);
      expect(d.requires?.op).toBe("extra");
      expect(d.requires?.same).toBe(d.stream === "hook" ? "args" : "event");
    }
  });

  it("control: 2.0's second compute is 1.35's record, so the pairing is excused", () => {
    const r = judge([pairing, second()], ON);
    expect(r.left).toEqual([]);
    expect(r.used).toContain(
      "l12-fuzz-bx-hook-onDerivationCompute-repaired-changed",
    );
  });

  it("without a fact-including watch the same records fail", () => {
    expect(judge([pairing, second()], NO_FACTS).left).toHaveLength(2);
    expect(judge([pairing, second()], []).left).toHaveLength(2);
  });

  it("an extra compute of another derivation, or with another value, does not excuse it", () => {
    const changed = ["changed hook onDerivationCompute 1 args[1]"];
    expect(judge([pairing, second("a::d1")], ON).left).toEqual(changed);
    expect(judge([pairing, second("a::d0", true)], ON).left).toEqual(changed);
    expect(judge([pairing], ON).left).toEqual(changed);
  });

  it("a changed value of anything but a snapshot derivation's compute fails", () => {
    const other = {
      ...pairing,
      record: record("a::x0", false),
    } as Difference;
    expect(
      judge(
        [
          other,
          diff(20, {
            stream: "hook",
            kind: "onDerivationCompute",
            op: "extra",
            stale: true,
            candidate: record("a::x0", false),
          }),
        ],
        ON,
      ).left,
    ).toContain("changed hook onDerivationCompute 1 args[1]");
  });
});

describe("row (bx)'s compute inside a trace run (deep seed 1), and no other", () => {
  const LINK = " → ";
  const entry = (id: string) => ({
    deps: ["a::f0"],
    id,
    meta: { $undefined: true },
    newValue: false,
    oldValue: true,
  });
  const run = (recomputed: Json[], chain: string[], status = "settled") => ({
    causalChain: chain.join(LINK),
    constraintsHit: [{ deps: ["a::f0"], id: "a::c0", priority: 3 }],
    derivationsRecomputed: recomputed,
    factChanges: [{ key: "a::f0", newValue: 4, oldValue: 0 }],
    status,
  });
  const hook = (r: Json) =>
    ({ k: "hook", hook: "onTraceComplete", args: [r] }) as TraceEntry;
  const state = (label: string, runs: Json[]) =>
    ({ k: "state", label, inspect: { trace: runs } }) as unknown as Json;
  const base = run([], ["a::f0 changed", "a::c0 constraint hit"]);
  const inserted = run(
    [entry("a::d0")],
    ["a::f0 changed", "a::d0 recomputed", "a::c0 constraint hit"],
  );
  const watch = {
    k: "external",
    data: ["watch", { createdAt: 0, data: { d0: false, f0: 4 }, version: "v" }],
  } as TraceEntry;
  const pair = PAIR.traceRunRecomputeInserted as (
    r: Json | undefined,
    c: Json | undefined,
  ) => boolean;

  it("control: one snapshot derivation's compute inserted, after an extra watch, is excused", () => {
    const v1 = step(3, [hook(base)]);
    const v2 = step(3, [watch, hook(inserted)]);
    expect(left(v1, v2, ON)).toEqual([]);
  });

  it("without a fact-including watch the same records fail", () => {
    const v1 = step(3, [hook(base)]);
    const v2 = step(3, [watch, hook(inserted)]);
    expect(left(v1, v2, NO_FACTS).length).toBeGreaterThanOrEqual(2);
    expect(left(v1, v2, []).length).toBeGreaterThanOrEqual(2);
  });

  it("without 2.0's extra watch snapshot before it, it fails", () => {
    expect(left(step(3, [hook(base)]), step(3, [hook(inserted)]), ON)).toEqual([
      "changed hook onTraceComplete 3 args[0].causalChain",
      "changed hook onTraceComplete 3 args[0].derivationsRecomputed[0]",
    ]);
  });

  it("the pair class admits only inserted snapshot-derivation computes", () => {
    expect(pair(hook(base), hook(inserted))).toBe(true);
    // A state record's runs: one equal, one with an insert.
    expect(
      pair(state("settle", [base, base]), state("settle", [base, inserted])),
    ).toBe(true);
    // An existing entry kept in order, one inserted after it.
    const two = run(
      [entry("a::d1"), entry("a::d0")],
      ["a::f0 changed", "a::d1 recomputed", "a::d0 recomputed"],
    );
    const one = run([entry("a::d1")], ["a::f0 changed", "a::d1 recomputed"]);
    expect(pair(hook(one), hook(two))).toBe(true);
    // Nothing inserted, an entry removed, or the insert on 1.35's side.
    expect(pair(hook(base), hook(base))).toBe(false);
    expect(pair(hook(inserted), hook(base))).toBe(false);
    expect(pair(hook(two), hook(one))).toBe(false);
    // Another field of the run changed too.
    expect(
      pair(
        hook(base),
        hook(
          run([entry("a::d0")], inserted.causalChain.split(LINK), "aborted"),
        ),
      ),
    ).toBe(false);
    // Not a derivation a snapshot can hold.
    expect(
      pair(
        hook(base),
        hook(
          run(
            [entry("a::zin")],
            ["a::f0 changed", "a::zin recomputed", "a::c0 constraint hit"],
          ),
        ),
      ),
    ).toBe(false);
    // The entry without its chain link, or the chain with another link.
    expect(
      pair(
        hook(base),
        hook(run([entry("a::d0")], base.causalChain.split(LINK))),
      ),
    ).toBe(false);
    expect(
      pair(
        hook(base),
        hook(
          run(
            [entry("a::d0")],
            [
              "a::f0 changed",
              "a::d0 recomputed",
              "a::c0 constraint hit",
              "a::r0 resolved (Nms)",
            ],
          ),
        ),
      ),
    ).toBe(false);
    // An existing entry changed, not only one inserted.
    expect(
      pair(
        hook(one),
        hook(
          run(
            [{ ...entry("a::d1"), newValue: true }, entry("a::d0")],
            ["a::f0 changed", "a::d1 recomputed", "a::d0 recomputed"],
          ),
        ),
      ),
    ).toBe(false);
    // A different number of runs, or records that hold no runs.
    expect(pair(state("end", [base]), state("end", [base, inserted]))).toBe(
      false,
    );
    expect(
      pair({ k: "hook", hook: "onStart", args: [base] }, hook(inserted)),
    ).toBe(false);
    expect(pair(undefined, hook(inserted))).toBe(false);
  });
});

describe("row (bx)'s unknown-key warning and re-registered derivation (deep seed 2)", () => {
  const text = (v: string) =>
    (TEXT.distributableUnknownKeys as (v: Json) => boolean)(v);
  const warn = (message: string) =>
    ({ k: "console", level: "warn", args: [message] }) as TraceEntry;
  const WARNING =
    "[Directive] getDistributableSnapshot: Unknown derivation keys ignored: d0. Available: d1";
  const compute = (id = "d0", value: Json = 0): TraceEntry[] =>
    [
      { k: "hook", hook: "onDerivationCompute", args: [id, value, ["f0"]] },
      { k: "observe", event: { id, type: "derivation.compute", value } },
    ] as TraceEntry[];
  const register = (id = "d0", kind = "derivation") =>
    ({
      k: "hook",
      hook: "onDefinitionRegister",
      args: [kind, id, { $fn: true }],
    }) as TraceEntry;

  it("the text class is the warning word for word", () => {
    expect(text(WARNING)).toBe(true);
    expect(
      text(
        "[Directive] getDistributableSnapshot: Unknown derivation keys ignored: a::d0, z::h0. Available: (none)",
      ),
    ).toBe(true);
    expect(
      text(
        "[Directive] getDistributableSnapshot: Unknown derivation keys ignored: d0. Available: a::d1, z0, zin, h0",
      ),
    ).toBe(true);
    expect(text(`${WARNING} and more`)).toBe(false);
    expect(text(WARNING.replace("d0.", "f0."))).toBe(false);
    expect(text(WARNING.replace("Available: d1", "Available: f1"))).toBe(false);
    expect(text(WARNING.replace("Unknown derivation", "Unknown fact"))).toBe(
      false,
    );
    expect(text(WARNING.replace("getDistributableSnapshot", "watch"))).toBe(
      false,
    );
  });

  it("control: the warning extra on 2.0, with a fact-including watch, is excused", () => {
    expect(left(step(11, []), step(11, [warn(WARNING)]), ON)).toEqual([]);
  });

  it("without a fact-including watch, or with another warning, it fails", () => {
    const failed = ["extra console warn 11"];
    expect(left(step(11, []), step(11, [warn(WARNING)]), NO_FACTS)).toEqual(
      failed,
    );
    expect(left(step(11, []), step(11, [warn(WARNING)]), [])).toEqual(failed);
    expect(
      left(step(11, []), step(11, [warn(`${WARNING} and more`)]), ON),
    ).toEqual(failed);
  });

  it("control: a derivation registered again reads as never computed, so 2.0's compute of it is excused", () => {
    const v1 = [
      ...step(1, compute()),
      ...step(14, [register()]),
      ...step(15, []),
    ];
    const v2 = [
      ...step(1, compute()),
      ...step(14, [register()]),
      ...step(15, compute()),
    ];
    expect(left(v1, v2, ON)).toEqual([]);
    expect(left(v1, v2, NO_FACTS)).toHaveLength(2);
  });

  it("a derivation that computed and was not registered again still fails", () => {
    const failed = [
      "extra hook onDerivationCompute 15",
      "extra observe derivation.compute 15",
    ];
    const head = step(1, compute());
    expect(
      left(
        [...head, ...step(14, []), ...step(15, [])],
        [...head, ...step(14, []), ...step(15, compute())],
        ON,
      ),
    ).toEqual(failed);
    // Another derivation's register, or another kind's of the same id.
    for (const other of [register("d1"), register("d0", "constraint")]) {
      expect(
        left(
          [...head, ...step(14, [other]), ...step(15, [])],
          [...head, ...step(14, [other]), ...step(15, compute())],
          ON,
        ),
      ).toEqual(failed);
    }
    // Registered, then computed on 1.35: fresh again.
    expect(
      left(
        [...head, ...step(14, [register(), ...compute()]), ...step(15, [])],
        [
          ...head,
          ...step(14, [register(), ...compute()]),
          ...step(15, compute()),
        ],
        ON,
      ),
    ).toEqual(failed);
  });
});

describe("row t's shared mispairing rule: an approved extra cancel paired with 2.0's cancel of another requirement both engines cancel (PR seed 17's eighth case, pr17h)", () => {
  // pr17h's own triggers.
  const TH_ON = ["settleStop", "writeRetracts", "batched", "ignoresAbort"];
  const AB = 'AB:{"item":"0.0"}';
  const AB1 = 'AB:{"item":"0.1"}';
  const A0 = "A0:{}";
  const hook = (name: string, args: Json[]) =>
    ({ k: "hook", hook: name, args }) as TraceEntry;
  const observe = (event: Json) => ({ k: "observe", event }) as TraceEntry;
  const batch = (id: string) => ({
    fromConstraint: "a::b0",
    id,
    requirement: { item: id === AB ? "0.0" : "0.1", type: "AB" },
  });
  const single = (n: number) => ({
    fromConstraint: `a::c${n}`,
    id: `A${n}:{}`,
    requirement: { type: `A${n}` },
  });
  const created = [
    hook("onRequirementCreated", [batch(AB)]),
    observe({ id: AB, requirementType: "AB", type: "requirement.created" }),
  ];
  /** The batch run finished: its completion, then its met, on both engines. */
  const finished = () => [
    hook("onResolverComplete", ["a::rb", batch(AB), 5]),
    observe({
      duration: 5,
      requirementId: AB,
      resolver: "a::rb",
      type: "resolver.complete",
    }),
    hook("onRequirementMet", [batch(AB), "a::rb"]),
    observe({ byResolver: "a::rb", id: AB, type: "requirement.met" }),
  ];
  const failure = { $error: { name: "Error", message: "a.rb 0.0 attempt 1" } };
  /** The batch run failed: its error, on both engines. */
  const errored = () => [
    hook("onResolverError", ["a::rb", batch(AB), failure]),
    observe({
      error: failure,
      requirementId: AB,
      resolver: "a::rb",
      type: "resolver.error",
    }),
  ];
  /** 1.35's cancel of the batch requirement, carrying only the id (row (aq)). */
  const cancelId = () => [
    hook("onResolverCancel", ["a::rb", { id: AB }]),
    hook("onRequirementCanceled", [{ id: AB }]),
    observe({ id: AB, type: "requirement.canceled" }),
  ];
  /** A batch requirement's cancel carrying the whole requirement, the same on both engines. */
  const cancelBatch = (id: string) => [
    hook("onResolverCancel", ["a::rb", batch(id)]),
    hook("onRequirementCanceled", [batch(id)]),
    observe({ id, type: "requirement.canceled" }),
  ];
  /** A single resolver's cancel, the same on both engines. */
  const cancelSingle = (n = 0) => [
    hook("onResolverCancel", [`a::r${n}`, single(n)]),
    hook("onRequirementCanceled", [single(n)]),
    observe({ id: `A${n}:{}`, type: "requirement.canceled" }),
  ];
  /** A case of two steps: the batch requirement created, then `records`. */
  const caseOf = (records: TraceEntry[]) => [
    ...step(1, created),
    ...step(2, records),
  ];
  /** Every marker, as runScenario applies them. */
  const marked = (reference: TraceEntry[], candidate: TraceEntry[]) =>
    markMispaired(
      markAfterCancel(
        markAfterError(
          markAfterMet(
            markStale(compareContract(reference, candidate, "v2"), reference),
            reference,
            candidate,
          ),
          reference,
          candidate,
        ),
        reference,
        candidate,
      ),
      reference,
      candidate,
    );
  /** What is left unexplained, and the entries that covered any difference. */
  const run = (
    reference: TraceEntry[],
    candidate: TraceEntry[],
    triggers: string[],
    entries = ALL,
  ) => {
    const steps = stepOps(reference);
    const r = explain(
      FUZZ_SCENARIO,
      fileMoves(
        FUZZ_SCENARIO,
        marked(reference, candidate),
        entries,
        triggers,
        steps,
      ),
      entries,
      triggers,
      steps,
    );

    return { left: r.unexplained.map(brief).sort(), used: [...r.used].sort() };
  };
  /** The pairing of 1.35's extra batch cancel with 2.0's cancel of A0. */
  const PAIRED = [
    "changed hook onRequirementCanceled 2 args[0].fromConstraint",
    "changed hook onRequirementCanceled 2 args[0].id",
    "changed hook onRequirementCanceled 2 args[0].requirement",
    "changed hook onResolverCancel 2 args[0]",
    "changed hook onResolverCancel 2 args[1].fromConstraint",
    "changed hook onResolverCancel 2 args[1].id",
    "changed hook onResolverCancel 2 args[1].requirement",
    "changed observe requirement.canceled 2 event.id",
  ];
  const CANCELS = [
    "missing hook onRequirementCanceled 2",
    "missing hook onResolverCancel 2",
    "missing observe requirement.canceled 2",
  ];
  /**
   * pr17h's shape: the batch run finished on both engines; both cancel A0
   * once, and 1.35 also cancels the met batch requirement.
   */
  const h1 = caseOf([...finished(), ...cancelId(), ...cancelSingle()]);
  const h2 = caseOf([...finished(), ...cancelSingle()]);
  /** The same with 1.35's two cancels in pr17h's own order. */
  const hr1 = caseOf([...finished(), ...cancelSingle(), ...cancelId()]);

  it("each entry is signed on the owner's 2026-11-26 answer, next to each listed row's own approval", () => {
    for (const [i, id] of TM_CHANGED.entries()) {
      const slug = TM_SLUGS[i] as string;
      const d = byId(id);
      const unpaired = byId(TM_UNPAIRED[i] as string);
      expect(d.op).toBe("changed");
      expect(d.extraCancelOf).toEqual([
        `l3-cand-t-fuzz-${slug}-missing`,
        `l9-fuzz-t-disable-${slug}-missing`,
        `l12-cand-t-batch-completed-${slug}-missing`,
        `l12-cand-t-batch-error-${slug}-missing`,
        `l12-cand-t-batch-second-cancel-${slug}-missing`,
      ]);
      for (const listed of d.extraCancelOf ?? []) {
        const row = byId(listed);
        expect([row.op, row.stream, row.kind, row.engine]).toEqual([
          "missing",
          d.stream,
          d.kind,
          "v2",
        ]);
        expect(row.requires).toBeUndefined();
        expect(row.mispaired).toBeUndefined();
      }
      expect(d.bound).toEqual({
        match: [{ path: d.path, pair: "cancelOfAnother" }],
      });
      expect(d.mispairedBy).toBeUndefined();
      expect(unpaired.op).toBe("missing");
      expect(unpaired.extraCancelOf).toBeUndefined();
      expect(unpaired.mispairedBy).toEqual([id]);
      for (const e of [d, unpaired]) {
        expect(e.mispaired).toBe(true);
        expect(e.approvedBy).toBe("Jason Comes");
        expect(e.date).toBe("2026-11-26");
        expect(e.engine).toBe("v2");
        expect(e.group).toBe("quirk-t-mispaired-cancel");
        expect(e.ends).toBeUndefined();
        expect(e.when).toBeUndefined();
        expect(e.requires).toBeUndefined();
        expect(e.afterOp).toBeUndefined();
        expect(e.afterMet).toBeUndefined();
        expect(e.afterError).toBeUndefined();
        expect(e.afterCancel).toBeUndefined();
        expect(e.reason).toContain("Signed on the owner's instruction");
        for (const quoted of [
          '"Apply it to all row t cancels (Recommended)" (2026-11-26)',
          '"Extend the exception, not the pairing (Recommended)"',
          "owner-approved 2026-11-01",
          '"If all are better or non user facing they are all approved"',
          '"Yes, run 5 (Recommended)" (2026-11-22)',
          '"2.0\'s single cancel; sign it (Recommended)" (2026-11-23)',
          '"Widen to any outcome (Recommended)" (2026-11-23)',
        ]) {
          expect(e.reason).toContain(quoted);
        }
      }
    }
  });

  it("the rule lists every row t fuzz entry for a cancel only 1.35 makes", () => {
    const rows = ALL.filter(
      (e) =>
        e.scenario === FUZZ_SCENARIO &&
        /^l\d+-(cand|fuzz)-t-/.test(e.id) &&
        e.op === "missing" &&
        e.requires === undefined &&
        e.mispaired === undefined,
    ).map((e) => e.id);
    expect(rows.length).toBe(15);
    expect(
      TM_CHANGED.flatMap((id) => byId(id).extraCancelOf ?? []).sort(),
    ).toEqual([...rows].sort());
  });

  it("control: pr17h's shape is explained, the pair by the shared rule through row t's batch-completed entries", () => {
    const diffs = marked(h1, h2);
    const pair = diffs.filter((d) => d.op === "changed");
    expect(pair.map(brief).sort()).toEqual(PAIRED);
    expect(pair.every((d) => d.mispaired === true && d.afterMet === true)).toBe(
      true,
    );
    expect(
      pair.every(
        (d) => d.afterError === undefined && d.afterCancel === undefined,
      ),
    ).toBe(true);
    // 1.35's own cancel of A0 is left unpaired, and marked as that.
    const unpaired = diffs.filter((d) => d.op === "missing");
    expect(unpaired.map(brief).sort()).toEqual(CANCELS);
    expect(unpaired.map((d) => canceledId(d.reference))).toEqual([A0, A0, A0]);
    expect(
      unpaired.every((d) => d.mispaired === true && d.afterMet === undefined),
    ).toBe(true);
    const all = run(h1, h2, TH_ON);
    expect(all.left).toEqual([]);
    expect(all.used).toEqual(expect.arrayContaining(TM_CHANGED));
    // As in pr17h itself, row t's first entries take the unpaired cancel.
    expect(all.used).toEqual(expect.arrayContaining(L3_MISSING));
    expect(all.used.some((id) => TM_UNPAIRED.includes(id))).toBe(false);
    // 1.35's two cancels in pr17h's own order: explained either way.
    expect(run(hr1, h2, TH_ON).left).toEqual([]);
  });

  it("control: the cancel left unpaired is explained by its own twin where no earlier entry takes it", () => {
    // The other requirement is a batch requirement, which l3-cand-t-fuzz-* never names.
    const k1 = caseOf([...finished(), ...cancelId(), ...cancelBatch(AB1)]);
    const k2 = caseOf([...finished(), ...cancelBatch(AB1)]);
    const all = run(k1, k2, TH_ON);
    expect(all.left).toEqual([]);
    // Row (aq)'s entries take the hook pairs first (an id-only requirement
    // against a whole one); the observe pair and the unpaired cancel are the rule's.
    expect(all.used).toEqual(
      expect.arrayContaining([TM_CHANGED[2], ...TM_UNPAIRED]),
    );
    // The unpaired cancel is excused only where its pair is.
    const NO_WR = TH_ON.filter((t) => t !== "writeRetracts");
    expect(run(k1, k2, NO_WR).left).toEqual(
      expect.arrayContaining([...CANCELS, PAIRED[7]]),
    );
  });

  describe("2.0's cancel of the other requirement must equal 1.35's own (the gate PR's review)", () => {
    /** 2.0's A0 cancel, reported with `resolver` and `body` (1.35's are a::r0 and `single(0)`). */
    const cancelA0As = (resolver: string, body: Json) =>
      caseOf([
        ...finished(),
        hook("onResolverCancel", [resolver, body]),
        hook("onRequirementCanceled", [body]),
        observe({ id: A0, type: "requirement.canceled" }),
      ]);
    const wrongResolver = cancelA0As("a::r1", single(0));
    const wrongConstraint = cancelA0As("a::r0", {
      ...single(0),
      fromConstraint: "a::c1",
    });
    const wrongType = cancelA0As("a::r0", {
      ...single(0),
      requirement: { type: "A1" },
    });
    // Row t's own L3 entries for a changed cancel need writeRetracts.
    const NO_WR = TH_ON.filter((t) => t !== "writeRetracts");
    const L3_CHANGED = [
      "l3-cand-t-fuzz-hook-onRequirementCanceled-changed",
      "l3-cand-t-fuzz-hook-onResolverCancel-changed",
    ];
    /** The kinds `markMispaired` marks, by op. */
    const mispairedKinds = (candidate: TraceEntry[], op: string) => [
      ...new Set(
        marked(h1, candidate)
          .filter((d) => d.op === op && d.mispaired === true)
          .map((d) => d.kind),
      ),
    ];

    it("the wrong resolver under the right id fails", () => {
      // Neither the pair nor 1.35's own unpaired A0 record is in the form.
      for (const op of ["changed", "missing"]) {
        expect(mispairedKinds(wrongResolver, op).sort()).toEqual([
          "onRequirementCanceled",
          "requirement.canceled",
        ]);
      }
      expect(run(h1, wrongResolver, TH_ON).left).toEqual(PAIRED.slice(3, 7));
      // Without 1.35's extra cancel the same records pair, and fail.
      expect(run(h2, wrongResolver, NO_WR).left).toEqual([
        "changed hook onResolverCancel 2 args[0]",
      ]);
    });

    it("the form borrows no other entry: equal means no difference, not an approved one", () => {
      // Paired with each other (no extra cancel, or 1.35's own order, where
      // the alignment pairs the two A0 cancels), the two A0 records differ
      // only by what row t's L3 entries approve after a retracting write.
      // The mispaired form does not read those entries: with the same
      // triggers the wrong record under it fails (the tests around this one).
      for (const [reference, candidate] of [
        [h2, wrongResolver],
        [hr1, wrongResolver],
        [h2, wrongConstraint],
        [h2, wrongType],
      ] as const) {
        const direct = run(reference, candidate, TH_ON);
        expect(direct.left).toEqual([]);
        expect(direct.used.some((id) => L3_CHANGED.includes(id))).toBe(true);
        expect(direct.used.some((id) => TM_CHANGED.includes(id))).toBe(false);
      }
    });

    it("the wrong fromConstraint under the right id fails", () => {
      for (const op of ["changed", "missing"]) {
        expect(mispairedKinds(wrongConstraint, op)).toEqual([
          "requirement.canceled",
        ]);
      }
      expect(run(h1, wrongConstraint, TH_ON).left).toEqual(PAIRED.slice(0, 7));
      expect(run(h2, wrongConstraint, NO_WR).left).toEqual([
        "changed hook onRequirementCanceled 2 args[0].fromConstraint",
        "changed hook onResolverCancel 2 args[1].fromConstraint",
      ]);
    });

    it("the wrong requirement.type under the right id fails", () => {
      for (const op of ["changed", "missing"]) {
        expect(mispairedKinds(wrongType, op)).toEqual(["requirement.canceled"]);
      }
      expect(run(h1, wrongType, TH_ON).left).toEqual(PAIRED.slice(0, 7));
      expect(run(h2, wrongType, NO_WR).left).toEqual([
        "changed hook onRequirementCanceled 2 args[0].requirement.type",
        "changed hook onResolverCancel 2 args[1].requirement.type",
      ]);
    });

    it("equal means no difference as the comparison compares a pair", () => {
      const own = hook("onResolverCancel", ["a::r0", single(0)]) as Json;
      expect(sameAsCompared(own, structuredClone(own))).toBe(true);
      expect(
        sameAsCompared(
          own,
          hook("onResolverCancel", ["a::r1", single(0)]) as Json,
        ),
      ).toBe(false);
      expect(sameAsCompared(own, undefined)).toBe(false);
      expect(sameAsCompared(undefined, undefined)).toBe(false);
    });

    it("each unpaired record of 1.35's stands for one pair only", () => {
      // 1.35 cancels A0 twice, once by a::r0 and once by a::r1; 2.0 twice by
      // a::r0. Two pairs took 2.0's cancels: only one has 1.35's own record.
      const extra = hook("onResolverCancel", ["a::rb", { id: AB }]);
      const good = hook("onResolverCancel", ["a::r0", single(0)]);
      const other = hook("onResolverCancel", ["a::r1", single(0)]);
      const trace = (records: TraceEntry[]) =>
        [{ k: "step", i: 1 }, { k: "async" }, ...records] as TraceEntry[];
      const pair = (n: number) =>
        diff(n, {
          stream: "hook",
          kind: "onResolverCancel",
          op: "changed",
          path: "args[0]",
          record: extra as Json,
          candidateRecord: good as Json,
        });
      const unpaired = (n: number, reference: TraceEntry) =>
        diff(n, {
          stream: "hook",
          kind: "onResolverCancel",
          op: "missing",
          reference: reference as Json,
        });
      const diffs = [
        pair(10),
        pair(10),
        pair(11),
        unpaired(12, good),
        unpaired(13, other),
      ];
      const form = mispairedForm(
        diffs,
        trace([extra, extra, good, other]),
        trace([good, good]),
      );
      // The first pair, in both its differences, and the record it took.
      expect([...form.keys()]).toEqual([diffs[0], diffs[1]]);
      expect([...new Set(form.values())]).toEqual([diffs[3]]);
      // With 1.35's second cancel by a::r0 too, both pairs are in the form.
      const both = [...diffs.slice(0, 4), unpaired(13, good)];
      const formBoth = mispairedForm(
        both,
        trace([extra, extra, good, good]),
        trace([good, good]),
      );
      expect([...formBoth.keys()]).toEqual(both.slice(0, 3));
      expect([...new Set(formBoth.values())]).toEqual(both.slice(3));
    });

    it("the unpaired twin covers only the record its pair's 2.0 record equals", () => {
      // The other requirement is a batch requirement (no earlier entry takes it).
      const k1 = caseOf([...finished(), ...cancelId(), ...cancelBatch(AB1)]);
      const k2 = caseOf([...finished(), ...cancelBatch(AB1)]);
      const diffs = marked(k1, k2);
      const steps = stepOps(k1);
      const twin = byId(TM_UNPAIRED[0] as string);
      const own = diffs.find(
        (d) => d.op === "missing" && d.kind === "onResolverCancel",
      ) as Difference;
      expect(own.mispaired).toBe(true);
      expect(covers(twin, FUZZ_SCENARIO, own, TH_ON, steps, diffs, ALL)).toBe(
        true,
      );
      // The same record by another batch resolver: inside the twin's bound
      // and marked, but not the record the pair's 2.0 half equals.
      const forged = {
        ...own,
        reference: hook("onResolverCancel", ["b::rb", batch(AB1)]) as Json,
      };
      expect(admits(twin.bound as never, forged)).toBe(true);
      expect(
        covers(
          twin,
          FUZZ_SCENARIO,
          forged,
          TH_ON,
          steps,
          diffs.map((d) => (d === own ? forged : d)),
          ALL,
        ),
      ).toBe(false);
    });
  });

  it("a wrong-request cancel on 2.0 still fails", () => {
    // 2.0 cancels A0, which 1.35 never cancels.
    const never = caseOf([...finished(), ...cancelId()]);
    expect(marked(never, h2).some((d) => d.mispaired === true)).toBe(false);
    expect(run(never, h2, TH_ON).left).toEqual(PAIRED);
    // 2.0 cancels A0 more often than 1.35 does.
    const twice = caseOf([...finished(), ...cancelSingle(), ...cancelSingle()]);
    expect(marked(h1, twice).some((d) => d.mispaired === true)).toBe(false);
    expect(run(h1, twice, TH_ON).left).toEqual(expect.arrayContaining(PAIRED));
  });

  it("a mispairing without an approved extra cancel still fails", () => {
    // The batch run still in flight: no row t entry approves 1.35's cancel.
    const flight1 = caseOf([...cancelId(), ...cancelSingle()]);
    const flight2 = caseOf([...cancelSingle()]);
    const flight = marked(flight1, flight2).filter((d) => d.op === "changed");
    expect(flight.map(brief).sort()).toEqual(PAIRED);
    expect(flight.every((d) => d.mispaired === true)).toBe(true);
    expect(
      flight.every(
        (d) =>
          d.afterMet === undefined &&
          d.afterError === undefined &&
          d.afterCancel === undefined,
      ),
    ).toBe(true);
    expect(run(flight1, flight2, TH_ON).left).toEqual(PAIRED);
    // pr17h's shape in a case without the batch-completed row's trigger.
    const NO_WR = TH_ON.filter((t) => t !== "writeRetracts");
    const BOTH = [...PAIRED, ...CANCELS].sort();
    expect(run(h1, h2, NO_WR).left).toEqual(BOTH);
    expect(run(h1, h2, []).left).toEqual(BOTH);
    // Only 1.35 reported the run complete and the requirement met.
    const unmet2 = caseOf([...cancelSingle()]);
    expect(marked(h1, unmet2).every((d) => d.afterMet === undefined)).toBe(
      true,
    );
    expect(run(h1, unmet2, TH_ON).left).not.toEqual([]);
    // The rule's own entries approve nothing without a listed row's entry.
    const own = [...TM_CHANGED, ...TM_UNPAIRED].map(byId);
    expect(run(h1, h2, TH_ON, own).left).toEqual(BOTH);
  });

  it("the unpaired twin alone never excuses a cancel 2.0 lacks", () => {
    // 1.35 cancels another batch requirement; 2.0 does not, and nothing is mispaired.
    const lacks1 = caseOf([...finished(), ...cancelBatch(AB1)]);
    const lacks2 = caseOf([...finished()]);
    expect(marked(lacks1, lacks2).some((d) => d.mispaired === true)).toBe(
      false,
    );
    expect(run(lacks1, lacks2, TH_ON).left).toEqual(CANCELS);
  });

  it("control: row t's existing entries behave as before where nothing is mispaired", () => {
    // Row t's batch-completed shape, unpaired: its own entries, no other.
    const met1 = caseOf([...finished(), ...cancelId()]);
    const met2 = caseOf([...finished()]);
    expect(marked(met1, met2).some((d) => d.mispaired === true)).toBe(false);
    expect(run(met1, met2, TH_ON)).toEqual({
      left: [],
      used: [...T_IDS].sort(),
    });
    expect(run(met1, met2, ["batched"]).left).toEqual(CANCELS);
    // Row t's first shape, a single run's cancel 2.0 lacks: its own entries.
    const one1 = caseOf([...cancelSingle()]);
    const one2 = caseOf([]);
    expect(run(one1, one2, ["writeRetracts"])).toEqual({
      left: [],
      used: [...L3_MISSING].sort(),
    });
    expect(run(one1, one2, []).left).toEqual(CANCELS);
  });

  it("each listed row's own conditions decide 1.35's side", () => {
    // Row t's error shape (afterError; writeRetracts, batched, batchFails).
    const e1 = caseOf([...errored(), ...cancelId(), ...cancelSingle()]);
    const e2 = caseOf([...errored(), ...cancelSingle()]);
    const pair = marked(e1, e2).filter((d) => d.op === "changed");
    expect(pair.map(brief).sort()).toEqual(PAIRED);
    expect(
      pair.every(
        (d) =>
          d.mispaired === true &&
          d.afterError === true &&
          d.afterMet === undefined,
      ),
    ).toBe(true);
    const failed = run(e1, e2, ["writeRetracts", "batched", "batchFails"]);
    expect(failed.left).toEqual([]);
    expect(failed.used).toEqual(expect.arrayContaining(TM_CHANGED));
    expect(run(e1, e2, ["writeRetracts", "batched"]).left).toEqual(PAIRED);
    // A disabled constraint's retraction (l9-fuzz-t-disable-*; disableRetracts).
    const d1 = caseOf([...cancelSingle(1), ...cancelSingle(0)]);
    const d2 = caseOf([...cancelSingle(0)]);
    const disabled = run(d1, d2, ["disableRetracts"]);
    expect(disabled.left).toEqual([]);
    expect(disabled.used).toEqual(expect.arrayContaining(TM_CHANGED));
    const none = run(d1, d2, []).left;
    expect(none.some((x) => x.startsWith("changed "))).toBe(true);
    expect(none).toEqual(expect.arrayContaining(CANCELS));
    // Row t's first shape (l3-cand-t-fuzz-*; writeRetracts): a single run's
    // extra cancel against a batch requirement's cancel both engines make.
    const s1 = caseOf([...cancelSingle(), ...cancelBatch(AB1)]);
    const s2 = caseOf([...cancelBatch(AB1)]);
    const written = run(s1, s2, ["writeRetracts"]);
    expect(written.left).toEqual([]);
    expect(written.used).toEqual(
      expect.arrayContaining([...TM_CHANGED, ...TM_UNPAIRED]),
    );
    expect(run(s1, s2, []).left.length).toBeGreaterThan(0);
  });

  it("the changed twins cover only a marked pair of two cancels of different requirements, by a listed entry", () => {
    const asJson = (e: TraceEntry | undefined) => e as unknown as Json;
    const pairOf = (over: Partial<Difference>) =>
      diff(40, {
        stream: "hook",
        kind: "onResolverCancel",
        op: "changed",
        step: 2,
        path: "args[1].id",
        reference: AB,
        candidate: A0,
        record: asJson(cancelId()[0]),
        candidateRecord: asJson(cancelSingle()[0]),
        afterMet: true,
        mispaired: true,
        ...over,
      });
    const only = (over: Partial<Difference>, ids = [...TM_CHANGED, ...T_IDS]) =>
      explain(FUZZ_SCENARIO, [pairOf(over)], ids.map(byId), TH_ON).unexplained
        .length;
    expect(only({})).toBe(0);
    expect(only({ mispaired: undefined })).toBe(1);
    // 1.35's record not after met: the batch-completed entries' own condition.
    expect(only({ afterMet: undefined })).toBe(1);
    // The same requirement on both sides, or a record that is no cancel.
    expect(
      only({ candidate: AB, candidateRecord: asJson(cancelBatch(AB)[0]) }),
    ).toBe(1);
    expect(only({ candidateRecord: asJson(finished()[0]) })).toBe(1);
    // Without the listed entries in the list, the rule approves nothing.
    expect(only({}, TM_CHANGED)).toBe(1);
    // 1.35's record of the pair, as the missing difference a listed entry reads.
    const half = unpairedHalf(pairOf({}));
    expect(half).toMatchObject({
      op: "missing",
      reference: asJson(cancelId()[0]),
      at: { reference: 40 },
      afterMet: true,
    });
    for (const gone of ["path", "candidate", "record", "candidateRecord"]) {
      expect(gone in half).toBe(false);
    }
    expect(half.mispaired).toBeUndefined();
    const class_ = PAIR.cancelOfAnother as NonNullable<
      typeof PAIR.cancelOfAnother
    >;
    for (const k of [0, 1, 2]) {
      expect(class_(asJson(cancelId()[k]), asJson(cancelSingle()[k]))).toBe(
        true,
      );
      expect(class_(asJson(cancelId()[k]), asJson(cancelBatch(AB)[k]))).toBe(
        false,
      );
    }
    expect(class_(asJson(cancelId()[0]), asJson(cancelSingle()[1]))).toBe(
      false,
    );
    expect(class_(asJson(cancelId()[0]), asJson(finished()[0]))).toBe(false);
    expect(class_(undefined, asJson(cancelSingle()[0]))).toBe(false);
  });
});

describe("the census validates the run-5 fields", () => {
  const root = mkdtempSync(join(tmpdir(), "conformance-run5-"));
  mkdirSync(join(root, "diff"), { recursive: true });
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const census = (entries: unknown[], used: string[]) => {
    writeFileSync(join(root, "diff/divergences.json"), JSON.stringify(entries));

    return checkDivergences(root, new Set(used)).join("\n");
  };

  it("accepts every run-5 entry as signed", () => {
    const ids = [...B_IDS, ...T_IDS, ...TE_IDS, ...BX_IDS];
    expect(census(ids.map(byId), ids)).toBe("");
  });

  it("afterMet must be true, on a fuzz entry of op missing", () => {
    const entry = byId(T_IDS[0] as string);
    const used = [entry.id];
    expect(census([{ ...entry, afterMet: false }], used)).toMatch(
      /afterMet must be true/,
    );
    expect(census([{ ...entry, op: "extra" }], used)).toMatch(
      /afterMet must be true/,
    );
    expect(
      census([{ ...entry, scenario: "hand", when: undefined }], used),
    ).toMatch(/afterMet must be true/);
  });

  it("afterCancel is accepted on a changed entry (the mispaired form), on no other op", () => {
    const ids = [...TG_CHANGED, ...TG_UNPAIRED];
    expect(census(ids.map(byId), ids)).toBe("");
    const entry = byId(TG_CHANGED[0] as string);
    for (const op of ["extra", "moved"]) {
      expect(census([{ ...entry, op }], [entry.id])).toMatch(
        /afterCancel must be true/,
      );
    }
  });

  it("afterCancel must be true, on a fuzz entry of op missing", () => {
    const entry = byId(TC_IDS[0] as string);
    const used = [entry.id];
    expect(census(TC_IDS.map(byId), TC_IDS)).toBe("");
    expect(census([{ ...entry, afterCancel: false }], used)).toMatch(
      /afterCancel must be true/,
    );
    expect(census([{ ...entry, op: "extra" }], used)).toMatch(
      /afterCancel must be true/,
    );
    expect(
      census(
        [{ ...entry, scenario: "hand", when: undefined, afterOp: undefined }],
        used,
      ),
    ).toMatch(/afterCancel must be true/);
  });

  it("afterOp takes one fuzz step op, or a list of two or more distinct ones", () => {
    const entry = byId(TC_IDS[0] as string);
    const used = [entry.id];
    expect(entry.afterOp).toEqual(["goTo", "back", "forward"]);
    expect(census([entry], used)).toBe("");
    expect(census([{ ...entry, afterOp: "goTo" }], used)).toBe("");
    for (const afterOp of [
      [],
      ["goTo"],
      ["goTo", "goTo"],
      ["goTo", "sideways"],
      ["goTo", 1],
      "sideways",
    ]) {
      expect(census([{ ...entry, afterOp }], used)).toMatch(
        /afterOp must be a fuzz step op/,
      );
    }
  });

  it("afterError must be true, on a fuzz entry of op missing", () => {
    const entry = byId(TE_IDS[0] as string);
    const used = [entry.id];
    expect(census([{ ...entry, afterError: false }], used)).toMatch(
      /afterError must be true/,
    );
    expect(census([{ ...entry, op: "extra" }], used)).toMatch(
      /afterError must be true/,
    );
    expect(
      census([{ ...entry, scenario: "hand", when: undefined }], used),
    ).toMatch(/afterError must be true/);
  });

  it("mispaired and extraCancelOf: the shared mispairing rule's fields", () => {
    const ids = [...TM_CHANGED, ...TM_UNPAIRED];
    const listed = TM_CHANGED.flatMap((id) => byId(id).extraCancelOf ?? []);
    expect(census([...listed, ...ids].map(byId), [...listed, ...ids])).toBe("");
    const entry = byId(TM_CHANGED[0] as string);
    const rows = (entry.extraCancelOf ?? []).map(byId);
    const used = [...rows.map((r) => r.id), entry.id];
    const withEntry = (over: object, more: unknown[] = []) =>
      census([...rows, ...more, { ...entry, ...over }], used);
    expect(withEntry({})).toBe("");
    expect(withEntry({ op: "extra" })).toMatch(/mispaired must be true/);
    expect(withEntry({ mispaired: false })).toMatch(/mispaired must be true/);
    expect(withEntry({ extraCancelOf: undefined })).toMatch(
      /needs extraCancelOf/,
    );
    expect(withEntry({ mispaired: undefined })).toMatch(
      /extraCancelOf must be/,
    );
    expect(withEntry({ extraCancelOf: [] })).toMatch(/extraCancelOf must be/);
    expect(withEntry({ extraCancelOf: ["l12-cand-t-nope"] })).toMatch(
      /extraCancelOf names l12-cand-t-nope/,
    );
    // Another kind's entry, and the rule's own unpaired twin: neither is an
    // approved exception for this kind's cancel.
    const otherKind = byId(T_IDS[1] as string);
    expect(withEntry({ extraCancelOf: [otherKind.id] }, [otherKind])).toMatch(
      /extraCancelOf names/,
    );
    const unpaired = byId(TM_UNPAIRED[0] as string);
    expect(withEntry({ extraCancelOf: [unpaired.id] }, [unpaired])).toMatch(
      /extraCancelOf names/,
    );
    // The listed entries must be in the file.
    expect(census([entry], [entry.id])).toMatch(/extraCancelOf names/);
    expect(census([{ ...unpaired, op: "moved" }], [unpaired.id])).toMatch(
      /mispaired must be true/,
    );
    const twin = (over: object) =>
      census(
        [...rows, entry, { ...unpaired, ...over }],
        [...used, unpaired.id],
      );
    expect(twin({})).toBe("");
    expect(twin({ mispairedBy: undefined })).toMatch(/needs mispairedBy/);
    expect(twin({ mispairedBy: [] })).toMatch(/mispairedBy must be/);
    expect(twin({ mispairedBy: [rows[0]?.id] })).toMatch(/mispairedBy names/);
    expect(census([unpaired], [unpaired.id])).toMatch(/mispairedBy names/);
  });

  it("a pair class the harness lacks is rejected", () => {
    const entry = byId("l12-fuzz-bx-hook-onTraceComplete-recompute-inserted");
    expect(census([entry], [entry.id])).toBe("");
    expect(checkExcuses(root, null)).toEqual([]);
    writeFileSync(
      join(root, "diff/divergences.json"),
      JSON.stringify([
        {
          ...entry,
          bound: { match: [{ path: "args[0]", pair: "traceRunAnything" }] },
        },
      ]),
    );
    expect(checkExcuses(root, null).join("\n")).toMatch(
      /names an unknown pair "traceRunAnything"/,
    );
  });
});

describe("the shared plugin-counter rule: a counter differs only by the approved records it counts (PR seed 17's tenth case, pr17j)", () => {
  const COUNTER = "l12-plugin-counter-follows-performance-changed";
  const ON = ["writeRetracts", "batched", "batchFails", "performancePlugin"];
  const ID = 'AB:{"item":"0.0"}';
  const req = {
    fromConstraint: "a::b0",
    id: ID,
    requirement: { item: "0.0", type: "AB" },
  };
  const hook = (name: string, args: Json[]) =>
    ({ k: "hook", hook: name, args }) as TraceEntry;
  const observe = (event: Json) => ({ k: "observe", event }) as TraceEntry;
  const failure = { $error: { name: "Error", message: "a.rb 0.0 attempt 1" } };
  const created = [
    hook("onRequirementCreated", [req]),
    observe({ id: ID, requirementType: "AB", type: "requirement.created" }),
  ];
  const errored = [
    hook("onResolverError", ["a::rb", req, failure]),
    observe({
      error: failure,
      requirementId: ID,
      resolver: "a::rb",
      type: "resolver.error",
    }),
  ];
  /** 1.35's row t error-shape cancel (l12-cand-t-batch-error-*). */
  const cancel = [
    hook("onResolverCancel", ["a::rb", { id: ID }]),
    hook("onRequirementCanceled", [{ id: ID }]),
    observe({ id: ID, type: "requirement.canceled" }),
  ];
  const end = hook("onReconcileEnd", [{ canceled: [{ id: ID }] }]);
  /** The performance plugin's numbers at the end, as the fuzz records them. */
  const perf = (counts: Record<string, Record<string, number>>) =>
    ({
      k: "external",
      data: [
        "performance",
        {
          constraints: {},
          effects: {},
          reconcile: { runs: 2 },
          resolvers: counts,
        },
      ],
    }) as TraceEntry;
  const rb = (cancellations: number, extra: Record<string, number> = {}) => ({
    "a::rb": { cancellations, completions: 0, errors: 1, ...extra },
  });
  /** pr17j's shape: 1.35's approved extra cancel in step 2, the counter read in step 4. */
  const pair = (
    v1Counts: Record<string, Record<string, number>>,
    v2Counts: Record<string, Record<string, number>>,
    { v1Cancel = true, middle = [] as TraceEntry[] } = {},
  ) => ({
    v1: [
      ...step(1, created),
      ...step(2, [...errored, ...(v1Cancel ? cancel : []), end]),
      ...middle,
      ...step(4, [perf(v1Counts)]),
    ],
    v2: [
      ...step(1, created),
      ...step(2, [...errored, end]),
      ...middle,
      ...step(4, [perf(v2Counts)]),
    ],
  });
  const COUNTED =
    "changed external performance 4 data[1].resolvers.a::rb.cancellations";
  const used = (v1: TraceEntry[], v2: TraceEntry[]) => {
    const steps = stepOps(v1);
    const diffs = markAfterError(compareContract(v1, v2, "v2"), v1, v2);

    return explain(FUZZ_SCENARIO, diffs, ALL, ON, steps).used;
  };

  it("the entry is signed on the owner's 2026-11-26 answer, in its narrowest form", () => {
    const e = byId(COUNTER);
    expect(e.counterFollows).toBe(true);
    expect([e.scenario, e.stream, e.kind, e.engine, e.op, e.path]).toEqual([
      FUZZ_SCENARIO,
      "external",
      "performance",
      "v2",
      "changed",
      "data[1]",
    ]);
    expect(e.when).toEqual(["performancePlugin"]);
    expect(e.excuses).toBeUndefined();
    expect(e.requires).toBeUndefined();
    expect(e.bound).toBeUndefined();
    expect(e.reason).toContain("Signed on the owner's instruction");
    expect(e.reason).toContain(
      '"Counters follow approved records (Recommended)" (2026-11-26)',
    );
    expect(e.date).toBe("2026-11-26");
    expect(
      ALL.filter((x) => x.counterFollows === true).map((x) => x.id),
    ).toEqual([COUNTER]);
  });

  it("the map holds only the performance plugin's direct hook counts", () => {
    expect(PLUGIN_COUNTERS).toEqual({
      performance: {
        resolvers: {
          starts: "onResolverStart",
          completions: "onResolverComplete",
          errors: "onResolverError",
          retries: "onResolverRetry",
          cancellations: "onResolverCancel",
        },
        effects: { runs: "onEffectRun", errors: "onEffectError" },
        constraints: { evaluations: "onConstraintEvaluate" },
        reconcile: { runs: "onReconcileEnd" },
      },
    });
  });

  it("control: pr17j's shape is explained, the counter by 1.35's approved extra cancel", () => {
    const { v1, v2 } = pair(rb(5), rb(4));
    expect(left(v1, v2, ON)).toEqual([]);
    expect(used(v1, v2)).toEqual(expect.arrayContaining([COUNTER, ...TE_IDS]));
  });

  it("a counter off by more than the explained records still fails", () => {
    const { v1, v2 } = pair(rb(6), rb(4));
    expect(left(v1, v2, ON)).toEqual([COUNTED]);
  });

  it("a counter difference with no explained record behind it still fails", () => {
    const { v1, v2 } = pair(rb(5), rb(4), { v1Cancel: false });
    expect(left(v1, v2, ON)).toEqual([COUNTED]);
    // The record is there but unexplained (the case lacks the row's triggers): both fail.
    const bare = pair(rb(5), rb(4));
    const steps = stepOps(bare.v1);
    const diffs = markAfterError(
      compareContract(bare.v1, bare.v2, "v2"),
      bare.v1,
      bare.v2,
    );
    expect(
      explain(FUZZ_SCENARIO, diffs, ALL, ["performancePlugin"], steps)
        .unexplained.map(brief)
        .sort(),
    ).toEqual(
      expect.arrayContaining([COUNTED, "missing hook onResolverCancel 2"]),
    );
  });

  it("the wrong direction still fails", () => {
    const { v1, v2 } = pair(rb(4), rb(5));
    expect(left(v1, v2, ON)).toEqual([COUNTED]);
  });

  it("a counter of an unmapped kind, field or key still fails", () => {
    // A field the map does not list.
    const field = pair(rb(4, { pending: 5 }), rb(4, { pending: 4 }));
    expect(left(field.v1, field.v2, ON)).toEqual([
      "changed external performance 4 data[1].resolvers.a::rb.pending",
    ]);
    // Another resolver's cancellations: the cancel counted is a::rb's.
    const key = pair(
      { ...rb(4), "a::r0": { cancellations: 5 } },
      { ...rb(4), "a::r0": { cancellations: 4 } },
    );
    expect(left(key.v1, key.v2, ON)).toEqual([
      "changed external performance 4 data[1].resolvers.a::r0.cancellations",
    ]);
    // Another counted kind: errors count onResolverError, which both engines report.
    const kind = pair(rb(5, { errors: 2 }), rb(4, { errors: 1 }));
    expect(left(kind.v1, kind.v2, ON)).toEqual([
      "changed external performance 4 data[1].resolvers.a::rb.errors",
    ]);
    // A plugin the map does not list (the status plugin's numbers): never a counter.
    const status = compareContract(
      [
        ...step(1, [
          { k: "external", data: ["status", { AB: { pending: 1 } }] },
        ] as TraceEntry[]),
      ],
      [
        ...step(1, [
          { k: "external", data: ["status", { AB: { pending: 0 } }] },
        ] as TraceEntry[]),
      ],
      "v2",
    );
    expect(status.length).toBe(1);
    expect(counterOf(status[0] as Difference)).toBeUndefined();
  });

  it("records before a destroy or twin step are not counted", () => {
    for (const op of ["destroy", "twin"]) {
      const middle = [
        { k: "step", i: 3, step: { op } },
        { k: "async", i: 3 },
      ] as TraceEntry[];
      const { v1, v2 } = pair(rb(5), rb(4), { middle });
      expect(left(v1, v2, ON)).toEqual([COUNTED]);
    }
  });
});

describe("the census validates counterFollows", () => {
  const root = mkdtempSync(join(tmpdir(), "conformance-run5-counter-"));
  mkdirSync(join(root, "diff"), { recursive: true });
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const census = (entries: unknown[], used: string[]) => {
    writeFileSync(join(root, "diff/divergences.json"), JSON.stringify(entries));

    return checkDivergences(root, new Set(used)).join("\n");
  };
  const entry = () => byId("l12-plugin-counter-follows-performance-changed");
  const withEntry = (over: object) =>
    census([{ ...entry(), ...over }], [entry().id]);

  it("accepts the entry as signed, and rejects any other shape", () => {
    expect(withEntry({})).toBe("");
    for (const over of [
      { counterFollows: false },
      { op: "missing" },
      { stream: "hook" },
      { kind: "status" },
      { bound: { match: [] } },
      { ends: true },
      { scenario: "a hand scenario" },
    ]) {
      expect(withEntry(over)).toMatch(/counterFollows must be true/);
    }
  });
});

describe("row (ay)'s knock-on in the history record: ids, index and length differ only by the snapshots (ay) excuses (PR seed 17's eleventh case, pr17k)", () => {
  const FOLLOWS = "l12-fuzz-ay-external-history-changed-snapshots";
  const SNAPSHOT = "l8-fuzz-ay-hook-onSnapshot-missing-unannounced";
  const ON = ["navigatedPaused"];
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
  /** The snapshot 1.35's write takes after the goTo cleared the pause (pr17k's step 9). */
  const snapshot = (id: number) =>
    ({
      k: "hook",
      hook: "onSnapshot",
      args: [
        {
          facts: {
            "a::f0": 3,
            "a::f1": 0,
            "b::f0": 0,
            "b::when": { $date: "1970-01-01T00:00:00.000Z" },
          },
          id,
          trigger: "facts-changed:a::f0",
          ordered: true,
        },
      ],
    }) as TraceEntry;
  /** pr17k's shape: pause, goTo, a write only 1.35 snapshots, then a history record. */
  const pair = (
    v1History: Record<string, Json>,
    v2History: Record<string, Json> = {},
    { nav = "goTo", first = "pause", v1Snapshot = true, snapshotId = 2 } = {},
  ) => ({
    v1: [
      ...opStep(1, first, [history({})]),
      ...opStep(2, nav),
      ...opStep(3, "set", [], v1Snapshot ? [snapshot(snapshotId)] : []),
      ...opStep(4, "pause", [history(v1History)]),
    ],
    v2: [
      ...opStep(1, first, [history({})]),
      ...opStep(2, nav),
      ...opStep(3, "set"),
      ...opStep(4, "pause", [history(v2History)]),
    ],
  });
  const PR17K = { ids: [1, 2], index: 1, length: 2 };
  const IDS = "changed external history 4 data[1].ids[1]";
  const INDEX = "changed external history 4 data[1].index";
  const LENGTH = "changed external history 4 data[1].length";
  const usedBy = (v1: TraceEntry[], v2: TraceEntry[], triggers: string[]) =>
    explain(
      FUZZ_SCENARIO,
      compareContract(v1, v2, "v2"),
      ALL,
      triggers,
      stepOps(v1),
    ).used;

  it("the entry is signed on the owner's 2026-11-27 answer, in its narrowest form", () => {
    const e = byId(FOLLOWS);
    expect(e.snapshotFollows).toBe(true);
    expect([e.scenario, e.stream, e.kind, e.engine, e.op, e.path]).toEqual([
      FUZZ_SCENARIO,
      "external",
      "history",
      "v2",
      "changed",
      "data[1]",
    ]);
    expect(e.when).toEqual(["navigatedPaused"]);
    expect(e.group).toBe("row-ay");
    expect(e.excuses).toBeUndefined();
    expect(e.requires).toBeUndefined();
    expect(e.bound).toBeUndefined();
    expect(e.ends).toBeUndefined();
    expect(e.reason).toContain("Signed on the owner's instruction");
    expect(e.reason).toContain(
      '"Approve (ay) knock-on, keep going (Recommended)" (2026-11-27)',
    );
    expect(e.reason).toContain(
      '"Approve all as recommended (Recommended)", 2026-11-10',
    );
    expect(e.date).toBe("2026-11-27");
    expect(
      ALL.filter((x) => x.snapshotFollows === true).map((x) => x.id),
    ).toEqual([FOLLOWS]);
  });

  it("control: pr17k's shape is explained, the record by the snapshot (ay) excuses", () => {
    const { v1, v2 } = pair(PR17K);
    expect(left(v1, v2, ON)).toEqual([]);
    expect(usedBy(v1, v2, ON).sort()).toEqual([FOLLOWS, SNAPSHOT].sort());
  });

  it("an index or length off by more still fails, with the whole record", () => {
    for (const over of [{ index: 2 }, { length: 3 }, { length: 1 }]) {
      const { v1, v2 } = pair({ ...PR17K, ...over });
      expect(left(v1, v2, ON).sort()).toEqual(
        [IDS, INDEX, LENGTH].filter(
          (x) => !(x === LENGTH && over.length === 1),
        ),
      );
    }
    // An index that does not move with the snapshot: off by less.
    const less = pair({ ...PR17K, index: 0 });
    expect(left(less.v1, less.v2, ON).sort()).toEqual([IDS, LENGTH]);
    // The engine's side off instead: its length does not follow its ids.
    const engine = pair(PR17K, { length: 0 });
    expect(left(engine.v1, engine.v2, ON).sort()).toEqual([IDS, INDEX, LENGTH]);
  });

  it("an id difference the missing snapshot does not explain still fails", () => {
    // 1.35 lists another id than the snapshot (ay) excuses (id 2).
    const other = pair({ ids: [1, 3], index: 1, length: 2 });
    expect(left(other.v1, other.v2, ON).sort()).toEqual([IDS, INDEX, LENGTH]);
    // One more id than the excused snapshot.
    const more = pair({ ids: [1, 2, 3], index: 2, length: 3 });
    expect(left(more.v1, more.v2, ON).sort()).toEqual([
      IDS,
      "changed external history 4 data[1].ids[2]",
      INDEX,
      LENGTH,
    ]);
    // The engine's own ids differ as well.
    const engine = pair(PR17K, { ids: [7] });
    expect(left(engine.v1, engine.v2, ON).sort()).toEqual([
      "changed external history 4 data[1].ids[0]",
      IDS,
      INDEX,
      LENGTH,
    ]);
    // No snapshot behind the difference at all.
    const none = pair(PR17K, {}, { v1Snapshot: false });
    expect(left(none.v1, none.v2, ON).sort()).toEqual([IDS, INDEX, LENGTH]);
  });

  it("the same with no paused goTo still fails", () => {
    // Another navigation under the pause: the snapshot is row (ay)'s, the record is not covered.
    const back = pair(PR17K, {}, { nav: "back" });
    expect(left(back.v1, back.v2, ON).sort()).toEqual([IDS, INDEX, LENGTH]);
    // A goTo with no pause set before it.
    const unpaused = pair(PR17K, {}, { first: "resume" });
    expect(left(unpaused.v1, unpaused.v2, ON).sort()).toEqual([
      IDS,
      INDEX,
      LENGTH,
    ]);
    // A case without the row's trigger: the snapshot fails too.
    const bare = pair(PR17K);
    expect(left(bare.v1, bare.v2, []).sort()).toEqual([
      IDS,
      INDEX,
      LENGTH,
      "missing hook onSnapshot 3",
    ]);
  });

  it("any other history field still fails", () => {
    // 1.35 paused and 2.0 not: the reverse of row (ay)'s own paused entry.
    const paused = pair(PR17K, { paused: false });
    expect(left(paused.v1, paused.v2, ON)).toEqual([
      "changed external history 4 data[1].paused",
    ]);
    for (const [field, value] of [
      ["ordered", false],
      ["changes", 2],
    ] as const) {
      const { v1, v2 } = pair({ ...PR17K, [field]: value });
      expect(left(v1, v2, ON)).toEqual([
        `changed external history 4 data[1].${field}`,
      ]);
    }
  });

  it("historyFollows: later ids shift by the excused snapshot; a resume, destroy or twin ends the rule", () => {
    const record = (h: Record<string, Json>) =>
      ({ k: "external", data: ["history", h] }) as unknown as Json;
    const d = (
      path: string,
      v1: Record<string, Json>,
      v2: Record<string, Json>,
    ) =>
      ({
        engine: "v2",
        stream: "external",
        kind: "history",
        step: 6,
        phase: "sync",
        op: "changed",
        path,
        record: record(v1),
        candidateRecord: record(v2),
        at: { reference: 50, candidate: 48 },
        where: {},
      }) as unknown as Difference;
    const missing = {
      engine: "v2",
      stream: "hook",
      kind: "onSnapshot",
      step: 3,
      phase: "async",
      op: "missing",
      reference: snapshot(2) as unknown as Json,
      at: { reference: 20 },
      where: {},
    } as unknown as Difference;
    const steps = (ops: string[]) => new Map(ops.map((op, i) => [i + 1, op]));
    const OPS = ["pause", "goTo", "set", "resume", "set", "pause"];
    const v1 = { ids: [1, 2, 3], index: 2, length: 3 };
    const v2 = { ids: [1, 2], index: 1, length: 2 };
    for (const path of ["data[1].ids[2]", "data[1].index", "data[1].length"]) {
      expect(historyFollows(d(path, v1, v2), [missing], steps(OPS))).toBe(true);
    }
    const ids = d("data[1].ids[2]", v1, v2);
    // Not shifted: 2.0's later id is not 1.35's less the excused one.
    expect(
      historyFollows(
        d("data[1].ids[1]", v1, { ...v2, ids: [1, 3] }),
        [missing],
        steps(OPS),
      ),
    ).toBe(false);
    // Any other path of the record.
    expect(
      historyFollows(d("data[1].paused", v1, v2), [missing], steps(OPS)),
    ).toBe(false);
    // No explained snapshot; one after the record; an extra, not a missing one.
    expect(historyFollows(ids, [], steps(OPS))).toBe(false);
    expect(
      historyFollows(
        ids,
        [{ ...missing, at: { reference: 60 } } as Difference],
        steps(OPS),
      ),
    ).toBe(false);
    expect(
      historyFollows(
        ids,
        [{ ...missing, op: "extra" } as Difference],
        steps(OPS),
      ),
    ).toBe(false);
    // The snapshot before the paused goTo; the goTo after a resume; a destroy or twin since.
    expect(
      historyFollows(
        ids,
        [missing],
        steps(["pause", "set", "set", "goTo", "set", "pause"]),
      ),
    ).toBe(false);
    expect(
      historyFollows(
        ids,
        [missing],
        steps(["pause", "resume", "goTo", "set", "set", "pause"]),
      ),
    ).toBe(false);
    for (const op of ["destroy", "twin"]) {
      expect(
        historyFollows(
          ids,
          [{ ...missing, step: 4 } as Difference],
          steps(["pause", "goTo", "set", "set", op, "pause"]),
        ),
      ).toBe(false);
    }
    expect(historyFollows(ids, [missing], undefined)).toBe(false);
  });
});

describe("the census validates snapshotFollows", () => {
  const root = mkdtempSync(join(tmpdir(), "conformance-run5-history-"));
  mkdirSync(join(root, "diff"), { recursive: true });
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const entry = () => byId("l12-fuzz-ay-external-history-changed-snapshots");
  const withEntry = (over: object) => {
    writeFileSync(
      join(root, "diff/divergences.json"),
      JSON.stringify([{ ...entry(), ...over }]),
    );

    return checkDivergences(root, new Set([entry().id])).join("\n");
  };

  it("accepts the entry as signed, and rejects any other shape", () => {
    expect(withEntry({})).toBe("");
    expect(checkExcuses(root, null)).toEqual([]);
    for (const over of [
      { snapshotFollows: false },
      { op: "missing" },
      { stream: "hook" },
      { kind: "performance" },
      { path: "data[1].ids" },
      { group: "row-az" },
      { when: ["replayedOrImported"] },
      { when: undefined },
      { bound: { match: [] } },
      { ends: true },
      { scenario: "a hand scenario" },
    ]) {
      expect(withEntry(over)).toMatch(/snapshotFollows must be true/);
    }
  });
});
