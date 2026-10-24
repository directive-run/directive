/**
 * Runs the whole-system workloads for ONE engine inside the current process
 * and prints a single JSON line:
 *   time mode (default):     { engine, devChecks, results: { workload: nsPerOp }, notes }
 *   heap mode (BENCH_MODE=heap): { engine, devChecks, heap: { ... } }
 *
 * Fairness rules (as in ../runner.mjs): the process holds exactly one engine;
 * the per-engine adapter lives in the entry file; each workload is first
 * verified against first-principles expectations, then warmed up; gc() runs
 * before every timed block; the reported figure is the median of the timed
 * blocks (reported four ways: median and min of thread CPU time and of wall
 * time). Unlike the graph bench, steps may be async (settle), so blocks are
 * awaited, and a macrotask turn between blocks lets any deferred work finish
 * outside the timed region.
 */
import { PerformanceObserver } from "node:perf_hooks";
import { workloads } from "./workloads.mjs";

const BLOCKS = Number(process.env.BENCH_BLOCKS ?? 16);
const BLOCK_MS = Number(process.env.BENCH_BLOCK_MS ?? 20);
const WARMUP_MS = Number(process.env.BENCH_WARMUP_MS ?? 300);

const tick = () => new Promise((resolve) => setImmediate(resolve));
const gc = globalThis.gc;
if (typeof gc !== "function") {
  throw new Error("runner needs node --expose-gc");
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;

  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// CPU time of this thread, in microseconds. It leaves out the time the process
// spent descheduled, which on a busy machine is most of the noise in wall time.
const cpuMicros = () => {
  const u = process.threadCpuUsage
    ? process.threadCpuUsage()
    : process.cpuUsage();

  return u.user + u.system;
};

const cpuNow = () => cpuMicros() / 1000;

async function timeBlock(step, n, isAsync) {
  const c0 = cpuMicros();
  const t0 = process.hrtime.bigint();
  if (isAsync) {
    for (let i = 0; i < n; i++) {
      await step();
    }
  } else {
    for (let i = 0; i < n; i++) {
      step();
    }
  }
  const wall = Number(process.hrtime.bigint() - t0) / n;
  const cpu = ((cpuMicros() - c0) * 1000) / n;

  return { wall, cpu };
}

// A fresh world, a few steps, and the workload's own expectations.
async function verify(name, def, api) {
  const world = await def.build(api);
  let notes = null;
  try {
    for (let s = 1; s <= 3; s++) {
      await world.step();
      notes = world.check(s);
    }
  } catch (error) {
    throw new Error(`verify ${name} failed: ${error.message}`);
  } finally {
    world.done();
  }

  return notes;
}

async function runAll(engine, api, only) {
  const results = {};
  const notes = {};
  for (const [name, def] of Object.entries(workloads)) {
    if (only && !only.includes(name)) {
      continue;
    }
    notes[name] = await verify(name, def, api);
    const world = await def.build(api);
    const isAsync = def.async === true;
    // Warm-up (by CPU time, so a descheduled process still warms up fully):
    // let the JIT settle, and size the block so it lasts ~BLOCK_MS.
    const wStart = cpuNow();
    let n = 1;
    let calls = 0;
    while (cpuNow() - wStart < WARMUP_MS) {
      await timeBlock(world.step, n, isAsync);
      world.cleanBlock?.();
      calls += n;
      n = Math.min(n * 2, 1 << 20);
    }
    const perStep = (cpuNow() - wStart) / calls;
    const blockSteps = Math.max(1, Math.round(BLOCK_MS / perStep));
    const walls = [];
    const cpus = [];
    for (let b = 0; b < BLOCKS; b++) {
      world.cleanBlock?.();
      gc();
      await tick();
      const r = await timeBlock(world.step, blockSteps, isAsync);
      walls.push(r.wall);
      cpus.push(r.cpu);
    }
    world.done();
    const ops = def.ops ?? 1;
    results[name] = {
      cpuMedian: median(cpus) / ops,
      cpuMin: Math.min(...cpus) / ops,
      wallMedian: median(walls) / ops,
      wallMin: Math.min(...walls) / ops,
    };
  }

  return { engine, results, notes };
}

// Steady-state allocation of the scalar-write path, in bytes per write. A big
// fixed semi-space (set by the driver) keeps a scavenge from landing inside a
// trial; trials that still saw a GC are dropped.
async function heapProbe(engine, api) {
  const world = await workloads["scalar-writes"].build(api);
  const gcs = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      gcs.push(entry);
    }
  }).observe({ entryTypes: ["gc"] });
  const heap = () => process.memoryUsage().heapUsed;
  // Warm up: the write path compiled, every lazy structure built.
  for (let s = 0; s < 150; s++) {
    await world.step();
  }
  const settleDown = async () => {
    await world.settle();
    await tick();
    await tick();
  };
  await settleDown();
  const probeCost = median(
    Array.from({ length: 7 }, () => {
      const a = heap();

      return heap() - a;
    }),
  );
  async function trial(run) {
    gc();
    await settleDown();
    const seen = gcs.length;
    const h0 = heap();
    await run();
    const h1 = heap();
    await settleDown();

    return { bytes: h1 - h0 - probeCost, clean: gcs.length === seen };
  }

  // Calibration: a loop that allocates a known 176 bytes (a 16-slot array, 64-bit
  // pointers) per pass must read back as ~176, or the method is not to be trusted.
  const keep = new Array(1024);
  const calibration = [];
  for (let k = 0; k < 5; k++) {
    const r = await trial(() => {
      for (let j = 0; j < 100_000; j++) {
        keep[j & 1023] = new Array(16).fill(0);
      }
    });
    if (r.clean) {
      calibration.push(r.bytes / 100_000);
    }
  }
  const calibratedBytes = calibration.length ? median(calibration) : null;

  for (const writes of [200_000, 50_000, 12_000]) {
    const only = [];
    const full = [];
    for (let k = 0; k < 9; k++) {
      only.push(await trial(() => world.writes(writes)));
      full.push(
        await trial(async () => {
          for (let s = 0; s < writes / 1000; s++) {
            await world.step();
          }
        }),
      );
    }
    const keepClean = (rows) => rows.filter((r) => r.clean).map((r) => r.bytes);
    if (keepClean(only).length >= 3 && keepClean(full).length >= 3) {
      return {
        engine,
        heap: {
          writesPerTrial: writes,
          writeOnlyBytesPerOp: median(keepClean(only)) / writes,
          fullStepBytesPerOp: median(keepClean(full)) / writes,
          cleanTrials: [keepClean(only).length, keepClean(full).length],
          calibration: { expected: 176, measured: calibratedBytes },
        },
      };
    }
  }

  return { engine, heap: null };
}

