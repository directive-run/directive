/**
 * `directive timeline diff <a.json> <b.json>`
 *
 * Semantic causal-graph diff between two serialized timelines. Pairs
 * with `@directive-run/timeline`'s `diffTimelines()` (R2.C). Typical
 * flow:
 *
 *   1. Engineer captures two timelines: a known-good run + a
 *      regression-bearing run.
 *   2. Run:
 *        directive timeline diff good.json bad.json
 *   3. CLI prints a structured report — frame counts, constraint-fire
 *      deltas, mutation deltas, resolver-run deltas, new errors.
 *
 * Output modes:
 *   - default: human-readable Markdown-style table.
 *   - --json:  raw `TimelineDiff` for piping into jq / CI.
 *
 * Exit codes:
 *   0  → identical timelines
 *   1  → CLI argument error
 *   2  → diff found differences (CI gate friendly)
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import pc from "picocolors";
import { loadTimelinePackage } from "../lib/timeline-loader.js";
// R5 arch C2: import types directly from the timeline package. These
// imports are fully erased at compile time (no runtime require), so the
// optional-peer / lazy `await import()` pattern below is preserved
// exactly. Sourcing the types from the package eliminates the silent
// drift risk that would arise from re-declaring them here.
import type {
  CountDelta,
  ResolverRunDelta,
  ErrorDelta,
} from "@directive-run/timeline";

interface TimelineDiffCliOptions {
  json: boolean;
  verbose: boolean;
}

function parseArgs(args: string[]): {
  aPath: string;
  bPath: string;
  opts: TimelineDiffCliOptions;
} {
  const opts: TimelineDiffCliOptions = { json: false, verbose: false };
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--json":
        opts.json = true;
        break;
      case "--verbose":
      case "-v":
        opts.verbose = true;
        break;
      default:
        if (arg && !arg.startsWith("-")) positionals.push(arg);
    }
  }
  return {
    aPath: positionals[0] ?? "",
    bPath: positionals[1] ?? "",
    opts,
  };
}

function printUsage(): void {
  console.error(`
Usage: directive timeline diff <a.json> <b.json>

Compare two serialized Directive timelines as a structured causal-graph
diff. Reports frame counts, constraint-fire deltas, mutation deltas,
resolver runs, and new errors.

Arguments:
  <a.json>   First timeline (typically the "good" / baseline run)
  <b.json>   Second timeline (typically the "bad" / regression run)

Options:
  --json     Emit TimelineDiff as JSON
  -v, --verbose  Include unchanged categories in the human output
  --help, -h Show this help

Exit codes:
  0  identical timelines
  1  CLI argument error
  2  diff found differences

Examples:
  directive timeline diff baseline.json regression.json
  directive timeline diff a.json b.json --json | jq .constraintFires
`);
}

function fmtSign(n: number): string {
  if (n > 0) return pc.green(`+${n}`);
  if (n < 0) return pc.red(`${n}`);
  return pc.dim(" 0");
}

function fmtCountDelta(rows: CountDelta[]): string[] {
  if (rows.length === 0) return [pc.dim("  (no differences)")];
  return rows.map(
    (r) =>
      `  ${pc.bold(r.id.padEnd(28))} ${String(r.aCount).padStart(4)} → ${String(r.bCount).padStart(4)}  (${fmtSign(r.delta)})`,
  );
}

function fmtResolverRows(rows: ResolverRunDelta[]): string[] {
  if (rows.length === 0) return [pc.dim("  (no differences)")];
  return rows.map(
    (r) =>
      `  ${pc.bold(r.resolver.padEnd(28))} ` +
      `starts ${r.aStarts}→${r.bStarts} (${fmtSign(r.bStarts - r.aStarts)})  ` +
      `completes ${r.aCompletes}→${r.bCompletes} (${fmtSign(r.bCompletes - r.aCompletes)})  ` +
      `errors ${r.aErrors}→${r.bErrors} (${fmtSign(r.bErrors - r.aErrors)})`,
  );
}

function fmtErrors(rows: ErrorDelta[]): string[] {
  if (rows.length === 0) return [pc.dim("  (no new errors)")];
  return rows.map((e) => {
    const sideTag = e.side === "a"
      ? pc.cyan("a-only")
      : pc.yellow("b-only");
    const errStr = (() => {
      try {
        return JSON.stringify(e.error);
      } catch {
        return `[${typeof e.error}]`;
      }
    })();
    return `  ${sideTag}  frame #${e.frameIndex}  ${pc.bold(e.kind)} '${e.id}'  ${pc.dim(errStr)}`;
  });
}

function readTimeline(path: string): unknown {
  const resolved = resolve(path);
  if (!existsSync(resolved)) {
    console.error(pc.red(`error: timeline file not found: ${resolved}`));
    process.exit(1);
  }
  let raw: string;
  try {
    raw = readFileSync(resolved, "utf8");
  } catch (err) {
    console.error(
      pc.red(`error: failed to read ${resolved}: ${(err as Error).message}`),
    );
    process.exit(1);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(
      pc.red(
        `error: ${resolved} is not valid JSON: ${(err as Error).message}`,
      ),
    );
    process.exit(1);
  }
}

export async function timelineDiffCommand(args: string[]): Promise<void> {
  if (
    args.includes("--help") ||
    args.includes("-h") ||
    args.length === 0
  ) {
    printUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const { aPath, bPath, opts } = parseArgs(args);
  if (!aPath || !bPath) {
    console.error(pc.red("error: both <a.json> and <b.json> are required"));
    printUsage();
    process.exit(1);
  }

  // Lazy-import the timeline package — optional peer.
  const { deserializeTimeline, diffTimelines } = await loadTimelinePackage(
    opts.verbose,
  );

  // Parse + validate.
  const aRaw = readTimeline(aPath);
  const bRaw = readTimeline(bPath);
  let aTl: ReturnType<typeof deserializeTimeline>;
  let bTl: ReturnType<typeof deserializeTimeline>;
  try {
    aTl = deserializeTimeline(aRaw);
    bTl = deserializeTimeline(bRaw);
  } catch (err) {
    console.error(
      pc.red(
        `error: timeline JSON failed validation: ${(err as Error).message}`,
      ),
    );
    process.exit(1);
  }

  const diff = diffTimelines(aTl, bTl);

  if (opts.json) {
    console.log(JSON.stringify(diff, null, 2));
    process.exit(diff.identical ? 0 : 2);
  }

  // Human output.
  if (diff.identical) {
    console.log(
      pc.green("✓ identical:"),
      `both timelines have ${diff.aFrameCount} frames and the same causal shape.`,
    );
    process.exit(0);
  }

  console.log(
    pc.bold("Timeline diff"),
    pc.dim(`(${aPath} vs ${bPath})`),
  );
  console.log("");
  console.log(
    `Frames:           ${diff.aFrameCount} → ${diff.bFrameCount}  (${fmtSign(diff.frameCountDelta)})`,
  );
  console.log("");

  console.log(pc.bold("Constraint fires:"));
  for (const line of fmtCountDelta(diff.constraintFires)) console.log(line);
  console.log("");

  console.log(pc.bold("Mutations:"));
  for (const line of fmtCountDelta(diff.mutations)) console.log(line);
  console.log("");

  console.log(pc.bold("Resolver runs:"));
  for (const line of fmtResolverRows(diff.resolverRuns)) console.log(line);
  console.log("");

  console.log(pc.bold("New errors:"));
  for (const line of fmtErrors(diff.newErrors)) console.log(line);
  console.log("");

  process.exit(2);
}
