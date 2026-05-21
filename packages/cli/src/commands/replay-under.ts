/**
 * `directive replay-under --history <frames.json> --proposed <spec.json>`
 *
 * Counterfactual rule replay. Given a recorded history of fact-state frames
 * and a proposed replacement for a constraint's `when` predicate, replay the
 * frames through both the original and the proposed predicate and report how
 * their match sets differ — the "how many users would this rule change have
 * affected?" question, answered against real recorded history.
 *
 * History JSON is accepted in three shapes:
 *   1. A bare array of frames:        [{ id, timestamp?, facts }, ...]
 *   2. An object wrapping them:       { frames: [{ id, ..., facts }, ...] }
 *   3. A bare array of fact objects:  [{ phase: "red", ... }, ...]
 *      — each element is wrapped as a frame keyed by its index.
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
  type CounterfactualReport,
  type ReplayFrame,
  replayUnder,
} from "@directive-run/core";
import pc from "picocolors";

interface ReplayUnderCliOptions {
  historyPath?: string;
  proposedPath?: string;
  originalPath?: string;
  maxSamples: number;
  json: boolean;
}

function parseArgs(args: string[]): ReplayUnderCliOptions {
  const opts: ReplayUnderCliOptions = { maxSamples: 20, json: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--history":
      case "-h": {
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

Options:
  --history <path>        Recorded frames JSON (required)
  --proposed <path>       Proposed predicate JSON (required)
  --original <path>       Original predicate JSON (required in v1)
  --max-samples <n>       Diff frames sampled per bucket (default 20)
  --json                  Emit the CounterfactualReport as JSON
  --help                  Show this help

Examples:
  directive replay-under --history sessions.json \\
    --original current-rule.json --proposed tightened-rule.json
  directive replay-under --history sessions.json \\
    --original a.json --proposed b.json --json
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

/** Normalize a parsed history JSON into a `ReplayFrame[]`. */
function loadFrames(raw: unknown): ReplayFrame[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { frames?: unknown }).frames)
      ? ((raw as { frames: unknown[] }).frames)
      : null;

  if (!list) {
    console.error(
      pc.red(
        "error: --history must be a JSON array of frames, or an object with a `frames` array",
      ),
    );
    process.exit(1);
  }

  return list.map((entry, index) => {
    if (entry && typeof entry === "object" && "facts" in entry) {
      const frame = entry as { id?: string | number; timestamp?: number; facts: unknown };
      const out: ReplayFrame = {
        id: frame.id ?? index,
        facts: (frame.facts ?? {}) as Record<string, unknown>,
      };
      if (typeof frame.timestamp === "number") {
        out.timestamp = frame.timestamp;
      }

      return out;
    }

    // A bare fact object — wrap it, keyed by index.
    return { id: index, facts: (entry ?? {}) as Record<string, unknown> };
  });
}

/** Compact one-line preview of a frame's facts. */
function previewFacts(facts: Record<string, unknown>): string {
  const parts = Object.entries(facts)
    .slice(0, 6)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`);
  const extra = Object.keys(facts).length - parts.length;

  return parts.join(" ") + (extra > 0 ? pc.dim(` +${extra} more`) : "");
}

function printReport(report: CounterfactualReport): void {
  const { original, proposed, delta } = report;
  const deltaStr =
    delta > 0
      ? pc.green(`+${delta}`)
      : delta < 0
        ? pc.red(`${delta}`)
        : pc.dim("±0");

  console.log(`\n${pc.bold("replay-under")} — counterfactual rule replay\n`);
  console.log(`  frames evaluated   ${report.framesEvaluated}`);
  console.log(`  original spec      matched ${original.matched} frames`);
  console.log(
    `  proposed spec      matched ${proposed.matched} frames   (${deltaStr})\n`,
  );
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
      pc.dim(`\n  ${sampled} of ${total} diff frames sampled — --json for the full report`),
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
        pc.dim("\n       (v1 cannot recover the constraint's current `when` from a live system)"),
    );
    printUsage();
    process.exit(1);
  }

  const frames = loadFrames(readJsonFile(opts.historyPath, "--history"));
  const original = readJsonFile(opts.originalPath, "--original");
  const proposed = readJsonFile(opts.proposedPath, "--proposed");

  const report = replayUnder({
    frames,
    original,
    proposed,
    maxSamples: opts.maxSamples,
  });

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));

    return;
  }

  printReport(report);
}
