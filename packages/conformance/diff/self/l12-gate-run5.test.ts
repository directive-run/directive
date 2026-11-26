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
//   2026-11-23): only after a goTo step, and only after both engines
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
// Every (bx) entry applies only with a fact-including watch: the same
// records without one still fail.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkDivergences, checkExcuses } from "../../lib/census.js";
import { type Difference, compareContract } from "../compare.js";
import { PAIR, TEXT } from "../fingerprint.js";
import type { Json } from "../normalize.js";
import type { TraceEntry } from "../record.js";
import {
  FUZZ_SCENARIO,
  explain,
  fileMoves,
  markAfterCancel,
  markAfterError,
  markAfterMet,
  markMispaired,
  markStale,
  pairedHalf,
  readDivergences,
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
      expect(d.afterOp).toBe("goTo");
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

  it("after a failed run, without a goTo it fails", () => {
    // No navigation in the case.
    const off = TC_FAILS.filter((t) => !t.startsWith("navigated"));
    expect(left(e1, e2, off)).toEqual(CANCELS);
    // No goTo step before the cancels' step.
    expect(left(e1.slice(2), e2.slice(2), TC_FAILS)).toEqual(CANCELS);
    // Another navigation than a goTo.
    const back = history(1, { op: "back", steps: 1 });
    expect(
      left([...back, ...e1.slice(2)], [...back, ...e2.slice(2)], TC_FAILS),
    ).toEqual(CANCELS);
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

  it("without a goTo it fails", () => {
    // No navigation in the case.
    const off = TC_ON.filter((t) => !t.startsWith("navigated"));
    expect(left(v1, v2, off)).toEqual(CANCELS);
    expect(left(v1.slice(2), v2.slice(2), off)).toEqual(CANCELS);
    // A navigation that never ran while work was in flight.
    expect(
      left(
        v1,
        v2,
        TC_ON.filter((t) => t !== "navigatedBusy"),
      ),
    ).toEqual(CANCELS);
    // Another navigation than a goTo.
    const back = history(1, { op: "back", steps: 1 });
    expect(
      left([...back, ...v1.slice(2)], [...back, ...v2.slice(2)], TC_ON),
    ).toEqual(CANCELS);
    // A goTo only after the second cancel's step.
    expect(
      left([...v1.slice(2), ...goTo(4)], [...v2.slice(2), ...goTo(4)], TC_ON),
    ).toEqual(CANCELS);
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
          expect(e.afterOp).toBe("goTo");
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

    it("without a goTo it fails", () => {
      const back = (trace: TraceEntry[]) => [
        ...history(1, { op: "back" }),
        ...trace.slice(goTo().length),
      ];
      expect(run(back(g1), back(g2), TC_ON).left).toEqual(PAIRED);
      expect(run(back(g1), back(g2), NO_WR).left).toEqual(
        [...PAIRED, ...CANCELS].sort(),
      );
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
