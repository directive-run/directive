/**
 * `directive bisect <timeline.json> --system <factory.ts> --assert <expr>`
 *
 * Git-bisect, but over recorded timeline frames. Pairs with
 * `@directive-run/timeline`'s `serializeTimeline()` + `bisectTimeline()`
 * — typical flow:
 *
 *   1. Production captures a timeline that ends in a known-bad state.
 *   2. Engineer downloads the JSON, picks a JS expression that
 *      distinguishes the good state from the bad state (e.g.
 *      `facts.count >= 0`).
 *   3. Run:
 *        directive bisect bug-1234.json \
 *          --system test/bisect-system.ts \
 *          --assert 'facts.count >= 0'
 *   4. CLI binary-searches the frame stream and prints the first
 *      frame whose inclusion flips the assertion to false.
 *
 * --system contract
 *   The user's TypeScript file must export a factory: a callable
 *   returning a freshly-instantiated, started Directive system. Bisect
 *   calls the factory once per midpoint replay so each attempt is
 *   hermetic. See `loadSystemFactory()` for the exact lookup rules.
 *
 * --assert contract
 *   The expression is evaluated as a JS Function body with `facts` and
 *   `system` in scope. Returning a truthy value means "this prefix is
 *   in the GOOD region of the search"; falsy means "this prefix is in
 *   the BAD region." Bisect locates the smallest prefix in the BAD
 *   region.
 *
 *     --assert 'facts.count >= 0'             // good: count never negative
 *     --assert 'facts.status !== "error"'     // good: status not error
 *     --assert 'system.inspect().errors.length === 0'  // good: no errors
 *
 *   The expression runs LOCALLY in the CLI process — there's no
 *   sandbox. Don't pass arbitrary strings from untrusted callers.
 *
 * v0.1 scope:
 *   - Single-timeline bisect (no good.json/bad.json comparison yet).
 *   - String --assert expression (no `--assert-file` to load a vitest
 *     yet; that's R2.D territory).
 *   - Reports first failing frame index + reconstructs the dispatch
 *     payload for human readability.
 *
 * v0.2 (deferred):
 *   - `directive bisect --good <good.json> --bad <bad.json>` — diff
 *     two timelines and bisect the delta.
 *   - `--assert-file <vitest.ts>` — run a real test as the oracle.
 *   - `--git-bisect` — emit a bisect-run script.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pc from "picocolors";
import { loadSystemFactory } from "../lib/loader.js";
import { loadTimelinePackage } from "../lib/timeline-loader.js";

interface BisectCliOptions {
  systemPath?: string;
  assertExpr?: string;
  maxFrames?: number;
  noDeterminismCheck: boolean;
  json: boolean;
  verbose: boolean;
}

function parseArgs(args: string[]): {
  jsonPath: string;
  opts: BisectCliOptions;
} {
  const opts: BisectCliOptions = {
    json: false,
    noDeterminismCheck: false,
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
      case "--assert":
      case "-a": {
        const val = args[++i];
        if (val) opts.assertExpr = val;
        break;
      }
      case "--max-frames": {
        const val = args[++i];
        const n = val ? Number.parseInt(val, 10) : Number.NaN;
        if (Number.isFinite(n) && n > 0) opts.maxFrames = n;
        break;
      }
      case "--no-determinism-check":
        opts.noDeterminismCheck = true;
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
Usage: directive bisect <timeline.json> --system <factory.ts> --assert <expr>

Binary-search a recorded timeline for the first frame that triggers a
failing assertion — git-bisect, but over ObservationEvent frames.

Arguments:
  <timeline.json>            Path to a timeline produced by serializeTimeline()

Options:
  --system, -s <path>        TypeScript file exporting a system factory
                             (createSystem / systemFactory / default).
                             The factory must return a started Directive
                             system; bisect calls it once per midpoint.
  --assert, -a <expression>  JS expression with 'facts' and 'system' in
                             scope. Truthy = good prefix, falsy = bad
                             prefix. Bisect finds the smallest bad prefix.
  --max-frames <n>           Per-replay frame cap (default 100,000)
  --no-determinism-check     Skip the "replay-twice and compare" gate
                             before bisecting. Use only on timelines you
                             know are deterministic.
  --json                     Emit BisectResult as JSON
  --verbose, -v              Print every midpoint and its verdict
  --help, -h                 Show this help

SECURITY: --assert is evaluated as JavaScript in this process. Only
pass expressions from sources you trust (your own scripts, your own
PRs). Don't paste expressions from issues, untrusted Slack messages,
or third-party sources without reading them first.

Examples:
  directive bisect bug-1234.json --system test/bisect-sys.ts \\
    --assert 'facts.count >= 0'

  directive bisect crash.json -s factory.ts -a 'facts.status !== "error"' --json
`);
}

/**
 * Build a user-supplied JS expression into a callable oracle that
 * returns boolean. Accepts `facts` and `system` as the only in-scope
 * names. Throws at parse time if the expression is malformed.
 *
 * Important: this evaluates user-supplied JS in the CLI process. The
 * CLI is a local-trust tool (operator runs it on their own machine
 * with their own input), so this is acceptable. Do NOT relay this
 * surface to a server-side context.
 */
