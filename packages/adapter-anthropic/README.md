# @directive-run/adapter-anthropic

Anthropic adapter for Directive AI. Provides runners for the Anthropic Messages API, including streaming support.

## Install

```bash
npm install @directive-run/core @directive-run/ai @directive-run/adapter-anthropic
```

## Usage

```typescript
import { createAgentStack } from "@directive-run/ai";
import {
  createAnthropicRunner,
  createAnthropicStreamingRunner,
} from "@directive-run/adapter-anthropic";

const runner = createAnthropicRunner({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: "claude-sonnet-4-5-20250929", // default
});

const stack = createAgentStack({
  runner,
  agents: {
    assistant: { instructions: "You are a helpful assistant." },
  },
});

const result = await stack.run("assistant", "What is Directive?");
console.log(result.output);
```

## Exports

- `createAnthropicRunner` – Messages API runner
- `createAnthropicStreamingRunner` – Streaming SSE runner

## Peer Dependencies

- `@directive-run/core`
- `@directive-run/ai`

## License

MIT

[Full documentation](https://directive.run/docs)
