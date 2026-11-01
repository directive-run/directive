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
 *                             [--only a,b] [--shared] [--stat cpuMedian] [--heap-rounds 2]
 *                             [--no-env-swap] [--allow-cpu-fallback] [--out file.json]
 *   node bench/system/run.mjs --show file.json [--stat wallMedian]
 *   node bench/system/run.mjs --compare a.json b.json
 *
 * `pnpm bench:system` builds BOTH engines first (core, then core-next), then runs
 * this. Running this file directly uses whatever is in the two dist folders; the
 * header and the JSON record the git SHA, each dist's mtime, each package version,
 * Node, the load average and the env-swap setting, and warn if a dist is older
 * than its sources. BENCH_V1_BUILD=production measures the 1.35 production build
 * instead of the default one. Ratio = v2 / v1, so below 1.00 means core-next is
 * faster.
 *
 * process.env swap (read this before quoting a number): by default each child
 * process replaces `process.env` with a plain object, so the engines' runtime
 * `process.env.NODE_ENV` checks cost a property read, like a bundler's folded
 * constant. That models a BUNDLED consumer. `--no-env-swap` keeps Node's real
 * (slow) env accessor, which models UNBUNDLED Node; it is report-only and writes
 * to system-latest-no-env-swap.json by default so the two never overwrite each
 * other.
 *
 * CPU time comes from process.threadCpuUsage. If this Node lacks it the run fails
 * unless --allow-cpu-fallback is given, which switches to whole-process
 * process.cpuUsage and labels every output "cpuUsage-fallback".
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { cpus, loadavg } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
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

// A workload an engine cannot run (see `requires` in workloads.mjs) has no
// figure for it: null, printed as n/a, never a made-up number.
const f = (x, d = 2) => (x === null || x === undefined ? "n/a" : x.toFixed(d));
const pad = (s, n) => String(s).padEnd(n);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;

  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

function printBuild(r) {
  const b = r.build;
  if (!b) {
    return;
  }
  console.log(
    `build: git ${b.gitSha}${b.gitDirty ? " (dirty)" : ""} | node ${r.node} | ${r.cpu ?? "?"} x${b.cpuCount} | CPU time ${b.cpuSource}`,
  );
  for (const e of ["v1", "v2"]) {
    const d = b[e];
    console.log(
      `  ${e}: ${d.name}@${d.version} | ${d.dist} | built ${d.distMtime}${d.stale ? " | STALE: sources are newer than this dist" : ""}`,
    );
  }
  console.log(
    `  load average (1/5/15 min): start ${b.loadAvgStart}, end ${b.loadAvgEnd} on ${b.cpuCount} cores${b.loadAvg1mStart > b.cpuCount / 2 ? " | NOISY: machine is busy, re-run when quiet" : ""}`,
  );
  console.log(
    `  process.env: ${r.envSwap ? "SWAPPED for a plain object (models a BUNDLED consumer; the default)" : "REAL accessor, no swap (models UNBUNDLED Node; report-only)"}`,
  );
  if (b.cpuSource !== "threadCpuUsage") {
    console.log(
      "  WARNING: CPU time is whole-process process.cpuUsage(), not thread time; noisier, label any number taken from it.",
    );
  }
}

function printHeap(r) {
  const h = r.heap;
  const bytes = (x) => (x === null ? "n/a" : `${f(x, 1)} B`);
  const sizes = (e) =>
    h[`${e}WritesPerTrialAll`] ?? String(h[`${e}WritesPerTrial`] ?? "n/a");
  const trials = (e) => h[`${e}CleanTrials`] || "n/a";
  console.log(
    `heap, scalar writes (steady state, bytes per write; semi-space pinned at ${h.semiSpaceMB ?? 64} MB):`,
  );
  console.log(
    `  ${pad("engine", 8)}${pad("writes/trial", 14)}${pad("clean trials", 16)}${pad("write loop", 13)}${pad("with settle", 13)}calibration (known ${h.calibration.expected} B)`,
  );
  for (const e of ["v1", "v2"]) {
    console.log(
      `  ${pad(e, 8)}${pad(sizes(e), 14)}${pad(trials(e), 16)}${pad(bytes(h[`${e}WriteOnlyBytesPerOp`]), 13)}${pad(bytes(h[`${e}FullStepBytesPerOp`]), 13)}${bytes(h.calibration[e])}`,
    );
  }
  console.log(
    `  frame loop (frame-loop workload, bytes per frame): v1 ${bytes(h.v1FrameBytesPerOp)}, v2 ${bytes(h.v2FrameBytesPerOp)}`,
  );
  console.log(
    `  frame loop through a source (frame-loop-source workload, bytes per frame): v1 ${bytes(h.v1FrameSourceBytesPerOp)}, v2 ${bytes(h.v2FrameSourceBytesPerOp)}`,
  );
  console.log(
    "  (clean trials = write-loop+with-settle trials that saw no GC, per heap round; the probe tries 200000, then 50000, then 12000 writes per trial until it has enough clean ones)",
  );
  if (sizes("v1") !== sizes("v2")) {
    console.log(
      `  NOTE: trial size differs between engines (v1 ${sizes("v1")}, v2 ${sizes("v2")}); bytes per write is only comparable if the path is at steady state at both sizes.`,
    );
  }
}

