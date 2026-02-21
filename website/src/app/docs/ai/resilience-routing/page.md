---
title: Resilience & Routing
description: Retry, fallback, budget guards, model selection, structured outputs, batch queues, and constraint-driven provider routing &ndash; composable wrappers that make AI runners production-ready.
---

Composable wrappers that make any `AgentRunner` production-ready. {% .lead %}

Each feature follows the same pattern: wrap a runner, get a runner back. Stack them in any order – compose middleware on your runner.

---

## Composition Model

Every wrapper has the signature `(runner, config) => AgentRunner`. Chain them like middleware.

### Using `pipe()`

The cleanest way to compose middleware is `pipe()`, which applies wrappers left-to-right:

```typescript
import {
  pipe,
  withRetry,
  withFallback,
  withBudget,
  withModelSelection,
  withStructuredOutput,
  byInputLength,
} from '@directive-run/ai';

const runner = pipe(
  baseRunner,
  (r) => withModelSelection(r, [byInputLength(200, 'gpt-4o-mini')]),
  (r) => withFallback([r, backupRunner]),
  (r) => withRetry(r, { maxRetries: 3 }),
  (r) => withBudget(r, { budgets: [{ window: 'hour', maxCost: 5, pricing }] }),
  (r) => withStructuredOutput(r, { schema: MySchema }),
);
```

### Manual Composition

Or apply wrappers manually:

```typescript
import {
  withRetry,
  withFallback,
  withBudget,
  withModelSelection,
  withStructuredOutput,
  byInputLength,
  byAgentName,
} from '@directive-run/ai';

// Build from inside out – innermost wrapper runs closest to the provider
let runner = baseRunner;
runner = withModelSelection(runner, [byInputLength(200, 'gpt-4o-mini')]);
runner = withFallback([runner, backupRunner]);
runner = withRetry(runner, { maxRetries: 3 });
runner = withBudget(runner, { budgets: [{ window: 'hour', maxCost: 5, pricing }] });
runner = withStructuredOutput(runner, { schema: MySchema });
```

### With Orchestrators

Pass the composed runner to either orchestrator:

```typescript
import { createAgentOrchestrator, createMultiAgentOrchestrator, pipe, withRetry, withFallback } from '@directive-run/ai';

const runner = pipe(
  baseRunner,
  (r) => withFallback([r, backupRunner]),
  (r) => withRetry(r, { maxRetries: 3 }),
);

// Single-agent
const single = createAgentOrchestrator({ runner, autoApproveToolCalls: true });
const result = await single.run(agent, 'Hello!');

// Multi-agent – the same composed runner is shared across all agents
const multi = createMultiAgentOrchestrator({
  runner,
  agents: {
    researcher: { agent: researcher, maxConcurrent: 3 },
    writer: { agent: writer, maxConcurrent: 1 },
  },
});
const research = await multi.runAgent('researcher', 'Explain WASM');
```

---

## Intelligent Retry

HTTP-status-aware retry with exponential backoff and jitter. Respects `Retry-After` headers on 429 responses and never retries client errors (400, 401, 403, 404, 422).

```typescript
import { withRetry, RetryExhaustedError } from '@directive-run/ai';

const runner = withRetry(baseRunner, {
  maxRetries: 3,         // 3 retries + 1 initial = 4 total attempts
  baseDelayMs: 1000,     // Start with 1s delay
  maxDelayMs: 30000,     // Cap at 30s
  onRetry: (attempt, error, delayMs) => {
    console.log(`Retry ${attempt} in ${delayMs}ms: ${error.message}`);
  },
});

try {
  const result = await runner(agent, input);
} catch (err) {
  if (err instanceof RetryExhaustedError) {
    console.error(`All ${err.retryCount} retries failed`);
    console.error('Last error:', err.lastError.message);
  }
}
```

### Retry Behavior by Status Code

| Status | Behavior |
|--------|----------|
| 429 | Retry with `Retry-After` header value (falls back to exponential backoff) |
| 500, 502, 503 | Retry with exponential backoff + jitter |
| 400, 401, 403, 404, 422 | Never retry (client errors) |
| No HTTP status | Retry (network errors, timeouts) |

