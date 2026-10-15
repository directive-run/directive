/**
 * The check catches what it claims to catch.
 *
 * Each case tampers with a copy of the repo slice the check reads (core's
 * tests and sources, the ports and their metadata) and asserts the check
 * fails, naming the problem. The baseline proves the copy itself is clean, so
 * a failure is caused by the tamper and nothing else.
 */

import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { check } from "../../lib/check.js";

// Each case does seconds of synchronous work (a full re-classification).
// Yield a macrotask after each, so vitest's worker RPC is answered between
// cases instead of timing out behind a run of them.
afterEach(() => new Promise<void>((resolve) => setImmediate(resolve)));

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
let copy: string;

const SLICE = [
  "tsconfig.base.json",
  "packages/core/src",
  "packages/core/__tests__",
  "packages/core/package.json",
  "packages/core/tsup.config.ts",
  "packages/core/tsconfig.json",
  "packages/conformance/tests",
  "packages/conformance/scripts/manifest.json",
  "packages/conformance/scripts/classification.json",
  "packages/conformance/layers.json",
  "packages/conformance/layers.rules.json",
  "packages/conformance/tsconfig.json",
];

beforeAll(() => {
  copy = mkdtempSync(join(tmpdir(), "conformance-check-"));
  for (const path of SLICE) {
    cpSync(join(repoRoot, path), join(copy, path), { recursive: true });
  }
});

afterAll(() => {
  rmSync(copy, { recursive: true, force: true });
});

/** Apply `edits` to the copy, run the check, then put every file back. */
function tampered(
  edits: Record<string, ((text: string) => string | null) | string>,
): string[] {
  const saved = new Map<string, string | null>();
  try {
    for (const [path, edit] of Object.entries(edits)) {
      const full = join(copy, path);
      const before = existsSync(full) ? readFileSync(full, "utf8") : null;
      saved.set(full, before);
      const after = typeof edit === "string" ? edit : edit(before ?? "");
      if (after === null) {
        rmSync(full);
      } else {
        writeFileSync(full, after);
      }
    }

    return check(copy).failures;
  } finally {
    for (const [full, before] of saved) {
      if (before === null) {
        rmSync(full, { force: true });
      } else {
        writeFileSync(full, before);
      }
    }
  }
}

const json = (path: string) =>
  JSON.parse(readFileSync(join(copy, path), "utf8"));
const replaceOnce = (from: string | RegExp, to: string) => (text: string) => {
  const out = text.replace(from, to);
  if (out === text) {
    throw new Error(`tamper did not apply: ${from}`);
  }

  return out;
};

const CLOCK = "packages/conformance/tests/core/clock.test.ts";
const PROD =
  "packages/conformance/tests/core/effect-readonly-facts-production.test.ts";
const CORE_CLOCK = "packages/core/src/core/__tests__/clock.test.ts";

