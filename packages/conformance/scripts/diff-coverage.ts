/**
 * How much of the workspace engine the differential project reaches:
 * function coverage of packages/core/src (V8 precise coverage, diff/coverage.ts) and
 * which plugin hooks fired, for the scenarios, the fuzzer, or both.
 * A report, not a gate (the census gates hooks); run it when changing the
 * scenarios or the fuzz model.
 *
 * Usage: pnpm --filter @directive-run/conformance diff:coverage [scenarios|fuzz|all]
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pluginHooks } from "../lib/census.js";
import { defaultRepoRoot } from "../lib/core-entries.js";

const conformanceRoot = join(defaultRepoRoot, "packages/conformance");
const coreSrc = join(defaultRepoRoot, "packages/core/src/");
const which = process.argv[2] ?? "all";
const files =
  which === "scenarios"
    ? ["diff/scenarios"]
    : which === "fuzz"
      ? ["diff/fuzz"]
      : ["diff/scenarios", "diff/fuzz"];

const out = mkdtempSync(join(tmpdir(), "diff-coverage-"));
try {
  const v8 = join(out, "v8");
  const logs = join(out, "logs");
  const result = spawnSync(
    join(conformanceRoot, "node_modules/.bin/vitest"),
    [
      "run",
      "--config",
      "vitest.config.ts",
      "--project",
      "conformance:diff",
      ...files,
    ],
    {
      cwd: conformanceRoot,
      stdio: ["ignore", "ignore", "inherit"],
      env: { ...process.env, DIFF_COVERAGE_DIR: v8, DIFF_LOG_DIR: logs },
    },
  );
  if (result.status !== 0) {
    console.error(`[diff-coverage] vitest exited ${result.status}`);
  }

  // Merge per-function call counts across every worker's dump.
  const fns = new Map<string, number>();
  for (const name of existsSync(v8) ? readdirSync(v8) : []) {
    const dump = JSON.parse(readFileSync(join(v8, name), "utf8")) as {
      result: Array<{
        url: string;
        functions: Array<{
          functionName: string;
          ranges: Array<{ startOffset: number; count: number }>;
        }>;
      }>;
    };
    for (const script of dump.result) {
      const path = script.url.startsWith("file://")
        ? fileURLToPath(script.url)
        : script.url;
      if (!path.startsWith(coreSrc) || path.includes("__tests__")) {
        continue;
      }
      for (const fn of script.functions) {
        const range = fn.ranges[0];
        if (!range || (!fn.functionName && range.startOffset === 0)) {
          continue; // the module wrapper
        }
        const key = `${path.slice(coreSrc.length)}:${fn.functionName}:${range.startOffset}`;
        fns.set(key, Math.max(fns.get(key) ?? 0, range.count));
      }
    }
  }
  const total = fns.size;
  const hit = [...fns.values()].filter((n) => n > 0).length;
  const byFile = new Map<string, [number, number]>();
  for (const [key, count] of fns) {
    const file = key.slice(0, key.indexOf(":"));
    const [h, t] = byFile.get(file) ?? [0, 0];
    byFile.set(file, [h + (count > 0 ? 1 : 0), t + 1]);
  }
  const fired = new Set(
    existsSync(join(logs, "hooks-fired.txt"))
      ? readFileSync(join(logs, "hooks-fired.txt"), "utf8")
          .split("\n")
          .filter(Boolean)
      : [],
  );
  const hooks = pluginHooks(conformanceRoot);
  console.log(
    `[diff-coverage] ${which}: ${hit}/${total} core functions (${total ? ((100 * hit) / total).toFixed(1) : 0}%), ${hooks.filter((h) => fired.has(h)).length}/${hooks.length} hooks`,
  );
  console.log(
    `  hooks not fired: ${hooks.filter((h) => !fired.has(h)).join(", ") || "none"}`,
  );
  console.log("  most functions not reached:");
  for (const [file, [h, t]] of [...byFile]
    .sort(([, a], [, b]) => b[1] - b[0] - (a[1] - a[0]))
    .slice(0, Number(process.env.TOP ?? 15))) {
    console.log(
      `    ${((100 * h) / t).toFixed(0).padStart(3)}%  ${h}/${t}  ${file}`,
    );
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
