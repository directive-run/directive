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
  drawProblems,
  drawnResolvers,
  interleaving,
  isAfter,
  latestPosition,
} from "./compare.js";
import "./coverage.js";
import { type CoreApi, type EngineHandle, engines } from "./engines.js";
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
}

/**
 * An approved difference. It covers a difference in `scenario` on `stream`
 * with this `kind`; `engine`, `step`, `op` and `path` (a prefix inside the
 * entry) narrow it when given. Keyed by content, never by trace index.
 *
 * `ends: true` (fuzz only, signed; the census rejects it anywhere else)
 * marks an approved quirk whose consequences cascade: the difference it
 * covers ends the comparison of that fuzz case (`explain`).
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
  reason: string;
  approvedBy: string;
  date: string;
}

/** The scenario name every fuzz case runs under (diff/fuzz/model.ts `toScenario`). */
export const FUZZ_SCENARIO = "fuzz";

export type { Difference };

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
  /** Where an `ends` divergence stopped the comparison of a fuzz case. */
  ended: Ended[];
  /** Engines compared against the reference. */
  compared: string[];
  traces: { reference: TraceEntry[]; candidate: TraceEntry[] };
  /**
   * The reference's first run passed the timer-callback budget: the case
   * itself never settles, so nothing is compared (`ok` is false; the fuzzer
   * discards such a case as a runaway and counts it).
   */
  runaway: boolean;
  /**
   * Runs that passed the budget where the reference's first run settled:
   * an engine under test that hangs, or a second reference run that did
   * (nondeterminism). Always a failure.
   */
  hung: string[];
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
 */
