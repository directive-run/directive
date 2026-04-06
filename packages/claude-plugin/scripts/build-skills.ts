/**
 * Build skill directories from knowledge package + hand-authored templates.
 *
 * For each skill:
 * 1. Copy the SKILL.md template from templates/
 * 2. Copy referenced knowledge .md files from @directive-run/knowledge
 * 3. Generate examples.md from relevant extracted examples
 *
 * Run: tsx scripts/build-skills.ts
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "../../../scripts/lib/log";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, "..");
const SKILLS_DIR = join(PKG_ROOT, "skills");
const TEMPLATES_DIR = join(PKG_ROOT, "templates");

// Knowledge package paths (workspace dependency)
const KNOWLEDGE_PKG = join(PKG_ROOT, "..", "knowledge");
const CORE_DIR = join(KNOWLEDGE_PKG, "core");
const AI_DIR = join(KNOWLEDGE_PKG, "ai");
const EXAMPLES_DIR = join(KNOWLEDGE_PKG, "examples");

interface SkillConfig {
  /** Skill directory name (must match template file name) */
  name: string;
  /** Knowledge files to copy into skill dir (without .md extension) */
  knowledgeFiles: string[];
  /** Example names to include in examples.md (without .ts extension) */
  examples?: string[];
}

const SKILL_MAP: SkillConfig[] = [
  {
    name: "getting-started-with-directive",
    knowledgeFiles: ["api-skeleton", "core-patterns", "sitemap"],
    examples: ["counter"],
  },
  {
    name: "writing-directive-modules",
    knowledgeFiles: ["api-skeleton", "core-patterns", "schema-types", "naming", "anti-patterns"],
    examples: ["counter", "contact-form", "newsletter", "feature-flags", "shopping-cart", "form-wizard"],
  },
  {
    name: "writing-directive-constraints",
    knowledgeFiles: ["api-skeleton", "constraints", "resolvers", "error-boundaries"],
    examples: ["auth-flow", "async-chains", "debounce-constraints", "batch-resolver", "error-boundaries"],
  },
  {
    name: "building-directive-systems",
    knowledgeFiles: ["api-skeleton", "multi-module", "system-api", "plugins", "react-adapter"],
    examples: ["multi-module", "dynamic-modules", "theme-locale", "permissions", "notifications", "dashboard-loader", "pagination", "url-sync", "websocket", "server", "optimistic-updates", "ab-testing", "sudoku"],
  },
  {
    name: "testing-directive-code",
    knowledgeFiles: ["api-skeleton", "testing", "history"],
    examples: ["time-machine"],
  },
  {
    name: "building-ai-orchestrators",
    knowledgeFiles: ["api-skeleton", "ai-orchestrator", "ai-multi-agent", "ai-tasks"],
    examples: ["checkers", "goal-heist", "fraud-analysis"],
  },
  {
    name: "building-ai-agents",
    knowledgeFiles: ["api-skeleton", "ai-agents-streaming", "ai-adapters", "ai-communication"],
    examples: ["ai-checkpoint", "provider-routing"],
  },
  {
    name: "hardening-ai-systems",
    knowledgeFiles: ["api-skeleton", "ai-guardrails-memory", "ai-budget-resilience", "ai-security"],
    examples: ["ai-guardrails", "topic-guard"],
  },
  {
    name: "testing-ai-systems",
    knowledgeFiles: ["api-skeleton", "ai-testing-evals", "ai-debug-observability", "ai-mcp-rag"],
    examples: ["ai-orchestrator", "fraud-analysis"],
  },
  {
    name: "reviewing-directive-code",
    knowledgeFiles: ["api-skeleton", "anti-patterns", "core-patterns", "naming"],
    examples: ["counter", "auth-flow"],
  },
  {
    name: "scaffolding-directive-modules",
    knowledgeFiles: ["api-skeleton", "core-patterns", "schema-types", "naming"],
    examples: ["counter", "auth-flow", "shopping-cart", "dashboard-loader"],
  },
  {
    name: "migrating-to-directive",
    knowledgeFiles: ["api-skeleton", "core-patterns", "schema-types", "anti-patterns"],
    examples: ["counter", "shopping-cart"],
  },
];

