// The L11 gate's run-3 class changes (GATE-11.md), signed on the owner's
// instruction (2026-11-18: "Approve; you sign them (Recommended)").
// - `keyedRequirementId`: a keyed resolver's requirement id, the bare type,
//   plain or JSON-quoted (`A0`, `"A0"`). Quirk b's keyed twins name it for
//   `id` and `requirementId`; any other id shape still fails.
// - `tx`: the L11 fuzz's string fact, added to `snapshot`'s and
//   `snapshotDynamic`'s fact keys and labels under row (ay). Any other fact
//   name still fails.
// Run 4 (2026-11-18: "Allow a run 4 and sign both (Recommended)"):
// - Quirk k's fuzz entries name the clobbered fact through the `fact` class
//   (PR seed 19, deep seed 1: `f2`), not the literal `f0`/`f1`.
// - Row t's plain fuzz path admits a keyed single run (PR seed 14 at L11).
// - Row t's batch-pairing twin (`l11-cand-t-batch-*`, PR seed 14): 1.35's
//   extra cancel of a completed single run, paired against 2.0's batch
//   cancel. A batch cancel 2.0 lacks with no such pairing, or an extra on
//   2.0, still fails.
// Run 5 (2026-11-19: "Yes, run 5 (Recommended)"):
// - Row (as)'s flush twin (`l11-fuzz-as-flush-*`, PR seed 7): 1.35's extra
//   reconcile pass in a settle step whose batch has a maxSize. Outside
//   settle, outside a batch with maxSize, or an extra pass on 2.0, fails.
// - Quirk a's keyed twins (`l11-quirk-a-keyed-*`, deep 24301): 2.0's retry
//   of a keyed requirement under "retry". Outside resolverRetry, or a plain
//   or other id shape, fails.
import { describe, expect, it } from "vitest";
import { compareContract } from "../compare.js";
import { LIKE, generalizeValue } from "../fingerprint.js";
import type { Json } from "../normalize.js";
import type { TraceEntry } from "../record.js";
import { FUZZ_SCENARIO, explain, readDivergences } from "../scenario.js";

describe("keyedRequirementId: a keyed requirement's id, and no other shape", () => {
  it("accepts the bare type, plain or JSON-quoted", () => {
    for (const v of ["A0", "B12", '"A0"', '"C3"']) {
      expect(LIKE.keyedRequirementId?.(v), v).toBe(true);
    }
  });

  it("rejects any other id shape", () => {
    for (const v of [
      "A0:{}",
      'A0:{"at":1}',
      "a0",
      "AB",
      '"A0',
      'A0"',
      "'A0'",
      '""A0""',
      "r0",
      "0",
      "",
    ]) {
      expect(LIKE.keyedRequirementId?.(v), v).toBe(false);
    }
    expect(LIKE.keyedRequirementId?.(0)).toBe(false);
    expect(LIKE.keyedRequirementId?.(undefined)).toBe(false);
  });

  it("is hand-named: generalize never picks it", () => {
    expect(generalizeValue('"A0"')).not.toEqual({
      $like: "keyedRequirementId",
    });
    expect(generalizeValue("A0")).toEqual({ $like: "requirementType" });
  });

  it("only quirk a's and quirk b's keyed twins and row t's batch-pairing and plain fuzz entries name it", () => {
    const naming = readDivergences()
      .filter((e) => JSON.stringify(e).includes('"keyedRequirementId"'))
      .map((e) => e.id)
      .sort();
    expect(naming).toEqual([
      "l11-cand-t-batch-hook-onRequirementCanceled-changed",
      "l11-cand-t-batch-hook-onRequirementCanceled-missing",
      "l11-cand-t-batch-hook-onResolverCancel-changed",
      "l11-cand-t-batch-hook-onResolverCancel-missing",
      "l11-cand-t-batch-observe-requirement-canceled-changed",
      "l11-cand-t-batch-observe-requirement-canceled-missing",
      "l11-quirk-a-keyed-fuzz-hook-onReconcileEnd-changed-inflight",
      "l11-quirk-a-keyed-fuzz-hook-onReconcileEnd-changed-unmet",
      "l11-quirk-a-keyed-fuzz-hook-onResolverRetry-extra",
      "l11-quirk-a-keyed-fuzz-hook-onResolverRetry-missing",
      "l11-quirk-a-keyed-fuzz-hook-onResolverStart-changed",
      "l11-quirk-a-keyed-fuzz-hook-onResolverStart-extra",
      "l11-quirk-a-keyed-fuzz-observe-resolver-start-changed",
      "l11-quirk-b-keyed-hook-onError-missing",
      "l11-quirk-b-keyed-hook-onErrorRecovery-missing",
      "l11-quirk-b-keyed-hook-onResolverError-missing",
      "l11-quirk-b-keyed-observe-resolver-error-missing",
      "l3-cand-t-fuzz-hook-onRequirementCanceled-missing",
      "l3-cand-t-fuzz-hook-onResolverCancel-missing",
      "l3-cand-t-fuzz-observe-requirement-canceled-missing",
    ]);
  });
});

