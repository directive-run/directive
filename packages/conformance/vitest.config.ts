/**
 * One suite, several engines.
 *
 * Every project runs the same ported tests; only the module `@directive-run/core`
 * resolves to differs:
 *
 * - `conformance:v1`    — the published 1.35.0 package (npm alias
 *   `directive-v1`). The reference: whatever it does is the contract.
 * - `conformance:local` — the workspace's core source. Proves the port is
 *   faithful (it must agree with v1) and keeps 1.x honest while it still ships.
 * - `conformance:v2`    — core-next, once it exists (commented slot below).
 *
 * Tests that mock `#is-development` to exercise production branches run in
 * separate `:prod` projects. Against source the mock does the work; against a
 * built package there is nothing to mock, so v1's `:prod` project resolves the
 * package's `production` build instead, where the flag is the constant `false`.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { coreEntries, defaultRepoRoot } from "./lib/core-entries.js";

const here = dirname(fileURLToPath(import.meta.url));
const v1Root = resolve(here, "node_modules/directive-v1");
const coreRoot = join(defaultRepoRoot, "packages/core");

/** Ported tests that flip the dev flag by mocking `#is-development`. */
function prodFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (
        name.endsWith(".test.ts") &&
        readFileSync(full, "utf8").includes('vi.mock("#is-development"')
      ) {
        out.push(relative(here, full));
      }
    }
  };
  walk(join(here, "tests"));

  return out.sort();
}

const PROD = prodFiles();
const TESTS = ["tests/**/*.test.ts"];
/** Runs in every engine project: proves the project tests what it claims. */
const SELF = ["self/**/*.test.ts"];

type Alias = Array<{ find: RegExp; replacement: string }>;

function exact(specifier: string): RegExp {
  return new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
}

/** `@directive-run/core[/sub]` → the published 1.35 build for `condition`. */
function v1Alias(condition: "development" | "production"): Alias {
  const pkg = JSON.parse(readFileSync(join(v1Root, "package.json"), "utf8"));
  const subpaths: Alias = [];
  const roots: Alias = [];
  for (const [subpath, target] of Object.entries(
    pkg.exports as Record<string, Record<string, { import?: string }>>,
  )) {
    const file = target[condition]?.import;
    if (!file) {
      throw new Error(`directive-v1 has no ${condition} build for ${subpath}`);
    }
    const specifier =
      subpath === "."
        ? "@directive-run/core"
        : `@directive-run/core/${subpath.replace(/^\.\//, "")}`;
    (subpath === "." ? roots : subpaths).push({
      find: exact(specifier),
      replacement: join(v1Root, file),
    });
  }

  return [...subpaths, ...roots];
}

/** `@directive-run/core[/sub]` → the workspace's core source. */
function localAlias(): Alias {
  const entries = coreEntries();

  return [
    // A test's `vi.mock("#is-development")` resolves from this package, which
    // has no such import. Point it at the file core's own import resolves to,
    // so the mock and core agree on the module id.
    {
      find: exact("#is-development"),
      replacement: join(coreRoot, "src/dev-true.ts"),
    },
    ...entries
      .filter((e) => e.subpath !== ".")
      .map((e) => ({ find: exact(e.specifier), replacement: e.file })),
    ...entries
      .filter((e) => e.subpath === ".")
      .map((e) => ({ find: exact(e.specifier), replacement: e.file })),
  ];
}

function project(
  name: string,
  engine: "v1" | "local" | "v2",
  build: "development" | "production",
  alias: Alias,
  include: string[],
  exclude: string[],
) {
  return {
    resolve: { alias },
    test: {
      name,
      root: here,
      globals: true,
      environment: "node",
      include: [...include, ...SELF],
      exclude,
      // Fails a test layers.json cannot place; skips aheadOfV1 on v1 and,
      // on v2, internals files and tests above `current`.
      setupFiles: ["helpers/layer-gate.ts"],
      env: { DIRECTIVE_ENGINE: engine, DIRECTIVE_BUILD: build },
    },
  };
}

export default defineConfig({
  test: {
    projects: [
      project(
        "conformance:v1",
        "v1",
        "development",
        v1Alias("development"),
        TESTS,
        PROD,
      ),
      project(
        "conformance:v1:prod",
        "v1",
        "production",
        v1Alias("production"),
        PROD,
        [],
      ),
      project(
        "conformance:local",
        "local",
        "development",
        localAlias(),
        TESTS,
        PROD,
      ),
      project(
        "conformance:local:prod",
        "local",
        "production",
        localAlias(),
        PROD,
        [],
      ),
      // Phase 1 adds core-next. Same tests and the same setup file, which on
      // v2 skips every test above layers.rules.json `current` and every file
      // in the `internals` category (layers.json) until WHITE-BOX.md triage
      // moves it out. The engine-identity self test needs a v2 branch too.
      // project("conformance:v2", "v2", "development", v2Alias("development"), TESTS, PROD),
      // project("conformance:v2:prod", "v2", "production", v2Alias("production"), PROD, []),
      {
        test: {
          name: "conformance:checks",
          root: here,
          environment: "node",
          include: ["scripts/__tests__/**/*.test.ts"],
          // Each tamper case copies the repo slice and re-runs the check.
          testTimeout: 120_000,
        },
      },
    ],
  },
});
