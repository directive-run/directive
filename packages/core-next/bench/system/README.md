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

## The frame-loop-source workload

`frame-loop-source` is the same frame arriving the way an Aperture frame does (RFC 2.0
L5, decision B2), and it is the workload the L5 speed gate ("0.8x or better") is judged
by. Per frame a gated, coalesced source publishes one `frame` event; the module's handler
makes the 20 writes (an event handler runs in one batch); 10 derivations and 5 effects
follow, and the source's gate is evaluated after the pass. The gate stays open, so the
source attaches once and never re-attaches. One extra fact, `open`, is the gate's input.
It reports time per frame and bytes per frame, like `frame-loop`.

1.35 declares the source through a module `sources:` key. core-next has no sources until
L5, so on v2 the workload is **skipped and shown as n/a** ("sources not built (L5)"), never
a made-up number. The runner finds this out by trying: a workload that lists
`requires: ["sources"]` runs on an engine only if a probe module's source attaches at
start, so the v2 side begins to run by itself the day L5 lands.

## The module-churn workloads (B5)

Two variants run the SAME body (100 `registerModule` + `unregisterModule` pairs per
step, each with a read of the module's derivation, a host resolver in flight the whole
time). Only the timing differs; the workload is never changed.

Owner decision, 2026-11-17, chosen verbatim: "Measure at steady state (Recommended)".
Meaning: time per register/unregister pair measured at steady state WITHOUT the
runner's forced gc() before each timed block, plus retained heap; the current
forced-gc run stays as a leak check (report-only).

- `module-churn` is the B5 bar (1.0 or better against 1.35, in time and bytes). It is
  warmed up, then timed with no forced gc before a block, so a block pays the
  collector's real cost. The table shows time per pair. Bytes come from the heap
  probe (bytes per step of 100 pairs).
- `module-churn-leak` is the old forced-gc run (gc() before every timed block). It is
  a report-only leak check: it never decides the bar.
- Both report retained heap: live heap after a full gc once the timed blocks are done,
  minus live heap after a full gc following warm-up, per step. A number that stays near
  zero is no leak; one that grows with the step count is.

## Other files

- `workloads.mjs`: the workloads, shared by both engines, each checked against
  hand-worked expectations before it is timed.
- `runner.mjs`: runs one engine in one process; `entry-v1.mjs`, `entry-v2.mjs` load it.
- `run.mjs`: the driver (rounds, alternating order, tables, JSON, `--show`, `--compare`).

## The selector workload (B5)

`selector-1000` is 1,000 `runTrackedSelector` calls over one system with five facts and
two derivations, the call every adapter's `useSelector` makes on a re-select.

The L13 RFC's B5 bar for it was 1.0 or better against 1.35. The accepted bar is now
**up to 1.04** (core-next may take up to 4% longer per call than 1.35).

Owner decision, 2026-11-27. Asked whether to accept `selector-1000` at 1.02 to 1.04 of
1.35's time after the two 0 B fixes, he answered, verbatim: "Accept 1.02-1.04
(Recommended)".

- The two fixes are the selector's frame matching 1.35's: a membership test on
  `system.derive` records nothing, and a selector inside a derivation does not link
  that derivation to its reads. They cost about 20 ns a call.
- Measured after the shared tracker went in (L13b fix round 2, 10 rounds, twice): 1.01
  and 1.03 (333 and 336 ns against 332 and 329 ns).
- A ratio above 1.04 is outside what was accepted: stop and report it, do not raise
  the bar here.
