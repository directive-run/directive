/**
 * L7 follow-ups (before L8-pre): the harness and oracle changes for the deep
 * runs' batched cases.
 *
 * - A reported case's file holds v2's trace as its candidate and 1.35's as
 *   its reference (lib/fuzz.ts `caseFile`), not the workspace 1.x engine's.
 * - A `twin` step's settle() goes through the shared wait (diff/scenario.ts
 *   `settleShared`): deep cases 24301/372 and 2/3718 compare equal.
 * - Row n's batch entries require 2.0's own timeout record of a batch call
 *   at or before the difference (`requires`): a missing batch start with no
 *   timeout record is not covered (deep case 1/1967 hid the re-raise bug).
 * - A record one step earlier on 2.0 is a move (`by` -1), covered only by
 *   an entry for that direction: row (as)'s unhandled rejection (24301/530).
 * - An `ends` stop drops its own record's other changed fields
 *   (`sameRecord`, 24301/4050), never another record's.
 * - The 2/352 entries cover a late write's clobbered report only after
 *   `destroy` (`afterOp`).
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { caseFile } from "../../lib/fuzz.js";
import { compareContract } from "../compare.js";
import { type FuzzSpec, toScenario } from "../fuzz/model.js";
import type { TraceEntry } from "../record.js";
import {
  type Divergence,
  covers,
  explain,
  fileMoves,
  readDivergences,
  runScenario,
} from "../scenario.js";

const ALL = readDivergences();
const entry = (id: string) => ALL.find((e) => e.id === id) as Divergence;
const PINNED = JSON.parse(
  readFileSync(new URL("../fuzz/pinned.json", import.meta.url), "utf8"),
) as { group: string; spec: FuzzSpec }[];

/** Deep seed 24301, case 372: the twin step's batch times out on 2.0. */
const CASE_372: FuzzSpec = JSON.parse(
  '{"modules":[{"facts":2,"date":true,"derivations":[],"events":[{"target":1,"add":true}],"constraints":[{"fact":1,"atLeast":0,"crossAtLeast":null,"priority":2,"writes":0,"value":2,"delay":5,"fails":0,"retry":1,"timeout":3},{"fact":0,"atLeast":1,"crossAtLeast":null,"priority":0,"writes":0,"value":5,"delay":5,"fails":2,"retry":0,"timeout":10}],"effects":[{"reads":[1,0],"explicitDeps":true,"cleanup":true,"throwsAt":8}],"source":null},{"facts":1,"date":false,"derivations":[{"facts":[0],"derived":[],"threshold":3,"throwsAt":4}],"events":[{"target":0,"add":true}],"constraints":[{"fact":0,"atLeast":2,"crossAtLeast":3,"priority":1,"writes":0,"value":0,"delay":1,"fails":2,"retry":1,"timeout":3}],"effects":[],"source":{"gated":false}}],"boundary":"throw","history":false,"trace":false,"steps":[{"op":"twin"},{"op":"batch","module":0,"writes":[[1171218904,-2]]},{"op":"dispatch","module":0,"event":1464331173,"value":2},{"op":"advance","ms":1},{"op":"dispatch","module":1,"event":559212777,"value":-2},{"op":"tick"},{"op":"set","module":1,"fact":1665393658,"value":2},{"op":"batch","module":1,"writes":[[1083354867,-1],[661934811,-2],[215397141,4]]},{"op":"batch","module":0,"writes":[[202170893,4],[147006190,6],[680297351,1]]}],"batch":{"sources":[{"fact":2,"atLeast":0,"items":2,"abortOn":true},{"fact":2,"atLeast":2,"items":2,"abortOn":false}],"handler":"results","failing":"all","windowMs":0,"maxSize":1,"delay":20,"fails":0,"retry":1,"timeout":3,"writes":1,"value":6}}',
);
/** Deep seed 2, case 3718: the twin's write lands in the twin step on 2.0. */
const CASE_3718: FuzzSpec = JSON.parse(
  '{"modules":[{"facts":2,"date":true,"derivations":[{"facts":[0],"derived":[],"threshold":6,"throwsAt":7}],"events":[{"target":0,"add":false}],"constraints":[{"fact":1,"atLeast":0,"crossAtLeast":null,"priority":1,"writes":1,"value":1,"delay":0,"fails":0,"retry":2,"timeout":3}],"effects":[{"reads":[0,1],"explicitDeps":true,"cleanup":false,"throwsAt":6}],"source":{"gated":false}},{"facts":1,"date":true,"derivations":[{"facts":[0],"derived":[],"threshold":4,"throwsAt":3},{"facts":[0],"derived":[0],"threshold":4,"throwsAt":3}],"events":[{"target":0,"add":false}],"constraints":[{"fact":0,"atLeast":2,"crossAtLeast":3,"priority":1,"writes":0,"value":2,"delay":0,"fails":1,"retry":2,"timeout":3},{"fact":0,"atLeast":2,"crossAtLeast":3,"priority":0,"writes":0,"value":2,"delay":1,"fails":1,"retry":0,"timeout":10}],"effects":[],"source":null}],"boundary":"skip","history":false,"trace":false,"steps":[{"op":"dispatch","module":0,"event":1800768996,"value":-2},{"op":"twin"}],"batch":{"sources":[{"fact":1,"atLeast":1,"items":1,"abortOn":true}],"handler":"results","failing":"some","windowMs":5,"maxSize":2,"delay":1,"fails":1,"retry":1,"timeout":null,"writes":0,"value":-1}}',
);

