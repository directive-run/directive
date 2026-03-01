---
title: Handle Agent Errors
description: Handle LLM failures gracefully with retry, fallback, and circuit breaker patterns.
---

Handle LLM failures gracefully with retry, fallback, and circuit breaker patterns. {% .lead %}

---

## The Problem

LLM API calls fail. Rate limits hit, networks timeout, providers go down. Without resilience patterns, a single failure crashes your application or returns a broken response to the user.

## The Solution

Stack `withRetry` for transient errors, `withFallback` for provider failover, and `createCircuitBreaker` for fault isolation:

```typescript
import {
  withRetry,
  withFallback,
  pipe,
} from '@directive-run/ai';

// Retry transient failures with exponential backoff
const resilientRunner = pipe(
  primaryRunner, // See Running Agents (/ai/running-agents) for setup
  (r) => withRetry(r, {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    isRetryable: (error) => {
      return error.message.includes('rate limit') ||
             error.message.includes('timeout');
    },
  }),
);

// Fall back to a cheaper model if primary fails
const fallbackRunner = withFallback(
  [resilientRunner, backupRunner], // See Running Agents (/ai/running-agents) for setup
  {
    onFallback: (fromIndex, toIndex, error) => {
      console.warn(`Falling back from runner ${fromIndex} to ${toIndex}: ${error.message}`);
    },
  },
);
```

## How It Works

```
    Retry
    ─────────────────────────────────────────────
    Attempt 1 ──wait──► Attempt 2 ──wait──► Attempt 3
       ✗                   ✗                  ✗ exhaust
                                               │
    Fallback                                   ▼
    ─────────────────────────────────────────────
    Primary ──fail──► Backup
                        │
    Circuit Breaker      ▼
    ─────────────────────────────────────────────
    Closed ──failures──► Open ──cooldown──► Half-Open
       ▲                                      │
       └────────────── success ───────────────┘
```

- **`withRetry`** catches errors and retries with exponential backoff. `isRetryable` controls which errors trigger retries vs. immediate failure.
- **`withFallback`** tries runners in order. When one fails all retries, it moves to the next. Useful for provider failover (OpenAI -> Anthropic -> local model).
- **`pipe`** composes middleware left to right. The runner flows through each wrapper.
- **`createCircuitBreaker`** tracks failure rates and "trips" the circuit when a threshold is exceeded, failing fast instead of hammering a broken service.

## Full Example

A production setup with all three resilience layers:

```typescript
import {
  createAgentOrchestrator,
  withRetry,
  withFallback,
  pipe,
  createCircuitBreaker,
} from '@directive-run/ai';

// Circuit breaker trips after 5 failures in 60 seconds
const breaker = createCircuitBreaker({
  failureThreshold: 5,
  recoveryTimeMs: 30000,
  halfOpenMaxRequests: 3,
  onStateChange: (from, to) => {
    console.warn(`Circuit breaker: ${from} -> ${to}`);
    if (to === 'open') {
      alertOps('Primary LLM circuit breaker tripped'); // Your alerting function
    }
  },
});

// Primary: retry with backoff, protected by circuit breaker
const primaryWithRetry = pipe(
  primaryRunner, // See Running Agents (/ai/running-agents) for setup
  (r) => withRetry(r, {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 15000,
    isRetryable: (error) => {
      return error.message.includes('rate limit') ||
             error.message.includes('503') ||
             error.message.includes('timeout');
    },
    onRetry: (attempt, error, delayMs) => {
      console.log(`Retry ${attempt}: ${error.message} (waiting ${delayMs}ms)`);
    },
  }),
);

// Backup: cheaper model, also with retries
const backupWithRetry = pipe(
  backupRunner, // See Running Agents (/ai/running-agents) for setup
  (r) => withRetry(r, {
    maxRetries: 2,
    baseDelayMs: 500,
  }),
);

// Fallback chain: primary -> backup
const resilientRunner = withFallback(
  [primaryWithRetry, backupWithRetry],
  {
    shouldFallback: (error) => {
      // Don't fall back on auth errors — those won't fix themselves
      return !error.message.includes('401');
    },
    onFallback: (from, to, error) => {
      console.warn(`Provider failover: ${from} -> ${to}`);
    },
  },
);

const orchestrator = createAgentOrchestrator({
  runner: resilientRunner,
  autoApproveToolCalls: true,
  circuitBreaker: breaker,
});

// Check circuit breaker state
console.log(`Circuit state: ${breaker.getState()}`);
console.log(`Stats:`, breaker.getStats());
```

## Related

- [Resilience & Routing](/ai/resilience-routing) — full middleware reference
- [Control AI Costs guide](/ai/guides/control-ai-costs) — budget middleware to prevent runaway spending