### Custom Retry Predicate

```typescript
const runner = withRetry(baseRunner, {
  maxRetries: 2,
  isRetryable: (error) => {
    // Don't retry invalid API key errors
    if (error.message.includes('invalid API key')) {
      return false;
    }
    return true; // Retry everything else
  },
});
```

---

## Provider Fallback

Automatic failover across multiple runners. Tries each in order; moves to the next on failure.

```typescript
import { withFallback, withRetry, AllProvidersFailedError } from '@directive-run/ai';

const runner = withFallback([
  withRetry(openaiRunner, { maxRetries: 2 }),    // Try OpenAI first (with retries)
  withRetry(anthropicRunner, { maxRetries: 2 }),  // Fall back to Anthropic
  ollamaRunner,                                   // Last resort: local Ollama
], {
  shouldFallback: (error) => {
    // Don't fall back on auth errors – they'll fail everywhere
    return !error.message.includes('401');
  },
  onFallback: (fromIndex, toIndex, error) => {
    console.log(`Provider ${fromIndex} failed, trying ${toIndex}: ${error.message}`);
  },
});

try {
  const result = await runner(agent, input);
} catch (err) {
  if (err instanceof AllProvidersFailedError) {
    console.error(`All ${err.errors.length} providers failed:`);
    err.errors.forEach((e, i) => console.error(`  [${i}] ${e.message}`));
  }
}
```

---

## Cost Budget Guards

Pre-call cost estimation and rolling budget windows prevent runaway spending. Each budget window tracks costs independently.

```typescript
import { withBudget, BudgetExceededError } from '@directive-run/ai';
import type { BudgetRunner } from '@directive-run/ai';

const pricing = { inputPerMillion: 5, outputPerMillion: 15 };

const runner = withBudget(baseRunner, {
  // Per-call limit
  maxCostPerCall: 0.10,
  pricing,

  // Rolling windows
  budgets: [
    { window: 'hour', maxCost: 5.00, pricing },
    { window: 'day', maxCost: 50.00, pricing },
  ],

  // Fine-tune estimation
  charsPerToken: 4,               // ~4 characters per token (default)
  estimatedOutputMultiplier: 1.5,  // Expect 1.5x output tokens vs input

  onBudgetExceeded: (details) => {
    alert(`Budget exceeded (${details.window}): $${details.estimated.toFixed(4)} > $${details.remaining.toFixed(4)}`);
  },
});

try {
  const result = await runner(agent, input);
} catch (err) {
  if (err instanceof BudgetExceededError) {
    console.error(`${err.window} budget exceeded: $${err.estimated.toFixed(4)}`);
  }
}
```

### Checking Spend

Access the `getSpent()` method to build dashboards or preemptive alerts:

```typescript
const spent = (runner as BudgetRunner).getSpent('hour');
const limit = 5.00;

if (spent > limit * 0.8) {
  console.warn(`Approaching hourly limit: $${spent.toFixed(2)} / $${limit.toFixed(2)}`);
}
```

---

## Smart Model Selection

Route prompts to cheaper models based on rules. First match wins; unmatched prompts use the agent's original model.

```typescript
import {
  withModelSelection,
  byInputLength,
  byAgentName,
  byPattern,
} from '@directive-run/ai';

const runner = withModelSelection(baseRunner, {
  rules: [
    byInputLength(200, 'gpt-4o-mini'),                // Short inputs → mini
    byAgentName('classifier', 'gpt-4o-mini'),          // Classification agent → mini
    byPattern(/summarize|translate/i, 'gpt-4o-mini'),  // Summary/translate → mini
  ],
  onModelSelected: (original, selected) => {
    if (original !== selected) {
      console.log(`Routed ${original} → ${selected}`);
    }
  },
});
```

### Shorthand (Rules Array)

For simple cases, pass the rules array directly:

```typescript
const runner = withModelSelection(baseRunner, [
  byInputLength(200, 'gpt-4o-mini'),
  byAgentName('summarizer', 'gpt-4o-mini'),
]);
```

### Custom Rules

Write your own match function:

