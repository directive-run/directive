/**
 * The census: after the suite runs, prove it ran everything it should have,
 * the way it should have.
 *
 * Independent of check-expects, which proves the files are right; this
 * proves the run was. A green run that quietly skipped, filtered or dropped
 * tests fails here:
 *
 * - config: the vitest config has exactly the six projects, each with the
 *   expected root, includes, excludes, setup file, env and core aliases, and
 *   nothing else (no extra setup files, global setup, server deps or mocks);
 * - files: every port ran in every engine project that should run it, and the
 *   self tests and tamper tests ran too;
 * - tests: every test passed, except exactly the aheadOfV1 tests on v1, which
 *   were skipped; nothing is todo; every statically named test ran under its
 *   name, and each file ran the same tests on v1 and local;
 * - aheadOfV1.json: one entry per test, each with a reason, no wildcards;
 * - the differential project: every diff/ file ran, every scenario under
 *   its literal title, nothing skipped; every scenario file has a layer;
 *   every divergences.json entry is complete, signed off and still covers
 *   a difference the run found (none stale).
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { Project } from "ts-morph";
import { coreEntries } from "./core-entries.js";
import { staticTests } from "./tests.js";

export const ENGINE_PROJECTS = [
  "conformance:v1",
  "conformance:v1:prod",
  "conformance:local",
  "conformance:local:prod",
] as const;
export const DIFF_PROJECT = "conformance:diff";
export const CHECKS_PROJECT = "conformance:checks";
export const ALL_PROJECTS = [...ENGINE_PROJECTS, DIFF_PROJECT, CHECKS_PROJECT];

export interface JsonReport {
  testResults: Array<{
    name: string;
    assertionResults: Array<{
      ancestorTitles: string[];
      title: string;
      status: string;
    }>;
  }>;
}

interface LayersFile {
  files: Record<string, { tests: Record<string, { dynamic?: true }> }>;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);

    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Ports that mock `#is-development` and so run in the `:prod` projects. */
export function prodPorts(conformanceRoot: string): string[] {
  return walk(join(conformanceRoot, "tests"))
    .filter(
      (f) =>
        f.endsWith(".test.ts") &&
        readFileSync(f, "utf8").includes('vi.mock("#is-development"'),
    )
    .map((f) => relative(conformanceRoot, f))
    .sort();
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** aheadOfV1.json: `{ tests: { [port]: { [test name]: reason } } }`. */
export function checkAheadOfV1(conformanceRoot: string): string[] {
  const failures: string[] = [];
  const ahead = readJson<{ tests?: unknown }>(
    join(conformanceRoot, "aheadOfV1.json"),
  ).tests;
  const layers = readJson<LayersFile>(join(conformanceRoot, "layers.json"));
  if (!ahead || typeof ahead !== "object" || Array.isArray(ahead)) {
    return [
      "aheadOfV1.json: `tests` must be an object of port → { test: reason }",
    ];
  }
  for (const [file, tests] of Object.entries(ahead)) {
    const known = layers.files[file]?.tests;
    if (!known) {
      failures.push(`aheadOfV1.json names ${file}, which is not a port`);
      continue;
    }
    if (!tests || typeof tests !== "object" || Array.isArray(tests)) {
      failures.push(
        `aheadOfV1.json: ${file} must map each test name to a reason (no wildcards)`,
      );
      continue;
    }
    for (const [name, reason] of Object.entries(tests)) {
      if (name.includes("*") || !(name in known)) {
        failures.push(`aheadOfV1.json: ${file} has no test named "${name}"`);
      }
      if (typeof reason !== "string" || reason.trim().length < 10) {
        failures.push(`aheadOfV1.json: "${name}" needs a reason`);
      }
    }
  }

  return failures;
}

type Alias = Array<{ find: RegExp | string; replacement: string }>;

interface ProjectConfig {
  resolve?: { alias?: Alias };
  test?: Record<string, unknown>;
  [key: string]: unknown;
}

/** The `RegExp.source` an exact-match alias for `specifier` has. */
function exactSource(specifier: string): string {
  return new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)
    .source;
}

