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

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

/**
 * Parse `knowledgeFiles: [a, b, c]` and `examples: [x, y]` arrays from a
 * template's YAML frontmatter without pulling in a yaml dependency. The
 * arrays must be inline (single-line) for the regex to match.
 *
 * Returns `null` for `knowledgeFiles` when the field is absent — the
 * caller falls back to the legacy `SKILL_MAP` entry in that case.
 */
function parseFrontmatterArrays(template: string): {
  knowledgeFiles: string[] | null;
  examples: string[] | null;
} {
  const fmMatch = template.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return { knowledgeFiles: null, examples: null };
  const fm = fmMatch[1] ?? "";
  const parseArray = (field: string): string[] | null => {
    const m = fm.match(new RegExp(`^${field}:\\s*\\[([^\\]]*)\\]`, "m"));
    if (!m) return null;
    return (m[1] ?? "")
      .split(",")
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
  };
  return {
    knowledgeFiles: parseArray("knowledgeFiles"),
    examples: parseArray("examples"),
  };
}

/**
 * Strip the build-only `knowledgeFiles` and `examples` lines from a
 * template before writing it to `SKILL.md`. Claude only needs the
 * `name` / `description` fields; the others are scaffold metadata
 * that lives next to the template purely so adding a knowledge file
 * is a one-place edit.
 */
function stripBuildFrontmatter(template: string): string {
  return template.replace(/^(knowledgeFiles|examples):.*$\n?/gm, "");
}

/**
 * Discover skills by listing `templates/*.md`. Each template owns its
 * `knowledgeFiles` and `examples` arrays in its YAML frontmatter, so
 * adding a knowledge file is a one-place edit (the template) instead of
 * touching the knowledge package, the template, AND a SKILL_MAP entry.
 */
function discoverSkills(): SkillConfig[] {
  return readdirSync(TEMPLATES_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((file) => {
      const name = file.replace(/\.md$/, "");
      const template = readFileSync(join(TEMPLATES_DIR, file), "utf-8");
      const fm = parseFrontmatterArrays(template);
      return {
        name,
        knowledgeFiles: fm.knowledgeFiles ?? [],
        examples: fm.examples ?? undefined,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

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

function buildSkill(baseConfig: SkillConfig): void {
  const skillDir = join(SKILLS_DIR, baseConfig.name);

  // Clean and recreate
  if (existsSync(skillDir)) {
    rmSync(skillDir, { recursive: true });
  }
  mkdirSync(skillDir, { recursive: true });

  // 1. Copy SKILL.md template
  const templatePath = join(TEMPLATES_DIR, `${baseConfig.name}.md`);
  let config = baseConfig;
  if (!existsSync(templatePath)) {
    log.warn(
      `Template not found: ${baseConfig.name}.md — creating placeholder`,
    );
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---\nname: ${baseConfig.name}\ndescription: TODO\n---\n\n# ${baseConfig.name}\n\nTODO: Add content\n`,
      "utf-8",
    );
  } else {
    const template = readFileSync(templatePath, "utf-8");
    // Frontmatter `knowledgeFiles` / `examples` arrays override the
    // legacy `SKILL_MAP` entry. The build-only fields are stripped from
    // the `SKILL.md` that ships to the skill directory so Claude only
    // sees the Claude-facing frontmatter (`name`, `description`).
    const fm = parseFrontmatterArrays(template);
    if (fm.knowledgeFiles) {
      config = { ...config, knowledgeFiles: fm.knowledgeFiles };
    }
    if (fm.examples) {
      config = { ...config, examples: fm.examples };
    }
    writeFileSync(
      join(skillDir, "SKILL.md"),
      stripBuildFrontmatter(template),
      "utf-8",
    );
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

  const skills = discoverSkills();
  log.step(`Building ${skills.length} skills...`);

  for (const config of skills) {
    buildSkill(config);
  }

  log.writes("claude-plugin/skills/", `${skills.length} directories`);
  log.done(PHASE);
}

main();
