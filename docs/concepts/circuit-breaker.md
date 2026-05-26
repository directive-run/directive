---
title: createCircuitBreaker
description: Three-state circuit breaker (CLOSED / OPEN / HALF_OPEN) for async operations – sliding failure window, recovery timeout, half-open trial requests, optional observability metrics.
---

# `createCircuitBreaker` – fail fast when downstreams degrade

> Wraps any async operation in a circuit breaker. Counts recent failures
> in a sliding window, trips OPEN when the threshold is hit, auto-
> transitions to HALF_OPEN after the recovery timeout, and falls back to
> CLOSED once HALF_OPEN trial requests succeed. Optional observability
> integration wires every state change, success, failure, latency, and
> rejection into your metrics pipeline.

## What it does

`createCircuitBreaker(config)` returns a `CircuitBreaker` instance with
`execute(fn)`, `getState()`, `getStats()`, `forceState()`, `reset()`,
and `isAllowed()`. Three states:

- **CLOSED** – normal operation. Failures within the
  `failureWindowMs` rolling window are counted; once they hit
  `failureThreshold`, transition to OPEN.
- **OPEN** – requests are rejected immediately with
  `CircuitBreakerOpenError`. After `recoveryTimeMs`, the next
  `execute()` (or `getState()` call) transitions to HALF_OPEN.
- **HALF_OPEN** – up to `halfOpenMaxRequests` trial requests are
  allowed through. Each success counts; once the count hits the cap,
  transition back to CLOSED and clear the failure window. Any failure
  immediately transitions back to OPEN.

## When to use

- Calling out to flaky LLM APIs, MCP servers, embedding services, or
  any external dependency that can take you down.
- Wrapping a Directive resolver to bail fast when its downstream is
  degraded, then surfacing the state in a `when:` constraint to
  trigger a `FALLBACK_RESPONSE` requirement.
- Multi-region failover – one breaker per region, route to the first
  `isAllowed()` region.
- Per-tenant or per-tool isolation – give each circuit a unique
  `name` and read the stats individually.
- Driving observability – pass an `ObservabilityInstance` to record
  state changes and latency without writing wiring code.

## Quick start

```ts
import { createCircuitBreaker } from "@directive-run/core/plugins";

const breaker = createCircuitBreaker({
  name: "openai-chat",
  failureThreshold: 5,
  recoveryTimeMs: 30_000,
  halfOpenMaxRequests: 3,
  failureWindowMs: 60_000,
  isFailure: (err) => !err.message.includes("rate_limit"),
  onStateChange: (from, to) => console.warn(`breaker ${from} → ${to}`),
});

try {
  const result = await breaker.execute(() => openai.chat.completions.create({ ... }));
} catch (err) {
  if (err.code === "CIRCUIT_OPEN") {
    // err.retryAfterMs tells you when to try again
  }
  throw err;
}

// Or check before executing
if (breaker.isAllowed()) {
  // ...
}
```

Wire into a Directive constraint:

```ts
constraints: {
  apiDegraded: {
    when: () => breaker.getState() === "OPEN",
    require: { type: "FALLBACK_RESPONSE" },
  },
}
```

## Options

| Field                  | Default | Description |
| ---------------------- | ------- | ----------- |
| `failureThreshold`     | `5`     | Number of failures within `failureWindowMs` before transitioning CLOSED → OPEN. Must be `>= 1` and finite – otherwise the factory throws. |
| `recoveryTimeMs`       | `30000` | Time in OPEN before the next request transitions to HALF_OPEN. Must be `> 0` and finite. |
| `halfOpenMaxRequests`  | `3`     | Maximum concurrent trial requests in HALF_OPEN. Once this many succeed, transition to CLOSED. Must be `>= 1` and finite. |
| `failureWindowMs`      | `60000` | Sliding window for counting failures in CLOSED. Failures older than this are forgotten. Must be `> 0` and finite. |
| `observability`        | –       | `ObservabilityInstance` from [`createObservability`](./observability.md). When set, every state change, request, success, failure, rejection, and latency is recorded. |
| `metricPrefix`         | `"circuit_breaker"` | Prefix for observability metric names. Emits `{prefix}.requests`, `{prefix}.success`, `{prefix}.failure`, `{prefix}.rejected`, `{prefix}.state_change`, `{prefix}.latency`. |
| `name`                 | `"default"` | Identifier used in metrics labels and error messages. |
| `isFailure`            | `() => true` | Classifier – return `true` if an error should count as a failure. Use this to ignore non-fault errors (rate limits, validation, user input). Non-failures count as successes. |
| `onStateChange`        | –       | Callback fired on every state transition (including `reset()` back to CLOSED). |

