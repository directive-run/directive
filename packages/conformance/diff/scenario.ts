/**
 * A differential scenario: the same definitions and the same steps, run on
 * every engine, must produce the same trace.
 *
 * `scenario(name, build, steps)` registers a test. It runs the reference
 * engine twice and each engine under test once:
 *
 * - reference vs reference proves the scenario and the recorder are
 *   deterministic. Any difference here, incidental parts included, is never
 *   approvable: it means the trace holds something that is not behaviour
 *   (fix the recorder or the scenario) or the reference engine is itself
 *   nondeterministic (report it).
 * - reference vs engine under test is the comparison (diff/compare.ts,
 *   stream by stream). Each contract difference must be covered by an entry
 *   in `divergences.json`, which only Jason approves; incidental differences
 *   are printed as advisories.
 *
 * The engines under test are `local` always and `v2` once core-next exists,
 * for scenarios at or below `current` in layers.rules.json (each scenario's
 * layer is listed under `scenarios` there).
 *
 * Determinism is injected, not stripped: every run starts with fake timers
 * at time 0 (`Date`, `performance` and all timers), `Math.random` replaced
 * by a generator seeded per scenario, and console capture — all installed
 * before the engine loads, so load-time output is recorded too. Microtasks
 * stay real, so the engine's own scheduling is what is being compared.
 *
 * Internal: vitest-bound and patching process globals. The recorder
 * (record.ts) is the reusable part.
 */

import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  type Difference,
  compareContract,
  compareFull,
  comparePositions,
  diffJson,
  drawProblems,
  drawnResolvers,
  interleaving,
  isPastSharedPoint,
  isPastStop,
  latestPosition,
  straddlesStop,
} from "./compare.js";
import "./coverage.js";
import { type CoreApi, type EngineHandle, engines } from "./engines.js";
import {
  type Bound,
  type Excuse,
  admits,
  excuseFor,
  names,
} from "./fingerprint.js";
import { type Json, normalize } from "./normalize.js";
import {
  type Recorder,
  type TraceEntry,
  createRecorder,
  record,
} from "./record.js";

const here = dirname(fileURLToPath(import.meta.url));

export type AnySystem = any;

export interface BuildContext {
  core: CoreApi;
  /** The same engine instance's `/plugins` entry (persistence, logging, …). */
  plugins: Record<string, any>;
  /** Per-run storage shared by build() and run steps (e.g. a source's publish). */
  handles: Record<string, any>;
  /** Report an outside-world effect into the trace (`external`). */
  external(data: unknown): void;
}

/** createSystem options without the recorder (it is appended). */
export type Build = (ctx: BuildContext) => Record<string, unknown>;

export type Step =
  | { op: "dispatch"; event: Record<string, unknown> }
  | { op: "set"; key: string; value: unknown }
  | { op: "batch"; writes: [string, unknown][] }
  | { op: "advance"; ms: number }
  | { op: "tick" }
  | { op: "settle" }
  | { op: "checkpoint"; label: string }
  | { op: "start" }
  | { op: "stop" }
  | { op: "destroy" }
  | { op: "back"; steps?: number }
  | { op: "forward"; steps?: number }
  | { op: "snapshot"; label: string }
  | { op: "restore"; label: string }
  | {
      op: "run";
      label: string;
      fn: (system: AnySystem, ctx: BuildContext) => unknown;
    }
  | {
      /**
       * A second system (the fuzz model's `twin` step): `open` creates and
       * starts it, its `settle()` goes through the shared wait as a
       * `settle` step's does (`SettleDrain`, keyed by this step's index),
       * and `close` then reads and destroys it. In the trace it is a `run`
       * step of its label. If its `settle()` throws, `close` does not run.
       */
      op: "twin";
      label: string;
      open: (system: AnySystem, ctx: BuildContext) => AnySystem;
      close: (twin: AnySystem, ctx: BuildContext) => unknown;
    };

export interface ScenarioDef {
  name: string;
  build: Build;
  steps: Step[];
  /** Seed for Math.random (default: derived from the name). */
  seed?: number;
  /** The scenario's layer (L0–L13): v2 runs it only at or below `current`. */
  layer?: string;
  /**
   * Whether the recorder subscribes to derivations (default true). Off for
   * scenarios about what a reader sees of a derivation nobody observes.
   */
  observeDerivations?: boolean;
  /** Timer callbacks one run may make (default RUN_BUDGET). */
  budget?: number;
  /**
   * A fuzz case's triggers (diff/fuzz/model.ts `specTriggers`): a divergence
   * with `when` covers a difference only in a case that has all of them.
   */
  triggers?: readonly string[];
  /**
   * Fuzz cases only (diff/fuzz/model.ts): the shared wait at a `settle`
   * step. Hand scenarios never set it, so their signed (as) entries keep
   * pinning 1.35's early `settle()`.
   */
  settleDrain?: SettleDrain;
}

/**
 * The fuzz harness's shared wait at a `settle` step (Jason, 2026-11-07:
 * "One shared wait (Recommended)", which replaced the separate drains of
 * 1.35's batches, Jason, 2026-11-06: "Wait out 1.35's batches
 * (Recommended)", and of 2.0's detached batch runs, Jason, 2026-11-07:
 * "Wait out 2.0's detached batches too (Recommended)"). 1.35's `settle()`
 * resolves while a batch still runs; 2.0's waits for it (row (as)), but not
 * for a detached run (a bound run whose requirement was retracted leaves
 * flight unaborted, RFC-0003). So after `settle()` resolves, both engines'
 * fake clocks advance together to one common time: the first at which
 * neither has a batch still running (`busy`; on 1.35 any batch, on 2.0 a
 * detached run, since its attached ones are what its `settle()` waited
 * for). The `settle` checkpoint is recorded there, on both engines at the
 * same fake time.
 *
 * The engines run one after the other, so the common time is found in
 * rounds (`runScenario`): each run waits until its own batches end and
 * reports when (`SettleWait`); at the first `settle` step where the
 * reference and v2 ended at different times, the later time becomes that
 * step's target (`targets`), both run again advancing to it, and so on
 * until every step ends at the same time on both. Each run's own wait is
 * capped at `boundMs` of fake time after its `settle()` resolved:
 *
 * - both still running at the cap: the case never settles and is
 *   discarded (`ScenarioResult.neverSettles`, on its own count; Jason,
 *   2026-11-07: "Discard, own count (Recommended)");
 * - only 1.35 still running while 2.0 finished: discarded the same way;
 * - only 2.0 still running while 1.35 finished in the same time: the case
 *   fails, as a 2.0 bug, naming what kept 2.0 live, unless an approved
 *   `ends` entry had already stopped the case's comparison on 2.0 strictly
 *   before 2.0 outworked the reference: the stop's record comes before the
 *   point 2.0's clock reached the time the reference's batches finished at
 *   that step (`SettleWait.quietAt`, cut on 2.0's trace as
 *   `SettleWait.cutAt`), by the same `stopsBefore` test the timer-budget
 *   runaway uses. Then the case is discarded after the stop, like that
 *   runaway: counted toward the runaway limit, max(1%, 2), naming the
 *   stopping entry (Jason, 2026-11-08: "Use 'Discard after the stop' (Recommended)", which replaced the write-after-cancel
 *   rule of the same day). A stop after the reference finished, or none,
 *   still fails. `writeAfterAbort` is only an annotation in the report.
 *
 * A v2 whose `settle()` resolved with attached work left (`attached`, read
 * at the instant it resolved; its settle() resolved early) takes no part: its clock does not advance and
 * it checkpoints at once, so it still differs. Hand scenarios never set
 * the rule, so their signed (as) entries keep pinning 1.35's early
 * `settle()`. Self-tests: diff/self/settle-drain.test.ts.
 */
export interface SettleDrain {
  /** Why a batch is still live (shown if the wait passes its cap), or false. */
  busy(ctx: BuildContext, system: AnySystem): string | false;
  /**
   * v2 only: why its `settle()` resolved with attached work left (the
   * system is not settled, or a run is in flight), or false. When it says
   * why, v2 does not join the wait at that step.
   */
  attached?(ctx: BuildContext, system: AnySystem): string | false;
  boundMs: number;
  /**
   * How many writes the run's handlers have made so far while their signal
   * was aborted (diff/fuzz/model.ts `BatchLedger.writeAfterAbort`). Read at
   * each wait's start and end (`SettleWait.writeAfterAbort`), and only
   * reported: it decides no verdict.
   */
  writeAfterAbort?(ctx: BuildContext): number;
}

/**
 * The engines with 1.35's `settle()`, which does not wait for a batch: the
 * reference and the workspace engine (packages/core, the 1.x line).
 */
export const DRAIN_ENGINES: ReadonlySet<string> = new Set(["v1", "local"]);

/**
 * Whether `engine` is on 1.35's line: those in DRAIN_ENGINES, and a faulted
 * copy of the workspace engine (`local+<fault>`, diff/self/faults.ts),
 * which is the 1.x line too. Never v2.
 */
export function drains(engine: { name: string }): boolean {
  return DRAIN_ENGINES.has(engine.name) || engine.name.startsWith("local+");
}

/**
 * Whether `engine` is v2 (or a wrapped v2, `v2+<…>`): its wait is checked
 * for attached work first (`SettleDrain.attached`), and its times set the
 * shared targets with the reference's.
 */
export function drainsDetached(engine: { name: string }): boolean {
  return engine.name === "v2" || engine.name.startsWith("v2+");
}

/** One `settle` step's wait on one run (the shared wait). */
export interface SettleWait {
  /** The step's index. */
  step: number;
  /** Fake time when `settle()` resolved. */
  resolvedAt: number;
  /** Fake time the wait ended: the `settle` checkpoint's time. */
  endAt: number;
  /** v2 only: why it took no part (attached work left at `settle()`). */
  attached?: string;
  /** Why a batch was still live at the cap, if one was. */
  live?: string;
  /** Whether the clock advanced. */
  waited: boolean;
  /** Writes the handlers made while their signal was aborted, during this wait. */
  writeAfterAbort?: number;
  /**
   * Fake time from which no batch was live through the wait's end: when
   * this run's batches finished at this step, whatever target it then ran
   * on to (the wait's end when live at the cap).
   */
  quietAt?: number;
  /**
   * v2 only: the trace's length just before its clock first reached the
   * reference's `quietAt` at this step (the cut for `stopsBefore`): every
   * record at a lower index was emitted while 2.0 had run no longer than
   * the reference needed to finish its batches.
   */
  cutAt?: number;
}

