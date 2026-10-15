/**
 * A differential scenario: the same definitions and the same steps, run on
 * both engines, must produce the same trace.
 *
 * `scenario(name, build, steps)` registers a test. It runs the reference
 * engine twice and the engine under test once:
 *
 * - reference vs reference proves the scenario and the recorder are
 *   deterministic. A difference here is never approvable: it means the trace
 *   holds something that is not behaviour (fix the recorder or the scenario)
 *   or the reference engine is itself nondeterministic (report it).
 * - reference vs engine under test is the comparison. Each difference must
 *   be covered by an entry in `divergences.json`, which only Jason approves.
 *
 * Determinism is injected, not stripped: every run starts with fake timers
 * at time 0 (`Date`, `performance` and all timers), and `Math.random`
 * replaced by a generator seeded per scenario. Microtasks stay real, so the
 * engine's own scheduling is what is being compared.
 */

import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
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
}

export interface Divergence {
  id: string;
  scenario: string;
  path: string;
  reason: string;
  approvedBy: string;
  date: string;
}

export interface Difference {
  path: string;
  reference: Json | undefined;
  candidate: Json | undefined;
}

export interface ScenarioResult {
  name: string;
  ok: boolean;
  /** Reference run twice differed: the scenario or recorder is not deterministic. */
  nondeterministic: Difference[];
  /** Reference vs candidate differences, all of them. */
  differences: Difference[];
  /** Differences no divergence covers. */
  unexplained: Difference[];
  /** Divergence ids that covered at least one difference. */
  used: string[];
  traces: { reference: TraceEntry[]; candidate: TraceEntry[] };
  report: string;
}

/** A test-only hook: transform an engine before it runs (tamper tests). */
export type EngineWrap = (engine: EngineHandle) => EngineHandle;

export interface RunOptions {
  /** Replace the engine under test (tamper tests inject faults here). */
  wrapCandidate?: EngineWrap;
  divergences?: Divergence[];
}

// ---------------------------------------------------------------------------