## How it works

```
execute(fn):
  totalRequests++; obs.requests++
  if state === "OPEN":
    if elapsed >= recoveryTimeMs: transition("HALF_OPEN")
    else: throw CircuitBreakerOpenError(name, retryAfter)
  if state === "HALF_OPEN":
    if halfOpenRequests >= halfOpenMaxRequests:
      throw CircuitBreakerOpenError(name, recoveryTimeMs, "HALF_OPEN", "Max trial reached")
    halfOpenRequests++
  try { result = await fn(); recordSuccess(); obs.latency }
  catch (err) { recordFailure(err); obs.latency; throw }

recordSuccess():
  totalSuccesses++; lastSuccessTime = now
  if state === "HALF_OPEN" and halfOpenSuccesses >= cap:
    transition("CLOSED"); clear failure window

recordFailure(err):
  if !isFailure(err): recordSuccess(); return
  totalFailures++; failureTimestamps.push(now)
  cap failureTimestamps to 2 * failureThreshold (slice tail)
  if state === "HALF_OPEN": transition("OPEN")
  elif state === "CLOSED" and recentFailures >= threshold: transition("OPEN")
```

`getRecentFailures()` filters `failureTimestamps` in place – older
entries are evicted on every read, so the array stays bounded.

`getState()` auto-transitions OPEN → HALF_OPEN when the recovery time
has elapsed, so simply reading the state can wake up the breaker.

## Errors

`CircuitBreakerOpenError`:

- `code: "CIRCUIT_OPEN"`
- `retryAfterMs: number` – milliseconds until OPEN → HALF_OPEN is
  eligible.
- `state: "OPEN" | "HALF_OPEN"` – which arm rejected.
- `name: "CircuitBreakerOpenError"` – for `instanceof` / `name`
  checks.

Thrown synchronously from `execute()` when the request is rejected
without invoking `fn`.

## Footguns

- **`isFailure` swaps the failure semantic.** Returning `false` treats
  the error as a success – `totalSuccesses` increments, HALF_OPEN
  trials count toward closing. If you want "don't count this and don't
  treat as success either", you need to wrap `execute()` yourself and
  not pass the rejection through.
- **The breaker is shared state.** A single breaker instance is shared
  across all `execute()` callers. Per-tenant isolation means per-tenant
  breakers – build a `Map<tenant, CircuitBreaker>` if needed.
- **`getState()` has side effects.** Calling it can transition OPEN →
  HALF_OPEN. Use `getStats()` if you want a pure read – it also calls
  `getState()` internally so it stays fresh, but the side effect is
  explicit there.
- **Stats reset on `reset()` but not on `forceState()`.** `forceState`
  jumps the state machine and fires `onStateChange`, but keeps the
  failure window and counters. Useful for tests, dangerous in prod.
- **Failure timestamps are capped at `2 * failureThreshold`.** Bursts
  bigger than that get silently truncated to the most recent. The
  recent-failures count still wins as long as the burst fits.
- **No queueing.** A rejected request is just rejected – no auto-retry,
  no fallback. Pair with a retry/backoff layer above (or below) if
  needed.
- **Observability metrics aren't auto-prefixed by name.** All breakers
  with the same `metricPrefix` write to the same metric names –
  differentiate via the `name` label. Same name + different prefix →
  separate metric series.
- **HALF_OPEN concurrency is request-count-based, not time-based.**
  `halfOpenMaxRequests` caps in-flight trial requests; once the cap is
  hit, further requests are rejected even if some trial requests are
  still pending. Pick a number that matches your downstream's healthy
  concurrency.

## See also

- [`createObservability`](./observability.md) – the metrics sink the
  breaker writes into when you pass `observability`.
- [Resolver retry & error boundaries](https://github.com/directive-run/directive/blob/main/docs/PLAN.md)
  – Directive's built-in retry; pair with a breaker for end-to-end
  resilience.
- [`createAuditLedger`](./audit-ledger.md) – record state changes for
  post-mortem analysis.