function expectedAlias(
  repoRoot: string,
  engine: "v1" | "local",
  build: "development" | "production",
): Record<string, string> {
  const conformanceRoot = join(repoRoot, "packages/conformance");
  const out: Record<string, string> = {};
  if (engine === "v1") {
    const dir = join(conformanceRoot, "node_modules/directive-v1");
    const pkg = readJson<{
      exports: Record<string, Record<string, { import?: string }>>;
    }>(join(dir, "package.json"));
    for (const [subpath, target] of Object.entries(pkg.exports)) {
      const specifier =
        subpath === "."
          ? "@directive-run/core"
          : `@directive-run/core/${subpath.slice(2)}`;
      out[exactSource(specifier)] = join(dir, target[build]?.import ?? "");
    }
  } else {
    out[exactSource("#is-development")] = join(
      repoRoot,
      "packages/core/src/dev-true.ts",
    );
    for (const entry of coreEntries(repoRoot)) {
      out[exactSource(entry.specifier)] = entry.file;
    }
  }

  return out;
}

const sameJson = (a: unknown, b: unknown) =>
  JSON.stringify(a, keepRegExp) === JSON.stringify(b, keepRegExp);

/** JSON.stringify drops a RegExp to `{}`; compare its source and flags. */
function keepRegExp(_key: string, value: unknown): unknown {
  return value instanceof RegExp
    ? `RegExp(${value.source}/${value.flags})`
    : value;
}

/** Problems with the loaded vitest config, against what the census expects. */
export function checkConfig(
  config: { test?: { projects?: ProjectConfig[] } } & Record<string, unknown>,
  repoRoot: string,
): string[] {
  const failures: string[] = [];
  const conformanceRoot = join(repoRoot, "packages/conformance");
  const fail = (m: string) => failures.push(`vitest.config.ts: ${m}`);

  if (!sameJson(Object.keys(config), ["test"])) {
    fail(
      `top level may only hold \`test\`, has ${Object.keys(config).join(", ")}`,
    );
  }
  if (!sameJson(Object.keys(config.test ?? {}), ["projects"])) {
    fail("`test` may only hold `projects`");
  }
  const projects = config.test?.projects ?? [];
  const names = projects.map((p) => p.test?.name);
  if (!sameJson(names, ALL_PROJECTS)) {
    fail(
      `projects must be exactly ${ALL_PROJECTS.join(", ")}; got ${names.join(", ")}`,
    );
  }

  const prod = prodPorts(conformanceRoot);
  const self = ["self/**/*.test.ts"];
  for (const project of projects) {
    const test = project.test ?? {};
    const name = test.name as string;
    if (name === DIFF_PROJECT) {
      const want = {
        test: {
          name,
          root: conformanceRoot,
          environment: "node",
          include: ["diff/**/*.test.ts"],
          testTimeout: 120_000,
          server: {
            deps: {
              inline: [/[\\/]directive-v1[\\/]/, /@directive-run\+core@/],
            },
          },
        },
      };
      if (!sameJson(project, want)) {
        fail(`${name} differs from ${JSON.stringify(want, keepRegExp)}`);
      }
      continue;
    }
    if (name === CHECKS_PROJECT) {
      const want = {
        test: {
          name,
          root: conformanceRoot,
          environment: "node",
          include: ["scripts/__tests__/**/*.test.ts"],
          testTimeout: 120_000,
        },
      };
      if (!sameJson(project, want)) {
        fail(`${name} differs from ${JSON.stringify(want)}`);
      }
      continue;
    }
    const engine = name.includes(":v1") ? "v1" : "local";
    const build = name.endsWith(":prod") ? "production" : "development";
    const want = {
      name,
      root: conformanceRoot,
      globals: true,
      environment: "node",
      include:
        build === "production"
          ? [...prod, ...self]
          : ["tests/**/*.test.ts", ...self],
      exclude: build === "production" ? [] : prod,
      setupFiles: ["helpers/layer-gate.ts"],
      env: { DIRECTIVE_ENGINE: engine, DIRECTIVE_BUILD: build },
    };
    if (!sameJson(Object.keys(project), ["resolve", "test"])) {
      fail(`${name} may only hold resolve and test`);
    }
    if (!sameJson(test, want)) {
      fail(`${name} test options differ from ${JSON.stringify(want)}`);
    }
    const alias = Object.fromEntries(
      (project.resolve?.alias ?? []).map((a) => [
        a.find instanceof RegExp ? a.find.source : `string:${a.find}`,
        a.replacement,
      ]),
    );
    const resolveKeys = Object.keys(project.resolve ?? {});
    if (!sameJson(resolveKeys, ["alias"])) {
      fail(`${name} resolve may only hold alias`);
    }
    const expected = expectedAlias(repoRoot, engine, build);
    const sort = (o: Record<string, string>) =>
      Object.fromEntries(
        Object.entries(o).sort(([a], [b]) => a.localeCompare(b)),
      );
    if (!sameJson(sort(alias), sort(expected))) {
      fail(`${name} aliases differ from ${JSON.stringify(expected)}`);
    }
  }

  return failures;
}

