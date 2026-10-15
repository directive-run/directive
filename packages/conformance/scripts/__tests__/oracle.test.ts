/**
 * The census, the harness lock and the oracle guard catch what they claim.
 *
 * Census cases feed synthetic vitest reports (built from layers.json, so the
 * clean report is exactly what a full run produces) and tamper with them.
 * Lock and guard cases tamper with a copy of the harness.
 */

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
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  ALL_PROJECTS,
  CHECKS_PROJECT,
  type JsonReport,
  census,
  checkAheadOfV1,
  checkConfig,
  prodPorts,
} from "../../lib/census.js";
import { coreEntries } from "../../lib/core-entries.js";
import { checkBaseline, checkPullRequest } from "../../lib/guard.js";
import { checkLock } from "../../lib/harness.js";
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
  const layers = readJson(join(conformance, "layers.json")).files as Record<
    string,
    { tests: Record<string, unknown> }
  >;
  const prod = new Set(prodPorts(conformance));
  const ports = Object.keys(layers).filter((f) => f.endsWith(".test.ts"));
  const file = (rel: string, names: string[]) => ({
    name: join(conformance, rel),
    assertionResults: names.map((n) => {
      const parts = n.split(" > ");

      return {
        ancestorTitles: parts.slice(0, -1),
        title: parts[parts.length - 1] as string,
        status: "passed",
      };
    }),
  });
  const portFile = (rel: string) =>
    file(
      rel,
      Object.keys(layers[rel]?.tests ?? {}).map((k) => k.replace(/ #\d+$/, "")),
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
    if (name === CHECKS_PROJECT) {
      continue;
    }
    const isProd = name.endsWith(":prod");
    out[name] = {
      testResults: [
        ...ports.filter((f) => prod.has(f) === isProd).map(portFile),
        self(name),
      ],
    };
  }
  out[CHECKS_PROJECT] = {
    testResults: walk(join(conformance, "scripts/__tests__"))
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
