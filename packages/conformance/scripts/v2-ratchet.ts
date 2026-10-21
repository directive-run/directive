/**
 * The v2 ratchet (lib/ratchet.ts): run core-next's source and dist projects
 * with the layer gate opened, then fail if any test in v2-passing.json no
 * longer passes on either.
 *
 * Usage:
 *   pnpm --filter @directive-run/conformance ratchet            # check
 *   pnpm --filter @directive-run/conformance ratchet --update   # also add
 *     every test that now passes on source and dist (never removes one)
 *
 * Tests above `current` are expected to fail here; only the listed ones must
 * pass. The census, not this, decides that every test at or below `current`
 * passes.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { JsonReport } from "../lib/census.js";
import { defaultRepoRoot } from "../lib/core-entries.js";
import {
  type Passed,
  RATCHET_FILE,
  RATCHET_RUN,
  type Ratchet,
  checkRatchet,
  checkShape,
  grow,
  passedIn,
} from "../lib/ratchet.js";

const repoRoot = defaultRepoRoot;
const conformanceRoot = join(repoRoot, "packages/conformance");
const update = process.argv.includes("--update");
const ratchetPath = join(conformanceRoot, RATCHET_FILE);
const ratchet = JSON.parse(readFileSync(ratchetPath, "utf8")) as Ratchet;
const layers = JSON.parse(
  readFileSync(join(conformanceRoot, "layers.json"), "utf8"),
);

const failures: string[] = [...checkShape(ratchet, layers)];
const passed: Passed = {};
const out = mkdtempSync(join(tmpdir(), "conformance-ratchet-"));
try {
  for (const project of RATCHET_RUN) {
    const file = join(out, `${project.replace(/:/g, "_")}.json`);
    // Failures above `current` are expected: the exit status says nothing.
    spawnSync(
      join(conformanceRoot, "node_modules/.bin/vitest"),
      [
        "run",
        "--config",
        "vitest.config.ts",
        "--project",
        project,
        "--reporter=dot",
        "--reporter=json",
        `--outputFile.json=${file}`,
      ],
      {
        cwd: conformanceRoot,
        stdio: ["ignore", "ignore", "inherit"],
        env: { ...process.env, DIRECTIVE_V2_ALL: "1" },
      },
    );
    try {
      const report = JSON.parse(readFileSync(file, "utf8")) as JsonReport;
      if (report.testResults.length === 0) {
        failures.push(`${project}: the report lists no files`);
      }
      passed[project] = passedIn(report, conformanceRoot);
    } catch {
      failures.push(`${project}: no JSON report`);
    }
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}

failures.push(...checkRatchet(ratchet, passed));
const { next, added } = grow(ratchet, passed);
const count = (r: Ratchet) =>
  Object.values(r.tests).reduce(
    (n, files) => n + Object.values(files).reduce((m, t) => m + t.length, 0),
    0,
  );

if (update && failures.length === 0) {
  writeFileSync(ratchetPath, `${JSON.stringify(next, null, 2)}\n`);
  execFileSync(
    join(repoRoot, "node_modules/.bin/biome"),
    ["check", "--write", relative(repoRoot, ratchetPath)],
    { cwd: repoRoot, stdio: "inherit" },
  );
  console.log(
    `[ratchet] added ${added}; ${RATCHET_FILE} now holds ${count(next)} tests`,
  );
}

for (const failure of failures) {
  console.error(`✗ ${failure}`);
}
if (failures.length > 0) {
  console.error(`\n[ratchet] ${failures.length} problem(s)`);
  process.exit(1);
}
console.log(
  `[ratchet] ${count(update ? next : ratchet)} tests core-next passed still pass on source and dist${
    !update && added > 0
      ? `; ${added} more pass now — run \`ratchet --update\` to keep them`
      : ""
  }`,
);
