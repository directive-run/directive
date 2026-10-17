/**
 * Write the frozen 1.35 contracts from the published 1.35.0 (`directive-v1`):
 * `contracts/api-surface.json` from its declarations and
 * `contracts/golden/*` from its runtime.
 *
 * Run only when the reference itself moves (the v1 pin rule). Every file it
 * writes is in harness.lock.json, so committing the result needs
 * `oracle:update` and the oracle-change label.
 *
 * Usage: pnpm --filter @directive-run/conformance contracts:freeze
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultRepoRoot, v1PackageDir } from "../../lib/core-entries.js";
import { GOLDEN_FILES, loadEngine, produce } from "../lib/golden.js";
import { extractSurface } from "../lib/surface.js";

const contracts = join(defaultRepoRoot, "packages/conformance/contracts");

writeFileSync(
  join(contracts, "api-surface.json"),
  `${JSON.stringify(extractSurface(v1PackageDir), null, 2)}\n`,
);

const goldens = await produce(await loadEngine("v1"));
mkdirSync(join(contracts, "golden"), { recursive: true });
for (const f of GOLDEN_FILES) {
  writeFileSync(join(contracts, "golden", f), goldens[f]);
}
console.log("[contracts] wrote api-surface.json and golden/ from 1.35.0");
