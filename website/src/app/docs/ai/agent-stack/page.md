---
title: Agent Stack
description: Compose orchestrator, memory, circuit breaker, semantic cache, observability, resilience, and communication into a single factory – the all-in-one entry point for building production AI agent systems with Directive.
---

Wire together all AI adapter features with a single factory. {% .lead %}

---

## Setup

`createAgentStack` is the main composition API. Only `runner` is required – every other feature activates when its config key is present:

```typescript
import { createAgentStack, createOpenAIRunner } from '@directive-run/ai';

// Create a runner for your LLM provider
const runner = createOpenAIRunner({ apiKey: process.env.OPENAI_API_KEY! });

const stack = createAgentStack({
  runner,

  // Register agents with their capabilities
  agents: {
    assistant: {
      agent: { name: 'assistant', instructions: 'You are helpful.', model: 'gpt-4o' },
      capabilities: ['chat'],
    },
  },

  // Each feature activates when its config key is present
  memory: { maxMessages: 50 },               // Sliding window conversation memory
  circuitBreaker: { failureThreshold: 5 },    // Trip after 5 consecutive failures
  cache: { threshold: 0.95, maxSize: 500 },   // Semantic cache for near-duplicate queries
  observability: { serviceName: 'my-app' },   // Metrics and tracing
  messageBus: { maxHistory: 500 },            // Inter-agent communication
  maxTokenBudget: 100000,                     // Auto-pause when budget is exhausted
});
```

---

