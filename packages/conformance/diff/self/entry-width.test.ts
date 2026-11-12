/**
 * Two L7 fuzz entries narrowed to the differences their reasons describe
 * (gate review, round 1, 2026-11-10):
 *
 * - row (as)'s `l7-fuzz-as-external-aborted-extra` covers 2.0's abort of a
 *   batch call only in a settle step (`during` "settle"), where settle()
 *   flushed the call while it waited; a spurious abort in another step
 *   still fails;
 * - row (av)'s `l7-fuzz-av-external-start-changed-items` covers a changed
 *   item only in a call whose items repeat on 1.35 (each pattern's
 *   `record`, `batchItemsRepeated`); 2.0 dropping or replacing an item of a
 *   call of distinct items still fails.
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkDivergences, checkExcuses } from "../../lib/census.js";
import { compareContract } from "../compare.js";
import { type FuzzSpec, toScenario } from "../fuzz/model.js";
import type { TraceEntry } from "../record.js";
import { explain, readDivergences, runScenario, stepOps } from "../scenario.js";

const AS = "l7-fuzz-as-external-aborted-extra";
const ITEMS = "l7-fuzz-av-external-start-changed-items";

const PINNED = JSON.parse(
  readFileSync(new URL("../fuzz/pinned.json", import.meta.url), "utf8"),
) as { group: string; spec: FuzzSpec }[];
const pinned = (group: string) =>
  (PINNED.find((p) => p.group === group) as { spec: FuzzSpec }).spec;

/** Steps of the ops given, with `external` records in the steps given. */
function trace(ops: string[], records: [number, unknown[]][]): TraceEntry[] {
  const out: TraceEntry[] = [];
  for (const [i, op] of ops.entries()) {
    out.push({ k: "step", i, step: { op } } as TraceEntry);
    out.push({ k: "async", i } as TraceEntry);
    for (const [at, data] of records) {
      if (at === i) {
        out.push({ k: "external", data } as TraceEntry);
      }
    }
  }

  return out;
}

/** The fuzz comparison of v2 against the reference, with every entry. */
function explainV2(
  reference: TraceEntry[],
  candidate: TraceEntry[],
  triggers: string[],
) {
  return explain(
    "fuzz",
    compareContract(reference, candidate, "v2"),
    readDivergences(),
    triggers,
    stepOps(reference),
  );
}

describe("row (as): an abort only in a settle step", () => {
  const aborted = ["aborted", "a.rb", 2, ["0.2"]];

  it("the entry names the settle step", () => {
    const entry = readDivergences().find((e) => e.id === AS)!;
    expect(entry.when).toEqual(["batched"]);
    expect(entry.during).toBe("settle");
  });

  it("a spurious 2.0 abort at step 0, with no settle and no retraction, is not covered", () => {
    const ops = ["tick", "settle"];
    const r = explainV2(trace(ops, []), trace(ops, [[0, aborted]]), [
      "batched",
    ]);
    expect(r.used).not.toContain(AS);
    expect(r.ended).toEqual([]);
    expect(r.unexplained.map((d) => [d.op, d.kind, d.step])).toEqual([
      ["extra", "aborted", 0],
    ]);
  });

  it("the same abort in a settle step is covered and ends the case; without the steps' ops it is not", () => {
    const ops = ["tick", "settle"];
    const reference = trace(ops, []);
    const candidate = trace(ops, [[1, aborted]]);
    const r = explainV2(reference, candidate, ["batched"]);
    expect(r.unexplained).toEqual([]);
    expect(r.ended.map((e) => [e.id, e.at.op, e.at.step])).toEqual([
      [AS, "extra", 1],
    ]);
    const blind = explain(
      "fuzz",
      compareContract(reference, candidate, "v2"),
      readDivergences(),
      ["batched"],
    );
    expect(blind.used).not.toContain(AS);
  });

  it("the pinned (as) case (seed 19's) is still covered: its abort comes in the last settle step", async () => {
    const def = toScenario(pinned("row-as"));
    const result = await runScenario(def);
    expect(result.report).toBe("");
    expect(result.ok).toBe(true);
    // The stop is the flushed call's start, which comes before its abort
    // (L7 follow-ups: row n's entries, which needed no timeout record, used
    // to absorb that start); both are row (as)'s.
    expect(result.ended.map((e) => [e.engine, e.id, e.at.op])).toEqual([
      ["v2", "l7-fuzz-as-external-start-extra", "extra"],
    ]);
    const at = result.ended[0]!.at.step;
    expect(stepOps(result.traces.reference).get(at)).toBe("settle");
  });
});

