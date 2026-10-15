/**
 * The harness: every file that decides what the suite runs and how it judges
 * the result. Its content is pinned by `harness.lock.json`; changing any of it
 * means regenerating the lock, which a pull request may only do with the
 * `oracle-change` label (see lib/guard.ts).
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Files at the package root that belong to the harness. */
const ROOT_FILES = [
  "vitest.config.ts",
  "tsconfig.json",
  "package.json",
  "aheadOfV1.json",
  "oracle-baseline.json",
];

/** Directories whose every file belongs to the harness. */
const DIRS = ["helpers", "self", "lib"];

/** scripts/: code only; its JSON is generated and checked by check-expects. */
const SCRIPTS = /^scripts\/.*\.ts$/;

export const LOCK_FILE = "harness.lock.json";

function walk(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);

    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Harness files present on disk, relative to packages/conformance. */
export function harnessFiles(conformanceRoot: string): string[] {
  const out = new Set<string>();
  for (const file of ROOT_FILES) {
    if (existsSync(join(conformanceRoot, file))) {
      out.add(file);
    }
  }
  for (const dir of DIRS) {
    for (const file of walk(join(conformanceRoot, dir))) {
      out.add(relative(conformanceRoot, file));
    }
  }
  for (const file of walk(join(conformanceRoot, "scripts"))) {
    const rel = relative(conformanceRoot, file);
    if (SCRIPTS.test(rel)) {
      out.add(rel);
    }
  }

  return [...out].sort();
}

/** Whether a path (relative to packages/conformance) is a harness path. */
export function isHarnessPath(rel: string): boolean {
  return (
    ROOT_FILES.includes(rel) ||
    rel === LOCK_FILE ||
    rel === "layers.rules.json" ||
    DIRS.some((d) => rel.startsWith(`${d}/`)) ||
    rel.startsWith("scripts/")
  );
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function computeLock(conformanceRoot: string): Record<string, string> {
  return Object.fromEntries(
    harnessFiles(conformanceRoot).map((f) => [
      f,
      sha256(join(conformanceRoot, f)),
    ]),
  );
}

/** Differences between the harness on disk and its lock. */
export function checkLock(conformanceRoot: string): string[] {
  const lockPath = join(conformanceRoot, LOCK_FILE);
  if (!existsSync(lockPath)) {
    return [`${LOCK_FILE} is missing`];
  }
  const locked = JSON.parse(readFileSync(lockPath, "utf8")).files as Record<
    string,
    string
  >;
  const actual = computeLock(conformanceRoot);
  const failures: string[] = [];
  for (const [file, hash] of Object.entries(locked)) {
    if (!(file in actual)) {
      failures.push(`harness file ${file} is in the lock but missing`);
    } else if (actual[file] !== hash) {
      failures.push(`harness file ${file} differs from ${LOCK_FILE}`);
    }
  }
  for (const file of Object.keys(actual)) {
    if (!(file in locked)) {
      failures.push(`harness file ${file} is not in ${LOCK_FILE}`);
    }
  }

  return failures;
}
