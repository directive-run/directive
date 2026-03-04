---
title: Observability
description: Collect metrics, traces, and alerts for monitoring system health and diagnosing issues.
---

The observability utility provides metrics collection, distributed tracing, alerting, and a dashboard API for monitoring Directive systems and AI agents in production. {% .lead %}

---

## Quick Start

```typescript
import { createObservability } from '@directive-run/core/plugins';

const obs = createObservability({
  serviceName: 'my-app',
  metrics: { enabled: true },
  tracing: { enabled: true },
  alerts: [
    { metric: 'agent.errors', threshold: 10, action: 'warn' },
  ],
});

// Record metrics
obs.incrementCounter('agent.requests', { agent: 'support' });
obs.observeHistogram('agent.latency', 1250, { agent: 'support' });

// Access dashboard data
const dashboard = obs.getDashboard();

// Clean up when done
await obs.dispose();
```

---

## Configuration

```typescript
const obs = createObservability({
  serviceName: 'my-agent-service',

  metrics: {
    enabled: true,           // Default: true
    exportInterval: 10000,   // Export metrics every 10s
    exporter: async (metrics) => { /* send to your backend */ },
    maxDataPoints: 1000,     // Max data points per metric (default: 1000)
  },

  tracing: {
    enabled: true,           // Default: true
    sampleRate: 0.1,         // Sample 10% of traces in production
    maxSpans: 1000,          // Max completed spans retained (default: 1000)
    exporter: async (spans) => { /* send to your backend */ },
  },

  alerts: [
    { metric: 'agent.errors', threshold: 10, action: 'warn' },
    { metric: 'agent.latency', threshold: 5000, action: 'alert' },
    {
      metric: 'agent.cost',
      threshold: 100,
      operator: '>=',
      action: 'callback',
      callback: (metric, threshold) => notifyTeam(metric),
      cooldownMs: 300000, // Don't re-alert for 5 minutes
    },
  ],

  events: {
    onMetricRecorded: (metric) => { /* ... */ },
    onSpanStart: (span) => { /* ... */ },
    onSpanEnd: (span) => { /* ... */ },
    onAlert: (alert) => { /* ... */ },
  },
});
```

---

## Metric Types

Record four types of metrics:

### Counter

Monotonically increasing value. Use for request counts, error counts, token usage.

```typescript
obs.incrementCounter('agent.requests', { agent: 'support' });
obs.incrementCounter('agent.tokens', { agent: 'support' }, 500); // increment by 500
```

### Gauge

Point-in-time value that can go up or down. Use for active connections, queue depth.

```typescript
obs.setGauge('active_agents', 3);
obs.setGauge('queue_depth', 42, { queue: 'main' });
```

### Histogram

Distribution of values. Use for latency, response sizes. Percentiles (p50, p90, p99) are calculated automatically.

```typescript
obs.observeHistogram('agent.latency', 1250, { agent: 'support' });
```

### Reading Metrics

```typescript
const metric = obs.getMetric('agent.latency');
// {
//   name: "agent.latency",
//   type: "histogram",
//   count: 142,
//   sum: 178500,
//   min: 200,
//   max: 8500,
//   avg: 1257,
//   p50: 1100,
//   p90: 3200,
//   p99: 7800,
//   lastValue: 1250,
//   lastUpdated: 1709312450000,
// }
```

---

## Tracing

Create spans to track operation duration and build distributed traces:

```typescript
const span = obs.startSpan('agent.run');
obs.addSpanTag(span.spanId, 'agent', 'support');

try {
  await runAgent();
  obs.addSpanLog(span.spanId, 'Agent completed successfully');
  obs.endSpan(span.spanId, 'ok');
} catch (error) {
  obs.addSpanLog(span.spanId, error.message, 'error');
  obs.endSpan(span.spanId, 'error');
}
```

### Nested Spans

Pass a parent span ID to create child spans:

```typescript
const parentSpan = obs.startSpan('pipeline');
const childSpan = obs.startSpan('agent.run', parentSpan.spanId);

// Child inherits the parent's traceId
console.log(childSpan.traceId === parentSpan.traceId); // true
```

### Sampling

Control the percentage of traces collected in production:

```typescript
const obs = createObservability({
  tracing: {
    sampleRate: 0.1, // Only trace 10% of operations
  },
});
```

Sampled-out spans are no-ops – `startSpan` returns immediately and `endSpan`/`addSpanLog`/`addSpanTag` are skipped.

---

## Alerts

Define thresholds that trigger actions when metrics cross them:

