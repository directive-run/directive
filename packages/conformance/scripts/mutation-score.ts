/**
 * Per-file mutation score with a gate that ignores message text.
 *
 *   tsx scripts/mutation-score.ts [--files a.ts,b.ts] [--check] [--layer Ln|row]
 *     [--full <report.json | dir>] <report.json | dir>...
 *
 * gate score = killed (+timeout) / all non-ignored mutants. A file PASSES
 * when its gate score is >= 80% AND every remaining non-ignored Survived or
 * NoCoverage mutant is listed in mutation-triage/<basename>.json (matched by
 * line + col + mutator + replacement). `--check` exits 1 if a selected file FAILs.
 *
 * `--check` is the per-layer gate only on reports from a run with that
 * layer's ceiling (`MUTATION_LAYER=Ln`, MUTATION.md): there every kill comes
 * from a test that runs on v2 at Ln. A report from a run without the ceiling
 * also counts kills by tests placed higher, which v2 does not run yet, and
 * overstates the gate. The report does not record the ceiling, so the caller
 * (the nightly workflow, or the commands in MUTATION.md) must set it.
 *
 * Deferral (`--full`): a planted bug counts at the lowest layer whose tests
 * reach it. In a ceiling run a NoCoverage mutant is reached by no test
 * placed at or below the ceiling. Given the full (no-ceiling) report for the
 * same files, such a mutant is DEFERRED — left out of the denominator and
 * shown in its own column — when the full run reaches it (any status but
 * NoCoverage). When the full run has it NoCoverage too, or does not have it,
 * or has a different source for the file, nothing reaches it at all and it
 * counts. Without `--full`, NoCoverage counts (conservative). Survived
 * mutants are reached by a test at or below the ceiling and always count.
 *
 * `later-layer` triage (`layer: "Lk"`): code for a later layer's feature
 * that lower-layer tests merely execute. With `--layer` (the run's ceiling;
 * `row` = each file's MUTATION.md row, what the nightly shards use) below
 * Lk, such a mutant is deferred even if Survived; at or above Lk, or with no
 * `--layer`, it counts as if untriaged. `layer` must be L0..L13 and above
 * the file's MUTATION.md row, or the triage file is rejected.
 *
 * Validation (`--full`): a `later-layer` entry claims a later test kills the
 * mutant. With a full report, that claim is checked: the mutant must be
 * Killed or Timeout in the full run. If not (Survived, NoCoverage, absent, or
 * the full report is stale or lacks the file), the entry is INVALID: it counts
 * as untriaged (it is not deferred, not even by the full-run rule), so it is
 * an unexplained survivor and fails the gate, and it is listed under
 * "later-layer without a full-run kill". If the full report records `killedBy`
 * and `testFiles` (Stryker JSON), the entry's note must also name one of the
 * killing tests (its name or file basename); if not, it is listed as a
 * warning only. Without `--full` later-layer entries are unvalidated.
 */

