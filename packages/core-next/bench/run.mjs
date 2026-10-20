/**
 * Fair graph benchmark: core-next (built dist) vs alien-signals.
 *
 * Each library runs in its OWN Node process per round (--expose-gc), and the
 * starting library alternates every round, so neither gets a fixed order or a
 * shared JIT/heap. Report-only: this never fails on a ratio.
 *
 *   node bench/run.mjs [--rounds 8] [--first ours|alien] [--out file.json]
 *
 * Build first (`pnpm build`); `pnpm bench:fair` does it for you.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);

  return i >= 0 ? args[i + 1] : d;
};
const rounds = Number(opt("rounds", 8));
const first = opt("first", "ours");
const out = opt("out", join(here, "results", "latest.json"));
if (rounds < 6) {
  throw new Error("need at least 6 rounds for a trustworthy median");
}
if (!["ours", "alien"].includes(first)) {
  throw new Error("--first must be ours or alien");
}

const entries = { ours: "entry-ours.mjs", alien: "entry-alien.mjs" };

function runOne(key) {
  const r = spawnSync(
    process.execPath,
    ["--expose-gc", join(here, entries[key])],
    { encoding: "utf8", maxBuffer: 1 << 24 },
  );
  if (r.status !== 0) {
    throw new Error(`${key} failed (${r.status}): ${r.stderr}`);
  }

  return JSON.parse(r.stdout.trim().split("\n").pop());
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;

  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const samples = { ours: [], alien: [] };
const other = { ours: "alien", alien: "ours" };
for (let round = 0; round < rounds; round++) {
  const a = round % 2 === 0 ? first : other[first];
  for (const key of [a, other[a]]) {
    samples[key].push(runOne(key).results);
  }
}

const workloads = Object.keys(samples.ours[0]);
const rows = workloads.map((name) => {
  const o = samples.ours.map((r) => r[name]);
  const a = samples.alien.map((r) => r[name]);
  // Round i's ratio pairs the two processes measured in the same round.
  const ratios = o.map((v, i) => v / a[i]);

  return {
    workload: name,
    ratioMedian: median(ratios),
    ratioMin: Math.min(...ratios),
    ratioMax: Math.max(...ratios),
    oursNsPerOp: median(o),
    alienNsPerOp: median(a),
  };
});

const f = (x, d = 2) => x.toFixed(d);
const pad = (s, n) => String(s).padEnd(n);
console.log(
  `node ${process.version} | rounds ${rounds} | first ${first} (alternating)`,
);
console.log(
  `${pad("workload", 18)}${pad("ratio", 8)}${pad("min-max", 13)}${pad("ours ns/op", 14)}alien ns/op`,
);
for (const r of rows) {
  console.log(
    `${pad(r.workload, 18)}${pad(`${f(r.ratioMedian)}x`, 8)}${pad(`${f(r.ratioMin)}-${f(r.ratioMax)}`, 13)}${pad(f(r.oursNsPerOp, 0), 14)}${f(r.alienNsPerOp, 0)}`,
  );
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  `${JSON.stringify({ node: process.version, rounds, first, date: new Date().toISOString(), rows }, null, 2)}\n`,
);
console.log(`wrote ${out}`);
