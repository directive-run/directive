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
 * A fuzz entry's bound must describe its record class, not one seed's
 * literals, so its samples come from many seeds: `--seeds` runs the fuzz once
 * more per seed (at the PR run count) and adds what each run showed, and
 * `--rebound` regenerates every fuzz bound that way. It runs every fuzz
 * entry as the old wildcard over its class (the file is written without
 * fuzz bounds for the runs, then restored), so what an entry covered is
 * still what it covered before fingerprints, never more. Each entry keeps
 * every pattern it had, re-generalized with the current classes
 * (`generalizeValue`), and gains the patterns its records showed.
 *
 * Usage: tsx scripts/fingerprint-divergences.ts [--rebound] [--seeds 1-20]
 *          [--logs <dir> ...]
 *   --rebound  regenerate every fuzz bound (above); hand excuses are kept
 *   --seeds    extra fuzz seeds to run at the PR run count: `1-20` or `1,7`
 *   --logs     also read a DIFF_LOG_DIR of another run made with
 *              DIFF_COVERAGE_LOG=1 (a deep fuzz seed), for more fuzz samples.
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
import {
  type Excuse,
  canonicalJson,
  generalize,
  generalizeValue,
} from "../diff/fingerprint.js";
import type { Json } from "../diff/normalize.js";
import type { Divergence } from "../diff/scenario.js";
import { defaultRepoRoot } from "../lib/core-entries.js";

/** The scenario name of the fuzz cases (diff/scenario.ts `FUZZ_SCENARIO`; that module needs vitest). */
const FUZZ_SCENARIO = "fuzz";

/**
 * Whether fuzz difference `d` is of entry `e`'s class: what diff/scenario.ts
 * `covers` matched before fingerprints (stream, kind, engine, op, path
 * prefix), with `when` read as satisfied.
 */
function inClass(e: Divergence, d: Difference): boolean {
  return (
    e.stream === d.stream &&
    e.kind === d.kind &&
    (e.engine === undefined || e.engine === d.engine) &&
    (e.op === undefined || e.op === d.op) &&
    (e.path === undefined ||
      (d.path !== undefined &&
        (d.path === e.path ||
          d.path.startsWith(`${e.path}.`) ||
          d.path.startsWith(`${e.path}[`))))
  );
}

const conformanceRoot = join(defaultRepoRoot, "packages/conformance");
const file = join(conformanceRoot, "diff/divergences.json");
const extra = process.argv.flatMap((a, i, all) =>
  all[i - 1] === "--logs" ? [a] : [],
);
const rebound = process.argv.includes("--rebound");
const seeds = process.argv
  .flatMap((a, i, all) => (all[i - 1] === "--seeds" ? a.split(",") : []))
  .flatMap((r) => {
    const [lo, hi = lo] = r.split("-").map(Number) as [number, number?];
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  });
const original = readFileSync(file, "utf8");
const before = JSON.parse(original) as Divergence[];
const vitest = (args: string[], env: NodeJS.ProcessEnv) =>
  spawnSync(
    join(conformanceRoot, "node_modules/.bin/vitest"),
    [
      "run",
      "--config",
      "vitest.config.ts",
      "--project",
      "conformance:diff",
      ...args,
    ],
    { cwd: conformanceRoot, stdio: "inherit", env: { ...process.env, ...env } },
  ).status;

const out = mkdtempSync(join(tmpdir(), "conformance-fingerprint-"));
const lines = (dir: string, name: string) =>
  existsSync(join(dir, name))
    ? readFileSync(join(dir, name), "utf8").split("\n").filter(Boolean)
    : [];