describe("snapshot and snapshotDynamic: tx, and no other new fact name", () => {
  const snap = (facts: Record<string, Json>, trigger: string): Json => ({
    facts,
    id: 3,
    ordered: true,
    trigger,
  });

  it("accepts tx, bare or namespaced, in the facts and the label", () => {
    expect(
      LIKE.snapshot?.(
        snap({ "a::f0": 1, "a::tx": "v=1" }, "facts-changed:a::tx"),
      ),
    ).toBe(true);
    expect(
      LIKE.snapshot?.(snap({ f0: 1, tx: "" }, "facts-changed:f0,tx")),
    ).toBe(true);
    expect(
      LIKE.snapshotDynamic?.(
        snap({ "a::zf": 0, "a::tx": "" }, "facts-changed:a::tx"),
      ),
    ).toBe(true);
  });

  it("rejects an unrelated fact name, in the facts or the label", () => {
    for (const name of ["ty", "txt", "x0", "t", "tx0", "TX"]) {
      expect(
        LIKE.snapshot?.(
          snap({ "a::f0": 1, [`a::${name}`]: "" }, "facts-changed:a::f0"),
        ),
        name,
      ).toBe(false);
      expect(
        LIKE.snapshot?.(snap({ "a::f0": 1 }, `facts-changed:a::${name}`)),
        name,
      ).toBe(false);
      expect(
        LIKE.snapshotDynamic?.(
          snap({ "a::zf": 0, [`a::${name}`]: "" }, "facts-changed:a::zf"),
        ),
        name,
      ).toBe(false);
      expect(
        LIKE.snapshotDynamic?.(
          snap({ "a::zf": 0 }, `facts-changed:a::${name}`),
        ),
        name,
      ).toBe(false);
    }
  });

  it("tx alone is not an L10 fact: snapshotDynamic still needs zf, zw, g0 or g1", () => {
    expect(
      LIKE.snapshotDynamic?.(
        snap({ "a::f0": 1, "a::tx": "" }, "facts-changed:a::tx"),
      ),
    ).toBe(false);
  });
});

