# @directive-run/ai

AI agent orchestration, guardrails, and multi-agent coordination for Directive. Use Directive constraints to add safety guardrails, approval workflows, and state persistence to any LLM agent framework.

## Install

```bash
npm install @directive-run/core @directive-run/ai
```

You also need an adapter package for your LLM provider:

- `@directive-run/adapter-openai` – OpenAI, Azure, Together
- `@directive-run/adapter-anthropic` – Anthropic Claude
- `@directive-run/adapter-ollama` – Local Ollama inference

## Usage

```typescript
import { createAgentStack } from "@directive-run/ai";
import { createOpenAIRunner } from "@directive-run/adapter-openai";

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

## Key Features

- Guardrails (input, output, tool call) with retry support
- Approval workflows for tool calls
- Multi-agent orchestration (parallel, sequential, supervisor patterns)
- Agent memory (sliding window, token-based, hybrid strategies)
- Streaming with backpressure and streaming guardrails
- Semantic caching and RAG enrichment
- Circuit breakers and observability

## Subpath Exports

| Import | Purpose |
|--------|---------|
| `@directive-run/ai` | Orchestrator, guardrails, multi-agent, streaming |
| `@directive-run/ai/testing` | Mock runners, test helpers |

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
