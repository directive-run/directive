---
title: Running Agents
description: The fastest way to run a single AI agent with Directive – pick a provider, define an agent, call run.
---

Run a single AI agent in three lines. {% .lead %}

This is the minimal path. No orchestrator, no guardrails, no memory &ndash; just a runner function, an agent, and an input. When you need more, layer in the [orchestrator](/docs/ai/orchestrator) or the full [agent stack](/docs/ai/agent-stack).

---

## What Is a Runner?

A **runner** is an async function that sends a prompt to an LLM provider and returns a standardized result. It handles the HTTP call, authentication, and response parsing for a specific provider (OpenAI, Anthropic, Ollama, etc.) so your application code stays provider-agnostic. Think of it as a thin adapter: `(agent, input) => RunResult`.

Directive ships pre-built runners (`createOpenAIRunner`, `createAnthropicRunner`, `createOllamaRunner`) and a `createRunner` helper for custom providers. Every runner returns the same `RunResult` shape &ndash; swap providers by changing one line.

---

## Quick Start

```typescript
import { createOpenAIRunner } from '@directive-run/ai/openai';

// Create a runner for OpenAI (just needs an API key)
const runner = createOpenAIRunner({ apiKey: process.env.OPENAI_API_KEY! });

// Run an agent – pass the agent definition and the user input
const result = await runner(
  { name: 'assistant', instructions: 'You are helpful.', model: 'gpt-4o' },
  'What is WebAssembly?'
);

console.log(result.output);      // "WebAssembly is..."
console.log(result.totalTokens); // 142
console.log(result.tokenUsage);  // { inputTokens: 42, outputTokens: 100 }
```

That's it. `runner` is a plain async function – no framework, no state, no setup.

---

## Choose a Provider

Directive ships pre-built runners for common providers. Each returns a standard `AgentRunner`:

### OpenAI

```typescript
import { createOpenAIRunner } from '@directive-run/ai/openai';

const runner = createOpenAIRunner({
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-4o',                               // Default model (agent can override)
  baseURL: 'https://api.openai.com/v1',           // Works with Azure, Together, etc.
});
```

### Anthropic (Claude)

```typescript
import { createAnthropicRunner } from '@directive-run/ai/anthropic';

const runner = createAnthropicRunner({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: 'claude-sonnet-4-5-20250929',     // Default Claude model
  maxTokens: 4096,                         // Max output tokens per request
});
```

### Ollama (Local)

```typescript
import { createOllamaRunner } from '@directive-run/ai/ollama';

// Connect to a locally running Ollama instance – no API key needed
const runner = createOllamaRunner({
  model: 'llama3',
  baseURL: 'http://localhost:11434',  // Default Ollama address
});
```

---

## Define an Agent

An agent is a plain object with `name`, `instructions`, and `model`:

```typescript
import type { AgentLike } from '@directive-run/ai';

// An agent is a plain object – name, instructions, and optional model
const agent: AgentLike = {
  name: 'code-reviewer',
  instructions: 'You review code for bugs, security issues, and style.',
  model: 'gpt-4o',  // Optional – falls back to the runner's default model
};
```

The `model` field is optional – if omitted, the runner function's default model is used.

---

## Run Result

Every `runner()` call returns a `RunResult`:

```typescript
const result = await runner(agent, 'Review this function: function add(a, b) { return a + b; }');

// Every RunResult includes these fields
result.output;        // string – the agent's response
result.messages;      // Message[] – full conversation (user + assistant turns)
result.toolCalls;     // ToolCall[] – any tool calls made (empty for basic runs)
result.totalTokens;   // number – total tokens consumed
result.tokenUsage;    // { inputTokens, outputTokens } – breakdown by direction
```

---

## Cost Tracking

Every adapter returns a `tokenUsage` breakdown alongside `totalTokens`. Pair it with the pricing constants each adapter exports:

```typescript
import { estimateCost } from '@directive-run/ai';
import { createOpenAIRunner, OPENAI_PRICING } from '@directive-run/ai/openai';

const runner = createOpenAIRunner({ apiKey: process.env.OPENAI_API_KEY! });
const result = await runner(agent, 'Summarize this document...');

const { inputTokens, outputTokens } = result.tokenUsage!;
const cost =
  estimateCost(inputTokens, OPENAI_PRICING['gpt-4o'].input) +
  estimateCost(outputTokens, OPENAI_PRICING['gpt-4o'].output);

console.log(`$${cost.toFixed(6)}`); // "$0.001025"
```

Available pricing constants:

