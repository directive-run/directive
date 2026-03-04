import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import pc from "picocolors";
import { getAllExamples, getExample, getExampleFiles } from "../lib/knowledge.js";

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const CATEGORIES: Record<string, string[]> = {
  "Getting Started": ["counter", "contact-form", "auth-flow"],
  "Core Patterns": [
    "async-chains",
    "batch-resolver",
    "debounce-constraints",
    "error-boundaries",
    "feature-flags",
    "multi-module",
    "optimistic-updates",
    "pagination",
    "permissions",
  ],
  "Real-World": [
    "dashboard-loader",
    "form-wizard",
    "newsletter",
    "notifications",
    "shopping-cart",
    "theme-locale",
    "url-sync",
    "websocket",
    "server",
  ],
  Games: ["checkers", "sudoku", "goal-heist", "ab-testing"],
  AI: [
    "ai-orchestrator",
    "ai-checkpoint",
    "ai-guardrails",
    "fraud-analysis",
    "provider-routing",
    "topic-guard",
    "dynamic-modules",
    "time-machine",
  ],
};

function getCategory(name: string): string {
  for (const [cat, names] of Object.entries(CATEGORIES)) {
    if (names.includes(name)) {
      return cat;
    }
  }

  return "Other";
}

function getDescription(content: string): string {
  // Extract first line comment or jsdoc summary
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    // Match: // Example: name or // Source: ...
    if (trimmed.startsWith("// Example:")) {
      continue;
    }
    if (trimmed.startsWith("// Source:")) {
      continue;
    }
    if (trimmed.startsWith("// Extracted")) {
      continue;
    }

    // Match JSDoc: * Description text
    const jsdocMatch = trimmed.match(/^\*\s+(.+?)(?:\s*\*\/)?$/);
    if (jsdocMatch?.[1] && !jsdocMatch[1].startsWith("@")) {
      return jsdocMatch[1];
    }

    // Match: // Description text
    if (trimmed.startsWith("//") && trimmed.length > 3) {
      return trimmed.slice(2).trim();
    }

    // Stop at first non-comment line
    if (
      trimmed !== "" &&
      !trimmed.startsWith("//") &&
      !trimmed.startsWith("/*") &&
      !trimmed.startsWith("*")
    ) {
      break;
    }
  }

  return "";
}

// ---------------------------------------------------------------------------
// List command
// ---------------------------------------------------------------------------

export async function examplesListCommand(args: string[]) {
  let filter: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--filter") {
      filter = args[++i]?.toLowerCase();
    }
  }

  const examples = getAllExamples();

  console.log();
  console.log(pc.bold(pc.cyan("Directive Examples")));
  console.log(pc.dim("─".repeat(50)));
  console.log();

  // Group by category
  const byCategory = new Map<string, Array<{ name: string; desc: string }>>();

  for (const [name, content] of examples) {
    const cat = getCategory(name);

    if (filter && !cat.toLowerCase().includes(filter) && !name.includes(filter)) {
      continue;
    }

    if (!byCategory.has(cat)) {
      byCategory.set(cat, []);
    }
    byCategory.get(cat)!.push({ name, desc: getDescription(content) });
  }

  if (byCategory.size === 0) {
    console.log(pc.dim("No examples match the filter."));

    return;
  }

  // Print in category order
  const categoryOrder = Object.keys(CATEGORIES);
  const sortedCategories = [...byCategory.keys()].sort(
    (a, b) => (categoryOrder.indexOf(a) ?? 99) - (categoryOrder.indexOf(b) ?? 99),
  );

  for (const cat of sortedCategories) {
    const items = byCategory.get(cat)!;
    console.log(pc.bold(cat));

    for (const item of items) {
      const desc = item.desc ? pc.dim(` — ${item.desc}`) : "";
      console.log(`  ${pc.cyan(item.name)}${desc}`);
    }

    console.log();
  }

  console.log(
    pc.dim(`${examples.size} examples available. Run ${pc.cyan("directive examples copy <name>")} to extract one.`),
  );
}

// ---------------------------------------------------------------------------
// Copy command
// ---------------------------------------------------------------------------

export async function examplesCopyCommand(
  name: string,
  args: string[],
) {
  let dest = process.cwd();

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dest") {
      const val = args[++i];
      if (val) {
        dest = val;
      }
    }
  }

  if (!name) {
    console.error("Usage: directive examples copy <name> [--dest <dir>]");
    process.exit(1);
  }

  const content = getExample(name);

  if (!content) {
    console.error(`Example "${name}" not found.`);
    console.error(
      `Run ${pc.cyan("directive examples list")} to see available examples.`,
    );
    process.exit(1);
  }

  // Rewrite workspace imports to published package names
  const rewritten = content
    .replace(
      /from\s+["']@directive-run\/core\/plugins["']/g,
      'from "@directive-run/core/plugins"',
    )
    .replace(
      /from\s+["']@directive-run\/core["']/g,
      'from "@directive-run/core"',
    )
    .replace(
      /from\s+["']@directive-run\/ai["']/g,
      'from "@directive-run/ai"',
    );

  const filePath = join(dest, `${name}.ts`);

  if (existsSync(filePath)) {
    console.error(`File already exists: ${relative(process.cwd(), filePath)}`);
    process.exit(1);
  }

  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(filePath, rewritten, "utf-8");

  const rel = relative(process.cwd(), filePath);
  console.log(`${pc.green("Copied")} ${pc.cyan(name)} → ${pc.dim(rel)}`);
}