/** One run's part in the shared wait: the rule, the targets, and what it did. */
interface DrainRun {
  rule: SettleDrain;
  /** Each `settle` step's common end time, where one is known. */
  targets: ReadonlyMap<number, number>;
  /** Steps whose target is the other engine's time live at its cap. */
  judge: ReadonlySet<number>;
  waits: SettleWait[];
  /** v2: its wait is checked for attached work first. */
  v2: boolean;
  /** The trace's current length. */
  mark: () => number;
  /** v2: each `settle` step's reference `quietAt`, where `cutAt` is taken. */
  cuts: ReadonlyMap<number, number>;
  /** A wait that stalled (a call live and no timer left). */
  problem?: string;
}

/**
 * The shared wait on one run at `settle` step `step`: advance the fake
 * clock to the step's target, if one is set, then while a batch is live
 * (`busy`), up to the cap, `boundMs` of fake time after `settle()`
 * resolved. At a `judge` step the target is the other engine's time at its
 * cap: still busy on reaching it, this run is live at the cap too.
 */
async function waitOutBatches(
  drain: DrainRun,
  system: AnySystem,
  ctx: BuildContext,
  step: number,
  attachedAtSettle: string | false | undefined,
): Promise<void> {
  const from = Date.now();
  const wait: SettleWait = {
    step,
    resolvedAt: from,
    endAt: from,
    waited: false,
  };
  drain.waits.push(wait);
  // Read at the instant settle() resolved (`apply`), not here: driving
  // settle() to its end can let a timer due in that same millisecond run
  // after it resolved, and work that timer starts was not left attached by
  // settle(); 1.35 waits such work out like any other (deep seed 24301).
  const attached = drain.v2 ? (attachedAtSettle ?? false) : false;
  if (attached !== false) {
    // v2's settle() resolved early, with attached work left: it takes no
    // part in the wait, and its checkpoint must differ.
    wait.attached = attached;

    return;
  }
  // One timer at a time, as the engine's own wait goes, so a run whose own
  // end is the target stops at the very same point; before the target it
  // goes on even when nothing is live. A sentinel timer at the target keeps
  // the clock moving there and is cleared after.
  const target = Math.max(drain.targets.get(step) ?? from, from);
  const judge = drain.judge.has(step);
  const sentinel =
    target > from ? setTimeout(() => {}, target - from) : undefined;
  const wroteBefore = drain.rule.writeAfterAbort?.(ctx) ?? 0;
  const cut = drain.v2 ? drain.cuts.get(step) : undefined;
  if (cut !== undefined && from >= cut) {
    wait.cutAt = drain.mark();
  }
  let quietAt: number | undefined;
  for (;;) {
    const why = drain.rule.busy(ctx, system);
    if (why === false) {
      quietAt ??= Date.now();
    } else {
      quietAt = undefined;
    }
    if (why === false && Date.now() >= target) {
      break;
    }
    if (
      why !== false &&
      (Date.now() - from > drain.rule.boundMs ||
        (judge && Date.now() >= target))
    ) {
      wait.live = `${why}, ${Date.now() - from} ms after settle() resolved (cap ${drain.rule.boundMs} ms${Date.now() - from > drain.rule.boundMs ? "" : `; judged at ${target} ms, where the other engine was live at its cap`})`;
      break;
    }
    if (vi.getTimerCount() === 0) {
      // Nothing left can move the system: done, unless a call still runs.
      if (why !== false && why.startsWith("a call ")) {
        drain.problem ??= `the shared wait at step ${step} stalled: ${why}, and no timer left`;
      }
      break;
    }
    wait.waited = true;
    const before = drain.mark();
    await vi.advanceTimersToNextTimerAsync();
    await flushMicrotasks();
    if (cut !== undefined && wait.cutAt === undefined && Date.now() >= cut) {
      // Records the timers at or past the cut made are not before it.
      wait.cutAt = before;
    }
  }
  clearTimeout(sentinel);
  wait.endAt = Date.now();
  wait.quietAt = quietAt ?? wait.endAt;
  if (cut !== undefined) {
    wait.cutAt ??= drain.mark();
  }
  wait.writeAfterAbort = (drain.rule.writeAfterAbort?.(ctx) ?? 0) - wroteBefore;
}

/** Rounds of the shared wait before it is called unsettled. */
export const SHARED_WAIT_ROUNDS = 12;

/**
 * The next targets for the shared wait, from the reference's and v2's
 * waits under `targets`, or undefined once they agree: every `settle` step,
 * up to the first with a batch still live at the cap, ended at the same
 * fake time on both (v2 counts only where it took part). At the first step
 * where they did not, the later end time becomes its target, and the
 * targets of later steps are dropped (they depend on it). An engine live at
 * the cap sets the target too: the other's clock must run as long, so
 * "finished in the same time" is judged with both clocks advanced alike.
 */
export function nextTargets(
  reference: readonly SettleWait[],
  v2: readonly SettleWait[] | undefined,
  targets: ReadonlyMap<number, number>,
  judgeOf: ReadonlySet<number> = new Set(),
): { targets: Map<number, number>; judge: Set<number> } | undefined {
  for (const r of reference) {
    const found = v2?.find((w) => w.step === r.step);
    const c = found?.attached === undefined ? found : undefined;
    const rLive = r.live !== undefined;
    const cLive = c?.live !== undefined;
    let end: number | undefined;
    let judged = false;
    if (rLive && cLive) {
      return undefined;
    }
    if (rLive || cLive) {
      // One live at its cap: the other must have run as long, then the
      // case is judged (it cannot be advanced past the cap).
      const live = rLive ? r : (c as SettleWait);
      const other = rLive ? c : r;
      if (other === undefined || other.endAt >= live.endAt) {
        return undefined;
      }
      end = live.endAt;
      judged = true;
    } else if (c !== undefined && c.endAt !== r.endAt) {
      end = Math.max(r.endAt, c.endAt);
    }
    if (end !== undefined) {
      const next = new Map<number, number>();
      for (const [step, at] of targets) {
        if (step < r.step) {
          next.set(step, at);
        }
      }
      next.set(r.step, end);
      const judge = new Set<number>();
      for (const step of judgeOf) {
        if (step < r.step) {
          judge.add(step);
        }
      }
      if (judged) {
        judge.add(r.step);
      }

      return { targets: next, judge };
    }
  }

  return undefined;
}

/** The first `settle` step a batch was still live at the cap, if any. */
export function firstLive(
  waits: readonly SettleWait[],
): SettleWait | undefined {
  return waits.find((w) => w.live !== undefined);
}

/**
 * An approved difference. It covers a difference in `scenario` on `stream`
 * with this `kind`; `engine`, `step`, `op` and `path` (a prefix inside the
 * entry) narrow it when given. Keyed by content, never by trace index.
 *
 * `ends: true` (fuzz only, signed; the census rejects it anywhere else)
 * marks an approved quirk whose consequences cascade: the difference it
 * covers ends the comparison of that fuzz case (`explain`).
 *
 * `when` (fuzz only) narrows an entry to the fuzz cases that have every
 * trigger it lists (`covers`; lib/fuzz.ts `FUZZ_TRIGGERS`). `during` (fuzz
 * only) narrows it to a difference in a step of that op (`stepOps`): row
 * (as)'s abort happens only while a settle step's settle() waits, so its
 * entry has `during` "settle" and never covers an abort in another step. For
 * a `moved` difference the step is the engine's own record's (`engineStep`),
 * not the reference's.
 * `group` (fuzz
 * only) is read by the census alone: an entry of a group is stale only when
 * no entry of its group covered a difference in the run.
 *
 * What it excuses is named, not just its class (P3-F1). A hand scenario's
 * entry lists its records in `excuses`, each with a `count` (`Excuse`); a
 * fuzz entry, whose records differ from seed to seed, gives a `bound` on
 * their payloads instead (`Bound`). `covers` reads both; `explain` also
 * stops an excuse at its count. Absent, the entry is the old wildcard over
 * its class: the census requires one of them on every entry.
 */
export interface Divergence {
  id: string;
  scenario: string;
  stream: string;
  kind: string;
  engine?: string;
  step?: number;
  op?: Difference["op"];
  path?: string;
  ends?: boolean;
  when?: string[];
  /** Fuzz only: the op of the step the difference must be in (`stepOps`). */
  during?: string;
  group?: string;
  excuses?: Excuse[];
  bound?: Bound;
  /**
   * Fuzz only: the entry covers a difference only when the same engine's
   * differences in the same case include one at or before it (its latest
   * position, `[step, phase, matched]`) that `requires` describes: its
   * stream, kind and op, and its `bound` if given (`covers`, given the
   * case's differences). Row n's batch entries require 2.0's own timeout
   * record of a batch call, so a batch record a case merely configured with
   * a timeout lacks is not excused (L7 follow-ups; deep case 1/1967 hid the
   * re-raise bug that way).
   */
  requires?: Requirement;
  /**
   * Fuzz only: the op of a step the difference must come after (`stepOps`):
   * the 2/352 entries cover a late write's hooks only after `destroy`.
   */
  afterOp?: string;
  /**
   * Fuzz only, op `missing`: the entry covers only a dropped repeat
   * (`Difference.repeat`), a record the reference made more times in its
   * step than the engine did, never one the engine lacks outright: row
   * (av)'s second cancel at a stop of a requirement 1.35's queue held
   * twice (PR seed 15).
   */
  repeats?: true;
  /**
   * Op `moved` only: which way the engine's record moved, one step later
   * (1, the default) or one step earlier (-1) than the reference's
   * (`fileMoves`, `Difference.by`).
   */
  by?: 1 | -1;
  reason: string;
  approvedBy: string;
  date: string;
}

/** What an entry's `requires` asks of the case's other differences. */
export interface Requirement {
  stream: string;
  kind: string;
  op: Difference["op"];
  bound?: Bound;
  /**
   * "any": anywhere in the case, not only at or before (the other half of
   * a pair the comparison could not pair, such as 1.35's later call that
   * (ap) moves).
   */
  order?: "any";
}