## Config Reference

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `runner` | `AgentRunner` | *required* | Base runner for agent execution |
| `streaming` | `{ runner: StreamingCallbackRunner }` | – | Enables `stack.stream()` |
| `agents` | `AgentRegistry` | – | Agent registry for multi-agent patterns |
| `patterns` | `Record<string, ExecutionPattern>` | – | Named execution patterns (parallel, sequential, supervisor) |
| `memory` | `{ maxMessages?, preserveRecentCount? }` | – | Sliding window memory (default: 50 messages) |
| `circuitBreaker` | `{ failureThreshold?, recoveryTimeMs?, halfOpenMaxRequests? }` | – | Failure protection (default: 5 failures) |
| `rateLimit` | `{ maxPerMinute }` | – | Request rate limiting |
| `cache` | `{ threshold?, maxSize?, ttlMs?, embedder? }` | – | Semantic cache (default: 0.95 threshold, 500 entries) |
| `observability` | `{ serviceName, alerts? }` | – | Metrics, tracing, and alerting |
| `otlp` | `{ endpoint, intervalMs?, onError? }` | – | OTLP export (default: 15s interval) |
| `messageBus` | `{ maxHistory? }` | – | Agent communication bus |
| `guardrails` | `{ input?, output?, streaming? }` | – | Input/output/streaming guardrails |
| `constraints` | `Record<string, OrchestratorConstraint>` | – | Directive constraints |
| `resolvers` | `Record<string, OrchestratorResolver>` | – | Directive resolvers |
| `approvals` | `{ autoApproveToolCalls?, onRequest?, timeoutMs? }` | auto-approve: true | Approval workflow config |
| `retry` | `AgentRetryConfig` | – | Agent retry policy |
| `hooks` | `OrchestratorLifecycleHooks` | – | Lifecycle callbacks |
| `maxTokenBudget` | `number` | – | Token budget limit |
| `costPerMillionTokens` | `number` | – | Blended cost rate for estimation |
| `debug` | `boolean` | `false` | Enable debug logging |
| `intelligentRetry` | [`RetryConfig`](/docs/ai/resilience-routing#intelligent-retry) | – | HTTP-aware retry with backoff |
| `fallback` | `{ runners: AgentRunner[], config? }` | – | [Provider fallback](/docs/ai/resilience-routing#provider-fallback) chain |
| `budget` | [`BudgetConfig`](/docs/ai/resilience-routing#cost-budget-guards) | – | Cost budget guards (per-call + rolling windows) |
| `modelSelection` | [`ModelRule[]`](/docs/ai/resilience-routing#smart-model-selection) | – | Rule-based model routing |
| `structuredOutput` | [`StructuredOutputConfig`](/docs/ai/resilience-routing#structured-outputs) | – | Schema validation with auto-retry |

---

## Shorthand vs Pre-built

Each feature accepts either a shorthand config object or a pre-built instance. Use shorthand for defaults, or pre-build for full control:

```typescript
import {
  createAgentStack,
  createAgentMemory,
  createSlidingWindowStrategy,
} from '@directive-run/ai';

// Shorthand – pass an options object and the stack builds the instance
const stack = createAgentStack({
  runner,
  memory: { maxMessages: 30 },
});

// Pre-built – construct the instance yourself for full control
const memory = createAgentMemory({
  strategy: createSlidingWindowStrategy({ maxMessages: 30 }),
  autoManage: true,
});
const stack = createAgentStack({ runner, memory });
```

---

## Running Agents

```typescript
// Run a registered agent by its ID
const result = await stack.run('assistant', 'What is WebAssembly?');
console.log(result.output);

// Validate that the output matches a specific shape, retrying if it doesn't
const result = await stack.runStructured('assistant', 'List 3 facts about Rust', {
  validate: (val) => Array.isArray(val) && val.length === 3,
  retries: 2,
});

// Execute a named multi-agent pattern (parallel, sequential, or supervisor)
const result = await stack.runPattern('research-and-write', 'AI safety');
```

---

## Streaming

Requires `streaming.runner` in config. Two streaming methods are available:

### Token Stream

`stack.stream()` yields raw token strings – ideal for simple text output:

```typescript
const stack = createAgentStack({
  runner,
  streaming: { runner: myStreamingRunner },   // Enable streaming support
  agents: { chat: { agent: chatAgent, capabilities: ['chat'] } },
});

// Yields one raw token string at a time
const tokenStream = stack.stream('chat', 'Hello!');

for await (const token of tokenStream) {
  process.stdout.write(token);
}

// Access the full result after the stream finishes
const finalResult = await tokenStream.result;
```

### Rich Chunk Stream

`stack.streamChunks()` yields full `StreamChunk` events (tokens, tool calls, guardrails, progress, errors) – use this when you need visibility into the full streaming lifecycle:

```typescript
// Rich stream – yields typed chunks for every lifecycle event
const { stream, result, abort } = stack.streamChunks<string>('chat', 'Hello!');

for await (const chunk of stream) {
  switch (chunk.type) {
    case 'token':
      process.stdout.write(chunk.data);             // Append each token as it arrives
      break;
    case 'tool_start':
      console.log(`Calling: ${chunk.tool}`);         // Agent is invoking a tool
      break;
    case 'tool_end':
      console.log(`Result: ${chunk.result}`);        // Tool returned a result
      break;
    case 'guardrail_triggered':
      console.warn(`${chunk.guardrailName}: ${chunk.reason}`);  // Safety check fired
      break;
    case 'done':
      console.log(`Done: ${chunk.totalTokens} tokens`);
      break;
    case 'error':
      console.error(chunk.error);
      break;
  }
}

const finalResult = await result;
```

Both methods track tokens, publish to the message bus, and record observability spans automatically. The `abort()` function is idempotent – safe to call multiple times.

---

## Approvals

```typescript
const stack = createAgentStack({
  runner,
  approvals: {
    autoApproveToolCalls: false,                // Require human sign-off
    onRequest: (req) => notifyApprover(req),    // Push to your approval UI
    timeoutMs: 60000,                           // Fail after 60s with no decision
  },
});

// Wire these into your approval UI handler
stack.approve(requestId);
stack.reject(requestId, 'Not authorized');
```

---

## State & Debugging

```typescript
// Snapshot of the entire stack's state
const state = stack.getState();
console.log(state.totalTokens);          // Combined input + output tokens
console.log(state.estimatedCost);        // Blended cost estimate
console.log(state.circuitState);         // 'CLOSED' | 'OPEN' | 'HALF_OPEN'
console.log(state.cacheStats);           // { totalEntries, hitRate, ... }
console.log(state.memoryMessageCount);   // Messages in conversation memory
console.log(state.busMessageCount);      // Messages on the inter-agent bus
console.log(state.rateLimitRemaining);   // Remaining requests this minute (or null)

// Fetch the most recent 50 observability spans and metrics
const { spans, metrics } = stack.getTimeline(50);

// Wipe all state for a fresh session
stack.reset();

// Release resources when the process shuts down
await stack.dispose();
```

---

## Escape Hatches

Access underlying instances when you need direct control:

```typescript
// Access the underlying instances when you need direct control
stack.orchestrator   // AgentOrchestrator – constraints, guardrails, state
stack.observability  // ObservabilityInstance | null – metrics and tracing
stack.messageBus     // MessageBus | null – inter-agent messaging
stack.cache          // SemanticCache | null – similarity-based response cache
stack.memory         // AgentMemory | null – conversation history management
```

---

## Memory

Conversation memory keeps context across turns by storing messages and trimming older ones according to a strategy.

### Memory Setup

```typescript
import { createAgentMemory, createSlidingWindowStrategy } from '@directive-run/ai';

const memory = createAgentMemory({
  strategy: createSlidingWindowStrategy({ maxMessages: 50 }),  // Keep last 50 messages
  autoManage: true,  // Automatically trim on every addMessage call
});
```

### Strategies

**Sliding Window** – keeps the most recent N messages:

```typescript
const strategy = createSlidingWindowStrategy({
  maxMessages: 100,         // Maximum messages to keep
  preserveRecentCount: 10,  // Always keep the latest 10, even when trimming
});
```

**Token-Based** – caps context by token count instead of message count:

```typescript
import { createTokenBasedStrategy } from '@directive-run/ai';

// Cap context window by estimated token count instead of message count
const strategy = createTokenBasedStrategy({
  maxTokens: 4000,
  preserveRecentCount: 5,
});
```

**Hybrid** – combine both strategies by passing a token-based strategy as a fallback or composing them manually.

### Summarizers

When messages are trimmed, an optional summarizer condenses them into a system-level summary so context is not lost entirely:

```typescript
const memory = createAgentMemory({
  strategy: createSlidingWindowStrategy({ maxMessages: 30 }),

  // Condense trimmed messages into a summary so older context is not lost
  summarizer: async (messages) => {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Summarize this conversation concisely.' },
        ...messages,
      ],
    });
    return response.choices[0].message.content ?? '';
  },

  autoManage: true,
});
```

### Memory Usage

```typescript
// Append messages to the conversation history
memory.addMessage({ role: 'user', content: 'Hello' });
memory.addMessage({ role: 'assistant', content: 'Hi there!' });

// Read the current context window (already trimmed if autoManage is on)
const context = memory.getContextMessages();
const result = await memory.manage();   // Manually trigger trimming
const state = memory.getState();        // Snapshot of memory stats
memory.clear();                         // Wipe all messages

// Serialize and restore memory across sessions
const saved = memory.export();
memory.import(saved);
```

### Memory Shorthand

Pass a plain object and the stack builds the memory instance for you:

```typescript
const stack = createAgentStack({
  runner,
  memory: { maxMessages: 50 },
});
```

---

## Observability

Track metrics, traces, and alerts across every agent run.

### Observability Setup

```typescript
import { createObservability, createAgentMetrics } from '@directive-run/ai';

const obs = createObservability({
  serviceName: 'my-app',
  metrics: { enabled: true },
  tracing: { enabled: true, sampleRate: 1.0 },   // Trace every request

  // Fire an alert when errors exceed the threshold
  alerts: [
    { metric: 'agent.errors', threshold: 10, action: 'warn' },
  ],
});

// Convenience wrapper for common agent-level metrics
const agentMetrics = createAgentMetrics(obs);
```

### Metrics

Record counters, gauges, and histograms:

```typescript
obs.incrementCounter('agent.requests', { agent: 'assistant' });    // Count each request
obs.setGauge('agent.active_runs', 3);                              // Track concurrent runs
obs.observeHistogram('agent.latency', 1250, { agent: 'assistant' }); // Record latency in ms
```

### Agent Metrics Helper

`createAgentMetrics` returns convenience methods that map directly to common agent events:

- `trackRun` – records run duration, token usage, and success/failure
- `trackGuardrail` – records guardrail evaluation results
- `trackApproval` – records approval request outcomes

### Tracing

Create spans, attach logs, and add tags for distributed trace correlation:

```typescript
// Create a span to trace an individual operation
const span = obs.startSpan('agent.run', { agent: 'assistant' });
span.log('Starting tool call');    // Attach a log line to the span
span.tag('model', 'gpt-4o');      // Add metadata for filtering
span.end();                        // Close the span and record its duration
```

### Dashboard

Retrieve a summary snapshot of all collected telemetry:

```typescript
// Pull a dashboard summary for display or alerting
const dashboard = obs.getDashboard();
console.log(dashboard.summary.totalRequests);   // Total agent runs
console.log(dashboard.summary.errorRate);       // Percentage of failures
console.log(dashboard.summary.avgLatency);      // Mean response time (ms)
console.log(dashboard.summary.totalCost);       // Cumulative estimated cost
```

### Alerts

Threshold-based alerting triggers when a metric crosses a configured limit. Configure alerts in the `createObservability` options (see Setup above).

### OTLP Export

Push metrics and traces to any OpenTelemetry-compatible collector:

```typescript
import { createOTLPExporter } from '@directive-run/ai';

// Connect to any OpenTelemetry-compatible collector
const exporter = createOTLPExporter({
  endpoint: 'https://otel-collector.example.com',
  headers: { 'Authorization': 'Bearer ...' },
});

// Push collected data to the remote collector
await exporter.exportMetrics(obs);
await exporter.exportTraces(obs);
```

---

## Resilience

Protect your system from cascading failures with circuit breakers and rate limiting.

### Circuit Breaker

```typescript
import { createCircuitBreaker } from '@directive-run/ai';

const breaker = createCircuitBreaker({
  failureThreshold: 5,          // Open after 5 consecutive failures
  recoveryTimeMs: 30000,        // Wait 30s before testing again
  halfOpenMaxRequests: 3,       // Allow 3 test requests in HALF_OPEN
});

try {
  // Wrap any async call – the breaker tracks successes and failures
  const result = await breaker.execute(async () => {
    return await callExternalAPI();
  });
} catch (error) {
  if (error.message.includes('Circuit breaker is OPEN')) {
    console.log('Service unavailable, using fallback');
  }
}

// Lifecycle: CLOSED → OPEN (on failure threshold) → HALF_OPEN (after recovery) → CLOSED
console.log(breaker.getState());  // 'CLOSED' | 'OPEN' | 'HALF_OPEN'
```

### Circuit Breaker Config

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `failureThreshold` | `number` | `5` | Failures before opening |
| `recoveryTimeMs` | `number` | `30000` | Time in OPEN before HALF_OPEN |
| `halfOpenMaxRequests` | `number` | `3` | Test requests in HALF_OPEN |
| `isFailure` | `(error: Error) => boolean` | all errors | Custom failure classifier |
| `onStateChange` | `(from, to) => void` | – | State transition callback |

### Rate Limiting

Both circuit breaker and rate limiting can be configured via stack shorthand:

```typescript
// Shorthand – stack builds the circuit breaker and rate limiter for you
const stack = createAgentStack({
  runner,
  circuitBreaker: { failureThreshold: 3, recoveryTimeMs: 15000 },
  rateLimit: { maxPerMinute: 60 },   // Cap at 60 requests per minute
});
```

---

## Semantic Cache

Cache agent responses by semantic similarity so repeated or near-duplicate queries return instantly without an LLM call.

### Cache Setup

```typescript
import { createSemanticCache } from '@directive-run/ai';

const cache = createSemanticCache({
  // Convert text into a vector for similarity comparison
  embedder: async (text) => {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    return response.data[0].embedding;
  },

  similarityThreshold: 0.95,   // Require 95% similarity for a cache hit
  maxCacheSize: 1000,          // Evict oldest entries beyond this limit
  ttlMs: 3600000,              // Entries expire after 1 hour
});
```

### Cache Usage

```typescript
// Check if a semantically similar query has been answered before
const result = await cache.lookup('What is WebAssembly?');

if (result.hit) {
  console.log('Cache hit!', result.similarity);
  console.log(result.entry!.response);  // Return the cached answer instantly
} else {
  // Cache miss – run the agent and store the result for future queries
  const response = await runAgent(agent, 'What is WebAssembly?');
  await cache.store('What is WebAssembly?', response.output);
}
```

### As a Guardrail

Plug the cache into the guardrail pipeline so cache hits short-circuit agent execution automatically:

```typescript
import { createSemanticCacheGuardrail } from '@directive-run/ai';

// Plug the cache into the guardrail pipeline – hits short-circuit the agent call
const cacheGuardrail = createSemanticCacheGuardrail({ cache });
```

### Stats

```typescript
// Monitor cache effectiveness
const stats = cache.getStats();
console.log(stats.totalEntries);  // Number of cached responses
console.log(stats.hitRate);       // Percentage of lookups that found a match
```

### Testing

Use the built-in test embedder to avoid real embedding calls in tests:

```typescript
import { createTestEmbedder } from '@directive-run/ai';

// Deterministic embedder for unit tests – no real API calls
const testCache = createSemanticCache({
  embedder: createTestEmbedder(128),   // 128-dimensional fake embeddings
  similarityThreshold: 0.9,
});
```

### Cache Shorthand

```typescript
const stack = createAgentStack({
  runner,
  cache: { threshold: 0.95, maxSize: 500, ttlMs: 300000, embedder: myEmbedderFn },
});
```

---

## Framework Integration

Access agent state reactively via `stack.orchestrator.system`. The same bridge keys (`__agent`, `__approval`, `__conversation`, `__toolCalls`) work with all framework hooks.

### React

```tsx
import { useAgentStack, useFact, useSelector, useWatch, useInspect } from '@directive-run/react';

function AgentDashboard() {
  // Initialize the full stack as a React hook (auto-disposes on unmount)
  const stack = useAgentStack({
    runner,
    agents: { assistant: { agent, capabilities: ['chat'] } },
  });
  const system = stack.orchestrator.system;

  // Subscribe to bridge keys for reactive UI updates
  const agent = useFact(system, '__agent');
  const conversation = useFact(system, '__conversation');
  const { isSettled } = useInspect(system);

  // Log when the agent finishes (side-effect only, no re-render)
  useWatch(system, 'fact', '__agent', (next, prev) => {
    if (next?.status === 'completed') console.log('Done:', next.output);
  });

  return (
    <div>
      <p>Status: {agent?.status}, Tokens: {agent?.tokenUsage}</p>
      <p>Messages: {conversation?.length ?? 0}</p>
      <p>{isSettled ? 'Idle' : 'Working...'}</p>
    </div>
  );
}
```

### Vue

```html
<script setup>
import { createAgentStack } from '@directive-run/ai';
import { useFact, useInspect } from '@directive-run/vue';
import { onUnmounted } from 'vue';

const stack = createAgentStack({ runner, agents: { /* ... */ } });
onUnmounted(() => stack.dispose());  // Clean up on component teardown

// Reactive refs bound to the orchestrator's bridge keys
const system = stack.orchestrator.system;
const agent = useFact(system, '__agent');
const conversation = useFact(system, '__conversation');
const { isSettled } = useInspect(system);
</script>

<template>
  <p>Status: {{ agent?.status }}, Tokens: {{ agent?.tokenUsage }}</p>
  <p>Messages: {{ conversation?.length ?? 0 }}</p>
  <p>{{ isSettled ? 'Idle' : 'Working...' }}</p>
</template>
```

### Svelte

```html
<script>
import { createAgentStack } from '@directive-run/ai';
import { useFact, useInspect } from '@directive-run/svelte';
import { onDestroy } from 'svelte';

const stack = createAgentStack({ runner, agents: { /* ... */ } });
onDestroy(() => stack.dispose());

const system = stack.orchestrator.system;
const agent = useFact(system, '__agent');
const conversation = useFact(system, '__conversation');
const inspect = useInspect(system);
</script>

<p>Status: {$agent?.status}, Tokens: {$agent?.tokenUsage}</p>
<p>Messages: {$conversation?.length ?? 0}</p>
<p>{$inspect.isSettled ? 'Idle' : 'Working...'}</p>
```

### Solid

```tsx
import { createAgentStack } from '@directive-run/ai';
import { useFact, useInspect } from '@directive-run/solid';
import { onCleanup } from 'solid-js';

function AgentDashboard() {
  const stack = createAgentStack({ runner, agents: { /* ... */ } });
  onCleanup(() => stack.dispose());

  const system = stack.orchestrator.system;
  const agent = useFact(system, '__agent');
  const conversation = useFact(system, '__conversation');
  const inspect = useInspect(system);

  return (
    <div>
      <p>Status: {agent()?.status}, Tokens: {agent()?.tokenUsage}</p>
      <p>Messages: {conversation()?.length ?? 0}</p>
      <p>{inspect().isSettled ? 'Idle' : 'Working...'}</p>
    </div>
  );
}
```

### Lit

```typescript
import { LitElement, html } from 'lit';
import { createAgentStack } from '@directive-run/ai';
import { FactController, InspectController } from '@directive-run/lit';

class AgentDashboard extends LitElement {
  private stack = createAgentStack({ runner, agents: { /* ... */ } });
  private agent = new FactController(this, this.stack.orchestrator.system, '__agent');
  private conversation = new FactController(this, this.stack.orchestrator.system, '__conversation');
  private inspect = new InspectController(this, this.stack.orchestrator.system);

  disconnectedCallback() {
    super.disconnectedCallback();
    this.stack.dispose();
  }

  render() {
    return html`
      <p>Status: ${this.agent.value?.status}, Tokens: ${this.agent.value?.tokenUsage}</p>
      <p>Messages: ${this.conversation.value?.length ?? 0}</p>
      <p>${this.inspect.value?.isSettled ? 'Idle' : 'Working...'}</p>
    `;
  }
}
```

See [Agent Orchestrator – Framework Integration](/docs/ai/orchestrator#framework-integration) for additional hooks like `useSelector` and `useWatch`.

---

## Next Steps

- [Agent Orchestrator](/docs/ai/orchestrator) – Core orchestrator API
- [Guardrails & Safety](/docs/ai/guardrails) – Input validation and streaming constraints
- [Streaming](/docs/ai/streaming) – Real-time response processing
- [Multi-Agent Patterns](/docs/ai/multi-agent) – Parallel, sequential, and supervisor patterns
