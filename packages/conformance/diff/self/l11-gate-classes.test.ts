// The L11 gate's run-3 class changes (GATE-11.md), signed on the owner's
// instruction (2026-11-18: "Approve; you sign them (Recommended)").
// - `keyedRequirementId`: a keyed resolver's requirement id, the bare type,
//   plain or JSON-quoted (`A0`, `"A0"`). Quirk b's keyed twins name it for
//   `id` and `requirementId`; any other id shape still fails.
// - `tx`: the L11 fuzz's string fact, added to `snapshot`'s and
//   `snapshotDynamic`'s fact keys and labels under row (ay). Any other fact
//   name still fails.
// - Row t's batch-pairing twin (`l11-cand-t-batch-*`, PR seed 14): 1.35's
//   extra cancel of a completed single run, paired against 2.0's batch
//   cancel. A batch cancel 2.0 lacks with no such pairing, or an extra on
//   2.0, still fails.
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

  it("only quirk b's keyed twins and row t's batch-pairing twin name it", () => {
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
      "l11-quirk-b-keyed-hook-onError-missing",
      "l11-quirk-b-keyed-hook-onErrorRecovery-missing",
      "l11-quirk-b-keyed-hook-onResolverError-missing",
      "l11-quirk-b-keyed-observe-resolver-error-missing",
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