/** The scenario name every fuzz case runs under (diff/fuzz/model.ts `toScenario`). */
export const FUZZ_SCENARIO = "fuzz";

export type { Bound, Difference, Excuse };

export interface ScenarioResult {
  name: string;
  ok: boolean;
  /** Reference run twice differed: the scenario or recorder is not deterministic. */
  nondeterministic: Difference[];
  /** Contract differences against each engine under test. */
  differences: Difference[];
  /** Contract differences no divergence covers. */
  unexplained: Difference[];
  /** Incidental differences and interleaving changes: printed, not failing. */
  advisories: string[];
  /** Divergence ids that covered at least one difference. */
  used: string[];
  /** Each covered difference, with the entry and excuse that covered it. */
  covered?: Covered[];
  /** Where an `ends` divergence stopped the comparison of a fuzz case. */
  ended: Ended[];
  /** Engines compared against the reference. */
  compared: string[];
  traces: { reference: TraceEntry[]; candidate: TraceEntry[] };
  /**
   * Each engine under test's trace, by name (`traces.candidate` is the
   * first engine's, the workspace 1.x engine's by default): a reported
   * fuzz case's file takes v2's from here (lib/fuzz.ts `caseFile`).
   */
  engineTraces?: Record<string, TraceEntry[]>;
  /**
   * The reference's first run passed the timer-callback budget: the case
   * itself never settles, so nothing is compared (`ok` is false; the fuzzer
   * discards such a case as a runaway and counts it).
   */
  runaway: boolean;
  /**
   * `settle` steps at which the reference's first run's clock advanced in
   * the shared wait (`SettleDrain`; Jason, 2026-11-07: "One shared wait
   * (Recommended)").
   */
  drained?: number;
  /** `settle` steps at which v2's clock advanced in the shared wait. */
  drainedDetached?: number;
  /**
   * Rounds the shared wait ran the reference and v2 to find each `settle`
   * step's common end time (1 when their own waits already agreed).
   */
  sharedRounds?: number;
  /**
   * The reference's first run still had a batch live at the shared wait's
   * cap (`SettleDrain.boundMs`) at a settle step: 1.35's batches never
   * settle (a "retry" boundary re-dispatching a batch whose errors 1.35
   * records after its run ends, a fallback batch nothing cancels, or two
   * writes chasing each other on both engines), so nothing is compared
   * (`ok` is false). The fuzzer discards such a case, like a reference
   * runaway, but counts it on its own, never toward the runaway limit, and
   * fails a seed with more than maxNeverSettles of them (lib/fuzz.ts;
   * Jason, 2026-11-07: "Discard, own count (Recommended)"). `bothLive`
   * says v2 was still live at the cap too, at or before that step.
   */
  neverSettles?: boolean;
  bothLive?: boolean;
  /**
   * Only v2 still had a batch live at the cap while 1.35's had finished in
   * the same time: the case fails, as a 2.0 bug (Jason, 2026-11-07: "One
   * shared wait (Recommended)"). Names what kept v2 live.
   */
  twoOnlyLive?: string;
  /**
   * Fuzz cases with the shared wait: each run's `settle` checkpoint times
   * (`SettleWait.endAt`), by engine (the reference's first run, and each
   * engine under test).
   */
  settleTimes?: Record<string, number[]>;
  /**
   * Runs that passed the budget where the reference's first run settled:
   * an engine under test that hangs, or a second reference run that did
   * (nondeterminism). Always a failure, except a run in `discarded`.
   */
  hung: string[];
  /**
   * Engines under test that passed the budget after an `ends` divergence
   * on that same engine had already stopped their comparison (the stop's
   * record came before the engine made more timer callbacks than the
   * reference's whole run, `stopsBefore`). Not a hang: the case is
   * discarded like a reference runaway and counted toward the same limit
   * (`tallyCase`). Its differences before the stop are still checked, so
   * the case can still fail on them (Jason, 2026-11-02: "Discard after the
   * stop"). v2 is discarded the same way when it alone was live at the
   * shared wait's cap after such a stop (Jason, 2026-11-08: "Use 'Discard after the stop' (Recommended)").
   */
  discarded: string[];
  /**
   * Each discard after a stop: the engine, the `ends` entry whose stop came
   * first, and whether it was at the shared wait's cap (`wait`) rather
   * than past the timer budget.
   */
  afterStop?: { engine: string; id: string; wait: boolean }[];
  /** Timer callbacks the reference's first run made. */
  fired: number;
  report: string;
}

/** A test-only hook: transform an engine before it runs (tamper tests). */
export type EngineWrap = (engine: EngineHandle) => EngineHandle;

export interface RunOptions {
  /** Replace the local engine under test (tamper tests inject faults here). */
  wrapCandidate?: EngineWrap;
  /** Use exactly these engines under test instead of the default set. */
  candidates?: EngineHandle[];
  /** Replace the reference engine (budget self-tests only). */
  wrapReference?: EngineWrap;
  divergences?: Divergence[];
}

// ---------------------------------------------------------------------------

export function readDivergences(): Divergence[] {
  return JSON.parse(
    readFileSync(join(here, "divergences.json"), "utf8"),
  ) as Divergence[];
}

interface LayerRules {
  current: string | null;
  scenarios?: Record<string, string>;
}

function readLayerRules(): LayerRules {
  return JSON.parse(
    readFileSync(join(here, "../layers.rules.json"), "utf8"),
  ) as LayerRules;
}

const layerNumber = (layer: string) => Number(layer.slice(1));

/** The highest layer core-next has built (layers.rules.json `current`); null until Phase 1. */
export function currentLayer(): string | null {
  return readLayerRules().current;
}

/** Whether v2 runs a scenario at `layer` under the current ladder. */
export function v2Runs(layer: string | undefined): boolean {
  const { current } = readLayerRules();

  return (
    current !== null &&
    layer !== undefined &&
    layerNumber(layer) <= layerNumber(current)
  );
}

function seedOf(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  return h >>> 0;
}

/** mulberry32: small, fast and the same everywhere. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;

  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FAKED = [
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "setImmediate",
  "clearImmediate",
  "Date",
  "performance",
] as const;

/** Captured before any run installs fake timers. */
const realSetImmediate = globalThis.setImmediate;
const realSetTimeout = globalThis.setTimeout;
const realNow = Date.now.bind(Date);

/** Real wall-clock budget for work that settles off the fake clock. */
const REAL_ASYNC_BUDGET_MS = 2000;

const CONSOLE_LEVELS = ["log", "info", "warn", "error", "debug"] as const;

/**
 * The most timer callbacks (setTimeout, setInterval, setImmediate firings)
 * one engine run may make. Nothing else bounds a run: `advance` and the
 * fake clock run every timer that falls due, so a system whose timers keep
 * scheduling more (1.35 resolvers re-triggering each other through late
 * writes of cancelled bodies, legal 1.35 behaviour) never returns. Counted
 * on the fake clock, so the same case always lands on the same side.
 * `DIFF_RUN_BUDGET` overrides it (for measuring).
 */
export const RUN_BUDGET = Number(process.env.DIFF_RUN_BUDGET ?? 20_000);

type TimerFn = (cb: unknown, ...rest: unknown[]) => unknown;
const COUNTED = ["setTimeout", "setInterval", "setImmediate"] as const;

/**
 * Count timer callbacks on the (already installed) fake timers. Past
 * `limit` the run is a runaway: every pending timer is cleared and further
 * callbacks are dropped, so the run winds down; its trace is not compared.
 * `past` is the reference's own total: `pastAt` marks the trace's length
 * just before the callback that takes the count past it runs.
 */
function installBudget(limit: number, past: number, mark: () => number) {
  const g = globalThis as unknown as Record<string, TimerFn>;
  const fakes = COUNTED.map((name) => [name, g[name] as TimerFn] as const);
  const state: {
    fired: number;
    exceeded: boolean;
    at?: number;
    pastAt?: number;
  } = {
    fired: 0,
    exceeded: false,
  };
  for (const [name, fake] of fakes) {
    g[name] = function (this: unknown, cb: unknown, ...rest: unknown[]) {
      if (typeof cb !== "function") {
        return fake.call(this, cb, ...rest);
      }

      return fake.call(
        this,
        function (this: unknown, ...args: unknown[]) {
          if (state.exceeded) {
            return;
          }
          if (++state.fired === past + 1) {
            state.pastAt = mark();
          }
          if (state.fired > limit) {
            state.exceeded = true;
            state.at = mark();
            vi.clearAllTimers();

            return;
          }

          return (cb as (...a: unknown[]) => unknown).apply(this, args);
        },
        ...rest,
      );
    };
  }

  return {
    state,
    uninstall() {
      for (const [name, fake] of fakes) {
        g[name] = fake;
      }
    },
  };
}

/**
 * Let queued microtasks run (the engine schedules with queueMicrotask). How
 * many rounds a `tick` flushes is incidental: a scenario should not
 * checkpoint mid-chain and call the result a contract.
 */
async function flushMicrotasks(rounds = 50): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>((resolve) => queueMicrotask(resolve));
  }
}

/** The step as it appears in the trace (functions by label only). */
function describeStep(step: Step): Json {
  if (step.op === "run" || step.op === "twin") {
    return { op: "run", label: step.label };
  }

  return normalize(step);
}

function setPath(system: AnySystem, key: string, value: unknown): void {
  // "ns.key" addresses a namespaced fact; a plain key a single-module fact.
  const dot = key.indexOf(".");
  if (dot > 0) {
    system.facts[key.slice(0, dot)][key.slice(dot + 1)] = value;
  } else {
    system.facts[key] = value;
  }
}

/** Await `promise` while advancing fake time until it settles (bounded). */
async function drive(promise: Promise<unknown>, rec: Recorder, where: string) {
  let done = false;
  promise.then(
    () => {
      done = true;
    },
    (error: unknown) => {
      done = true;
      rec.push({ k: "threw", where, error: normalize(error) });
    },
  );
  for (let i = 0; i < 500 && !done; i++) {
    await flushMicrotasks();
    if (done) {
      break;
    }
    if (vi.getTimerCount() === 0) {
      // Nothing scheduled on the fake clock: the promise waits on real
      // async work (WebCrypto in snapshot signing). Give the real event
      // loop a bounded number of turns before calling it stalled.
      // Bounded by real time, not turn count: WebCrypto runs on the
      // threadpool and its latency grows under CI load.
      const deadline = realNow() + REAL_ASYNC_BUDGET_MS;
      for (let turn = 0; !done && realNow() < deadline; turn++) {
        await new Promise<void>((resolve) =>
          turn < 100 ? realSetImmediate(resolve) : realSetTimeout(resolve, 1),
        );
        await flushMicrotasks(5);
      }
      if (done) {
        continue;
      }
      rec.push({ k: "threw", where, error: "stalled: no timers left" });
      break;
    }
    await vi.advanceTimersToNextTimerAsync();
  }
  if (!done) {
    rec.push({ k: "threw", where, error: "stalled: 500 timer jumps" });
  }
}

