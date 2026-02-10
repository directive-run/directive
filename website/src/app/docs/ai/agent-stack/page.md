---
title: Agent Stack
description: Compose orchestrator, memory, circuit breaker, semantic cache, observability, resilience, and communication into a single factory — the all-in-one entry point for building production AI agent systems with Directive.
---

Wire together all AI adapter features with a single factory. {% .lead %}

---

## Setup

`createAgentStack` is the main composition API. Only `runner` is required — every other feature activates when its config key is present:

```typescript
import { createAgentStack, createOpenAIRunner } from 'directive/ai';

const runner = createOpenAIRunner({ apiKey: process.env.OPENAI_API_KEY! });

const stack = createAgentStack({
  runner,
  agents: {
    assistant: {
      agent: { name: 'assistant', instructions: 'You are helpful.', model: 'gpt-4o' },
      capabilities: ['chat'],
    },
  },
  memory: { maxMessages: 50 },
  circuitBreaker: { failureThreshold: 5 },
  cache: { threshold: 0.95, maxSize: 500 },
  observability: { serviceName: 'my-app' },
  messageBus: { maxHistory: 500 },
  maxTokenBudget: 100000,
});
```

---

## Config Reference

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `runner` | `AgentRunner` | *required* | Base runner for agent execution |
| `streaming` | `{ runner: StreamingCallbackRunner }` | — | Enables `stack.stream()` |
| `agents` | `AgentRegistry` | — | Agent registry for multi-agent patterns |
| `patterns` | `Record<string, ExecutionPattern>` | — | Named execution patterns (parallel, sequential, supervisor) |
| `memory` | `{ maxMessages?, preserveRecentCount? }` | — | Sliding window memory (default: 50 messages) |
| `circuitBreaker` | `{ failureThreshold?, recoveryTimeMs?, halfOpenMaxRequests? }` | — | Failure protection (default: 5 failures) |
| `rateLimit` | `{ maxPerMinute }` | — | Request rate limiting |
| `cache` | `{ threshold?, maxSize?, ttlMs?, embedder? }` | — | Semantic cache (default: 0.95 threshold, 500 entries) |
| `observability` | `{ serviceName, alerts? }` | — | Metrics, tracing, and alerting |
| `otlp` | `{ endpoint, intervalMs?, onError? }` | — | OTLP export (default: 15s interval) |
| `messageBus` | `{ maxHistory? }` | — | Agent communication bus |
| `guardrails` | `{ input?, output?, streaming? }` | — | Input/output/streaming guardrails |
| `constraints` | `Record<string, OrchestratorConstraint>` | — | Directive constraints |
| `resolvers` | `Record<string, OrchestratorResolver>` | — | Directive resolvers |
| `approvals` | `{ autoApproveToolCalls?, onRequest?, timeoutMs? }` | auto-approve: true | Approval workflow config |
| `retry` | `AgentRetryConfig` | — | Agent retry policy |
| `hooks` | `OrchestratorLifecycleHooks` | — | Lifecycle callbacks |
| `maxTokenBudget` | `number` | — | Token budget limit |
| `costPerMillionTokens` | `number` | — | Blended cost rate for estimation |
| `costRates` | `{ inputRate, outputRate }` | — | Per-direction cost rates (per million tokens) |
| `debug` | `boolean` | `false` | Enable debug logging |

---

## Shorthand vs Pre-built

Each feature accepts either a shorthand config object or a pre-built instance. Use shorthand for defaults, or pre-build for full control:

```typescript
import {
  createAgentStack,
  createAgentMemory,
  createSlidingWindowStrategy,
} from 'directive/ai';

// Shorthand — stack creates the instance for you
const stack = createAgentStack({
  runner,
  memory: { maxMessages: 30 },
});

// Pre-built — you control the instance
const memory = createAgentMemory({
  strategy: createSlidingWindowStrategy({ maxMessages: 30 }),
  autoManage: true,
});
const stack = createAgentStack({ runner, memory });
```

---

## Running Agents

```typescript
// Run a registered agent by ID
const result = await stack.run('assistant', 'What is WebAssembly?');
console.log(result.finalOutput);

// Run with structured output validation
const result = await stack.runStructured('assistant', 'List 3 facts about Rust', {
  validate: (val) => Array.isArray(val) && val.length === 3,
  retries: 2,
});

// Run a named execution pattern (parallel, sequential, supervisor)
const result = await stack.runPattern('research-and-write', 'AI safety');
```

---

## Streaming

Requires `streaming.runner` in config:

```typescript
const stack = createAgentStack({
  runner,
  streaming: { runner: myStreamingRunner },
  agents: { chat: { agent: chatAgent, capabilities: ['chat'] } },
});

const tokenStream = stack.stream('chat', 'Hello!');

for await (const token of tokenStream) {
  process.stdout.write(token);
}

const finalResult = await tokenStream.result;
```

---

## Approvals

