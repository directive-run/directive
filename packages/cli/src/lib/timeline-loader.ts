/**
 * Shared lazy-import helper for `@directive-run/timeline`. Three CLI
 * commands (`replay`, `bisect`, `timeline diff`) all need to load
 * timeline at runtime as an optional peer — without this helper each
 * command duplicates the same try/catch + error message.
 *
 * `import type` at the top is fully erased at compile time, so the
 * lazy `await import()` semantics are preserved exactly: timeline
 * stays an optional peer, the CLI runs without it for non-timeline
 * commands, and the typed module shape is still single-sourced.
 *
 * (R5 arch C2 + arch M2.)
 */

import pc from "picocolors";

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import type * as Timeline from "@directive-run/timeline";

export type TimelineModule = typeof Timeline;

/**
 * Load `@directive-run/timeline` lazily. On failure, prints a clear
 * install-prompt error and exits with code 1.
 *
 * @param verbose — when true, also prints the underlying require/import
 * error to stderr for debugging.
 */
export async function loadTimelinePackage(
  verbose = false,
): Promise<TimelineModule> {
  try {
    return (await import("@directive-run/timeline")) as TimelineModule;
  } catch (err) {
    console.error(
      pc.red(
        "error: @directive-run/timeline not installed in this project.\n       Install it: npm install --save-dev @directive-run/timeline",
      ),
    );
    if (verbose) console.error(pc.dim((err as Error).message));
    process.exit(1);
  }
}
