/**
 * The P3-F1 migration: give every divergences.json entry the fingerprint of
 * what it excuses today (diff/fingerprint.ts), narrowing it, never widening.
 *
 * It runs the differential project on the current engines with the file as
 * it is (an entry without a fingerprint is still the old wildcard over its
 * class) and reads back every difference each entry covered. Then:
 *
 * - a hand scenario's entry without `excuses` gets one excuse per distinct
 *   record it covered, with the number of copies as its `count`;
 * - a fuzz entry without `bound` gets the patterns its covered records
 *   generalize to (`generalize`). An entry that covered nothing (its group
 *   kept it in use) is bounded by the records of its class the run showed
 *   (covered by another entry, or past an `ends` stop), so the bound still
 *   says what it would excuse; it is listed for review.
 *
 * Entries that already have a fingerprint are left as they are, and so is
 * every other field (approvals included): each entry keeps its key order,
 * with the fingerprint inserted before `reason`. Entries that covered nothing
 * and have no class sample are listed and left unfingerprinted (the census
 * then fails them).
 *
 * Usage: tsx scripts/fingerprint-divergences.ts [--logs <dir> ...]
 *   --logs  also read a DIFF_LOG_DIR of another run made with
 *           DIFF_COVERAGE_LOG=1 (a deep fuzz seed), for more fuzz samples.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Difference } from "../diff/compare.js";
import { type Excuse, canonicalJson, generalize } from "../diff/fingerprint.js";
import type { Json } from "../diff/normalize.js";
import { type Divergence, FUZZ_SCENARIO, covers } from "../diff/scenario.js";
import { defaultRepoRoot } from "../lib/core-entries.js";

const conformanceRoot = join(defaultRepoRoot, "packages/conformance");
const file = join(conformanceRoot, "diff/divergences.json");
const extra = process.argv.flatMap((a, i, all) =>
  all[i - 1] === "--logs" ? [a] : [],
);

const out = mkdtempSync(join(tmpdir(), "conformance-fingerprint-"));
const lines = (dir: string, name: string) =>
  existsSync(join(dir, name))
    ? readFileSync(join(dir, name), "utf8").split("\n").filter(Boolean)
    : [];
let covered: { scenario: string; id: string; excuse: Excuse }[] = [];
let fuzzDiffs: Difference[] = [];
try {
  const run = spawnSync(
    join(conformanceRoot, "node_modules/.bin/vitest"),
    ["run", "--config", "vitest.config.ts", "--project", "conformance:diff"],
    {
      cwd: conformanceRoot,
      stdio: "inherit",
      env: { ...process.env, DIFF_LOG_DIR: out, DIFF_COVERAGE_LOG: "1" },
    },
  );
  if (run.status !== 0) {
    console.error(`[fingerprint] the differential run exited ${run.status}`);
    process.exit(1);
  }
  for (const dir of [out, ...extra]) {
    covered = covered.concat(
      lines(dir, "covered.jsonl").map((l) => JSON.parse(l)),
    );
    fuzzDiffs = fuzzDiffs.concat(
      lines(dir, "fuzz-differences.jsonl").map((l) => JSON.parse(l)),
    );
  }
  // Hand counts come from the PR run alone: a hand scenario runs once there.
  const handCovered = lines(out, "covered.jsonl")
    .map((l) => JSON.parse(l) as (typeof covered)[number])
    .filter((c) => c.scenario !== FUZZ_SCENARIO);

  const entries = JSON.parse(readFileSync(file, "utf8")) as Divergence[];
  const report: string[] = [];
  const asDifference = (x: Excuse, op: Difference["op"]) =>
    ({
      op,
      path: x.path,
      reference: op === "missing" ? x.record : x.from,
      candidate: op === "extra" ? x.record : x.to,
    }) as Difference;
  const migrated = entries.map((e) => {
    if (e.scenario !== FUZZ_SCENARIO) {
      if (e.excuses !== undefined) {
        return e;
      }
      const counts = new Map<string, Excuse>();
      for (const c of handCovered.filter((c) => c.id === e.id)) {
        const { count: _c, ...fp } = c.excuse;
        const key = canonicalJson(fp as Json);
        const had = counts.get(key);
        counts.set(key, had ? { ...had, count: had.count + 1 } : c.excuse);
      }
      if (counts.size === 0) {
        report.push(`hand ${e.id}: covered nothing (dead), left as is`);
        return e;
      }
      const n = [...counts.values()].reduce((s, x) => s + x.count, 0);
      if (n > 1) {
        report.push(`hand ${e.id}: ${n} records, ${counts.size} distinct`);
      }
      return withField(e, "excuses", [...counts.values()]);
    }
    if (e.bound !== undefined) {
      return e;
    }
    const op = e.op;
    const own = covered
      .filter((c) => c.id === e.id)
      .map((c) =>
        asDifference(c.excuse, op ?? (c.excuse.path ? "changed" : "extra")),
      );
    // The class of an entry that covered nothing itself: its own records'
    // kind and shape, as the run showed them (`when` read as satisfied).
    const unbounded = { ...e, bound: undefined } as Divergence;
    const samples =
      own.length > 0
        ? own
        : fuzzDiffs.filter((d) => covers(unbounded, FUZZ_SCENARIO, d, e.when));
    const patterns = new Map<string, Json>();
    for (const d of samples) {
      const p = generalize(d, e.path);
      patterns.set(canonicalJson(p), p);
    }
    if (patterns.size === 0) {
      report.push(
        `fuzz ${e.id}: no record of its class in any run, left as is`,
      );
      return e;
    }
    report.push(
      `fuzz ${e.id}: ${own.length > 0 ? `${own.length} covered` : `0 covered, ${samples.length} of its class`} -> ${patterns.size} pattern(s)`,
    );
    return withField(e, "bound", { match: [...patterns.values()] });
  });
  writeFileSync(file, `${JSON.stringify(migrated, null, 2)}\n`);
  console.log(report.join("\n"));
  console.log(`[fingerprint] wrote ${file}; run biome format on it`);
} finally {
  rmSync(out, { recursive: true, force: true });
}

/** `e` with `key` set, inserted before `reason` (key order kept). */
function withField(e: Divergence, key: string, value: unknown): Divergence {
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) {
    if (k === "reason") {
      next[key] = value;
    }
    next[k] = v;
  }
  return next as unknown as Divergence;
}
