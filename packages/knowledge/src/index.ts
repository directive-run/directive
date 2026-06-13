import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve package root: works both in src/ (dev) and dist/ (bundled)
const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");

/**
 * Resolve a path relative to the package root.
 * Tries dist-relative first (bundled), then src-relative (dev).
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

  return fromDist; // default, will just return empty maps
}

const CORE_DIR = resolveAsset("core");
const AI_DIR = resolveAsset("ai");
const EXAMPLES_DIR = resolveAsset("examples");
const API_SKELETON_PATH = resolveAsset("api-skeleton.md");

let knowledgeCache: Map<string, string> | null = null;
let exampleCache: Map<string, string> | null = null;

function loadDir(dir: string, map: Map<string, string>): void {
  try {
    const files = readdirSync(dir).filter(
      (f) => f.endsWith(".md") || f.endsWith(".ts"),
    );
    for (const file of files) {
      const name = file.replace(/\.(md|ts)$/, "");
      map.set(name, readFileSync(join(dir, file), "utf-8"));
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
    // directory does not exist — expected during tests or incomplete installs
  }
}

function loadAllKnowledge(): Map<string, string> {
  const map = new Map<string, string>();
  loadDir(CORE_DIR, map);
  loadDir(AI_DIR, map);

  // Include api-skeleton
  try {
    map.set("api-skeleton", readFileSync(API_SKELETON_PATH, "utf-8"));
  } catch {
    // may not exist yet
  }

  return map;
}

function loadAllExamples(): Map<string, string> {
  const map = new Map<string, string>();
  loadDir(EXAMPLES_DIR, map);

  return map;
}

/**
 * Look up a bundled knowledge file by name. Returns the raw markdown
 * string. Returns `""` when the name isn't known — callers driving an
 * LLM should pair this with {@link hasKnowledge} so a typo turns
 * into an actionable error instead of a silently empty prompt.
 *
 * @example
 * ```ts
 * import { getKnowledge, hasKnowledge } from "@directive-run/knowledge";
 *
 * if (!hasKnowledge("guardrails")) throw new Error("typo");
 * const md = getKnowledge("guardrails");
 * ```
 */
export function getKnowledge(name: string): string {
  if (!knowledgeCache) {
    knowledgeCache = loadAllKnowledge();
  }

  return knowledgeCache.get(name) ?? "";
}

/**
 * Return every loaded knowledge file as `name → markdown`. Consumers
 * iterating the corpus (full-text search, embedding builder, RAG
 * index) read this once and key off the returned map.
 */
export function getAllKnowledge(): ReadonlyMap<string, string> {
  if (!knowledgeCache) {
    knowledgeCache = loadAllKnowledge();
  }

  return knowledgeCache;
}

/**
 * `true` when a knowledge file with this exact name is bundled.
 * Use this BEFORE {@link getKnowledge} when the name is user / agent
 * input — `getKnowledge` returns `""` on miss, which is
 * indistinguishable from an intentionally empty file.
 *
 * @example
 * ```ts
 * if (!hasKnowledge(userTyped)) {
 *   console.error(`unknown knowledge file: ${userTyped}`);
 *   console.error(`available: ${[...getAllKnowledge().keys()].join(", ")}`);
 *   return;
 * }
 * ```
 */
export function hasKnowledge(name: string): boolean {
  if (!knowledgeCache) {
    knowledgeCache = loadAllKnowledge();
  }
  return knowledgeCache.has(name);
}

/**
 * Look up a bundled example file by name. Returns the raw source.
 * Returns `""` when the name isn't known — pair with {@link hasExample}
 * when the input is user-controlled.
 */
export function getExample(name: string): string {
  if (!exampleCache) {
    exampleCache = loadAllExamples();
  }

  return exampleCache.get(name) ?? "";
}

/**
 * `true` when an example file with this exact name is bundled.
 * The miss-vs-empty disambiguator for {@link getExample}.
 */
export function hasExample(name: string): boolean {
  if (!exampleCache) {
    exampleCache = loadAllExamples();
  }
  return exampleCache.has(name);
}

export function getAllExamples(): ReadonlyMap<string, string> {
  if (!exampleCache) {
    exampleCache = loadAllExamples();
  }

  return exampleCache;
}

export function getKnowledgeFiles(names: string[]): string {
  return names
    .map((name) => getKnowledge(name))
    .filter(Boolean)
    .join("\n\n---\n\n");
}

export function getExampleFiles(names: string[]): string {
  return names
    .map((name) => {
      const content = getExample(name);
      if (!content) {
        return "";
      }

      return `### Example: ${name}\n\n\`\`\`typescript\n${content}\n\`\`\``;
    })
    .filter(Boolean)
    .join("\n\n");
}

/** Clear cached knowledge and examples. Useful for dev/watch mode. */
export function clearCache(): void {
  knowledgeCache = null;
  exampleCache = null;
}

// ---------------------------------------------------------------------------
// Structured data APIs (v1.16.0 — back the MCP `list_review_rules`,
// `get_review_rule`, `list_migration_sources`, `get_migration_pattern`,
// `get_composable_packages` tools).
// ---------------------------------------------------------------------------

export {
  type AntiPattern,
  type AntiPatternCategory,
  type AntiPatternSeverity,
  clearAntiPatternCache,
  getAntiPatternById,
  getAntiPatterns,
} from "./parsers/anti-patterns.js";

export {
  type MigrationConceptRow,
  type MigrationPattern,
  type MigrationSourceId,
  MIGRATION_SOURCES,
  clearMigrationCache,
  getMigrationPattern,
  getMigrationPatterns,
  getMigrationSources,
} from "./parsers/migration.js";

export {
  type CompositionEdge,
  clearCompositionsCache,
  getCompositions,
  getCompositionsFor,
  getReverseCompositionsFor,
} from "./parsers/compositions.js";