/**
 * `system.settle()`, then the shared wait (`waitOutBatches`) when the case
 * has one: a `settle` step's main system, or a `twin` step's second system
 * (Jason, 2026-11-07: "One shared wait (Recommended)"; a twin's settle() is
 * judged as a main settle step's is, L7 follow-ups). Returns whether
 * `settle()` resolved (a rejection is recorded as thrown at `where`).
 */
async function settleShared(
  system: AnySystem,
  ctx: BuildContext,
  rec: Recorder,
  drain: { run: DrainRun; at: number } | undefined,
  where: string,
): Promise<boolean> {
  const settled = Promise.resolve(system.settle());
  let resolved = true;
  settled.catch(() => {
    resolved = false;
  });
  // v2's attached work, read the instant its settle() settles: this
  // handler is registered before `drive`'s, so it runs first.
  let attached: string | false | undefined;
  if (drain?.run.v2) {
    const read = () => {
      attached = drain.run.rule.attached?.(ctx, system) ?? false;
    };
    settled.then(read, read);
  }
  await drive(settled, rec, where);
  if (drain) {
    await waitOutBatches(drain.run, system, ctx, drain.at, attached);
  }

  return resolved;
}

async function apply(
  step: Step,
  system: AnySystem,
  ctx: BuildContext,
  rec: Recorder,
  snapshots: Map<string, unknown>,
  drain: { run: DrainRun; at: number } | undefined,
): Promise<void> {
  // Values a step hands the engine are copied per run: the engine may keep
  // and mutate what it is given (1.35 lets an effect push into a stored
  // array), and a shared step value would carry that into the next run.
  switch (step.op) {
    case "dispatch":
      system.dispatch(structuredClone(step.event));
      break;
    case "set":
      setPath(system, step.key, structuredClone(step.value));
      break;
    case "batch":
      system.batch(() => {
        for (const [key, value] of step.writes) {
          setPath(system, key, structuredClone(value));
        }
      });
      break;
    case "advance":
      await vi.advanceTimersByTimeAsync(step.ms);
      break;
    case "tick":
      await flushMicrotasks();
      break;
    case "settle":
      await settleShared(system, ctx, rec, drain, "settle");
      rec.checkpoint("settle");
      break;
    case "twin": {
      let twin: AnySystem;
      try {
        twin = step.open(system, ctx);
      } catch (error) {
        rec.push({ k: "threw", where: step.label, error: normalize(error) });
        break;
      }
      if (await settleShared(twin, ctx, rec, drain, step.label)) {
        await drive(Promise.resolve(step.close(twin, ctx)), rec, step.label);
      }
      break;
    }
    case "checkpoint":
      rec.checkpoint(step.label);
      break;
    case "start":
      await drive(Promise.resolve(system.start()), rec, "start");
      break;
    case "stop":
      await drive(Promise.resolve(system.stop()), rec, "stop");
      break;
    case "destroy":
      await drive(Promise.resolve(system.destroy()), rec, "destroy");
      rec.push({ k: "timers", at: "destroy", pending: vi.getTimerCount() });
      break;
    case "back":
      system.history.goBack(step.steps);
      break;
    case "forward":
      system.history.goForward(step.steps);
      break;
    case "snapshot":
      snapshots.set(step.label, system.getSnapshot());
      break;
    case "restore":
      system.restore(snapshots.get(step.label));
      break;
    case "run":
      await drive(Promise.resolve(step.fn(system, ctx)), rec, step.label);
      break;
  }
}

/** Run one scenario on one engine and return its trace. */
export async function runOn(
  engine: EngineHandle,
  def: ScenarioDef,
): Promise<TraceEntry[]> {
  return (await runBudgeted(engine, def)).trace;
}

export interface BudgetedRun {
  trace: TraceEntry[];
  /** Timer callbacks the run made (at most the budget + 1). */
  fired: number;
  /** The run passed the budget: its trace is cut short and not compared. */
  runaway: boolean;
  /** For a runaway, the trace's length when the budget ran out. */
  runawayAt?: number;
  /**
   * The trace's length just before the run's timer callback number
   * `referenceFired + 1` ran: every record at a lower index was emitted
   * while the run had made no more timer callbacks than the reference made
   * in its whole settled run. Every record a loop emits once it has
   * outworked the reference is at this index or later. Set for every
   * runaway (its count passes the limit, which the reference's does not).
   */
  pastReferenceAt?: number;
  /** `settle` steps at which a 1.35 run's clock advanced in the shared wait. */
  drained: number;
  /** `settle` steps at which v2's clock advanced in the shared wait. */
  drainedDetached: number;
  /** Each `settle` step's wait (`SettleWait`), in step order. */
  waits: SettleWait[];
  /**
   * The wait stalled, or (1.35's line) a batch was still live at its cap:
   * the case fails, except on the reference's first run past its cap
   * (`drainPastBound`).
   */
  drainProblem?: string;
  /**
   * A batch was still live at the shared wait's cap (not a stall). On the
   * reference's first run the case never settles on 1.35 and is discarded
   * (`ScenarioResult.neverSettles`).
   */
  drainPastBound?: boolean;
}

/** What a run's shared wait did, for `BudgetedRun`. */
function waitSummary(
  drain: DrainRun | undefined,
): Pick<
  BudgetedRun,
  "drained" | "drainedDetached" | "waits" | "drainProblem" | "drainPastBound"
> {
  const waits = drain?.waits ?? [];
  const waited = waits.filter((w) => w.waited).length;
  const live = firstLive(waits);
  // On 1.35's line a batch live at the cap is the run's own problem; v2's
  // is judged against the reference's (`runScenario`).
  const pastBound = live !== undefined && drain?.v2 === false;

  return {
    drained: drain && !drain.v2 ? waited : 0,
    drainedDetached: drain?.v2 ? waited : 0,
    waits,
    drainProblem:
      drain?.problem ??
      (pastBound
        ? `the shared wait at step ${live.step} passed its cap: ${live.live}`
        : undefined),
    drainPastBound: pastBound,
  };
}

/**
 * Run one scenario on one engine under a timer-callback budget.
 * `referenceFired`, the reference's total, sets `pastReferenceAt`.
 */
export async function runBudgeted(
  engine: EngineHandle,
  def: ScenarioDef,
  limit = def.budget ?? RUN_BUDGET,
  referenceFired = limit,
  targets: ReadonlyMap<number, number> = new Map(),
  judge: ReadonlySet<number> = new Set(),
  cuts: ReadonlyMap<number, number> = new Map(),
): Promise<BudgetedRun> {
  const rec = createRecorder();
  // Everything that makes a run deterministic, and everything that captures
  // what the engine prints, goes in before the engine loads.
  vi.useFakeTimers({ now: 0, toFake: [...FAKED] });
  const budget = installBudget(limit, referenceFired, () => rec.trace.length);
  const drain: DrainRun | undefined =
    def.settleDrain && (drains(engine) || drainsDetached(engine))
      ? {
          rule: def.settleDrain,
          targets,
          judge,
          waits: [],
          v2: drainsDetached(engine),
          mark: () => rec.trace.length,
          cuts,
        }
      : undefined;
  const random = vi
    .spyOn(Math, "random")
    .mockImplementation(seededRandom(def.seed ?? seedOf(def.name)));
  const consoles = CONSOLE_LEVELS.map((level) =>
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      rec.push({ k: "console", level, args: args.map((a) => normalize(a)) });
    }),
  );
  // A rejection nobody handles (the "throw" boundary strategy rethrows into
  // the engine's own promise) is behaviour too: record it, and keep it from
  // vitest, which would otherwise report it against whatever test runs next.
  const vitestHandlers = process.listeners("unhandledRejection");
  process.removeAllListeners("unhandledRejection");
  const onUnhandled = (reason: unknown) => {
    rec.push({ k: "unhandled", error: normalize(reason) });
  };
  process.on("unhandledRejection", onUnhandled);
  let system: AnySystem;
  let destroyed = false;
  try {
    const core = await engine.load();
    const ctx: BuildContext = {
      core,
      plugins: (await engine.loadPlugins()) ?? {},
      handles: {},
      external: (data) => rec.external(data),
    };
    try {
      const config = def.build(ctx);
      const plugins = (config.plugins as unknown[] | undefined) ?? [];
      system = core.createSystem({
        ...config,
        plugins: [...plugins, rec.plugin],
      } as never);
      record(system, {
        recorder: rec,
        derivations: def.observeDerivations !== false,
      });
    } catch (error) {
      rec.push({ k: "threw", where: "createSystem", error: normalize(error) });

      return {
        trace: rec.trace,
        fired: budget.state.fired,
        runaway: budget.state.exceeded,
        runawayAt: budget.state.at,
        pastReferenceAt: budget.state.pastAt,
        drained: 0,
        drainedDetached: 0,
        waits: [],
      };
    }
    const snapshots = new Map<string, unknown>();
    for (const [i, step] of def.steps.entries()) {
      rec.push({ k: "step", i, step: describeStep(step) });
      let pending: Promise<void>;
      try {
        pending = apply(
          step,
          system,
          ctx,
          rec,
          snapshots,
          drain && { run: drain, at: i },
        );
      } catch (error) {
        pending = Promise.reject(error);
      }
      // Everything recorded so far happened inside the step's call.
      rec.push({ k: "async", i });
      try {
        await pending;
      } catch (error) {
        rec.push({ k: "threw", where: `step ${i}`, error: normalize(error) });
      }
      if (step.op === "destroy") {
        destroyed = true;
      }
    }
    await flushMicrotasks();
    if (!destroyed) {
      rec.checkpoint("end");
    }
  } finally {
    if (system && !destroyed) {
      // Stop timers and resolvers so nothing leaks into the next run.
      await drive(Promise.resolve(system.destroy()), rec, "teardown");
      rec.push({ k: "timers", at: "teardown", pending: vi.getTimerCount() });
    }
    // Node reports an unhandled rejection after the macrotask it happened
    // in; give it one before the handlers go back.
    await new Promise<void>((resolve) => realSetImmediate(resolve));
    process.off("unhandledRejection", onUnhandled);
    for (const handler of vitestHandlers) {
      process.on("unhandledRejection", handler);
    }
    rec.detach();
    for (const spy of consoles) {
      spy.mockRestore();
    }
    random.mockRestore();
    budget.uninstall();
    vi.clearAllTimers();
    vi.useRealTimers();
  }

  return {
    trace: rec.trace,
    fired: budget.state.fired,
    runaway: budget.state.exceeded,
    runawayAt: budget.state.at,
    pastReferenceAt: budget.state.pastAt,
    ...waitSummary(drain),
  };
}

