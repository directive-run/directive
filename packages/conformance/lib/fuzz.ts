/** The fewest fuzz cases a differential run must COMPARE (runaways are discarded, not compared). */
export const FUZZ_FLOOR = 200;

/** PR CI generates this many cases: the margin lets a few runaways through without dropping below the floor. */
export const FUZZ_DEFAULT_RUNS = FUZZ_FLOOR + 5;

/**
 * The cases a run adds for v2, as a percent of its `DIFF_FUZZ_RUNS`: they are
 * generated at or below the layer core-next has built (`current` in
 * layers.rules.json; diff/fuzz/model.ts `ceiling`). A system that uses every
 * layer is placed above `current`, so v2 would sit out of it: without this
 * share, v2 takes part in almost none of the cases. The `runs` cases across
 * every layer all still run; the share is added to them. The count is exact,
 * not a probability, and the cases are still seeded.
 */
export const FUZZ_V2_PERCENT = 40;

/** How many cases a run of `runs` adds, generated at or below `current` (rounded up). */
export function v2Cases(runs: number): number {
  return Math.ceil((runs * FUZZ_V2_PERCENT) / 100);
}

/**
 * The fewest fuzz cases a run must compare on v2 as well, whenever v2 runs
 * anything at all (`current` is not null). At the PR default (205 cases) the
 * share adds 82; the margin lets a few discarded cases through.
 */
export const FUZZ_V2_FLOOR = 60;

/**
 * Most runaway cases (reference passed the timer budget) a run tolerates:
 * 1% of the cases generated, never fewer than 2. A generator that starts
 * producing mostly runaways would otherwise quietly compare nothing.
 */
export function maxRunaways(cases: number): number {
  return Math.max(Math.floor(cases / 100), 2);
}

/**
 * Most cases per seed the fuzzer discards because the reference's batches
 * never settle: 1.35's batches still live at the shared wait's cap at a settle
 * step (diff/scenario.ts `ScenarioResult.neverSettles`). Jason, 2026-11-07: "Discard, own count (Recommended)".
 * They are counted on their own line, never toward `maxRunaways`. The cap
 * is 1% of the seed's cases, never fewer than MIN_NEVER_SETTLES (Jason, 2026-11-07: "Cap at 1% of cases, min 3 (Recommended)"; the floor raised to 5 when the shared wait stopped reading 2.0 as settled before its end-of-batch microtasks ran, Jason, 2026-11-12: "Raise the floor to 5 (Recommended)");
 * one more fails the run (the fuzz test and the census).
 */
export const MIN_NEVER_SETTLES = 5;

/** The never-settles cap for a seed that generated `cases` cases: max(1% of them, 5). */
export function maxNeverSettles(cases: number): number {
  return Math.max(Math.floor(cases / 100), MIN_NEVER_SETTLES);
}

/**
 * The trigger names a fuzz divergence's `when` may list (diff/divergences.json;
 * README "Divergences"). Each fuzz case computes the set it has from its spec
 * (diff/fuzz/model.ts `specTriggers`, where each one is defined); an entry
 * with `when` applies only to the cases that have every trigger it lists.
 * Here, apart from the model, so the census can check the names without
 * loading the fuzzer.
 */
export const FUZZ_TRIGGERS = [
  "resolverRetry",
  "resolverRetryLater",
  "constraintRetryLater",
  "retryPolicy",
  "timeout",
  "resolverRejects",
  "settleStop",
  "restart",
  "disable",
  "throw",
  "namespacedDateWrite",
  "ownWriteRetracts",
  "batched",
  "batchWithResults",
  "batchFallback",
  "batchMixed",
  "batchAbortOn",
  "batchSiblings",
  "batchFails",
  "batchAllFail",
  "batchSomeFail",
  "batchRetry",
  "batchTimeout",
  "batchMaxSize",
  "navigated",
  "navigatedBusy",
  "ignoresAbort",
  "navigatedPaused",
  "replayedOrImported",
  "imported",
  "changesetMoved",
  "importedEmpty",
  "restoredTwice",
  "changesetSteps",
] as const;

export type FuzzTrigger = (typeof FUZZ_TRIGGERS)[number];

