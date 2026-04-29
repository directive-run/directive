/**
 * Vitest reporter for `@directive-run/timeline`.
 *
 * Hooks into the test runner so that whenever a test fails, the matching
 * Directive timeline (looked up by full test name) is rendered to the
 * terminal alongside the standard failure message.
 *
 * Usage in `vitest.config.ts`:
 *
 * ```ts
 * import { defineConfig } from 'vitest/config';
 * import { TimelineReporter } from '@directive-run/timeline/reporter';
 *
 * export default defineConfig({
 *   test: {
 *     reporters: ['default', new TimelineReporter()],
 *   },
 * });
 * ```
 *
 * In your tests, record a timeline with the full test name as the key.
 * Vitest exposes the test name via `expect.getState().currentTestName`:
 *
 * ```ts
 * import { expect, it } from 'vitest';
 * import { recordTimeline } from '@directive-run/timeline';
 *
 * it('does the thing', async () => {
 *   const sys = createSystem({ ... });
 *   recordTimeline(sys, { id: expect.getState().currentTestName! });
 *   // ... test ...
 * });
 * ```
 *
 * On failure, the reporter prints the timeline. On pass, the timeline
 * is silently discarded (still in the registry; clear with afterEach if
 * memory pressure is a concern).
 */

import { _getRegistry, formatTimeline, type FormatOptions } from "./index.js";

/**
 * Minimal subset of the vitest Reporter interface that we use. We
 * intentionally don't import vitest's Reporter type — that would make
 * vitest a hard dep and complicate consumer install. The duck shape
 * below has been stable across vitest 1.x and 2.x.
 */
interface ReporterFile {
  filepath?: string;
  tasks?: ReporterTask[];
}

interface ReporterTask {
  id?: string;
  name?: string;
  type?: string;
  result?: { state?: string; errors?: unknown[] };
  tasks?: ReporterTask[];
  /**
   * Vitest 1.4+ exposes a parent-suite pointer; older versions don't.
   * The reporter prefers this when available to reconstruct the full
   * hierarchical name (`describe > nested > test`) — the same string
   * that `expect.getState().currentTestName` returns in the test body,
   * which is the documented `recordTimeline` id source.
   */
  suite?: ReporterTask;
}

export interface TimelineReporterOptions extends FormatOptions {
  /**
   * If true, also print timelines for *passing* tests. Useful when
   * debugging a test that "passes" but doesn't actually exercise the
   * surface you expected. Default: false.
   */
  alwaysPrint?: boolean;
}

/**
 * Vitest reporter that prints captured Directive timelines on test
 * failure.
 */
export class TimelineReporter {
  constructor(private readonly options: TimelineReporterOptions = {}) {}

  // Vitest 1.x / 2.x lifecycle hook. Called when all tests finish.
  // We walk the file → suite → test tree, find failing tests, and
  // print any timeline whose ID matches the test's full name.
  onFinished(files: ReporterFile[] = []): void {
    const failing = collectTests(files).filter((t) =>
      this.options.alwaysPrint ? true : t.result?.state === "fail",
    );

    if (failing.length === 0) return;

    const registry = _getRegistry();
    const printed: string[] = [];

    for (const test of failing) {
      const name = fullTestName(test);
      // Try the full hierarchical name first (matches
      // `expect.getState().currentTestName`), then the leaf name. We
      // do NOT fall back to substring matching — that produced
      // cross-test contamination in R1 (substring match between
      // unrelated tests with similar names).
      let timeline = registry.get(name);
      if (timeline === undefined && test.name !== undefined && test.name !== name) {
        timeline = registry.get(test.name);
      }
      if (timeline === undefined) continue;

      printed.push(
        `\n──────── Directive timeline for ${state(test)} ────────\n${name}\n${formatTimeline(timeline, this.options)}\n`,
      );
    }

    if (printed.length > 0) {
      // Use stderr so the output isn't captured by tools that pipe stdout.
      // eslint-disable-next-line no-console
      console.error(printed.join("\n"));
    }
  }
}

function collectTests(
  files: ReporterFile[],
  out: ReporterTask[] = [],
): ReporterTask[] {
  for (const file of files) {
    if (file.tasks !== undefined) walkTasks(file.tasks, out);
  }
  return out;
}

function walkTasks(tasks: ReporterTask[], out: ReporterTask[]): void {
  for (const task of tasks) {
    if (task.type === "test") {
      out.push(task);
    }
    if (task.tasks !== undefined) {
      walkTasks(task.tasks, out);
    }
  }
}

function fullTestName(task: ReporterTask): string {
  // Reconstruct the same `"describe > nested > test"` shape that
  // `expect.getState().currentTestName` exposes inside the test body —
  // which is the documented `recordTimeline()` id source. Walks the
  // `task.suite` parent chain (vitest 1.4+); each ancestor whose name
  // is non-empty contributes to the prefix. The root file-suite has
  // an empty name; we skip it.
  const segments: string[] = [];
  let cursor: ReporterTask | undefined = task;
  while (cursor !== undefined) {
    if (cursor.name !== undefined && cursor.name !== "") {
      segments.unshift(cursor.name);
    }
    cursor = cursor.suite;
  }
  if (segments.length === 0) return task.name ?? "(unnamed test)";
  return segments.join(" > ");
}

function state(task: ReporterTask): string {
  return task.result?.state === "pass" ? "PASS" : "FAIL";
}