describe("row t's batch-pairing twin excuses only 1.35's extra single-run cancel beside a batch cancel", () => {
  const twins = readDivergences().filter((e) =>
    e.id.startsWith("l11-cand-t-batch-"),
  );
  const single = {
    fromConstraint: "c1",
    id: "A1:{}",
    requirement: { type: "A1" },
  };
  const batch = {
    fromConstraint: "b0",
    id: 'AB:{"item":"0.0"}',
    requirement: { item: "0.0", type: "AB" },
  };
  const kinds: [string, (r: Json, by: string) => TraceEntry][] = [
    [
      "onResolverCancel",
      (r, by) => ({ k: "hook", hook: "onResolverCancel", args: [by, r] }),
    ],
    [
      "onRequirementCanceled",
      (r) => ({ k: "hook", hook: "onRequirementCanceled", args: [r] }),
    ],
    [
      "requirement.canceled",
      (r) => ({
        k: "observe",
        event: { id: (r as { id: string }).id, type: "requirement.canceled" },
      }),
    ],
  ];
  const left = (
    reference: TraceEntry[],
    candidate: TraceEntry[],
    triggers: string[],
  ): string[] => {
    const step = (records: TraceEntry[]): TraceEntry[] => [
      { k: "step", i: 0, step: "step 0" },
      ...records,
      { k: "async", i: 0 },
    ];

    return explain(
      FUZZ_SCENARIO,
      compareContract(step(reference), step(candidate), "v2"),
      twins,
      triggers,
    ).unexplained.map((d) => `${d.op} ${d.kind}`);
  };
  const T = ["writeRetracts", "batched"];

  it("has six entries, each signed on the owner's instruction", () => {
    expect(twins).toHaveLength(6);
    for (const e of twins) {
      expect(e.reason).toContain('"Approve; you sign them (Recommended)"');
    }
  });

  const each = (
    check: (kind: string, r1: TraceEntry, rb: TraceEntry) => void,
  ) => {
    for (const [kind, make] of kinds) {
      check(kind, make(single, "r1"), make(batch, "rb"));
    }
  };

  it("control: 1.35's single-run cancel then the batch cancel, against 2.0's batch cancel, is excused", () => {
    each((kind, r1, rb) => expect(left([r1, rb], [rb], T), kind).toEqual([]));
  });

  it("outside writeRetracts or batched it fails", () => {
    each((kind, r1, rb) => {
      expect(left([r1, rb], [rb], ["batched"]), kind).not.toEqual([]);
      expect(left([r1, rb], [rb], ["writeRetracts"]), kind).not.toEqual([]);
    });
  });

  it("a batch cancel 2.0 really lacks, with no pairing, fails", () => {
    each((kind, _r1, rb) =>
      expect(left([rb], [], T), kind).toEqual([`missing ${kind}`]),
    );
  });

  it("a keyed single run (PR seed 14 at L11) is excused the same way, and its extra on 2.0 still fails", () => {
    const keyed = {
      fromConstraint: "c1",
      id: "A1",
      requirement: { at: 0, type: "A1" },
    };
    for (const [kind, make] of kinds) {
      const r1 = make(keyed, "r1");
      const rb = make(batch, "rb");
      expect(left([r1, rb], [rb], T), kind).toEqual([]);
      expect(left([rb], [r1, rb], T), kind).not.toEqual([]);
    }
  });

  it("a real extra on 2.0 fails", () => {
    each((kind, r1, rb) => {
      expect(left([rb], [rb, rb], T), kind).toEqual([`extra ${kind}`]);
      expect(left([rb], [r1, rb], T), kind).not.toEqual([]);
    });
  });
});

const stepped = (records: TraceEntry[]): TraceEntry[] => [
  { k: "step", i: 0, step: "step 0" },
  ...records,
  { k: "async", i: 0 },
];
const leftWith = (
  entries: ReturnType<typeof readDivergences>,
  reference: TraceEntry[],
  candidate: TraceEntry[],
  triggers: string[],
): string[] =>
  explain(
    FUZZ_SCENARIO,
    compareContract(stepped(reference), stepped(candidate), "v2"),
    entries,
    triggers,
  ).unexplained.map((d) => `${d.op} ${d.kind}`);
const RUN4 = '"Allow a run 4 and sign both (Recommended)"';

