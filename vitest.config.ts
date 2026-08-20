import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));
const packagesDir = resolve(root, "packages");

/**
 * Resolve `@directive-run/*` to source, not to built output.
 *
 * Without this, a test in one package that imports another resolves through
 * `node_modules` to that package's `dist/`, which the test run never builds. A
 * change to core was therefore invisible to every downstream suite until
 * someone happened to rebuild — so the packages a core defect breaks were
 * structurally unable to catch it. Found the hard way: a fix that had landed in
 * core had zero references in `dist` while the whole monorepo suite ran green.
 *
 * The map is derived from each package's own `exports`, not hand-written, so a
 * new package or subpath is picked up without anyone remembering to add it. The
 * one place a hand-written list would have rotted is exactly where this bug
 * came from.
 *
 * Where a built path has no obvious source twin — `./testing` is built from
 * `src/utils/testing.ts` — the basename is searched for. If that finds nothing,
 * or finds more than one candidate, this throws at config load. A missing alias
 * is what got us here, so it fails loudly rather than falling back to `dist`.
 */

/**
 * The dist-name to source-file map a package's build config declares.
 *
 * This is the only authoritative answer. Several entries are unguessable from
 * the built path alone — `multi-agent` is built from `multi-agent-export.ts` —
 * so inferring the source would quietly miss them, and quietly missing is the
 * failure this whole alias exists to end.
 */
function buildEntries(pkgDir: string): Map<string, string> {
  const config = join(pkgDir, "tsup.config.ts");
  const entries = new Map<string, string>();
  if (!existsSync(config)) {
    return entries;
  }
  const text = readFileSync(config, "utf-8");
  // Object form: `key: "src/x.ts"` and `"key/sub": "src/x.ts"`.
  for (const m of text.matchAll(
    /["']?([\w./-]+)["']?\s*:\s*["'](src\/[\w./-]+\.tsx?)["']/g,
  )) {
    entries.set(m[1] as string, m[2] as string);
  }
  // Array form: `entry: ["src/index.tsx"]` — the built name is the basename,
  // which is how the bundler derives it too.
  for (const block of text.matchAll(/entry\s*:\s*\[([^\]]*)\]/g)) {
    for (const m of (block[1] as string).matchAll(
      /["'](src\/[\w./-]+\.tsx?)["']/g,
    )) {
      const file = m[1] as string;
      const name = (file.split("/").pop() as string).replace(/\.tsx?$/, "");
      if (!entries.has(name)) {
        entries.set(name, file);
      }
    }
  }

  return entries;
}

function sourceFor(
  pkgDir: string,
  distPath: string,
  entries: Map<string, string>,
): string {
  const key = distPath
    .replace(/^\.\/dist\//, "")
    .replace(/\.(js|cjs|mjs)$/, "");
  const declared = entries.get(key);
  if (declared) {
    const full = join(pkgDir, declared);
    if (existsSync(full)) {
      return full;
    }
  }

  for (const ext of [".ts", ".tsx"]) {
    const direct = join(pkgDir, "src", `${key}${ext}`);
    if (existsSync(direct)) {
      return direct;
    }
  }

  throw new Error(
    `[vitest.config] Cannot map ${distPath} in ${pkgDir} to a source file. ` +
      `Its build config declares ${declared ?? "nothing"} for "${key}". ` +
      "Fix the mapping rather than letting the import fall back to dist — " +
      "that fallback is what made core changes invisible to downstream tests.",
  );
}

function buildAlias(): Array<{ find: RegExp; replacement: string }> {
  const subpaths: Array<{ find: RegExp; replacement: string }> = [];
  const roots: Array<{ find: RegExp; replacement: string }> = [];

  for (const name of readdirSync(packagesDir)) {
    const pkgDir = join(packagesDir, name);
    const manifest = join(pkgDir, "package.json");
    if (!existsSync(manifest)) {
      continue;
    }
    const entries = buildEntries(pkgDir);
    const pkg = JSON.parse(readFileSync(manifest, "utf-8")) as {
      name?: string;
      exports?: Record<string, unknown>;
    };
    if (!pkg.name?.startsWith("@directive-run/")) {
      continue;
    }

    for (const [subpath, target] of Object.entries(pkg.exports ?? {})) {
      const dist =
        typeof target === "string"
          ? target
          : ((target as { import?: string; default?: string })?.import ??
            (target as { default?: string })?.default);
      // Only code entry points. A package may also export an asset — the CLI
      // ships a generated `llms.txt` — which has no source module to alias.
      if (
        typeof dist !== "string" ||
        !dist.startsWith("./dist/") ||
        !/\.(js|cjs|mjs)$/.test(dist)
      ) {
        continue;
      }
      const specifier =
        subpath === "."
          ? pkg.name
          : `${pkg.name}/${subpath.replace(/^\.\//, "")}`;
      const entry = {
        // Anchored: a bare package name must not swallow its own subpaths.
        find: new RegExp(
          `^${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        ),
        replacement: sourceFor(pkgDir, dist, entries),
      };
      (subpath === "." ? roots : subpaths).push(entry);
    }
  }

  // Subpaths first so the more specific pattern is tried first.
  return [...subpaths, ...roots];
}

export default defineConfig({
  resolve: { alias: buildAlias() },
  test: {
    globals: true,
    environment: "node",
    include: [
      "packages/**/*.test.ts",
      "packages/**/*.test.tsx",
      "packages/**/*.spec.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.spec.ts", "**/index.ts"],
    },
    benchmark: {
      include: ["packages/**/*.bench.ts"],
    },
  },
});
