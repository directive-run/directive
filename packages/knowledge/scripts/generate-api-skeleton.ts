/**
 * Generate a compact api-skeleton.md from the website's api-reference.json.
 *
 * This produces a condensed reference of all public exports from
 * @directive-run/core and @directive-run/ai — function names, key type
 * signatures, and brief descriptions. Used by knowledge validation and
 * templates to verify symbol references.
 *
 * Run: tsx scripts/generate-api-skeleton.ts
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "../../../scripts/lib/log";

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(
  __dirname,
  "..",
  "..",
  "..",
  "website",
  "docs",
  "generated",
  "api-reference.json",
);
const OUTPUT = join(__dirname, "..", "api-skeleton.md");

interface ApiDocEntry {
  name: string;
  kind: string;
  module?: string;
  description?: string;
  signature?: string;
  params?: Array<{ name: string; type: string; description?: string }>;
  returns?: { type: string; description?: string };
  methods?: Array<{
    name: string;
    signature?: string;
    description?: string;
  }>;
}

function main() {
  const PHASE = "Generate API Skeleton";
  log.header(PHASE);

  if (!existsSync(JSON_PATH)) {
    log.warn("api-reference.json not found — generating placeholder");
    writeFileSync(
      OUTPUT,
      "# API Skeleton\n\n> Auto-generated. Do not edit.\n\n> Source JSON not found. Build website docs first.\n",
      "utf-8",
    );
    log.done(PHASE);

    return;
  }

  const raw = readFileSync(JSON_PATH, "utf-8");
  const entries: ApiDocEntry[] = JSON.parse(raw);

  log.reads(["docs/generated/api-reference.json"]);
  log.item(`${entries.length} entries`);

  const coreEntries: ApiDocEntry[] = [];
  const aiEntries: ApiDocEntry[] = [];

  for (const entry of entries) {
    const mod = entry.module ?? "";
    if (mod.includes("/ai")) {
      aiEntries.push(entry);
    } else {
      coreEntries.push(entry);
    }
  }

  log.step(`Condensing ${coreEntries.length} core + ${aiEntries.length} ai symbols...`);

  const lines: string[] = [
    "# API Skeleton",
    "",
    "> Auto-generated from api-reference.json. Do not edit manually.",
    "> Validated in CI — if this file is stale, run `pnpm --filter @directive-run/knowledge generate`.",
    "",
  ];

  lines.push("## @directive-run/core", "");
  lines.push(...formatEntries(coreEntries));

  lines.push("", "## @directive-run/ai", "");
  lines.push(...formatEntries(aiEntries));

  const output = lines.join("\n") + "\n";
  writeFileSync(OUTPUT, output, "utf-8");

  const size = `${(Buffer.byteLength(output) / 1024).toFixed(0)} KB`;
  log.writes("packages/knowledge/api-skeleton.md", size);

  log.done(PHASE);
}

function formatEntries(entries: ApiDocEntry[]): string[] {
  const lines: string[] = [];

  const grouped: Record<string, ApiDocEntry[]> = {};
  for (const entry of entries) {
    const kind = entry.kind || "other";
    if (!grouped[kind]) {
      grouped[kind] = [];
    }
    grouped[kind].push(entry);
  }

  const kindOrder = [
    "function",
    "class",
    "interface",
    "type",
    "variable",
    "const",
    "enum",
    "other",
  ];

  for (const kind of kindOrder) {
    const group = grouped[kind];
    if (!group || group.length === 0) {
      continue;
    }

    const heading =
      kind === "function"
        ? "Functions"
        : kind === "interface"
          ? "Interfaces"
          : kind === "type"
            ? "Types"
            : kind === "class"
              ? "Classes"
              : kind === "variable" || kind === "const"
                ? "Constants"
                : kind.charAt(0).toUpperCase() + kind.slice(1);

    lines.push(`### ${heading}`, "");

    for (const entry of group) {
      const desc = entry.description
        ? ` — ${entry.description.split("\n")[0]?.trim()}`
        : "";
      lines.push(`- \`${entry.name}\`${desc}`);

      if (entry.signature) {
        const sig = entry.signature.split("\n")[0]?.trim();
        if (sig && sig.length < 120) {
          lines.push(`  \`\`\`ts\n  ${sig}\n  \`\`\``);
        }
      }
    }

    lines.push("");
  }

  return lines;
}

main();
