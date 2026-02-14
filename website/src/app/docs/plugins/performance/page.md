---
title: Performance Plugin
description: Track constraint evaluation time, resolver latency, effect runs, and reconciliation cost with built-in metrics.
---

The performance plugin measures runtime behavior using existing plugin hooks – no core modifications needed. {% .lead %}

---

## Basic Usage

```typescript
import { performancePlugin } from 'directive/plugins';

const perf = performancePlugin();

const system = createSystem({
  module: myModule,
  plugins: [perf],
});

system.start();

// After the system has been running, check metrics
const snapshot = perf.getSnapshot();
console.log(snapshot.resolvers);
console.log(snapshot.reconcile);
```

---

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `onSlowConstraint` | `(id: string, durationMs: number) => void` | – | Callback when a constraint exceeds the slow threshold |
| `onSlowResolver` | `(id: string, durationMs: number) => void` | – | Callback when a resolver exceeds the slow threshold |
| `slowConstraintThresholdMs` | `number` | `16` | Threshold in ms for slow constraint warnings (one frame) |
| `slowResolverThresholdMs` | `number` | `1000` | Threshold in ms for slow resolver warnings |

```typescript
const perf = performancePlugin({
  slowConstraintThresholdMs: 8,
  slowResolverThresholdMs: 500,
  onSlowConstraint: (id, ms) => {
    console.warn(`Slow constraint "${id}": ${ms.toFixed(1)}ms`);
  },
  onSlowResolver: (id, ms) => {
    console.warn(`Slow resolver "${id}": ${ms.toFixed(0)}ms`);
  },
});
```

---

## Performance Snapshot

Call `perf.getSnapshot()` to get a full metrics snapshot at any time:

```typescript
const snapshot = perf.getSnapshot();
```

### Snapshot Shape

```typescript
interface PerformanceSnapshot {
  constraints: Record<string, ConstraintMetrics>;
  resolvers: Record<string, ResolverMetrics>;
  effects: Record<string, EffectMetrics>;
  reconcile: ReconcileMetrics;
  uptime: number; // ms since system.start()
}
```

### Constraint Metrics

| Field | Type | Description |
|-------|------|-------------|
| `evaluations` | `number` | Total number of evaluations |
| `totalDurationMs` | `number` | Cumulative evaluation time |
| `avgDurationMs` | `number` | Average evaluation time |
| `maxDurationMs` | `number` | Slowest single evaluation |
| `lastEvaluatedAt` | `number` | Timestamp of last evaluation |

### Resolver Metrics

| Field | Type | Description |
|-------|------|-------------|
| `starts` | `number` | Total resolver starts |
| `completions` | `number` | Successful completions |
| `errors` | `number` | Failed attempts |
| `retries` | `number` | Retry attempts |
| `cancellations` | `number` | Canceled resolvers |
| `totalDurationMs` | `number` | Cumulative resolve time |
| `avgDurationMs` | `number` | Average resolve time |
| `maxDurationMs` | `number` | Slowest single resolve |
| `lastCompletedAt` | `number` | Timestamp of last completion |

### Effect Metrics

| Field | Type | Description |
|-------|------|-------------|
| `runs` | `number` | Total effect executions |
| `errors` | `number` | Errors thrown |
| `lastRunAt` | `number` | Timestamp of last run |

### Reconcile Metrics

| Field | Type | Description |
|-------|------|-------------|
| `runs` | `number` | Total reconciliation cycles |
| `totalDurationMs` | `number` | Cumulative reconciliation time |
| `avgDurationMs` | `number` | Average cycle duration |
| `maxDurationMs` | `number` | Slowest cycle |

---

## Reset

Clear all collected metrics:

```typescript
perf.reset();
```

---

## Identifying Bottlenecks

Use the snapshot to find performance issues:

```typescript
const snapshot = perf.getSnapshot();

// Find the slowest resolver
const slowest = Object.entries(snapshot.resolvers)
  .sort(([, a], [, b]) => b.maxDurationMs - a.maxDurationMs)[0];

if (slowest) {
  console.log(`Slowest resolver: "${slowest[0]}" (${slowest[1].maxDurationMs}ms max)`);
}

// Check reconciliation health
if (snapshot.reconcile.avgDurationMs > 16) {
  console.warn(`Reconciliation averaging ${snapshot.reconcile.avgDurationMs.toFixed(1)}ms (above 16ms frame budget)`);
}
```

---

## Production

The performance plugin uses `performance.now()` for timing and has minimal overhead. You can run it in production for real-user monitoring, or limit it to development:

```typescript
const plugins = [];

if (process.env.NODE_ENV !== 'production') {
  plugins.push(performancePlugin({
    onSlowResolver: (id, ms) => console.warn(`Slow: ${id} (${ms}ms)`),
  }));
}
```

---

## Next Steps

- [Logging Plugin](/docs/plugins/logging) – console logging
- [DevTools Plugin](/docs/plugins/devtools) – browser integration
- [Plugin Overview](/docs/plugins/overview) – all built-in plugins