/** Problems with what a run actually did, per project. */
export function census(
  repoRoot: string,
  reports: Partial<Record<string, JsonReport>>,
): string[] {
  const failures: string[] = [];
  const fail = (m: string) => failures.push(m);
  const conformanceRoot = join(repoRoot, "packages/conformance");
  const manifest = readJson<Record<string, string>>(
    join(conformanceRoot, "scripts/manifest.json"),
  );
  const layers = readJson<LayersFile>(join(conformanceRoot, "layers.json"));
  const ahead = readJson<{ tests: Record<string, Record<string, string>> }>(
    join(conformanceRoot, "aheadOfV1.json"),
  ).tests;
  const prod = new Set(prodPorts(conformanceRoot));
  const runnable = Object.keys(manifest).filter((f) => f.endsWith(".test.ts"));
  const selfFiles = walk(join(conformanceRoot, "self"))
    .filter((f) => f.endsWith(".test.ts"))
    .map((f) => relative(conformanceRoot, f));
  const checkFiles = walk(join(conformanceRoot, "scripts/__tests__"))
    .filter((f) => f.endsWith(".test.ts"))
    .map((f) => relative(conformanceRoot, f));
  const diffFiles = diffTestFiles(conformanceRoot);
  // One per entry point, four shared, and the v1 tarball check on v1.
  const identityTests = (project: string) =>
    coreEntries(repoRoot).length +
    (project.startsWith("conformance:v1") ? 5 : 4);

  const project = new Project({ useInMemoryFileSystem: true });
  const declared = (rel: string, roots?: string[]) =>
    staticTests(
      project.createSourceFile(
        `/${rel}`,
        readFileSync(join(conformanceRoot, rel), "utf8"),
        { overwrite: true },
      ),
      roots,
    );
  const staticCount = (rel: string) => declared(rel).length;

  /** project → file → test names (with status). */
  const ran = new Map<string, Map<string, [string, string][]>>();
  for (const name of ALL_PROJECTS) {
    const report = reports[name];
    if (!report) {
      fail(`${name} produced no report`);
      continue;
    }
    const files = new Map<string, [string, string][]>();
    for (const file of report.testResults) {
      files.set(
        relative(conformanceRoot, file.name),
        file.assertionResults.map((a) => [
          [...a.ancestorTitles, a.title].join(" > "),
          a.status,
        ]),
      );
    }
    ran.set(name, files);
  }

  for (const [name, files] of ran) {
    const isV1 = name.startsWith("conformance:v1");
    const isProd = name.endsWith(":prod");
    const expected =
      name === CHECKS_PROJECT
        ? checkFiles
        : name === DIFF_PROJECT
          ? diffFiles
          : [
              ...runnable.filter((f) => (isProd ? prod.has(f) : !prod.has(f))),
              ...selfFiles,
            ];
    for (const file of expected) {
      if (!files.has(file)) {
        fail(`${name}: ${file} did not run`);
      }
    }
    for (const file of files.keys()) {
      if (!expected.includes(file)) {
        fail(`${name}: ${file} ran but is not part of this project`);
      }
    }

    for (const [file, tests] of files) {
      const skipAllowed = isV1 ? (ahead[file] ?? {}) : {};
      for (const [test, status] of tests) {
        const allowedSkip = test in skipAllowed;
        if (status === "passed" && allowedSkip) {
          fail(
            `${name}: ${file} > "${test}" is in aheadOfV1.json but was not skipped`,
          );
        } else if (status === "skipped" || status === "pending") {
          if (!allowedSkip) {
            fail(`${name}: ${file} > "${test}" was skipped`);
          }
        } else if (status !== "passed") {
          fail(`${name}: ${file} > "${test}" is ${status}`);
        }
      }
      for (const test of Object.keys(skipAllowed)) {
        if (!tests.some(([t]) => t === test)) {
          fail(
            `${name}: aheadOfV1 test ${file} > "${test}" did not run at all`,
          );
        }
      }

      const names = tests.map(([t]) => t);
      const known = layers.files[file]?.tests;
      if (known) {
        const hasDynamic = Object.values(known).some((t) => t.dynamic);
        const stat = Object.entries(known)
          .filter(([, t]) => !t.dynamic)
          .map(([k]) => k.replace(/ #\d+$/, ""));
        for (const key of new Set(stat)) {
          if (!names.includes(key)) {
            fail(`${name}: ${file} > "${key}" did not run`);
          }
        }
        if (!hasDynamic && names.length !== Object.keys(known).length) {
          fail(
            `${name}: ${file} ran ${names.length} tests, layers.json names ${Object.keys(known).length}`,
          );
        }
      } else if (file.startsWith("self/")) {
        if (names.length !== identityTests(name)) {
          fail(
            `${name}: ${file} ran ${names.length} tests, expected ${identityTests(name)}`,
          );
        }
      } else if (name === DIFF_PROJECT) {
        // Every scenario and test is written with a literal title (no loops,
        // no templates), so each one must have run under its own name.
        const tests = declared(file, DIFF_TEST_ROOTS);
        for (const t of tests) {
          if (t.dynamic) {
            fail(`${file}: "${t.key}" has a computed title; write it out`);
          } else if (!names.includes(t.key)) {
            fail(`${name}: ${file} > "${t.key}" did not run`);
          }
        }
        if (names.length !== tests.length) {
          fail(
            `${name}: ${file} ran ${names.length} tests, declares ${tests.length}`,
          );
        }
      } else if (name === CHECKS_PROJECT) {
        if (names.length !== staticCount(file)) {
          fail(
            `${name}: ${file} ran ${names.length} tests, expected ${staticCount(file)}`,
          );
        }
      }
    }
  }

  // Each file runs the same tests on v1 and local.
  for (const [a, b] of [
    ["conformance:v1", "conformance:local"],
    ["conformance:v1:prod", "conformance:local:prod"],
  ] as const) {
    const left = ran.get(a);
    const right = ran.get(b);
    if (!left || !right) {
      continue;
    }
    for (const [file, tests] of left) {
      // Self-test titles name their engine.
      if (file.startsWith("self/")) {
        continue;
      }
      const other = right.get(file);
      const l = tests.map(([t]) => t).sort();
      const r = (other ?? []).map(([t]) => t).sort();
      if (other && !sameJson(l, r)) {
        fail(`${file}: ${a} and ${b} ran different tests`);
      }
    }
  }

  return failures;
}

/** Calls that register a test in diff/: `it`, `test` and `scenario`. */
export const DIFF_TEST_ROOTS = ["it", "test", "scenario"];

/** Test files of the differential project, relative to packages/conformance. */
export function diffTestFiles(conformanceRoot: string): string[] {
  return walk(join(conformanceRoot, "diff"))
    .filter((f) => f.endsWith(".test.ts"))
    .map((f) => relative(conformanceRoot, f))
    .sort();
}

const LAYER = /^L(?:[0-9]|1[0-3])$/;

/**
 * layers.rules.json `scenarios`: every differential scenario and fuzz file
 * has a layer, so a v2 run can skip what is above `current`. The harness's
 * own self tests (diff/self/) always run and take no layer.
 */
export function checkScenarioLayers(conformanceRoot: string): string[] {
  const failures: string[] = [];
  const rules = readJson<{ scenarios?: Record<string, unknown> }>(
    join(conformanceRoot, "layers.rules.json"),
  );
  const placed = rules.scenarios ?? {};
  const files = diffTestFiles(conformanceRoot).filter(
    (f) => !f.startsWith("diff/self/"),
  );
  for (const file of files) {
    const layer = placed[file];
    if (typeof layer !== "string" || !LAYER.test(layer)) {
      failures.push(
        `layers.rules.json: scenario file ${file} needs a layer (L0–L13) in \`scenarios\``,
      );
    }
  }
  for (const file of Object.keys(placed)) {
    if (!files.includes(file)) {
      failures.push(
        `layers.rules.json: \`scenarios\` names ${file}, which is not a scenario file`,
      );
    }
  }

  return failures;
}

export interface DivergenceEntry {
  id: string;
  scenario: string;
  path: string;
  reason: string;
  approvedBy: string;
  date: string;
}

const DIVERGENCE_KEYS = [
  "approvedBy",
  "date",
  "id",
  "path",
  "reason",
  "scenario",
];

/**
 * diff/divergences.json: each entry is an intended difference between the
 * engines, signed off by a person (Jason — never an agent). `used` is the
 * set of ids the run reported covering at least one difference, or null
 * when not known: an entry that covers nothing is stale and fails, so the
 * file can only describe differences that still exist.
 */
export function checkDivergences(
  conformanceRoot: string,
  used: Set<string> | null,
): string[] {
  const failures: string[] = [];
  const fail = (m: string) => failures.push(`diff/divergences.json: ${m}`);
  let entries: unknown;
  try {
    entries = readJson(join(conformanceRoot, "diff/divergences.json"));
  } catch {
    return ["diff/divergences.json: missing or not JSON"];
  }
  if (!Array.isArray(entries)) {
    return ["diff/divergences.json: must be an array"];
  }
  const ids = new Set<string>();
  for (const [i, raw] of entries.entries()) {
    const e = (raw ?? {}) as Partial<DivergenceEntry>;
    const label = typeof e.id === "string" && e.id ? e.id : `entry ${i}`;
    if (!sameJson(Object.keys(e).sort(), DIVERGENCE_KEYS)) {
      fail(`${label} must have exactly ${DIVERGENCE_KEYS.join(", ")}`);
    }
    if (typeof e.id !== "string" || !e.id) {
      fail(`entry ${i} needs an id`);
    } else if (ids.has(e.id)) {
      fail(`duplicate id ${e.id}`);
    } else {
      ids.add(e.id);
    }
    if (typeof e.scenario !== "string" || !e.scenario) {
      fail(`${label} needs the scenario it applies to`);
    }
    if (typeof e.path !== "string" || !/^trace(\[|$)/.test(e.path)) {
      fail(`${label} path must start at "trace"`);
    }
    if (typeof e.reason !== "string" || e.reason.trim().length < 10) {
      fail(`${label} needs a reason`);
    }
    if (typeof e.approvedBy !== "string" || !e.approvedBy.trim()) {
      fail(`${label} needs approvedBy (the person who signed it off)`);
    }
    if (typeof e.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) {
      fail(`${label} needs a YYYY-MM-DD date`);
    }
    if (used && typeof e.id === "string" && e.id && !used.has(e.id)) {
      fail(`${label} covers no difference in this run (stale); remove it`);
    }
  }

  return failures;
}
