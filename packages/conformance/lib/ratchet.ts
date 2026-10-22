/**
 * The v2 ratchet: what core-next passes, it keeps passing.
 *
 * `v2-passing.json` lists, per v2 project, every ported test core-next has
 * passed, above `current` included (scripts/v2-ratchet.ts measures them with
 * the layer gate opened, `DIRECTIVE_V2_ALL=1`). Each listed test must pass
 * again on every run, on core-next's source and on its built dist (the
 * `:dist` twin of each project). The list only grows:
 *
 * - `ratchet --update` adds tests that now pass on both source and dist, and
 *   never removes one;
 * - removing a test needs an entry in `removed` with the reason, and a pull
 *   request labelled `oracle-change` (lib/guard.ts checkPullRequest, run from
 *   the base branch).
 *
 * The file is not a harness file: an engine PR that makes more tests pass may
 * grow it alongside the engine.
 */

import type { JsonReport } from "./census.js";

export const RATCHET_FILE = "v2-passing.json";

/** Each v2 source project and its dist twin, which must pass the same list. */
export const RATCHET_PROJECTS = {
  "conformance:v2": "conformance:v2:dist",
  "conformance:v2:prod": "conformance:v2:dist:prod",
} as const;
export type RatchetProject = keyof typeof RATCHET_PROJECTS;

/** Every project the ratchet run executes. */
export const RATCHET_RUN = Object.entries(RATCHET_PROJECTS).flat();

export interface Removal {
  project: string;
  file: string;
  test: string;
  reason: string;
}

export interface Ratchet {
  $comment?: string;
  /** project → port → test names (the name vitest reports, `a > b > c`). */
  tests: Record<string, Record<string, string[]>>;
  removed?: Removal[];
}

/** project → port → names of the tests that passed. */
export type Passed = Record<string, Record<string, string[]>>;

/** The passing ported tests of one project's JSON report. */
export function passedIn(
  report: JsonReport,
  conformanceRoot: string,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const prefix = `${conformanceRoot.replace(/\/$/, "")}/`;
  for (const file of report.testResults) {
    const rel = file.name.startsWith(prefix)
      ? file.name.slice(prefix.length)
      : file.name;
    if (!rel.startsWith("tests/")) {
      continue;
    }
    for (const a of file.assertionResults) {
      if (a.status === "passed") {
        (out[rel] ??= []).push([...a.ancestorTitles, a.title].join(" > "));
      }
    }
  }

  return out;
}

const ids = (tests: Record<string, Record<string, string[]>>) =>
  Object.entries(tests).flatMap(([project, files]) =>
    Object.entries(files).flatMap(([file, names]) =>
      names.map((test) => ({ project, file, test })),
    ),
  );

const has = (passed: Passed, project: string, file: string, test: string) =>
  passed[project]?.[file]?.includes(test) ?? false;

/** The file's own shape: known projects and ports, no duplicates, reasons. */
export function checkShape(
  ratchet: Ratchet,
  layers: { files: Record<string, { tests: Record<string, unknown> }> },
): string[] {
  const failures: string[] = [];
  const fail = (m: string) => failures.push(`${RATCHET_FILE}: ${m}`);
  if (!ratchet.tests || typeof ratchet.tests !== "object") {
    return [`${RATCHET_FILE}: \`tests\` must be project → port → [test]`];
  }
  for (const [project, files] of Object.entries(ratchet.tests)) {
    if (!(project in RATCHET_PROJECTS)) {
      fail(`${project} is not a v2 source project`);
      continue;
    }
    for (const [file, names] of Object.entries(files)) {
      const known = layers.files[file]?.tests;
      if (!known) {
        fail(`${project} names ${file}, which is not a port`);
        continue;
      }
      if (!Array.isArray(names)) {
        fail(`${project} ${file} must list test names`);
        continue;
      }
      if (new Set(names).size !== names.length) {
        fail(`${project} ${file} lists a test twice`);
      }
    }
  }
  for (const r of ratchet.removed ?? []) {
    if (
      typeof r.reason !== "string" ||
      r.reason.trim().length < 10 ||
      !r.project ||
      !r.file ||
      !r.test
    ) {
      fail(
        `removed entry ${JSON.stringify(r)} needs project, file, test and a reason`,
      );
    }
  }

  return failures;
}

