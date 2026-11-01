# Whole-system bench: 1.35 vs core-next

Runs the 1.35 engine (`packages/core` dist) and `core-next` (dist) through the
public 1.35 API only, one Node process per engine and workload. Report-only: it
never fails on a ratio. Ratio = v2 / v1, so below 1.00 means core-next is faster.

```
pnpm --filter @directive-run/core-next bench:system [--rounds 10] [--first v1|v2] [--stat cpuMedian]
pnpm --filter @directive-run/core-next bench:system --no-env-swap     # unbundled-Node case
```

`bench:system` builds **both** engines first (`@directive-run/core`, then
`@directive-run/core-next`). Running `node bench/system/run.mjs` directly uses
whatever is already in the two `dist` folders, so only do that when you know both
are current.

## Read this before quoting a number: the `process.env` swap

By default every measured process replaces `process.env` with a plain object. The
engines check `process.env.NODE_ENV` at run time; Node's real `process.env` is a
slow accessor, so on unbundled Node whichever engine reads it more often would be
charged for it. A bundler folds `process.env.NODE_ENV` to a constant, so a real
consumer pays nothing. The swap (a cheap property read) is the closest stand-in.

So the default table **models a bundled consumer**. It does not describe plain
`node app.mjs` importing the dist files.

`--no-env-swap` keeps the real accessor and measures that unbundled case. It is
report-only, and it writes `bench/results/system-latest-no-env-swap.json` so the two
runs never overwrite each other. Quote the two together, labelled.

## What is recorded, so a number can be traced to code

The printed header and the result JSON (`build`) carry:

- git SHA (and whether `packages/core` or `packages/core-next` has uncommitted changes)
- each engine's package name and version, dist path and dist mtime, and a `STALE`
  flag when any source file is newer than its dist
- Node version, CPU model and core count
- load average at the start and at the end of the run, with a `NOISY` flag when the
  1-minute load is above half the core count (re-run when quiet)
- whether the `process.env` swap was on
- which CPU clock was used

Why this exists: a stale 1.35 build once gave 184 B per write where the current one
gives 88.

## CPU clock

Timing uses `process.threadCpuUsage()` (this thread's CPU time, so time spent
descheduled on a busy machine is ignored). If the Node in use lacks it, the run
fails. `--allow-cpu-fallback` switches to whole-process `process.cpuUsage()`
instead, which also counts GC and compiler threads; every output is then labelled
`cpuUsage-fallback` and should not be compared with thread-CPU numbers.

## Heap table

Per engine, the table shows the trial size (writes per trial), the number of clean
trials (no GC inside the trial; one write-loop+with-settle pair per heap round), bytes
per write for the write loop alone and with the settle, and the calibration read-back.

The probe tries 200,000 writes per trial, then 50,000, then 12,000, until it gets enough
clean trials, so the size can differ between engines. core-next writes allocate about
4.7x more than 1.35, so 200,000 of them are about 83 MB, more than the 64 MB semi-space,
and the probe falls back to 50,000. A `NOTE` is printed when the sizes differ: bytes per
write is then only comparable if the path is at steady state at both sizes. The
semi-space is pinned at 64 MB so no scavenge lands inside a trial.

## The frame-loop workload

`frame-loop` is the yardstick the L5 speed gate ("0.8x or better on the frame loop")
is judged by, fixed before L4 so L4's gains are measured on the gate's own workload.
One step is one frame of an Aperture-shaped app: 20 facts written in one batch, 10
derivations (each the sum of two facts), 5 auto-tracked effects (2 read `prev`, 2 read
derivations), then a settle. Every fact changes every frame, so all 5 effects re-run.
The timing table reports time per frame; the heap section reports bytes per frame.

## Other files

- `workloads.mjs`: the ten workloads, shared by both engines, each checked against
  hand-worked expectations before it is timed.
- `runner.mjs`: runs one engine in one process; `entry-v1.mjs`, `entry-v2.mjs` load it.
- `run.mjs`: the driver (rounds, alternating order, tables, JSON, `--show`, `--compare`).
