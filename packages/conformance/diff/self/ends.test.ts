/**
 * An `ends` divergence stops the comparison of a fuzz case at the
 * difference it covers, and nowhere else (Jason, 2026-11-01: "The fuzz
 * compares a case exactly up to its first approved-quirk difference, then
 * stops comparing that case. Everything before it is still checked, and
 * hand scenarios still check after it."). Each test proves one edge of how
 * wide that is: what is still reported before and at the stop, what is not
 * after it, that an ordinary entry, another engine and a hand scenario never
 * stop, that a difference in the same gap as the stop (between the same two
 * matched records, in either trace) is past it too (Jason, 2026-11-01:
 * "ends entries also dropping differences beside the stop"), but only when
 * an `ends` entry made the stop in a case with its trigger, and that one
 * before the gap is still compared, that the census accepts `ends` only on a signed, narrow
 * fuzz entry (engine "v2", an op, a path for "changed"; `when`, proved in
 * precision.test.ts) and finds it stale
 * when it never stopped a case, and that an ended case still counts toward
 * the fuzz floors and is shown on the census's fuzz line.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  checkDivergences,
  checkFuzzRuns,
  checkScenarioLayers,
  describeFuzzRun,
} from "../../lib/census.js";
import { FUZZ_FLOOR } from "../../lib/fuzz.js";
import { type Difference, compareContract } from "../compare.js";
import { type EngineHandle, engines } from "../engines.js";
import type { Json } from "../normalize.js";
import type { TraceEntry } from "../record.js";
import {
  type BuildContext,
  type Divergence,
  FUZZ_SCENARIO,
  type FuzzTally,
  type ScenarioDef,
  explain,
  newFuzzTally,
  runScenario,
  tallyCase,
} from "../scenario.js";

// ---------------------------------------------------------------------------
// Hand-built traces: each step is a list of `external` records [tag, value]
// (the tag is the kind; a different value is a `changed` at data[1]).

type Rec = [tag: string, value: number];

function trace(...steps: Rec[][]): TraceEntry[] {
  return steps.flatMap((records, i): TraceEntry[] => [
    { k: "step", i, step: `step ${i}` },
    ...records.map(
      ([tag, value]): TraceEntry => ({ k: "external", data: [tag, value] }),
    ),
    { k: "async", i },
  ]);
}

const entry = (
  id: string,
  kind: string,
  more: Partial<Divergence> = {},
): Divergence => ({
  id,
  scenario: FUZZ_SCENARIO,
  stream: "external",
  kind,
  reason: "an approved quirk, for this self-test",
  approvedBy: "Jason",
  date: "2026-11-01",
  ...more,
});

/** A narrow `ends` entry, as the census requires (engine v2, an op). */
const ends = (
  id: string,
  kind: string,
  more: Partial<Divergence> = {},
): Divergence =>
  entry(id, kind, { ends: true, engine: "v2", op: "missing", ...more });

const shown = (ds: Difference[]) =>
  ds.map((d) => `${d.engine} ${d.kind} ${d.op} step ${d.step}`);

/** The reference: a, b, the quirk q, then c, all in step 0. */
const REFERENCE = trace([
  ["a", 0],
  ["b", 0],
  ["q", 0],
  ["c", 0],
]);

