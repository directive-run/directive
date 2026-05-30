/**
 * Bundle-size budget enforcer for the publish-time entries that ship to npm.
 *
 * Reads `size-budgets.json` at the repo root, gzips each listed file with the
 * default zlib level, and prints a budget vs actual table. Exits 1 if any
 * entry busts its budget so CI fails noisily instead of silently letting
 * adapters grow.
 *
 * Run after `pnpm build`:
 *   tsx scripts/size-check.ts
 *
 * Add new budgets by editing `size-budgets.json`. Each entry is a path
 * relative to the repo root plus a `gzBudget` in bytes.
 */

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

interface Budget {
  path: string;
  gzBudget: number;
}

interface BudgetFile {
  budgets: Budget[];
}

const REPO_ROOT = join(__dirname, "..");
const BUDGET_FILE = join(REPO_ROOT, "size-budgets.json");

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function check(): number {
  const raw = readFileSync(BUDGET_FILE, "utf-8");
  const parsed = JSON.parse(raw) as BudgetFile;
  const budgets = parsed.budgets;

  let failed = 0;
  const rows: Array<{
    path: string;
    raw: string;
    gz: string;
    budget: string;
    delta: string;
    status: string;
  }> = [];

  for (const b of budgets) {
    const abs = join(REPO_ROOT, b.path);
    let rawBytes: number;
    let gzBytes: number;

    try {
      rawBytes = statSync(abs).size;
      const buf = readFileSync(abs);
      gzBytes = gzipSync(buf).byteLength;
    } catch (err) {
      console.error(`[size-check] missing artifact: ${b.path}`);
      console.error("  hint: run `pnpm build` first");
      failed++;
      continue;
    }

    const delta = gzBytes - b.gzBudget;
    const pass = gzBytes <= b.gzBudget;
    if (!pass) {
      failed++;
    }

    rows.push({
      path: b.path,
      raw: fmt(rawBytes),
      gz: fmt(gzBytes),
      budget: fmt(b.gzBudget),
      delta: (delta > 0 ? "+" : "") + fmt(delta),
      status: pass ? "✓" : "✗",
    });
  }

  // Print a simple aligned table.
  const widths = {
    path: Math.max(4, ...rows.map((r) => r.path.length)),
    raw: Math.max(3, ...rows.map((r) => r.raw.length)),
    gz: Math.max(2, ...rows.map((r) => r.gz.length)),
    budget: Math.max(6, ...rows.map((r) => r.budget.length)),
    delta: Math.max(5, ...rows.map((r) => r.delta.length)),
  };

  const header = `  ${"path".padEnd(widths.path)}  ${"raw".padStart(widths.raw)}  ${"gz".padStart(widths.gz)}  ${"budget".padStart(widths.budget)}  ${"delta".padStart(widths.delta)}  status`;
  console.log(header);
  console.log(`  ${"-".repeat(header.length - 2)}`);
  for (const r of rows) {
    console.log(
      `  ${r.path.padEnd(widths.path)}  ${r.raw.padStart(widths.raw)}  ${r.gz.padStart(widths.gz)}  ${r.budget.padStart(widths.budget)}  ${r.delta.padStart(widths.delta)}  ${r.status}`,
    );
  }

  console.log("");
  if (failed > 0) {
    console.error(
      `[size-check] ${failed} of ${budgets.length} entries over budget`,
    );
    console.error(
      "  hint: investigate the regression, or raise the budget in size-budgets.json if intentional",
    );

    return 1;
  }
  console.log(`[size-check] ${budgets.length} entries within budget`);

  return 0;
}

process.exit(check());
