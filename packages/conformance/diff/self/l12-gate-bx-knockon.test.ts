// Row (bx)'s knock-on entries (L12 gate run 3, GATE-12.md), signed on the
// owner's instruction ("Yes, widen (bx) to its knock-on effects
// (Recommended)", 2026-11-22) next to (bx)'s approval ("I approve you for
// to do everything", 2026-11-15). With a watch that includes facts, 2.0's
// extra snapshot read reports a throwing derivation's onError,
// onErrorRecovery "skip" and the getDistributableSnapshot warning once
// more, computes derivations one step earlier, and calls the watch back on
// an included fact's write. The same records without a fact-including
// watch, or of any other kind or shape, still fail.
import { describe, expect, it } from "vitest";
import { compareContract } from "../compare.js";
import type { Json } from "../normalize.js";
import type { TraceEntry } from "../record.js";
import {
  FUZZ_SCENARIO,
  explain,
  fileMoves,
  readDivergences,
} from "../scenario.js";

const BX = readDivergences().filter((d) =>
  ["row-bx", "row-bx-logging"].includes(d.group ?? ""),
);
const IDS = [
  "l12-fuzz-bx-console-warn-distributable-skip-extra",
  "l12-fuzz-bx-hook-onError-extra",
  "l12-fuzz-bx-hook-onErrorRecovery-extra",
  "l12-fuzz-bx-observe-derivation-compute-moved",
  "l12-fuzz-bx-hook-onDerivationCompute-moved",
  "l12-fuzz-bx-external-watch-extra",
  "l12-fuzz-bx-external-log-error-extra",
  "l12-fuzz-bx-external-log-error-recovery-extra",
  "l12-fuzz-bx-external-log-derivation-compute-moved",
];
const LOGGED = [
  "l12-fuzz-bx-external-log-error-extra",
  "l12-fuzz-bx-external-log-error-recovery-extra",
  "l12-fuzz-bx-external-log-derivation-compute-moved",
];
const ON = ["watchIncludesFacts", "distributableWatch"];

const step = (i: number, records: TraceEntry[]): TraceEntry[] => [
  { k: "step", i, step: `step ${i}` } as TraceEntry,
  ...records,
  { k: "async", i } as TraceEntry,
];
const error = (message: string, sourceId: string, source = "derivation") => ({
  $error: {
    name: "DirectiveError",
    message,
    context: { $undefined: true },
    recoverable: true,
    source,
    sourceId,
  },
});
const onError = (m = "a.d2 throws at 4", id = "a::d2", src = "derivation") =>
  ({ k: "hook", hook: "onError", args: [error(m, id, src)] }) as TraceEntry;
const onRecovery = (m = "a.d2 throws at 4", id = "a::d2", how = "skip") =>
  ({
    k: "hook",
    hook: "onErrorRecovery",
    args: [error(m, id), how],
  }) as TraceEntry;
const warn = (
  text = 'getDistributableSnapshot: Skipping derivation "a::d2" due to error:',
  message = "a.d2 throws at 4",
) =>
  ({
    k: "console",
    level: "warn",
    args: [`[Directive] ${text}`, { $error: { name: "Error", message } }],
  }) as TraceEntry;
const compute = (id = "a::d1", value: Json = false): TraceEntry[] =>
  [
    { k: "hook", hook: "onDerivationCompute", args: [id, value, ["a::f0"]] },
    { k: "observe", event: { id, type: "derivation.compute", value } },
  ] as TraceEntry[];
const watch = (data: Json) =>
  ({ k: "external", data: ["watch", data] }) as TraceEntry;
const snap = { createdAt: 1500, data: { d0: false, f0: -2 }, version: "e" };

/** What 2.0's records leave unexplained against 1.35's, by the bx entries. */
const left = (
  reference: TraceEntry[],
  candidate: TraceEntry[],
  triggers: string[] = ON,
) => {
  const diffs = fileMoves(
    FUZZ_SCENARIO,
    compareContract(reference, candidate, "v2"),
    BX,
    triggers,
  );

  return explain(FUZZ_SCENARIO, diffs, BX, triggers).unexplained.map(
    (d) => `${d.op} ${d.stream} ${d.kind} ${d.step}`,
  );
};

/** The shrunk case's step 12, and case 13's moved compute in step 13. */
const v1 = [...step(12, []), ...step(13, compute())];
const v2 = [
  ...step(12, [onError(), onRecovery(), warn(), ...compute(), watch(snap)]),
  ...step(13, []),
];

