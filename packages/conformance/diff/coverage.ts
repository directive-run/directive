/**
 * Function coverage of the engines a differential run loads, for
 * scripts/diff-coverage.ts. Off unless `DIFF_COVERAGE_DIR` is set; then each
 * test file's worker records V8 precise coverage and writes it there when
 * the file finishes. (NODE_V8_COVERAGE does not work: vitest ends its
 * workers before they flush.)
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { Session } from "node:inspector/promises";
import { join } from "node:path";
import { afterAll } from "vitest";

const dir = process.env.DIFF_COVERAGE_DIR;

if (dir) {
  const session = new Session();
  session.connect();
  await session.post("Profiler.enable");
  await session.post("Profiler.startPreciseCoverage", {
    callCount: true,
    detailed: false,
  });
  afterAll(async () => {
    const taken = (await session.post("Profiler.takePreciseCoverage")) as {
      result: Array<{ url: string }>;
    };
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${randomUUID()}.json`),
      JSON.stringify({
        result: taken.result.filter((s) =>
          s.url.includes("/packages/core/src/"),
        ),
      }),
    );
    session.disconnect();
  });
}