describe("run 4: quirk k names any fuzz fact, and nothing else", () => {
  const ids = [
    "l7-fuzz-k-hook-onResolverWriteRejected-extra",
    "l7-fuzz-k-observe-resolver.write.rejected-extra",
    "l7-fuzz-k-hook-onFactSet-missing",
    "l7-fuzz-k-after-hook-onFactSet-extra",
  ];
  const k = readDivergences().filter((e) => e.group === "quirk-k");
  const K = ["batchMixed", "batchAbortOn"];
  const rejected = (fact: Json, reason = "clobbered"): TraceEntry[] => [
    {
      k: "hook",
      hook: "onResolverWriteRejected",
      args: [
        {
          actual: 1,
          expected: 0,
          fact,
          kind: "rejection",
          reason,
          req: {
            fromConstraint: "b0",
            id: 'AB:{"item":"0.0"}',
            requirement: { item: "0.0", type: "AB" },
          },
          resolver: "rb",
        },
      ],
    },
    {
      k: "observe",
      event: {
        actual: 1,
        expected: 0,
        fact,
        kind: "rejection",
        reason,
        requirementId: 'AB:{"item":"0.0"}',
        resolver: "rb",
        type: "resolver.write.rejected",
      },
    },
  ];
  const factSet = (fact: Json): TraceEntry => ({
    k: "hook",
    hook: "onFactSet",
    args: [fact, 1, 0],
  });

  it("the four widened entries are signed for run 4 and name no literal fact", () => {
    for (const id of ids) {
      const e = k.find((x) => x.id === id);
      expect(e?.reason, id).toContain(RUN4);
      expect(JSON.stringify(e?.bound), id).not.toMatch(/"(\w::)?f\d+"/);
    }
  });

  it("excuses f2, own or namespaced (PR seed 19, deep seed 1)", () => {
    for (const f of ["f2", "a::f2", "f0", "b::f11"]) {
      for (const r of rejected(f)) {
        expect(leftWith(k, [], [r], K), f).toEqual([]);
      }
      expect(leftWith(k, [factSet(f)], [], K), f).toEqual([]);
      expect(leftWith(k, [], [factSet(f)], K), f).toEqual([]);
    }
  });

  it("a name that is not a fuzz fact fails", () => {
    for (const f of ["tx", "zf", "g0", "d0", "F2", "f", "a::d0", "f2x"]) {
      for (const r of rejected(f)) {
        expect(leftWith(k, [], [r], K), f).not.toEqual([]);
      }
      expect(leftWith(k, [factSet(f)], [], K), f).not.toEqual([]);
    }
  });

  it("another shape still fails: another reason, or outside a mixed abortOn batch", () => {
    for (const r of rejected("f2", "validation")) {
      expect(leftWith(k, [], [r], K)).not.toEqual([]);
    }
    for (const r of rejected("f2")) {
      expect(leftWith(k, [], [r], ["batchMixed"])).not.toEqual([]);
      expect(leftWith(k, [], [r], ["batchAbortOn"])).not.toEqual([]);
    }
  });
});

describe("run 4: row t's plain fuzz path admits a keyed single run", () => {
  const t = readDivergences().filter((e) => e.group === "quirk-t");
  const cancels = (r: Json, by = "r1"): TraceEntry[] => [
    { k: "hook", hook: "onResolverCancel", args: [by, r] },
    { k: "hook", hook: "onRequirementCanceled", args: [r] },
    {
      k: "observe",
      event: { id: (r as { id: string }).id, type: "requirement.canceled" },
    },
  ];
  const keyed = {
    fromConstraint: "c1",
    id: "A1",
    requirement: { at: 0, type: "A1" },
  };

  it("the three missing entries are signed for run 4", () => {
    for (const e of t.filter(
      (x) => x.id.startsWith("l3-cand-t-fuzz-") && x.op === "missing",
    )) {
      expect(e.reason, e.id).toContain(RUN4);
    }
  });

  it("1.35's cancel of a keyed completed run is excused under writeRetracts (PR seed 14)", () => {
    expect(leftWith(t, cancels(keyed), [], ["writeRetracts"])).toEqual([]);
  });

  it("outside writeRetracts, or extra on 2.0, it fails", () => {
    expect(leftWith(t, cancels(keyed), [], [])).toHaveLength(3);
    expect(leftWith(t, [], cancels(keyed), ["writeRetracts"])).toHaveLength(3);
  });

  it("another id or requirement shape fails", () => {
    for (const r of [
      { ...keyed, id: 'AB:{"item":"0.0"}' },
      { ...keyed, id: "a1" },
      { ...keyed, requirement: { at: "0", type: "A1" } },
      { ...keyed, requirement: { at: 0, item: "0.0", type: "A1" } },
      { ...keyed, requirement: { type: "A1" } },
    ] as Json[]) {
      expect(
        leftWith(t, cancels(r), [], ["writeRetracts"]),
        JSON.stringify(r),
      ).not.toEqual([]);
    }
  });
});

