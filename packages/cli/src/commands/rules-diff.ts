/**
 * `directive rules-diff --before <a.json> --after <b.json>`
 *
 * Structural diff between two snapshots of a system's constraint whenSpec
 * map. The "git diff for business rules" — operates on the predicate AST
 * (added / removed clauses, relaxed / tightened numeric thresholds), not
 * on source-text lines.
 *
 * Three output modes:
 *   - human (default): ANSI-colored per-constraint sections with +/-/~/▲/▽
 *   - --json: raw RulesDiffReport
 *   - --markdown: GitHub PR comment friendly Markdown
 *
 * Producing the input files:
 *   1. Capture from a live system: `node -e "import('./your-system.js').then(m => console.log(JSON.stringify(m.system.inspect().constraints)))" > snapshot.json`
 *   2. Or from git refs: `git show <ref>:path/to/snapshot.json > before.json`
 *
 * Either flat `{ id: whenSpec }` map or the inspect() array form is
 * accepted — the core `toRulesMap` adapter normalizes both.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type Change,
  type RulesDiffReport,
  diffRules,
} from "@directive-run/core";
import pc from "picocolors";

interface RulesDiffCliOptions {
  beforePath?: string;
  afterPath?: string;
  json: boolean;
  markdown: boolean;
}

function parseArgs(args: string[]): RulesDiffCliOptions {
  const opts: RulesDiffCliOptions = { json: false, markdown: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--before":
      case "-b": {
        const val = args[++i];
        if (val) opts.beforePath = val;
        break;
      }
      case "--after":
      case "-a": {
        const val = args[++i];
        if (val) opts.afterPath = val;
        break;
      }
      case "--json":
        opts.json = true;
        break;
      case "--markdown":
      case "--md":
        opts.markdown = true;
        break;
    }
  }

  return opts;
}

function printUsage(): void {
  console.error(`
Usage: directive rules-diff --before <a.json> --after <b.json>

Structural diff between two snapshots of constraint whenSpec. Reports
added / removed clauses and classifies numeric-threshold changes as
relaxed (matches more) or tightened (matches fewer).

Options:
  --before <path>      Baseline whenSpec snapshot (required)
  --after <path>       New whenSpec snapshot (required)
  --json               Emit the full RulesDiffReport as JSON
  --markdown, --md     Emit a GitHub PR-comment friendly Markdown report
  --help               Show this help

Snapshot format — either of:
  { "constraintId": <whenSpec>, ... }                       (flat map)
  [ { "id": "constraintId", "whenSpec": <whenSpec> }, ... ] (inspect() form)
  { "constraints": <one-of-the-above> }                     (wrapped)

Capture a snapshot from a live system:
  node -e "import('./system.js').then(m => console.log(JSON.stringify(m.system.inspect().constraints)))" > before.json

Or pull one from a git ref:
  git show HEAD~1:path/to/snapshot.json > before.json
  git show HEAD:path/to/snapshot.json   > after.json
  directive rules-diff --before before.json --after after.json
`);
}

function readJsonFile(path: string, label: string): unknown {
  const resolved = resolve(path);
  if (!existsSync(resolved)) {
    console.error(pc.red(`error: ${label} file not found: ${resolved}`));
    process.exit(1);
  }
  try {
    return JSON.parse(readFileSync(resolved, "utf8"));
  } catch (err) {
    console.error(
      pc.red(`error: failed to parse ${label} (${resolved}): `) +
        (err as Error).message,
    );
    process.exit(1);
  }
}

// ============================================================================
// Renderers
// ============================================================================

function symbol(kind: Change["kind"]): string {
  switch (kind) {
    case "added":
      return pc.green("+");
    case "removed":
      return pc.red("-");
    case "relaxed":
      return pc.green("▲");
    case "tightened":
      return pc.red("▽");
    default:
      return pc.yellow("~");
  }
}

function describeClause(side?: { op: string; value: unknown }): string {
  if (!side) return "—";
  if (side.op === "$eq") return JSON.stringify(side.value);

  return `${side.op} ${JSON.stringify(side.value)}`;
}

/**
 * Escape a string for safe inclusion in a Markdown table cell. Pipes break
 * the column structure; backticks break inline-code spans; angle brackets
 * are rendered as HTML by GitHub. Newlines are already JSON-escaped to `\n`
 * by `JSON.stringify` upstream, so we don't need to handle them here.
 */
