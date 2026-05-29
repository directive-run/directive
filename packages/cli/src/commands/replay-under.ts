/**
 * `directive replay-under --history <frames.json> --proposed <spec.json>`
 *
 * Predicate backtest — rule-change impact. Given a recorded history of
 * fact-state frames and a proposed replacement for a constraint's `when`
 * predicate, re-score the frames against both the original and the proposed
 * predicate and report how their match sets differ — how many recorded
 * frames the proposed rule would have matched differently, answered against
 * real recorded history.
 *
 * History JSON is accepted in four shapes:
 *   1. A bare array of frames:        [{ id, timestamp?, facts }, ...]
 *   2. An object wrapping them:       { frames: [{ id, ..., facts }, ...] }
 *   3. A bare array of fact objects:  [{ phase: "red", ... }, ...]
 *      — each element is wrapped as a frame keyed by a `#`-prefixed index.
 *   4. A history-manager export:      { version, snapshots, currentIndex }
 *      — `system.history.export()` written to a file, read directly.
 *
 * The proposed (and original) predicate files each contain a single
 * FactPredicate object as JSON.
 *
 * v1 scope: `--original` is required — the CLI does not yet introspect a
 * live system to recover the constraint's current `when`. Recovering the
 * original spec from `system.inspect().constraints[].whenSpec` is a planned
 * enhancement.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type FactPredicate,
  type PredicateBacktestReport,
  type ReplayFrame,
  replayUnder,
  toReplayFrames,
} from "@directive-run/core";
import pc from "picocolors";

interface ReplayUnderCliOptions {
  historyPath?: string;
  proposedPath?: string;
  originalPath?: string;
  maxSamples: number;
  entityKey?: string;
  json: boolean;
}

function parseArgs(args: string[]): ReplayUnderCliOptions {
  const opts: ReplayUnderCliOptions = { maxSamples: 20, json: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--history": {
        const val = args[++i];
        if (val) {
          opts.historyPath = val;
        }
        break;
      }
      case "--proposed":
      case "-p": {
        const val = args[++i];
        if (val) {
          opts.proposedPath = val;
        }
        break;
      }
      case "--original":
      case "-o": {
        const val = args[++i];
        if (val) {
          opts.originalPath = val;
        }
        break;
      }
      case "--max-samples": {
        const val = args[++i];
        const n = val ? Number.parseInt(val, 10) : Number.NaN;
        if (Number.isFinite(n) && n >= 0) {
          opts.maxSamples = n;
        }
        break;
      }
      case "--entity-key": {
        const val = args[++i];
        if (val) {
          opts.entityKey = val;
        }
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
Usage: directive replay-under --history <frames.json> --proposed <spec.json>

Replay a recorded fact-frame history through a proposed constraint
predicate and report how its match set differs from the original.
This is a static predicate backtest — the engine is not re-run.

Options:
  --history <path>        Recorded frames JSON (required) — a frame array,
                          a { frames } object, a bare fact-object array, or
                          a system.history.export() file
  --proposed <path>       Proposed predicate JSON (required)
  --original <path>       Original predicate JSON (required in v1)
  --max-samples <n>       Diff frames sampled per bucket (default 20)
  --entity-key <fact>     Fact key identifying an entity — also reports
                          distinct-entity counts (e.g. userId, sessionId)
  --json                  Emit the PredicateBacktestReport as JSON
  --help                  Show this help

Examples:
  directive replay-under --history sessions.json \\
    --original current-rule.json --proposed tightened-rule.json
  directive replay-under --history sessions.json \\
    --original a.json --proposed b.json --entity-key userId --json
`);
}

/** Parse a JSON file, exiting with a clear message on failure. */
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

/**
 * Normalize a parsed history JSON into a `ReplayFrame[]` — a thin wrapper
 * over the core `toReplayFrames` helper that turns its thrown error into a
 * clean CLI message and exit.
 */
function loadFrames(raw: unknown): ReplayFrame[] {
  try {
    return toReplayFrames(raw);
  } catch (err) {
    console.error(pc.red(`error: ${(err as Error).message}`));
    process.exit(1);
  }
}

/** True when a parsed spec is the always-true empty predicate `{}`. */
function isEmptyPredicate(spec: unknown): boolean {
  return (
    spec !== null &&
    typeof spec === "object" &&
    !Array.isArray(spec) &&
    Object.keys(spec as object).length === 0
  );
}

