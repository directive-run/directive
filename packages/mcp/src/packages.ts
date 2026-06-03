// Package metadata helpers for the MCP `list_packages` and
// `get_package_info` tools.
//
// Strategy:
//   - Static metadata (name, description, deps, exports) comes from
//     the build-time-baked PACKAGE_REGISTRY (see scripts/build-package-registry.ts).
//   - Live version + dist-tags.latest is fetched from npm at tool-call
//     time and cached in-memory for 1 hour. On network failure (or
//     when the package was never published, as for private workspace
//     packages), the baked version is returned with a `stale: true`
//     flag so the agent can disambiguate.
//   - All inputs are normalized through the registry — there is no
//     code path where untrusted strings reach npm or the filesystem.

import {
  PACKAGE_REGISTRY,
  type PackageRegistryEntry,
} from "./generated/package-registry.js";

export type { PackageRegistryEntry } from "./generated/package-registry.js";

interface VersionCacheEntry {
  fetchedAt: number;
  liveVersion?: string;
  latest?: string;
  error?: string;
}

const VERSION_CACHE_TTL_MS = 60 * 60 * 1000;
const VERSION_FETCH_TIMEOUT_MS = 3_000;
const versionCache = new Map<string, VersionCacheEntry>();

export interface PackageSummary {
  name: string;
  summary: string;
  published: boolean;
}

export interface PackageInfo {
  name: string;
  description: string;
  homepage?: string;
  keywords: readonly string[];
  dependencies: readonly string[];
  peerDependencies: readonly string[];
  optionalDependencies: readonly string[];
  exports: readonly string[];
  published: boolean;
  /** npm registry URL when published, otherwise undefined. */
  npmUrl?: string;
  /** Version as baked into mcp at publish time. */
  bakedVersion: string;
  /** Live version from registry.npmjs.org/<pkg>/latest. May be undefined on network failure or for private packages. */
  liveVersion?: string;
  /** True when the live fetch failed and we fell back to bakedVersion. */
  stale: boolean;
}

/** Every known package, returned in stable registry order. */
export function listPackages(): PackageSummary[] {
  return PACKAGE_REGISTRY.map((entry) => ({
    name: entry.name,
    summary: entry.description,
    published: entry.published,
  }));
}

/**
 * Detail for one package. Hits npm for the latest version (1h cache,
 * 3s timeout). Returns `undefined` when no such @directive-run/*
 * package is known to mcp.
 */
export async function getPackageInfo(
  name: string,
): Promise<PackageInfo | undefined> {
  const entry = PACKAGE_REGISTRY.find((e) => e.name === name);
  if (!entry) {
    return undefined;
  }

  const { liveVersion, stale } = await getLiveVersion(entry);
  return buildPackageInfo(entry, liveVersion, stale);
}

function buildPackageInfo(
  entry: PackageRegistryEntry,
  liveVersion: string | undefined,
  stale: boolean,
): PackageInfo {
  return {
    name: entry.name,
    description: entry.description,
    homepage: entry.homepage,
    keywords: entry.keywords,
    dependencies: entry.dependencies,
    peerDependencies: entry.peerDependencies,
    optionalDependencies: entry.optionalDependencies,
    exports: entry.exports,
    published: entry.published,
    npmUrl: entry.published
      ? `https://www.npmjs.com/package/${entry.name}`
      : undefined,
    bakedVersion: entry.version,
    liveVersion,
    stale,
  };
}

interface LiveVersionResult {
  liveVersion?: string;
  stale: boolean;
}

async function getLiveVersion(
  entry: PackageRegistryEntry,
): Promise<LiveVersionResult> {
  if (!entry.published) {
    return { stale: true };
  }
  const cached = versionCache.get(entry.name);
  if (cached && Date.now() - cached.fetchedAt < VERSION_CACHE_TTL_MS) {
    return {
      liveVersion: cached.liveVersion,
      stale: cached.liveVersion === undefined,
    };
  }

  const result = await fetchLatestVersion(entry.name);
  versionCache.set(entry.name, {
    fetchedAt: Date.now(),
    liveVersion: result.liveVersion,
    latest: result.liveVersion,
    error: result.error,
  });
  return {
    liveVersion: result.liveVersion,
    stale: result.liveVersion === undefined,
  };
}

async function fetchLatestVersion(
  name: string,
): Promise<{ liveVersion?: string; error?: string }> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name).replace(/%2F/g, "/")}/latest`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERSION_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      return { error: `HTTP ${res.status}` };
    }
    const json = (await res.json()) as { version?: string };
    if (typeof json.version === "string") {
      return { liveVersion: json.version };
    }
    return { error: "no version field" };
  } catch (err) {
    return { error: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

/** Test / dev helper. */
export function clearVersionCache(): void {
  versionCache.clear();
}
