/**
 * Core's public entry points, derived from its own build config and exports.
 *
 * Shared by the port, the check and the vitest config, so they can never
 * disagree about which specifier maps to which source file. Derived, not
 * hand-written: a new core subpath is picked up without anyone remembering.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve an `exports` condition value to its runtime file: a string is itself;
 * an object resolves through `import`, then `default`, recursing through nested
 * conditions. `types` and the dev/prod build conditions are never the target.
 */
function runtimeTarget(target: unknown): string | undefined {
  if (typeof target === "string") {
    return target;
  }
  if (!target || typeof target !== "object") {
    return undefined;
  }
  const t = target as Record<string, unknown>;
  for (const key of ["import", "default", "require"]) {
    if (key in t) {
      const found = runtimeTarget(t[key]);
      if (found) {
        return found;
      }
    }
  }

  return undefined;
}

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
    pkg.exports as Record<string, unknown>,
  )) {
    const dist = runtimeTarget(target);
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

/** The installed `directive-v1` package (the published reference). */
export const v1PackageDir = resolve(here, "../node_modules/directive-v1");

/**
 * The reference engine's entry points for one build condition, read from the
 * installed package's own exports: `@directive-run/core[/sub]` → the file the
 * published package serves for it. Shared by the vitest config and the
 * differential harness, which loads both engines into one process.
 */
export function v1Entries(
  condition: "development" | "production",
): CoreEntry[] {
  const pkg = JSON.parse(
    readFileSync(join(v1PackageDir, "package.json"), "utf8"),
  );
  const out: CoreEntry[] = [];
  for (const [subpath, target] of Object.entries(
    pkg.exports as Record<string, Record<string, { import?: string }>>,
  )) {
    const file = target[condition]?.import;
    if (!file) {
      throw new Error(`directive-v1 has no ${condition} build for ${subpath}`);
    }
    out.push({
      subpath,
      specifier:
        subpath === "."
          ? "@directive-run/core"
          : `@directive-run/core/${subpath.replace(/^\.\//, "")}`,
      file: join(v1PackageDir, file),
    });
  }

  return out;
}

/**
 * core-next's file for each core entry point: the same path under
 * `packages/core-next/src` as core's source, or `src/unbuilt.ts` while
 * core-next has not built that entry. Shared by the vitest config, the
 * census and the engine-identity test.
 */
export function v2Entries(repoRoot = defaultRepoRoot): CoreEntry[] {
  const coreSrc = join(repoRoot, "packages/core/src");
  const nextSrc = join(repoRoot, "packages/core-next/src");

  return coreEntries(repoRoot).map((entry) => {
    const file = join(nextSrc, relative(coreSrc, entry.file));

    return {
      ...entry,
      file: existsSync(file) ? file : join(nextSrc, "unbuilt.ts"),
    };
  });
}

/** core-next's package directory. */
export function nextPackageDir(repoRoot = defaultRepoRoot): string {
  return join(repoRoot, "packages/core-next");
}

/**
 * core-next's built output for each core entry point, for the `:dist`
 * projects: the file core-next's own `exports` serve for the same subpath
 * (`dist/index.js`), or `src/unbuilt.ts` where core-next has not built the
 * entry (as v2Entries). This is what ships: internal members mangled
 * (`mangleProps`). With a `condition`, the build that export condition
 * selects, where the dev check is the literal `true` or `false`; without one,
 * the default build, which reads it from `NODE_ENV` at run time.
 */
export function v2DistEntries(
  repoRoot = defaultRepoRoot,
  condition?: "development" | "production",
): CoreEntry[] {
  const nextRoot = nextPackageDir(repoRoot);
  const pkg = JSON.parse(readFileSync(join(nextRoot, "package.json"), "utf8"));
  const exportsMap = pkg.exports as Record<string, unknown>;

  return v2Entries(repoRoot).map((entry) => {
    if (entry.file.endsWith("/unbuilt.ts")) {
      return entry;
    }
    const target = exportsMap[entry.subpath];
    let dist: string | undefined;
    if (target !== undefined && condition) {
      // The build that condition selects, as v1Entries picks 1.35's. An
      // exported entry without it is an error, never a silent fallback.
      dist = runtimeTarget((target as Record<string, unknown>)[condition]);
      if (!dist) {
        throw new Error(
          `core-next has no ${condition} build for ${entry.specifier}`,
        );
      }
    } else {
      dist = runtimeTarget(target);
    }
    if (!dist) {
      return { ...entry, file: join(nextRoot, "src/unbuilt.ts") };
    }
    const file = resolve(nextRoot, dist);
    if (!existsSync(file)) {
      throw new Error(
        `core-next has no ${dist} for ${entry.specifier}; run \`pnpm --filter @directive-run/core-next build\``,
      );
    }

    return { ...entry, file };
  });
}
