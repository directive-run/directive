/**
 * A record one step later is one `moved` difference (diff/compare.ts
 * `Difference.op`), never a missing plus an extra, and an entry for a move
 * covers only that move. Row (av)'s early flush on 1.35 (deep seed 1:
 * 1.35's queue holds the re-raised item twice, which fills `maxSize` 2 and
 * flushes a step before 2.0's window timer) is covered by
 * `l7-fuzz-av-external-start-moved`; a 2.0 that drops the batch still
 * fails, and the entry admits neither an absence nor a delayed call of
 * distinct items.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkDivergences } from "../../lib/census.js";
import { type Difference, compareContract } from "../compare.js";
import { type EngineHandle, engines } from "../engines.js";
import { LIKE, generalizeValue } from "../fingerprint.js";
import { type FuzzSpec, toScenario } from "../fuzz/model.js";
import type { TraceEntry } from "../record.js";
import {
  covers,
  fileMoves,
  readDivergences,
  runScenario,
} from "../scenario.js";

const MOVED = "l7-fuzz-av-external-start-moved";
const ITEMS = "l7-fuzz-av-external-start-changed-items";

/** Deep seed 1 (DIFF_FUZZ_RUNS=5000): row (av)'s doubled queue fills maxSize 2. */
const SEED_1: FuzzSpec = JSON.parse(
  '{"modules":[{"facts":2,"date":false,"derivations":[],"events":[{"target":0,"add":false}],"constraints":[],"effects":[],"source":null},{"facts":3,"date":false,"derivations":[],"events":[{"target":0,"add":false}],"constraints":[],"effects":[],"source":null}],"boundary":null,"history":false,"trace":false,"steps":[{"op":"set","module":0,"fact":0,"value":-1},{"op":"dispatch","module":0,"event":0,"value":0}],"batch":{"sources":[{"fact":0,"atLeast":0,"items":1,"abortOn":true}],"handler":"batch","failing":"all","windowMs":0,"maxSize":2,"delay":0,"fails":0,"retry":0,"timeout":null,"writes":0,"value":0}}',
);

const [, local, v2] = engines() as [EngineHandle, EngineHandle, EngineHandle];

/** v2 without the batched resolver: its batch never starts (a tamper). */
function dropsTheBatch(engine: EngineHandle): EngineHandle {
  return {
    ...engine,
    async load() {
      const core = await engine.load();

      return {
        ...core,
        createModule(id: string, def: any) {
          const { rb: _rb, ...resolvers } = def.resolvers ?? {};

          return (core as any).createModule(id, { ...def, resolvers });
        },
      } as typeof core;
    },
  };
}

/** Steps 0 to 2, with `start` records in the steps given. */
function trace(starts: [number, string[]][]): TraceEntry[] {
  const out: TraceEntry[] = [];
  for (const i of [0, 1, 2]) {
    out.push({ k: "step", i, step: { op: "tick" } } as TraceEntry);
    for (const [at, items] of starts) {
      if (at === i) {
        out.push({
          k: "external",
          data: ["start", "a.rb", 1, items],
        } as TraceEntry);
      }
    }
    out.push({ k: "async", i } as TraceEntry);
  }

  return out;
}

const shape = (ds: Difference[]) =>
  ds.map((d) => [d.op, d.kind, d.step, d.path ?? ""]);

