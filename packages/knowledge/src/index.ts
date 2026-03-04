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

export function getKnowledge(name: string): string {
  if (!knowledgeCache) {
    knowledgeCache = loadAllKnowledge();
  }

  return knowledgeCache.get(name) ?? "";
}

export function getAllKnowledge(): ReadonlyMap<string, string> {
  if (!knowledgeCache) {
    knowledgeCache = loadAllKnowledge();
  }

  return knowledgeCache;
}

export function getExample(name: string): string {
  if (!exampleCache) {
    exampleCache = loadAllExamples();
  }

  return exampleCache.get(name) ?? "";
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
