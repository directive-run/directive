/**
 * Loader for `packages/knowledge/compositions.json` → typed
 * composition graph. Lazy + cached.
 *
 * The JSON ships in the published tarball. Adjacency list rather
 * than per-package projections so consumers can answer both
 * "what does X compose with?" and "what composes with X?" without
 * duplicate data.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..", "..");

export interface CompositionEdge {
  from: string;
  to: string;
  reason: string;
}

interface CompositionsFile {
  version: number;
  edges: CompositionEdge[];
}

let cache: ReadonlyArray<CompositionEdge> | null = null;

function resolveSourcePath(): string {
  const candidates = [
    join(PKG_ROOT, "compositions.json"),
    join(PKG_ROOT, "..", "compositions.json"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      return c;
    }
  }
  return candidates[0] ?? "";
}

function load(): ReadonlyArray<CompositionEdge> {
  if (cache) {
    return cache;
  }
  try {
    const raw = readFileSync(resolveSourcePath(), "utf-8");
    const parsed = JSON.parse(raw) as CompositionsFile;
    cache = Object.freeze(parsed.edges ?? []);
  } catch {
    cache = Object.freeze([]);
  }
  return cache;
}

/** All composition edges as a flat list. */
export function getCompositions(): ReadonlyArray<CompositionEdge> {
  return load();
}

/**
 * All edges originating at the given package. Returns an empty array
 * when the package is unknown or has no outgoing compositions.
 */
export function getCompositionsFor(
  packageName: string,
): ReadonlyArray<CompositionEdge> {
  return load().filter((e) => e.from === packageName);
}

/**
 * All edges arriving at the given package — "who composes WITH me?"
 */
export function getReverseCompositionsFor(
  packageName: string,
): ReadonlyArray<CompositionEdge> {
  return load().filter((e) => e.to === packageName);
}

/** Test / watch-mode helper. */
export function clearCompositionsCache(): void {
  cache = null;
}