export function readDivergences(): Divergence[] {
  return JSON.parse(
    readFileSync(join(here, "divergences.json"), "utf8"),
  ) as Divergence[];
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

const CONSOLE_LEVELS = ["log", "info", "warn", "error", "debug"] as const;

/** Let queued microtasks run (the engine schedules with queueMicrotask). */
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
      await flushMicrotasks();
      if (!done) {
        rec.push({ k: "threw", where, error: "stalled: no timers left" });
      }
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
  switch (step.op) {
    case "dispatch":
      system.dispatch(step.event);
      break;
    case "set":
      setPath(system, step.key, step.value);
      break;
    case "batch":
      system.batch(() => {
        for (const [key, value] of step.writes) {
          setPath(system, key, value);
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
  const core = await engine.load();
  const rec = createRecorder();
  const ctx: BuildContext = {
    core,
    handles: {},
    external: (data) => rec.external(data),
  };
  vi.useFakeTimers({ now: 0, toFake: [...FAKED] });
  const random = vi
    .spyOn(Math, "random")
    .mockImplementation(seededRandom(def.seed ?? seedOf(def.name)));
  // Dev warnings are observable behaviour: record them instead of printing.
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
    try {
      const config = def.build(ctx);
      const plugins = (config.plugins as unknown[] | undefined) ?? [];
      system = core.createSystem({
        ...config,
        plugins: [...plugins, rec.plugin],
      } as never);
      record(system, { recorder: rec });
    } catch (error) {
      rec.push({ k: "threw", where: "createSystem", error: normalize(error) });

      return rec.trace;
    }
    const snapshots = new Map<string, unknown>();
    for (const [i, step] of def.steps.entries()) {
      rec.push({ k: "step", i, step: describeStep(step) });
      try {
        await apply(step, system, ctx, rec, snapshots);
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
      try {
        // Stop timers and resolvers so nothing leaks into the next run.
        await drive(Promise.resolve(system.destroy()), rec, "teardown");
      } catch {
        // Recorded by drive().
      }
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
    vi.clearAllTimers();
    vi.useRealTimers();
  }

  return rec.trace;
}

// ---------------------------------------------------------------------------
// Comparison

function diffJson(
  a: Json | undefined,
  b: Json | undefined,
  path: string,
  out: Difference[],
): void {
  if (a === b) {
    return;
  }
  const isObj = (v: unknown): v is Record<string, Json> | Json[] =>
    typeof v === "object" && v !== null;
  if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) {
    out.push({ path, reference: a, candidate: b });

    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      diffJson(a[i], b[i], `${path}[${i}]`, out);
    }

    return;
  }
  const ao = a as Record<string, Json>;
  const bo = b as Record<string, Json>;
  for (const key of [
    ...new Set([...Object.keys(ao), ...Object.keys(bo)]),
  ].sort()) {
    diffJson(ao[key], bo[key], `${path}.${key}`, out);
  }
}

export function compareTraces(
  reference: TraceEntry[],
  candidate: TraceEntry[],
): Difference[] {
  const out: Difference[] = [];
  diffJson(
    reference as unknown as Json,
    candidate as unknown as Json,
    "trace",
    out,
  );

  return out;
}

function entryIndex(path: string): number {
  const m = path.match(/^trace\[(\d+)\]/);

  return m ? Number(m[1]) : -1;
}

function short(entry: TraceEntry | undefined): string {
  if (!entry) {
    return "(end of trace)";
  }
  const text = JSON.stringify(entry);

  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

/** A readable report: the first divergent entry with context on each side. */
export function formatReport(
  name: string,
  title: string,
  differences: Difference[],
  reference: TraceEntry[],
  candidate: TraceEntry[],
  labels: [string, string],
): string {
  if (differences.length === 0) {
    return "";
  }
  const first = differences[0] as Difference;
  const at = entryIndex(first.path);
  const lines = [
    `${title} in scenario "${name}": ${differences.length} difference(s)`,
    `first at ${first.path}`,
    `  ${labels[0]}: ${JSON.stringify(first.reference)}`,
    `  ${labels[1]}: ${JSON.stringify(first.candidate)}`,
    "",
    "context:",
  ];
  for (let i = Math.max(0, at - 3); i <= at + 1; i++) {
    const r = reference[i];
    const c = candidate[i];
    const mark = i === at ? ">" : " ";
    if (short(r) === short(c)) {
      lines.push(`${mark} [${i}] ${short(r)}`);
    } else {
      lines.push(`${mark} [${i}] ${labels[0]}: ${short(r)}`);
      lines.push(`${mark} [${i}] ${labels[1]}: ${short(c)}`);
    }
  }
  if (differences.length > 1) {
    lines.push("", "other differing paths:");
    for (const d of differences.slice(1, 11)) {
      lines.push(`  ${d.path}`);
    }
    if (differences.length > 11) {
      lines.push(`  … ${differences.length - 11} more`);
    }
  }

  return lines.join("\n");
}

function covers(div: Divergence, name: string, path: string): boolean {
  return (
    div.scenario === name &&
    (path === div.path ||
      path.startsWith(`${div.path}.`) ||
      path.startsWith(`${div.path}[`))
  );
}

export async function runScenario(
  def: ScenarioDef,
  opts: RunOptions = {},
): Promise<ScenarioResult> {
  const [reference, local] = engines();
  const candidate = opts.wrapCandidate ? opts.wrapCandidate(local) : local;
  const divergences = opts.divergences ?? readDivergences();

  const first = await runOn(reference, def);
  const again = await runOn(reference, def);
  const theirs = await runOn(candidate, def);

  const nondeterministic = compareTraces(first, again);
  const differences = compareTraces(first, theirs);
  const used = new Set<string>();
  const unexplained = differences.filter((d) => {
    const div = divergences.find((x) => covers(x, def.name, d.path));
    if (div) {
      used.add(div.id);

      return false;
    }

    return true;
  });

  const report = [
    formatReport(
      def.name,
      "reference engine is not deterministic",
      nondeterministic,
      first,
      again,
      ["run 1", "run 2"],
    ),
    formatReport(def.name, "engines differ", unexplained, first, theirs, [
      reference.name,
      candidate.name,
    ]),
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    name: def.name,
    ok: nondeterministic.length === 0 && unexplained.length === 0,
    nondeterministic,
    differences,
    unexplained,
    used: [...used],
    traces: { reference: first, candidate: theirs },
    report,
  };
}

/** Where the census collects which divergences were used (one id per line). */
function logUsed(ids: string[]): void {
  const file = process.env.DIFF_DIVERGENCE_LOG;
  if (file && ids.length > 0) {
    appendFileSync(file, ids.map((id) => `${id}\n`).join(""));
  }
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

/** Register a differential test. */
export function scenario(
  name: string,
  build: Build,
  steps: Step[],
  options: { seed?: number } = {},
): void {
  it(name, async () => {
    const result = await runScenario({ name, build, steps, ...options });
    logUsed(result.used);
    dump(name, result);
    expect(result.ok, result.report).toBe(true);
    // A scenario must record something beyond its own steps.
    expect(
      result.traces.reference.some((e) => e.k === "hook" || e.k === "state"),
    ).toBe(true);
  });
}

export { logUsed };