// ---------------------------------------------------------------------------
// Reporting

function short(entry: TraceEntry | undefined): string {
  if (!entry) {
    return "(none)";
  }
  const text = JSON.stringify(entry);

  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

function describeDifference(d: Difference): string {
  const where = `${d.stream} "${d.kind}" in step ${d.step} (${d.phase})`;
  switch (d.op) {
    case "missing":
      return `${where}: missing on ${d.engine}`;
    case "extra":
      return `${where}: extra on ${d.engine}`;
    case "changed":
      return `${where}: ${d.path} differs on ${d.engine}`;
    case "moved":
      return `${where}: moved to step ${d.step + 1} on ${d.engine}`;
  }
}

/** A readable report: each difference, the first with context on each side. */
export function formatReport(
  name: string,
  title: string,
  differences: Difference[],
  reference: TraceEntry[],
  candidates: Record<string, TraceEntry[]>,
  referenceLabel: string,
): string {
  if (differences.length === 0) {
    return "";
  }
  const first = differences[0] as Difference;
  const candidate = candidates[first.engine] ?? [];
  const lines = [
    `${title} in scenario "${name}": ${differences.length} difference(s)`,
    `first: ${describeDifference(first)}`,
  ];
  if (first.op === "changed") {
    lines.push(
      `  ${referenceLabel}: ${JSON.stringify(first.reference)}`,
      `  ${first.engine}: ${JSON.stringify(first.candidate)}`,
    );
  }
  lines.push("", "context:");
  const around = (
    trace: TraceEntry[],
    at: number | undefined,
    label: string,
  ) => {
    if (at === undefined) {
      return;
    }
    for (let i = Math.max(0, at - 3); i <= at + 1 && i < trace.length; i++) {
      lines.push(`${i === at ? ">" : " "} ${label} [${i}] ${short(trace[i])}`);
    }
  };
  around(reference, first.at.reference, referenceLabel);
  around(candidate, first.at.candidate, first.engine);
  if (differences.length > 1) {
    lines.push("", "others:");
    for (const d of differences.slice(1, 12)) {
      lines.push(`  ${describeDifference(d)}`);
    }
    if (differences.length > 12) {
      lines.push(`  … ${differences.length - 12} more`);
    }
  }

  return lines.join("\n");
}

/**
 * The step of the record the engine under test made: a difference's `step`
 * is the reference's, and a `moved` record is one step later on the engine
 * (`by` 1, the default) or one step earlier (`by` -1), so `during` reads
 * that step for it.
 */
function engineStep(d: Difference): number {
  return d.op === "moved" ? d.step + (d.by ?? 1) : d.step;
}

/**
 * Whether `div` covers difference `d` of scenario `name`. An entry with
 * `when` covers only in a fuzz case whose `triggers` include every one it
 * lists: never in a hand scenario, nor in a case without a trigger set.
 */
export function covers(
  div: Divergence,
  name: string,
  d: Difference,
  triggers?: readonly string[],
  steps?: ReadonlyMap<number, string>,
  context?: readonly Difference[],
): boolean {
  return (
    div.scenario === name &&
    (div.when === undefined ||
      (name === FUZZ_SCENARIO &&
        triggers !== undefined &&
        div.when.every((t) => triggers.includes(t)))) &&
    (div.during === undefined ||
      (name === FUZZ_SCENARIO && steps?.get(engineStep(d)) === div.during)) &&
    div.stream === d.stream &&
    div.kind === d.kind &&
    (div.engine === undefined || div.engine === d.engine) &&
    (div.step === undefined || div.step === d.step) &&
    (div.op === undefined || div.op === d.op) &&
    (div.path === undefined ||
      (d.path !== undefined &&
        (d.path === div.path ||
          d.path.startsWith(`${div.path}.`) ||
          d.path.startsWith(`${div.path}[`)))) &&
    (div.excuses === undefined || div.excuses.some((x) => names(x, d))) &&
    (div.repeats !== true ||
      (name === FUZZ_SCENARIO && d.op === "missing" && d.repeat === true)) &&
    (div.op !== "moved" || (div.by ?? 1) === (d.by ?? 1)) &&
    (div.bound === undefined || admits(div.bound, d)) &&
    (div.requires === undefined ||
      (name === FUZZ_SCENARIO && meets(div.requires, d, context ?? []))) &&
    (div.afterOp === undefined ||
      (name === FUZZ_SCENARIO &&
        [...(steps ?? new Map<number, string>())].some(
          ([i, op]) => op === div.afterOp && i < d.step,
        )))
  );
}

/**
 * Whether `context` (one case's differences) holds a difference `req`
 * describes on `d`'s engine, at or before `d` (`Divergence.requires`).
 * Across the two traces only `[step, phase, matched]` orders records, so
 * the same gap counts as at or before.
 */
export function meets(
  req: Requirement,
  d: Difference,
  context: readonly Difference[],
): boolean {
  const at = latestPosition(d);
  // The two earliest differences `req` describes on `d`'s engine (one may
  // be `d` itself, which never counts): whether any is at or before `d` is
  // whether the earliest other one is. Found once per context and entry,
  // not once per difference covered: a runaway case holds over a million
  // differences (deep case 2/2137, 1.7M records on v2), and a scan per
  // difference made its `explain` quadratic.
  const earliest = earliestMeeting(req, context).get(d.engine) ?? [];
  const other = earliest.find((x) => x !== d);

  return (
    other !== undefined &&
    (req.order === "any" || comparePositions(latestPosition(other), at, 3) <= 0)
  );
}

/** Per context (and its length when read) and entry: `earliestMeeting`. */
const MEETING = new WeakMap<
  readonly Difference[],
  { length: number; byReq: Map<Requirement, Map<string, Difference[]>> }
>();

/**
 * The two earliest differences of `context` that `req` describes, by
 * engine: its stream, kind and op, and its `bound` if given, earliest by
 * position (`latestPosition`, as `meets` compares them).
 */
function earliestMeeting(
  req: Requirement,
  context: readonly Difference[],
): Map<string, Difference[]> {
  let memo = MEETING.get(context);
  if (memo === undefined || memo.length !== context.length) {
    memo = { length: context.length, byReq: new Map() };
    MEETING.set(context, memo);
  }
  const known = memo.byReq.get(req);
  if (known) {
    return known;
  }
  const out = new Map<string, Difference[]>();
  for (const x of context) {
    if (
      x.stream !== req.stream ||
      x.kind !== req.kind ||
      x.op !== req.op ||
      (req.bound !== undefined && !admits(req.bound, x))
    ) {
      continue;
    }
    const two = out.get(x.engine) ?? [];
    two.push(x);
    two.sort((p, q) =>
      comparePositions(latestPosition(p), latestPosition(q), 3),
    );
    out.set(x.engine, two.slice(0, 2));
  }
  memo.byReq.set(req, out);

  return out;
}

/**
 * The op of each step of a trace, by the step's index (its `step` records):
 * what an entry's `during` reads (`covers`). Both engines run the same
 * steps, so the reference's trace names them for every engine.
 */
export function stepOps(trace: TraceEntry[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const e of trace) {
    const op = e.k === "step" ? (e.step as { op?: unknown })?.op : undefined;
    if (e.k === "step" && typeof op === "string") {
      out.set(e.i, op);
    }
  }

  return out;
}

/** A difference an entry covered: by which entry, and which of its excuses. */
export interface Covered {
  id: string;
  /** The index in the entry's `excuses`; absent for an entry without. */
  excuse?: number;
  difference: Difference;
}

/** A fuzz case whose comparison an `ends` divergence stopped, on one engine. */
export interface Ended {
  engine: string;
  /** The `ends` divergence that stopped it. */
  id: string;
  /** The difference it covered, where the comparison stopped. */
  at: Difference;
  /** Later differences of that case on that engine, not compared. */
  dropped: number;
}

/**
 * Match one scenario's contract differences to divergences. Each difference
 * is covered by the first entry that covers it (`covers`, with the fuzz
 * case's `triggers`), in file order: covered, it passes and the entry is
 * used; uncovered, it is reported.
 *
 * A fuzz case on one engine also stops at its first difference whose
 * covering entry has `ends: true` (the earliest by `latestPosition`): that
 * difference passes, and the stop covers every stream of the case (Jason,
 * 2026-11-01: "when an approved quirk ends a case, drop every stream's
 * unmatched records after the last record both engines matched before the
 * stop"). A difference is not compared when
 *
 * - it is an unmatched record (missing or extra), in any stream, after the
 *   stop's shared match point: the last record both traces matched before
 *   the stop, across streams (`SharedPoint`, `isPastSharedPoint`,
 *   diff/compare.ts); or
 * - it is past the stop in every trace it is in (`isPastStop`): strictly
 *   after it, or in the same gap as the stop (between the same two matched
 *   records, in either trace). This is how a changed difference (a matched
 *   pair) after the stop is dropped; or
 * - it is a changed difference after the shared match point with either of
 *   its records past the stop in its own trace (`straddlesStop`; Jason,
 *   2026-11-01: "a changed record whose 2.0 half or 1.35 half is past the
 *   stop, and that sits after the shared match point, is dropped, as its two
 *   halves would be if left unpaired").
 *
 * A difference before the shared match point is still matched as usual (and
 * an uncovered one still fails), whatever its stream, as is a changed one
 * with both records before the stop ("A pair with both halves before the
 * stop is still checked, so no difference from before the quirk is
 * hidden"). Only an `ends` entry stops, and only in a case
 * with its `when` triggers; each engine is walked on its own, and a hand
 * scenario never stops: there `ends` is just an entry.
 */
export function explain(
  name: string,
  differences: Difference[],
  divergences: Divergence[],
  triggers?: readonly string[],
  steps?: ReadonlyMap<number, string>,
): {
  unexplained: Difference[];
  used: string[];
  ended: Ended[];
  covered: Covered[];
} {
  const coverOf = (d: Difference) =>
    divergences.find((x) => covers(x, name, d, triggers, steps, differences));
  // How many of its records each excuse has excused so far in this run.
  const spent = new Map<Divergence, number[]>();
  // The first entry that covers `d` and, if it lists excuses, still has
  // one naming `d` below its count (an over-count copy falls through to the
  // next entry, and is unexplained if none takes it).
  const take = (d: Difference): Covered | undefined => {
    for (const div of divergences) {
      if (!covers(div, name, d, triggers, steps, differences)) {
        continue;
      }
      if (div.excuses === undefined) {
        return { id: div.id, difference: d };
      }
      const counts = spent.get(div) ?? div.excuses.map(() => 0);
      spent.set(div, counts);
      const i = div.excuses.findIndex(
        (x, k) => names(x, d) && (counts[k] as number) < x.count,
      );
      if (i >= 0) {
        counts[i] = (counts[i] as number) + 1;

        return { id: div.id, excuse: i, difference: d };
      }
    }

    return undefined;
  };
  const cuts = new Map<string, { at: Difference; id: string }>();
  if (name === FUZZ_SCENARIO) {
    for (const d of differences) {
      const div = coverOf(d);
      const cut = cuts.get(d.engine);
      if (
        div?.ends === true &&
        (!cut ||
          comparePositions(latestPosition(d), latestPosition(cut.at)) < 0)
      ) {
        cuts.set(d.engine, { at: d, id: div.id });
      }
    }
  }
  const used = new Set<string>();
  const covered: Covered[] = [];
  const dropped = new Map<string, number>();
  const unexplained = differences.filter((d) => {
    const cut = cuts.get(d.engine);
    if (
      cut &&
      (isPastSharedPoint(d, cut.at) ||
        isPastStop(d, cut.at) ||
        straddlesStop(d, cut.at) ||
        sameRecord(d, cut.at))
    ) {
      dropped.set(d.engine, (dropped.get(d.engine) ?? 0) + 1);

      return false;
    }
    const c = take(d);
    if (c) {
      used.add(c.id);
      covered.push(c);

      return false;
    }

    return true;
  });

  return {
    unexplained,
    used: [...used],
    covered,
    ended: [...cuts].map(([engine, { at, id }]) => ({
      engine,
      id,
      at,
      dropped: dropped.get(engine) ?? 0,
    })),
  };
}

/**
 * Whether `d` is another field of a changed stop's own record pair: a
 * `changed` difference at another path of the same two records. The stop's
 * record is where the approved quirk shows, so its other fields are part of
 * that difference, not compared on their own (L7 follow-ups, deep case
 * 24301/4050). A move's fields are not: a move covers only the step, and
 * each field that differs is still compared (`fileMoves`). Self-test:
 * diff/self/l7-followups.test.ts.
 */
export function sameRecord(d: Difference, stop: Difference): boolean {
  return (
    d !== stop &&
    d.op === "changed" &&
    stop.op === "changed" &&
    d.engine === stop.engine &&
    d.stream === stop.stream &&
    d.kind === stop.kind &&
    d.at.reference === stop.at.reference &&
    d.at.candidate === stop.at.candidate
  );
}

/**
 * Whether an `ends` stop on one engine came before that engine's runaway,
 * so the comparison had already ended when the run stopped settling (Jason,
 * 2026-11-02: "Discard after the stop"). The runaway starts at
 * `pastReferenceAt` (from `runBudgeted`): the point the engine had made more
 * timer callbacks than the reference made in its whole settled run, not
 * the later point the budget ran out. Up to there the engine has done no
 * more timer work than a settling run needs; from there on it is doing work
 * the reference never did, so a record there may be the loop's own (an
 * extra hook record a loop repeats can match an `ends` entry) and cannot be
 * the stop that ended the comparison first. A stop with a record in the
 * engine's trace (extra or changed) came first when that record's index is
 * strictly below `pastReferenceAt`. A stop that is the reference's alone
 * (missing) came first only when its segment (step, then setup, sync or
 * async phase) ends before the one the runaway started in: in the same
 * segment the engine may simply not have reached it yet, so that runaway is
 * still a hang.
 */
export function stopsBefore(
  stop: Difference,
  trace: TraceEntry[],
  pastReferenceAt: number | undefined,
): boolean {
  if (pastReferenceAt === undefined) {
    return false;
  }
  if (stop.at.candidate !== undefined) {
    return stop.at.candidate < pastReferenceAt;
  }
  const where = stop.where.reference;
  if (!where) {
    return false;
  }
  // The runaway's segment, as keyTrace (diff/compare.ts) files records.
  let step = -1;
  let phase = 0;
  for (const entry of trace.slice(0, pastReferenceAt)) {
    if (entry.k === "step") {
      step = entry.i;
      phase = 1;
    } else if (entry.k === "async") {
      phase = 2;
    }
  }

  return where[0] < step || (where[0] === step && where[1] < phase);
}

/**
 * File moves (`Difference.op` "moved"): a missing record in step N and the
 * first unpaired extra record of the same engine, stream and kind in step
 * N + 1 (or, failing that, N - 1: `by` -1, the engine's record one step
 * earlier) become one move, at the missing record's place, but only where a
 * signed entry with op `moved` (and the same `by`) covers that move (`covers`, with the case's
 * triggers); every other pair stays a missing and an extra, so no existing
 * entry sees its differences change shape. A move's other fields are
 * compared as a matched pair's are: each field that differs is a `changed`
 * difference of its own, after the move. Its shared match point is the
 * earlier of the two records' (`SharedPoint`: the chain is ordered in both
 * traces at once). Self-tests: diff/self/moved.test.ts.
 */
export function fileMoves(
  name: string,
  differences: Difference[],
  divergences: Divergence[],
  triggers?: readonly string[],
  steps?: ReadonlyMap<number, string>,
): Difference[] {
  const movers = divergences.filter((div) => div.op === "moved");
  if (movers.length === 0) {
    return differences;
  }
  const taken = new Set<Difference>();
  const filed = new Map<Difference, Difference[]>();
  // The extra records by engine, stream, kind and step, in order: one pass,
  // so a case with a long cascade of differences stays linear.
  const key = (d: Difference, step: number) =>
    `${d.engine}\u0000${d.stream}\u0000${d.kind}\u0000${step}`;
  const extras = new Map<string, Difference[]>();
  for (const d of differences) {
    if (d.op === "extra") {
      const list = extras.get(key(d, d.step));
      if (list) {
        list.push(d);
      } else {
        extras.set(key(d, d.step), [d]);
      }
    }
  }
  for (const m of differences) {
    if (m.op !== "missing") {
      continue;
    }
    // One step later first (the first kind of move), then one step earlier.
    let moved: Difference | undefined;
    let x: Difference | undefined;
    for (const by of [1, -1] as const) {
      x = extras.get(key(m, m.step + by))?.find((d) => !taken.has(d));
      if (!x) {
        continue;
      }
      const { raw: _raw, ...base } = m;
      const candidate: Difference = {
        ...base,
        op: "moved",
        ...(by === -1 ? { by } : {}),
        candidate: x.candidate,
        at: { reference: m.at.reference, candidate: x.at.candidate },
        where: { reference: m.where.reference, candidate: x.where.candidate },
        shared: m.shared.reference <= x.shared.reference ? m.shared : x.shared,
      };
      if (
        movers.some((div) =>
          covers(div, name, candidate, triggers, steps, differences),
        )
      ) {
        moved = candidate;
        break;
      }
    }
    if (!moved || !x) {
      continue;
    }
    const move = moved;
    taken.add(x);
    const fields: { path: string; reference?: Json; candidate?: Json }[] = [];
    diffJson(m.reference, x.candidate, "", fields);
    filed.set(m, [
      move,
      ...fields.map((f) => ({
        ...move,
        op: "changed" as const,
        path: f.path,
        reference: f.reference,
        candidate: f.candidate,
        record: m.reference,
      })),
    ]);
  }

  return differences.flatMap((d) =>
    taken.has(d) ? [] : (filed.get(d) ?? [d]),
  );
}

export async function runScenario(
  def: ScenarioDef,
  opts: RunOptions = {},
): Promise<ScenarioResult> {
  const [v1, local, v2] = engines() as [
    EngineHandle,
    EngineHandle,
    EngineHandle | undefined,
  ];
  const reference = opts.wrapReference ? opts.wrapReference(v1) : v1;
  const candidates = opts.candidates ?? [
    opts.wrapCandidate ? opts.wrapCandidate(local) : local,
    ...(v2 && v2Runs(def.layer) ? [v2] : []),
  ];
  const divergences = opts.divergences ?? readDivergences();

  const limit = def.budget ?? RUN_BUDGET;
  // The shared wait (`SettleDrain`; Jason, 2026-11-07: "One shared wait
  // (Recommended)"): run the reference and v2 under each round's targets
  // until every settle step ends at the same fake time on both.
  const twoOh = def.settleDrain ? candidates.find(drainsDetached) : undefined;
  let targets: ReadonlyMap<number, number> = new Map();
  let judge: ReadonlySet<number> = new Set();
  let firstRun: BudgetedRun;
  let twoRun: BudgetedRun | undefined;
  let rounds = 0;
  for (;;) {
    rounds++;
    firstRun = await runBudgeted(reference, def, limit, limit, targets, judge);
    twoRun =
      twoOh && !firstRun.runaway
        ? await runBudgeted(
            twoOh,
            def,
            limit,
            firstRun.fired,
            targets,
            judge,
            new Map(firstRun.waits.map((w) => [w.step, w.quietAt ?? w.endAt])),
          )
        : undefined;
    const next =
      twoRun && !twoRun.runaway
        ? nextTargets(firstRun.waits, twoRun.waits, targets, judge)
        : undefined;
    if (!next || rounds >= SHARED_WAIT_ROUNDS) {
      break;
    }
    ({ targets, judge } = next);
  }
  const first = firstRun.trace;
  if (firstRun.runaway) {
    // Nothing to compare: the reference itself does not settle.
    return {
      name: def.name,
      ok: false,
      nondeterministic: [],
      differences: [],
      unexplained: [],
      advisories: [],
      used: [],
      ended: [],
      compared: [],
      traces: { reference: first, candidate: [] },
      runaway: true,
      hung: [],
      discarded: [],
      fired: firstRun.fired,
      drained: firstRun.drained,
      report: `runaway in scenario "${def.name}": the reference (${reference.name}) made more than ${limit} timer callbacks, so the case never settles and is not compared`,
    };
  }
  // Which engine was live at the cap first: the reference (discarded,
  // whether or not v2 was live too) or v2 alone (a 2.0 bug).
  const refLive = firstLive(firstRun.waits);
  const twoLive = twoRun ? firstLive(twoRun.waits) : undefined;
  const twoAlone =
    twoLive !== undefined &&
    (refLive === undefined || twoLive.step < refLive.step);
  if (firstRun.drainPastBound && !twoAlone) {
    // Nothing to compare: the reference's batches never settle (Jason, 2026-11-07: "Discard, own count (Recommended)").
    const both = twoLive !== undefined && refLive !== undefined;

    return {
      name: def.name,
      ok: false,
      nondeterministic: [],
      differences: [],
      unexplained: [],
      advisories: [],
      used: [],
      ended: [],
      compared: [],
      traces: { reference: first, candidate: [] },
      runaway: false,
      neverSettles: true,
      bothLive: both,
      hung: [],
      discarded: [],
      fired: firstRun.fired,
      drained: firstRun.drained,
      sharedRounds: rounds,
      report: `never settles in scenario "${def.name}": on the reference (${reference.name}) ${firstRun.drainProblem}${both ? `, and on ${twoOh?.name} too (at step ${twoLive.step}: ${twoLive.live})` : ""}, so the case is discarded, not compared`,
    };
  }
  const againRun = await runBudgeted(
    reference,
    def,
    limit,
    limit,
    targets,
    judge,
  );
  const again = againRun.trace;
  const theirs: Record<string, TraceEntry[]> = {};
  const hung: string[] = [];
  const problems: string[] = [];
  if (againRun.runaway) {
    hung.push(`${reference.name} (second run)`);
    problems.push(
      `reference engine is not deterministic in scenario "${def.name}": its second run made more than ${limit} timer callbacks, the first ${firstRun.fired}`,
    );
  }
  for (const [label, run] of [
    [reference.name, firstRun],
    [`${reference.name} (second run)`, againRun],
  ] as const) {
    if (run.drainProblem) {
      problems.push(`${label} in scenario "${def.name}": ${run.drainProblem}`);
    }
  }
  let twoOnlyLive: string | undefined;
  // Only v2 live at the cap: a 2.0 bug, unless an `ends` stop on v2 came
  // first (judged once `ended` is known, after the comparison).
  let twoOnlyAt = "";
  if (twoAlone && twoOh) {
    const ref = firstRun.waits.find((w) => w.step === twoLive.step);
    twoOnlyAt = `at step ${twoLive.step} ${twoOh.name} still had a batch live at the shared wait's cap (${twoLive.live}) while the reference's batches had finished by ${ref?.quietAt ?? ref?.endAt ?? "?"} ms (its handlers wrote ${twoLive.writeAfterAbort ?? 0} time(s) after an abort during the wait)`;
  } else if (rounds >= SHARED_WAIT_ROUNDS && twoRun) {
    if (nextTargets(firstRun.waits, twoRun.waits, targets, judge)) {
      problems.push(
        `scenario "${def.name}": the shared wait found no common end time in ${SHARED_WAIT_ROUNDS} rounds`,
      );
    }
  }
  const runaways = new Map<string, number | undefined>();
  let drainedDetached = 0;
  const settleTimes: Record<string, number[]> = {
    [reference.name]: firstRun.waits.map((w) => w.endAt),
  };
  for (const engine of candidates) {
    const run =
      engine === twoOh && twoRun
        ? twoRun
        : await runBudgeted(engine, def, limit, firstRun.fired, targets, judge);
    theirs[engine.name] = run.trace;
    settleTimes[engine.name] = run.waits.map((w) => w.endAt);
    drainedDetached += run.drainedDetached;
    if (run.drainProblem) {
      problems.push(
        `${engine.name} in scenario "${def.name}": ${run.drainProblem}`,
      );
    }
    if (run.runaway) {
      runaways.set(engine.name, run.pastReferenceAt);
    }
  }

  const nondeterministic = compareFull(first, again, "v1 (second run)");
  const differences: Difference[] = [];
  const advisories: string[] = [];
  const steps = stepOps(first);
  for (const [engine, trace] of Object.entries(theirs)) {
    const compared = compareContract(first, trace, engine);
    const contractDiffs = fileMoves(
      def.name,
      compared,
      divergences,
      def.triggers,
      steps,
    );
    // A loop, not push(...contractDiffs): a case one engine drives far from
    // the reference (an approved quirk that cascades) can yield more
    // differences than a call may take as arguments, and spreading them
    // threw RangeError before `explain` could stop the comparison.
    for (const d of contractDiffs) {
      differences.push(d);
    }
    const contractKeys = new Set(
      compared.map((d) => `${d.at.reference}|${d.at.candidate}|${d.path}`),
    );
    for (const d of compareFull(first, trace, engine)) {
      if (!contractKeys.has(`${d.at.reference}|${d.at.candidate}|${d.path}`)) {
        advisories.push(`incidental: ${describeDifference(d)}`);
      }
    }
    if (contractDiffs.length === 0) {
      const order = interleaving(first, trace);
      if (order) {
        advisories.push(`interleaving on ${engine}: ${order}`);
      }
    }
  }
  const { unexplained, used, ended, covered } = explain(
    def.name,
    differences,
    divergences,
    def.triggers,
    steps,
  );
  // An `ends` stop on v2 before it outworked the reference (its record
  // before v2's clock reached the reference's wait end, `stopsBefore` with
  // `cutAt`): the comparison had already ended, so v2 alone live at the
  // cap is discarded after the stop (Jason, 2026-11-08: "Use 'Discard after the stop' (Recommended)").
  // Otherwise it is a 2.0 bug.
  const discarded: string[] = [];
  const afterStop: { engine: string; id: string; wait: boolean }[] = [];
  if (twoAlone && twoOh) {
    const stop = ended.find((e) => e.engine === twoOh.name);
    if (stop && stopsBefore(stop.at, theirs[twoOh.name] ?? [], twoLive.cutAt)) {
      discarded.push(twoOh.name);
      afterStop.push({ engine: twoOh.name, id: stop.id, wait: true });
      advisories.push(
        `2.0-only live after the stop by ${stop.id}: ${twoOnlyAt}, once that \`ends\` entry had ended the comparison (its record came before ${twoOh.name}'s clock reached the reference's wait end); discarded after the stop, not a 2.0 bug (Jason, 2026-11-08: "Use 'Discard after the stop' (Recommended)")`,
      );
    } else {
      twoOnlyLive = `2.0-only live: ${twoOnlyAt}, ${stop ? `and the stop by ${stop.id} came only after ${twoOh.name} had outworked the reference` : "with no `ends` stop before it"}; a 2.0 bug (Jason, 2026-11-07: "One shared wait (Recommended)")`;
      problems.unshift(
        `${twoOh.name} in scenario "${def.name}": ${twoOnlyLive}`,
      );
    }
  }
  for (const e of ended) {
    advisories.push(
      `ended on ${e.engine} by ${e.id} at ${describeDifference(e.at)}: ${e.dropped} later difference(s) not compared`,
    );
  }
  // An engine under test that passes the budget is a hang, unless an `ends`
  // stop on that same engine came before the runaway started (before it
  // outworked the reference, `stopsBefore`): then the comparison had
  // already ended and the case is discarded (Jason, 2026-11-02: "Discard
  // after the stop"), counted toward the runaway limit.
  for (const [engine, at] of runaways) {
    const stop = ended.find((e) => e.engine === engine);
    if (stop && stopsBefore(stop.at, theirs[engine] ?? [], at)) {
      if (!discarded.includes(engine)) {
        discarded.push(engine);
        afterStop.push({ engine, id: stop.id, wait: false });
      }
      advisories.push(
        `runaway on ${engine} after the stop by ${stop.id}: more than ${limit} timer callbacks once the comparison had ended; discarded, not a hang`,
      );
      continue;
    }
    hung.push(engine);
    problems.push(
      `hang in scenario "${def.name}": ${engine} made more than ${limit} timer callbacks where the reference settled after ${firstRun.fired}`,
    );
  }
  // A drawn delay is incidental to the comparison but must stay in bounds,
  // on the reference and on every engine under test: the same values the
  // comparison masks (the reference's drawn resolvers) are checked.
  const drawn = drawnResolvers(first);
  for (const [engine, trace] of [
    [reference.name, first],
    ...Object.entries(theirs),
  ] as [string, TraceEntry[]][]) {
    for (const problem of drawProblems(trace, drawn)) {
      problems.push(`${engine} in scenario "${def.name}": ${problem}`);
    }
  }

  const report = [
    ...problems,
    formatReport(
      def.name,
      "reference engine is not deterministic",
      nondeterministic,
      first,
      { "v1 (second run)": again },
      "v1",
    ),
    formatReport(def.name, "engines differ", unexplained, first, theirs, "v1"),
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    name: def.name,
    ok:
      hung.length === 0 &&
      problems.length === 0 &&
      nondeterministic.length === 0 &&
      unexplained.length === 0,
    nondeterministic,
    differences,
    unexplained,
    advisories,
    used,
    covered,
    ended,
    compared: Object.keys(theirs),
    traces: {
      reference: first,
      candidate: theirs[candidates[0]?.name ?? ""] ?? [],
    },
    engineTraces: theirs,
    runaway: false,
    hung,
    discarded,
    ...(afterStop.length > 0 ? { afterStop } : {}),
    fired: firstRun.fired,
    drained: firstRun.drained,
    drainedDetached,
    sharedRounds: rounds,
    ...(twoOnlyLive ? { twoOnlyLive } : {}),
    ...(def.settleDrain ? { settleTimes } : {}),
    report,
  };
}

// ---------------------------------------------------------------------------
// Census logs

/**
 * `DIFF_LOG_DIR` (set by the census) collects what the run did that a test
 * cannot assert on its own: which divergences were used, which hooks fired,
 * how many fuzz runs ran.
 */
function logLines(file: string, lines: string[]): void {
  const dir = process.env.DIFF_LOG_DIR;
  if (dir && lines.length > 0) {
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, file), lines.map((l) => `${l}\n`).join(""));
  }
}

