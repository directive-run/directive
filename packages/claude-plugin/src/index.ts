/**
 * Programmatic API for `@directive-run/claude-plugin`.
 *
 * The canonical install path for end users is Claude Code's plugin
 * marketplace (`/plugin marketplace add directive-run/directive`
 * then `/plugin install directive@directive-plugins`). This module
 * is the alternative install path for tool authors who want to
 * consume the skill bundles programmatically — custom skill
 * registries, doc-generation pipelines, eval harnesses, or AI
 * orchestrators that want to expose Directive skills via their own
 * routing layer.
 *
 * The package ships the pre-built skill bundles in `skills/`. This
 * module exposes them as functions: list the skills, read a SKILL.md,
 * read a supporting knowledge file, or grab the whole skill tree.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");

/**
 * Resolve a path relative to the package root. Tries the published
 * layout (`dist/` sibling of `skills/`) first, then the dev layout
 * (running from `src/` in the monorepo).
 */
function resolveAsset(name: string): string {
  const fromDist = join(PKG_ROOT, name);
  if (existsSync(fromDist)) {
    return fromDist;
  }

  const fromSrc = join(PKG_ROOT, "..", name);
  if (existsSync(fromSrc)) {
    return fromSrc;
  }

  return fromDist;
}

const SKILLS_DIR = resolveAsset("skills");

/**
 * One bundled skill — the `SKILL.md` plus its supporting knowledge
 * files (which are copied in from `@directive-run/knowledge` at
 * build time) and the auto-generated `examples.md` when present.
 */
export interface Skill {
  /** Skill name (matches the directory under `skills/`). */
  name: string;
  /** Full `SKILL.md` contents — the Claude-facing skill manifest. */
  manifest: string;
  /** Supporting files keyed by base name (no `.md` suffix). */
  files: Map<string, string>;
}

let skillCache: Map<string, Skill> | null = null;

function loadSkills(): Map<string, Skill> {
  if (skillCache) {
    return skillCache;
  }

  const cache = new Map<string, Skill>();
  let entries: string[];
  try {
    entries = readdirSync(SKILLS_DIR);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      skillCache = cache;
      return cache;
    }
    throw err;
  }

  for (const name of entries) {
    const dir = join(SKILLS_DIR, name);
    if (!statSync(dir).isDirectory()) {
      continue;
    }

    const manifestPath = join(dir, "SKILL.md");
    if (!existsSync(manifestPath)) {
      continue;
    }

    const manifest = readFileSync(manifestPath, "utf-8");
    const files = new Map<string, string>();
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".md") || file === "SKILL.md") {
        continue;
      }
      const baseName = file.replace(/\.md$/, "");
      files.set(baseName, readFileSync(join(dir, file), "utf-8"));
    }

    cache.set(name, { name, manifest, files });
  }

  skillCache = cache;
  return cache;
}

/**
 * List the names of every bundled skill.
 *
 * Returns an alphabetically-sorted array — stable for snapshot tests.
 */
export function listSkills(): string[] {
  return Array.from(loadSkills().keys()).sort();
}

/**
 * Get a single skill by name.
 *
 * @param name - Skill name (e.g. `"writing-directive-modules"`).
 * @returns The skill, or `undefined` if no skill by that name exists.
 */
export function getSkill(name: string): Skill | undefined {
  return loadSkills().get(name);
}

/**
 * Get every bundled skill, keyed by name.
 *
 * Returns a defensive copy — mutating the returned Map won't affect
 * subsequent calls.
 */
export function getAllSkills(): Map<string, Skill> {
  return new Map(loadSkills());
}

/**
 * Read one supporting file from a skill bundle.
 *
 * @param skillName - Skill name (e.g. `"writing-directive-modules"`).
 * @param fileName - Supporting file base name without `.md`
 *   (e.g. `"core-patterns"`, `"anti-patterns"`, `"examples"`).
 * @returns File contents, or `undefined` if the skill or file is not
 *   present.
 */
export function getSkillFile(
  skillName: string,
  fileName: string,
): string | undefined {
  return loadSkills().get(skillName)?.files.get(fileName);
}

/**
 * Clear the in-memory skill cache. Useful in tests or watch-mode
 * tooling that regenerates the `skills/` directory between calls.
 */
export function clearCache(): void {
  skillCache = null;
}