function printTables(r, stat) {
  const rows = r.byStat[stat];
  console.log(
    `node ${r.node} | rounds ${r.rounds} | first ${r.first} (alternating) | NODE_ENV ${r.env} | ${r.shared ? "process per engine" : "process per workload"} | stat ${stat} | env swap ${r.envSwap === undefined ? "?" : r.envSwap ? "on" : "OFF"}`,
  );
  printBuild(r);
  console.log(
    `${pad("workload", 22)}${pad("v1 ns/op", 12)}${pad("v2 ns/op", 12)}${pad("v2/v1", 8)}min-max`,
  );
  for (const row of rows) {
    const ratio = row.ratioMedian === null ? "n/a" : `${f(row.ratioMedian)}x`;
    const range =
      row.ratioMedian === null ? "" : `${f(row.ratioMin)}-${f(row.ratioMax)}`;
    console.log(
      `${pad(row.workload, 22)}${pad(f(row.v1NsPerOp, 0), 12)}${pad(f(row.v2NsPerOp, 0), 12)}${pad(ratio, 8)}${range}`,
    );
  }
  for (const engine of ["v1", "v2"]) {
    for (const [name, why] of Object.entries(r.skipped?.[engine] ?? {})) {
      console.log(`  ${engine}: ${name} not run: ${why}`);
    }
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
  printHeap(r);
  console.log(
    `development checks on: v1 ${r.devChecks.v1}, v2 ${r.devChecks.v2} (NODE_ENV ${r.env})`,
  );
  for (const name of Object.keys(r.notes.v1)) {
    if (r.skipped?.v2?.[name] || r.skipped?.v1?.[name]) {
      continue;
    }
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
  if (a.envSwap !== b.envSwap) {
    console.log(
      `WARNING: env swap differs (${aPath}: ${a.envSwap}, ${bPath}: ${b.envSwap}); this is not an order check.`,
    );
  }
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
const envSwap = !flag("no-env-swap");
const allowCpuFallback = flag("allow-cpu-fallback");
// The heap probe is deterministic, so a couple of rounds are plenty.
const heapRounds = Number(opt("heap-rounds", 2));
const names = Object.keys(workloads).filter(
  (n) => !opt("only") || opt("only").split(",").includes(n),
);
const out = opt(
  "out",
  join(
    here,
    "..",
    "results",
    envSwap ? "system-latest.json" : "system-latest-no-env-swap.json",
  ),
);
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
const v1Production = process.env.BENCH_V1_BUILD === "production";
const dists = {
  v1: resolve(
    here,
    v1Production
      ? "../../../core/dist/production/index.js"
      : "../../../core/dist/index.js",
  ),
  v2: resolve(here, "../../dist/index.js"),
};
const pkgDirs = {
  v1: resolve(here, "../../../core"),
  v2: resolve(here, "../.."),
};
for (const [engine, path] of Object.entries(dists)) {
  if (!existsSync(path)) {
    throw new Error(
      `${engine} is not built (${path}). Run \`pnpm --filter @directive-run/core build\` and \`pnpm --filter @directive-run/core-next build\` first, or just \`pnpm bench:system\`.`,
    );
  }
}
if (typeof process.threadCpuUsage !== "function" && !allowCpuFallback) {
  throw new Error(
    `process.threadCpuUsage is missing on Node ${process.version}. Use a Node that has it, or pass --allow-cpu-fallback to accept whole-process process.cpuUsage() (every output is then labelled "cpuUsage-fallback").`,
  );
}

// Newest source mtime under a package's src/, tests excluded.
function newestSource(dir) {
  let newest = 0;
  for (const rel of readdirSync(join(dir, "src"), { recursive: true })) {
    if (/__tests__|\.test\.|\.bench\./.test(String(rel))) {
      continue;
    }
    const st = statSync(join(dir, "src", String(rel)));
    if (st.isFile()) {
      newest = Math.max(newest, st.mtimeMs);
    }
  }

  return newest;
}

// "1m 5m 15m" load averages as one string, so the saved JSON stays biome-clean.
const loadAvgText = () =>
  loadavg()
    .map((v) => f(v, 1))
    .join(" ");

// Which code is actually being measured: git SHA, each dist's mtime and package
// version, and whether a dist is older than its sources (a stale build once gave
// 184 B per write instead of 88).
function buildIdentity() {
  const git = (...a) =>
    spawnSync("git", a, { cwd: here, encoding: "utf8" }).stdout.trim();
  const engineInfo = (engine) => {
    const pkg = readJson(join(pkgDirs[engine], "package.json"));
    const distMtime = statSync(dists[engine]).mtime;

    return {
      name: pkg.name,
      version: pkg.version,
      dist: relative(process.cwd(), dists[engine]) || dists[engine],
      distMtime: distMtime.toISOString(),
      stale: newestSource(pkgDirs[engine]) > distMtime.getTime(),
    };
  };

  return {
    gitSha: git("rev-parse", "--short=10", "HEAD"),
    gitDirty: git("status", "--porcelain", "--", pkgDirs.v1, pkgDirs.v2) !== "",
    node: process.version,
    cpuCount: cpus().length,
    loadAvg1mStart: loadavg()[0],
    loadAvgStart: loadAvgText(),
    loadAvgEnd: "",
    envSwap,
    cpuSource: "unknown",
    v1: engineInfo("v1"),
    v2: engineInfo("v2"),
  };
}
const build = buildIdentity();

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
      env: {
        ...process.env,
        BENCH_NODE_ENV: env,
        BENCH_ENV_SWAP: envSwap ? "1" : "0",
        BENCH_ALLOW_CPU_FALLBACK: allowCpuFallback ? "1" : "0",
        ...extra,
      },
    },
  );
  if (r.status !== 0) {
    throw new Error(`${engine} failed (${r.status}): ${r.stderr}`);
  }

  const report = JSON.parse(r.stdout.trim().split("\n").pop());
  // Every child must have measured the way the header says it did.
  if (report.envSwap !== envSwap) {
    throw new Error(
      `${engine} ran with env swap ${report.envSwap}, expected ${envSwap}`,
    );
  }
  if (build.cpuSource !== "unknown" && report.cpuSource !== build.cpuSource) {
    throw new Error(
      `${engine} measured CPU time with ${report.cpuSource}, earlier children used ${build.cpuSource}`,
    );
  }
  build.cpuSource = report.cpuSource;

  return report;
}

