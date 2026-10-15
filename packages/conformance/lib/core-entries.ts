/**
 * Core's public entry points, derived from its own build config and exports.
 *
 * Shared by the port, the check and the vitest config, so they can never
 * disagree about which specifier maps to which source file. Derived, not
 * hand-written: a new core subpath is picked up without anyone remembering.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** The repository this package lives in. */
export const defaultRepoRoot = resolve(here, "../../..");

export interface CoreEntry {
  /** `@directive-run/core` or `@directive-run/core/<subpath>`. */
  specifier: string;
  /** The subpath as written in package.json exports (`.`, `./plugins`). */
  subpath: string;
  /** Absolute path of the source file the entry is built from. */
  file: string;
}

/** Order of preference when a name is exported by more than one entry. */
const PREFERENCE = [
  "@directive-run/core",
  "@directive-run/core/plugins",
  "@directive-run/core/testing",
  "@directive-run/core/adapter-utils",
  "@directive-run/core/worker",
  "@directive-run/core/migration",
  "@directive-run/core/internals",
];

export function coreEntries(repoRoot = defaultRepoRoot): CoreEntry[] {
  const coreRoot = join(repoRoot, "packages/core");
  const tsup = readFileSync(join(coreRoot, "tsup.config.ts"), "utf8");
  const block = tsup.match(/const entry = \{([\s\S]*?)\};/);
  if (!block) {
    throw new Error("cannot find the entry map in core's tsup.config.ts");
  }
  const byDist = new Map<string, string>();
  for (const m of (block[1] as string).matchAll(
    /["']?([\w./-]+)["']?\s*:\s*["'](src\/[\w./-]+\.ts)["']/g,
  )) {
    byDist.set(m[1] as string, m[2] as string);
  }

  const pkg = JSON.parse(readFileSync(join(coreRoot, "package.json"), "utf8"));
  const out: CoreEntry[] = [];
  for (const [subpath, target] of Object.entries(
    pkg.exports as Record<string, { import?: string }>,
  )) {
    const dist = target.import;
    if (!dist) {
      continue;
    }
    const key = dist.replace(/^\.\/dist\//, "").replace(/\.js$/, "");
    const src = byDist.get(key);
    if (!src) {
      throw new Error(`no source entry for core export ${subpath} (${dist})`);
    }
    out.push({
      subpath,
      specifier:
        subpath === "."
          ? "@directive-run/core"
          : `@directive-run/core/${subpath.replace(/^\.\//, "")}`,
      file: resolve(coreRoot, src),
    });
  }
  out.sort(
    (a, b) => PREFERENCE.indexOf(a.specifier) - PREFERENCE.indexOf(b.specifier),
  );

  return out;
}
