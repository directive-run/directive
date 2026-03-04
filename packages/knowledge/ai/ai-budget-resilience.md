# AI Budget and Resilience

Budget wrappers, retry policies, fallback chains, circuit breakers, health monitors, semantic caching, and constraint-driven provider routing for AI runners.

## Decision Tree: "How do I protect my AI calls?"

```
What failure mode are you guarding against?
├── Cost overruns → withBudget(runner, { budgets: [...] })
├── Transient errors → withRetry(runner, { maxRetries, backoff })
├── Provider outage → withFallback(primaryRunner, fallbackRunner)
├── Repeated failures → createCircuitBreaker({ failureThreshold })
├── Fleet monitoring → createHealthMonitor({ agents: {...} })
│
Want to avoid redundant LLM calls?
├── Yes, similar inputs → createSemanticCache({ embedder, similarity })
│
Need dynamic provider selection?
└── Yes → createConstraintRouter({ providers: [...], constraints: [...] })
```

## Budget Wrapping

Wrap any runner with cost tracking and enforcement per time window:

```typescript
import { withBudget } from "@directive-run/ai";

const budgetRunner = withBudget(baseRunner, {
  // Hard cap per single LLM call
  maxCostPerCall: 0.10,

  // Time-window budgets (multiple allowed)
  budgets: [
    {
      window: "hour",
      maxCost: 1.0,
      pricing: { inputPerMillion: 3, outputPerMillion: 15 },
    },
    {
      window: "day",
      maxCost: 10.0,
      pricing: { inputPerMillion: 3, outputPerMillion: 15 },
    },
  ],

  // Callback when approaching limit (0-1 percentage)
  budgetWarningThreshold: 0.8,
  onWarning: (usage) => {
    console.warn(`Budget at ${(usage.percentage * 100).toFixed(0)}%`);
  },
});
```

### Anti-Pattern #29: budgetWarningThreshold out of range

```typescript
// WRONG – threshold must be a 0-1 percentage
const budgetRunner = withBudget(baseRunner, {
  budgetWarningThreshold: 80, // Not a percentage!
  budgets: [{ window: "hour", maxCost: 1.0, pricing: { inputPerMillion: 3, outputPerMillion: 15 } }],
});

// CORRECT – use a decimal between 0 and 1
const budgetRunner = withBudget(baseRunner, {
  budgetWarningThreshold: 0.8, // 80%
  budgets: [{ window: "hour", maxCost: 1.0, pricing: { inputPerMillion: 3, outputPerMillion: 15 } }],
});
```

## Retry Policies

Wrap a runner with automatic retry on transient failures:

```typescript
import { withRetry } from "@directive-run/ai";

const retryRunner = withRetry(baseRunner, {
  maxRetries: 3,
  backoff: "exponential", // "exponential" | "linear" | "none"
  baseDelayMs: 100,

  // Only retry specific errors
  shouldRetry: (error) => {
    return error.status === 429 || error.status >= 500;
  },
});
```

## Fallback Chains

Automatically switch to a backup runner when the primary fails:

```typescript
import { withFallback } from "@directive-run/ai";
import { createAnthropicRunner } from "@directive-run/ai/anthropic";
import { createOpenAIRunner } from "@directive-run/ai/openai";

const primary = createAnthropicRunner({ apiKey: process.env.ANTHROPIC_API_KEY });
const backup = createOpenAIRunner({ apiKey: process.env.OPENAI_API_KEY });

// Falls back to backup when primary throws
const resilientRunner = withFallback(primary, backup);
```

## Circuit Breaker

Prevent repeated calls to a failing provider. Opens after N failures, resets after a timeout:

```typescript
import { createCircuitBreaker } from "@directive-run/ai";

const breaker = createCircuitBreaker({
  failureThreshold: 3,     // Open after 3 consecutive failures
  resetTimeout: 30000,     // Try again after 30s (half-open state)
  halfOpenMaxAttempts: 1,  // Allow 1 test request in half-open
});

// Use with a runner
const protectedRunner = breaker.wrap(baseRunner);

// Check state
console.log(breaker.state); // "closed" | "open" | "half-open"
breaker.reset();            // Force back to closed
```