const other = { v1: "v2", v2: "v1" };
const samples = { v1: {}, v2: {} };
const notes = { v1: {}, v2: {} };
const skipped = { v1: {}, v2: {} };
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
  Object.assign(skipped[engine], report.skipped);
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
  // An engine that skipped the workload has no samples: its figures are null.
  if (v1.length === 0 || v2.length === 0) {
    const stats = (xs) =>
      xs.length === 0
        ? { median: null, min: null, max: null }
        : { median: median(xs), min: Math.min(...xs), max: Math.max(...xs) };
    const a = stats(v1);
    const b = stats(v2);

    return {
      workload: name,
      op: workloads[name].op,
      ratioMedian: null,
      ratioMin: null,
      ratioMax: null,
      v1NsPerOp: a.median,
      v1Min: a.min,
      v1Max: a.max,
      v2NsPerOp: b.median,
      v2Min: b.min,
      v2Max: b.max,
    };
  }
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

// Median of the rounds that measured it; null when none did (an engine without
// the workload, or too few clean trials), never a median of nothing.
const heapOf = (engine, key) => {
  const xs = heapSamples[engine].map((h) => h[key]).filter((x) => x !== null);

  return xs.length ? median(xs) : null;
};
const calibrated = (engine) => {
  const xs = heapSamples[engine]
    .map((h) => h.calibration.measured)
    .filter((x) => x !== null);

  return xs.length ? median(xs) : null;
};
build.loadAvgEnd = loadAvgText();
const uniq = (xs) => [...new Set(xs)].join("/");
const result = {
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  cpu: cpus()[0]?.model,
  env,
  rounds,
  first,
  shared,
  envSwap,
  build,
  stat,
  date: new Date().toISOString(),
  devChecks,
  byStat,
  heap: {
    semiSpaceMB: 64,
    v1WritesPerTrial: heapSamples.v1[0]?.writesPerTrial ?? null,
    v2WritesPerTrial: heapSamples.v2[0]?.writesPerTrial ?? null,
    v1WritesPerTrialAll: uniq(heapSamples.v1.map((h) => h.writesPerTrial)),
    v2WritesPerTrialAll: uniq(heapSamples.v2.map((h) => h.writesPerTrial)),
    v1CleanTrials: heapSamples.v1.map((h) => h.cleanTrials.join("+")).join(" "),
    v2CleanTrials: heapSamples.v2.map((h) => h.cleanTrials.join("+")).join(" "),
    v1WriteOnlyBytesPerOp: heapOf("v1", "writeOnlyBytesPerOp"),
    v2WriteOnlyBytesPerOp: heapOf("v2", "writeOnlyBytesPerOp"),
    v1FullStepBytesPerOp: heapOf("v1", "fullStepBytesPerOp"),
    v2FullStepBytesPerOp: heapOf("v2", "fullStepBytesPerOp"),
    v1FrameBytesPerOp: heapOf("v1", "frameBytesPerOp"),
    v2FrameBytesPerOp: heapOf("v2", "frameBytesPerOp"),
    v1FrameSourceBytesPerOp: heapOf("v1", "frameSourceBytesPerOp"),
    v2FrameSourceBytesPerOp: heapOf("v2", "frameSourceBytesPerOp"),
    calibration: {
      expected: 176,
      v1: calibrated("v1"),
      v2: calibrated("v2"),
    },
  },
  notes,
  skipped,
};

printTables(result, stat);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(`wrote ${out}`);