| Import | Models |
|--------|--------|
| `OPENAI_PRICING` from `@directive-run/ai/openai` | `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `o3-mini` |
| `ANTHROPIC_PRICING` from `@directive-run/ai/anthropic` | `claude-sonnet-4-5-20250929`, `claude-haiku-3-5-20241022`, `claude-opus-4-20250514` |

{% callout title="Pricing disclaimer" %}
Pricing changes over time. The constants are provided as a convenience and may not reflect the latest rates. Always verify at your provider's pricing page.
{% /callout %}

---

## Lifecycle Hooks

Attach hooks to any adapter for tracing, logging, and metrics without modifying application code:

```typescript
import { createAnthropicRunner } from '@directive-run/ai/anthropic';

const runner = createAnthropicRunner({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  hooks: {
    onBeforeCall: ({ agent, input }) => {
      console.log(`→ ${agent.name}`, input.slice(0, 50));
    },
    onAfterCall: ({ durationMs, tokenUsage, totalTokens }) => {
      metrics.track('llm_call', {
        durationMs,
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        totalTokens,
      });
    },
    onError: ({ error, durationMs }) => {
      Sentry.captureException(error, { extra: { durationMs } });
    },
  },
});
```

| Hook | Fires | Payload |
|------|-------|---------|
| `onBeforeCall` | Before each LLM API call | `agent`, `input`, `timestamp` |
| `onAfterCall` | After a successful response | `agent`, `input`, `output`, `totalTokens`, `tokenUsage`, `durationMs`, `timestamp` |
| `onError` | When a call fails | `agent`, `input`, `error`, `durationMs`, `timestamp` |

Hooks work on both standard runners (`createOpenAIRunner`, `createAnthropicRunner`, `createOllamaRunner`) and streaming runners (`createOpenAIStreamingRunner`, `createAnthropicStreamingRunner`).

---

## Custom Runner

For providers without a pre-built helper, use `createRunner`:

```typescript
import { createRunner } from '@directive-run/ai';

const runner = createRunner({
  // Build the HTTP request from the agent definition and user input
  buildRequest: (agent, input) => ({
    url: 'https://my-llm.example.com/chat',
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ...' },
      body: JSON.stringify({
        model: agent.model ?? 'default-model',
        system: agent.instructions ?? '',
        messages: [{ role: 'user', content: input }],
      }),
    },
  }),

  // Extract the text and token count from the raw HTTP response
  parseResponse: async (res) => {
    const data = await res.json();

    return {
      text: data.output ?? '',
      totalTokens: data.usage?.total ?? 0,
    };
  },
});
```

Or write an `AgentRunner` from scratch:

```typescript
import type { AgentRunner } from '@directive-run/ai';

// Implement the AgentRunner interface from scratch
const runner: AgentRunner = async (agent, input, options) => {
  const response = await fetch('/api/chat', {
    method: 'POST',
    signal: options?.signal,         // Support cancellation via AbortSignal
    body: JSON.stringify({ model: agent.model, prompt: input }),
  });
  const data = await response.json();

  // Return a standard RunResult so it works with the orchestrator and stack
  return {
    output: data.text,
    messages: [
      { role: 'user', content: input },
      { role: 'assistant', content: data.text },
    ],
    toolCalls: [],
    totalTokens: data.tokens ?? 0,
  };
};
```

---

## When to Add More

The raw runner is perfect for scripts, one-off calls, and simple integrations. Layer in more features as your needs grow:

| Need | Solution |
|------|----------|
| Retry with backoff, fallback providers | [Resilience & Routing](/docs/ai/resilience-routing) |
| Cost budget limits, model routing | [Resilience & Routing](/docs/ai/resilience-routing) |
| Typed JSON output from LLMs | [Resilience & Routing](/docs/ai/resilience-routing) |
| Guardrails (input/output validation) | [Orchestrator](/docs/ai/orchestrator) |
| Approval workflows | [Orchestrator](/docs/ai/orchestrator) |
| Token budgets | [Orchestrator](/docs/ai/orchestrator) |
| Reactive UI state | [Orchestrator](/docs/ai/orchestrator) + [Framework hooks](/docs/ai/orchestrator#framework-integration) |
| Memory / conversation context | [Agent Stack](/docs/ai/agent-stack) |
| Caching, circuit breakers, observability | [Agent Stack](/docs/ai/agent-stack) |
| Parallel / sequential / supervisor patterns | [Multi-Agent](/docs/ai/multi-agent) |

---

## Next Steps

- [Resilience & Routing](/docs/ai/resilience-routing) – retry, fallback, budgets, model selection, structured outputs
- [Orchestrator](/docs/ai/orchestrator) – add guardrails, approvals, and state tracking
- [Agent Stack](/docs/ai/agent-stack) – all-in-one factory with memory, caching, and resilience
- [Streaming](/docs/ai/streaming) – real-time token streaming
- [Guardrails](/docs/ai/guardrails) – input validation and output safety
