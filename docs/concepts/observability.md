---
title: createObservability
description: Counters, gauges, histograms, distributed-trace spans, threshold alerts, and a dashboard payload – purpose-built for AI agent operations, with optional OTLP export.
---

# `createObservability` – metrics, traces, alerts, dashboard

> A standalone observability instance for AI agent operations. Records
> counters / gauges / histograms, builds distributed-trace spans,
> evaluates threshold alerts on aggregated metrics, and exposes a
> `getDashboard()` payload your status UI can render. Not a Directive
> plugin – it's a factory you pass to other plugins (e.g. circuit
> breaker) and your agent code.

## What it does

`createObservability(config)` returns an `ObservabilityInstance` with
methods to record metrics, start/end spans, configure threshold alerts,
and read a dashboard snapshot. Internally it keeps per-label data point
arrays (trimmed to `maxDataPoints`), an aggregated metric map (count,
sum, min, max, avg, lastValue), a completed-span buffer
(trimmed to `maxSpans`), and an alert event log capped at 1000.

Pair it with `createAgentMetrics(obs)` to get a typed helper that
records the standard metric names `getDashboard()` and
`getHealthStatus()` summarise on (`agent.requests`, `agent.errors`,
`agent.latency`, `agent.tokens`, `agent.cost`).

## When to use

- Production AI agent deployments – you need rates, latencies, error
  ratios, token spend, and a status page.
- Wiring agent health into Directive constraints – read
  `obs.getHealthStatus().healthy` from a `when:` to gate behaviour.
- Threshold alerting without pulling in Prometheus / OpenTelemetry
  – the built-in `alerts` config covers the common cases.
- Driving the circuit breaker – pass the same `obs` to
  [`createCircuitBreaker`](./circuit-breaker.md) for automatic state
  change / success / failure / latency metrics.
- OTLP / OpenTelemetry export – wire `metrics.exporter` /
  `tracing.exporter` to `createOTLPExporter()` and let it batch.

## Quick start

```ts
import {
  createObservability,
  createAgentMetrics,
} from "@directive-run/core/plugins";

const obs = createObservability({
  serviceName: "support-agent",
  metrics: { enabled: true, exportInterval: 10_000 },
  tracing: { enabled: true, sampleRate: 0.1 },
  alerts: [
    { metric: "agent.errors", threshold: 10, action: "warn" },
    { metric: "agent.latency", threshold: 5000, action: "alert" },
  ],
});

const agentMetrics = createAgentMetrics(obs);

const span = obs.startSpan("agent.run");
const start = Date.now();
try {
  await runAgent();
  agentMetrics.trackRun("support-agent", {
    success: true,
    latencyMs: Date.now() - start,
    inputTokens: 100,
    outputTokens: 500,
    cost: 0.05,
  });
  obs.endSpan(span.spanId, "ok");
} catch (e) {
  agentMetrics.trackRun("support-agent", {
    success: false,
    latencyMs: Date.now() - start,
  });
  obs.endSpan(span.spanId, "error");
}

console.log(obs.getDashboard().summary);
```

## Options

`ObservabilityConfig`:

| Field           | Default              | Description |
| --------------- | -------------------- | ----------- |
| `serviceName`   | `"directive-agents"` | Service identifier embedded in every span and the dashboard `service.name`. |
| `metrics.enabled`         | `true`     | Master switch. When `false`, `incrementCounter` / `setGauge` / `observeHistogram` no-op. |
| `metrics.exportInterval`  | –          | Milliseconds between `metricsExporter` and `tracingExporter` calls. When unset, no timer runs. |
| `metrics.exporter`        | –          | `(metrics: AggregatedMetric[]) => Promise<void>`. Called every `exportInterval` and once on `destroy()`. |
| `metrics.maxDataPoints`   | `1000`     | Per-`(name, labels)` data point cap. Oldest dropped on overflow. |
| `tracing.enabled`         | `true`     | When `false`, `startSpan` still returns an object so callers don't break, but it's not retained or exported. |
| `tracing.sampleRate`      | `1.0`      | `0.0 – 1.0`. Below-sample spans return a `"sampled-out"` placeholder that `endSpan` / `addSpanLog` / `addSpanTag` no-op against. |
| `tracing.maxSpans`        | `1000`     | Completed-span buffer cap (FIFO trim). |
| `tracing.exporter`        | –          | `(spans: TraceSpan[]) => Promise<void>`. Called every `exportInterval` with up to 100 completed spans (drained from the buffer). |
| `alerts`        | `[]`                 | Array of `AlertConfig`. Each one is evaluated whenever its `metric` records a new data point. |
| `summaryMetrics`| see below            | Override the metric names used by `getDashboard().summary` and `getHealthStatus()`. Defaults to `agent.requests` / `agent.errors` / `agent.latency` / `agent.tokens` / `agent.cost`. |
| `events.onMetricRecorded` | –          | Hook for every recorded data point. |
| `events.onSpanStart`      | –          | Hook for every retained span start. |
| `events.onSpanEnd`        | –          | Hook for every span end (sample-rate respected). |
| `events.onAlert`          | –          | Hook for every alert event. |

