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
//   (`afterCancel`, `markAfterCancel`);
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
  markStale,
  pairedHalf,
  readDivergences,
  stepOps,
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

describe("1.35's second cancel of a finished batch run after a goTo (PR seed 17's fourth shrink), and no other", () => {
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
  const errored = [
    hook("onResolverError", ["a::rb", full(ID), failure]),
    observe({
      error: failure,
      requirementId: ID,
      resolver: "a::rb",
      type: "resolver.error",
    }),
  ];
  const end = hook("onReconcileEnd", [{ canceled: [{ id: ID }] }]);
  const CANCELS = [
    "missing hook onRequirementCanceled 3",
    "missing hook onResolverCancel 3",
    "missing observe requirement.canceled 3",
  ];
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

  it("each entry is signed on the owner's answer, next to rows t and (av)", () => {
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

  it("on a run that did not complete it fails", () => {
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
    // Errored, not completed.
    const error1 = [
      ...goTo(),
      ...step(2, created()),
      ...step(3, [...errored, ...cancel(), ...cancel(), end]),
    ];
    const error2 = [
      ...goTo(),
      ...step(2, created()),
      ...step(3, [...errored, ...cancel2(), end]),
    ];
    expect(left(error1, error2, [...TC_ON, "batchFails"])).toEqual(CANCELS);
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

  it("a third cancel fails", () => {
    const third = [
      ...goTo(),
      ...step(2, created()),
      ...step(3, [...finished(), ...cancel(), ...cancel(), ...cancel(), end]),
    ];
    expect(marks(third, v2)).toEqual([
      ["onResolverCancel", true],
      ["onRequirementCanceled", true],
      ["requirement.canceled", true],
      ["onResolverCancel", undefined],
      ["onRequirementCanceled", undefined],
      ["requirement.canceled", undefined],
    ]);
    expect(left(third, v2, TC_ON)).toEqual(CANCELS);
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