/** Compact one-line preview of a frame's facts. */
function previewFacts(facts: Record<string, unknown>): string {
  const parts = Object.entries(facts)
    .slice(0, 6)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`);
  const extra = Object.keys(facts).length - parts.length;

  return parts.join(" ") + (extra > 0 ? pc.dim(` +${extra} more`) : "");
}

function printReport(
  report: PredicateBacktestReport,
  entityKey: string | undefined,
): void {
  const { original, proposed, delta } = report;
  const deltaStr =
    delta > 0
      ? pc.green(`+${delta}`)
      : delta < 0
        ? pc.red(`${delta}`)
        : pc.dim("±0");

  console.log(`\n${pc.bold("replay-under")} — predicate backtest\n`);
  console.log(`  frames evaluated   ${report.framesEvaluated}`);
  console.log(`  original spec      matched ${original.matched} frames`);
  console.log(
    `  proposed spec      matched ${proposed.matched} frames   (${deltaStr})`,
  );

  // Distinct-entity counts — only present when --entity-key was supplied.
  if (
    entityKey &&
    original.matchedEntities !== undefined &&
    proposed.matchedEntities !== undefined
  ) {
    console.log(
      `\n  original spec      matched across ${original.matchedEntities} ${entityKey}s`,
    );
    console.log(
      `  proposed spec      matched across ${proposed.matchedEntities} ${entityKey}s`,
    );
  }

  console.log("");
  console.log(
    `  ${pc.green(`+${report.newMatchCount}`)} new matches    ${pc.dim("frames that now match the rule")}`,
  );
  console.log(
    `  ${pc.red(`-${report.lostMatchCount}`)} lost matches   ${pc.dim("frames that no longer match")}`,
  );

  if (report.newMatches.length > 0) {
    console.log(`\n  ${pc.green("sample new matches:")}`);
    for (const s of report.newMatches.slice(0, 8)) {
      console.log(`    frame ${s.frameId}   ${pc.dim(previewFacts(s.facts))}`);
    }
  }
  if (report.lostMatches.length > 0) {
    console.log(`\n  ${pc.red("sample lost matches:")}`);
    for (const s of report.lostMatches.slice(0, 8)) {
      console.log(`    frame ${s.frameId}   ${pc.dim(previewFacts(s.facts))}`);
    }
  }

  const sampled = report.newMatches.length + report.lostMatches.length;
  const total = report.newMatchCount + report.lostMatchCount;
  if (sampled < total) {
    console.log(
      pc.dim(
        `\n  ${sampled} of ${total} diff frames sampled — --json for the full report`,
      ),
    );
  }
  console.log("");
}

export async function replayUnderCommand(args: string[]): Promise<void> {
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
  if (!opts.proposedPath) {
    console.error(pc.red("error: --proposed <spec.json> is required"));
    printUsage();
    process.exit(1);
  }
  if (!opts.originalPath) {
    console.error(
      pc.red("error: --original <spec.json> is required") +
        pc.dim(
          "\n       (v1 cannot recover the constraint's current `when` from a live system)",
        ),
    );
    printUsage();
    process.exit(1);
  }

  const frames = loadFrames(readJsonFile(opts.historyPath, "--history"));
  const original = readJsonFile(opts.originalPath, "--original");
  const proposed = readJsonFile(opts.proposedPath, "--proposed");

  // An empty predicate `{}` is valid but always-true — warn so a confident
  // "matched every frame" report is not mistaken for a meaningful result.
  if (isEmptyPredicate(original)) {
    console.error(
      pc.yellow(
        "warning: --original is an empty predicate {} — it matches every frame",
      ),
    );
  }
  if (isEmptyPredicate(proposed)) {
    console.error(
      pc.yellow(
        "warning: --proposed is an empty predicate {} — it matches every frame",
      ),
    );
  }

  let report: PredicateBacktestReport;
  try {
    // `original` / `proposed` are JSON-parsed `unknown` — replayUnder
    // validates their structure at runtime and throws a clear error on a
    // bad spec, so the cast here is the documented boundary.
    report = replayUnder({
      frames,
      original: original as FactPredicate<Record<string, unknown>>,
      proposed: proposed as FactPredicate<Record<string, unknown>>,
      maxSamples: opts.maxSamples,
      entityKey: opts.entityKey,
    });
  } catch (err) {
    // replayUnder throws a clear `[Directive] replayUnder:` error on an
    // invalid spec or an over-limit history — surface the message, never a
    // raw stack trace.
    console.error(pc.red(`error: ${(err as Error).message}`));
    process.exit(1);
  }

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));

    return;
  }

  printReport(report, opts.entityKey);
}
