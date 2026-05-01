/**
 * `directive replay <timeline.json> --system <module.ts>`
 *
 * Replay a serialized timeline against a fresh Directive system. Pairs
 * with `@directive-run/timeline`'s `serializeTimeline()` — the typical
 * flow:
 *
 *   1. Production error captures the last N seconds of timeline frames
 *      via `recordTimeline(sys, ...)` + `serializeTimeline(t)`. The
 *      JSON gets attached to a Sentry / PostHog / bug-tracker entry.
 *   2. A developer downloads the JSON and runs:
 *        directive replay bug-1234.json --system path/to/module.ts
 *   3. The CLI loads the module, instantiates a fresh system, and
 *      replays every dispatchable frame in order. The `ReplayResult`
 *      summarizes how many frames dispatched / skipped / truncated.
 *
 * v0.1 scope (deliberately narrow):
 *   - Only reconstructs MUTATE dispatches (matches @directive-run/timeline's
 *     v0.1 dispatchable filter).
 *   - The user's --system file must default-export a `System` instance,
 *     OR export a named `createSystem`-shaped factory we can call.
 *   - No assertion DSL today — the CLI prints the replay diagnostic.
 *     Consumers writing assertions use `replayTimeline()` from the
 *     library directly inside vitest, paired with R1.B matchers.
 *
 * v0.2 scope (deferred, see docs/IDEAS.md):
 *   - `--as-test` flag emits a vitest source file that drives the same
 *     replay loop with structured assertions.
 *   - `--bisect <good.json>` for git-bisect over timeline frames.
 *   - `--diff <other.json>` for causal-graph diff output.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import pc from "picocolors";
import { loadSystem } from "../lib/loader.js";
import { loadTimelinePackage } from "../lib/timeline-loader.js";

interface ReplayCliOptions {
  systemPath?: string;
  maxFrames?: number;
  json: boolean;
  dispatchableOnly: boolean;
  verbose: boolean;
}

function parseArgs(args: string[]): {
  jsonPath: string;
  opts: ReplayCliOptions;
} {
  const opts: ReplayCliOptions = {
    json: false,
    dispatchableOnly: true,
    verbose: false,
  };
  let jsonPath = "";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--system":
      case "-s": {
        const val = args[++i];
        if (val) opts.systemPath = val;
        break;
      }
      case "--max-frames": {
        const val = args[++i];
        const n = val ? Number.parseInt(val, 10) : Number.NaN;
        if (Number.isFinite(n) && n > 0) opts.maxFrames = n;
        break;
      }
      case "--all-frames":
      case "--no-dispatchable-only":
        opts.dispatchableOnly = false;
        break;
      case "--json":
        opts.json = true;
        break;
      case "--verbose":
      case "-v":
        opts.verbose = true;
        break;
      default:
        if (arg && !arg.startsWith("-") && !jsonPath) {
          jsonPath = arg;
        }
    }
  }

  return { jsonPath, opts };
}

function printUsage(): void {
  console.error(`
Usage: directive replay <timeline.json> [options]

Replay a serialized Directive timeline against a fresh system.

Arguments:
  <timeline.json>           Path to a timeline produced by serializeTimeline()

Options:
  --system, -s <path>       Path to a TypeScript file exporting a Directive
                            system (default export or 'system' named export)
  --max-frames <n>          Cap on frames replayed (default 100,000)
  --all-frames              Walk every frame, not just dispatchable ones
                            (diagnostic mode — most frames will skip silently)
  --json                    Emit ReplayResult as JSON
  --verbose, -v             Print per-frame trace
  --help, -h                Show this help

Examples:
  directive replay bug-1234.json --system src/app/system.ts
  directive replay error.json --system src/system.ts --json
  directive replay error.json --system src/system.ts --verbose
`);
}

export async function replayCommand(args: string[]): Promise<void> {
  if (
    args.includes("--help") ||
    args.includes("-h") ||
    args.length === 0
  ) {
    printUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const { jsonPath, opts } = parseArgs(args);

  if (!jsonPath) {
    console.error(pc.red("error: missing <timeline.json> argument"));
    printUsage();
    process.exit(1);
  }
  if (!opts.systemPath) {
    console.error(
      pc.red("error: --system <path> is required"),
      pc.dim("\n       (replay needs a fresh system to dispatch against)"),
    );
    printUsage();
    process.exit(1);
  }

  const resolvedJson = resolve(jsonPath);
  if (!existsSync(resolvedJson)) {
    console.error(pc.red(`error: timeline file not found: ${resolvedJson}`));
    process.exit(1);
  }

  // Load the timeline JSON.
  let raw: string;
  try {
    raw = readFileSync(resolvedJson, "utf8");
  } catch (err) {
    console.error(
      pc.red(`error: failed to read ${resolvedJson}: ${(err as Error).message}`),
    );
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(
      pc.red(
        `error: ${resolvedJson} is not valid JSON: ${(err as Error).message}`,
      ),
    );
    process.exit(1);
  }

  // Lazy-import the timeline package — optional peer.
  const { deserializeTimeline, replayTimeline } = await loadTimelinePackage(
    opts.verbose,
  );

  // Validate + deserialize.
  let timeline: ReturnType<typeof deserializeTimeline>;
  try {
    timeline = deserializeTimeline(parsed);
  } catch (err) {
    console.error(
      pc.red(
        `error: timeline JSON failed validation: ${(err as Error).message}`,
      ),
    );
    process.exit(1);
  }

  // Load the user's system.
  let system: unknown;
  try {
    system = await loadSystem(opts.systemPath);
  } catch (err) {
    console.error(
      pc.red(`error: failed to load system file: ${(err as Error).message}`),
    );
    process.exit(1);
  }

  // Type-guard: replayTimeline needs a `dispatch` function.
  const sys = system as { dispatch?: unknown; start?: () => void };
  if (typeof sys.dispatch !== "function") {
    console.error(
      pc.red(
        `error: loaded system has no dispatch() method. The --system file must export a started Directive system or a factory.`,
      ),
    );
    process.exit(1);
  }

  // Start the system if it isn't already running. Many user files
  // export pre-started systems; double-start is safe (createSystem
  // handles it idempotently).
  if (typeof sys.start === "function") {
    try {
      sys.start();
    } catch {
      /* already running — fine */
    }
  }

  // Replay. The earlier `typeof sys.dispatch !== 'function'` guard
  // (line ~210) verifies the duck-type at runtime; the cast here just
  // bridges the unknown-typed loadSystem return to replayTimeline's
  // typed ReplayableSystem.
  const result = await replayTimeline(
    timeline,
    sys as { dispatch: (event: { type: string; [key: string]: unknown }) => void },
    {
      dispatchableOnly: opts.dispatchableOnly,
      maxFrames: opts.maxFrames,
    },
  );

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const { dispatched, skipped, truncated } = result;
    const ok = dispatched > 0;
    console.log(
      `${ok ? pc.green("✓") : pc.yellow("⚠")} replay complete:`,
      pc.bold(`${dispatched} dispatched`),
      pc.dim(`/ ${skipped} skipped`),
      truncated > 0 ? pc.yellow(`/ ${truncated} TRUNCATED`) : "",
    );
    if (dispatched === 0) {
      console.error(
        pc.yellow(
          "warning: 0 frames dispatched. Either the timeline contains only non-dispatchable frames (system lifecycle, derivations, etc.) or the system shape doesn't match what the timeline recorded.",
        ),
      );
    }
    if (truncated > 0) {
      console.error(
        pc.yellow(
          `warning: ${truncated} frames truncated by --max-frames cap. Raise it with --max-frames <n> if you need them.`,
        ),
      );
    }
  }

  // Exit cleanly. The caller's tests / assertions can chain off this
  // exit status: 0 = replay completed (independent of dispatched count
  // — that's a metric, not a pass/fail).
  process.exit(0);
}