```typescript
const stack = createAgentStack({
  runner,
  approvals: {
    autoApproveToolCalls: false,
    onRequest: (req) => notifyApprover(req),
    timeoutMs: 60000,
  },
});

// In your approval handler
stack.approve(requestId);
stack.reject(requestId, 'Not authorized');
```

---

## State & Debugging

```typescript
const state = stack.getState();
console.log(state.totalTokens);
console.log(state.inputTokens);      // input token count
console.log(state.outputTokens);     // output token count
console.log(state.estimatedCost);
console.log(state.inputCost);        // cost from input tokens
console.log(state.outputCost);       // cost from output tokens
console.log(state.circuitState);     // 'CLOSED' | 'OPEN' | 'HALF_OPEN'
console.log(state.cacheStats);       // { totalEntries, hitRate, ... }
console.log(state.memoryMessageCount);

// Observability timeline
const { spans, metrics } = stack.getTimeline(50);

// Reset all state
stack.reset();

// Clean up
await stack.dispose();
```

---

## Escape Hatches

Access underlying instances when you need direct control:

```typescript
stack.orchestrator   // AgentOrchestrator
stack.observability  // ObservabilityInstance | null
stack.messageBus     // MessageBus | null
stack.cache          // SemanticCache | null
stack.memory         // AgentMemory | null
```

---

## Memory

Conversation memory keeps context across turns by storing messages and trimming older ones according to a strategy.

### Setup

```typescript
import { createAgentMemory, createSlidingWindowStrategy } from 'directive/ai';

const memory = createAgentMemory({
  strategy: createSlidingWindowStrategy({ maxMessages: 50 }),
  autoManage: true,
});
```

### Strategies

**Sliding Window** — keeps the most recent N messages:

```typescript
const strategy = createSlidingWindowStrategy({
  maxMessages: 100,
  preserveRecentCount: 10,
});
```

**Token-Based** — caps context by token count instead of message count:

```typescript
import { createTokenBasedStrategy } from 'directive/ai';

const strategy = createTokenBasedStrategy({
  maxTokens: 4000,
  preserveRecentCount: 5,
});
```

**Hybrid** — combine both strategies by passing a token-based strategy as a fallback or composing them manually.

### Summarizers

When messages are trimmed, an optional summarizer condenses them into a system-level summary so context is not lost entirely:

```typescript
const memory = createAgentMemory({
  strategy: createSlidingWindowStrategy({ maxMessages: 30 }),
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

### Usage

```typescript
memory.addMessage({ role: 'user', content: 'Hello' });
memory.addMessage({ role: 'assistant', content: 'Hi there!' });

const context = memory.getContextMessages();
const result = await memory.manage();
const state = memory.getState();
memory.clear();

// Export & Import
const saved = memory.export();
memory.import(saved);
```

### Shorthand with Stack

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

### Setup

```typescript
import { createObservability, createAgentMetrics } from 'directive/ai';

const obs = createObservability({
  serviceName: 'my-app',
  metrics: { enabled: true },
  tracing: { enabled: true, sampleRate: 1.0 },
  alerts: [
    { metric: 'agent.errors', threshold: 10, action: 'warn' },
  ],
});

const agentMetrics = createAgentMetrics(obs);
```

### Metrics

Record counters, gauges, and histograms:

```typescript
obs.incrementCounter('agent.requests', { agent: 'assistant' });
obs.setGauge('agent.active_runs', 3);
obs.observeHistogram('agent.latency', 1250, { agent: 'assistant' });
```

### Agent Metrics Helper

`createAgentMetrics` returns convenience methods that map directly to common agent events:

- `trackRun` — records run duration, token usage, and success/failure
- `trackGuardrail` — records guardrail evaluation results
- `trackApproval` — records approval request outcomes

### Tracing

Create spans, attach logs, and add tags for distributed trace correlation:

```typescript
const span = obs.startSpan('agent.run', { agent: 'assistant' });
span.log('Starting tool call');
span.tag('model', 'gpt-4o');
span.end();
```

### Dashboard

Retrieve a summary snapshot of all collected telemetry:

```typescript
const dashboard = obs.getDashboard();
console.log(dashboard.summary.totalRequests);
console.log(dashboard.summary.errorRate);
console.log(dashboard.summary.avgLatency);
console.log(dashboard.summary.totalCost);
```

### Alerts

Threshold-based alerting triggers when a metric crosses a configured limit. Configure alerts in the `createObservability` options (see Setup above).

### OTLP Export

Push metrics and traces to any OpenTelemetry-compatible collector:

```typescript
import { createOTLPExporter } from 'directive/ai';

const exporter = createOTLPExporter({
  endpoint: 'https://otel-collector.example.com',
  headers: { 'Authorization': 'Bearer ...' },
});

