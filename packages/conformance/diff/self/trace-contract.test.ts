/**
 * The L9 gate's harness changes, each with the case that bites without it:
 *
 * - the trace contract (`traceRunContract`) tells an empty `anomalies` list
 *   from an absent one, since 1.35 writes the field only when it has an
 *   anomaly (packages/core/src/core/engine-trace.ts:345);
 * - trace ids by order (`traceIdProblems`): a repeated or non-monotonic run
 *   id in `inspect().trace`, or a run reported twice, fails on every engine;
 * - `onTraceComplete` records pair by their projected run among the longest
 *   pairings (`traceRunText`), so row (bi)'s one extra report is one `extra`
 *   and not a `changed` on every later run (fuzz cases 8:all#181,
 *   12:all#149), while a real extra, missing or changed run still fails;
 * - an `ends` stop drops a missing record whose equal twin it drops on the
 *   engine under test (`shiftedTwins`; quirk a's extra pass, fuzz cases
 *   19:all#25 and 2:all#93), and nothing else: a true extra or missing
 *   record still fails.
 */

import { describe, expect, it } from "vitest";
import {
  type Difference,
  compareContract,
  traceIdProblems,
  traceRunContract,
} from "../compare.js";
import type { Json } from "../normalize.js";
import type { TraceEntry } from "../record.js";
import { type Divergence, FUZZ_SCENARIO, explain } from "../scenario.js";

const shown = (ds: Difference[]) =>
  ds.map((d) => `${d.engine} ${d.kind} ${d.op} step ${d.step}`);

// ---------------------------------------------------------------------------
// The contract's anomalies

describe("the trace contract's anomalies (#392's review)", () => {
  const run = (more: Record<string, Json>): Json => ({
    id: 1,
    status: "settled",
    duration: 3,
    ...more,
  });

  it("an empty list is not an absent field", () => {
    expect(traceRunContract(run({ anomalies: [] }))).not.toEqual(
      traceRunContract(run({})),
    );
    expect(traceRunContract(run({ anomalies: [] }))).toMatchObject({
      anomalies: [],
    });
  });

  it("a list of only a duration anomaly is left out, as 1.35 leaves an empty one out", () => {
    expect(
      traceRunContract(
        run({ anomalies: ["Duration 12ms is 5x+ above average (2ms)"] }),
      ),
    ).toEqual(traceRunContract(run({})));
  });

  it("an error anomaly is compared", () => {
    expect(
      traceRunContract(run({ anomalies: ["1 resolver(s) errored"] })),
    ).not.toEqual(traceRunContract(run({})));
  });
});

// ---------------------------------------------------------------------------
// Ids by order

const report = (id: Json): TraceEntry => ({
  k: "hook",
  hook: "onTraceComplete",
  args: [{ id, status: "settled" }],
});
const state = (...ids: Json[]): TraceEntry =>
  ({
    k: "state",
    label: "settle",
    facts: {},
    derived: {},
    inspect: { trace: ids.map((id) => ({ id, status: "settled" })) },
  }) as unknown as TraceEntry;