describe("an `ends` entry stops a fuzz case at its difference", () => {
  it("control: an ordinary entry covers its difference and the case goes on", () => {
    const candidate = trace([
      ["a", 0],
      ["b", 0],
      ["q", 1],
      ["c", 1],
    ]);
    const result = explain(
      FUZZ_SCENARIO,
      compareContract(REFERENCE, candidate, "v2"),
      [entry("q", "q")],
    );

    expect(shown(result.unexplained)).toEqual(["v2 c changed step 0"]);
    expect(result.used).toEqual(["q"]);
    expect(result.ended).toEqual([]);
  });

  it("a difference covered by an `ends` entry stops the case; the one after it is not reported", () => {
    const candidate = trace([
      ["a", 0],
      ["b", 0],
      ["q", 1],
      ["c", 1],
    ]);
    const result = explain(
      FUZZ_SCENARIO,
      compareContract(REFERENCE, candidate, "v2"),
      [entry("q-ends", "q", { ends: true })],
    );

    expect(result.unexplained).toEqual([]);
    expect(result.used).toEqual(["q-ends"]);
    expect(result.ended).toHaveLength(1);
    expect(result.ended[0]).toMatchObject({
      engine: "v2",
      id: "q-ends",
      dropped: 1,
    });
    expect(result.ended[0]?.at.kind).toBe("q");
  });

  it("an uncovered difference before it is still reported", () => {
    const candidate = trace([
      ["a", 0],
      ["b", 1],
      ["q", 1],
      ["c", 1],
    ]);
    const result = explain(
      FUZZ_SCENARIO,
      compareContract(REFERENCE, candidate, "v2"),
      [entry("q-ends", "q", { ends: true })],
    );

    expect(shown(result.unexplained)).toEqual(["v2 b changed step 0"]);
    expect(result.used).toEqual(["q-ends"]);
  });

  it("an uncovered difference in an earlier step is before it, wherever the trace index puts it", () => {
    // Four covered extras push the candidate's indexes past the quirk's
    // reference index: by index alone, y would look later than q.
    const reference = trace(
      [["a", 0]],
      [
        ["q", 0],
        ["c", 0],
      ],
    );
    const candidate = trace(
      [
        ["a", 0],
        ["x", 0],
        ["x", 0],
        ["x", 0],
        ["x", 0],
        ["y", 0],
      ],
      [
        ["q", 1],
        ["c", 1],
      ],
    );
    const diffs = compareContract(reference, candidate, "v2");
    const y = diffs.find((d) => d.kind === "y") as Difference;
    const q = diffs.find((d) => d.kind === "q") as Difference;
    expect((y.at.candidate as number) > (q.at.reference as number)).toBe(true);

    const result = explain(FUZZ_SCENARIO, diffs, [
      entry("x", "x"),
      entry("q-ends", "q", { ends: true }),
    ]);

    expect(shown(result.unexplained)).toEqual(["v2 y extra step 0"]);
    expect(result.ended[0]).toMatchObject({ id: "q-ends", dropped: 1 });
  });

  it("every later difference, in either trace and later steps, is not reported", () => {
    const reference = trace(
      [
        ["a", 0],
        ["q", 0],
        ["q2", 0],
      ],
      [["d", 0]],
    );
    const candidate = trace(
      [
        ["a", 0],
        ["r", 0],
        ["r2", 0],
      ],
      [
        ["d", 1],
        ["e", 0],
      ],
    );
    const result = explain(
      FUZZ_SCENARIO,
      compareContract(reference, candidate, "v2"),
      [entry("q-ends", "q", { ends: true, op: "missing" })],
    );

    // r and r2 are the candidate's records in place of q: the same gap (no
    // matched record between them and q), so both are beside the stop and
    // past it. q2 is after q in the reference; step 1's d and e come after
    // the quirk in both traces.
    expect(result.unexplained).toEqual([]);
    expect(result.ended[0]).toMatchObject({ id: "q-ends", dropped: 5 });
  });

  it("an uncovered difference before the stop's gap is still reported, in either trace", () => {
    // y (candidate) and z (reference) are before a, the matched record that
    // opens q's gap; w is in the gap, beside q.
    const reference = trace([
      ["z", 0],
      ["a", 0],
      ["q", 0],
      ["c", 0],
    ]);
    const candidate = trace([
      ["y", 0],
      ["a", 0],
      ["w", 0],
      ["c", 0],
    ]);
    const result = explain(
      FUZZ_SCENARIO,
      compareContract(reference, candidate, "v2"),
      [entry("q-ends", "q", { ends: true, op: "missing" })],
    );

    expect(shown(result.unexplained).sort()).toEqual([
      "v2 y extra step 0",
      "v2 z missing step 0",
    ]);
    expect(result.ended[0]).toMatchObject({ id: "q-ends", dropped: 1 });
  });

  // The reviewer's case (PR #296): the stop is a missing hook in the
  // reference; the candidate has, in the same gap, a covered extra x and
  // then an uncovered notify y. Nothing orders y after the quirk, but it is
  // beside it, in the same gap, so an `ends` stop drops it (and x); an
  // ordinary entry, or a case without the `ends` entry's trigger, does not.
  const onError: TraceEntry = { k: "hook", hook: "onError", args: [] };
  const notifyY: TraceEntry = { k: "notify", id: "y", value: 1 };
  const ext = (tag: string): TraceEntry => ({ k: "external", data: [tag, 0] });
  const flat = (...records: TraceEntry[]): TraceEntry[] => [
    { k: "step", i: 0, step: "step 0" },
    ...records,
    { k: "async", i: 0 },
  ];

  it("a difference in the same gap as the stop, in the other trace, is past it (candidate side)", () => {
    const reference = flat(ext("a"), onError, ext("b"));
    const candidate = flat(ext("a"), ext("x"), notifyY, ext("b"));
    const result = explain(
      FUZZ_SCENARIO,
      compareContract(reference, candidate, "v2"),
      [entry("x", "x"), ends("onError-ends", "onError", { stream: "hook" })],
    );

    expect(result.unexplained).toEqual([]);
    expect(result.used).toEqual(["onError-ends"]);
    expect(result.ended[0]).toMatchObject({ id: "onError-ends", dropped: 2 });
  });

  it("control: with an ordinary entry for the same difference, the same-gap difference is reported", () => {
    const reference = flat(ext("a"), onError, ext("b"));
    const candidate = flat(ext("a"), ext("x"), notifyY, ext("b"));
    const result = explain(
      FUZZ_SCENARIO,
      compareContract(reference, candidate, "v2"),
      [
        entry("x", "x"),
        entry("onError", "onError", {
          stream: "hook",
          engine: "v2",
          op: "missing",
        }),
      ],
    );

    expect(shown(result.unexplained)).toEqual(["v2 y extra step 0"]);
    expect(result.used.sort()).toEqual(["onError", "x"]);
    expect(result.ended).toEqual([]);
  });

  it("in a case without the `ends` entry's trigger nothing stops, and the same-gap difference is reported", () => {
    const reference = flat(ext("a"), onError, ext("b"));
    const candidate = flat(ext("a"), ext("x"), notifyY, ext("b"));
    const divergences = [
      entry("x", "x"),
      ends("onError-ends", "onError", { stream: "hook", when: ["timeout"] }),
    ];
    const differences = compareContract(reference, candidate, "v2");
    const without = explain(FUZZ_SCENARIO, differences, divergences, [
      "retryPolicy",
    ]);

    expect(shown(without.unexplained)).toEqual([
      "v2 onError missing step 0",
      "v2 y extra step 0",
    ]);
    expect(without.ended).toEqual([]);
    // Control: the same case with the trigger stops at the quirk.
    const withIt = explain(FUZZ_SCENARIO, differences, divergences, [
      "timeout",
    ]);
    expect(withIt.unexplained).toEqual([]);
    expect(withIt.ended[0]).toMatchObject({ id: "onError-ends", dropped: 2 });
  });

  it("a difference in the same gap as the stop, in the other trace, is past it (reference side)", () => {
    const reference = flat(ext("a"), ext("x"), notifyY, ext("b"));
    const candidate = flat(ext("a"), onError, ext("b"));
    const result = explain(
      FUZZ_SCENARIO,
      compareContract(reference, candidate, "v2"),
      [
        entry("x", "x"),
        ends("onError-ends", "onError", { stream: "hook", op: "extra" }),
      ],
    );

    expect(result.unexplained).toEqual([]);
    expect(result.ended[0]).toMatchObject({ id: "onError-ends", dropped: 2 });
  });

  it("a difference in the other trace after a matched record that follows the stop is not reported", () => {
    // b is matched and comes after the quirk in the reference and before y
    // in the candidate, so y is strictly after the stop.
    const reference = flat(ext("a"), onError, ext("b"));
    const candidate = flat(ext("a"), ext("x"), ext("b"), notifyY);
    const result = explain(
      FUZZ_SCENARIO,
      compareContract(reference, candidate, "v2"),
      [entry("x", "x"), ends("onError-ends", "onError", { stream: "hook" })],
    );

    // x is beside the stop, in its gap: past it as well.
    expect(result.unexplained).toEqual([]);
    expect(result.used).toEqual(["onError-ends"]);
    expect(result.ended[0]).toMatchObject({ id: "onError-ends", dropped: 2 });
  });

  it("only the engine whose difference it covers stops; another engine is compared in full", () => {
    const candidate = trace([
      ["a", 0],
      ["b", 0],
      ["q", 1],
      ["c", 1],
    ]);
    const result = explain(
      FUZZ_SCENARIO,
      [
        ...compareContract(REFERENCE, candidate, "local"),
        ...compareContract(REFERENCE, candidate, "v2"),
      ],
      [entry("q-ends", "q", { ends: true, engine: "v2" })],
    );

    expect(shown(result.unexplained)).toEqual([
      "local q changed step 0",
      "local c changed step 0",
    ]);
    expect(result.ended.map((e) => e.engine)).toEqual(["v2"]);
  });

  it("a hand scenario never stops: there `ends` covers only its own difference", () => {
    const candidate = trace([
      ["a", 0],
      ["b", 0],
      ["q", 1],
      ["c", 1],
    ]);
    const result = explain(
      "a hand scenario",
      compareContract(REFERENCE, candidate, "v2"),
      [entry("q-ends", "q", { ends: true, scenario: "a hand scenario" })],
    );

    expect(shown(result.unexplained)).toEqual(["v2 c changed step 0"]);
    expect(result.used).toEqual(["q-ends"]);
    expect(result.ended).toEqual([]);
  });

  it("an `ends` entry whose difference does not occur stops nothing and is not used", () => {
    const candidate = trace([
      ["a", 0],
      ["b", 0],
      ["q", 0],
      ["c", 1],
    ]);
    const result = explain(
      FUZZ_SCENARIO,
      compareContract(REFERENCE, candidate, "v2"),
      [entry("q-ends", "q", { ends: true })],
    );

    expect(shown(result.unexplained)).toEqual(["v2 c changed step 0"]);
    expect(result.used).toEqual([]);
    expect(result.ended).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Through runScenario, on the real engines

const CANDIDATE = "__endsSelfTestCandidate";

/** A fuzz-named case that reports a, b, q, c; the candidate changes q and c. */
const fuzzCase: ScenarioDef = {
  name: FUZZ_SCENARIO,
  build: ({ core: { createModule, t } }: BuildContext) => ({
    module: createModule("m", {
      schema: {
        facts: { n: t.number() },
        derivations: {},
        events: {},
      },
      init: (facts: any) => {
        facts.n = 0;
      },
    } as any),
  }),
  steps: [
    { op: "start" },
    {
      op: "run",
      label: "report",
      fn: (_system, ctx) => {
        const value = (ctx.core as Record<string, unknown>)[CANDIDATE] ? 1 : 0;
        for (const record of [
          ["a", 0],
          ["b", 0],
          ["q", value],
          ["c", value],
        ] as Json[]) {
          ctx.external(record);
        }
      },
    },
  ],
  seed: 1,
};

/** The workspace engine, marked so the case can tell it is the candidate, run as "v2". */
function candidate(): EngineHandle {
  const local = engines()[1] as EngineHandle;

  return {
    ...local,
    name: "v2",
    async load() {
      return { ...(await local.load()), [CANDIDATE]: true };
    },
  };
}

describe("runScenario stops an ended fuzz case, and the floors count it", () => {
  it("control: without an `ends` entry the later difference fails the case", async () => {
    const result = await runScenario(fuzzCase, {
      candidates: [candidate()],
      divergences: [entry("q", "q")],
    });

    expect(result.ok).toBe(false);
    expect(shown(result.unexplained)).toEqual(["v2 c changed step 1"]);
  });

  it("an ended case passes, says where it ended, and counts as compared on v2", async () => {
    const result = await runScenario(fuzzCase, {
      candidates: [candidate()],
      divergences: [entry("q-ends", "q", { ends: true })],
    });

    expect(result.report).toBe("");
    expect(result.ok).toBe(true);
    expect(result.used).toEqual(["q-ends"]);
    expect(result.ended).toMatchObject([
      { engine: "v2", id: "q-ends", dropped: 1 },
    ]);
    expect(result.advisories.join("\n")).toMatch(
      /ended on v2 by q-ends at external "q" in step 1 .*1 later difference/,
    );

    // The fuzz run's count (tallyCase), the census floors (checkFuzzRuns)
    // and the census's fuzz line (describeFuzzRun), which shows the stops.
    const tally: FuzzTally = newFuzzTally();
    for (let i = 0; i < FUZZ_FLOOR; i++) {
      tallyCase(tally, result);
    }
    expect(tally).toMatchObject({ ran: FUZZ_FLOOR, runaway: 0 });
    expect(tally.onV2).toBe(FUZZ_FLOOR);
    expect(tally).toMatchObject({
      ended: FUZZ_FLOOR,
      endedSteps: FUZZ_FLOOR,
      endedAtStep0: 0,
    });
    const run = {
      seed: 1,
      runs: tally.ran - tally.runaway,
      v2: tally.onV2,
      ended: tally.ended,
      endedSteps: tally.endedSteps,
      endedAtStep0: tally.endedAtStep0,
    };
    expect(checkFuzzRuns([run], true)).toEqual([]);
    expect(describeFuzzRun(run)).toBe(
      `${FUZZ_FLOOR} cases compared (seed 1), ${FUZZ_FLOOR} of them on v2 too, ${FUZZ_FLOOR} ended early by an \`ends\` divergence (at step 1.0 on average; 0 at step 0)`,
    );
  });

  it("the census's fuzz line counts the cases ended at step 0", () => {
    expect(
      describeFuzzRun({
        seed: 7,
        runs: 300,
        v2: 300,
        ended: 4,
        endedSteps: 2,
        endedAtStep0: 3,
      }),
    ).toMatch(/4 ended early .* \(at step 0\.5 on average; 3 at step 0\)$/);
    expect(describeFuzzRun({ seed: 7, runs: 300, v2: 300 })).toMatch(
      /, 0 ended early by an `ends` divergence$/,
    );
  });
});

// ---------------------------------------------------------------------------
// The census

describe("the census accepts `ends` only on a signed fuzz entry", () => {
  const root = mkdtempSync(join(tmpdir(), "conformance-ends-"));
  mkdirSync(join(root, "diff"), { recursive: true });
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  // The census also requires `when` on an `ends` entry (diff/self/
  // precision.test.ts proves that rule); every entry here has one.
  const scoped = (id: string, kind: string, more: Partial<Divergence> = {}) =>
    ends(id, kind, { when: ["timeout"], ...more });
  const census = (entries: unknown[], used: string[] | null = null) => {
    writeFileSync(join(root, "diff/divergences.json"), JSON.stringify(entries));

    return checkDivergences(root, used ? new Set(used) : null).join("\n");
  };

  it("control: a signed, narrow fuzz entry with `ends` that stopped a case passes", () => {
    expect(census([scoped("q-ends", "q")], ["q-ends"])).toBe("");
    expect(
      census(
        [scoped("q-ends", "q", { op: "changed", path: "data[1]" })],
        ["q-ends"],
      ),
    ).toBe("");
  });

  it("rejects `ends` without engine v2 (1.35 against 1.35 is never stopped)", () => {
    expect(census([scoped("q-ends", "q", { engine: undefined })])).toMatch(
      /q-ends has ends, so it must say engine "v2"/,
    );
    expect(census([scoped("q-ends", "q", { engine: "local" })])).toMatch(
      /q-ends has ends, so it must say engine "v2"/,
    );
  });

  it("rejects `ends` without an op", () => {
    expect(census([scoped("q-ends", "q", { op: undefined })])).toMatch(
      /q-ends has ends, so it must say which op/,
    );
  });

  it("rejects `ends` with op changed and no path", () => {
    expect(census([scoped("q-ends", "q", { op: "changed" })])).toMatch(
      /q-ends has ends with op "changed", so it must say the path/,
    );
  });

  it("rejects `ends` on an entry for a hand scenario", () => {
    expect(census([scoped("q-ends", "q", { scenario: "a hand one" })])).toMatch(
      /q-ends has ends, which only a fuzz entry may have/,
    );
  });

  it("rejects `ends` without approvedBy", () => {
    const text = census([scoped("q-ends", "q", { approvedBy: "" })]);
    expect(text).toMatch(/q-ends has ends, .* must be signed \(approvedBy\)/);
  });

  it("rejects `ends` that is not true", () => {
    expect(census([scoped("q-ends", "q", { ends: false })])).toMatch(
      /q-ends ends must be true/,
    );
  });

  it("finds an `ends` entry that never stopped a case stale", () => {
    expect(census([scoped("q-ends", "q")], [])).toMatch(
      /q-ends covers no difference in this run \(stale\)/,
    );
  });

  it("rejects a hand scenario titled like the fuzz cases", () => {
    writeFileSync(
      join(root, "diff/named.test.ts"),
      `scenario("${FUZZ_SCENARIO}", () => ({}), []);\n`,
    );
    writeFileSync(
      join(root, "layers.rules.json"),
      JSON.stringify({ current: null, scenarios: { [FUZZ_SCENARIO]: "L0" } }),
    );

    expect(checkScenarioLayers(root).join("\n")).toMatch(
      /scenario title "fuzz" is the fuzz cases' name/,
    );
  });
});