const RUN5 = '"Yes, run 5 (Recommended)"';
const stepsOf = (op: string): ReadonlyMap<number, string> => new Map([[0, op]]);
const leftIn = (
  entries: ReturnType<typeof readDivergences>,
  reference: TraceEntry[],
  candidate: TraceEntry[],
  triggers: string[],
  op: string,
): string[] =>
  explain(
    FUZZ_SCENARIO,
    compareContract(stepped(reference), stepped(candidate), "v2"),
    entries,
    triggers,
    stepsOf(op),
  ).unexplained.map((d) => `${d.op} ${d.kind}`);

describe("run 5: row (as)'s flush twin excuses only 1.35's extra pass in a settle with a maxSize batch", () => {
  const as = readDivergences().filter((e) =>
    e.id.startsWith("l11-fuzz-as-flush-"),
  );
  const pass: TraceEntry[] = [
    {
      k: "hook",
      hook: "onReconcileStart",
      args: [{ get: { $fn: true }, has: { $fn: true } }] as Json[],
    },
    { k: "observe", event: { type: "reconcile.start" } },
  ];
  const T = ["batched", "batchMaxSize"];

  it("has two entries, signed for run 5 beside row (as)'s approval", () => {
    expect(as).toHaveLength(2);
    for (const e of as) {
      expect(e.reason, e.id).toContain(RUN5);
      expect(e.reason, e.id).toContain('"Approve (Recommended)", 2026-11-05');
    }
  });

  it("control: 1.35's extra pass during settle is excused", () => {
    for (const r of pass) {
      expect(leftIn(as, [r], [], T, "settle")).toEqual([]);
    }
  });

  it("another shape still fails: outside settle, without maxSize, or extra on 2.0", () => {
    for (const r of pass) {
      expect(leftIn(as, [r], [], T, "flush")).not.toEqual([]);
      expect(leftIn(as, [r], [], ["batched"], "settle")).not.toEqual([]);
      expect(leftIn(as, [r], [], ["batchMaxSize"], "settle")).not.toEqual([]);
      expect(leftIn(as, [], [r], T, "settle")).not.toEqual([]);
    }
  });

  it("a different missing record in the same step fails", () => {
    expect(
      leftIn(
        as,
        [{ k: "hook", hook: "onReconcileEnd", args: [{ unmet: [] }] }],
        [],
        T,
        "settle",
      ),
    ).not.toEqual([]);
  });
});

describe("run 5: quirk a's keyed twins excuse only a keyed retry under resolverRetry", () => {
  const qa = readDivergences().filter((e) => e.group === "quirk-a-keyed");
  const keyed = {
    fromConstraint: "c1",
    id: "A1",
    requirement: { at: 0, type: "A1" },
  };
  const start = (r: Json): TraceEntry => ({
    k: "hook",
    hook: "onResolverStart",
    args: ["r1", r],
  });
  const retry = (r: Json): TraceEntry => ({
    k: "hook",
    hook: "onResolverRetry",
    args: ["r1", r, 1],
  });
  const R = ["resolverRetry"];

  it("has seven entries, signed for run 5 beside quirk a's approval", () => {
    expect(qa).toHaveLength(7);
    for (const e of qa) {
      expect(e.reason, e.id).toContain(RUN5);
      expect(e.reason, e.id).toContain(
        '"If all are better or non user facing they are all approved", 2026-11-01',
      );
    }
  });

  it("control: 2.0's extra start and retry of a keyed requirement are excused (deep 24301)", () => {
    expect(leftWith(qa, [], [start(keyed)], R)).toEqual([]);
    expect(leftWith(qa, [], [retry(keyed)], R)).toEqual([]);
  });

  it("outside resolverRetry it fails", () => {
    expect(leftWith(qa, [], [start(keyed)], [])).not.toEqual([]);
    expect(leftWith(qa, [], [retry(keyed)], [])).not.toEqual([]);
  });

  it("another id or requirement shape fails", () => {
    for (const r of [
      { ...keyed, id: "A1:{}" },
      { ...keyed, id: 'AB:{"item":"0.0"}' },
      { ...keyed, id: "a1" },
      { ...keyed, requirement: { at: "0", type: "A1" } },
      { ...keyed, requirement: { at: 0, item: "0.0", type: "A1" } },
    ] as Json[]) {
      expect(leftWith(qa, [], [start(r)], R), JSON.stringify(r)).not.toEqual(
        [],
      );
    }
  });
});