let covered: { scenario: string; id: string; excuse: Excuse }[] = [];
const fuzzDiffs: Difference[] = [];
let written = false;
try {
  if (rebound) {
    const wild = before.map((e) => {
      if (e.scenario !== FUZZ_SCENARIO) {
        return e;
      }
      const { bound: _b, ...rest } = e;
      return rest;
    });
    writeFileSync(file, `${JSON.stringify(wild, null, 2)}\n`);
  }
  // The scenarios and the fuzz: the harness self-tests log nothing.
  const status = vitest(["diff/scenarios", "diff/fuzz"], {
    DIFF_LOG_DIR: out,
    DIFF_COVERAGE_LOG: "1",
  });
  if (status !== 0) {
    throw new Error(`the differential run exited ${status}`);
  }
  const dirs = [out, ...extra];
  for (const seed of seeds) {
    const dir = join(out, `seed-${seed}`);
    const code = vitest(["diff/fuzz"], {
      DIFF_LOG_DIR: dir,
      DIFF_COVERAGE_LOG: "1",
      DIFF_FUZZ_SEED: String(seed),
    });
    if (code !== 0) {
      throw new Error(`the fuzz at seed ${seed} exited ${code}`);
    }
    dirs.push(dir);
  }
  for (const dir of dirs) {
    covered = covered.concat(
      lines(dir, "covered.jsonl").map((l) => JSON.parse(l)),
    );
  }
  // Class samples are read only for the entries that covered nothing
  // themselves (a deep run's file is large).
  const sampled = before.filter(
    (e) =>
      e.scenario === FUZZ_SCENARIO &&
      (rebound || e.bound === undefined) &&
      !covered.some((c) => c.id === e.id),
  );
  const heads = sampled.map(
    (e) =>
      `{"stream":${JSON.stringify(e.stream)},"kind":${JSON.stringify(e.kind)},`,
  );
  for (const dir of dirs) {
    for (const l of lines(dir, "fuzz-differences.jsonl")) {
      if (heads.some((h) => l.startsWith(h))) {
        fuzzDiffs.push(JSON.parse(l));
      }
    }
  }
  // Hand counts come from the PR run alone: a hand scenario runs once there.
  const handCovered = lines(out, "covered.jsonl")
    .map((l) => JSON.parse(l) as (typeof covered)[number])
    .filter((c) => c.scenario !== FUZZ_SCENARIO);

  const entries = before;
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
    if (e.bound !== undefined && !rebound) {
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
    const samples =
      own.length > 0 ? own : fuzzDiffs.filter((d) => inClass(e, d));
    const patterns = new Map<string, Json>();
    // A regenerated bound keeps what it had, in the current classes.
    for (const p of e.bound?.match ?? []) {
      const q =
        e.op === "changed"
          ? (() => {
              const { path, from, to } = p as Record<string, Json>;
              return {
                path,
                from: generalizeValue(from),
                to: generalizeValue(to),
              } as Json;
            })()
          : generalizeValue(p);
      const r = JSON.parse(
        canonicalJson(q).replaceAll(
          '{"$like":"failure"}',
          '{"$like":"attemptError"}',
        ),
      ) as Json;
      patterns.set(canonicalJson(r), r);
    }
    const had = patterns.size;
    for (const d of samples) {
      const p = generalize(d, e.path);
      const key = canonicalJson(p);
      if (rebound && !patterns.has(key) && !attemptSide(p, e.op)) {
        report.push(`fuzz ${e.id}: left out (not an attempt's error) ${key}`);
        continue;
      }
      patterns.set(key, p);
    }
    // A changed entry whose class never showed: its field as the records of
    // its kind hold it (any op), each leaf under its path changed from one
    // value of the leaf's class to another.
    let fromRecords = 0;
    if (samples.length === 0 && e.op === "changed" && e.path !== undefined) {
      for (const d of fuzzDiffs) {
        if (d.stream !== e.stream || d.kind !== e.kind || d.op === "changed") {
          continue;
        }
        const value = at(
          d.op === "missing" ? d.reference : d.candidate,
          e.path,
        );
        if (value === undefined) {
          continue;
        }
        fromRecords++;
        for (const [path, leaf] of leaves(value, e.path)) {
          const like = generalize({
            op: "missing",
            reference: leaf,
          } as Difference);
          const p = generalize(
            {
              op: "changed",
              path,
              reference: leaf,
              candidate: leaf,
            } as Difference,
            e.path,
          ) as Record<string, Json>;
          const q = { ...p, from: like, to: like };
          patterns.set(canonicalJson(q), q);
        }
      }
    }
    if (patterns.size === 0) {
      report.push(
        `fuzz ${e.id}: no record of its class in any run, left as is`,
      );
      return e;
    }
    report.push(
      `fuzz ${e.id}: had ${had}; ${own.length > 0 ? `${own.length} covered` : fromRecords > 0 ? `0 covered, 0 of its class, its field in ${fromRecords} record(s) of its kind` : `0 covered, ${samples.length} of its class`} -> ${patterns.size} pattern(s)`,
    );
    return withField(e, "bound", { match: [...patterns.values()] });
  });
  writeFileSync(file, `${JSON.stringify(migrated, null, 2)}\n`);
  written = true;
  console.log(report.join("\n"));
  console.log(`[fingerprint] wrote ${file}; run biome format on it`);
} catch (error) {
  console.error(`[fingerprint] ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  if (!written) {
    writeFileSync(file, original);
  }
  rmSync(out, { recursive: true, force: true });
}

/**
 * Whether a sampled pattern's 1.35 side is a resolver attempt's error, where
 * it holds an error at all. Every fuzz entry whose records carry an error is
 * quirk b's, and quirk b is the error a retracted resolver attempt ended
 * with; a changed record may pair it with any other error on 2.0 (the
 * entries' reason), but a derivation's or an effect's error on 1.35 is not
 * quirk b. A regenerated bound leaves such a sample out and lists it, so
 * sampling more seeds never widens an entry past its reason. (`failure` is
 * the class `attemptError` replaced.)
 */
function attemptSide(p: Json, op: Divergence["op"]): boolean {
  const text = canonicalJson(p);
  if (op === "changed") {
    const { path, from } = p as Record<string, Json>;
    return !(
      String(path).includes("$error") &&
      typeof from === "string" &&
      from !== "resolver"
    );
  }
  return !/"source":"(?!resolver")|throws at/.test(text);
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

/** The value at `path` (`a.b[0].c`) inside `value`, or undefined. */
function at(value: Json | undefined, path: string): Json | undefined {
  let v: Json | undefined = value;
  for (const [, key, index] of path.matchAll(/([^.[\]]+)|\[(\d+)\]/g)) {
    if (v === null || typeof v !== "object") {
      return undefined;
    }
    v =
      index !== undefined
        ? (v as Json[])[Number(index)]
        : (v as Record<string, Json>)[key as string];
  }
  return v;
}

/** Every leaf under `value` with its full path (`value` is at `path`). */
function leaves(value: Json, path: string): [string, Json][] {
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => leaves(v, `${path}[${i}]`));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) =>
      v === undefined ? [] : leaves(v, `${path}.${k}`),
    );
  }
  return [[path, value]];
}