/** Record a run's used divergences and fired hooks for the census. */
export function logResult(result: ScenarioResult): void {
  logLines("divergences-used.txt", result.used);
  logLines(
    "excuses-used.txt",
    (result.covered ?? []).flatMap((c) =>
      c.excuse === undefined ? [] : [`${c.id}\t${c.excuse}`],
    ),
  );
  // The fingerprint migration (scripts/fingerprint-divergences.ts) reads
  // every covered difference's payload.
  if (process.env.DIFF_COVERAGE_LOG) {
    if (result.name === FUZZ_SCENARIO) {
      logLines(
        "fuzz-differences.jsonl",
        result.differences.map((d) =>
          JSON.stringify({
            stream: d.stream,
            kind: d.kind,
            engine: d.engine,
            op: d.op,
            path: d.path,
            reference: d.reference,
            candidate: d.candidate,
          }),
        ),
      );
    }
    logLines(
      "covered.jsonl",
      (result.covered ?? []).map((c) =>
        JSON.stringify({
          scenario: result.name,
          id: c.id,
          excuse: excuseFor(c.difference),
        }),
      ),
    );
  }
  logLines("hooks-fired.txt", [
    ...new Set(
      result.traces.reference.flatMap((e) => (e.k === "hook" ? [e.hook] : [])),
    ),
  ]);
}

