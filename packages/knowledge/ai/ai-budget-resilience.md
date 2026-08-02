# AI budget + resilience

> Covers `@directive-run/ai` — `withBudget`, `withRetry`, `withFallback`, `createCircuitBreaker`, `createHealthMonitor`, `createSemanticCache`, `createConstraintRouter`.

Runner wrappers and supporting utilities for cost control, retry, fallback, circuit breaking, fleet health tracking, semantic caching, and constraint-driven provider routing. Compose these around any `AgentRunner` before passing it to an orchestrator.

## Decision tree

```
What failure mode are you guarding against?
├── Cost overruns           → withBudget(runner, config)
├── Transient errors        → withRetry(runner, config)
├── Provider outage         → withFallback([primary, backup], config?)
├── Repeated cascading fails → createCircuitBreaker(config) + breaker.execute(fn)
├── Fleet-wide health       → createHealthMonitor() + recordSuccess/Failure
├── Redundant LLM calls    → createSemanticCache(config) + createSemanticCacheGuardrail
└── Dynamic provider pick  → createConstraintRouter({ providers, constraints })
```

## `withBudget(runner, config)` — cost caps

`BudgetConfig` controls per-call and per-window cost limits. `onBudgetExceeded` fires in two phases and only one of them throws — see below. There is NO `budgetWarningThreshold` or `onWarning` option on this wrapper — for percentage-based warnings, use `onBudgetWarning` on `createAgentOrchestrator` instead.

```typescript
import { withBudget } from "@directive-run/ai";

const pricing = {
  inputPerMillion: 3,
  outputPerMillion: 15,
  cacheReadPerMillion: 0.3,   // optional — defaults to inputPerMillion
  cacheWritePerMillion: 3.75, // optional — defaults to inputPerMillion
};

const budgetRunner = withBudget(baseRunner, {
  maxCostPerCall: 0.10,
  pricing,                       // required when maxCostPerCall is set
  estimatedOutputMultiplier: 1.0, // for summarization use 0.3; for generation use 3.0
  charsPerToken: 4,
  budgets: [
    { window: "hour", maxCost: 5.00, pricing },
    { window: "day",  maxCost: 50.00, pricing },
  ],
  onBudgetExceeded: ({ estimated, actual, remaining, window, phase }) => {
    if (phase === "pre-call") {
      console.warn(`[budget] ${window} blocked — est $${estimated.toFixed(4)}, remaining $${remaining.toFixed(4)}`);
      return;
    }
    // phase === "post-call": the call already succeeded and the money is spent.
    console.warn(`[budget] ${window} overran — billed $${actual!.toFixed(4)} against a $${remaining.toFixed(4)} cap`);
  },
});
```

### `phase` — the callback does not always precede a throw

| `phase` | Trigger | Throws | Money spent |
|---|---|---|---|
| `"pre-call"` | The pre-call estimate exceeds a cap | `BudgetExceededError` | none — the call never ran |
| `"post-call"` | The provider billed more than `maxCostPerCall`, or pushed a rolling window past its cap | nothing | already spent |

`withBudget` gates an *estimate*. A call estimated at a cent that bills five dollars clears the gate, so the overrun can only be reported, never blocked. Treat `phase: "post-call"` as an alert, not a failure — do NOT retry on it.

`estimated` is the pre-call estimate in both phases. `actual` is what the provider billed and is present only when `phase` is `"post-call"`. The callback gets a frozen copy, so mutating it cannot alter the `BudgetExceededError` that follows a `"pre-call"` report.

Catching the throw:

```typescript
import { BudgetExceededError } from "@directive-run/ai";

try {
  await budgetRunner(agent, prompt);
} catch (err) {
  if (err instanceof BudgetExceededError) {
    console.log(err.window, err.estimated, err.remaining);
  }
}
```

### Reading spend

```typescript
import type { BudgetRunner } from "@directive-run/ai";

const runner = budgetRunner as BudgetRunner;

runner.getSpent("hour");       // rolling hour window; 0 if no hour budget is configured
runner.getSpent("day");        // rolling day window
runner.getSpent("total");      // lifetime spend for this runner
runner.getUnpricedCallCount(); // calls charged at the estimate rather than at billed usage
```