import {
  appendFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const GATE = 80;

export interface Mutant {
  id?: string;
  /** Stryker: ids of the tests that killed it (keys of the report's test index). */
  killedBy?: string[];
  mutatorName: string;
  replacement?: string;
  status: string;
  location: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
}

export interface TestRef {
  name: string;
  /** The test file's path in the report's `testFiles`. */
  file: string;
}

export interface ReportFile {
  source?: string;
  mutants: Mutant[];
  /** Test id -> test, from the report's `testFiles`; set by `loadFiles`. */
  tests?: Record<string, TestRef>;
}

export interface Report {
  files: Record<string, ReportFile>;
  testFiles?: Record<string, { tests?: { id: string; name: string }[] }>;
}

export interface TriageEntry {
  line: number;
  col: number;
  mutator: string;
  replacement: string;
  reason:
    | "equivalent"
    | "internals-only"
    | "dev-only"
    | "not-observable"
    | "perf-only"
    | "v1-bug"
    | "later-layer";
  /** `later-layer` only: the layer whose feature the code belongs to. */
  layer?: string;
  note?: string;
}

export interface DeferredMutant {
  mutant: Mutant;
  /** "full-run": NoCoverage here, reached in the full run. "later-layer": triaged to a later layer. */
  why: "full-run" | "later-layer";
  layer?: string;
}

/** A `later-layer` entry whose mutant the full run does not kill. */
export interface InvalidLaterLayer {
  mutant: Mutant;
  layer: string;
  /** The mutant's status in the full run, or why it cannot be looked up. */
  fullStatus: string;
}

/** A valid `later-layer` entry whose note names none of the killing tests. */
export interface UnnamedKiller {
  mutant: Mutant;
  layer: string;
  /** The full run's killing tests, as `name [file basename]`. */
  killers: string[];
}

export interface FileScore {
  file: string;
  killed: number;
  survived: number;
  noCoverage: number;
  ignored: number;
  triaged: number;
  excluded: number;
  /** NoCoverage here but reached in the full run: scored at a higher layer. */
  deferred: number;
  /** The deferred mutants, for the reviewer's spot-check. */
  deferredMutants: DeferredMutant[];
  /** A full report was given but its source for this file differs. */
  fullStale: boolean;
  /** `later-layer` entries not killed in the full run: counted as untriaged. */
  invalidLaterLayer: InvalidLaterLayer[];
  /** Warnings: the note names none of the full run's killing tests. */
  unnamedKillers: UnnamedKiller[];
  rawScore: number;
  gateScore: number;
  unexplained: Mutant[];
  /**
   * Triage entries whose key matches no mutant of this file's report. The
   * keys are line + col, so a 1.35 edit that shifts lines orphans them, and a
   * shifted entry could land on a different mutant: the file fails until they
   * are re-keyed or removed.
   */
  orphanTriage: TriageEntry[];
  pass: boolean;
}

/**
 * Triage reasons that leave the score: no test can kill an equivalent mutant,
 * and code only `/internals` reaches is not part of what 2.0 must reproduce.
 * Every other reason stays in the denominator.
 */
const EXCLUDED = new Set<TriageEntry["reason"]>([
  "equivalent",
  "internals-only",
]);

const MESSAGE_LINE =
  /\b(Error|TypeError|RangeError)\(|console\.|warn\(|devWarn|message\s*:/;

function offsetOf(source: string, line: number, column: number): number {
  let off = 0;
  for (let i = 1; i < line; i++) {
    const nl = source.indexOf("\n", off);
    if (nl === -1) {
      return source.length;
    }
    off = nl + 1;
  }

  // Stryker locations are 1-based for both line and column.
  return off + column - 1;
}

/** True when the mutant only changes message text, not behaviour. */
export function isMessageText(m: Mutant, source: string | undefined): boolean {
  if (m.mutatorName !== "StringLiteral" || source === undefined) {
    return false;
  }
  const lines = source.split("\n");
  const line = lines[m.location.start.line - 1] ?? "";
  if (MESSAGE_LINE.test(line)) {
    return true;
  }
  const original = source.slice(
    offsetOf(source, m.location.start.line, m.location.start.column),
    offsetOf(source, m.location.end.line, m.location.end.column),
  );

  return original.includes(" ");
}

function key(line: number, col: number, mutator: string, repl: string): string {
  return `${line}:${col}:${mutator}:${repl}`;
}

const mutantKey = (m: Mutant): string =>
  key(
    m.location.start.line,
    m.location.start.column,
    m.mutatorName,
    m.replacement ?? "",
  );

/**
 * Score one file. `full` is the same file from a full (no-ceiling) run;
 * with it, NoCoverage mutants the full run reaches are deferred.
 */
const LAYER = /^L(?:[0-9]|1[0-3])$/;
const layerNum = (layer: string): number => Number(layer.slice(1));

/**
 * Reject `later-layer` entries without a valid `layer`, or whose layer is
 * not above the file's MUTATION.md row (`rowLayer`): that is a mislabel.
 */
export function validateTriage(
  file: string,
  triage: TriageEntry[],
  rowLayer: number | undefined,
): void {
  for (const t of triage) {
    if (t.reason !== "later-layer") {
      continue;
    }
    const at = `${basename(file)} ${t.line}:${t.col} ${t.mutator}`;
    if (typeof t.layer !== "string" || !LAYER.test(t.layer)) {
      throw new Error(
        `triage ${at}: later-layer needs layer L0..L13, got ${JSON.stringify(t.layer)}`,
      );
    }
    if (typeof t.note !== "string" || t.note.trim() === "") {
      throw new Error(
        `triage ${at}: later-layer needs a note naming the later feature and the test that kills it in the full run`,
      );
    }
    if (rowLayer === undefined) {
      throw new Error(
        `triage ${at}: later-layer, but ${basename(file)} has no row in MUTATION.md`,
      );
    }
    if (layerNum(t.layer) <= rowLayer) {
      throw new Error(
        `triage ${at}: later-layer ${t.layer} is not above the file's layer L${rowLayer} (MUTATION.md): mislabelled`,
      );
    }
  }
}

/**
 * Each file's layer from the MUTATION.md table (the row's highest layer:
 * "L0-L1" is L1), by basename.
 */
export function rowLayers(markdown: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of markdown.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    const layers = (cells[1] ?? "").match(/\bL\d+\b/g);
    if (!layers || !/\.ts\b/.test(cells[2] ?? "")) {
      continue;
    }
    const n = Math.max(...layers.map(layerNum));
    for (const f of (cells[2] ?? "").split(",")) {
      out.set(f.trim(), n);
    }
  }

  return out;
}

const isDetected = (m: Mutant): boolean =>
  m.status === "Killed" || m.status === "Timeout";

const normalize = (s: string): string => s.toLowerCase().replace(/\s+/g, " ");

/** The full run's killing tests of these mutants, as `{ name, base }`. */
function killersOf(
  mutants: Mutant[],
  tests: Record<string, TestRef> | undefined,
): { name: string; base: string }[] {
  const out = new Map<string, { name: string; base: string }>();
  for (const m of mutants) {
    for (const id of m.killedBy ?? []) {
      const t = tests?.[id];
      if (t) {
        out.set(id, { name: t.name, base: basename(t.file) });
      }
    }
  }

  return [...out.values()];
}

export function scoreFile(
  file: string,
  data: ReportFile,
  triage: TriageEntry[],
  full?: ReportFile,
  /** The run's layer ceiling (number), for `later-layer` triage. */
  ceiling?: number,
  /**
   * Validate `later-layer` entries against the full run. True whenever a full
   * report was asked for, even if this file is missing from it.
   */
  validateLater: boolean = full !== undefined,
): FileScore {
  const triaged = new Map(
    triage.map((t) => [key(t.line, t.col, t.mutator, t.replacement), t]),
  );
  // A full report of different source has different mutants at the same
  // positions: it cannot vouch for anything, so nothing is deferred.
  // A report that lacks `source` cannot be checked, so it is stale too.
  const fullStale =
    full !== undefined &&
    (full.source === undefined ||
      data.source === undefined ||
      full.source !== data.source);
  const reachedInFull = new Set(
    full && !fullStale
      ? full.mutants
          .filter((m) => m.status !== "NoCoverage")
          .map((m) => mutantKey(m))
      : [],
  );
  const fullByKey = new Map<string, Mutant[]>();
  if (full && !fullStale) {
    for (const m of full.mutants) {
      const list = fullByKey.get(mutantKey(m)) ?? [];
      list.push(m);
      fullByKey.set(mutantKey(m), list);
    }
  }
  const invalidLaterLayer: InvalidLaterLayer[] = [];
  const unnamedKillers: UnnamedKiller[] = [];
  let deferred = 0;
  const deferredMutants: DeferredMutant[] = [];
  let killed = 0;
  let survived = 0;
  let noCoverage = 0;
  let ignored = 0;
  let triagedCount = 0;
  let excluded = 0;
  let raw = 0;
  let rawKilled = 0;
  const unexplained: Mutant[] = [];
  for (const m of data.mutants) {
    const detected = m.status === "Killed" || m.status === "Timeout";
    const missed = m.status === "Survived" || m.status === "NoCoverage";
    if (!detected && !missed) {
      continue;
    }
    raw++;
    if (detected) {
      rawKilled++;
    }
    if (isMessageText(m, data.source)) {
      ignored++;
      continue;
    }
    if (detected) {
      killed++;
      continue;
    }
    const k = mutantKey(m);
    const entry = triaged.get(k);
    let reason = entry?.reason;
    if (reason !== undefined && EXCLUDED.has(reason)) {
      triagedCount++;
      excluded++;
      continue;
    }
    let invalidLater = false;
    if (reason === "later-layer" && validateLater) {
      const layerOfEntry = entry!.layer ?? "L0";
      const inFull = fullByKey.get(k) ?? [];
      const killers = inFull.filter(isDetected);
      if (killers.length === 0) {
        // The claim "a later test kills it" is false: untriaged, undeferred.
        invalidLater = true;
        reason = undefined;
        invalidLaterLayer.push({
          mutant: m,
          layer: layerOfEntry,
          fullStatus: fullStale
            ? "stale full report"
            : (inFull[0]?.status ?? "not in the full report"),
        });
      } else {
        const named = killersOf(killers, full?.tests);
        const note = normalize(entry!.note ?? "");
        if (
          named.length > 0 &&
          !named.some(
            (t) =>
              note.includes(normalize(t.name)) ||
              note.includes(normalize(t.base)),
          )
        ) {
          unnamedKillers.push({
            mutant: m,
            layer: layerOfEntry,
            killers: named.map((t) => `${t.name} [${t.base}]`),
          });
        }
      }
    }
    if (reason === "later-layer") {
      // Below its layer: a later feature's code, deferred to that layer.
      if (ceiling !== undefined && ceiling < layerNum(entry!.layer ?? "L0")) {
        triagedCount++;
        deferred++;
        deferredMutants.push({
          mutant: m,
          why: "later-layer",
          layer: entry!.layer,
        });
        continue;
      }
      // At or above it (or ceiling unknown): it counts, as if untriaged.
      reason = undefined;
    }
    if (!invalidLater && m.status === "NoCoverage" && reachedInFull.has(k)) {
      deferred++;
      deferredMutants.push({ mutant: m, why: "full-run" });
      continue;
    }
    if (m.status === "Survived") {
      survived++;
    } else {
      noCoverage++;
    }
    if (reason !== undefined) {
      triagedCount++;
    } else {
      unexplained.push(m);
    }
  }
  const denom = killed + survived + noCoverage;
  const gateScore = denom ? (100 * killed) / denom : 100;
  const present = new Set(data.mutants.map(mutantKey));
  const orphanTriage = triage.filter(
    (t) => !present.has(key(t.line, t.col, t.mutator, t.replacement)),
  );

  return {
    file,
    killed,
    survived,
    noCoverage,
    ignored,
    triaged: triagedCount,
    excluded,
    deferred,
    deferredMutants,
    fullStale,
    invalidLaterLayer,
    unnamedKillers,
    rawScore: raw ? (100 * rawKilled) / raw : 100,
    gateScore,
    unexplained,
    orphanTriage,
    // A file whose every counted mutant was excluded or deferred has
    // proved nothing at this layer.
    pass:
      gateScore >= GATE &&
      unexplained.length === 0 &&
      orphanTriage.length === 0 &&
      !(denom === 0 && excluded + deferred > 0),
  };
}

function loadTriage(dir: string, file: string): TriageEntry[] {
  const p = join(dir, `${basename(file, ".ts")}.json`);
  if (!existsSync(p)) {
    return [];
  }

  return JSON.parse(readFileSync(p, "utf8")) as TriageEntry[];
}

function collect(paths: string[]): string[] {
  const out: string[] = [];
  const walk = (p: string): void => {
    if (statSync(p).isDirectory()) {
      for (const n of readdirSync(p).sort()) {
        walk(join(p, n));
      }
    } else if (p.endsWith(".json")) {
      out.push(p);
    }
  };
  for (const p of paths) {
    walk(p);
  }

  return out;
}

/** Test id -> test, from a report's `testFiles` (Stryker JSON schema). */
export function testIndex(r: Report): Record<string, TestRef> {
  const out: Record<string, TestRef> = {};
  for (const [path, tf] of Object.entries(r.testFiles ?? {})) {
    for (const t of tf.tests ?? []) {
      out[t.id] = { name: t.name, file: path };
    }
  }

  return out;
}

/** Every file in the reports, by its report path (a later report wins). */
export function loadFiles(reportPaths: string[]): Map<string, ReportFile> {
  const files = new Map<string, ReportFile>();
  for (const rp of reportPaths) {
    const r = JSON.parse(readFileSync(rp, "utf8")) as Report;
    const tests = testIndex(r);
    for (const [file, data] of Object.entries(r.files ?? {})) {
      files.set(file, { ...data, tests });
    }
  }

  return files;
}

export function scoreReports(
  reportPaths: string[],
  triageDir: string,
  only?: string[],
  full?: Map<string, ReportFile>,
  /** Each file's MUTATION.md row layer, by basename. */
  rows: Map<string, number> = new Map(),
  /** The ceiling: a layer number, "row" (each file's row), or none. */
  layer?: number | "row",
): FileScore[] {
  const out: FileScore[] = [];
  for (const rp of reportPaths) {
    const r = JSON.parse(readFileSync(rp, "utf8")) as Report;
    for (const [file, data] of Object.entries(r.files ?? {})) {
      if (only && !only.includes(basename(file))) {
        continue;
      }
      const rowLayer = rows.get(basename(file));
      const triage = loadTriage(triageDir, file);
      validateTriage(file, triage, rowLayer);
      out.push(
        scoreFile(
          file,
          data,
          triage,
          full?.get(file),
          layer === "row" ? rowLayer : layer,
          full !== undefined,
        ),
      );
    }
  }

  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * `deferred` counts NoCoverage the full report reaches and `later-layer`
 * triage below its layer; "stale" when the full report's source differs.
 */
export function formatTable(rows: FileScore[]): string {
  const pct = (n: number): string => `${n.toFixed(1)}%`;
  const lines = [
    "| file | killed | survived | noCoverage | deferred | ignored (msg) | triaged | excluded | raw | gate | result |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const r of rows) {
    const deferred = r.fullStale ? `${r.deferred} (stale)` : String(r.deferred);
    lines.push(
      `| ${basename(r.file)} | ${r.killed} | ${r.survived} | ${r.noCoverage} | ${deferred} | ${r.ignored} | ${r.triaged} | ${r.excluded} | ${pct(r.rawScore)} | ${pct(r.gateScore)} | ${r.pass ? "PASS" : "FAIL"} |`,
    );
  }

  return lines.join("\n");
}

/** Each deferred mutant as `file:line:col mutator`, grouped under a collapsible block. */
export function formatDeferred(rows: FileScore[]): string {
  const lines: string[] = [];
  for (const r of rows) {
    for (const d of r.deferredMutants) {
      const { line, column } = d.mutant.location.start;
      lines.push(
        `${basename(r.file)}:${line}:${column} ${d.mutant.mutatorName} (${d.why === "later-layer" ? `later-layer ${d.layer}` : "reached in full run"})`,
      );
    }
  }
  if (lines.length === 0) {
    return "";
  }

  return [
    `<details><summary>Deferred mutants (${lines.length}): spot-check that each line belongs to a later layer</summary>`,
    "",
    "```",
    ...lines,
    "```",
    "",
    "</details>",
  ].join("\n");
}

const where = (file: string, m: Mutant): string =>
  `${basename(file)}:${m.location.start.line}:${m.location.start.column} ${m.mutatorName}`;

/** Survivors and NoCoverage mutants with no kill, no deferral and no triage. */
export function formatUnexplained(rows: FileScore[]): string {
  const lines = rows.flatMap((r) =>
    r.unexplained.map(
      (m) => `${where(r.file, m)} -> ${m.replacement ?? ""} (${m.status})`,
    ),
  );
  if (lines.length === 0) {
    return "";
  }

  return [
    `Unexplained (${lines.length}): kill each with a test or triage it.`,
    "```",
    ...lines,
    "```",
  ].join("\n");
}

/** Triage entries that match no mutant in the report: stale keys. */
export function formatOrphanTriage(rows: FileScore[]): string {
  const lines = rows.flatMap((r) =>
    r.orphanTriage.map(
      (t) =>
        `${basename(r.file)}:${t.line}:${t.col} ${t.mutator} -> ${t.replacement} (${t.reason})`,
    ),
  );
  if (lines.length === 0) {
    return "";
  }

  return [
    `Triage matching no mutant (${lines.length}): FAIL. The source moved under these keys (line:col), or the mutant is gone. Re-key each to the mutant it describes, or delete it.`,
    "```",
    ...lines,
    "```",
  ].join("\n");
}

/** `later-layer` entries the full run does not kill: they count as untriaged. */
export function formatInvalidLaterLayer(rows: FileScore[]): string {
  const lines = rows.flatMap((r) =>
    r.invalidLaterLayer.map(
      (i) =>
        `${where(r.file, i.mutant)} (later-layer ${i.layer}; full run: ${i.fullStatus})`,
    ),
  );
  if (lines.length === 0) {
    return "";
  }

  return [
    `later-layer without a full-run kill (${lines.length}): INVALID, counted as untriaged. No test kills these in the full run, so deferring them hides untested code. Kill the mutant, or triage it with another reason.`,
    "```",
    ...lines,
    "```",
  ].join("\n");
}

/** Warnings: valid `later-layer` entries whose note names none of the killing tests. */
export function formatUnnamedKillers(rows: FileScore[]): string {
  const lines = rows.flatMap((r) =>
    r.unnamedKillers.map((u) => {
      const shown = u.killers.slice(0, 3).join("; ");
      const more =
        u.killers.length > 3 ? `; +${u.killers.length - 3} more` : "";

      return `${where(r.file, u.mutant)} (later-layer ${u.layer}): killed by ${shown}${more}`;
    }),
  );
  if (lines.length === 0) {
    return "";
  }

  return [
    `WARNING: later-layer note does not name a killing test (${lines.length}). Not a failure; name the test so a reviewer can find it.`,
    "```",
    ...lines,
    "```",
  ].join("\n");
}

export interface RunResult {
  code: number;
  out: string;
  err: string[];
}

/** The CLI, without process side effects: `root` holds MUTATION.md, mutation-triage/ and reports/. */
export function run(args: string[], root: string): RunResult {
  const err: string[] = [];
  const fail = (m: string): RunResult => ({ code: 1, out: "", err: [m] });
  let check = false;
  let only: string[] | undefined;
  const fullPaths: string[] = [];
  let layer: number | "row" | undefined;
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--check") {
      check = true;
    } else if (a === "--files") {
      only = (args[++i] ?? "").split(",").filter(Boolean);
    } else if (a === "--layer") {
      const v = args[++i] ?? "";
      if (v !== "row" && !LAYER.test(v)) {
        return fail(
          `mutation-score: --layer must be L0..L13 or row, got "${v}"`,
        );
      }
      layer = v === "row" ? "row" : layerNum(v);
    } else if (a === "--full") {
      const p = args[++i];
      if (p === undefined) {
        return fail("mutation-score: --full needs a report or directory");
      }
      fullPaths.push(p);
    } else {
      paths.push(a);
    }
  }
  const reports = collect(paths.length ? paths : [join(root, "reports")]);
  const full = fullPaths.length ? loadFiles(collect(fullPaths)) : undefined;
  if (full && full.size === 0) {
    return fail("mutation-score: --full: no mutated files in those reports");
  }
  const mdPath = join(root, "MUTATION.md");
  const rowMap = existsSync(mdPath)
    ? rowLayers(readFileSync(mdPath, "utf8"))
    : new Map<string, number>();
  let rows: FileScore[];
  try {
    rows = scoreReports(
      reports,
      join(root, "mutation-triage"),
      only,
      full,
      rowMap,
      layer,
    );
  } catch (e) {
    return fail(`mutation-score: ${(e as Error).message}`);
  }
  const stale = rows.filter((r) => r.fullStale).map((r) => basename(r.file));
  const notInFull = full
    ? rows.filter((r) => !full.has(r.file)).map((r) => basename(r.file))
    : [];
  const out = [
    formatTable(rows),
    "",
    full
      ? "Deferred: NoCoverage here but reached above the ceiling in the full run, or later-layer triage below its layer; not in the gate score."
      : "No --full report: every NoCoverage mutant counts.",
    layer === undefined
      ? "No --layer: later-layer triage counts as untriaged."
      : `Ceiling: ${layer === "row" ? "each file's MUTATION.md row" : `L${layer}`}.`,
    ...(stale.length
      ? [
          `Full report has different or missing source for: ${stale.join(", ")} (nothing deferred there).`,
        ]
      : []),
    ...(notInFull.length
      ? [
          `Not in the full report: ${notInFull.join(", ")} (nothing deferred there).`,
        ]
      : []),
    ...(full
      ? []
      : [
          "No --full report: later-layer entries are unvalidated (not checked for a full-run kill).",
        ]),
    ...(formatUnexplained(rows) ? ["", formatUnexplained(rows)] : []),
    ...(formatOrphanTriage(rows) ? ["", formatOrphanTriage(rows)] : []),
    ...(formatInvalidLaterLayer(rows)
      ? ["", formatInvalidLaterLayer(rows)]
      : []),
    ...(formatUnnamedKillers(rows) ? ["", formatUnnamedKillers(rows)] : []),
    ...(formatDeferred(rows) ? ["", formatDeferred(rows)] : []),
  ].join("\n");
  const missing = (only ?? []).filter(
    (name) => !rows.some((r) => basename(r.file) === name),
  );
  if (rows.length === 0 || missing.length > 0) {
    err.push(
      rows.length === 0
        ? "mutation-score: no mutated files found in the reports"
        : `mutation-score: not in any report: ${missing.join(", ")}`,
    );

    return { code: 1, out, err };
  }

  return { code: check && rows.some((r) => !r.pass) ? 1 : 0, out, err };
}

function main(): void {
  const root = resolve(import.meta.dirname, "..");
  const r = run(process.argv.slice(2), root);
  if (r.out) {
    console.log(r.out);
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `## Mutation score by file (report-only)\n\n${r.out}\n`,
      );
    }
  }
  for (const e of r.err) {
    console.error(e);
  }
  process.exit(r.code);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
