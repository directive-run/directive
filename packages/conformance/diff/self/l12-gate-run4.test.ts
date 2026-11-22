// The L12 gate's run-4 harness changes and entries (GATE-12.md).
// - The logging plugin's lines as a per-engine projection, on the owner's
//   "Project, don't sign copies (Recommended)" (2026-11-22): a dropped line,
//   lines out of order against their hooks, or the plugin after the
//   recorder fails; the lines are not compared across engines.
// - Row (bx)'s remaining knock-ons, on the owner's "Yes, run 4
//   (Recommended)" with "Yes, widen (bx) to its knock-on effects
//   (Recommended)" (2026-11-22): a watch callback 2.0 delivered earlier with
//   the same version, a compute earlier in the same step, and a re-tracked
//   derivation's records. The same records without a fact-including watch
//   still fail.
// - Harness gaps: `dependencyKeys` admits `derive.<id>`, a signed move needs
//   both records to name the same derivation, and computes pair by id.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compareContract } from "../compare.js";
import { LIKE } from "../fingerprint.js";
import { LOG_LINES, logProjectionProblems } from "../log-projection.js";
import type { Json } from "../normalize.js";
import type { TraceEntry } from "../record.js";
import {
  FUZZ_SCENARIO,
  explain,
  fileMoves,
  markStale,
  readDivergences,
} from "../scenario.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const RUN4 = readDivergences().filter(
  (d) => d.group === "row-bx" && d.reason.includes("(L12 gate run 4)"),
);
const BX = readDivergences().filter((d) => d.group === "row-bx");
const ON = ["watchIncludesFacts", "distributableWatch"];

const step = (i: number, records: TraceEntry[], after: TraceEntry[] = []) =>
  [
    { k: "step", i, step: `step ${i}` },
    ...records,
    { k: "async", i },
    ...after,
  ] as TraceEntry[];
const compute = (id = "a::d1", value: Json = false): TraceEntry[] =>
  [
    { k: "hook", hook: "onDerivationCompute", args: [id, value, ["a::f0"]] },
    { k: "observe", event: { id, type: "derivation.compute", value } },
  ] as TraceEntry[];
const invalidate = (id = "a::d1") =>
  ({ k: "hook", hook: "onDerivationInvalidate", args: [id] }) as TraceEntry;
const notify = (id = "a::d1", value: Json = false) =>
  ({ k: "notify", id, value }) as TraceEntry;
const threw = (id = "a::d1") =>
  notify(id, { $throws: { $error: { name: "Error", message: "boom" } } });
const watch = (version: string, f0 = 1) =>
  ({
    k: "external",
    data: ["watch", { createdAt: 0, data: { d0: false, f0 }, version }],
  }) as TraceEntry;

/** What 2.0's records leave unexplained against 1.35's, by row (bx)'s entries. */
const left = (
  reference: TraceEntry[],
  candidate: TraceEntry[],
  triggers: string[] = ON,
) => {
  const diffs = fileMoves(
    FUZZ_SCENARIO,
    markStale(compareContract(reference, candidate, "v2"), reference),
    BX,
    triggers,
  );

  return explain(FUZZ_SCENARIO, diffs, BX, triggers)
    .unexplained.map(
      (d) =>
        `${d.op} ${d.stream} ${d.kind} ${d.step}${d.path ? ` ${d.path}` : ""}`,
    )
    .sort();
};

