---
title: Circuit Breaker
description: Protect against cascading failures with automatic fault isolation and recovery using the 3-state circuit breaker pattern.
---

The circuit breaker prevents cascading failures when downstream services are degraded. It tracks error rates and automatically blocks requests to failing services, then gradually restores traffic after a recovery period. {% .lead %}

---

## Quick Start

```typescript
import { createCircuitBreaker } from '@directive-run/core/plugins';

const breaker = createCircuitBreaker({
  name: 'payments-api',
  failureThreshold: 5,
  recoveryTimeMs: 30000,
});

// Wrap any async operation
const result = await breaker.execute(async () => {
  return await fetch('/api/payments');
});
```

---

## How It Works

The circuit breaker has three states:

```
         Failures ≥ threshold
  ┌────────┐                ┌──────┐
  │ CLOSED │───────────────▶│ OPEN │
  │        │                │      │
  └────────┘                └──┬───┘
       ▲                       │
       │  All trial requests   │  Recovery time elapsed
       │      succeed          ▼
       │                  ┌──────────┐
       └──────────────────│ HALF_OPEN│
                          └──────────┘
```

| State | Behavior |
|-------|----------|
| **CLOSED** | Normal operation. Requests pass through. Failures are counted within a sliding window. |
| **OPEN** | Requests are rejected immediately with `CircuitBreakerOpenError`. No calls reach the downstream service. |
| **HALF_OPEN** | After `recoveryTimeMs`, a limited number of trial requests are allowed through. If they all succeed, the circuit closes. If any fail, it reopens. |

---

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | `"default"` | Name for this circuit (used in errors and metrics) |
| `failureThreshold` | `number` | `5` | Failures within the window before opening the circuit |
| `recoveryTimeMs` | `number` | `30000` | Time in ms before transitioning from OPEN to HALF_OPEN |
| `halfOpenMaxRequests` | `number` | `3` | Trial requests allowed in HALF_OPEN state |
| `failureWindowMs` | `number` | `60000` | Sliding window in ms for counting failures. Older failures are forgotten. |
| `isFailure` | `(error: Error) => boolean` | All errors count | Custom classifier – return `false` to treat an error as a success (e.g., 404s) |
| `onStateChange` | `(from, to) => void` | – | Callback when the circuit transitions between states |
| `observability` | `ObservabilityInstance` | – | Optional observability instance for automatic metric tracking |
| `metricPrefix` | `string` | `"circuit_breaker"` | Metric name prefix when observability is provided |

```typescript
const breaker = createCircuitBreaker({
  name: 'openai-api',
  failureThreshold: 3,
  recoveryTimeMs: 15000,
  halfOpenMaxRequests: 2,
  failureWindowMs: 30000,

  // Don't count 404s as failures
  isFailure: (error) => !error.message.includes('404'),

  onStateChange: (from, to) => {
    console.log(`Circuit ${from} → ${to}`);
  },
});
```

---

## CircuitBreakerOpenError

When the circuit is open, `execute()` throws a `CircuitBreakerOpenError` instead of calling the wrapped function:

```typescript
import { CircuitBreakerOpenError } from '@directive-run/core/plugins';

try {
  await breaker.execute(() => fetch('/api/data'));
} catch (error) {
  if (error instanceof CircuitBreakerOpenError) {
    console.log(error.retryAfterMs); // ms until the circuit might allow requests
    console.log(error.state);        // "OPEN" or "HALF_OPEN"
    console.log(error.code);         // "CIRCUIT_OPEN"
  }
}
```

---

## Using with Directive

The circuit breaker is a standalone utility, not a system-level config. Wrap calls inside your resolver's `resolve()` function. This keeps the circuit breaker close to the service it protects and lets you use different breakers for different external services.

```typescript
const apiModule = createModule('api', {
  schema: {
    data: t.object<Record<string, unknown> | null>(),
    error: t.string().nullable(),
    circuitOpen: t.boolean(),
  },

  init: (facts) => {
    facts.data = null;
    facts.error = null;
    facts.circuitOpen = false;
  },

  constraints: {
    // Detect when the circuit opens and require a fallback
    apiFailing: {
      when: () => breaker.getState() === 'OPEN',
      require: { type: 'USE_FALLBACK' },
    },

    // Normal data fetch when the circuit is closed
    needsData: {
      when: (facts) => facts.data === null && breaker.getState() !== 'OPEN',
      require: { type: 'FETCH_DATA' },
    },
  },

  resolvers: {
    fetchData: {
      requirement: 'FETCH_DATA',
      resolve: async (req, context) => {
        // execute() tracks success/failure automatically
        const response = await breaker.execute(() => fetch('/api/data'));
        context.facts.data = await response.json();
      },
    },

    useFallback: {
      requirement: 'USE_FALLBACK',
      resolve: async (req, context) => {
        context.facts.circuitOpen = true;
        context.facts.data = await cache.getData();
      },
    },
  },
});
```

---

## Instance Methods

### `execute<T>(fn: () => Promise<T>): Promise<T>`

Run an async operation through the circuit breaker. Tracks success/failure automatically.

### `getState(): CircuitState`

Returns the current state: `"CLOSED"`, `"OPEN"`, or `"HALF_OPEN"`. Automatically transitions from OPEN to HALF_OPEN when recovery time has elapsed.

### `getStats(): CircuitBreakerStats`

Returns cumulative statistics:

```typescript
const stats = breaker.getStats();
// {
//   state: "CLOSED",
//   totalRequests: 142,
//   totalFailures: 3,
//   totalSuccesses: 137,
//   totalRejected: 2,
//   recentFailures: 1,
//   lastFailureTime: 1709312400000,
//   lastSuccessTime: 1709312450000,
//   lastStateChange: 1709312300000,
// }
```

### `isAllowed(): boolean`

Check if a request would be allowed without executing it. Useful for UI indicators.

### `forceState(state: CircuitState): void`

Force the circuit to a specific state. Useful for testing or manual intervention.

### `reset(): void`

Reset the circuit to CLOSED with all stats cleared.

---

## Observability Integration

Pass an observability instance to automatically track circuit breaker metrics:

```typescript
import { createCircuitBreaker, createObservability } from '@directive-run/core/plugins';

const obs = createObservability({ serviceName: 'my-app' });

const breaker = createCircuitBreaker({
  name: 'payments',
  observability: obs,
  metricPrefix: 'payments_circuit',
});

// Metrics recorded automatically:
// - payments_circuit.requests  (counter)
// - payments_circuit.success   (counter)
// - payments_circuit.failure   (counter)
// - payments_circuit.rejected  (counter)
// - payments_circuit.latency   (histogram)
// - payments_circuit.state_change (counter, with from/to labels)
```

---

## Next Steps

- [Self-Healing](/ai/self-healing) – AI-powered circuit breaker recovery
- [Error Handling](/docs/advanced/errors) – Retry policies and error boundaries
- [Error Boundaries Example](/docs/examples/error-boundaries) – Interactive demo
- [Observability](/docs/plugins/observability) – Metrics and dashboards
