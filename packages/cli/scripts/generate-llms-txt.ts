/**
 * Write `dist/llms.txt` for the published package.
 *
 * The package has long declared `./llms.txt` as an export and `llms` as a
 * metadata field, both pointing at `dist/llms.txt` — a file nothing wrote. An
 * install therefore resolved the export to something that was not there, which
 * fails at the consumer rather than here.
 *
 * This runs after tsup rather than before it, because the first tsup config
 * cleans `dist` and would delete anything written ahead of it. Sequencing lives
 * in the package's `build` script, matching how the knowledge and mcp packages
 * order their own generators.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateLlmsTxt } from "../src/templates/llms-txt.js";

/** Well under the real size, but far above anything an empty render produces. */
const MINIMUM_PLAUSIBLE_BYTES = 1024;

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = join(packageRoot, "dist", "llms.txt");

const contents = generateLlmsTxt();

// The bug being fixed is an export pointing at a file that was never written.
// Writing an empty file instead would satisfy the path and reproduce the same
// failure one step later, so the size is checked rather than assumed.
if (contents.length < MINIMUM_PLAUSIBLE_BYTES) {
  throw new Error(
    `generate-llms-txt: refusing to write ${contents.length} bytes to ${outputPath}. The knowledge base or examples resolved to nothing, which would ship an export that exists but says nothing.`,
  );
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, contents, "utf-8");

console.log(
  `llms.txt: ${contents.length.toLocaleString()} bytes -> ${outputPath}`,
);