describe("the logging plugin as a per-engine projection", () => {
  const line = (hook: string) => {
    const [level, name] = LOG_LINES[hook] as [string, string];

    return {
      k: "external",
      data: ["log", level, `[Directive] ${name}`],
    } as TraceEntry;
  };
  const hook = (name: string, args: Json[] = []) =>
    ({ k: "hook", hook: name, args }) as TraceEntry;
  const good: TraceEntry[] = [
    line("onInit"),
    { k: "step", i: 0, step: "start" } as TraceEntry,
    line("onFactsBatch"),
    hook("onFactsBatch", [[]]),
    { k: "notify", id: "f0", value: 0 } as TraceEntry,
    line("onStart"),
    hook("onStart"),
    hook("onInit"),
    line("onResolverWriteRejected"),
    { k: "external", data: ["clobber alert", {}] } as TraceEntry,
    hook("onResolverWriteRejected", [{}]),
    line("onReconcileStart"),
    hook("onReconcileStart", [{}]),
  ];

  it("pins the hook -> line table to both engines' plugin source", () => {
    for (const engine of ["core", "core-next"]) {
      const src = readFileSync(
        join(ROOT, `packages/${engine}/src/plugins/logging.ts`),
        "utf8",
      );
      const table: Record<string, [string, string]> = {};
      for (const chunk of src.split(/\n {4}(?=on[A-Z]\w*: )/).slice(1)) {
        const name = /^(on\w+):/.exec(chunk)?.[1] as string;
        const calls = [...chunk.matchAll(/log\(\s*"(\w+)",\s*"([\w.]+)"/g)];
        expect(new Set(calls.map((c) => `${c[1]} ${c[2]}`)).size).toBe(1);
        table[name] = [calls[0]?.[1] as string, calls[0]?.[2] as string];
      }
      expect(table).toEqual(LOG_LINES);
    }
  });

  it("control: every line right before its hook, init before onInit, passes", () => {
    expect(logProjectionProblems(good, true)).toEqual([]);
  });

  it("a dropped line, a line out of order, or the plugin after the recorder fails", () => {
    const dropped = good.filter((_, i) => i !== 5);
    expect(logProjectionProblems(dropped, true)).toHaveLength(1);
    const reordered = [...good];
    [reordered[2], reordered[5]] = [reordered[5], reordered[2]] as [
      TraceEntry,
      TraceEntry,
    ];
    expect(logProjectionProblems(reordered, true).length).toBeGreaterThan(0);
    // Lines after the hooks they report: the plugin after the recorder.
    const after = [...good];
    [after[2], after[3]] = [after[3], after[2]] as [TraceEntry, TraceEntry];
    expect(logProjectionProblems(after, true).length).toBeGreaterThan(0);
    // A line at the wrong level, a missing or second init, no plugin.
    const level = good.map((e, i) =>
      i === 5
        ? ({
            k: "external",
            data: ["log", "debug", "[Directive] start"],
          } as TraceEntry)
        : e,
    );
    expect(logProjectionProblems(level, true).length).toBeGreaterThan(0);
    // The init line after the onInit record.
    expect(
      logProjectionProblems([...good.slice(1), good[0] as TraceEntry], true)
        .length,
    ).toBeGreaterThan(0);
    expect(logProjectionProblems(good.slice(1), true).length).toBeGreaterThan(
      0,
    );
    expect(
      logProjectionProblems([...good, hook("onInit")], true).length,
    ).toBeGreaterThan(0);
    expect(logProjectionProblems(good, false)).toHaveLength(1);
    expect(
      logProjectionProblems(
        good.filter(
          (e) => e.k !== "external" || (e.data as Json[])[0] !== "log",
        ),
        true,
      ).length,
    ).toBeGreaterThan(0);
  });

  it("the cross-engine diff drops the lines, and only them", () => {
    const noLines = good.filter(
      (e) => !(e.k === "external" && (e.data as Json[])[0] === "log"),
    );
    expect(compareContract(good, noLines, "v2")).toEqual([]);
    expect(
      compareContract(good, noLines.slice(0, -1), "v2").map((d) => d.kind),
    ).toEqual(["onReconcileStart"]);
  });
});

describe("row (bx), run 4: the remaining knock-ons, and no other", () => {
  it("is signed on the owner's instruction, quoting the owner's words", () => {
    expect(RUN4.map((d) => d.id).sort()).toEqual(
      [
        "l12-fuzz-bx-external-watch-missing",
        "l12-fuzz-bx-observe-derivation-compute-moved-same-step",
        "l12-fuzz-bx-hook-onDerivationCompute-moved-same-step",
        "l12-fuzz-bx-hook-onDerivationCompute-retracked-extra",
        "l12-fuzz-bx-observe-derivation-compute-retracked-extra",
        "l12-fuzz-bx-hook-onDerivationInvalidate-retracked-extra",
        "l12-fuzz-bx-notify-derivation-retracked-extra",
        "l12-fuzz-bx-hook-onDerivationCompute-closing-missing",
        "l12-fuzz-bx-observe-derivation-compute-closing-missing",
      ].sort(),
    );
    for (const d of RUN4) {
      expect(d.reason).toContain("Signed on the owner's instruction");
      expect(d.reason).toContain('"Yes, run 4 (Recommended)" (2026-11-22)');
      expect(d.reason).toContain(
        '"Yes, widen (bx) to its knock-on effects (Recommended)" (2026-11-22)',
      );
      expect(d.when).toEqual(["watchIncludesFacts"]);
      expect(d.engine).toBe("v2");
    }
  });

  describe("a watch callback 2.0 delivered earlier (seeds 6, 8, 17)", () => {
    const v1 = [...step(3, []), ...step(4, [watch("e")])];
    it("control: the same version earlier is excused", () => {
      expect(left(v1, [...step(3, [watch("e")]), ...step(4, [])])).toEqual([]);
    });
    it("another version earlier, a later delivery, none, or no fact-including watch fails", () => {
      expect(left(v1, [...step(3, [watch("x")]), ...step(4, [])])).toEqual([
        "missing external watch 4",
      ]);
      expect(
        left(v1, [...step(3, []), ...step(4, []), ...step(5, [watch("e")])]),
      ).toEqual(["missing external watch 4"]);
      expect(left(v1, [...step(3, []), ...step(4, [])])).toEqual([
        "missing external watch 4",
      ]);
      expect(
        left(
          v1,
          [...step(3, [watch("e")]), ...step(4, [])],
          ["distributableWatch"],
        ),
      ).toEqual(["extra external watch 3", "missing external watch 4"]);
    });
  });

  describe("a compute earlier in the same step (seed 15)", () => {
    const v1 = step(2, [], compute());
    it("control: earlier in the same step is excused", () => {
      expect(left(v1, step(2, compute()))).toEqual([]);
    });
    it("later in the step, another derivation, or no fact-including watch fails", () => {
      expect(left(step(2, compute()), step(2, [], compute()))).toEqual([
        "extra hook onDerivationCompute 2",
        "extra observe derivation.compute 2",
        "missing hook onDerivationCompute 2",
        "missing observe derivation.compute 2",
      ]);
      // Both derivations computed before, so neither is re-tracked.
      const before = step(1, [...compute(), ...compute("a::d2")]);
      expect(
        left([...before, ...v1], [...before, ...step(2, compute("a::d2"))]),
      ).toHaveLength(4);
      expect(left(v1, step(2, compute()), [])).toHaveLength(4);
    });
  });

  describe("a signed move needs the same derivation (seed 19)", () => {
    it("computes pair by id: 1.35's [b::d0, z::h0] against 2.0's z::h0 a step earlier", () => {
      const v1 = [
        ...step(8, []),
        ...step(9, [...compute("b::d0"), ...compute("z::h0")]),
      ];
      const v2 = [...step(8, compute("z::h0")), ...step(9, compute("b::d0"))];
      expect(
        compareContract(v1, v2, "v2").filter((d) => d.op === "changed"),
      ).toEqual([]);
      expect(left(v1, v2)).toEqual([]);
    });
    it("a move between two different derivations is not excused", () => {
      const before = step(1, [...compute(), ...compute("a::d2")]);
      expect(
        left(
          [...before, ...step(12, []), ...step(13, compute("a::d1"))],
          [...before, ...step(12, compute("a::d2")), ...step(13, [])],
        ),
      ).toEqual([
        "extra hook onDerivationCompute 12",
        "extra observe derivation.compute 12",
        "missing hook onDerivationCompute 13",
        "missing observe derivation.compute 13",
      ]);
    });
  });

  describe("a re-tracked derivation (seeds 3, 10)", () => {
    const retracked = [...compute(), invalidate(), ...compute(), notify()];
    const v1 = [
      ...step(12, [threw()]),
      ...step(13, []),
      ...step(14, [], compute()),
    ];
    const v2 = [
      ...step(12, [threw()]),
      ...step(13, retracked),
      ...step(14, []),
    ];
    it("control: after a throw, or before any compute, its records are excused", () => {
      expect(left(v1, v2)).toEqual([]);
      expect(
        left(
          [...step(13, []), ...step(14, [], compute())],
          [...step(13, retracked), ...step(14, [])],
        ),
      ).toEqual([]);
    });
    it("after a good compute on 1.35, or with no fact-including watch, they fail", () => {
      const fresh = [
        ...step(12, compute()),
        ...step(13, []),
        ...step(14, [], compute()),
      ];
      expect(
        left(fresh, [
          ...step(12, compute()),
          ...step(13, retracked),
          ...step(14, []),
        ]),
      ).toEqual([
        "extra hook onDerivationCompute 13",
        "extra hook onDerivationInvalidate 13",
        "extra notify a::d1 13",
        "extra observe derivation.compute 13",
      ]);
      expect(left(v1, v2, ["distributableWatch"]).length).toBeGreaterThan(4);
    });
    it("a closing compute 2.0 never made earlier, or a thrown notify, fails", () => {
      expect(
        left(v1, [...step(12, [threw()]), ...step(13, []), ...step(14, [])]),
      ).toEqual([
        "missing hook onDerivationCompute 14",
        "missing observe derivation.compute 14",
      ]);
      expect(
        left(v1.slice(0, -2), [
          ...step(12, [threw()]),
          ...step(13, [threw()]),
          ...step(14, []),
        ]),
      ).toEqual(["extra notify a::d1 13"]);
    });
  });

  it("a re-tracked derivation throwing again, and h0, are covered; other errors are not (seeds 5, 8, 17)", () => {
    const boom = (m: string) =>
      notify("a::d1", { $throws: { $error: { name: "Error", message: m } } });
    const v1 = [
      ...step(12, [threw()]),
      ...step(13, []),
      ...step(14, [], compute()),
    ];
    // The closing compute's observation is judged before its hook (seed 5).
    expect(
      left(v1, [
        ...step(12, [threw()]),
        ...step(13, [...compute(), boom("a.d1 throws at 4")]),
        ...step(14, []),
      ]),
    ).toEqual([]);
    expect(
      left(v1, [
        ...step(12, [threw()]),
        ...step(13, [...compute(), boom("something else")]),
        ...step(14, []),
      ]),
    ).toEqual(["extra notify a::d1 13"]);
    expect(
      left(
        [...step(6, []), ...step(7, compute("h0", 0))],
        [...step(6, compute("h0", 0)), ...step(7, [])],
      ),
    ).toEqual([]);
  });

  it("dependencyKeys admits derive.<id>, and only a derivation's", () => {
    const keys = LIKE.dependencyKeys as (v: Json) => boolean;
    expect(keys(["a::f1", "derive.a::d0", "derive.d1"])).toBe(true);
    expect(keys(["z::g0"])).toBe(true);
    expect(keys(["g1"])).toBe(true);
    expect(keys(["derive.f0"])).toBe(false);
    expect(keys(["derive.x"])).toBe(false);
    expect(keys(["z::g2"])).toBe(false);
  });
});