/** Every listed test must have passed on its project and on its dist twin. */
export function checkRatchet(ratchet: Ratchet, passed: Passed): string[] {
  const failures: string[] = [];
  for (const project of RATCHET_RUN) {
    if (!passed[project]) {
      failures.push(`${project} produced no report`);
    }
  }
  for (const { project, file, test } of ids(ratchet.tests)) {
    const twin = RATCHET_PROJECTS[project as RatchetProject];
    for (const p of twin ? [project, twin] : [project]) {
      if (passed[p] && !has(passed, p, file, test)) {
        failures.push(
          `${p}: ${file} > "${test}" is in ${RATCHET_FILE} (core-next passed it) and no longer passes`,
        );
      }
    }
  }

  return failures;
}

/**
 * The ratchet grown by every test that now passes on a source project and
 * its dist twin. Never removes; `added` counts what is new.
 */
export function grow(
  ratchet: Ratchet,
  passed: Passed,
): { next: Ratchet; added: number } {
  const tests: Record<string, Record<string, Set<string>>> = {};
  for (const { project, file, test } of ids(ratchet.tests)) {
    ((tests[project] ??= {})[file] ??= new Set()).add(test);
  }
  let added = 0;
  for (const [project, twin] of Object.entries(RATCHET_PROJECTS)) {
    for (const [file, names] of Object.entries(passed[project] ?? {})) {
      for (const test of names) {
        if (!has(passed, twin, file, test)) {
          continue;
        }
        const set = ((tests[project] ??= {})[file] ??= new Set());
        if (!set.has(test)) {
          set.add(test);
          added++;
        }
      }
    }
  }
  const sorted = (o: Record<string, unknown>) =>
    Object.keys(o).sort((a, b) => a.localeCompare(b));
  const next: Ratchet = {
    ...(ratchet.$comment ? { $comment: ratchet.$comment } : {}),
    tests: Object.fromEntries(
      sorted(tests).map((project) => [
        project,
        Object.fromEntries(
          sorted(tests[project] ?? {}).map((file) => [
            file,
            [...(tests[project]?.[file] ?? [])].sort((a, b) =>
              a.localeCompare(b),
            ),
          ]),
        ),
      ]),
    ),
    removed: ratchet.removed ?? [],
  };

  return { next, added };
}

/**
 * Pull-request rule: a test that leaves the list needs a `removed` entry with
 * a reason, and the PR needs the oracle-change label.
 */
export function checkShrink(
  base: Ratchet,
  head: Ratchet,
  labelled: boolean,
  label = "oracle-change",
): string[] {
  const failures: string[] = [];
  const headIds = new Set(
    ids(head.tests ?? {}).map((i) =>
      JSON.stringify([i.project, i.file, i.test]),
    ),
  );
  const removed = new Set(
    (head.removed ?? [])
      .filter(
        (r) => typeof r.reason === "string" && r.reason.trim().length >= 10,
      )
      .map((r) => JSON.stringify([r.project, r.file, r.test])),
  );
  const gone = ids(base.tests ?? {}).filter(
    (i) => !headIds.has(JSON.stringify([i.project, i.file, i.test])),
  );
  for (const i of gone) {
    if (!removed.has(JSON.stringify([i.project, i.file, i.test]))) {
      failures.push(
        `${RATCHET_FILE}: ${i.project} ${i.file} > "${i.test}" was removed without a \`removed\` entry giving the reason`,
      );
    }
  }
  if (gone.length > 0 && !labelled) {
    failures.push(
      `${RATCHET_FILE}: this PR removes ${gone.length} test(s) core-next passed and needs the ${label} label`,
    );
  }

  return failures;
}