`getSpent("total")` is priced with the top-level `pricing` when supplied, otherwise with the first budget window's rates; it returns `0` only when neither is configured.

Two budgets on the same `window` are two caps reading one running total. A call is recorded there once, at the first budget's rates for that window — each budget's own rates still gate its own pre-call estimate.

When a runner reports no `tokenUsage`, reports a non-finite or negative token count, or reports counts that price out to a non-finite cost, `withBudget` charges the pre-call estimate rather than counting the call as free, increments `getUnpricedCallCount()`, and warns once per condition. A count that tracks your call count means every `getSpent` figure is an estimate.

### Config is validated and copied at construction

Rates, caps, and window names are read once, validated, and copied when the wrapper is built. A rate that is missing, non-finite, negative, or `-0` throws; a `window` other than `"hour"` or `"day"` throws rather than silently disabling the cap; mutating the objects you passed in afterwards has no effect. Zero rates are accepted (local models bill nothing) but warn when paired with a non-zero cap, since such a cap can never trip.

All four token classes are priced: input, output, cache read, and cache write. Cache rates default to the input rate when omitted — conservative, never free. The cache-write count is read from either `tokenUsage.cacheCreationTokens` or `tokenUsage.cacheWriteTokens`; adapters populate the first, and the second matches the rate's spelling. Published `cacheWritePerMillion` rates assume the 5-minute cache TTL — a 1-hour cache writes at 2.0x input rather than 1.25x, so pass your own rate if you use it.

The pre-call estimate charges input tokens at the highest of the input, cache-read, and cache-write rates: before the call there is no way to know how the provider will split them, and an estimate under the eventual bill is a cap that does not gate. It still reads the input string alone — not instructions, history, or tools — so it runs well under a real bill and is a floor, not a prediction.

## `withRetry(runner, config)` — transient-error retry

Exponential backoff with jitter is hard-coded; `backoff: "linear"` / `"none"` do NOT exist. The retry decision goes through built-in HTTP-status checks (non-retryable: 400 / 401 / 403 / 404 / 422) then your `isRetryable` predicate.

```typescript
import { withRetry } from "@directive-run/ai";

const retryRunner = withRetry(baseRunner, {
  maxRetries: 3,                    // default 3
  baseDelayMs: 1000,                // default 1000
  maxDelayMs: 30_000,               // default 30000
  isRetryable: (error) => {
    const msg = error.message.toLowerCase();
    return msg.includes("rate_limit") || msg.includes("503") || msg.includes("504");
  },
  onRetry: (attempt, error, delayMs) => {
    console.log(`retry ${attempt} in ${delayMs}ms — ${error.message}`);
  },
});
```

Catching the exhausted throw:

```typescript
import { RetryExhaustedError } from "@directive-run/ai";

try {
  await retryRunner(agent, prompt);
} catch (err) {
  if (err instanceof RetryExhaustedError) {
    console.log(`gave up after ${err.retryCount} retries; last: ${err.lastError.message}`);
  }
}
```

## `withFallback(runners[], config?)` — provider chain

**`withFallback` takes an ARRAY of runners as positional arg 1**, then an optional config. The chain tries each runner in order; the first success wins. When all fail, `AllProvidersFailedError` is thrown carrying all per-runner errors.

```typescript
import { withFallback, withRetry } from "@directive-run/ai";
import { createAnthropicRunner } from "@directive-run/ai/anthropic";
import { createOpenAIRunner } from "@directive-run/ai/openai";
import { createOllamaRunner } from "@directive-run/ai/ollama";

const resilient = withFallback(
  [
    withRetry(createAnthropicRunner({ apiKey: process.env.ANTHROPIC_API_KEY! }), { maxRetries: 2 }),
    withRetry(createOpenAIRunner({ apiKey: process.env.OPENAI_API_KEY! }),     { maxRetries: 2 }),
    createOllamaRunner({ baseUrl: "http://localhost:11434" }),
  ],
  {
    shouldFallback: (error) => !error.message.includes("invalid_api_key"),
    onFallback: (fromIndex, toIndex, error) => {
      console.log(`falling back from runner ${fromIndex} to ${toIndex}: ${error.message}`);
    },
  },
);
```

Catching all-failed:

```typescript
import { AllProvidersFailedError } from "@directive-run/ai";

try {
  await resilient(agent, prompt);
} catch (err) {
  if (err instanceof AllProvidersFailedError) {
    err.errors.forEach((e, i) => console.log(`[${i}] ${e.message}`));
  }
}
```

## `createCircuitBreaker(config)` — failure isolation

The circuit breaker is from `@directive-run/core` (it's not AI-specific). Use `breaker.execute(fn)` to run an arbitrary async closure inside the breaker; there is NO `breaker.wrap(runner)` shortcut.

```typescript
import { createCircuitBreaker, CircuitBreakerOpenError } from "@directive-run/core";

const breaker = createCircuitBreaker({
  name: "openai",
  failureThreshold: 5,         // default 5
  recoveryTimeMs: 30_000,      // default 30000
  halfOpenMaxRequests: 3,      // default 3 — concurrent test requests when half-open
  failureWindowMs: 60_000,     // default 60000
});

// Use with a runner: wrap the call inside execute()
async function callAgent(agent: AgentLike, input: string) {
  return await breaker.execute(() => baseRunner(agent, input));
}

// Inspect state
console.log(breaker.getState());       // "CLOSED" | "OPEN" | "HALF_OPEN"
console.log(breaker.getStats());       // { successCount, failureCount, lastFailureTime, ... }
console.log(breaker.isAllowed());      // boolean — would a request be allowed now?

breaker.reset();                       // force back to CLOSED, clear stats
breaker.forceState("OPEN");            // testing helper
```

Catching the OPEN throw:

```typescript
try {
  await breaker.execute(() => baseRunner(agent, prompt));
} catch (err) {
  if (err instanceof CircuitBreakerOpenError) {
    console.log(err.code);         // "CIRCUIT_OPEN"
    console.log(err.state);        // "OPEN" | "HALF_OPEN"
    console.log(err.retryAfterMs); // wait this long before next attempt
  }
}
```

### Don't share a breaker across unrelated runners

```typescript
// WRONG — one failing runner trips the breaker for all of them
const shared = createCircuitBreaker({ name: "shared" });
async function research(agent, input) { return shared.execute(() => researchRunner(agent, input)); }
async function write(agent, input)    { return shared.execute(() => writerRunner(agent, input));   }

// CORRECT — one breaker per failure domain
const researchBreaker = createCircuitBreaker({ name: "anthropic-research" });
const writerBreaker   = createCircuitBreaker({ name: "openai-writer" });
```

## `createHealthMonitor(config?)` — fleet health metrics

`createHealthMonitor` is a metrics tracker: you record successes/failures into it; it computes per-agent health scores you can use to drive routing or observability. It is NOT an auto-polling daemon. There is no `monitor.start()`, no `monitor.stop()`, no `monitor.getReport()`, no `agents:` config, no `checkInterval`, and no `onStatusChange` callback — those don't exist.

```typescript
import { createHealthMonitor } from "@directive-run/ai";

const monitor = createHealthMonitor({
  windowMs: 60_000,           // rolling window for metrics (default 60s)
  maxNormalLatencyMs: 5000,   // above this counts as "slow" for the latency component
  weights: {                  // weights for the composite health score
    successRate: 0.5,
    latency:     0.3,
    circuitState: 0.2,
  },
});

// Record outcomes from your runner calls
const start = Date.now();
try {
  const result = await baseRunner(agent, input);
  monitor.recordSuccess("researcher", Date.now() - start);
} catch (err) {
  monitor.recordFailure("researcher", Date.now() - start, err as Error);
}

// If you also use a circuit breaker, mirror its state into the monitor
monitor.updateCircuitState("researcher", breaker.getState() === "OPEN" ? "open" : "closed");

// Read
console.log(monitor.getHealthScore("researcher"));  // 0-100 (50 when no data)
console.log(monitor.getMetrics("researcher"));      // { successRate, avgLatency, ... }
console.log(monitor.getAllMetrics());                // Record<agentId, metrics>

monitor.reset();
```

## `createSemanticCache(config)` — embedding-based response cache

Semantic caching avoids redundant LLM calls when a new input is close enough to one already seen. Wire it into an orchestrator via the cache guardrail factory — there is NO `cache.wrap(runner)` method.

```typescript
import { createSemanticCache, createSemanticCacheGuardrail, type EmbedderFn } from "@directive-run/ai";

// You supply the embedder — no createOpenAIEmbedder / createAnthropicEmbedder exists.
// `EmbedderFn = (text: string) => Promise<number[]>`
const embedder: EmbedderFn = async (text) => {
  // call your embedding model (OpenAI, Voyage, local model, …)
  return await myEmbedAPI(text);
};

const cache = createSemanticCache({
  embedder,
  similarityThreshold: 0.95,
  maxCacheSize: 1000,
  ttlMs: 60 * 60 * 1000, // 1 hour
  onHit:  (entry, sim) => console.log(`cache hit @ ${(sim * 100).toFixed(1)}%`),
  onMiss: (query) => console.log(`miss: ${query.slice(0, 40)}…`),
});

const cacheGuardrail = createSemanticCacheGuardrail({ cache });

const orchestrator = createAgentOrchestrator({
  runner: baseRunner,
  guardrails: {
    input: [cacheGuardrail], // short-circuits with the cached response when a hit fires
  },
});
```

For testing, a `createTestEmbedder` is exported from `@directive-run/ai` that produces deterministic embeddings without API calls.

## `createConstraintRouter(config)` — constraint-driven provider selection

Routes each runner call to a provider based on runtime context.

```typescript
import { createConstraintRouter } from "@directive-run/ai";
import { ANTHROPIC_PRICING } from "@directive-run/ai/anthropic";
import { OPENAI_PRICING } from "@directive-run/ai/openai";

const router = createConstraintRouter({
  providers: [
    { name: "ollama",    runner: ollamaRunner },
    { name: "anthropic", runner: anthropicRunner, pricing: ANTHROPIC_PRICING["claude-sonnet-4-5-20250929"] },
    { name: "openai",    runner: openaiRunner,    pricing: OPENAI_PRICING["gpt-4o"] },
  ],
  defaultProvider: "anthropic",             // required
  constraints: [
    { when: (facts) => facts.totalCost > 100, provider: "ollama", priority: 10 },
    { when: (facts) => (facts.providers["anthropic"]?.errorCount ?? 0) > 5, provider: "openai" },
  ],
  preferCheapest: false,   // opt-in cheapest-provider heuristic, default false
  errorCooldownMs: 30_000, // skip a provider this long after an error, default 30000
});
```

There is NO `costPerMillion` field and NO `prefer` key: providers take `pricing` in `TokenPricing` shape (any `*_PRICING` entry works as-is), and a constraint names its target with `provider`. The `when` predicate receives `RoutingFacts` — `totalCost`, `callCount`, `errorCount`, `lastProvider`, `avgLatencyMs`, and per-provider stats under `providers` — not an ad-hoc context object.

`router` returns an `AgentRunner` you pass directly to an orchestrator, plus a `facts` getter for inspection and a `getUnpricedCallCount()` accessor. Provider pricing is validated and copied at construction, on the same terms as `withBudget`: negative, `-0`, and non-finite rates throw, and a poisoned `tokenUsage` never reaches `facts.totalCost` as `NaN` — which would stop every cost-based constraint from ever firing again.

A call the provider reported no usable usage for is charged its pre-call estimate and counted, exactly as in `withBudget`. It used to be charged `0`, which reads as a free call: `facts.totalCost` stayed at zero for the life of a router whose runner never populated `tokenUsage`, and a `facts.totalCost > N` failover never fired.

## Composing wrappers

Wrappers are pure functions — compose them inside-out (innermost runs first per call).

```typescript
import { withBudget, withRetry, withFallback } from "@directive-run/ai";

// Per call: retry first → budget cap on retried call → fallback to backup if all retries fail
const resilient = withFallback(
  [
    withBudget(
      withRetry(primaryRunner, { maxRetries: 3 }),
      {
        pricing: { inputPerMillion: 3, outputPerMillion: 15 },
        budgets: [{ window: "hour", maxCost: 5.0, pricing: { inputPerMillion: 3, outputPerMillion: 15 } }],
      },
    ),
    fallbackRunner,
  ],
);
```

## Anti-patterns

### `withFallback(primary, backup)` (two positional args)

```typescript
// WRONG — withFallback takes a single ARRAY of runners, then an optional config
withFallback(primary, backup)

// CORRECT
withFallback([primary, backup], { onFallback: (from, to, err) => {} })
```

### `withRetry` with `backoff: "linear" | "none"` or `shouldRetry`

```typescript
// WRONG — backoff is always exponential+jitter (not configurable); shouldRetry is named isRetryable
withRetry(runner, { maxRetries: 3, backoff: "exponential", shouldRetry: (e) => true })

// CORRECT
withRetry(runner, { maxRetries: 3, baseDelayMs: 500, isRetryable: (e) => /5\d{2}/.test(e.message) })
```

### `createCircuitBreaker({ resetTimeout, halfOpenMaxAttempts })`

```typescript
// WRONG — option names from a different library
createCircuitBreaker({ resetTimeout: 30_000, halfOpenMaxAttempts: 1 })

// CORRECT
createCircuitBreaker({ recoveryTimeMs: 30_000, halfOpenMaxRequests: 1 })
```

### `breaker.wrap(runner)` / `breaker.state`

```typescript
// WRONG — these don't exist on CircuitBreaker
const protected = breaker.wrap(baseRunner);
console.log(breaker.state);

// CORRECT
const result = await breaker.execute(() => baseRunner(agent, input));
console.log(breaker.getState());
```

### `createHealthMonitor({ agents, checkInterval, onStatusChange })` / `monitor.start()` / `monitor.getReport()`

```typescript
// WRONG — none of these exist
const monitor = createHealthMonitor({
  agents: { researcher: { runner, circuitBreaker } },
  checkInterval: 60_000,
  onStatusChange: (id, s) => {},
});
monitor.start();
const report = monitor.getReport();

// CORRECT — push metrics in from your call sites
const monitor = createHealthMonitor({ windowMs: 60_000 });
monitor.recordSuccess("researcher", latencyMs);
monitor.recordFailure("researcher", latencyMs, error);
const score = monitor.getHealthScore("researcher");
```

### `createOpenAIEmbedder` / `createAnthropicEmbedder`

```typescript
// WRONG — no embedder factories ship in @directive-run/ai
import { createOpenAIEmbedder } from "@directive-run/ai/openai";

// CORRECT — pass your own EmbedderFn
const embedder: EmbedderFn = async (text) => {
  const res = await myEmbedAPI.embed(text);
  return res.embedding;
};
const cache = createSemanticCache({ embedder, similarityThreshold: 0.95 });
```

### `cache.wrap(runner)`

```typescript
// WRONG — SemanticCache doesn't have a wrap() method
const cachedRunner = cache.wrap(baseRunner);

// CORRECT — wire it in as a guardrail
const cacheGuardrail = createSemanticCacheGuardrail({ cache });
const orchestrator = createAgentOrchestrator({ runner: baseRunner, guardrails: { input: [cacheGuardrail] } });
```

## Quick reference

| Utility | Shape | Throws |
|---|---|---|
| `withBudget(runner, BudgetConfig)` | wraps an AgentRunner | `BudgetExceededError` |
| `withRetry(runner, RetryConfig)` | wraps an AgentRunner | `RetryExhaustedError` |
| `withFallback(runners[], config?)` | wraps an array of AgentRunners | `AllProvidersFailedError` |
| `createCircuitBreaker(config)` | returns `CircuitBreaker` with `execute(fn)` | `CircuitBreakerOpenError` |
| `createHealthMonitor(config?)` | returns `HealthMonitor`; push outcomes in via `recordSuccess/Failure` | — |
| `createSemanticCache(config)` | returns `SemanticCache`; use via `createSemanticCacheGuardrail({ cache })` | — |
| `createConstraintRouter(config)` | returns an `AgentRunner` that picks providers at call time | — |

## See also

- [`ai-orchestrator.md`](./ai-orchestrator.md) — `circuitBreaker` / `selfHealing` / `agentRetry` / `maxTokenBudget` options on `createAgentOrchestrator`
- [`ai-guardrails-memory.md`](./ai-guardrails-memory.md) — `createSemanticCacheGuardrail({ cache })` wires this file's `SemanticCache` into the orchestrator
- [`ai-debug-observability.md`](./ai-debug-observability.md) — recording retry storms, circuit-breaker state changes, and budget warnings in the debug timeline
