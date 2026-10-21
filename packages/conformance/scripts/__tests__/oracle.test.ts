/**
 * The census, the harness lock and the oracle guard catch what they claim.
 *
 * Census cases feed synthetic vitest reports (built from layers.json, so the
 * clean report is exactly what a full run produces) and tamper with them.
 * Lock and guard cases tamper with a copy of the harness.
 */

import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Project } from "ts-morph";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  ALL_PROJECTS,
  CHECKS_PROJECT,
  DIFF_PROJECT,
  DIFF_TEST_ROOTS,
  FUZZ_FLOOR,
  type JsonReport,
  census,
  checkAheadOfV1,
  checkConfig,
  checkDivergences,
  checkFuzzRuns,
  checkHooksFired,
  checkScenarioLayers,
  diffTestFiles,
  pluginHooks,
  prodPorts,
  unbuiltReached,
  unbuiltSpecifiers,
  v2Skips,
} from "../../lib/census.js";
import { coreEntries, v2Entries } from "../../lib/core-entries.js";
import { checkBaseline, checkPullRequest } from "../../lib/guard.js";
import { checkLock } from "../../lib/harness.js";
import { staticTests } from "../../lib/tests.js";
import { checkV1Pin } from "../../lib/v1-pin.js";

// Each case does seconds of synchronous work (a full re-classification).
// Yield a macrotask after each, so vitest's worker RPC is answered between
// cases instead of timing out behind a run of them.
afterEach(() => new Promise<void>((resolve) => setImmediate(resolve)));

const conformance = join(dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = join(conformance, "../..");
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);

    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** The reports a complete, green run produces. */