describe("a moved record", () => {
  it("a missing record and the same kind extra one step later are one move where a moved entry covers it, its other fields changed differences of their own", () => {
    const entry = readDivergences().find((e) => e.id === MOVED)!;
    const triggers = ["batched", "batchAbortOn", "batchMaxSize"];
    const filed = (ref: TraceEntry[], cand: TraceEntry[], t = triggers) =>
      shape(fileMoves("fuzz", compareContract(ref, cand, "v2"), [entry], t));
    expect(
      filed(trace([[1, ["0.0", "0.0"]]]), trace([[2, ["0.0", "0.0"]]])),
    ).toEqual([["moved", "start", 1, ""]]);
    expect(filed(trace([[1, ["0.0", "0.0"]]]), trace([[2, ["0.0"]]]))).toEqual([
      ["moved", "start", 1, ""],
      ["changed", "start", 1, "data[3][1]"],
    ]);
    // No covering moved entry (distinct items, no maxSize trigger, or no
    // entry at all): the pair stays a missing and an extra.
    const pair = [
      ["missing", "start", 1, ""],
      ["extra", "start", 2, ""],
    ];
    expect(
      filed(trace([[1, ["0.0", "0.1"]]]), trace([[2, ["0.0", "0.1"]]])),
    ).toEqual(pair);
    expect(
      filed(trace([[1, ["0.0", "0.0"]]]), trace([[2, ["0.0"]]]), [
        "batched",
        "batchAbortOn",
      ]),
    ).toEqual(pair);
    expect(
      shape(
        fileMoves(
          "fuzz",
          compareContract(
            trace([[1, ["0.0", "0.0"]]]),
            trace([[2, ["0.0"]]]),
            "v2",
          ),
          [],
          triggers,
        ),
      ),
    ).toEqual(pair);
    // Two steps later, or a step earlier, is no move.
    expect(
      filed(trace([[0, ["0.0", "0.0"]]]), trace([[2, ["0.0", "0.0"]]])),
    ).toEqual([
      ["missing", "start", 0, ""],
      ["extra", "start", 2, ""],
    ]);
    expect(
      filed(trace([[2, ["0.0", "0.0"]]]), trace([[1, ["0.0", "0.0"]]])),
    ).toEqual([
      ["extra", "start", 1, ""],
      ["missing", "start", 2, ""],
    ]);
  });

  it("deep seed 1: row (av)'s early flush on 1.35 is covered as a move, which ends the case, and the repeated item is still compared", async () => {
    const def = toScenario(SEED_1);
    expect(def.triggers).toContain("batchMaxSize");
    const result = await runScenario(def, { candidates: [local, v2] });
    expect(result.report).toBe("");
    expect(result.ok).toBe(true);
    expect(result.ended.map((e) => [e.engine, e.id, e.at.op])).toEqual([
      ["v2", MOVED, "moved"],
    ]);
    expect(result.used).toEqual(expect.arrayContaining([MOVED, ITEMS]));
    expect(
      (result.covered ?? [])
        .filter((c) => c.id === ITEMS)
        .map((c) => [c.difference.op, c.difference.path]),
    ).toEqual([["changed", "data[3][1]"]]);
  });

  it("a 2.0 tampered to drop the batch still fails: its start is missing, not moved", async () => {
    const result = await runScenario(toScenario(SEED_1), {
      candidates: [dropsTheBatch(v2)],
    });
    expect(result.ok).toBe(false);
    expect(result.used).not.toContain(MOVED);
    expect(
      result.unexplained.some(
        (d) => d.op === "missing" && d.kind === "start" && d.step === 2,
      ),
    ).toBe(true);
  });

  it("the entry covers a move of 1.35's call with a repeated item only: never an absence, a call of distinct items, or a case without a maxSize", () => {
    const entry = readDivergences().find((e) => e.id === MOVED)!;
    expect(entry.when).toEqual(["batched", "batchAbortOn", "batchMaxSize"]);
    const triggers = ["batched", "batchAbortOn", "batchMaxSize"];
    const diff = (op: Difference["op"], items: string[]): Difference =>
      ({
        engine: "v2",
        stream: "external",
        kind: "start",
        step: 2,
        phase: "async",
        op,
        reference: { k: "external", data: ["start", "a.rb", 1, items] },
        candidate:
          op === "missing"
            ? undefined
            : { k: "external", data: ["start", "a.rb", 1, items] },
        at: { reference: 1, candidate: 2 },
        where: {},
        shared: { reference: -1, candidate: -1 },
      }) as unknown as Difference;
    expect(covers(entry, "fuzz", diff("moved", ["0.0", "0.0"]), triggers)).toBe(
      true,
    );
    expect(
      covers(entry, "fuzz", diff("missing", ["0.0", "0.0"]), triggers),
    ).toBe(false);
    expect(covers(entry, "fuzz", diff("moved", ["0.0", "0.1"]), triggers)).toBe(
      false,
    );
    expect(
      covers(entry, "fuzz", diff("moved", ["0.0", "0.0"]), [
        "batched",
        "batchAbortOn",
      ]),
    ).toBe(false);
    expect(LIKE.batchItemsRepeated?.(["0.1", "0.0", "0.1"])).toBe(true);
    expect(LIKE.batchItemsRepeated?.(["0.0", "0.1"])).toBe(false);
    expect(LIKE.batchItemsRepeated?.(["0.0"])).toBe(false);
    // generalize never picks it: a hand-named class.
    expect(generalizeValue(["0.0", "0.0"])).toEqual([
      { $like: "batchItem" },
      { $like: "batchItem" },
    ]);
  });
});

describe("the census validates moved", () => {
  const root = mkdtempSync(join(tmpdir(), "conformance-moved-"));
  mkdirSync(join(root, "diff"), { recursive: true });
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const census = (entries: unknown[]) => {
    writeFileSync(join(root, "diff/divergences.json"), JSON.stringify(entries));

    return checkDivergences(root, new Set([MOVED])).join("\n");
  };
  const entry = readDivergences().find((e) => e.id === MOVED)!;

  it("accepts the (av) moved entry, and rejects a path on a move or an unknown op", () => {
    expect(census([entry])).toBe("");
    expect(census([{ ...entry, path: "data[3]" }])).toMatch(
      /has op "moved" and a path/,
    );
    expect(census([{ ...entry, op: "shifted" }])).toMatch(
      /op must be missing, extra, changed or moved/,
    );
  });
});
