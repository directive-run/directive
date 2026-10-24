/**
 * Fair whole-system benchmark: 1.35 (packages/core dist) against core-next
 * (dist), through the public 1.35 API only. Report-only: it never fails on a
 * ratio.
 *
 * Every measurement runs in its own Node process (--expose-gc) that holds
 * exactly one engine. By default each process also runs ONE workload, so no
 * workload inherits another's JIT or heap state (--shared runs all workloads
 * in one process per engine instead). Which engine goes first alternates each
 * round and each workload, so neither gets a fixed order. A round's ratio
 * pairs the two processes measured back to back.
 *
 * Each process reports four figures per workload: the median and the minimum
 * of its timed blocks, in thread CPU time and in wall time. CPU time ignores
 * the time a process sits descheduled, which is most of the noise on a busy
 * machine; --stat picks the one the headline table uses (default cpuMedian),
 * and the by-statistic table shows whether the conclusion depends on it.
 *
 *   node bench/system/run.mjs [--rounds 8] [--first v1|v2] [--env production|development]
 *                             [--only a,b] [--shared] [--stat cpuMedian] [--heap-rounds 2] [--out file.json]
 *   node bench/system/run.mjs --show file.json [--stat wallMedian]
 *   node bench/system/run.mjs --compare a.json b.json
 *
 * Needs both engines built: `pnpm --filter @directive-run/core build`, and
 * `pnpm build` here (`pnpm bench:system` does the second one for you).
 * BENCH_V1_BUILD=production measures the 1.35 production build instead of the
 * default one. Ratio = v2 / v1, so below 1.00 means core-next is faster.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { workloads } from "./workloads.mjs";

const STATS = ["cpuMedian", "cpuMin", "wallMedian", "wallMin"];
const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);

  return i >= 0 ? args[i + 1] : d;
};
const flag = (k) => args.includes(`--${k}`);

const f = (x, d = 2) => x.toFixed(d);
const pad = (s, n) => String(s).padEnd(n);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;

  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

function printTables(r, stat) {
  const rows = r.byStat[stat];
  console.log(
    `node ${r.node} | rounds ${r.rounds} | first ${r.first} (alternating) | NODE_ENV ${r.env} | ${r.shared ? "process per engine" : "process per workload"} | stat ${stat}`,
  );
  console.log(
    `${pad("workload", 22)}${pad("v1 ns/op", 12)}${pad("v2 ns/op", 12)}${pad("v2/v1", 8)}min-max`,
  );
  for (const row of rows) {
    console.log(
      `${pad(row.workload, 22)}${pad(f(row.v1NsPerOp, 0), 12)}${pad(f(row.v2NsPerOp, 0), 12)}${pad(`${f(row.ratioMedian)}x`, 8)}${f(row.ratioMin)}-${f(row.ratioMax)}`,
    );
  }
  console.log("ops:");
  for (const row of rows) {
    console.log(`  ${pad(row.workload, 22)}${row.op}`);
  }
  console.log("median ratio v2/v1 by statistic:");
  console.log(
    `  ${pad("workload", 22)}${STATS.map((s) => pad(s, 12)).join("")}`,
  );
  rows.forEach((row, i) => {
    const cells = STATS.map((s) => pad(f(r.byStat[s][i].ratioMedian), 12));
    console.log(`  ${pad(row.workload, 22)}${cells.join("")}`);
  });
  const h = r.heap;
  const bytes = (x) => (x === null ? "n/a" : `${f(x, 1)} B`);
  console.log(
    `heap, scalar writes (steady state, bytes per write; writes/trial v1 ${h.v1WritesPerTrial} v2 ${h.v2WritesPerTrial}): write loop only v1 ${bytes(h.v1WriteOnlyBytesPerOp)} / v2 ${bytes(h.v2WriteOnlyBytesPerOp)}; with settle v1 ${bytes(h.v1FullStepBytesPerOp)} / v2 ${bytes(h.v2FullStepBytesPerOp)}`,
  );
  console.log(
    `heap calibration (a known ${h.calibration.expected} B per pass reads back as): v1 ${bytes(h.calibration.v1)} / v2 ${bytes(h.calibration.v2)}`,
  );
  console.log(
    `development checks on: v1 ${r.devChecks.v1}, v2 ${r.devChecks.v2} (NODE_ENV ${r.env})`,
  );
  for (const name of Object.keys(r.notes.v1)) {
    const a = JSON.stringify(r.notes.v1[name]);
    const b = JSON.stringify(r.notes.v2[name]);
    if (a !== b) {
      console.log(
        `NOTE ${name}: work differs between engines: v1 ${a} v2 ${b}`,
      );
    }
  }
}

function compare(aPath, bPath) {
  const a = readJson(aPath);
  const b = readJson(bPath);
  console.log(
    `median ratio v2/v1: ${a.first} first | ${b.first} first | difference (want <= 0.05)`,
  );
  for (const s of STATS) {
    let ok = 0;
    const lines = [];
    for (const ra of a.byStat[s]) {
      const rb = b.byStat[s].find((r) => r.workload === ra.workload);
      const d = Math.abs(ra.ratioMedian - rb.ratioMedian);
      ok += d <= 0.05 ? 1 : 0;
      lines.push(
        `  ${pad(ra.workload, 22)}${pad(f(ra.ratioMedian), 8)}${pad(f(rb.ratioMedian), 8)}${pad(f(d), 8)}${d <= 0.05 ? "ok" : "over"}`,
      );
    }
    console.log(`-- ${s}: ${ok}/${a.byStat[s].length} within 0.05`);
    console.log(lines.join("\n"));
  }
}

if (flag("compare")) {
  const i = args.indexOf("--compare");
  compare(args[i + 1], args[i + 2]);
  process.exit(0);
}
if (flag("show")) {
  const r = readJson(opt("show"));
  printTables(r, opt("stat", r.stat));
  process.exit(0);
}

const rounds = Number(opt("rounds", 8));
const first = opt("first", "v1");
const env = opt("env", "production");
const stat = opt("stat", "cpuMedian");
const shared = flag("shared");
// The heap probe is deterministic, so a couple of rounds are plenty.
const heapRounds = Number(opt("heap-rounds", 2));
const names = Object.keys(workloads).filter(
  (n) => !opt("only") || opt("only").split(",").includes(n),
);
const out = opt("out", join(here, "..", "results", "system-latest.json"));
if (rounds < 6 && !flag("smoke")) {
  throw new Error("need at least 6 rounds for a trustworthy median");
}
if (!["v1", "v2"].includes(first)) {
  throw new Error("--first must be v1 or v2");
}
if (!["production", "development"].includes(env)) {
  throw new Error("--env must be production or development");
}
if (!STATS.includes(stat)) {
  throw new Error(`--stat must be one of ${STATS.join(", ")}`);
}

const entries = { v1: "entry-v1.mjs", v2: "entry-v2.mjs" };
const dists = {
  v1: join(here, "../../../core/dist/index.js"),
  v2: join(here, "../../dist/index.js"),
};
for (const [engine, path] of Object.entries(dists)) {
  if (!existsSync(path)) {
    throw new Error(
      `${engine} is not built (${path}). Run \`pnpm --filter @directive-run/core build\` and \`pnpm --filter @directive-run/core-next build\` first.`,
    );
  }
}

function runOne(engine, extra = {}, heap = false) {
  // The heap probe pins a big fixed semi-space so no scavenge lands in a trial.
  const flags = heap
    ? ["--expose-gc", "--min-semi-space-size=64", "--max-semi-space-size=64"]
    : ["--expose-gc"];
  const r = spawnSync(
    process.execPath,
    [...flags, join(here, entries[engine])],
    {
      encoding: "utf8",
      maxBuffer: 1 << 24,
      env: { ...process.env, BENCH_NODE_ENV: env, ...extra },
    },
  );
  if (r.status !== 0) {
    throw new Error(`${engine} failed (${r.status}): ${r.stderr}`);
  }

  return JSON.parse(r.stdout.trim().split("\n").pop());
}

const other = { v1: "v2", v2: "v1" };
const samples = { v1: {}, v2: {} };
const notes = { v1: {}, v2: {} };
const heapSamples = { v1: [], v2: [] };
const devChecks = {};
for (const engine of ["v1", "v2"]) {
  for (const name of names) {
    samples[engine][name] = [];
  }
}
const record = (engine, report) => {
  for (const [name, value] of Object.entries(report.results)) {
    samples[engine][name].push(value);
    notes[engine][name] = report.notes[name];
  }
  devChecks[engine] = report.devChecks;
};

for (let round = 0; round < rounds; round++) {
  if (shared) {
    const a = round % 2 === 0 ? first : other[first];
    for (const engine of [a, other[a]]) {
      record(engine, runOne(engine, { BENCH_ONLY: names.join(",") }));
    }
  } else {
    names.forEach((name, w) => {
      const a = (round + w) % 2 === 0 ? first : other[first];
      for (const engine of [a, other[a]]) {
        record(engine, runOne(engine, { BENCH_ONLY: name }));
      }
    });
  }
  const h = round % 2 === 0 ? first : other[first];
  for (const engine of round < heapRounds ? [h, other[h]] : []) {
    const r = runOne(engine, { BENCH_MODE: "heap" }, true);
    devChecks[engine] = r.devChecks;
    if (r.heap) {
      heapSamples[engine].push(r.heap);
    }
  }
  console.error(`round ${round + 1}/${rounds} done`);
}

function summarize(name, s) {
  const v1 = samples.v1[name].map((r) => r[s]);
  const v2 = samples.v2[name].map((r) => r[s]);
  // Round i's ratio pairs the two processes measured in the same round.
  const ratios = v2.map((v, i) => v / v1[i]);

  return {
    workload: name,
    op: workloads[name].op,
    ratioMedian: median(ratios),
    ratioMin: Math.min(...ratios),
    ratioMax: Math.max(...ratios),
    v1NsPerOp: median(v1),
    v1Min: Math.min(...v1),
    v1Max: Math.max(...v1),
    v2NsPerOp: median(v2),
    v2Min: Math.min(...v2),
    v2Max: Math.max(...v2),
  };
}
const byStat = Object.fromEntries(
  STATS.map((s) => [s, names.map((name) => summarize(name, s))]),
);

const heapOf = (engine, key) =>
  heapSamples[engine].length
    ? median(heapSamples[engine].map((h) => h[key]))
    : null;
const calibrated = (engine) => {
  const xs = heapSamples[engine]
    .map((h) => h.calibration.measured)
    .filter((x) => x !== null);

  return xs.length ? median(xs) : null;
};
const result = {
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  cpu: cpus()[0]?.model,
  env,
  rounds,
  first,
  shared,
  stat,
  date: new Date().toISOString(),
  devChecks,
  byStat,
  heap: {
    v1WritesPerTrial: heapSamples.v1[0]?.writesPerTrial ?? null,
    v2WritesPerTrial: heapSamples.v2[0]?.writesPerTrial ?? null,
    v1WriteOnlyBytesPerOp: heapOf("v1", "writeOnlyBytesPerOp"),
    v2WriteOnlyBytesPerOp: heapOf("v2", "writeOnlyBytesPerOp"),
    v1FullStepBytesPerOp: heapOf("v1", "fullStepBytesPerOp"),
    v2FullStepBytesPerOp: heapOf("v2", "fullStepBytesPerOp"),
    calibration: {
      expected: 176,
      v1: calibrated("v1"),
      v2: calibrated("v2"),
    },
  },
  notes,
};

printTables(result, stat);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(`wrote ${out}`);