/** What a fuzz run counts, case by case (diff/fuzz/fuzz.test.ts). */
export interface FuzzTally {
  ran: number;
  /** Discarded cases: the reference's runaways and those in `afterStop`. */
  runaway: number;
  /**
   * Of `runaway`, cases discarded after an `ends` stop
   * (`ScenarioResult.discarded`), not the reference's: an engine under test
   * ran away past the timer budget, or (`afterStopAtWait`) v2 alone was
   * live at the shared wait's cap (Jason, 2026-11-08: "Use 'Discard after the stop' (Recommended)").
   */
  afterStop: number;
  afterStopAtWait: number;
  /** The `ends` entries behind those discards, with how many each. */
  afterStopBy: Record<string, number>;
  /** Compared cases that v2 took part in. */
  onV2: number;
  mostFired: number;
  /** Compared cases an `ends` divergence stopped (on any engine). */
  ended: number;
  /** The sum of the step each ended case stopped at, for the mean. */
  endedSteps: number;
  /** Ended cases that stopped at step 0: nothing after setup was compared. */
  endedAtStep0: number;
  /** Compared cases where the reference's clock advanced in the shared wait. */
  drained: number;
  /** Compared cases where v2's clock advanced in the shared wait. */
  drainedDetached: number;
  /** Compared cases the shared wait needed more than one round for. */
  sharedRerun: number;
  /** Compared cases that failed because only v2 was live at the cap. */
  twoOnlyLive: number;
  /** Of `neverSettles`, cases where v2 was live at the cap too. */
  bothLive: number;
  /**
   * Discarded cases whose reference's batches were live at the shared wait's cap
   * (`ScenarioResult.neverSettles`): not in `runaway`, and capped on their
   * own (maxNeverSettles, max(1% of cases, 3); Jason, 2026-11-07: "Discard, own count (Recommended)").
   */
  neverSettles: number;
}