function findKnowledgeFile(name: string): string | null {
  // Check package root first (e.g., api-skeleton.md)
  const rootPath = join(KNOWLEDGE_PKG, `${name}.md`);
  if (existsSync(rootPath)) {
    return rootPath;
  }

  const corePath = join(CORE_DIR, `${name}.md`);
  if (existsSync(corePath)) {
    return corePath;
  }

  const aiPath = join(AI_DIR, `${name}.md`);
  if (existsSync(aiPath)) {
    return aiPath;
  }

  return null;
}

function buildExamplesMd(examples: string[]): string {
  const lines: string[] = [
    "# Examples",
    "",
    "> Auto-generated from extracted examples. Do not edit manually.",
    "",
  ];

  for (const name of examples) {
    const examplePath = join(EXAMPLES_DIR, `${name}.ts`);
    if (!existsSync(examplePath)) {
      log.warn(`Example not found: ${name}.ts`);
      continue;
    }

    const content = readFileSync(examplePath, "utf-8");
    lines.push(`## ${name}`, "", "```typescript", content.trimEnd(), "```", "");
  }

  return lines.join("\n");
}

function buildSkill(config: SkillConfig): void {
  const skillDir = join(SKILLS_DIR, config.name);

  // Clean and recreate
  if (existsSync(skillDir)) {
    rmSync(skillDir, { recursive: true });
  }
  mkdirSync(skillDir, { recursive: true });

  // 1. Copy SKILL.md template
  const templatePath = join(TEMPLATES_DIR, `${config.name}.md`);
  if (!existsSync(templatePath)) {
    log.warn(`Template not found: ${config.name}.md — creating placeholder`);
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---\nname: ${config.name}\ndescription: TODO\n---\n\n# ${config.name}\n\nTODO: Add content\n`,
      "utf-8",
    );
  } else {
    const template = readFileSync(templatePath, "utf-8");
    writeFileSync(join(skillDir, "SKILL.md"), template, "utf-8");
  }

  // 2. Copy knowledge files
  for (const name of config.knowledgeFiles) {
    const srcPath = findKnowledgeFile(name);
    if (!srcPath) {
      log.warn(`Knowledge file not found: ${name}.md`);
      continue;
    }
    writeFileSync(
      join(skillDir, `${name}.md`),
      readFileSync(srcPath, "utf-8"),
      "utf-8",
    );
  }

  // 3. Generate examples.md if examples specified
  if (config.examples && config.examples.length > 0) {
    const examplesMd = buildExamplesMd(config.examples);
    writeFileSync(join(skillDir, "examples.md"), examplesMd, "utf-8");
  }

  // Count files
  const fileCount = readdirSync(skillDir).length;
  log.item(config.name, `${fileCount} files`);
}

function main() {
  const PHASE = "Build Claude Code Skills";
  log.header(PHASE);

  // Validate knowledge package exists
  if (!existsSync(CORE_DIR)) {
    log.error(`Knowledge package not found at ${KNOWLEDGE_PKG}`);
    log.error("Run: pnpm --filter @directive-run/knowledge build");
    process.exit(1);
  }

  log.reads([
    "knowledge/core/",
    "knowledge/ai/",
    "knowledge/examples/",
    "knowledge/api-skeleton.md",
  ]);

  // Clean skills dir
  mkdirSync(SKILLS_DIR, { recursive: true });

  log.step(`Building ${SKILL_MAP.length} skills...`);

  for (const config of SKILL_MAP) {
    buildSkill(config);
  }

  log.writes(`claude-plugin/skills/`, `${SKILL_MAP.length} directories`);
  log.done(PHASE);
}

main();
