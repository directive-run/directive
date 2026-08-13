import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateLlmsTxt } from "../src/templates/llms-txt.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = join(packageRoot, "dist", "llms.txt");

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, generateLlmsTxt());
