/**
 * Loader for `packages/knowledge/migration.json` → structured
 * migration patterns. Lazy + cached.
 *
 * The JSON ships in the published tarball; consumers don't need to
 * parse markdown at runtime.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..", "..");

/** Supported source-library identifiers. */
export const MIGRATION_SOURCES = [
  "redux",
  "zustand",
  "xstate",
  "mobx",
  "jotai",
  "recoil",
] as const;
export type MigrationSourceId = (typeof MIGRATION_SOURCES)[number];

export interface MigrationConceptRow {
  from: string;
  to: string;
  note: string;
}

export interface MigrationPattern {
  id: MigrationSourceId;
  name: string;
  conceptMap: MigrationConceptRow[];
  steps: string[];
  before: string;
  after: string;
}

interface MigrationFile {
  version: number;
  sources: MigrationPattern[];
}

let cache: ReadonlyArray<MigrationPattern> | null = null;

function resolveSourcePath(): string {
  const candidates = [
    join(PKG_ROOT, "migration.json"),
    join(PKG_ROOT, "..", "migration.json"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      return c;
    }
  }
  return candidates[0] ?? "";
}

function load(): ReadonlyArray<MigrationPattern> {
  if (cache) {
    return cache;
  }
  try {
    const raw = readFileSync(resolveSourcePath(), "utf-8");
    const parsed = JSON.parse(raw) as MigrationFile;
    cache = Object.freeze(parsed.sources ?? []);
  } catch {
    cache = Object.freeze([]);
  }
  return cache;
}

/** All supported source library IDs. */
export function getMigrationSources(): ReadonlyArray<MigrationSourceId> {
  return MIGRATION_SOURCES;
}

/** All migration patterns, in registry order. */
export function getMigrationPatterns(): ReadonlyArray<MigrationPattern> {
  return load();
}

/** One migration pattern by its source-library id. */
export function getMigrationPattern(
  source: string,
): MigrationPattern | undefined {
  return load().find((p) => p.id === source);
}

/** Test / watch-mode helper. */
export function clearMigrationCache(): void {
  cache = null;
}
