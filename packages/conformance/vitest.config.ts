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
 * - `conformance:v2`    — core-next. The layer gate skips what it has not
 *   built yet: tests above layers.rules.json `current`, and internals files.
 * - `conformance:v2:dist` — the same, against core-next's built `dist/` (what
 *   ships: mangled internal members, the dev check folded at each use). Its
 *   `:prod` project sets NODE_ENV=production, which is how the built dev check
 *   reads production; a `#is-development` mock has nothing to reach there.
 *
 * Tests that mock `#is-development` to exercise production branches run in
 * separate `:prod` projects. Against source the mock does the work; against a
 * built package there is nothing to mock, so v1's `:prod` project resolves the
 * package's `production` build instead, where the flag is the constant `false`.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import {
  coreEntries,
  defaultRepoRoot,
  v1Entries,
  v2DistEntries,
  v2Entries,
} from "./lib/core-entries.js";

const here = dirname(fileURLToPath(import.meta.url));
const coreRoot = join(defaultRepoRoot, "packages/core");
const nextRoot = join(defaultRepoRoot, "packages/core-next");

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
  const entries = v1Entries(condition);

  return [
    ...entries
      .filter((e) => e.subpath !== ".")
      .map((e) => ({ find: exact(e.specifier), replacement: e.file })),
    ...entries
      .filter((e) => e.subpath === ".")
      .map((e) => ({ find: exact(e.specifier), replacement: e.file })),
  ];
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

/** `@directive-run/core[/sub]` → core-next's source (lib/core-entries.ts v2Entries). */
function v2Alias(): Alias {
  const entries = v2Entries();

  return [
    // As for local: the mock and core-next's own import must agree on the id.
    {
      find: exact("#is-development"),
      replacement: join(nextRoot, "src/dev-true.ts"),
    },
    ...entries
      .filter((e) => e.subpath !== ".")
      .map((e) => ({ find: exact(e.specifier), replacement: e.file })),
    ...entries
      .filter((e) => e.subpath === ".")
      .map((e) => ({ find: exact(e.specifier), replacement: e.file })),
  ];
}

/**
 * `@directive-run/core[/sub]` → core-next's built dist for `condition`
 * (lib/core-entries.ts v2DistEntries), the same build v1Alias picks of 1.35.
 */
function v2DistAlias(condition: "development" | "production"): Alias {
  const entries = v2DistEntries(undefined, condition);

  return [
    // Nothing in dist imports it (the build writes the check out), but a
    // test's `vi.mock("#is-development")` still has to resolve.
    {
      find: exact("#is-development"),
      replacement: join(nextRoot, "src/dev-true.ts"),
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
  extraEnv: Record<string, string> = {},
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
      env: { DIRECTIVE_ENGINE: engine, DIRECTIVE_BUILD: build, ...extraEnv },
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
      // core-next. Same tests and the same setup file, which on v2 skips
      // every test above layers.rules.json `current` and every file in the
      // `internals` category (layers.json) until WHITE-BOX.md triage moves it
      // out. As for local, `:prod` relies on each file's own mock.
      project("conformance:v2", "v2", "development", v2Alias(), TESTS, PROD),
      project("conformance:v2:prod", "v2", "production", v2Alias(), PROD, []),
      // core-next's built dist, under the same gate.
      project(
        "conformance:v2:dist",
        "v2",
        "development",
        v2DistAlias("development"),
        TESTS,
        PROD,
        { DIRECTIVE_V2_TARGET: "dist" },
      ),
      project(
        "conformance:v2:dist:prod",
        "v2",
        "production",
        v2DistAlias("production"),
        PROD,
        [],
        { DIRECTIVE_V2_TARGET: "dist", NODE_ENV: "production" },
      ),
      // Differential scenarios: each loads both engines by file (diff/engines.ts)
      // and compares their traces, so it needs no core alias.
      {
        test: {
          name: "conformance:diff",
          root: here,
          environment: "node",
          include: ["diff/**/*.test.ts"],
          testTimeout: 120_000,
          // Transform the published package instead of letting Node load it,
          // so vi.resetModules() gives every run a fresh instance of it too.
          server: {
            deps: {
              inline: [/[\\/]directive-v1[\\/]/, /@directive-run\+core@/],
            },
          },
        },
      },
      {
        test: {
          name: "conformance:checks",
          root: here,
          environment: "node",
          // Tamper tests for the checks, and the frozen 1.35 contracts
          // (contracts/STABILITY.md) with their own tamper cases.
          include: ["scripts/__tests__/**/*.test.ts", "contracts/**/*.test.ts"],
          // Each tamper case copies the repo slice and re-runs the check.
          testTimeout: 120_000,
        },
      },
    ],
  },
});
