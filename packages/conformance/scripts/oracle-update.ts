/**
 * Regenerate the oracle's pins: `oracle-baseline.json` from the current
 * rules and layers, then `harness.lock.json` over the harness (which
 * includes the baseline). A pull request that commits the result needs the
 * oracle-change label.
 *
 * Usage: pnpm --filter @directive-run/conformance oracle:update
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { defaultRepoRoot } from "../lib/core-entries.js";
import { BASELINE_FILE, baselineFrom } from "../lib/guard.js";
import { LOCK_FILE, computeLock } from "../lib/harness.js";

const conformanceRoot = join(defaultRepoRoot, "packages/conformance");
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

writeFileSync(
  join(conformanceRoot, BASELINE_FILE),
  json(baselineFrom(conformanceRoot)),
);
// Format before hashing: `pnpm lint` must never change a locked file.
const biome = (files: string[]) =>
  execFileSync(
    join(defaultRepoRoot, "node_modules/.bin/biome"),
    ["check", "--write", ...files.map((f) => relative(defaultRepoRoot, f))],
    { cwd: defaultRepoRoot, stdio: "inherit" },
  );
biome([conformanceRoot]);

writeFileSync(
  join(conformanceRoot, LOCK_FILE),
  json({
    $comment:
      "sha256 of every harness file (lib/harness.ts). Regenerate with `pnpm --filter @directive-run/conformance oracle:update`; a PR that changes this file needs the oracle-change label.",
    files: computeLock(conformanceRoot),
  }),
);
biome([join(conformanceRoot, LOCK_FILE)]);
console.log(`[oracle-update] wrote ${BASELINE_FILE} and ${LOCK_FILE}`);