function installBudget(limit: number) {
  const g = globalThis as unknown as Record<string, TimerFn>;
  const fakes = COUNTED.map((name) => [name, g[name] as TimerFn] as const);
  const state = { fired: 0, exceeded: false };
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
          if (++state.fired > limit) {
            state.exceeded = true;
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
  if (step.op === "run") {
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

async function apply(
  step: Step,
  system: AnySystem,
  ctx: BuildContext,
  rec: Recorder,
  snapshots: Map<string, unknown>,
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
      await drive(Promise.resolve(system.settle()), rec, "settle");
      rec.checkpoint("settle");
      break;
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
}

/** Run one scenario on one engine under a timer-callback budget. */
export async function runBudgeted(
  engine: EngineHandle,
  def: ScenarioDef,
  limit = def.budget ?? RUN_BUDGET,
): Promise<BudgetedRun> {
  const rec = createRecorder();
  // Everything that makes a run deterministic, and everything that captures
  // what the engine prints, goes in before the engine loads.
  vi.useFakeTimers({ now: 0, toFake: [...FAKED] });
  const budget = installBudget(limit);
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
      };
    }
    const snapshots = new Map<string, unknown>();
    for (const [i, step] of def.steps.entries()) {
      rec.push({ k: "step", i, step: describeStep(step) });
      let pending: Promise<void>;
      try {
        pending = apply(step, system, ctx, rec, snapshots);
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

export function covers(div: Divergence, name: string, d: Difference): boolean {
  return (
    div.scenario === name &&
    div.stream === d.stream &&
    div.kind === d.kind &&
    (div.engine === undefined || div.engine === d.engine) &&
    (div.step === undefined || div.step === d.step) &&
    (div.op === undefined || div.op === d.op) &&
    (div.path === undefined ||
      (d.path !== undefined &&
        (d.path === div.path ||
          d.path.startsWith(`${div.path}.`) ||
          d.path.startsWith(`${div.path}[`))))
  );
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
 * is covered by the first entry that covers it, in file order: covered, it
 * passes and the entry is used; uncovered, it is reported.
 *
 * A fuzz case on one engine also stops at its first difference whose
 * covering entry has `ends: true` (the earliest by `latestPosition`): that
 * difference passes, and a difference strictly after it in every trace it
 * is in (`isAfter`, diff/compare.ts) is not compared. Within one trace that
 * is the trace order; across the two traces only a matched record between
 * them orders two records, so a difference in the same gap as the stop, in
 * the other trace, is still matched as usual (and an uncovered one still
 * fails), as is one before it. Each engine is walked on its own, and a hand
 * scenario never stops: there `ends` is just an entry.
 */
export function explain(
  name: string,
  differences: Difference[],
  divergences: Divergence[],
): { unexplained: Difference[]; used: string[]; ended: Ended[] } {
  const coverOf = (d: Difference) =>
    divergences.find((x) => covers(x, name, d));
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
  const dropped = new Map<string, number>();
  const unexplained = differences.filter((d) => {
    const cut = cuts.get(d.engine);
    if (cut && isAfter(d, cut.at)) {
      dropped.set(d.engine, (dropped.get(d.engine) ?? 0) + 1);

      return false;
    }
    const div = coverOf(d);
    if (div) {
      used.add(div.id);

      return false;
    }

    return true;
  });

  return {
    unexplained,
    used: [...used],
    ended: [...cuts].map(([engine, { at, id }]) => ({
      engine,
      id,
      at,
      dropped: dropped.get(engine) ?? 0,
    })),
  };
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
  const firstRun = await runBudgeted(reference, def, limit);
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
      fired: firstRun.fired,
      report: `runaway in scenario "${def.name}": the reference (${reference.name}) made more than ${limit} timer callbacks, so the case never settles and is not compared`,
    };
  }
  const againRun = await runBudgeted(reference, def, limit);
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
  for (const engine of candidates) {
    const run = await runBudgeted(engine, def, limit);
    theirs[engine.name] = run.trace;
    if (run.runaway) {
      hung.push(engine.name);
      problems.push(
        `hang in scenario "${def.name}": ${engine.name} made more than ${limit} timer callbacks where the reference settled after ${firstRun.fired}`,
      );
    }
  }

  const nondeterministic = compareFull(first, again, "v1 (second run)");
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
  const differences: Difference[] = [];
  const advisories: string[] = [];
  for (const [engine, trace] of Object.entries(theirs)) {
    const contractDiffs = compareContract(first, trace, engine);
    differences.push(...contractDiffs);
    const contractKeys = new Set(
      contractDiffs.map((d) => `${d.at.reference}|${d.at.candidate}|${d.path}`),
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
  const { unexplained, used, ended } = explain(
    def.name,
    differences,
    divergences,
  );
  for (const e of ended) {
    advisories.push(
      `ended on ${e.engine} by ${e.id} at ${describeDifference(e.at)}: ${e.dropped} later difference(s) not compared`,
    );
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
    ended,
    compared: Object.keys(theirs),
    traces: {
      reference: first,
      candidate: theirs[candidates[0]?.name ?? ""] ?? [],
    },
    runaway: false,
    hung,
    fired: firstRun.fired,
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
  logLines("hooks-fired.txt", [
    ...new Set(
      result.traces.reference.flatMap((e) => (e.k === "hook" ? [e.hook] : [])),
    ),
  ]);
}

/** What a fuzz run counts, case by case (diff/fuzz/fuzz.test.ts). */
export interface FuzzTally {
  ran: number;
  runaway: number;
  /** Compared cases that v2 took part in. */
  onV2: number;
  mostFired: number;
  /** Compared cases an `ends` divergence stopped (on any engine). */
  ended: number;
  /** The sum of the step each ended case stopped at, for the mean. */
  endedSteps: number;
  /** Ended cases that stopped at step 0: nothing after setup was compared. */
  endedAtStep0: number;
}

/** A tally before the first case. */
export function newFuzzTally(): FuzzTally {
  return {
    ran: 0,
    runaway: 0,
    onV2: 0,
    mostFired: 0,
    ended: 0,
    endedSteps: 0,
    endedAtStep0: 0,
  };
}

/**
 * Count one fuzz case. A runaway is discarded; every other case is
 * compared, whether it passed, failed or was ended by an `ends` divergence
 * (`explain`), so an ended case counts toward the floors like any other.
 */
export function tallyCase(tally: FuzzTally, result: ScenarioResult): void {
  tally.ran++;
  if (result.runaway) {
    tally.runaway++;

    return;
  }
  if (result.compared.includes("v2")) {
    tally.onV2++;
  }
  tally.mostFired = Math.max(tally.mostFired, result.fired);
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
 * the budget), and how many of the compared cases an `ends` divergence
 * stopped and where (the census prints it, so a too-early stop shows).
 */
export function logFuzz(seed: number, tally: FuzzTally): void {
  logLines("fuzz.jsonl", [
    JSON.stringify({
      seed,
      runs: tally.ran - tally.runaway,
      runaway: tally.runaway,
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