function compileAssertion(expr: string): (system: unknown) => boolean {
  let fn: (facts: unknown, system: unknown) => unknown;
  try {
    // Function constructor is intentional: the assertion expression
    // needs lexical scope of `facts` + `system` as variables.
    fn = new Function("facts", "system", `"use strict"; return (${expr});`) as (
      facts: unknown,
      system: unknown,
    ) => unknown;
  } catch (err) {
    throw new Error(
      `Failed to compile --assert expression: ${(err as Error).message}\n  expression: ${expr}`,
    );
  }
  return (system: unknown) => {
    const facts = (system as { facts?: unknown })?.facts;
    const result = fn(facts, system);
    return Boolean(result);
  };
}

export async function bisectCommand(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
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
      pc.dim(
        "\n       (bisect needs a factory to instantiate a fresh system per midpoint)",
      ),
    );
    printUsage();
    process.exit(1);
  }
  if (!opts.assertExpr) {
    console.error(
      pc.red("error: --assert <expression> is required"),
      pc.dim(
        "\n       (assertion distinguishes 'good' from 'bad' system state)",
      ),
    );
    printUsage();
    process.exit(1);
  }

  // Load the timeline JSON.
  const resolvedJson = resolve(jsonPath);
  if (!existsSync(resolvedJson)) {
    console.error(pc.red(`error: timeline file not found: ${resolvedJson}`));
    process.exit(1);
  }

  let raw: string;
  try {
    raw = readFileSync(resolvedJson, "utf8");
  } catch (err) {
    console.error(
      pc.red(
        `error: failed to read ${resolvedJson}: ${(err as Error).message}`,
      ),
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

  // Lazy-import the timeline package — optional peer. Types come
  // from `import type` inside the helper, so we get full type safety
  // without forcing timeline into the install graph for non-timeline
  // CLI commands.
  const { deserializeTimeline, bisectTimeline } = await loadTimelinePackage(
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

  // Compile the assertion before any replay so a malformed expression
  // fails fast with a clear message instead of after a minute of work.
  let assertion: (system: unknown) => boolean;
  try {
    assertion = compileAssertion(opts.assertExpr);
  } catch (err) {
    console.error(pc.red(`error: ${(err as Error).message}`));
    process.exit(1);
  }

  // Load the user's factory.
  let factory: () => Promise<unknown>;
  try {
    factory = await loadSystemFactory(opts.systemPath);
  } catch (err) {
    console.error(
      pc.red(`error: failed to load system factory: ${(err as Error).message}`),
    );
    process.exit(1);
  }

  if (opts.verbose) {
    console.error(
      pc.dim(
        `bisecting ${timeline.frames.length} frames with assertion: ${opts.assertExpr}`,
      ),
    );
  }

  // Run bisect. The factory's return is verified at runtime by
  // loadSystemFactory() to be a started Directive system (which
  // satisfies ReplayableSystem's `dispatch` requirement); the cast
  // here just bridges loadSystemFactory's `any` return to bisect's
  // typed factory shape.
  const result = await bisectTimeline(
    timeline,
    factory as () => Promise<{
      dispatch: (event: { type: string; [key: string]: unknown }) => void;
    }>,
    assertion,
    {
      maxFrames: opts.maxFrames,
      determinismCheck: !opts.noDeterminismCheck,
    },
  );

  if (opts.json) {
    // Strip the heavy frame object from JSON output — the index alone
    // is enough for tooling, and the full frame would double the
    // payload size for callers that just want to pipe into jq.
    // R5 sec #9: emit `null` (not `undefined`) for absent index so jq
    // consumers can distinguish "fails before frame 0" (index=null,
    // failsOnEmptyReplay=true) from "frame 0 itself triggers"
    // (index=0, failsOnEmptyReplay=false). JSON.stringify drops
    // `undefined` keys which made these states indistinguishable.
    const lean = {
      firstFailingFrameIndex: result.firstFailingFrameIndex ?? null,
      iterations: result.iterations,
      noFailureFound: result.noFailureFound,
      failsOnEmptyReplay: result.failsOnEmptyReplay,
      nonDeterministic: result.nonDeterministic,
    };
    console.log(JSON.stringify(lean, null, 2));
    process.exit(0);
  }

  // Human-friendly output.
  if (result.nonDeterministic) {
    console.error(pc.red("✗ bisect aborted: timeline is non-deterministic"));
    console.error(
      pc.dim(
        `       Two full-timeline replays produced different oracle verdicts.\n` +
          `       Bisection is unreliable on non-deterministic timelines.\n` +
          `       Either fix the timeline source (deterministic clocks/seeds)\n` +
          `       or re-run with --no-determinism-check if you accept the risk.`,
      ),
    );
    process.exit(2);
  }
  if (result.noFailureFound) {
    console.error(
      pc.yellow(
        "⚠ no failure to bisect: assertion passes on the full timeline",
      ),
    );
    console.error(
      pc.dim(
        `       The recorded timeline does not exhibit the bug your\n` +
          `       --assert expression checks. Verify the assertion or\n` +
          `       try a different bad.json.`,
      ),
    );
    process.exit(0);
  }
  if (result.failsOnEmptyReplay) {
    console.error(
      pc.yellow(
        "⚠ assertion fails BEFORE any frame replays — bug is in initialization",
      ),
    );
    console.error(
      pc.dim(
        `       The freshly-started system already violates the assertion.\n` +
          `       Bisect cannot narrow further. Inspect the system factory\n` +
          `       or initial fact values.`,
      ),
    );
    process.exit(0);
  }

  // Standard hit.
  const idx = result.firstFailingFrameIndex ?? -1;
  const frame = result.firstFailingFrame;
  const eventType = frame?.event.type ?? "<unknown>";
  console.log(
    `${pc.green("✓")} bisect complete: ${pc.bold(`first failing frame is #${idx}`)} ${pc.dim(`(${eventType})`)}`,
  );
  console.log(
    pc.dim(
      `  • iterations: ${result.iterations} | timeline frames: ${timeline.frames.length}`,
    ),
  );
  if (opts.verbose && frame) {
    console.log(pc.dim("  • frame:"));
    console.log(
      pc.dim(
        `    ${JSON.stringify(frame, null, 2).split("\n").join("\n    ")}`,
      ),
    );
  }
  // R5 DX M3: align with `directive timeline diff` and the rest of
  // the CLI's exit-code convention. A "standard hit" means we LOCATED
  // a failing frame — the user's original premise (bad.json fails)
  // is now confirmed. CI gates can branch on `directive bisect && echo OK`
  // to mean "the timeline is clean."
  //   0 — nothing wrong (noFailureFound / failsOnEmptyReplay handled above)
  //   1 — CLI argument / file / module error (handled above)
  //   2 — problem found (this branch) OR refused to bisect (nonDeterministic, above)
  process.exit(2);
}
