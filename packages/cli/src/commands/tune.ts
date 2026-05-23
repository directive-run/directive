/**
 * `directive tune --history <frames.json> --original <spec.json> --template <spec.json> --sweep <key:range>`
 *
 * Sweep one or more `$hole`-marked parameters in a predicate template
 * against recorded history, render the resulting response curve as an
 * ASCII sparkline, and name the optimum.
 *
 * Two `--sweep` value formats:
 *   • Numeric range:   `--sweep threshold:25..200:25`  →  25, 50, 75, …, 200
 *   • Discrete values: `--sweep plan:free,plus,pro`
 *
 * Pass `--sweep` multiple times for a multi-hole grid search.
 *
 * The template is a regular `FactPredicate` JSON with `{ "$hole": "name" }`
 * placeholders inserted wherever a sweep value should land. The original
 * predicate JSON (the constraint's current `when`) is required as the
 * baseline against which deltas are reported.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type ReplayFrame,
  type SweepReport,
  sweepUnder,
  toReplayFrames,
} from "@directive-run/core";
import pc from "picocolors";

interface TuneCliOptions {
  historyPath?: string;
  originalPath?: string;
  templatePath?: string;
  sweepArgs: string[];
  entityKey?: string;
  json: boolean;
}

function parseArgs(args: string[]): TuneCliOptions {
  const opts: TuneCliOptions = { sweepArgs: [], json: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--history": {
        const val = args[++i];
        if (val) opts.historyPath = val;
        break;
      }
      case "--original":
      case "-o": {
        const val = args[++i];
        if (val) opts.originalPath = val;
        break;
      }
      case "--template":
      case "-t": {
        const val = args[++i];
        if (val) opts.templatePath = val;
        break;
      }
      case "--sweep":
      case "-s": {
        const val = args[++i];
        if (val) opts.sweepArgs.push(val);
        break;
      }
      case "--entity-key": {
        const val = args[++i];
        if (val) opts.entityKey = val;
        break;
      }
      case "--json":
        opts.json = true;
        break;
    }
  }

  return opts;
}

function printUsage(): void {
  console.error(`
Usage: directive tune --history <frames.json> --original <orig.json> \\
                      --template <tmpl.json> --sweep <key:range>

Grid-search one or more parameters in a predicate template against a
recorded fact history and print the response curve.

Options:
  --history <path>        Recorded frames JSON (required)
  --original <path>       Original predicate JSON — the baseline (required)
  --template <path>       Predicate template with { "$hole": "name" } markers (required)
  --sweep <key:range>     Repeatable. Range syntax:
                            * numeric: key:25..200:25  (start..end:step)
                            * discrete: key:val1,val2,val3
  --entity-key <fact>     Fact key identifying an entity — also reports
                          distinct-entity counts (e.g. userId)
  --json                  Emit the full SweepReport as JSON
  --help                  Show this help

Example:
  directive tune --history sessions.json \\
    --original current.json --template proposed-template.json \\
    --sweep threshold:25..200:25
`);
}

function readJsonFile(path: string, label: string): unknown {
  const resolved = resolve(path);
  if (!existsSync(resolved)) {
    console.error(pc.red(`error: ${label} file not found: ${resolved}`));
    process.exit(1);
  }
  try {
    return JSON.parse(readFileSync(resolved, "utf8"));
  } catch (err) {
    console.error(
      pc.red(`error: failed to parse ${label} (${resolved}): `) +
        (err as Error).message,
    );
    process.exit(1);
  }
}

function loadFrames(raw: unknown): ReplayFrame[] {
  try {
    return toReplayFrames(raw);
  } catch (err) {
    console.error(pc.red(`error: ${(err as Error).message}`));
    process.exit(1);
  }
}

/**
 * Parse a single `--sweep` argument into a `[name, values]` pair.
 *
 * Accepts:
 *   - `name:start..end[:step]` for numeric ranges (step defaults to 1)
 *   - `name:a,b,c` for discrete values (each parsed as a number if it
 *     looks numeric, otherwise kept as a string)
 */
function parseSweepArg(arg: string): [string, unknown[]] {
  const colon = arg.indexOf(":");
  if (colon < 1) {
    console.error(
      pc.red(`error: --sweep ${arg}: missing ':' between hole name and values`),
    );
    process.exit(1);
  }
  const name = arg.slice(0, colon);
  const rangeStr = arg.slice(colon + 1);

  // Range form: a..b[:step]
  const rangeMatch = rangeStr.match(/^(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)(?::(-?\d+(?:\.\d+)?))?$/);
  if (rangeMatch) {
    const [, startStr, endStr, stepStr] = rangeMatch;
    const start = Number(startStr);
    const end = Number(endStr);
    const step = stepStr ? Number(stepStr) : 1;
    if (step <= 0) {
      console.error(pc.red(`error: --sweep ${arg}: step must be positive`));
      process.exit(1);
    }
    if (end < start) {
      console.error(
        pc.red(`error: --sweep ${arg}: end (${end}) must be >= start (${start})`),
      );
      process.exit(1);
    }
    const values: number[] = [];
    for (let v = start; v <= end + 1e-9; v += step) {
      values.push(Math.round(v * 1e6) / 1e6);
    }

    return [name, values];
  }

  // Discrete form: a,b,c (parse each as number if possible, else string)
  const tokens = rangeStr.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  if (tokens.length === 0) {
    console.error(pc.red(`error: --sweep ${arg}: no values after ':'`));
    process.exit(1);
  }
  const values = tokens.map((t) => {
    const n = Number(t);
    return Number.isNaN(n) ? t : n;
  });

  return [name, values];
}