describe("row (bx)'s knock-on: the extra read's records, and no other", () => {
  it("is signed on the owner's instruction, quoting both approvals", () => {
    expect(BX.map((d) => d.id).sort()).toEqual([...IDS].sort());
    for (const d of BX) {
      expect(d.reason).toContain(
        '"Yes, widen (bx) to its knock-on effects (Recommended)" (2026-11-22)',
      );
      expect(d.reason).toContain(
        '"I approve you for to do everything" (2026-11-15)',
      );
      expect(d.when).toEqual(
        LOGGED.includes(d.id)
          ? ["watchIncludesFacts", "loggingPlugin"]
          : ["watchIncludesFacts"],
      );
      expect(d.approvedBy).toBe("Jason Comes");
    }
  });

  it("control: with a fact-including watch every record is excused", () => {
    expect(left(v1, v2)).toEqual([]);
  });

  it("without a fact-including watch the same records fail", () => {
    for (const triggers of [[], ["distributableWatch"]]) {
      expect(left(v1, v2, triggers).sort()).toEqual(
        [
          "extra console warn 12",
          "extra hook onError 12",
          "extra hook onErrorRecovery 12",
          "extra external watch 12",
          "extra hook onDerivationCompute 12",
          "extra observe derivation.compute 12",
          "missing hook onDerivationCompute 13",
          "missing observe derivation.compute 13",
        ].sort(),
      );
    }
  });

  it("the errors need the extra warning in the case", () => {
    expect(left([], step(12, [onError(), onRecovery()])).sort()).toEqual([
      "extra hook onError 12",
      "extra hook onErrorRecovery 12",
    ]);
  });

  it("any other kind or shape fails", () => {
    const one = (extra: TraceEntry[]) => left([], step(12, [warn(), ...extra]));
    // An effect's error, a resolver's, or a recovery other than "skip".
    expect(one([onError("a.x0 throws at 4", "a::x0", "effect")])).toEqual([
      "extra hook onError 12",
    ]);
    expect(one([onError("a.r0 attempt 1", "a::r0", "resolver")])).toEqual([
      "extra hook onError 12",
    ]);
    expect(one([onRecovery(undefined, undefined, "retry")])).toEqual([
      "extra hook onErrorRecovery 12",
    ]);
    // Another warning, or the warning with an effect's error.
    expect(left([], step(12, [warn("Skipping something else:")]))).toEqual([
      "extra console warn 12",
    ]);
    expect(left([], step(12, [warn(undefined, "a.x0 throws at 4")]))).toEqual([
      "extra console warn 12",
    ]);
    // A console error, an extra compute that did not move, a move later.
    expect(
      left([], step(12, [{ ...warn(), level: "error" } as TraceEntry])),
    ).toEqual(["extra console error 12"]);
    expect(left([], step(12, compute())).sort()).toEqual([
      "extra hook onDerivationCompute 12",
      "extra observe derivation.compute 12",
    ]);
    expect(
      left(
        [...step(12, compute()), ...step(13, [])],
        [...step(12, []), ...step(13, compute())],
      ).sort(),
    ).toEqual([
      "extra hook onDerivationCompute 13",
      "extra observe derivation.compute 13",
      "missing hook onDerivationCompute 12",
      "missing observe derivation.compute 12",
    ]);
    // A watch callback that is not a snapshot, or a missing one.
    expect(left([], step(12, [watch({ data: 1 })]))).toEqual([
      "extra external watch 12",
    ]);
    expect(left(step(12, [watch(snap)]), step(12, []))).toEqual([
      "missing external watch 12",
    ]);
  });

  describe("the logging plugin's lines for the same records", () => {
    const log = (level: string, text: string) =>
      ({
        k: "external",
        data: ["log", level, `[Directive] ${text}`],
      }) as TraceEntry;
    const LOG = [...ON, "loggingPlugin"];
    const errLog = log("error", "error");
    const recLog = log("warn", "error.recovery");
    const cmpLog = log("debug", "derivation.compute");

    it("control: each line beside its record is excused", () => {
      expect(
        left(
          [...step(12, []), ...step(13, [cmpLog])],
          [
            ...step(12, [
              cmpLog,
              errLog,
              onError(),
              recLog,
              onRecovery(),
              warn(),
            ]),
            ...step(13, []),
          ],
          LOG,
        ),
      ).toEqual([]);
    });

    it("without the logging plugin, or without the extra hook record, the lines fail", () => {
      const v2Lines = step(12, [
        errLog,
        onError(),
        recLog,
        onRecovery(),
        warn(),
      ]);
      expect(left([], v2Lines, ON).sort()).toEqual([
        "extra external log 12",
        "extra external log 12",
      ]);
      expect(left([], step(12, [errLog, recLog, warn()]), LOG)).toEqual([
        "extra external log 12",
        "extra external log 12",
      ]);
      // Another log line, or the compute line one step later.
      expect(
        left([], step(12, [log("error", "boom"), onError(), warn()]), LOG),
      ).toEqual(["extra external log 12"]);
      expect(
        left(
          [...step(12, [cmpLog]), ...step(13, [])],
          [...step(12, []), ...step(13, [cmpLog])],
          LOG,
        ).sort(),
      ).toEqual(["extra external log 13", "missing external log 12"]);
    });
  });
});