```typescript
import type { ModelRule } from '@directive-run/ai';

const byLanguage: ModelRule = {
  match: (agent, input) => /[\u4e00-\u9fff]/.test(input), // Chinese characters
  model: 'gpt-4o',  // Use full model for CJK languages
};

const runner = withModelSelection(baseRunner, {
  rules: [byLanguage, byInputLength(200, 'gpt-4o-mini')],
});
```

---

## Structured Outputs

Parse and validate LLM responses against a schema. Retries with error feedback on parse failure. Works with any Zod-compatible schema.

```typescript
import { z } from 'zod';
import { withStructuredOutput, StructuredOutputError } from '@directive-run/ai';

const SentimentSchema = z.object({
  sentiment: z.enum(['positive', 'negative', 'neutral']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

const runner = withStructuredOutput(baseRunner, {
  schema: SentimentSchema,
  maxRetries: 2,  // Retry up to 2 times on validation failure
});

try {
  const result = await runner(agent, 'Analyze: I love this product!');
  // result.output is typed as { sentiment, confidence, reasoning }
  console.log(result.output.sentiment);   // "positive"
  console.log(result.output.confidence);  // 0.95
} catch (err) {
  if (err instanceof StructuredOutputError) {
    console.error('Failed to get valid JSON:', err.message);
    console.error('Last raw output:', err.lastResult?.output);
  }
}
```

### Custom JSON Extractor

Override the default JSON extraction (first `{...}` or `[...]` in output):

```typescript
const runner = withStructuredOutput(baseRunner, {
  schema: MySchema,
  extractJson: (output) => {
    // Extract from markdown code block
    const match = output.match(/```json\n([\s\S]+?)\n```/);
    if (match) {
      return JSON.parse(match[1]);
    }
    return JSON.parse(output);
  },
});
```

---

## Batch Queue

Group agent calls into batches for efficient processing. Each `submit()` returns a promise that resolves when its individual call completes.

```typescript
import { createBatchQueue } from '@directive-run/ai';

const queue = createBatchQueue(runner, {
  maxBatchSize: 20,   // Flush when 20 calls are queued
  maxWaitMs: 5000,    // Or after 5 seconds, whichever comes first
  concurrency: 5,     // Run 5 calls in parallel per batch
});

// Submit calls – they batch automatically
const results = await Promise.all([
  queue.submit(agent, 'Classify: sports article'),
  queue.submit(agent, 'Classify: tech article'),
  queue.submit(agent, 'Classify: food article'),
]);

console.log(results.map(r => r.output));

// Force immediate flush
await queue.flush();

// Check queue depth
console.log(`${queue.pending} calls pending`);

// Clean up (flushes remaining calls before disposing)
await queue.dispose();
```

---

## Constraint-Driven Provider Routing

Use runtime state to select providers dynamically. Track cost, latency, and error rates per provider, then write constraints that react to them.

```typescript
import { createConstraintRouter } from '@directive-run/ai';
import type { ConstraintRouterRunner } from '@directive-run/ai';

const router = createConstraintRouter({
  providers: [
    {
      name: 'openai',
      runner: openaiRunner,
      pricing: { inputPerMillion: 5, outputPerMillion: 15 },
    },
    {
      name: 'anthropic',
      runner: anthropicRunner,
      pricing: { inputPerMillion: 3, outputPerMillion: 15 },
    },
    {
      name: 'ollama',
      runner: ollamaRunner,
      // No pricing – local inference is free
    },
  ],
  defaultProvider: 'openai',
  constraints: [
    // Switch to local when costs exceed $100
    {
      when: (facts) => facts.totalCost > 100,
      provider: 'ollama',
      priority: 10,
    },
    // Fall back to Anthropic when OpenAI is unreliable
    {
      when: (facts) => (facts.providers['openai']?.errorCount ?? 0) > 5,
      provider: 'anthropic',
    },
  ],
  // Opt-in: automatically prefer cheapest provider when no constraint matches
  preferCheapest: true,
  // Error cooldown: skip a provider for 30s after an error
  errorCooldownMs: 30000,
  onProviderSelected: (name, reason) => {
    console.log(`Using ${name} (${reason})`);
  },
});

// Use like any other runner
const result = await router(agent, input);

// Access runtime stats
console.log('Total cost:', router.facts.totalCost);
console.log('Call count:', router.facts.callCount);
console.log('Avg latency:', router.facts.avgLatencyMs, 'ms');
```

