---
title: performancePlugin
description: Engine-side performance metrics for constraints, resolvers, effects, and the reconcile loop — counts, total/avg/max duration, with slow-event callbacks.
---

# `performancePlugin` — counts, durations, slow-event callbacks

> A plugin that turns every relevant engine hook into running totals.
> Pulls a `PerformanceSnapshot` whenever you want it, fires
> `onSlowConstraint` / `onSlowResolver` when an evaluation exceeds your
> threshold, and lives entirely outside the hot path — no patching, no
> instrumentation API surface.

## What it does

Subscribes to `onStart`, `onConstraintEvaluate`, `onResolverStart`,
`onResolverComplete`, `onResolverError`, `onResolverRetry`,
`onResolverCancel`, `onEffectRun`, `onEffectError`, `onReconcileStart`,
`onReconcileEnd`, and `onDestroy`. Accumulates four metric tables
(constraints, resolvers, effects, reconcile) and exposes
`getSnapshot()` + `reset()` directly on the plugin object — so you can
keep the reference and query it at will.

## When to use

- Local dev — `perf.getSnapshot()` after a flow reveals which resolver
  ate the budget.
- CI perf regression tests — assert resolver p99 / avg / max stays
  under a threshold.
- Production — wire `onSlowResolver` to your alerting and forget about
  it.
- Dashboard pages — periodically poll `getSnapshot()` to render a live
  metrics view.
- Capacity planning — record `uptime`, count and duration totals,
  divide.

## Quick start

```ts
import { createSystem } from "@directive-run/core";
import { performancePlugin } from "@directive-run/core/plugins";

const perf = performancePlugin({
  slowConstraintThresholdMs: 8,
  slowResolverThresholdMs: 500,
  onSlowConstraint: (id, ms) => console.warn(`slow constraint ${id}: ${ms}ms`),
  onSlowResolver: (id, ms) => console.warn(`slow resolver ${id}: ${ms}ms`),
});

const system = createSystem({
  module: trafficLight,
  plugins: [perf],
});

system.start();

// Later — pull a snapshot
const snapshot = perf.getSnapshot();
console.table(snapshot.resolvers);
console.log("reconcile avg:", snapshot.reconcile.avgDurationMs);
```

## Options

| Field                       | Default | Description |
| --------------------------- | ------- | ----------- |
| `onSlowConstraint`          | —       | Callback fired when a constraint's measured evaluation time exceeds `slowConstraintThresholdMs`. Receives `(id, durationMs)`. |
| `onSlowResolver`            | —       | Callback fired when a resolver's completion duration exceeds `slowResolverThresholdMs`. Receives `(id, durationMs)`. |
| `slowConstraintThresholdMs` | `16`    | Threshold in milliseconds for the slow-constraint callback. Aligned to one display frame at 60 Hz. |
| `slowResolverThresholdMs`   | `1000`  | Threshold in milliseconds for the slow-resolver callback. |

## Snapshot shape

`perf.getSnapshot()` returns a `PerformanceSnapshot`:

```ts
interface PerformanceSnapshot {
  constraints: Record<string, ConstraintMetrics>;
  resolvers:   Record<string, ResolverMetrics>;
  effects:     Record<string, EffectMetrics>;
  reconcile:   ReconcileMetrics;
  uptime:      number; // ms since onStart, 0 if not started
}

interface ConstraintMetrics {
  evaluations: number;
  totalDurationMs: number;
  avgDurationMs: number;
  maxDurationMs: number;
  lastEvaluatedAt: number; // Date.now()
}

interface ResolverMetrics {
  starts: number;
  completions: number;
  errors: number;
  retries: number;
  cancellations: number;
  totalDurationMs: number;
  avgDurationMs: number;
  maxDurationMs: number;
  lastCompletedAt: number;
}

interface EffectMetrics {
  runs: number;
  errors: number;
  lastRunAt: number;
}

interface ReconcileMetrics {
  runs: number;
  totalDurationMs: number;
  avgDurationMs: number;
  maxDurationMs: number;
}
```

Each `getSnapshot()` returns a *copy* — mutating it won't corrupt the
plugin's internal state.

## How it works

Resolvers are easy — `onResolverComplete` carries `duration` directly
from the engine. Effects only record run / error counts.

Reconcile is timed from `onReconcileStart` (`performance.now()`) to
`onReconcileEnd`. The engine emits exactly one of each per cycle.

**Constraint timing is sampled, not exact.** Constraints evaluate
sequentially within a reconcile cycle, but the engine doesn't surface
per-constraint duration. The plugin measures the time between
*consecutive* `onConstraintEvaluate` calls — so each constraint's
duration is the time elapsed since the previous one finished. The
first constraint in each cycle has no baseline and is *not* timed.
On `onReconcileStart`, `lastConstraintEvalEndTime` resets to `0` to
mark the next event as the new baseline.

`onDestroy` calls `reset()`, clearing every metric Map.

## Footguns

- **First constraint per cycle is untimed.** With one constraint and one
  reconcile cycle, you'll see `evaluations: 1, totalDurationMs: 0`.
  Don't divide. The first-cycle issue self-corrects across many cycles
  for any constraint that isn't always first.
- **Constraint `avgDurationMs` divides by `evaluations`, not by timed
  evaluations.** Source comments call this out: it's an approximation.
  The math underestimates the average for the leading constraint.
- **`uptime` is `Date.now() - startedAt`.** It's wall-clock, not
  monotonic. A NTP step or a sleep/wake on a laptop shifts it.
- **`getSnapshot()` returns shallow copies of nested objects.** Each
  per-id metric is `{ ...m }` — fine for current use, but don't store
  the snapshot across an `await` and expect it to track live values.
- **Slow-event callbacks are synchronous in the hot path.** A heavy
  `onSlowResolver` (e.g. blocking I/O) will block the next reconcile.
  Forward to a queue if your handler is non-trivial.
- **No histograms.** Mean / max only — for p50 / p90 / p99, feed the
  events into [`createObservability`](./observability.md) instead.
- **`reset()` does not stop the plugin.** It just clears the maps. Call
  `system.destroy()` to fully tear down.
- **Effect duration is not tracked.** Only `runs` and `errors`. Wrap
  expensive effects with your own timing if needed.

## See also

- [`createObservability`](./observability.md) — agent-side metrics with
  percentiles, alerts, and OTLP export.
- [`devtoolsPlugin`](./devtools.md) — same perf data, rendered in the
  floating panel's perf section.
- [`loggingPlugin`](./logging.md) — per-event logs rather than rolled-up
  metrics.
- [`createAuditLedger`](./audit-ledger.md) — events for compliance, not
  performance.