### Anti-Pattern #28: Sharing a CircuitBreaker across unrelated agents

```typescript
// WRONG – one failing agent opens the breaker for all agents
const sharedBreaker = createCircuitBreaker({ failureThreshold: 3, resetTimeout: 30000 });
const researchRunner = sharedBreaker.wrap(baseRunner);
const writerRunner = sharedBreaker.wrap(baseRunner); // Same breaker!

// CORRECT – each agent gets its own breaker instance
const researchBreaker = createCircuitBreaker({ failureThreshold: 3, resetTimeout: 30000 });
const writerBreaker = createCircuitBreaker({ failureThreshold: 3, resetTimeout: 30000 });

const researchRunner = researchBreaker.wrap(baseRunner);
const writerRunner = writerBreaker.wrap(baseRunner);
```

## Health Monitor

Monitor agent health across the system, track circuit breaker states, and report status:

```typescript
import { createHealthMonitor } from "@directive-run/ai";

const monitor = createHealthMonitor({
  agents: {
    researcher: { runner: researchRunner, circuitBreaker: researchBreaker },
    writer: { runner: writerRunner, circuitBreaker: writerBreaker },
  },
  checkInterval: 60000, // Health check every 60s

  onStatusChange: (agent, status) => {
    console.log(`${agent}: ${status}`); // "healthy" | "degraded" | "unhealthy"
  },
});

monitor.start();
const report = monitor.getReport();
monitor.stop();
```

## Semantic Cache

Cache LLM responses by semantic similarity to avoid redundant calls:

```typescript
import { createSemanticCache } from "@directive-run/ai";
import { createOpenAIEmbedder } from "@directive-run/ai/openai";

const cache = createSemanticCache({
  embedder: createOpenAIEmbedder({ apiKey: process.env.OPENAI_API_KEY }),
  similarity: 0.98,   // Minimum cosine similarity to count as a hit
  maxSize: 1000,       // Max cached entries (LRU eviction)
  ttl: 3600000,        // Cache entry TTL in ms (1 hour)
});

// Wrap a runner with caching
const cachedRunner = cache.wrap(baseRunner);
```

## Constraint-Driven Provider Routing

Route LLM calls to different providers based on runtime constraints:

```typescript
import { createConstraintRouter } from "@directive-run/ai";

const router = createConstraintRouter({
  providers: [
    { name: "anthropic", runner: anthropicRunner, costPerMillion: 3 },
    { name: "openai", runner: openaiRunner, costPerMillion: 5 },
    { name: "ollama", runner: ollamaRunner, costPerMillion: 0 },
  ],
  constraints: [
    // Use cheapest provider when budget is low
    { when: (context) => context.budgetRemaining < 1.0, prefer: "ollama" },
    // Use best provider for high-priority tasks
    { when: (context) => context.priority === "high", prefer: "anthropic" },
  ],
});
```

## Combining Wrappers

Wrappers compose – apply them inside-out (innermost runs first):

```typescript
import { withBudget, withRetry, withFallback } from "@directive-run/ai";

// Order: retry → budget → fallback
const resilientRunner = withFallback(
  withBudget(
    withRetry(primaryRunner, { maxRetries: 3, backoff: "exponential", baseDelayMs: 100 }),
    { budgets: [{ window: "hour", maxCost: 1.0, pricing: { inputPerMillion: 3, outputPerMillion: 15 } }] },
  ),
  fallbackRunner,
);
```

## Quick Reference

| Utility | Purpose | Key Options |
|---|---|---|
| `withBudget` | Cost caps per time window | `budgets`, `maxCostPerCall` |
| `withRetry` | Retry transient failures | `maxRetries`, `backoff`, `shouldRetry` |
| `withFallback` | Switch to backup runner | primary, fallback runners |
| `createCircuitBreaker` | Stop calling failing providers | `failureThreshold`, `resetTimeout` |
| `createHealthMonitor` | Fleet health tracking | `agents`, `checkInterval` |
| `createSemanticCache` | Avoid redundant LLM calls | `similarity`, `maxSize`, `ttl` |
| `createConstraintRouter` | Dynamic provider selection | `providers`, `constraints` |