describe("trace ids by order (the L9 RFC's harness rule 1)", () => {
  it("increasing ids and runs reported once pass, whatever their values", () => {
    expect(
      traceIdProblems([report(7), report(5), state(5, 7, 9), report(9)]),
    ).toEqual([]);
  });

  it("a run reported twice fails", () => {
    expect(traceIdProblems([report(2), report(2)])).toEqual([
      "hook #1: onTraceComplete reports run 2 again (first at #0)",
    ]);
  });

  it("a repeated id in inspect().trace fails", () => {
    expect(traceIdProblems([state(1, 2, 2)])).toHaveLength(1);
  });

  it("a non-monotonic id in inspect().trace fails", () => {
    expect(traceIdProblems([state(3, 1)])).toEqual([
      "state #0: inspect().trace[1].id 1 is not above the id before it (3): run ids must be unique and increasing",
    ]);
  });

  it("a run id that is not an integer fails", () => {
    expect(traceIdProblems([report("1"), state(1.5)])).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// onTraceComplete pairs by run

const run = (chain: string, id: number): TraceEntry => ({
  k: "hook",
  hook: "onTraceComplete",
  args: [{ id, status: "settled", causalChain: chain }],
});
const step = (...records: TraceEntry[]): TraceEntry[] => [
  { k: "step", i: 0, step: "step 0" },
  ...records,
  { k: "async", i: 0 },
];

describe("onTraceComplete records pair by their run (row (bi))", () => {
  it("2.0's one extra report, ahead of the runs both report, is one extra", () => {
    const reference = step(run("a", 2), run("b", 3));
    const candidate = step(run("dropped", 1), run("a", 2), run("b", 3));
    const out = compareContract(reference, candidate, "v2");

    // By keys alone the extra took the first run's place: "dropped" paired
    // with "a" and "a" with "b", a changed causalChain on each, and "b" extra.
    expect(shown(out)).toEqual(["v2 onTraceComplete extra step 0"]);
    expect(out[0]?.candidate).toMatchObject({
      args: [{ causalChain: "dropped" }],
    });
  });

  it("a run that differs still pairs and is changed", () => {
    const reference = step(run("a", 2), run("b", 3));
    const candidate = step(run("a", 2), run("c", 3));

    expect(shown(compareContract(reference, candidate, "v2"))).toEqual([
      "v2 onTraceComplete changed step 0",
    ]);
  });

  it("a run one engine lacks is still missing", () => {
    const reference = step(run("a", 2), run("b", 3));
    const candidate = step(run("b", 3));

    expect(shown(compareContract(reference, candidate, "v2"))).toEqual([
      "v2 onTraceComplete missing step 0",
    ]);
  });
});

// ---------------------------------------------------------------------------
// An `ends` stop and the twin its shift leaves

const ext = (tag: string, value = 0): TraceEntry => ({
  k: "external",
  data: [tag, value],
});
const stopAtExtraS: Divergence = {
  id: "quirk-a-extra-pass",
  scenario: FUZZ_SCENARIO,
  stream: "external",
  kind: "S",
  engine: "v2",
  op: "extra",
  ends: true,
  reason: "an approved quirk, for this self-test",
  approvedBy: "Jason",
  date: "2026-11-16",
};
/** 1.35: the completion C, then one reconcile pass S X Y E. */
const REFERENCE = step(ext("C"), ext("S"), ext("X"), ext("Y"), ext("E"));

describe("an `ends` stop drops the missing twin of a record it drops (quirk a)", () => {
  it("the record on both engines, unpaired on both by the shift, passes", () => {
    // 2.0 runs the pass first, then C, then its extra pass's start: by keys
    // the pass pairs, C is left unpaired on both, and the stop at the extra
    // S drops 2.0's C (past the shared match point) but not 1.35's.
    const candidate = step(
      ext("S"),
      ext("X"),
      ext("Y"),
      ext("E"),
      ext("C"),
      ext("S"),
    );
    const diffs = compareContract(REFERENCE, candidate, "v2");
    expect(shown(diffs)).toEqual([
      "v2 C missing step 0",
      "v2 C extra step 0",
      "v2 S extra step 0",
    ]);
    const result = explain(FUZZ_SCENARIO, diffs, [stopAtExtraS]);

    expect(result.unexplained).toEqual([]);
    expect(result.ended[0]).toMatchObject({ id: stopAtExtraS.id, dropped: 2 });
  });

  it("a twin with a different payload is not a twin: the missing record fails", () => {
    const candidate = step(
      ext("S"),
      ext("X"),
      ext("Y"),
      ext("E"),
      ext("C", 1),
      ext("S"),
    );
    const result = explain(
      FUZZ_SCENARIO,
      compareContract(REFERENCE, candidate, "v2"),
      [stopAtExtraS],
    );

    expect(shown(result.unexplained)).toEqual(["v2 C missing step 0"]);
  });

  it("a record 2.0 lacks is still missing", () => {
    const candidate = step(ext("S"), ext("X"), ext("Y"), ext("E"), ext("S"));
    const result = explain(
      FUZZ_SCENARIO,
      compareContract(REFERENCE, candidate, "v2"),
      [stopAtExtraS],
    );

    expect(shown(result.unexplained)).toEqual(["v2 C missing step 0"]);
  });

  it("a true extra before the stop's shared match point still fails", () => {
    const candidate = step(
      ext("Z"),
      ext("C"),
      ext("S"),
      ext("X"),
      ext("Y"),
      ext("E"),
      ext("S"),
    );
    const result = explain(
      FUZZ_SCENARIO,
      compareContract(REFERENCE, candidate, "v2"),
      [stopAtExtraS],
    );

    expect(shown(result.unexplained)).toEqual(["v2 Z extra step 0"]);
  });

  it("without an `ends` stop nothing is dropped: both halves of the shift are reported", () => {
    const candidate = step(
      ext("S"),
      ext("X"),
      ext("Y"),
      ext("E"),
      ext("C"),
      ext("S"),
    );
    const result = explain(
      FUZZ_SCENARIO,
      compareContract(REFERENCE, candidate, "v2"),
      [{ ...stopAtExtraS, ends: undefined }],
    );

    expect(shown(result.unexplained)).toEqual([
      "v2 C missing step 0",
      "v2 C extra step 0",
    ]);
  });
});
