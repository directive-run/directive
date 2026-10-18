/**
 * Ratchet against `as any` casts on system objects in packages/ai/src.
 *
 * Counts `(system as any)`, `system.facts as any` and the same shape on any
 * identifier containing "system" or "sys". Fails only when the count goes UP
 * past the baseline in `scripts/ai-system-casts-baseline.json`. When the count
 * drops it prints a hint to lower the baseline; it never fails on a drop.
 *
 * Tests (`__tests__`) and comment lines are ignored.
 *
 *   tsx scripts/check-ai-system-casts.ts
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = join(__dirname, "..");
const SRC = join(REPO_ROOT, "packages/ai/src");
const BASELINE_FILE = join(__dirname, "ai-system-casts-baseline.json");

// An identifier containing "system"/"sys", optional member chain, optional
// closing paren, then `as any`.
const CAST = /\b\w*(?:system|System|sys|Sys)\w*(?:\??\.\w+)*\)?\s+as\s+any\b/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "__tests__" && name !== "node_modules") {
        walk(full, out);
      }
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }

  return out;
}

const hits: string[] = [];
for (const file of walk(SRC)) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) {
      return;
    }

    const matches = line.match(CAST);
    for (const m of matches ?? []) {
      hits.push(`${relative(REPO_ROOT, file)}:${i + 1}  ${m}`);
    }
  });
}

const baseline = (
  JSON.parse(readFileSync(BASELINE_FILE, "utf8")) as { count: number }
).count;
const count = hits.length;

console.log(`[ai-system-casts] ${count} (baseline ${baseline})`);

if (count > baseline) {
  for (const h of hits) {
    console.log(`  ${h}`);
  }
  console.error(
    `[ai-system-casts] FAIL: ${count - baseline} new \`as any\` cast(s) on a system object. Type the access instead of casting.`,
  );
  process.exit(1);
}

if (count < baseline) {
  console.log(
    `[ai-system-casts] hint: count dropped. Lower "count" to ${count} in scripts/ai-system-casts-baseline.json to lock it in.`,
  );
}
