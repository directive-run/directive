/**
 * Bundle-size budget enforcer for the publish-time entries that ship to npm.
 *
 * Reads `size-budgets.json` at the repo root, measures each listed entry, and
 * prints a budget vs actual table. Exits 1 if any entry busts its budget so CI
 * fails noisily instead of silently letting the runtime grow.
 *
 * **What gets measured.** The entry file *and everything it imports*, gzipped
 * together. Not the entry file alone — that was the original shape of this
 * script and it measured almost nothing. tsup splits shared code into
 * `chunk-*.js` siblings, and none of those were listed, so the guard watched
 * `packages/core/dist/index.js` at 12 KB gz while the engine sat in unlisted
 * chunks totalling 61 KB gz. Four fifths of what an `import` actually costs was
 * unwatched, and adding the chunk filenames by hand is not a fix: they are
 * content-hashed, so they are renamed by the next build that changes anything.
 *
 * The closure is walked from the entry rather than globbed from the directory,
 * because a `dist/` holds several independent entries and their chunks; only
 * the reachable set belongs to a given budget. Shared chunks are therefore
 * counted once per entry that reaches them, which for a regression guard is the
 * behavior you want — a chunk that grows should bust every entry pulling it in.
 *
 * The number is a ceiling, not a prediction: a consumer's bundler tree-shakes
 * what they don't call, so their real cost is lower. What the ceiling is good
 * for is moving when the code moves, which the entry file alone did not.
 *
 * Run after `pnpm build`:
 *   tsx scripts/size-check.ts
 *
 * Add new budgets by editing `size-budgets.json`. Each entry is a path
 * relative to the repo root plus a `gzBudget` in bytes.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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

/**
 * Relative import and re-export specifiers in an emitted ESM file.
 *
 * Matches `from './x.js'` and bare `import './x.js'` under either quote style —
 * the build minifies away the space after `from`, so a pattern requiring one
 * finds nothing. Only relative specifiers are followed: a bare specifier is a
 * package dependency and not part of this artifact's weight.
 */
const RELATIVE_SPECIFIER = /(?:from|import)\s*["'](\.[^"']+)["']/g;

/**
 * Every emitted file reachable from an entry, the entry included.
 *
 * Static specifiers only. A dynamic `import()` of a computed path is not
 * resolvable here, and none of these builds emit one — if that changes, this
 * would under-count and the miss would be silent, so the closure size is
 * printed in the table as `files` where a sudden drop is visible.
 */
function closure(entryAbs: string): string[] {
  const seen = new Set<string>();
  const queue = [entryAbs];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file) || !existsSync(file)) {
      continue;
    }
    seen.add(file);
    const src = readFileSync(file, "utf-8");
    for (const match of src.matchAll(RELATIVE_SPECIFIER)) {
      queue.push(resolve(dirname(file), match[1]!));
    }
  }

  return [...seen].sort();
}

function check(): number {
  const raw = readFileSync(BUDGET_FILE, "utf-8");
  const parsed = JSON.parse(raw) as BudgetFile;
  const budgets = parsed.budgets;

  let failed = 0;
  const rows: Array<{
    path: string;
    files: string;
    raw: string;
    gz: string;
    budget: string;
    delta: string;
    status: string;
  }> = [];

  for (const b of budgets) {
    const abs = join(REPO_ROOT, b.path);
    let fileCount: number;
    let rawBytes: number;
    let gzBytes: number;

    try {
      if (!existsSync(abs)) {
        throw new Error("entry missing");
      }
      const files = closure(abs);
      const buffers = files.map((f) => readFileSync(f));
      // Gzipped as one buffer rather than summed per file: a bundler
      // concatenates before it compresses, and per-file sums overstate by
      // denying the shared dictionary its repeats.
      const combined = Buffer.concat(buffers);
      fileCount = files.length;
      rawBytes = combined.byteLength;
      gzBytes = gzipSync(combined).byteLength;
    } catch {
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
      files: String(fileCount),
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
    files: Math.max(5, ...rows.map((r) => r.files.length)),
    raw: Math.max(3, ...rows.map((r) => r.raw.length)),
    gz: Math.max(2, ...rows.map((r) => r.gz.length)),
    budget: Math.max(6, ...rows.map((r) => r.budget.length)),
    delta: Math.max(5, ...rows.map((r) => r.delta.length)),
  };

  const header = `  ${"path".padEnd(widths.path)}  ${"files".padStart(widths.files)}  ${"raw".padStart(widths.raw)}  ${"gz".padStart(widths.gz)}  ${"budget".padStart(widths.budget)}  ${"delta".padStart(widths.delta)}  status`;
  console.log(header);
  console.log(`  ${"-".repeat(header.length - 2)}`);
  for (const r of rows) {
    console.log(
      `  ${r.path.padEnd(widths.path)}  ${r.files.padStart(widths.files)}  ${r.raw.padStart(widths.raw)}  ${r.gz.padStart(widths.gz)}  ${r.budget.padStart(widths.budget)}  ${r.delta.padStart(widths.delta)}  ${r.status}`,
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