function escapeMd(s: string): string {
  return s
    .replace(/\|/g, "\\|")
    .replace(/`/g, "'")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function printHuman(report: RulesDiffReport): void {
  const { summary, constraints } = report;
  console.log(`\n${pc.bold("rules-diff")} — structural predicate diff\n`);
  console.log(
    `  ${pc.green(`+${summary.added}`)} added   ${pc.red(`-${summary.removed}`)} removed   ${pc.yellow(`~${summary.changed}`)} changed   ${pc.dim(`·${summary.unchanged} unchanged`)}`,
  );
  console.log(
    `  ${summary.totalClauseChanges} clause-level change${summary.totalClauseChanges === 1 ? "" : "s"}\n`,
  );

  for (const c of constraints) {
    if (c.status === "unchanged") {
      continue;
    }

    const badge =
      c.status === "added"
        ? pc.green("ADDED")
        : c.status === "removed"
          ? pc.red("REMOVED")
          : pc.yellow("CHANGED");
    console.log(`  ${pc.bold(c.id)}  ${badge}`);

    for (const change of c.changes) {
      const path = pc.cyan(change.path || "(predicate)");
      const sym = symbol(change.kind);
      if (change.kind === "added") {
        console.log(`    ${sym} ${path}  ${describeClause(change.after)}`);
      } else if (change.kind === "removed") {
        console.log(`    ${sym} ${path}  ${describeClause(change.before)}`);
      } else {
        const tag =
          change.kind === "relaxed"
            ? pc.green("relaxed")
            : change.kind === "tightened"
              ? pc.red("tightened")
              : pc.yellow("changed");
        console.log(
          `    ${sym} ${path}  ${describeClause(change.before)} ${pc.dim("→")} ${describeClause(change.after)}  ${pc.dim(`[${tag}]`)}`,
        );
      }
    }
    console.log("");
  }
}

function printMarkdown(report: RulesDiffReport): void {
  const { summary, constraints } = report;
  console.log("## 📋 Rules diff");
  console.log("");
  console.log(
    `**+${summary.added} added · -${summary.removed} removed · ~${summary.changed} changed · ·${summary.unchanged} unchanged** — ${summary.totalClauseChanges} clause change${summary.totalClauseChanges === 1 ? "" : "s"}`,
  );
  console.log("");

  for (const c of constraints) {
    if (c.status === "unchanged") {
      continue;
    }

    const badge =
      c.status === "added"
        ? "🆕 ADDED"
        : c.status === "removed"
          ? "🗑 REMOVED"
          : "✏️ CHANGED";
    console.log(`### \`${c.id}\` — ${badge}`);
    console.log("");
    console.log("| | path | change |");
    console.log("|---|---|---|");

    for (const change of c.changes) {
      const path = `\`${escapeMd(change.path || "(predicate)")}\``;
      let row: string;
      if (change.kind === "added") {
        row = `| ➕ | ${path} | ${escapeMd(describeClause(change.after))} |`;
      } else if (change.kind === "removed") {
        row = `| ➖ | ${path} | ${escapeMd(describeClause(change.before))} |`;
      } else {
        const tag =
          change.kind === "relaxed"
            ? "▲ relaxed"
            : change.kind === "tightened"
              ? "▽ tightened"
              : "↔ changed";
        row = `| ${tag} | ${path} | ${escapeMd(describeClause(change.before))} → ${escapeMd(describeClause(change.after))} |`;
      }
      console.log(row);
    }
    console.log("");
  }
}

// ============================================================================
// Entrypoint
// ============================================================================

export async function rulesDiffCommand(args: string[]): Promise<void> {
  if (args.includes("--help") || args.length === 0) {
    printUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const opts = parseArgs(args);

  if (!opts.beforePath) {
    console.error(pc.red("error: --before <a.json> is required"));
    printUsage();
    process.exit(1);
  }
  if (!opts.afterPath) {
    console.error(pc.red("error: --after <b.json> is required"));
    printUsage();
    process.exit(1);
  }

  const before = readJsonFile(opts.beforePath, "--before");
  const after = readJsonFile(opts.afterPath, "--after");

  let report: RulesDiffReport;
  try {
    report = diffRules({ before, after });
  } catch (err) {
    console.error(pc.red(`error: ${(err as Error).message}`));
    process.exit(1);
  }

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));

    return;
  }

  if (opts.markdown) {
    printMarkdown(report);

    return;
  }

  printHuman(report);
}