// Does this build run its development checks? A string written to a number
// fact is caught in development and ignored in production.
function devChecksOn({ createModule, createSystem, t }) {
  const sys = createSystem({
    module: createModule("probe", {
      schema: { facts: { n: t.number() } },
      init: (f) => {
        f.n = 0;
      },
    }),
  });
  sys.start();
  const warn = console.warn;
  const error = console.error;
  let noisy = false;
  console.warn = console.error = () => {
    noisy = true;
  };
  try {
    sys.facts.n = "x";
  } catch {
    noisy = true;
  } finally {
    console.warn = warn;
    console.error = error;
  }
  sys.destroy();

  return noisy;
}

/**
 * Entry point shared by the per-engine entries. `load` imports the engine
 * (it must be a dynamic import: NODE_ENV has to be in place first).
 *
 * `process.env` becomes a plain object so the engines' runtime
 * `process.env.NODE_ENV` checks cost a property read, the way a bundler's
 * folded constant costs nothing; Node's real env accessor is slow and would
 * otherwise charge whichever engine reads it more often.
 */
export async function main(engine, load) {
  process.env = {
    ...process.env,
    NODE_ENV: process.env.BENCH_NODE_ENV || "production",
  };
  const mod = await load();
  const api = {
    createModule: mod.createModule,
    createSystem: mod.createSystem,
    t: mod.t,
  };
  const devChecks = devChecksOn(api);
  const report =
    process.env.BENCH_MODE === "heap"
      ? await heapProbe(engine, api)
      : await runAll(engine, api, process.env.BENCH_ONLY?.split(","));
  process.stdout.write(`${JSON.stringify({ ...report, devChecks })}\n`);
}