```typescript
const obs = createObservability({
  alerts: [
    // Log when error count exceeds 10
    { metric: 'agent.errors', threshold: 10, action: 'log' },

    // Console.warn when latency exceeds 5s
    { metric: 'agent.latency', threshold: 5000, action: 'warn' },

    // Console.error (alert) when cost exceeds $100
    { metric: 'agent.cost', threshold: 100, operator: '>=', action: 'alert' },

    // Custom callback with cooldown
    {
      metric: 'agent.errors',
      threshold: 50,
      action: 'callback',
      callback: (metric, threshold) => pagerDuty.trigger(metric),
      cooldownMs: 600000, // Once per 10 minutes
    },
  ],
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `metric` | `string` | – | Metric name to watch |
| `threshold` | `number` | – | Value that triggers the alert |
| `operator` | `">" \| "<" \| ">=" \| "<=" \| "=="` | `">"` | Comparison operator |
| `action` | `"log" \| "warn" \| "alert" \| "callback"` | – | What to do when triggered |
| `callback` | `(metric, threshold) => void` | – | Custom handler (when action is `"callback"`) |
| `cooldownMs` | `number` | `60000` | Minimum time between repeated alerts |

---

## Agent Metrics Helper

`createAgentMetrics` provides a convenience wrapper that records standard metric names for agent operations. These names are used by `getDashboard().summary` automatically.

```typescript
import { createObservability, createAgentMetrics } from '@directive-run/core/plugins';

const obs = createObservability({ serviceName: 'my-service' });
const agentMetrics = createAgentMetrics(obs);

// Track an agent run
agentMetrics.trackRun('support-agent', {
  success: true,
  latencyMs: 1500,
  inputTokens: 100,
  outputTokens: 500,
  cost: 0.05,
});

// Track guardrail checks
agentMetrics.trackGuardrail('content-filter', {
  passed: true,
  latencyMs: 12,
});

// Track approval workflows
agentMetrics.trackApproval('delete-account', {
  approved: true,
  waitTimeMs: 3500,
});

// Track agent handoffs
agentMetrics.trackHandoff('triage', 'support', 250);
```

### Standard Metric Names

| Method | Metrics Recorded |
|--------|-----------------|
| `trackRun` | `agent.requests`, `agent.errors`, `agent.latency`, `agent.tokens`, `agent.tokens.input`, `agent.tokens.output`, `agent.cost`, `agent.tool_calls` |
| `trackGuardrail` | `guardrail.checks`, `guardrail.failures`, `guardrail.blocks`, `guardrail.latency` |
| `trackApproval` | `approval.requests`, `approval.approved`, `approval.rejected`, `approval.timeouts`, `approval.wait_time` |
| `trackHandoff` | `handoff.count`, `handoff.latency` |

---

## Dashboard

`getDashboard()` returns a snapshot of all collected data for building monitoring UIs:

```typescript
const dashboard = obs.getDashboard();

// Service info
console.log(dashboard.service.name);    // "my-service"
console.log(dashboard.service.uptime);  // ms since creation

// Summary stats (uses standard agent metric names)
console.log(dashboard.summary.totalRequests);
console.log(dashboard.summary.errorRate);
console.log(dashboard.summary.avgLatency);
console.log(dashboard.summary.p99Latency);
console.log(dashboard.summary.totalTokens);
console.log(dashboard.summary.totalCost);

// All aggregated metrics
console.log(dashboard.metrics);

// Recent traces and active alerts
console.log(dashboard.traces);
console.log(dashboard.alerts);
```

### Custom Summary Metrics

By default, the dashboard summary reads from `agent.requests`, `agent.errors`, `agent.latency`, `agent.tokens`, and `agent.cost`. Override these if your metric names differ:

```typescript
const obs = createObservability({
  summaryMetrics: {
    requests: 'app.requests',
    errors: 'app.errors',
    latency: 'app.latency',
  },
});
```

---

## Health Status

Get a simple health check for status pages or load balancers:

```typescript
const health = obs.getHealthStatus();
// {
//   healthy: true,
//   uptime: 3600000,
//   errorRate: 0.02,
//   activeAlerts: 0,
// }
```

The instance is considered unhealthy when the error rate exceeds 10% or there are active alerts within the last 5 minutes.

---

## Cleanup

Always dispose when shutting down to flush pending exports and clear timers:

```typescript
await obs.dispose();
```

To clear data without disposing (e.g., between test runs):

```typescript
obs.clear();
```

---

## Next Steps

- [OpenTelemetry](/ai/otel) – Export to OpenTelemetry-compatible backends
- [Performance Plugin](/docs/plugins/performance) – Built-in constraint/resolver metrics
- [Circuit Breaker](/docs/plugins/circuit-breaker) – Fault isolation with observability integration
