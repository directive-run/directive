/**
 * Per-file mutation score with a gate that ignores message text.
 *
 *   tsx scripts/mutation-score.ts [--files a.ts,b.ts] [--check] <report.json | dir>...
 *
 * gate score = killed (+timeout) / all non-ignored mutants. A file PASSES
 * when its gate score is >= 80% AND every remaining non-ignored Survived or
 * NoCoverage mutant is listed in mutation-triage/<basename>.json (matched by
 * line + col + mutator + replacement). `--check` exits 1 if a selected file FAILs.
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
  mutatorName: string;
  replacement?: string;
  status: string;
  location: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
}

export interface ReportFile {
  source?: string;
  mutants: Mutant[];
}

export interface Report {
  files: Record<string, ReportFile>;
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
    | "v1-bug";
  note?: string;
}

export interface FileScore {
  file: string;
  killed: number;
  survived: number;
  noCoverage: number;
  ignored: number;
  triaged: number;
  excluded: number;
  rawScore: number;
  gateScore: number;
  unexplained: Mutant[];
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

export function scoreFile(
  file: string,
  data: ReportFile,
  triage: TriageEntry[],
): FileScore {
  const triaged = new Map(
    triage.map((t) => [key(t.line, t.col, t.mutator, t.replacement), t.reason]),
  );
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
    const k = key(
      m.location.start.line,
      m.location.start.column,
      m.mutatorName,
      m.replacement ?? "",
    );
    const reason = triaged.get(k);
    if (reason !== undefined && EXCLUDED.has(reason)) {
      triagedCount++;
      excluded++;
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

  return {
    file,
    killed,
    survived,
    noCoverage,
    ignored,
    triaged: triagedCount,
    excluded,
    rawScore: raw ? (100 * rawKilled) / raw : 100,
    gateScore,
    unexplained,
    pass: gateScore >= GATE && unexplained.length === 0,
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

export function scoreReports(
  reportPaths: string[],
  triageDir: string,
  only?: string[],
): FileScore[] {
  const rows: FileScore[] = [];
  for (const rp of reportPaths) {
    const r = JSON.parse(readFileSync(rp, "utf8")) as Report;
    for (const [file, data] of Object.entries(r.files ?? {})) {
      if (only && !only.includes(basename(file))) {
        continue;
      }
      rows.push(scoreFile(file, data, loadTriage(triageDir, file)));
    }
  }

  return rows.sort((a, b) => a.file.localeCompare(b.file));
}

export function formatTable(rows: FileScore[]): string {
  const pct = (n: number): string => `${n.toFixed(1)}%`;
  const lines = [
    "| file | killed | survived | noCoverage | ignored (msg) | triaged | excluded | raw | gate | result |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const r of rows) {
    lines.push(
      `| ${basename(r.file)} | ${r.killed} | ${r.survived} | ${r.noCoverage} | ${r.ignored} | ${r.triaged} | ${r.excluded} | ${pct(r.rawScore)} | ${pct(r.gateScore)} | ${r.pass ? "PASS" : "FAIL"} |`,
    );
  }

  return lines.join("\n");
}

function main(): void {
  const args = process.argv.slice(2);
  let check = false;
  let only: string[] | undefined;
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--check") {
      check = true;
    } else if (a === "--files") {
      only = (args[++i] ?? "").split(",").filter(Boolean);
    } else {
      paths.push(a);
    }
  }
  const root = resolve(import.meta.dirname, "..");
  const reports = collect(paths.length ? paths : [join(root, "reports")]);
  const rows = scoreReports(reports, join(root, "mutation-triage"), only);
  const out = formatTable(rows);
  console.log(out);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Mutation score by file (report-only)\n\n${out}\n`,
    );
  }
  const missing = (only ?? []).filter(
    (name) => !rows.some((r) => basename(r.file) === name),
  );
  if (rows.length === 0 || missing.length > 0) {
    console.error(
      rows.length === 0
        ? "mutation-score: no mutated files found in the reports"
        : `mutation-score: not in any report: ${missing.join(", ")}`,
    );
    process.exit(1);
  }
  if (check && rows.some((r) => !r.pass)) {
    process.exit(1);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