/** Steps 0 to 3 (ops given), each with the records given for it. */
function trace(ops: string[], records: [number, TraceEntry][]): TraceEntry[] {
  const out: TraceEntry[] = [];
  ops.forEach((op, i) => {
    out.push({ k: "step", i, step: { op } } as TraceEntry);
    out.push({ k: "async", i } as TraceEntry);
    for (const [at, r] of records) {
      if (at === i) {
        out.push(r);
      }
    }
  });

  return out;
}
const ext = (...data: unknown[]) => ({ k: "external", data }) as TraceEntry;
const OPS = ["start", "set", "advance", "settle"];

describe("L7 follow-ups", () => {
  it("a reported case's file holds v2's trace as its candidate and 1.35's as its reference", async () => {
    const pin = PINNED.find((p) => p.group === "row-as-moved");
    expect(pin).toBeDefined();
    const result = await runScenario(toScenario(pin!.spec));
    const v2 = result.engineTraces?.v2;
    const local = result.engineTraces?.local;
    expect(v2?.length).toBeGreaterThan(0);
    // The case shows 2.0's early rejection, so the two candidates differ.
    expect(JSON.stringify(v2)).not.toBe(JSON.stringify(local));
    const dir = mkdtempSync(join(tmpdir(), "l7f-case-"));
    try {
      const file = join(dir, "case-1.json");
      writeFileSync(file, JSON.stringify(caseFile({ seed: 1 }, result)));
      const read = JSON.parse(readFileSync(file, "utf8"));
      expect(read.traces.candidateEngine).toBe("v2");
      expect(read.traces.candidate).toEqual(JSON.parse(JSON.stringify(v2)));
      expect(read.traces.reference).toEqual(
        JSON.parse(JSON.stringify(result.traces.reference)),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a twin step's settle() goes through the shared wait: deep cases 24301/372 and 2/3718 compare equal", async () => {
    for (const spec of [CASE_372, CASE_3718]) {
      const result = await runScenario(toScenario(spec));
      expect(result.compared).toContain("v2");
      expect(result.report).toBe("");
      expect(result.ok).toBe(true);
    }
  });

  it("row n's batch entries need 2.0's timeout record of a batch call at or before the difference", () => {
    const rowN = ALL.filter((e) => e.group === "quirk-n-batch");
    const triggers = ["batched", "batchTimeout"];
    const start = ext("start", "a.rb", 2, ["0.0"]);
    const timeout = ext("timeout", "a.rb", 1, ["0.0"]);
    const mark = ext("effect", "a.x0", [1]);
    const ref = trace(OPS, [
      [3, start],
      [3, mark],
    ]);
    const unexplained = (cand: TraceEntry[]) =>
      explain(
        "fuzz",
        compareContract(ref, cand, "v2"),
        rowN,
        triggers,
      ).unexplained.map((d) => `${d.op} ${d.kind}`);
    // No timeout record: the missing batch start is not covered.
    expect(unexplained(trace(OPS, [[3, mark]]))).toEqual(["missing start"]);
    // A single resolver's timeout is not the batch's.
    expect(
      unexplained(
        trace(OPS, [
          [2, ext("timeout", "a.r0", 1)],
          [3, mark],
        ]),
      ),
    ).toContain("missing start");
    // A batch call's timeout after the missing start (past a record both
    // traces match) does not cover it.
    expect(
      unexplained(
        trace(OPS, [
          [3, mark],
          [3, timeout],
        ]),
      ),
    ).toContain("missing start");
    // 2.0's timeout record of a batch call before it: covered (row n).
    expect(
      unexplained(
        trace(OPS, [
          [2, timeout],
          [3, mark],
        ]),
      ),
    ).toEqual([]);
  });

  it("a record one step earlier on 2.0 is a move only an entry with by -1 covers: row (as)'s unhandled rejection", () => {
    const moved = entry("l7-fuzz-as-error-unhandled-moved");
    const triggers = ["batched", "throw"];
    const rejection = {
      k: "unhandled",
      error: {
        $error: {
          name: "DirectiveError",
          message: "a.rb attempt 1",
          context: {
            fromConstraint: "b0",
            id: 'AB:{"item":"0.0"}',
            requirement: { item: "0.0", type: "AB" },
          },
          recoverable: true,
          source: "resolver",
          sourceId: "rb",
        },
      },
    } as TraceEntry;
    const filed = (ref: TraceEntry[], cand: TraceEntry[]) => {
      const ds = fileMoves(
        "fuzz",
        compareContract(ref, cand, "v2"),
        [moved],
        triggers,
      );

      return {
        shape: ds.map((d) => `${d.op} ${d.step}${d.by ? ` by ${d.by}` : ""}`),
        unexplained: explain("fuzz", ds, [moved], triggers).unexplained.length,
      };
    };
    const ops = ["start", "set", "settle", "settle"];
    // One step earlier on 2.0: one move, covered.
    expect(
      filed(trace(ops, [[3, rejection]]), trace(ops, [[2, rejection]])),
    ).toEqual({
      shape: ["moved 3 by -1"],
      unexplained: 0,
    });
    // One step later on 2.0: not this entry's direction.
    expect(
      filed(trace(ops, [[2, rejection]]), trace(ops, [[3, rejection]]))
        .unexplained,
    ).toBe(2);
    // An absence on 2.0, or an extra rejection: not covered.
    expect(
      filed(trace(ops, [[3, rejection]]), trace(ops, [])).unexplained,
    ).toBe(1);
    expect(
      filed(
        trace(ops, [[3, rejection]]),
        trace(ops, [
          [2, rejection],
          [3, rejection],
        ]),
      ).unexplained,
    ).toBe(1);
    // Without the "throw" boundary there is no such rejection to move.
    expect(
      fileMoves(
        "fuzz",
        compareContract(
          trace(ops, [[3, rejection]]),
          trace(ops, [[2, rejection]]),
          "v2",
        ),
        [moved],
        ["batched"],
      )
        .map((d) => d.op)
        .sort(),
    ).toEqual(["extra", "missing"]);
  });

  it("an ends stop drops its own record's other changed fields, never another record's", () => {
    const stop: Divergence = {
      id: "test-ends-items",
      scenario: "fuzz",
      stream: "external",
      kind: "wrote",
      engine: "v2",
      op: "changed",
      path: "data[3][0]",
      ends: true,
      when: ["batched"],
      reason: "test",
      approvedBy: "test",
      date: "2026-11-10",
    };
    const ref = trace(OPS, [
      [2, ext("wrote", "a.rb", 1, ["1.0", "1.1", "1.2"])],
      [3, ext("start", "a.r0", 1)],
    ]);
    const cand = trace(OPS, [
      [2, ext("wrote", "a.rb", 1, ["0.0", "0.1", "1.0", "1.1", "1.2"])],
      [3, ext("start", "a.r0", 1)],
    ]);
    const ds = compareContract(ref, cand, "v2");
    expect(ds.filter((d) => d.op === "changed").length).toBeGreaterThan(1);
    const out = explain("fuzz", ds, [stop], ["batched"]);
    expect(out.unexplained).toEqual([]);
    expect(out.ended[0]?.dropped).toBe(ds.length - 1);
    // Another record (a different call number in a separate record) stays compared.
    // A changed record before the stop's is not its sibling: still compared.
    const other = trace(OPS, [
      [2, ext("aborted", "a.rb", 1, ["1.0"])],
      [2, ext("wrote", "a.rb", 1, ["0.0", "0.1", "1.0", "1.1", "1.2"])],
    ]);
    const ref2 = trace(OPS, [
      [2, ext("aborted", "a.rb", 1, ["1.1"])],
      [2, ext("wrote", "a.rb", 1, ["1.0", "1.1", "1.2"])],
    ]);
    const kept = explain(
      "fuzz",
      compareContract(ref2, other, "v2"),
      [stop],
      ["batched"],
    ).unexplained;
    expect(kept.map((d) => `${d.kind} ${d.path}`)).toEqual([
      "aborted data[3][0]",
    ]);
  });

  it("the 2/352 entries cover a late write's clobbered report only after destroy", () => {
    const hook = entry("l7-fuzz-destroy-hook-onResolverWriteRejected-missing");
    const record = {
      k: "hook",
      hook: "onResolverWriteRejected",
      args: [
        {
          actual: 0,
          expected: 4,
          fact: "a::f0",
          kind: "rejection",
          reason: "clobbered",
          req: {
            fromConstraint: "a::b0",
            id: 'AB:{"item":"0.0"}',
            requirement: { item: "0.0", type: "AB" },
          },
          resolver: "a::rb",
        },
      ],
    } as TraceEntry;
    const triggers = ["batched", "batchAbortOn"];
    for (const [ops, covered] of [
      [["start", "set", "destroy", "settle"], true],
      [["start", "set", "stop", "settle"], false],
    ] as const) {
      const ref = trace([...ops], [[3, record]]);
      const [d] = compareContract(ref, trace([...ops], []), "v2");
      const steps = new Map(ops.map((op, i) => [i, op] as [number, string]));
      expect(covers(hook, "fuzz", d!, triggers, steps)).toBe(covered);
    }
  });
});