describe("row (av): a changed item only in a call whose items repeat on 1.35", () => {
  const start = (items: string[]) => ["start", "a.rb", 1, items];
  const triggers = ["batched", "batchAbortOn"];
  const ops = ["tick"];
  const shape = (r: ReturnType<typeof explainV2>) =>
    r.unexplained.map((d) => [d.op, d.kind, d.path]);

  it("2.0 dropping a distinct item (reference [0.1, 0.2], 2.0 [0.1]) is not covered", () => {
    const r = explainV2(
      trace(ops, [[0, start(["0.1", "0.2"])]]),
      trace(ops, [[0, start(["0.1"])]]),
      triggers,
    );
    expect(r.used).not.toContain(ITEMS);
    expect(shape(r)).toEqual([["changed", "start", "data[3][1]"]]);
  });

  it("2.0 replacing a distinct item (reference [0.1, 0.2], 2.0 [0.1, 0.3]) is not covered", () => {
    const r = explainV2(
      trace(ops, [[0, start(["0.1", "0.2"])]]),
      trace(ops, [[0, start(["0.1", "0.3"])]]),
      triggers,
    );
    expect(r.used).not.toContain(ITEMS);
    expect(shape(r)).toEqual([["changed", "start", "data[3][1]"]]);
  });

  it("1.35's duplicate (reference [0.0, 0.0], 2.0 [0.0]) and its reorder (a, b, a against b, a) are covered", () => {
    const dup = explainV2(
      trace(ops, [[0, start(["0.0", "0.0"])]]),
      trace(ops, [[0, start(["0.0"])]]),
      triggers,
    );
    expect(dup.unexplained).toEqual([]);
    expect(dup.used).toEqual([ITEMS]);
    const reorder = explainV2(
      trace(ops, [[0, start(["0.0", "0.1", "0.0"])]]),
      trace(ops, [[0, start(["0.1", "0.0"])]]),
      triggers,
    );
    expect(reorder.unexplained).toEqual([]);
    expect(reorder.used).toEqual([ITEMS]);
  });

  it("the pinned (av) moved case (deep seed 1's shape) still has its repeated item covered by the entry", async () => {
    const result = await runScenario(toScenario(pinned("av-moved")));
    expect(result.report).toBe("");
    expect(result.ok).toBe(true);
    expect(result.used).toContain(ITEMS);
    expect(
      (result.covered ?? [])
        .filter((c) => c.id === ITEMS)
        .map((c) => [c.difference.op, c.difference.record]),
    ).toEqual([
      [
        "changed",
        { k: "external", data: ["start", "a.rb", 1, ["0.0", "0.0"]] },
      ],
    ]);
  });
});

describe("the census validates during and a changed pattern's record", () => {
  const root = mkdtempSync(join(tmpdir(), "conformance-width-"));
  mkdirSync(join(root, "diff"), { recursive: true });
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const census = (entries: unknown[], used: string[]) => {
    writeFileSync(join(root, "diff/divergences.json"), JSON.stringify(entries));

    return [
      ...checkDivergences(root, new Set(used)),
      ...checkExcuses(root, null),
    ].join("\n");
  };
  const as = readDivergences().find((e) => e.id === AS)!;
  const items = readDivergences().find((e) => e.id === ITEMS)!;

  it("accepts both entries, and rejects an unknown step op, during on a hand entry, or a record that is not an object", () => {
    expect(census([as, items], [AS, ITEMS])).toBe("");
    expect(census([{ ...as, during: "wait" }], [AS])).toMatch(
      /during must be a fuzz step op/,
    );
    const { when: _w, ends: _e, group: _g, bound: _b, ...hand } = as;
    expect(census([{ ...hand, scenario: "hand", excuses: [] }], [AS])).toMatch(
      /has during, which only a fuzz entry may have/,
    );
    const bad = {
      ...items,
      bound: {
        match: items.bound!.match.map((m) => ({
          ...(m as object),
          record: "x",
        })),
      },
    };
    expect(census([bad], [ITEMS])).toMatch(
      /must be \{ path, from, to \} or \{ path, from, to, record \}/,
    );
  });
});
