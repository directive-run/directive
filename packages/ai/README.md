# @directive-run/ai

[![npm](https://img.shields.io/npm/v/@directive-run/ai?color=%236366f1)](https://www.npmjs.com/package/@directive-run/ai)
[![downloads](https://img.shields.io/npm/dm/@directive-run/ai)](https://www.npmjs.com/package/@directive-run/ai)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@directive-run/ai)](https://bundlephobia.com/package/@directive-run/ai)
[![license](https://img.shields.io/npm/l/@directive-run/ai)](https://github.com/directive-run/directive/blob/main/LICENSE)

AI agent orchestration with guardrails, cost tracking, and multi-agent coordination. Built on [Directive](https://www.npmjs.com/package/@directive-run/core)'s constraint-driven runtime.

- **No SDK dependencies** &ndash; pure `fetch` adapters for OpenAI, Anthropic, and Ollama
- **Guardrails** &ndash; input, output, and tool call validation with retry support
- **Multi-agent orchestration** &ndash; parallel, sequential, and supervisor patterns
- **Cost tracking** &ndash; per-call token usage with pricing constants for every provider
- **Streaming** &ndash; async iterable streams with backpressure and streaming guardrails
- **Provider adapters** &ndash; swap providers by changing one import, not your codebase

## Install

```bash
npm install @directive-run/core @directive-run/ai
```

Provider adapters are subpath exports &ndash; no extra packages needed.

## Quick Start

```typescript
import { createAgentStack } from "@directive-run/ai";
import { createOpenAIRunner } from "@directive-run/ai/openai";

const runner = createOpenAIRunner({ apiKey: process.env.OPENAI_API_KEY! });

const stack = createAgentStack({
  runner,
  agents: {
    assistant: {
      agent: { name: "assistant", instructions: "You are a helpful assistant." },
    },
  },
  guardrails: {
    input: [async (data) => ({ passed: data.input.length < 10000 })],
  },
});

const result = await stack.run("assistant", "Hello!");
console.log(result.output);
```

## Provider Adapters

Adapters are thin wrappers around each provider's HTTP API. No SDK dependencies &ndash; pure `fetch`.

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
import { estimateCost } from "@directive-run/ai";
import { createOpenAIRunner, OPENAI_PRICING } from "@directive-run/ai/openai";

const runner = createOpenAIRunner({ apiKey: process.env.OPENAI_API_KEY! });
const result = await runner(agent, "Hello");

const { inputTokens, outputTokens } = result.tokenUsage!;
const cost =
  estimateCost(inputTokens, OPENAI_PRICING["gpt-4o"].input) +
  estimateCost(outputTokens, OPENAI_PRICING["gpt-4o"].output);
```

## Lifecycle Hooks

Attach hooks to any adapter for observability:

```typescript
import { createAnthropicRunner } from "@directive-run/ai/anthropic";

const runner = createAnthropicRunner({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  hooks: {
    onBeforeCall: ({ agent, input }) => console.log(`Calling ${agent.name}`),
    onAfterCall: ({ durationMs, tokenUsage }) => {
      metrics.track("llm_call", { durationMs, ...tokenUsage });
    },
    onError: ({ error }) => Sentry.captureException(error),
  },
});
```

## Multi-Agent Orchestration

Coordinate multiple agents with built-in execution patterns:

```typescript
import { createAgentStack, parallel } from "@directive-run/ai";
import { createOpenAIRunner } from "@directive-run/ai/openai";

const runner = createOpenAIRunner({ apiKey: process.env.OPENAI_API_KEY! });

const researchAgent = { name: "researcher", instructions: "Research the topic thoroughly." };
const writerAgent = { name: "writer", instructions: "Write a clear summary." };

const stack = createAgentStack({
  runner,
  agents: {
    researcher: { agent: researchAgent, maxConcurrent: 3 },
    writer: { agent: writerAgent, maxConcurrent: 1 },
  },
  patterns: {
    researchAndWrite: parallel(
      ["researcher", "writer"],
      (results) => results.map((r) => r.output).join("\n\n"),
    ),
  },
});

// Run the pattern
const result = await stack.runPattern("researchAndWrite", "Quantum computing basics");
```

## Subpath Exports

| Import | Purpose |
|--------|---------|
| `@directive-run/ai` | Orchestrator, guardrails, multi-agent, streaming, memory |
| `@directive-run/ai/testing` | Mock runners, test helpers |
| `@directive-run/ai/openai` | OpenAI / Azure / Together adapter |
| `@directive-run/ai/anthropic` | Anthropic Claude adapter |
| `@directive-run/ai/ollama` | Local Ollama inference adapter |

## Testing

Mock runners for unit testing without real LLM calls:

```typescript
import { createAgentStack } from "@directive-run/ai";
import { createMockAgentRunner } from "@directive-run/ai/testing";

const mock = createMockAgentRunner({
  responses: {
    assistant: { output: "This is a mock response." },
  },
});

const stack = createAgentStack({
  runner: mock.run,
  agents: {
    assistant: {
      agent: { name: "assistant", instructions: "You are a helpful assistant." },
    },
  },
});

const result = await stack.run("assistant", "Hello!");
// result.output === "This is a mock response."
```

## Documentation

- [AI Guide](https://directive.run/docs/ai)
- [API Reference](https://directive.run/docs/api)
- [GitHub](https://github.com/directive-run/directive)

## License

MIT
