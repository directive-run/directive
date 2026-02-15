# @directive-run/ai

AI agent orchestration, guardrails, and multi-agent coordination for Directive. Use Directive constraints to add safety guardrails, approval workflows, and state persistence to any LLM agent framework.

## Install

```bash
npm install @directive-run/core @directive-run/ai
```

Provider adapters are included as subpath exports – no extra packages needed.

## Usage

```typescript
import { createAgentStack } from "@directive-run/ai";
import { createOpenAIRunner } from "@directive-run/ai/openai";

const runner = createOpenAIRunner({ apiKey: process.env.OPENAI_API_KEY! });

const stack = createAgentStack({
  runner,
  agents: {
    assistant: { instructions: "You are a helpful assistant." },
  },
  guardrails: {
    input: [async (data) => ({ passed: data.input.length < 10000 })],
  },
});

const result = await stack.run("assistant", "Hello!");
console.log(result.output);
```

## Why Directive Adapters?

Directive adapters are intentionally thin &ndash; they map `createRunner()` config to each provider's HTTP API. This gives you:

- **No SDK dependencies** &ndash; pure `fetch`, no `openai` or `@anthropic-ai/sdk` to install
- **Uniform interface** &ndash; swap providers by changing one import, not your entire codebase
- **Built-in observability** &ndash; lifecycle hooks (`onBeforeCall`, `onAfterCall`, `onError`) on every adapter
- **Cost tracking** &ndash; `tokenUsage` breakdown (input/output) and pricing constants for every provider
- **Tree-shakeable** &ndash; each adapter is a separate entry point; unused adapters never enter your bundle

## Key Features

- Guardrails (input, output, tool call) with retry support
- Approval workflows for tool calls
- Multi-agent orchestration (parallel, sequential, supervisor patterns)
- Agent memory (sliding window, token-based, hybrid strategies)
- Streaming with backpressure and streaming guardrails
- Semantic caching and RAG enrichment
- Circuit breakers and observability
- Per-call cost tracking with `tokenUsage` and pricing constants
- Adapter lifecycle hooks for tracing, logging, and metrics

## Subpath Exports

| Import | Purpose |
|--------|---------|
| `@directive-run/ai` | Orchestrator, guardrails, multi-agent, streaming |
| `@directive-run/ai/testing` | Mock runners, test helpers |
| `@directive-run/ai/openai` | OpenAI, Azure, Together adapter |
| `@directive-run/ai/anthropic` | Anthropic Claude adapter |
| `@directive-run/ai/ollama` | Local Ollama inference adapter |

## Provider Comparison

| | OpenAI | Anthropic | Ollama |
|---|--------|-----------|--------|
| Import | `@directive-run/ai/openai` | `@directive-run/ai/anthropic` | `@directive-run/ai/ollama` |
| Default model | `gpt-4o` | `claude-sonnet-4-5-20250929` | `llama3` |
| API key required | Yes | Yes | No |
| Streaming runner | `createOpenAIStreamingRunner` | `createAnthropicStreamingRunner` | &ndash; |
| Embedder | `createOpenAIEmbedder` | &ndash; | &ndash; |
| Pricing constants | `OPENAI_PRICING` | `ANTHROPIC_PRICING` | &ndash; |
| Compatible APIs | Azure, Together, any OpenAI-compatible | &ndash; | &ndash; |

## Cost Tracking

Every adapter returns `tokenUsage` with input/output breakdown:

```typescript
import { estimateCost } from '@directive-run/ai';
import { createOpenAIRunner, OPENAI_PRICING } from '@directive-run/ai/openai';

const runner = createOpenAIRunner({ apiKey: process.env.OPENAI_API_KEY! });
const result = await runner(agent, 'Hello');

const { inputTokens, outputTokens } = result.tokenUsage!;
const cost =
  estimateCost(inputTokens, OPENAI_PRICING['gpt-4o'].input) +
  estimateCost(outputTokens, OPENAI_PRICING['gpt-4o'].output);
```

## Lifecycle Hooks

Attach hooks to any adapter for observability:

```typescript
import { createAnthropicRunner } from '@directive-run/ai/anthropic';

const runner = createAnthropicRunner({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  hooks: {
    onBeforeCall: ({ agent, input }) => console.log(`→ ${agent.name}`),
    onAfterCall: ({ durationMs, tokenUsage }) => {
      metrics.track('llm_call', { durationMs, ...tokenUsage });
    },
    onError: ({ error }) => Sentry.captureException(error),
  },
});
```

## Testing

The `@directive-run/ai/testing` subpath provides mock runners and test helpers for unit testing agent stacks without making real LLM calls:

```typescript
import { createAgentStack } from "@directive-run/ai";
import { createMockRunner, createMockStreamingRunner } from "@directive-run/ai/testing";

const mockRunner = createMockRunner({
  responses: {
    assistant: "This is a mock response.",
  },
});

const stack = createAgentStack({
  runner: mockRunner,
  agents: {
    assistant: { instructions: "You are a helpful assistant." },
  },
});

const result = await stack.run("assistant", "Hello!");
// result.output === "This is a mock response."
```

Use `createMockStreamingRunner` to test streaming code paths with controlled chunk delivery.

## License

MIT

[Full documentation](https://directive.run/docs)
