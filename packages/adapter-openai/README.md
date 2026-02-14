# @directive-run/adapter-openai

OpenAI adapter for Directive AI. Provides runners and embedders for OpenAI-compatible APIs (OpenAI, Azure, Together, etc.).

## Install

```bash
npm install @directive-run/core @directive-run/ai @directive-run/adapter-openai
```

## Usage

```typescript
import { createAgentStack } from "@directive-run/ai";
import { createOpenAIRunner, createOpenAIEmbedder } from "@directive-run/adapter-openai";

const runner = createOpenAIRunner({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-4o", // default
});

const stack = createAgentStack({
  runner,
  agents: {
    assistant: { instructions: "You are a helpful assistant." },
  },
});

const result = await stack.run("assistant", "What is Directive?");
console.log(result.output);

// Embeddings (for RAG / semantic cache)
const embedder = createOpenAIEmbedder({
  apiKey: process.env.OPENAI_API_KEY!,
});
const embedding = await embedder("How do constraints work?");
```

## Streaming

```typescript
import { createAgentStack } from "@directive-run/ai";
import { createOpenAIRunner, createOpenAIStreamingRunner } from "@directive-run/adapter-openai";

const apiKey = process.env.OPENAI_API_KEY!;

const stack = createAgentStack({
  runner: createOpenAIRunner({ apiKey }),
  streaming: {
    runner: createOpenAIStreamingRunner({ apiKey }),
  },
  agents: {
    assistant: { instructions: "You are a helpful assistant." },
  },
});
```

## Exports

- `createOpenAIRunner` &ndash; Chat completions runner
- `createOpenAIEmbedder` &ndash; Embeddings API client
- `createOpenAIStreamingRunner` &ndash; Streaming chat completions with SSE

## Peer Dependencies

- `@directive-run/core`
- `@directive-run/ai`

## License

MIT

[Full documentation](https://directive.run/docs)