/**
 * The fuzz model's step ops (diff/fuzz/model.ts `FuzzStep`): what a fuzz
 * divergence's `during` may name (diff/scenario.ts `covers`, `stepOps`).
 * Here, apart from the model, as `FUZZ_TRIGGERS` is.
 */
export const FUZZ_STEP_OPS: readonly string[] = [
  "dispatch",
  "set",
  "date",
  "batch",
  "publish",
  "advance",
  "tick",
  "settle",
  "stop",
  "start",
  "destroy",
  "snapshot",
];

/**
 * The environment flag the nightly deep run sets
 * (.github/workflows/diff-fuzz-nightly.yml) so that a failing case with a
 * batched resolver (trigger `batched`) is reported, not failed. Jason,
 * 2026-11-09: "Gate on short seeds; deep runs report (Recommended)": the L7
 * gate passes on the PR seeds, and each deep-run failure in a batched case
 * is triaged in a follow-up slice, where one triaged as a real 2.0 bug
 * blocks at once. Unset (PR CI, the census, a local run), every failing
 * case fails, as before. Only the exact value "1" turns it on.
 */
export const FUZZ_BATCH_REPORT_ENV = "DIFF_FUZZ_BATCH_REPORT";

/**
 * Where report mode writes each reported case (its spec, report and
 * traces, `case-<n>.json`) and `summary.md`, the list the nightly adds to
 * its job summary; relative to the conformance package unless absolute.
 */
export const FUZZ_REPORT_DIR_ENV = "DIFF_FUZZ_REPORT_DIR";

/** The report directory when `DIFF_FUZZ_REPORT_DIR` is unset (gitignored). */
export const FUZZ_REPORT_DIR = "reports/diff-fuzz";

/** Whether report mode is on: `DIFF_FUZZ_BATCH_REPORT` is exactly "1". */
export function batchReportMode(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env[FUZZ_BATCH_REPORT_ENV] === "1";
}

/**
 * What the fuzz does with a failing case: "report" only in report mode and
 * only when the case has the batched resolver; "fail" otherwise. A case the
 * shared wait judged a 2.0 bug (`twoOnlyLive`, the "2.0-only live" verdict,
 * diff/scenario.ts `ScenarioResult`) fails in either mode: "a case triaged
 * as a real 2.0 bug blocks at once" (Jason, 2026-11-09), and that verdict is
 * already the 2.0-bug finding. Runaways, never-settles and the floors are
 * limits on the whole run, not cases, and still fail in either mode.
 */
export function onFailingCase(
  triggers: readonly FuzzTrigger[],
  reportMode: boolean,
  twoOnlyLive?: string,
): "report" | "fail" {
  return reportMode && twoOnlyLive === undefined && triggers.includes("batched")
    ? "report"
    : "fail";
}

/** A trace as the harness records it (diff/record.ts `TraceEntry`). */
type Trace = readonly unknown[];

/** What `caseFile` reads of a case's result (diff/scenario.ts `ScenarioResult`). */
export interface CaseResult {
  report: string;
  traces: { reference: Trace; candidate: Trace };
  engineTraces?: Record<string, Trace>;
  unexplained: readonly { engine: string }[];
}

/**
 * A reported case's file (`case-<n>.json`): `meta` (seed, phase, spec, …),
 * its report, and the traces to triage it by: 1.35's as the reference and,
 * as the candidate, v2's whenever v2 was compared, else the trace of the
 * engine of the first unexplained difference (`candidateEngine` names it).
 * Before the L7 follow-ups the file held `traces.candidate`, the workspace
 * 1.x engine's, which nearly always matches 1.35's, so a triage read no
 * 2.0 record from it. Self-test: diff/self/batch-report.test.ts.
 */
export function caseFile(
  meta: Record<string, unknown>,
  result: CaseResult,
): Record<string, unknown> {
  const engines = result.engineTraces ?? {};
  const engine =
    "v2" in engines
      ? "v2"
      : (result.unexplained.find((d) => d.engine in engines)?.engine ??
        Object.keys(engines)[0]);

  return {
    ...meta,
    report: result.report,
    traces: {
      reference: result.traces.reference,
      candidate:
        engine === undefined
          ? result.traces.candidate
          : (engines[engine] ?? result.traces.candidate),
      candidateEngine: engine ?? null,
    },
  };
}
