/**
 * Prove the port changed nothing a test asserts, and that nothing on disk
 * was edited after the port wrote it. See lib/check.ts for the full list.
 *
 * Usage: pnpm --filter @directive-run/conformance check:expects
 */

import { check } from "../lib/check.js";
import { defaultRepoRoot } from "../lib/core-entries.js";

const result = check(defaultRepoRoot);
for (const failure of result.failures) {
  console.error(`✗ ${failure}`);
}
if (result.failures.length > 0) {
  console.error(
    `\n[check-expects] ${result.failures.length} problem(s) across ${result.files} files`,
  );
  process.exit(1);
}
console.log(
  `[check-expects] ${result.files} files, ${result.assertions} assertions: identical to a fresh port`,
);
