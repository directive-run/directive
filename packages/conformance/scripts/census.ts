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
  type FuzzRun,
  type JsonReport,
  census,
  checkAheadOfV1,
  checkConfig,
  checkDivergences,
  checkFuzzRuns,
  checkHooksFired,
  checkScenarioLayers,
  describeFuzzRun,
} from "../lib/census.js";
import { defaultRepoRoot } from "../lib/core-entries.js";
import { checkLock } from "../lib/harness.js";

const repoRoot = defaultRepoRoot;
const conformanceRoot = join(repoRoot, "packages/conformance");
const failures: string[] = [];

// The highest layer core-next has built; null until Phase 1.
const v2Layer = JSON.parse(
  readFileSync(join(conformanceRoot, "layers.rules.json"), "utf8"),
).current as string | null;

failures.push(...checkLock(conformanceRoot));
failures.push(...checkAheadOfV1(conformanceRoot));
failures.push(...checkScenarioLayers(conformanceRoot));
const config = (
  await import(pathToFileURL(join(conformanceRoot, "vitest.config.ts")).href)
).default;
failures.push(...checkConfig(config, repoRoot));

const out = mkdtempSync(join(tmpdir(), "conformance-census-"));
let fuzzRuns: FuzzRun[] = [];
const reports: Record<string, JsonReport> = {};
// The differential project logs here what a test cannot assert on its own:
// divergences used, hooks fired, fuzz cases run (diff/scenario.ts).
const diffLogs = join(out, "diff-logs");
const readLines = (file: string) =>
  existsSync(join(diffLogs, file))
    ? readFileSync(join(diffLogs, file), "utf8").split("\n").filter(Boolean)
    : [];
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
            ? { ...process.env, DIFF_LOG_DIR: diffLogs }
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
  failures.push(
    ...checkDivergences(
      conformanceRoot,
      new Set(readLines("divergences-used.txt")),
    ),
  );
  failures.push(
    ...checkHooksFired(conformanceRoot, new Set(readLines("hooks-fired.txt"))),
  );
  fuzzRuns = readLines("fuzz.jsonl").map((l) => JSON.parse(l));
  failures.push(...checkFuzzRuns(fuzzRuns, v2Layer !== null));
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
  `[census] ${ALL_PROJECTS.length} projects, ${total} tests: every port ran in every engine, nothing skipped but aheadOfV1 on v1 and the layer gate on v2`,
);
{
  const apiChanges = JSON.parse(
    readFileSync(join(conformanceRoot, "contracts/api-changes.json"), "utf8"),
  ).changes as {
    approvedBy: string | null;
    reason: string;
    export?: string;
    entry?: string;
    name?: string;
  }[];
  const pending = apiChanges.filter((c) => !c.approvedBy);
  if (pending.length > 0) {
    console.log(
      `[census] pending approvals (Jason signs at the Phase 0 gate): ${pending.length}`,
    );
    for (const c of pending) {
      console.log(`  - ${c.export ?? `${c.entry} ${c.name}`}: ${c.reason}`);
    }
  }
}
console.log(`[census] fuzz: ${fuzzRuns.map(describeFuzzRun).join("; ")}`);
console.log(
  v2Layer === null
    ? "[census] v2: no layer built yet (layers.rules.json `current` is null); v2 runs nothing"
    : `[census] v2: core-next runs every port up to ${v2Layer} (conformance:v2, conformance:v2:prod) and the diff scenarios up to ${v2Layer}`,
);