`AlertConfig`:

| Field        | Default | Description |
| ------------ | ------- | ----------- |
| `metric`     | *required* | Metric name to watch. Compared against the aggregated metric's `lastValue`. |
| `threshold`  | *required* | Value to compare against. |
| `operator`   | `">"`   | One of `">" \| "<" \| ">=" \| "<=" \| "=="`. |
| `action`     | *required* | One of `"log" \| "warn" \| "alert" \| "callback"`. `log`/`warn`/`alert` go to `console.{log, warn, error}`; `callback` invokes `config.callback(metric, threshold)`. |
| `callback`   | –       | Required when `action: "callback"`. |
| `cooldownMs` | `60_000` | Suppress re-fires for this metric/threshold pair for the cooldown window. |

## How it works

`recordMetric()` keys data points by `${name}:${stableLabelsJSON}`,
appends to the per-key array, trims to `maxDataPoints`, then rebuilds
the aggregated metric for that `name`. Aggregation is across all label
combinations of the same name – handy for the dashboard, less useful
for cardinality-aware backends (use the exporter for that).

`startSpan()` generates a `traceId` (inherited from a parent or a fresh
UUID) and a per-span `spanId`. `endSpan()` computes duration, records
two metrics derived from the operation name (`{op}.latency` always,
`{op}.errors` on `status: "error"`), and drains the active map. Logs
and tags only attach to retained spans – `"sampled-out"` placeholders
no-op.

`checkAlerts()` runs after every metric record matching the alert's
name. Cooldowns are per `(metric, threshold)` pair and stored in a
`Map`. Alert events cap at 1000 with a `splice`-based head-drop.

`destroy()` clears the export timer, flushes one last call to each
exporter, then clears all internal Maps and arrays.

## Footguns

- **Not a plugin.** `createObservability` does not subscribe to any
  Directive engine hooks. Pass the instance into agent code that calls
  `incrementCounter` / `observeHistogram` / `startSpan` directly – or
  into the circuit breaker, which wires automatic metrics.
- **`getDashboard().summary` is name-coupled.** It looks up
  `agent.requests` / `agent.errors` / `agent.latency` / `agent.tokens`
  / `agent.cost` by name. Use `createAgentMetrics()` or pass
  `summaryMetrics` to remap.
- **Sampling decision is per-span, not per-trace.** A parent that
  survived sampling can spawn children that don't – they inherit the
  `traceId` but won't be retained. Set `sampleRate: 1.0` for full traces
  in dev.
- **Aggregation is across all labels.** `agent.errors` with
  `{agent: "support"}` and `{agent: "billing"}` aggregates into one
  `AggregatedMetric` – the per-label cardinality only shows up via the
  exporter or `metricDataPoints` (which is private).
- **Alert cooldowns survive `clear()` but not `destroy()`.** If you
  hot-restart in tests, build a fresh instance – the old one's
  cooldown Map lives until garbage collection.
- **Exporter errors are caught and logged to `console.error`** with
  prefix `[Directive Observability] Export error:`. The export timer
  keeps running.
- **`getHealthStatus().healthy` thresholds are baked in.** Considered
  unhealthy when `errorRate >= 0.1` *or* any alert in the last 5
  minutes. Roll your own status if you need different thresholds.

## See also

- [`createCircuitBreaker`](./circuit-breaker.md) – pass the same `obs`
  to get free state-change / success / failure / latency metrics.
- [`performancePlugin`](./performance.md) – engine-side perf metrics
  (constraints, resolvers, reconcile) rather than agent-side metrics.
- [`createOTLPExporter`](https://github.com/directive-run/directive/blob/main/packages/core/src/plugins/otlp-exporter.ts)
  – wire `metrics.exporter` / `tracing.exporter` to OpenTelemetry.
- [`createAuditLedger`](./audit-ledger.md) – durable record of state
  changes; observability is for *operational* metrics, not the audit
  trail.