function cleanReports(): Record<string, JsonReport> {
  const layersFile = readJson(join(conformance, "layers.json"));
  const layers = layersFile.files as Record<
    string,
    { tests: Record<string, unknown> }
  >;
  const current = readJson(join(conformance, "layers.rules.json")).current;
  const prod = new Set(prodPorts(conformance));
  const ports = Object.keys(layers).filter((f) => f.endsWith(".test.ts"));
  const file = (
    rel: string,
    names: string[],
    status: (name: string) => string = () => "passed",
  ) => ({
    name: join(conformance, rel),
    assertionResults: names.map((n) => {
      const parts = n.split(" > ");

      return {
        ancestorTitles: parts.slice(0, -1),
        title: parts[parts.length - 1] as string,
        status: status(n),
      };
    }),
  });
  // On v2 the layer gate skips what core-next has not built yet.
  const portFile = (rel: string, project: string) =>
    file(
      rel,
      Object.keys(layers[rel]?.tests ?? {}).map((k) => k.replace(/ #\d+$/, "")),
      (n) =>
        project.startsWith("conformance:v2") &&
        v2Skips(layersFile, current, rel, n)
          ? "skipped"
          : "passed",
    );
  const self = (engine: string) =>
    file(
      "self/engine-identity.test.ts",
      Array.from(
        {
          length:
            coreEntries().length +
            (engine.startsWith("conformance:v1") ? 5 : 4),
        },
        (_, i) => `engine identity (${engine}) > case ${i}`,
      ),
    );
  const out: Record<string, JsonReport> = {};
  for (const name of ALL_PROJECTS) {
    if (name === CHECKS_PROJECT || name === DIFF_PROJECT) {
      continue;
    }
    const isProd = name.endsWith(":prod");
    out[name] = {
      testResults: [
        ...ports
          .filter((f) => prod.has(f) === isProd)
          .map((f) => portFile(f, name)),
        self(name),
      ],
    };
  }
  const declared = new Project({ useInMemoryFileSystem: true });
  out[DIFF_PROJECT] = {
    testResults: diffTestFiles(conformance).map((rel) =>
      file(
        rel,
        staticTests(
          declared.createSourceFile(
            `/${rel}`,
            readFileSync(join(conformance, rel), "utf8"),
          ),
          DIFF_TEST_ROOTS,
        ).map((t) => t.key),
      ),
    ),
  };
  out[CHECKS_PROJECT] = {
    testResults: [
      ...walk(join(conformance, "scripts/__tests__")),
      ...walk(join(conformance, "contracts")),
    ]
      .filter((f) => f.endsWith(".test.ts"))
      .map((f) => relative(conformance, f))
      .map((rel) => {
        const text = readFileSync(join(conformance, rel), "utf8");
        const count = (text.match(/^\s*it\(/gm) ?? []).length;

        return file(
          rel,
          Array.from({ length: count }, (_, i) => `case ${i}`),
        );
      }),
  };

  return out;
}

describe("the census", () => {
  it("passes a complete run", () => {
    expect(census(repoRoot, cleanReports())).toEqual([]);
  });

  it("fails when a directory of ports did not run", () => {
    const reports = cleanReports();
    const local = reports["conformance:local"] as JsonReport;
    local.testResults = local.testResults.filter(
      (f) => !f.name.includes("/tests/plugins/"),
    );
    expect(census(repoRoot, reports).join("\n")).toMatch(
      /conformance:local: tests\/plugins\/logging\.test\.ts did not run/,
    );
  });

  it("fails when v2 skips a test at or below its layer", () => {
    const reports = cleanReports();
    const ran = reports["conformance:v2"]?.testResults
      .flatMap((f) => f.assertionResults)
      .find((a) => a.status === "passed" && !a.title.startsWith("case ")) as {
      status: string;
    };
    ran.status = "skipped";
    expect(census(repoRoot, reports).join("\n")).toMatch(
      /skipped but at or below the v2 layer/,
    );
  });

  it("fails when v2 runs a test above its layer", () => {
    const reports = cleanReports();
    const gated = reports["conformance:v2"]?.testResults
      .flatMap((f) => f.assertionResults)
      .find((a) => a.status === "skipped") as { status: string };
    gated.status = "passed";
    expect(census(repoRoot, reports).join("\n")).toMatch(
      /is above the v2 layer but passed/,
    );
  });

  it("fails when a test was skipped outside aheadOfV1", () => {
    const reports = cleanReports();
    const first = reports["conformance:local"]?.testResults[0]
      ?.assertionResults[0] as { status: string };
    first.status = "skipped";
    expect(census(repoRoot, reports).join("\n")).toMatch(/was skipped/);
  });

  it("fails on a todo", () => {
    const reports = cleanReports();
    const first = reports["conformance:v1"]?.testResults[0]
      ?.assertionResults[0] as { status: string };
    first.status = "todo";
    expect(census(repoRoot, reports).join("\n")).toMatch(/is todo/);
  });

  it("fails when the self test did not run", () => {
    const reports = cleanReports();
    const v1 = reports["conformance:v1"] as JsonReport;
    v1.testResults = v1.testResults.filter((f) => !f.name.includes("/self/"));
    expect(census(repoRoot, reports).join("\n")).toMatch(
      /conformance:v1: self\/engine-identity\.test\.ts did not run/,
    );
  });

  it("names the unbuilt entries a source imports, however it quotes them", () => {
    const entries = [
      { specifier: "@directive-run/core", file: "/n/index.ts" },
      { specifier: "@directive-run/core/testing", file: "/n/unbuilt.ts" },
      { specifier: "@directive-run/core/worker", file: "/n/unbuilt.ts" },
    ];
    const src = `import { a } from "@directive-run/core";
      vi.mock('@directive-run/core/testing', () => ({}));`;
    expect(unbuiltSpecifiers(src, entries)).toEqual([
      "@directive-run/core/testing",
    ]);
    expect(
      unbuiltSpecifiers("import x from '@directive-run/core'", entries),
    ).toEqual([]);
  });

  // A port's tests that reach a binding of an entry core-next has not built.
  const reachingUnbuilt = (rel: string) =>
    unbuiltReached(
      new Project({ useInMemoryFileSystem: true }).createSourceFile(
        `/${rel}`,
        readFileSync(join(conformance, rel), "utf8"),
      ),
      v2Entries(repoRoot),
    );

  it("fails when a v2 test ran that reaches an unbuilt entry", () => {
    const reports = cleanReports();
    let flipped: { status: string } | undefined;
    for (const f of reports["conformance:v2"]?.testResults ?? []) {
      const reached = reachingUnbuilt(relative(conformance, f.name));
      flipped = f.assertionResults.find(
        (a) =>
          a.status === "skipped" &&
          reached.has([...a.ancestorTitles, a.title].join(" > ")),
      );
      if (flipped) {
        break;
      }
    }
    expect(flipped, "a gated test that reaches an unbuilt entry").toBeDefined();
    (flipped as { status: string }).status = "passed";
    expect(census(repoRoot, reports).join("\n")).toMatch(
      /ran \(passed\) but the file imports .* which core-next has not built/,
    );
  });

  it("flags an unbuilt-entry read in the options-object form it(name, { timeout }, fn)", () => {
    // One line, so the census fixture's `^it(` count ignores this source.
    const src =
      'import { loggingPlugin } from "@directive-run/core/plugins"; import { it } from "vitest"; ' +
      'it("plain", () => {}); it("with options", { timeout: 5000 }, () => { loggingPlugin(); });';
    const reached = unbuiltReached(
      new Project({ useInMemoryFileSystem: true }).createSourceFile(
        "/options-form.test.ts",
        src,
      ),
      v2Entries(repoRoot),
    );
    expect([...reached.keys()]).toEqual(["with options"]);
  });

  it("accepts a v2 test in a file importing an unbuilt entry it never reaches", () => {
    const rel = "tests/core/derivation-deps.test.ts";
    const reached = reachingUnbuilt(rel);
    const name =
      "derivation dependencies > re-runs an effect that reads a derivation and no facts";
    expect(
      unbuiltSpecifiers(
        readFileSync(join(conformance, rel), "utf8"),
        v2Entries(repoRoot),
      ),
    ).toEqual(["@directive-run/core/testing"]);
    expect(reached.has(name)).toBe(false);
    // Every test that calls flushMicrotasks reaches it.
    const reaching = [...reached.keys()];
    expect(reaching.length).toBeGreaterThan(0);
    expect(
      reaching.every((k) =>
        reached.get(k)?.includes("@directive-run/core/testing"),
      ),
    ).toBe(true);
  });

  it("fails when a project produced no report", () => {
    const reports = cleanReports();
    delete reports[CHECKS_PROJECT];
    expect(census(repoRoot, reports).join("\n")).toMatch(
      /conformance:checks produced no report/,
    );
  });

  it("fails when v1 and local ran different tests in a file", () => {
    const reports = cleanReports();
    const file = reports["conformance:v1"]?.testResults.find((f) =>
      f.name.endsWith("tests/core/clock.test.ts"),
    ) as JsonReport["testResults"][number];
    file.assertionResults.pop();
    const text = census(repoRoot, reports).join("\n");
    expect(text).toMatch(
      /clock\.test\.ts: conformance:v1 and conformance:local ran different tests/,
    );
    expect(text).toMatch(/clock\.test\.ts ran \d+ tests, layers\.json names/);
  });

  it("fails when the tamper tests ran fewer cases than they declare", () => {
    const reports = cleanReports();
    reports[CHECKS_PROJECT]?.testResults[0]?.assertionResults.pop();
    expect(census(repoRoot, reports).join("\n")).toMatch(
      /conformance:checks: .* ran \d+ tests, expected/,
    );
  });
});

describe("the differential project", () => {
  const diffFile = (reports: Record<string, JsonReport>, suffix: string) =>
    reports[DIFF_PROJECT]?.testResults.find((f) =>
      f.name.endsWith(suffix),
    ) as JsonReport["testResults"][number];

  it("fails when a scenario file did not run", () => {
    const reports = cleanReports();
    const diff = reports[DIFF_PROJECT] as JsonReport;
    diff.testResults = diff.testResults.filter(
      (f) => !f.name.endsWith("l2-constraints-resolvers.test.ts"),
    );
    expect(census(repoRoot, reports).join("\n")).toMatch(
      /conformance:diff: diff\/scenarios\/l2-constraints-resolvers\.test\.ts did not run/,
    );
  });

  it("fails when a scenario was skipped", () => {
    const reports = cleanReports();
    const first = diffFile(reports, "l0-facts-derivations.test.ts")
      .assertionResults[0] as { status: string };
    first.status = "skipped";
    expect(census(repoRoot, reports).join("\n")).toMatch(
      /conformance:diff: .*l0-facts-derivations\.test\.ts > .* was skipped/,
    );
  });

  it("fails when a scenario is missing or renamed", () => {
    const reports = cleanReports();
    const results = diffFile(reports, "l2-constraints-resolvers.test.ts")
      .assertionResults as Array<{ title: string }>;
    (results[0] as { title: string }).title = "renamed";
    results.pop();
    const text = census(repoRoot, reports).join("\n");
    expect(text).toMatch(/l2-constraints-resolvers\.test\.ts > .* did not run/);
    expect(text).toMatch(/ran \d+ tests, declares \d+/);
  });

  it("fails when the fuzzer or the harness self tests did not run", () => {
    const reports = cleanReports();
    const diff = reports[DIFF_PROJECT] as JsonReport;
    diff.testResults = diff.testResults.filter(
      (f) => !f.name.includes("/diff/fuzz/") && !f.name.includes("/diff/self/"),
    );
    const text = census(repoRoot, reports).join("\n");
    expect(text).toMatch(/diff\/fuzz\/fuzz\.test\.ts did not run/);
    expect(text).toMatch(/diff\/self\/tamper\.test\.ts did not run/);
  });

  describe("in a copy", () => {
    let copy: string;
    beforeAll(() => {
      copy = mkdtempSync(join(tmpdir(), "conformance-diff-"));
      for (const f of ["diff", "layers.rules.json"]) {
        cpSync(join(conformance, f), join(copy, f), { recursive: true });
      }
    });
    afterAll(() => rmSync(copy, { recursive: true, force: true }));
    const withFile = (rel: string, text: string, run: () => string[]) => {
      const path = join(copy, rel);
      const before = readFileSync(path, "utf8");
      writeFileSync(path, text);
      try {
        return run().join("\n");
      } finally {
        writeFileSync(path, before);
      }
    };
    const divergences = (entries: unknown, used: string[] | null) =>
      withFile("diff/divergences.json", JSON.stringify(entries), () =>
        checkDivergences(copy, used ? new Set(used) : null),
      );
    const entry = {
      id: "d1",
      scenario: "a constraint requires, a resolver satisfies",
      stream: "observe",
      kind: "requirement.created",
      step: 1,
      op: "missing",
      reason: "v2 emits the event one step later, by design",
      approvedBy: "Jason",
      date: "2026-10-14",
    };
    const rules = () =>
      JSON.parse(readFileSync(join(copy, "layers.rules.json"), "utf8"));

    it("accepts the committed scenario layers, divergences and hook list", () => {
      expect(checkScenarioLayers(copy)).toEqual([]);
      expect(checkDivergences(copy, new Set())).toEqual([]);
      expect(
        checkHooksFired(
          copy,
          new Set(pluginHooks(copy).filter((h) => h !== "onFactDelete")),
        ),
      ).toEqual([]);
    });

    it("rejects a scenario without a layer, a layer for no scenario, a bad layer", () => {
      const edited = rules();
      const titles = Object.keys(edited.scenarios);
      const dropped = titles[0] as string;
      const bad = titles[1] as string;
      edited.scenarios = Object.fromEntries(
        Object.entries(edited.scenarios).filter(([t]) => t !== dropped),
      );
      edited.scenarios[bad] = "L99";
      edited.scenarios["a scenario that is gone"] = "L2";
      const text = withFile("layers.rules.json", JSON.stringify(edited), () =>
        checkScenarioLayers(copy),
      );
      expect(text).toContain(`scenario "${dropped}"`);
      expect(text).toContain(`scenario "${bad}"`);
      expect(text).toMatch(/names "a scenario that is gone"/);
    });

    it("rejects a duplicated or computed scenario title", () => {
      const file = "diff/scenarios/l0-facts-derivations.test.ts";
      const text = readFileSync(join(copy, file), "utf8");
      const first = text.match(/scenario\(\s*("[^"]+")/)?.[1] as string;
      const duplicated = `${text}\nscenario(${first}, () => ({}), []);\nscenario(\`computed \${1}\`, () => ({}), []);\n`;
      const out = withFile(file, duplicated, () => checkScenarioLayers(copy));
      expect(out).toMatch(/is used twice/);
      expect(out).toMatch(/needs a literal title/);
    });

    it("accepts a complete, used divergence", () => {
      expect(divergences([entry], ["d1"])).toBe("");
      const { step: _s, op: _o, ...broad } = entry;
      expect(divergences([broad], ["d1"])).toBe("");
    });

    it("rejects a stale divergence", () => {
      expect(divergences([entry], [])).toMatch(/d1 covers no difference/);
    });

    it("rejects a divergence nobody signed off", () => {
      expect(divergences([{ ...entry, approvedBy: " " }], ["d1"])).toMatch(
        /d1 needs approvedBy/,
      );
      const { approvedBy: _, ...unsigned } = entry;
      expect(divergences([unsigned], ["d1"])).toMatch(/d1 must have/);
    });

    it("rejects a malformed divergence (index-keyed paths included)", () => {
      const text = divergences(
        [
          {
            ...entry,
            stream: "trace[3]",
            kind: "",
            step: 1.5,
            op: "moved",
            reason: "x",
            date: "today",
          },
          { ...entry, extra: true },
          entry,
        ],
        ["d1"],
      );
      expect(text).toMatch(/stream must be one of/);
      expect(text).toMatch(/needs the kind/);
      expect(text).toMatch(/step must be an integer/);
      expect(text).toMatch(/op must be missing, extra or changed/);
      expect(text).toMatch(/needs a reason/);
      expect(text).toMatch(/YYYY-MM-DD/);
      expect(text).toMatch(/d1 must have/);
      expect(text).toMatch(/duplicate id d1/);
      expect(divergences({ not: "an array" }, null)).toMatch(
        /must be an array/,
      );
    });

    it("requires every hook to fire or be listed with a reason", () => {
      const hooks = pluginHooks(copy);
      expect(hooks).toHaveLength(46);
      const fired = new Set(hooks.filter((h) => h !== "onFactDelete"));
      const notFired = new Set([...fired].filter((h) => h !== "onSnapshot"));
      expect(checkHooksFired(copy, notFired).join("\n")).toMatch(
        /onSnapshot never fired/,
      );
      // Listed but fired: stale.
      expect(checkHooksFired(copy, new Set(hooks)).join("\n")).toMatch(
        /lists onFactDelete, which fired/,
      );
      const listed = withFile(
        "diff/unfired-hooks.json",
        JSON.stringify({
          onFactDelete: { reason: "short", layer: "L0" },
          onNotAHook: { reason: "a long enough reason", layer: "L0" },
        }),
        () => checkHooksFired(copy, fired),
      );
      expect(listed).toMatch(/onFactDelete needs a reason and a layer/);
      expect(listed).toMatch(/names onNotAHook, which is not a hook/);
    });
  });

  it("requires the fuzzer to run at least its floor", () => {
    expect(checkFuzzRuns([{ seed: 1, runs: FUZZ_FLOOR }])).toEqual([]);
    expect(checkFuzzRuns([])).toEqual([
      "conformance:diff: the fuzzer reported no runs",
    ]);
    expect(checkFuzzRuns([{ seed: 1, runs: 0 }]).join("\n")).toMatch(
      /ran 0 cases .* floor is 200/,
    );
    expect(checkFuzzRuns([{ seed: 1, runs: Number.NaN }])).toHaveLength(1);
  });

  it("fails the typecheck when PLUGIN_HOOKS misses a hook", () => {
    // Type-level: diff/hooks.ts asserts the list equals each engine's
    // Plugin hooks. Drop one and the compiler must refuse it.
    const dir = mkdtempSync(join(conformance, "node_modules/.hooks-tamper-"));
    try {
      writeFileSync(
        join(dir, "hooks.ts"),
        readFileSync(join(conformance, "diff/hooks.ts"), "utf8").replace(
          '  "onTraceComplete",\n',
          "",
        ),
      );
      writeFileSync(
        join(dir, "tsconfig.json"),
        JSON.stringify({
          extends: relative(dir, join(conformance, "tsconfig.json")),
          include: [],
          files: ["hooks.ts"],
        }),
      );
      const tsc = spawnSync(
        join(conformance, "node_modules/.bin/tsc"),
        ["--noEmit", "-p", join(dir, "tsconfig.json")],
        { encoding: "utf8" },
      );
      // One error per engine's assertion.
      expect(tsc.status).not.toBe(0);
      expect(tsc.stdout.match(/hooks\.ts\(\d+,\d+\): error/g)).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("aheadOfV1.json", () => {
  let copy: string;
  beforeAll(() => {
    copy = mkdtempSync(join(tmpdir(), "conformance-ahead-"));
    for (const f of ["aheadOfV1.json", "layers.json"]) {
      cpSync(join(conformance, f), join(copy, f));
    }
  });
  afterAll(() => rmSync(copy, { recursive: true, force: true }));
  const withAhead = (tests: unknown) => {
    writeFileSync(join(copy, "aheadOfV1.json"), JSON.stringify({ tests }));

    return checkAheadOfV1(copy).join("\n");
  };

  it("accepts the committed file", () => {
    expect(checkAheadOfV1(conformance)).toEqual([]);
  });

  it("rejects a whole-file wildcard", () => {
    expect(withAhead({ "tests/core/clock.test.ts": "*" })).toMatch(
      /no wildcards/,
    );
  });

  it("rejects a wildcard test name", () => {
    expect(
      withAhead({ "tests/core/clock.test.ts": { "*": "everything" } }),
    ).toMatch(/no test named "\*"/);
  });

  it("rejects an entry without a reason", () => {
    const layers = readJson(join(conformance, "layers.json"));
    const name = Object.keys(
      layers.files["tests/core/clock.test.ts"].tests,
    )[0] as string;
    expect(withAhead({ "tests/core/clock.test.ts": { [name]: "" } })).toMatch(
      /needs a reason/,
    );
  });
});

describe("the vitest config", () => {
  type Config = {
    test: {
      projects: Array<{
        test: Record<string, unknown>;
        resolve?: { alias: unknown[] };
      }>;
    };
  };
  let config: Config;
  beforeAll(async () => {
    config = (await import(join(conformance, "vitest.config.ts"))).default;
  });
  const tamper = (edit: (c: Config) => void) => {
    const copy = structuredClone(config);
    // structuredClone keeps RegExp; alias objects survive.
    edit(copy);

    return checkConfig(copy as never, repoRoot).join("\n");
  };
  const local = (c: Config) =>
    c.test.projects.find(
      (p) => p.test.name === "conformance:local",
    ) as Config["test"]["projects"][number];

  it("accepts the committed config", () => {
    expect(checkConfig(config as never, repoRoot)).toEqual([]);
  });

  it("rejects an extra setup file", () => {
    expect(
      tamper((c) => {
        local(c).test.setupFiles = [
          "helpers/layer-gate.ts",
          "helpers/zz-setup.ts",
        ];
      }),
    ).toMatch(/conformance:local test options differ/);
  });

  it("rejects a global setup", () => {
    expect(
      tamper((c) => {
        local(c).test.globalSetup = ["helpers/global.ts"];
      }),
    ).toMatch(/conformance:local test options differ/);
  });

  it("rejects an include that drops a directory", () => {
    expect(
      tamper((c) => {
        local(c).test.include = [
          ...(local(c).test.include as string[]),
          "!tests/plugins/**",
        ];
      }),
    ).toMatch(/conformance:local test options differ/);
  });

  it("rejects core aliased to another engine", () => {
    expect(
      tamper((c) => {
        const v1 = c.test.projects.find(
          (p) => p.test.name === "conformance:v1",
        );
        (local(c).resolve as { alias: unknown[] }).alias = v1?.resolve
          ?.alias as unknown[];
      }),
    ).toMatch(/conformance:local aliases differ/);
  });

  it("rejects a diff project that stops inlining v1 or narrows its include", () => {
    const diff = (c: Config) =>
      c.test.projects.find(
        (p) => p.test.name === DIFF_PROJECT,
      ) as Config["test"]["projects"][number];
    expect(
      tamper((c) => {
        diff(c).test.server = { deps: { inline: [/@directive-run\+core@/] } };
      }),
    ).toMatch(/conformance:diff differs/);
    expect(
      tamper((c) => {
        diff(c).test.include = ["diff/scenarios/**/*.test.ts"];
      }),
    ).toMatch(/conformance:diff differs/);
    expect(
      tamper((c) => {
        diff(c).test.setupFiles = ["helpers/zz-setup.ts"];
      }),
    ).toMatch(/conformance:diff differs/);
  });

  it("rejects server deps or a dropped project", () => {
    expect(
      tamper((c) => {
        (local(c) as Record<string, unknown>).server = {
          deps: { inline: [/x/] },
        };
      }),
    ).toMatch(/may only hold resolve and test/);
    expect(
      tamper((c) => {
        c.test.projects = c.test.projects.filter(
          (p) => p.test.name !== "conformance:v1:prod",
        );
      }),
    ).toMatch(/projects must be exactly/);
  });
});

describe("the harness lock", () => {
  let copy: string;
  beforeAll(() => {
    copy = mkdtempSync(join(tmpdir(), "conformance-lock-"));
    for (const f of [
      "helpers",
      "self",
      "lib",
      "scripts",
      "diff",
      "contracts",
      "vitest.config.ts",
      "tsconfig.json",
      "package.json",
      "aheadOfV1.json",
      "oracle-baseline.json",
      "v1-pin.json",
      "harness.lock.json",
    ]) {
      cpSync(join(conformance, f), join(copy, f), { recursive: true });
    }
  });
  afterAll(() => rmSync(copy, { recursive: true, force: true }));
  const tampered = (edit: () => void, undo: () => void) => {
    edit();
    try {
      return checkLock(copy).join("\n");
    } finally {
      undo();
    }
  };

  it("accepts the committed harness", () => {
    expect(checkLock(copy)).toEqual([]);
  });

  it("rejects check-expects filtering its own failures", () => {
    const path = join(copy, "lib/check.ts");
    const before = readFileSync(path, "utf8");
    expect(
      tampered(
        () =>
          writeFileSync(
            path,
            before.replace(
              "return { failures, files",
              "return { failures: [], files",
            ),
          ),
        () => writeFileSync(path, before),
      ),
    ).toMatch(/lib\/check\.ts differs/);
  });

  it("rejects a deleted self test", () => {
    const path = join(copy, "self/engine-identity.test.ts");
    const before = readFileSync(path, "utf8");
    expect(
      tampered(
        () => rmSync(path),
        () => writeFileSync(path, before),
      ),
    ).toMatch(/engine-identity\.test\.ts is in the lock but missing/);
  });

  it("rejects an added setup file", () => {
    const path = join(copy, "helpers/zz-setup.ts");
    expect(
      tampered(
        () => writeFileSync(path, "export {};\n"),
        () => rmSync(path),
      ),
    ).toMatch(/helpers\/zz-setup\.ts is not in harness\.lock\.json/);
  });

  it("rejects an edited skip gate and aheadOfV1", () => {
    const gate = join(copy, "helpers/layer-gate.ts");
    const before = readFileSync(gate, "utf8");
    expect(
      tampered(
        () => writeFileSync(gate, before.replace("ctx.skip();", "return;")),
        () => writeFileSync(gate, before),
      ),
    ).toMatch(/layer-gate\.ts differs/);
    const ahead = join(copy, "aheadOfV1.json");
    const aheadBefore = readFileSync(ahead, "utf8");
    expect(
      tampered(
        () =>
          writeFileSync(ahead, '{"tests":{"tests/core/clock.test.ts":"*"}}'),
        () => writeFileSync(ahead, aheadBefore),
      ),
    ).toMatch(/aheadOfV1\.json differs/);
  });
});

describe("the oracle guard", () => {
  let copy: string;
  beforeAll(() => {
    copy = mkdtempSync(join(tmpdir(), "conformance-guard-"));
    for (const f of [
      "layers.rules.json",
      "layers.json",
      "oracle-baseline.json",
    ]) {
      cpSync(join(conformance, f), join(copy, f));
    }
  });
  afterAll(() => rmSync(copy, { recursive: true, force: true }));
  const OWN_WRITE = "tests/core/resolver-satisfied-by-own-write.test.ts";
  const withRules = (
    edit: (rules: { rules: Record<string, Record<string, unknown>> }) => void,
  ) => {
    const path = join(copy, "layers.rules.json");
    const before = readFileSync(path, "utf8");
    const rules = JSON.parse(before);
    edit(rules);
    writeFileSync(path, JSON.stringify(rules));
    try {
      return checkBaseline(copy).join("\n");
    } finally {
      writeFileSync(path, before);
    }
  };

  it("accepts the committed rules", () => {
    expect(checkBaseline(copy)).toEqual([]);
  });

  it("rejects unpinning a correctness file", () => {
    expect(
      withRules((r) => {
        (r.rules[OWN_WRITE] as Record<string, unknown>).pin = false;
      }),
    ).toMatch(/resolver-satisfied-by-own-write\.test\.ts was unpinned/);
  });

  it("rejects dropping an instrument", () => {
    expect(
      withRules((r) => {
        (r.rules[OWN_WRITE] as Record<string, unknown>).instruments = [];
      }),
    ).toMatch(/instrument "option plugins" was dropped/);
  });

  it("rejects a new allowAbove", () => {
    expect(
      withRules((r) => {
        const rule = r.rules[OWN_WRITE] as {
          allowAbove: Record<string, string>;
        };
        rule.allowAbove["option plugins"] = "convenient";
      }),
    ).toMatch(/allowAbove "option plugins" was added/);
  });

  it("rejects a correctness test moved up a layer", () => {
    const path = join(copy, "layers.json");
    const before = readFileSync(path, "utf8");
    const layers = JSON.parse(before);
    const tests = layers.files[OWN_WRITE].tests;
    const name = Object.keys(tests).find(
      (k) => tests[k].layer === "L2",
    ) as string;
    tests[name].layer = "L13";
    writeFileSync(path, JSON.stringify(layers));
    try {
      expect(checkBaseline(copy).join("\n")).toMatch(/moved up from L2 to L13/);
    } finally {
      writeFileSync(path, before);
    }
  });

  it("allows tightening: a new pin", () => {
    expect(
      withRules((r) => {
        (r.rules["tests/core/clock.test.ts"] as Record<string, unknown>).pin =
          true;
      }),
    ).toBe("");
  });

  it("needs the label for any harness change, lock untouched or not", () => {
    for (const path of [
      // The reviewer's attack: a stubbed census and a swap setup file, with
      // the lock left alone.
      "packages/conformance/scripts/census.ts",
      "packages/conformance/helpers/zz-setup.ts",
      "packages/conformance/harness.lock.json",
      "packages/conformance/oracle-baseline.json",
      "packages/conformance/layers.rules.json",
      "packages/conformance/v1-pin.json",
      ".github/workflows/ci.yml",
      ".github/workflows/oracle-guard.yml",
      "package.json",
      "pnpm-workspace.yaml",
      ".npmrc",
    ]) {
      expect(checkPullRequest([path], []).join("\n"), path).toMatch(
        /needs the oracle-change label/,
      );
      expect(checkPullRequest([path], ["oracle-change"]), path).toEqual([]);
    }
  });

  it("does not need the label for ports, docs or other packages", () => {
    expect(
      checkPullRequest(
        [
          "packages/conformance/tests/core/clock.test.ts",
          "packages/conformance/README.md",
          "packages/conformance/layers.json",
          "packages/core/src/core/engine.ts",
          "packages/react/package.json",
        ],
        [],
      ),
    ).toEqual([]);
  });

  describe("pnpm-lock.yaml", () => {
    const base = readFileSync(join(repoRoot, "pnpm-lock.yaml"), "utf8");
    const changed = ["pnpm-lock.yaml"];
    const edit = (from: string, to: string) => {
      const head = base.replace(from, to);
      expect(head).not.toBe(base);

      return checkPullRequest(changed, [], { base, head }).join("\n");
    };

    it("needs the label when the release the alias resolves changes", () => {
      expect(
        edit(
          "  '@directive-run/core@1.35.0':\n    resolution: {integrity: sha512-",
          "  '@directive-run/core@1.35.0':\n    resolution: {integrity: sha512-X",
        ),
      ).toMatch(/pnpm-lock\.yaml \(directive-v1 \/ vitest entries\)/);
    });

    it("needs the label when vitest moves", () => {
      expect(edit("\n  vitest@3.2.7:\n", "\n  vitest@3.2.8:\n")).toMatch(
        /needs the oracle-change label/,
      );
    });

    it("needs the label for an override", () => {
      expect(
        edit(
          "\nimporters:\n",
          "\noverrides:\n  '@directive-run/core': 1.34.1\n\nimporters:\n",
        ),
      ).toMatch(/needs the oracle-change label/);
    });

    it("does not need it for an unrelated package", () => {
      expect(
        edit(
          "  '@emnapi/runtime@1.11.3':\n    resolution: {integrity: sha512-",
          "  '@emnapi/runtime@1.11.3':\n    resolution: {integrity: sha512-X",
        ),
      ).toBe("");
    });
  });

  it("keeps engine and oracle changes in separate PRs, label or not", () => {
    for (const harness of [
      "packages/conformance/vitest.config.ts",
      "packages/conformance/helpers/layer-gate.ts",
      "packages/conformance/self/engine-identity.test.ts",
      "packages/conformance/lib/check.ts",
      "packages/conformance/scripts/census.ts",
      "packages/conformance/layers.rules.json",
      "packages/conformance/aheadOfV1.json",
      "packages/conformance/tsconfig.json",
    ]) {
      const changed = ["packages/core-next/src/kernel.ts", harness];
      expect(checkPullRequest(changed, ["oracle-change"]).join("\n")).toMatch(
        /changes packages\/core-next and the conformance harness/,
      );
    }
    expect(
      checkPullRequest(
        [
          "packages/core-next/src/kernel.ts",
          "packages/conformance/tests/core/clock.test.ts",
        ],
        [],
      ),
    ).toEqual([]);
  });
});

describe("the v1 pin", () => {
  let copy: string;
  const pin = () => readJson(join(conformance, "v1-pin.json"));
  const lockfile = readFileSync(join(repoRoot, "pnpm-lock.yaml"), "utf8");
  beforeAll(() => {
    copy = mkdtempSync(join(tmpdir(), "conformance-v1-"));
    cpSync(join(conformance, "node_modules/directive-v1"), copy, {
      recursive: true,
      dereference: true,
    });
  });
  afterAll(() => rmSync(copy, { recursive: true, force: true }));
  const check = (overrides: Partial<Parameters<typeof checkV1Pin>[0]> = {}) =>
    checkV1Pin({
      pin: pin(),
      pinnedVersion: pin().version,
      lockfile,
      packageDir: copy,
      ...overrides,
    }).join("\n");

  it("accepts the installed release", () => {
    expect(check()).toBe("");
  });

  it("rejects a patched file", () => {
    const file = join(copy, "dist/development/index.js");
    const before = readFileSync(file, "utf8");
    writeFileSync(file, `${before}\n// patched\n`);
    try {
      expect(check()).toMatch(
        /dist\/development\/index\.js differs from the npm tarball/,
      );
    } finally {
      writeFileSync(file, before);
    }
  });

  it("rejects an added file", () => {
    const file = join(copy, "dist/extra.js");
    writeFileSync(file, "export {};\n");
    try {
      expect(check()).toMatch(/dist\/extra\.js is not in the npm tarball/);
    } finally {
      rmSync(file);
    }
  });

  it("rejects a lockfile that resolves a different tarball", () => {
    expect(
      check({
        lockfile: lockfile.replace(
          "  '@directive-run/core@1.35.0':\n    resolution: {integrity: sha512-",
          "  '@directive-run/core@1.35.0':\n    resolution: {integrity: sha512-X",
        ),
      }),
    ).toMatch(/pnpm-lock\.yaml records sha512-X/);
  });

  it("rejects an alias moved without re-pinning", () => {
    expect(check({ pinnedVersion: "1.36.0" })).toMatch(/run pin:v1/);
  });
});