### `RoutingFacts` Type

The `router.facts` object exposes all runtime stats for use in constraints:

```typescript
interface RoutingFacts {
  totalCost: number;
  callCount: number;
  errorCount: number;
  lastProvider: string | null;
  avgLatencyMs: number;
  providers: Record<string, ProviderStats>;
}

interface ProviderStats {
  callCount: number;
  errorCount: number;
  totalCost: number;
  avgLatencyMs: number;
  lastErrorAt: number | null;
}
```

### Provider Stats

The router tracks per-provider statistics accessible via `router.facts.providers`:

```typescript
const openaiStats = router.facts.providers['openai'];
console.log({
  calls: openaiStats.callCount,
  errors: openaiStats.errorCount,
  cost: openaiStats.totalCost,
  latency: openaiStats.avgLatencyMs,
  lastError: openaiStats.lastErrorAt,
});
```

---

## Full Composition Example

Compose all features onto a single runner with `pipe()`, then pass it to the [Orchestrator](/docs/ai/orchestrator):

```typescript
import {
  createAgentOrchestrator,
  pipe,
  withRetry,
  withFallback,
  withBudget,
  withModelSelection,
  withStructuredOutput,
  byInputLength,
} from '@directive-run/ai';

const pricing = { inputPerMillion: 5, outputPerMillion: 15 };

const runner = pipe(
  baseRunner,
  (r) => withModelSelection(r, [byInputLength(200, 'gpt-4o-mini')]),
  (r) => withFallback([r, backupRunner]),
  (r) => withRetry(r, { maxRetries: 3, baseDelayMs: 1000 }),
  (r) => withBudget(r, {
    maxCostPerCall: 0.10,
    pricing,
    budgets: [{ window: 'hour', maxCost: 5, pricing }],
  }),
  (r) => withStructuredOutput(r, { schema: MySchema, maxRetries: 2 }),
);

const orchestrator = createAgentOrchestrator({ runner, autoApproveToolCalls: true });
const result = await orchestrator.run(myAgent, 'Hello!');
```

{% callout title="Composition order" %}
Apply wrappers from inside out: **Model Selection → Fallback → Retry → Budget → Structured Output**. Budget checks happen before any retries, and model selection runs closest to the provider.
{% /callout %}

---

## Token Budgets in Multi-Agent

The multi-agent orchestrator tracks token usage across all agents with `maxTokenBudget`. When the budget is reached, a built-in constraint pauses further agent runs. Combine this with a `budgetWarningThreshold` callback to alert before the hard stop:

```typescript
import { createMultiAgentOrchestrator, pipe, withRetry, withFallback } from '@directive-run/ai';

const runner = pipe(
  baseRunner,
  (r) => withFallback([r, backupRunner]),
  (r) => withRetry(r, { maxRetries: 2 }),
);

const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: {
    researcher: { agent: researcher, maxConcurrent: 3 },
    writer: { agent: writer, maxConcurrent: 1 },
  },
  maxTokenBudget: 50000,
  budgetWarningThreshold: 0.8,   // Fire callback at 80% usage
  onBudgetWarning: ({ currentTokens, maxBudget, percentage }) => {
    console.warn(`Token budget ${(percentage * 100).toFixed(0)}% used: ${currentTokens}/${maxBudget}`);
  },
});

// Each runAgent call contributes to the shared budget
const research = await orchestrator.runAgent('researcher', 'Summarize recent AI papers');
const article = await orchestrator.runAgent('writer', String(research.output));

console.log(`Total tokens used: ${orchestrator.totalTokens}`);
```

The budget is shared across all agents in the orchestrator. Individual agent runs that would exceed the remaining budget are blocked by a constraint before the LLM call is made.

---

## Next Steps

- [Running Agents](/docs/ai/running-agents) – basic runner setup
- [Orchestrator](/docs/ai/orchestrator) – agent orchestration with constraints and approvals
- [Guardrails](/docs/ai/guardrails) – input validation and output safety
- [Streaming](/docs/ai/streaming) – real-time token streaming
