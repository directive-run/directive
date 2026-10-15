/**
 * Run every project and prove the run was complete. See lib/census.ts.
 *
 * Separate from check-expects on purpose: a neutered check is caught here,
 * and a neutered census is caught by the harness lock it also verifies,
 * whose changes need the oracle-change label (lib/guard.ts).
 *
 * Usage: pnpm --filter @directive-run/conformance census
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ALL_PROJECTS,
  DIFF_PROJECT,
  type JsonReport,
  census,
  checkAheadOfV1,
  checkConfig,
  checkDivergences,
  checkScenarioLayers,
} from "../lib/census.js";
import { defaultRepoRoot } from "../lib/core-entries.js";
import { checkLock } from "../lib/harness.js";

const repoRoot = defaultRepoRoot;
const conformanceRoot = join(repoRoot, "packages/conformance");
const failures: string[] = [];

failures.push(...checkLock(conformanceRoot));
failures.push(...checkAheadOfV1(conformanceRoot));
failures.push(...checkScenarioLayers(conformanceRoot));
const config = (
  await import(pathToFileURL(join(conformanceRoot, "vitest.config.ts")).href)
).default;
failures.push(...checkConfig(config, repoRoot));

const out = mkdtempSync(join(tmpdir(), "conformance-census-"));
const reports: Record<string, JsonReport> = {};
// The differential scenarios append each divergence id they used here.
const divergenceLog = join(out, "divergences-used.txt");
try {
  for (const project of ALL_PROJECTS) {
    const file = join(out, `${project.replace(/:/g, "_")}.json`);
    const result = spawnSync(
      join(conformanceRoot, "node_modules/.bin/vitest"),
      [
        "run",
        "--config",
        "vitest.config.ts",
        "--project",
        project,
        "--reporter=default",
        "--reporter=json",
        `--outputFile.json=${file}`,
      ],
      {
        cwd: conformanceRoot,
        stdio: "inherit",
        env:
          project === DIFF_PROJECT
            ? { ...process.env, DIFF_DIVERGENCE_LOG: divergenceLog }
            : process.env,
      },
    );
    if (result.status !== 0) {
      failures.push(`${project}: vitest exited ${result.status}`);
    }
    try {
      reports[project] = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      failures.push(`${project}: no JSON report`);
    }
  }
  failures.push(...census(repoRoot, reports));
  const used = new Set(
    existsSync(divergenceLog)
      ? readFileSync(divergenceLog, "utf8").split("\n").filter(Boolean)
      : [],
  );
  failures.push(...checkDivergences(conformanceRoot, used));
} finally {
  rmSync(out, { recursive: true, force: true });
}

for (const failure of failures) {
  console.error(`✗ ${failure}`);
}
if (failures.length > 0) {
  console.error(`\n[census] ${failures.length} problem(s)`);
  process.exit(1);
}
const total = Object.values(reports).reduce(
  (n, r) =>
    n + r.testResults.reduce((m, f) => m + f.assertionResults.length, 0),
  0,
);
console.log(
  `[census] ${ALL_PROJECTS.length} projects, ${total} tests: every port ran in every engine, nothing skipped but aheadOfV1`,
);