/** A tally before the first case. */
export function newFuzzTally(): FuzzTally {
  return {
    ran: 0,
    runaway: 0,
    afterStop: 0,
    afterStopAtWait: 0,
    afterStopBy: {},
    onV2: 0,
    mostFired: 0,
    ended: 0,
    endedSteps: 0,
    endedAtStep0: 0,
    drained: 0,
    drainedDetached: 0,
    sharedRerun: 0,
    twoOnlyLive: 0,
    bothLive: 0,
    neverSettles: 0,
  };
}

/**
 * Count one fuzz case. A runaway is discarded: the reference's, or an
 * engine under test's after an `ends` stop (`discarded`; Jason, 2026-11-02:
 * "Discard after the stop"), both counted toward the one runaway limit.
 * Every other case is compared, whether it passed, failed or was ended by
 * an `ends` divergence (`explain`), so an ended case counts toward the
 * floors like any other.
 */
export function tallyCase(tally: FuzzTally, result: ScenarioResult): void {
  tally.ran++;
  if (result.neverSettles) {
    // Discarded, on its own count, never toward the runaway limit.
    tally.neverSettles++;
    if (result.bothLive) {
      tally.bothLive++;
    }

    return;
  }
  if (result.runaway) {
    tally.runaway++;

    return;
  }
  if (result.discarded.length > 0) {
    tally.runaway++;
    tally.afterStop++;
    const first = result.afterStop?.[0];
    if (first?.wait) {
      tally.afterStopAtWait++;
    }
    if (first) {
      tally.afterStopBy[first.id] = (tally.afterStopBy[first.id] ?? 0) + 1;
    }

    return;
  }
  if (result.compared.includes("v2")) {
    tally.onV2++;
  }
  tally.mostFired = Math.max(tally.mostFired, result.fired);
  if ((result.drained ?? 0) > 0) {
    tally.drained++;
  }
  if ((result.drainedDetached ?? 0) > 0) {
    tally.drainedDetached++;
  }
  if ((result.sharedRounds ?? 1) > 1) {
    tally.sharedRerun++;
  }
  if (result.twoOnlyLive) {
    tally.twoOnlyLive++;
  }
  if (result.ended.length > 0) {
    const step = Math.min(...result.ended.map((e) => e.at.step));
    tally.ended++;
    tally.endedSteps += step;
    if (step === 0) {
      tally.endedAtStep0++;
    }
  }
}

/**
 * Record that the fuzzer compared `runs` cases from `seed` (`v2` of them on
 * v2 as well), discarded `runaway` more (cases whose reference run passed
 * the budget, and `runawayAfterStop` of them where an engine under test
 * passed it after an `ends` stop), and how many of the compared cases an `ends` divergence
 * stopped and where (the census prints it, so a too-early stop shows).
 */
export function logFuzz(seed: number, tally: FuzzTally): void {
  logLines("fuzz.jsonl", [
    JSON.stringify({
      seed,
      runs: tally.ran - tally.runaway - tally.neverSettles,
      runaway: tally.runaway,
      runawayAfterStop: tally.afterStop,
      runawayAfterStopAtWait: tally.afterStopAtWait,
      afterStopBy: tally.afterStopBy,
      neverSettles: tally.neverSettles,
      drained: tally.drained,
      drainedDetached: tally.drainedDetached,
      sharedRerun: tally.sharedRerun,
      twoOnlyLive: tally.twoOnlyLive,
      bothLive: tally.bothLive,
      v2: tally.onV2,
      ended: tally.ended,
      endedSteps: tally.endedSteps,
      endedAtStep0: tally.endedAtStep0,
    }),
  ]);
}

/** `DIFF_DUMP=<dir>` writes each scenario's traces there, for reading. */
function dump(name: string, result: ScenarioResult): void {
  const dir = process.env.DIFF_DUMP;
  if (!dir) {
    return;
  }
  mkdirSync(dir, { recursive: true });
  const file = name.replace(/[^\w-]+/g, "-").slice(0, 80);
  for (const [side, trace] of Object.entries(result.traces)) {
    writeFileSync(
      join(dir, `${file}.${side}.jsonl`),
      trace.map((e) => JSON.stringify(e)).join("\n"),
    );
  }
}

// On globalThis, not module state: a dynamically imported scenario file can
// resolve this module as a separate instance.
const COLLECT = Symbol.for("directive.conformance.collect");
const collector = () =>
  (globalThis as Record<symbol, ScenarioDef[] | undefined>)[COLLECT];

/**
 * From now until `stopCollecting()`, `scenario()` records definitions into
 * the returned array instead of registering tests (for the source-fault
 * suite, which runs them against faulted engines). Vitest runs `describe`
 * bodies after the importing module finishes, so stop in a `beforeAll`,
 * once collection is over.
 */
export function startCollecting(): ScenarioDef[] {
  const defs: ScenarioDef[] = [];
  (globalThis as Record<symbol, ScenarioDef[] | undefined>)[COLLECT] = defs;

  return defs;
}

/**
 * `describe` for scenario files. While collecting it runs the body at once
 * and registers no suite (an empty suite fails in vitest).
 */
export function suite(name: string, body: () => void): void {
  if (collector()) {
    body();

    return;
  }
  describe(name, body);
}

export function stopCollecting(): void {
  delete (globalThis as Record<symbol, ScenarioDef[] | undefined>)[COLLECT];
}

/** Register a differential test; its layer comes from layers.rules.json. */
export function scenario(
  name: string,
  build: Build,
  steps: Step[],
  options: { seed?: number; observeDerivations?: boolean } = {},
): void {
  const collecting = collector();
  if (collecting) {
    collecting.push({
      name,
      build,
      steps,
      layer: readLayerRules().scenarios?.[name],
      ...options,
    });

    return;
  }
  it(name, async () => {
    const layer = readLayerRules().scenarios?.[name];
    expect(
      layer,
      `layers.rules.json scenarios has no layer for "${name}"`,
    ).toMatch(/^L\d+$/);
    const result = await runScenario({ name, build, steps, layer, ...options });
    logResult(result);
    dump(name, result);
    if (result.advisories.length > 0) {
      console.info(
        `[diff] advisory for "${name}":\n  ${result.advisories.slice(0, 10).join("\n  ")}`,
      );
    }
    expect(result.ok, result.report).toBe(true);
    // A scenario must record something beyond its own steps.
    expect(
      result.traces.reference.some((e) => e.k === "hook" || e.k === "state"),
    ).toBe(true);
  });
}