// ============================================================================
// Sparkline renderer
// ============================================================================

const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

function bar(value: number, max: number, width = 32): string {
  if (max <= 0) return "".padEnd(width);
  const filled = Math.round((value / max) * width);
  return "█".repeat(filled).padEnd(width);
}

/**
 * Render the sweep curve as an ASCII table with a bar per row plus a
 * one-line sparkline summary. Highlights the argmax row in green.
 */
function printCurve(report: SweepReport, entityKey: string | undefined): void {
  const points = report.points;
  const maxMatched = Math.max(...points.map((p) => p.report.proposed.matched));
  const baselineMatched = report.baseline.report.original.matched;

  // Bars + sparkline track the OBJECTIVE score, not matched, so the green
  // "best" row also gets the longest bar even under a custom objective.
  // Normalize to [minScore..maxScore]; flat curves render empty bars.
  const scores = points.map((p) => p.score);
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const scoreRange = maxScore - minScore;

  const sparkline = points
    .map((p) => {
      const r = scoreRange > 0 ? (p.score - minScore) / scoreRange : 0;
      return BLOCKS[Math.min(BLOCKS.length - 1, Math.round(r * (BLOCKS.length - 1)))];
    })
    .join("");

  console.log(`\n${pc.bold("directive tune")} — parameter sweep`);
  console.log(
    `\n  frames evaluated   ${points[0]?.report.framesEvaluated ?? 0}`,
  );
  console.log(
    `  baseline (current) matched ${baselineMatched} frames`,
  );
  console.log(`  points evaluated   ${points.length}\n`);

  console.log(`  sparkline   ${pc.cyan(sparkline)}\n`);

  // Detail table.
  const valueKeys = Object.keys(points[0]?.values ?? {});
  const header =
    valueKeys.map((k) => k.padEnd(12)).join(" ") +
    "  " +
    "matched".padStart(8) +
    "  " +
    "delta".padStart(7) +
    (entityKey ? "  " + `${entityKey}s`.padStart(8) : "") +
    "  bar";
  console.log(pc.dim("  " + header));

  for (const p of points) {
    const valsStr = valueKeys
      .map((k) => String(p.values[k] ?? "").padEnd(12))
      .join(" ");
    const matched = p.report.proposed.matched;
    const delta = p.report.delta;
    const entityStr = entityKey
      ? String(p.report.proposed.matchedEntities ?? "").padStart(8)
      : "";
    const deltaStr =
      delta > 0
        ? pc.green(`+${delta}`.padStart(7))
        : delta < 0
          ? pc.red(`${delta}`.padStart(7))
          : pc.dim("±0".padStart(7));
    const barLen =
      scoreRange > 0 ? Math.round(((p.score - minScore) / scoreRange) * 24) : 0;
    const row =
      valsStr +
      "  " +
      String(matched).padStart(8) +
      "  " +
      deltaStr +
      (entityKey ? "  " + entityStr : "") +
      "  " +
      "█".repeat(barLen).padEnd(24);

    const isBest = p === report.best;
    console.log(isBest ? pc.green("  " + row) : "  " + row);
  }

  console.log(
    `\n  ${pc.bold(pc.green("best"))} — ${valueKeys
      .map((k) => `${k}=${report.best.values[k]}`)
      .join(", ")} → matched ${report.best.report.proposed.matched} (score ${
      report.best.score
    })\n`,
  );
}

// ============================================================================
// Command entrypoint
// ============================================================================

export async function tuneCommand(args: string[]): Promise<void> {
  if (args.includes("--help") || args.length === 0) {
    printUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const opts = parseArgs(args);

  if (!opts.historyPath) {
    console.error(pc.red("error: --history <frames.json> is required"));
    printUsage();
    process.exit(1);
  }
  if (!opts.originalPath) {
    console.error(pc.red("error: --original <spec.json> is required"));
    printUsage();
    process.exit(1);
  }
  if (!opts.templatePath) {
    console.error(pc.red("error: --template <spec.json> is required"));
    printUsage();
    process.exit(1);
  }
  if (opts.sweepArgs.length === 0) {
    console.error(pc.red("error: at least one --sweep <key:range> is required"));
    printUsage();
    process.exit(1);
  }

  const frames = loadFrames(readJsonFile(opts.historyPath, "--history"));
  const original = readJsonFile(opts.originalPath, "--original");
  const template = readJsonFile(opts.templatePath, "--template");

  const sweep: Record<string, unknown[]> = {};
  for (const s of opts.sweepArgs) {
    const [name, values] = parseSweepArg(s);
    sweep[name] = values;
  }

  let report: SweepReport;
  try {
    report = sweepUnder({
      frames,
      // biome-ignore lint/suspicious/noExplicitAny: spec loaded from JSON
      original: original as any,
      template,
      sweep,
      entityKey: opts.entityKey,
    });
  } catch (err) {
    console.error(pc.red(`error: ${(err as Error).message}`));
    process.exit(1);
  }

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));

    return;
  }

  printCurve(report, opts.entityKey);
}