await exporter.exportMetrics(obs);
await exporter.exportTraces(obs);
```

---

## Resilience

Protect your system from cascading failures with circuit breakers and rate limiting.

### Circuit Breaker

```typescript
import { createCircuitBreaker } from 'directive/ai';

const breaker = createCircuitBreaker({
  failureThreshold: 5,
  recoveryTimeMs: 30000,
  halfOpenMaxRequests: 3,
});

try {
  const result = await breaker.execute(async () => {
    return await callExternalAPI();
  });
} catch (error) {
  if (error.message.includes('Circuit breaker is OPEN')) {
    console.log('Service unavailable, using fallback');
  }
}

// States: CLOSED → OPEN (on failure threshold) → HALF_OPEN (after recovery) → CLOSED
console.log(breaker.getState());  // 'CLOSED' | 'OPEN' | 'HALF_OPEN'
```

### Circuit Breaker Config

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `failureThreshold` | `number` | `5` | Failures before opening |
| `recoveryTimeMs` | `number` | `30000` | Time in OPEN before HALF_OPEN |
| `halfOpenMaxRequests` | `number` | `3` | Test requests in HALF_OPEN |
| `isFailure` | `(error: Error) => boolean` | all errors | Custom failure classifier |
| `onStateChange` | `(from, to) => void` | — | State transition callback |

### Rate Limiting

Both circuit breaker and rate limiting can be configured via stack shorthand:

```typescript
const stack = createAgentStack({
  runner,
  circuitBreaker: { failureThreshold: 3, recoveryTimeMs: 15000 },
  rateLimit: { maxPerMinute: 60 },
});
```

---

## Semantic Cache

Cache agent responses by semantic similarity so repeated or near-duplicate queries return instantly without an LLM call.

### Setup

```typescript
import { createSemanticCache } from 'directive/ai';

const cache = createSemanticCache({
  embedder: async (text) => {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    return response.data[0].embedding;
  },
  similarityThreshold: 0.95,
  maxCacheSize: 1000,
  ttlMs: 3600000,
});
```

### Usage

```typescript
const result = await cache.lookup('What is WebAssembly?');
if (result.hit) {
  console.log('Cache hit!', result.similarity);
  console.log(result.entry!.response);
} else {
  const response = await runAgent(agent, 'What is WebAssembly?');
  await cache.store('What is WebAssembly?', response.finalOutput);
}
```

### As a Guardrail

Plug the cache into the guardrail pipeline so cache hits short-circuit agent execution automatically:

```typescript
import { createSemanticCacheGuardrail } from 'directive/ai';

const cacheGuardrail = createSemanticCacheGuardrail({ cache });
```

### Stats

```typescript
const stats = cache.getStats();
console.log(stats.totalEntries);
console.log(stats.hitRate);
```

### Testing

Use the built-in test embedder to avoid real embedding calls in tests:

```typescript
import { createTestEmbedder } from 'directive/ai';

const testCache = createSemanticCache({
  embedder: createTestEmbedder(128),
  similarityThreshold: 0.9,
});
```

### Shorthand with Stack

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
import { useAgentStack, useFact, useSelector, useWatch, useInspect } from 'directive/react';

function AgentDashboard() {
  const stack = useAgentStack({
    run,
    agents: { assistant: { agent, capabilities: ['chat'] } },
  });
  const system = stack.orchestrator.system;

  const agent = useFact(system, '__agent');
  const conversation = useFact(system, '__conversation');
  const { isSettled } = useInspect(system);

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

```vue
<script setup>
import { createAgentStack } from 'directive/ai';
import { useFact, useInspect } from 'directive/vue';
import { onUnmounted } from 'vue';

const stack = createAgentStack({ run, agents: { /* ... */ } });
onUnmounted(() => stack.dispose());

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

```svelte
<script>
import { createAgentStack } from 'directive/ai';
import { useFact, useInspect } from 'directive/svelte';
import { onDestroy } from 'svelte';

const stack = createAgentStack({ run, agents: { /* ... */ } });
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
import { createAgentStack } from 'directive/ai';
import { useFact, useInspect } from 'directive/solid';
import { onCleanup } from 'solid-js';

function AgentDashboard() {
  const stack = createAgentStack({ run, agents: { /* ... */ } });
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
import { createAgentStack } from 'directive/ai';
import { FactController, InspectController } from 'directive/lit';

class AgentDashboard extends LitElement {
  private stack = createAgentStack({ run, agents: { /* ... */ } });
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

See [Agent Orchestrator — Framework Integration](/docs/ai/orchestrator#framework-integration) for additional hooks like `useSelector` and `useWatch`.

---

## Next Steps

- See [Agent Orchestrator](/docs/ai/orchestrator) for the core orchestrator API
- See [Guardrails & Safety](/docs/ai/guardrails) for input validation and streaming constraints
- See [Streaming](/docs/ai/streaming) for real-time response processing
- See [Multi-Agent Patterns](/docs/ai/multi-agent) for parallel, sequential, and supervisor patterns
