/**
 * Runs every workload for ONE library inside the current process and prints a
 * single JSON line: { lib, results: { workload: nsPerOp } }.
 *
 * Fairness rules: the process holds exactly one library; per-library adapters
 * live in the entry files; each workload gets a warm-up, then gc() before every
 * timed block; the reported figure is the median of the timed blocks.
 */
import { workloads } from "./workloads.mjs";

const BLOCKS = Number(process.env.BENCH_BLOCKS ?? 15);
const BLOCK_MS = Number(process.env.BENCH_BLOCK_MS ?? 25);
const WARMUP_MS = Number(process.env.BENCH_WARMUP_MS ?? 300);

const now = () => Number(process.hrtime.bigint()) / 1e6;
const gc = globalThis.gc;
if (typeof gc !== "function") {
  throw new Error("runner needs node --expose-gc");
}

function timeBlock(step, n) {
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i++) {
    step();
  }

  return Number(process.hrtime.bigint() - t0) / n;
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;

  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function runAll(lib, makeWorld, only) {
  const results = {};
  for (const [name, workload] of Object.entries(workloads)) {
    if (only && !only.includes(name)) {
      continue;
    }
    const step = workload(makeWorld());
    // Warm-up: let the JIT settle, and size the block so it lasts ~BLOCK_MS.
    const wStart = now();
    let n = 1;
    let calls = 0;
    while (now() - wStart < WARMUP_MS) {
      for (let i = 0; i < n; i++) {
        step();
      }
      calls += n;
      n = Math.min(n * 2, 1 << 20);
    }
    const perOp = (now() - wStart) / calls;
    const blockOps = Math.max(1, Math.round(BLOCK_MS / perOp));
    const samples = [];
    for (let b = 0; b < BLOCKS; b++) {
      gc();
      samples.push(timeBlock(step, blockOps));
    }
    results[name] = median(samples);
  }

  return { lib, results };
}

export function emit(report) {
  process.stdout.write(`${JSON.stringify(report)}\n`);
}