describe("the conformance check", () => {
  it("passes on an untouched copy", () => {
    expect(check(copy).failures).toEqual([]);
  });

  describe("imports", () => {
    it("rejects vitest swapped for a local fake", () => {
      const failures = tampered({
        [CLOCK]: replaceOnce('from "vitest"', 'from "../../fake-vitest.js"'),
      });
      expect(failures.join("\n")).toMatch(
        /fake-vitest\.js, which is not allowed/,
      );
    });

    it("rejects core pointed at a local stub", () => {
      const failures = tampered({
        [CLOCK]: replaceOnce('from "@directive-run/core"', 'from "./stub.js"'),
      });
      expect(failures.join("\n")).toMatch(/stub\.js, which is not allowed/);
    });

    it("rejects a core import moved to another entry point", () => {
      const failures = tampered({
        [CLOCK]: replaceOnce(
          'from "@directive-run/core"',
          'from "@directive-run/core/internals"',
        ),
      });
      expect(failures.join("\n")).toMatch(/import missing or changed/);
    });

    it("rejects an added binding", () => {
      const failures = tampered({
        [CLOCK]: replaceOnce("realClock,", "realClock as rc, realClock,"),
      });
      expect(failures.join("\n")).toMatch(
        /import not in a fresh port: @directive-run\/core\|realClock as rc/,
      );
    });

    it("rejects a dropped binding", () => {
      const failures = tampered({
        [CLOCK]: replaceOnce(", virtualClock }", " }"),
      });
      expect(failures.join("\n")).toMatch(
        /import missing or changed: @directive-run\/core\|virtualClock/,
      );
    });

    it("rejects a changed dynamic import in a production test", () => {
      const failures = tampered({
        [PROD]: replaceOnce(
          'await import("@directive-run/core")',
          'await import("../../stub.js")',
        ),
      });
      const text = failures.join("\n");
      expect(text).toMatch(/import\("\.\.\/\.\.\/stub\.js"\) is not allowed/);
      expect(text).toMatch(/dynamic specifier differs/);
    });

    it("rejects a dynamic import moved to another allowed entry point", () => {
      const failures = tampered({
        [PROD]: replaceOnce(
          'await import("@directive-run/core")',
          'await import("@directive-run/core/internals")',
        ),
      });
      expect(failures.join("\n")).toMatch(/dynamic specifier differs/);
    });
  });

  describe("bodies and assertions", () => {
    it("rejects an edited assertion", () => {
      const failures = tampered({
        [CLOCK]: replaceOnce(".toBe(", ".toEqual("),
      });
      expect(failures.join("\n")).toMatch(/assertion missing or changed/);
    });

    it("rejects an added line outside the imports", () => {
      const failures = tampered({
        [CLOCK]: (text) => `${text}\nconst sneaky = 1;\n`,
      });
      expect(failures.join("\n")).toMatch(/differs from a fresh port/);
    });
  });

  describe("classification", () => {
    it("rejects a port deleted along with its manifest, layer and classification", () => {
      const out = "tests/core/clock.test.ts";
      const manifest = json("packages/conformance/scripts/manifest.json");
      delete manifest[out];
      const layers = json("packages/conformance/layers.json");
      delete layers.files[out];
      const rules = json("packages/conformance/layers.rules.json");
      delete rules.rules[out];
      const classification = json(
        "packages/conformance/scripts/classification.json",
      ).map((c: { file: string; category: string }) =>
        c.file === "src/core/__tests__/clock.test.ts"
          ? { ...c, category: "white-box" }
          : c,
      );
      const failures = tampered({
        [CLOCK]: () => null,
        "packages/conformance/scripts/manifest.json": `${JSON.stringify(manifest, null, 2)}\n`,
        "packages/conformance/layers.json": `${JSON.stringify(layers, null, 2)}\n`,
        "packages/conformance/layers.rules.json": `${JSON.stringify(rules, null, 2)}\n`,
        "packages/conformance/scripts/classification.json": `${JSON.stringify(classification, null, 2)}\n`,
      });
      const text = failures.join("\n");
      expect(text).toMatch(
        /classification\.json is stale or edited \(src\/core\/__tests__\/clock\.test\.ts\)/,
      );
      expect(text).toMatch(/tests\/core\/clock\.test\.ts is missing/);
    });

    it("rejects a file under tests/ that is not a port", () => {
      const failures = tampered({
        "packages/conformance/tests/core/extra.test.ts":
          'import { it } from "vitest";\nit("passes", () => {});\n',
      });
      expect(failures.join("\n")).toMatch(
        /tests\/core\/extra\.test\.ts is not a port/,
      );
    });

    it("rejects a port whose original now imports a private module", () => {
      const failures = tampered({
        [CORE_CLOCK]: (text) =>
          `import { createClockForTest } from "../clock-private.js";\nvoid createClockForTest;\n${text}`,
        "packages/core/src/core/clock-private.ts":
          "export const createClockForTest = () => 0;\n",
      });
      const text = failures.join("\n");
      expect(text).toMatch(/classification\.json is stale/);
      expect(text).toMatch(/tests\/core\/clock\.test\.ts is not a port/);
    });

    it("rejects a core test added since the last port", () => {
      const failures = tampered({
        "packages/core/src/core/__tests__/brand-new.test.ts":
          'import { it } from "vitest";\nit("is new", () => {});\n',
      });
      expect(failures.join("\n")).toMatch(
        /tests\/core\/brand-new\.test\.ts is missing/,
      );
    });
  });

  describe("layers", () => {
    it("rejects a pinned test lifted above its rule without a reason", () => {
      const rules = json("packages/conformance/layers.rules.json");
      rules.rules[
        "tests/core/resolver-satisfied-by-own-write.test.ts"
      ].instruments = [];
      const failures = tampered({
        "packages/conformance/layers.rules.json": `${JSON.stringify(rules, null, 2)}\n`,
      });
      expect(failures.join("\n")).toMatch(
        /resolver-satisfied-by-own-write\.test\.ts: ".*" sits at L3, above its rule L2, through option plugins/,
      );
    });

    it("rejects a hand-edited test layer", () => {
      const layers = json("packages/conformance/layers.json");
      const file = layers.files["tests/core/clock.test.ts"];
      const first = Object.keys(file.tests)[0] as string;
      file.tests[first].layer = "L0";
      const failures = tampered({
        "packages/conformance/layers.json": `${JSON.stringify(layers, null, 2)}\n`,
      });
      expect(failures.join("\n")).toMatch(
        /layers\.json entry for tests\/core\/clock\.test\.ts does not match/,
      );
    });
  });

  it("rejects typecheck paths that resolve core anywhere but its sources", () => {
    const failures = tampered({
      "packages/conformance/tsconfig.json": replaceOnce(
        '"../core/src/index.ts"',
        '"./stub.ts"',
      ),
    });
    expect(failures.join("\n")).toMatch(/tsconfig\.json must be exactly/);
  });

  it("rejects a typecheck emptied by an exclude", () => {
    const failures = tampered({
      "packages/conformance/tsconfig.json": (text) =>
        JSON.stringify({ ...JSON.parse(text), exclude: ["tests", "self"] }),
    });
    expect(failures.join("\n")).toMatch(/tsconfig\.json must be exactly/);
  });

  it("rejects strict turned off in the base config", () => {
    const failures = tampered({
      "tsconfig.base.json": replaceOnce('"strict": true', '"strict": false'),
    });
    expect(failures.join("\n")).toMatch(/must keep strict: true/);
  });
});
