# @directive-run/adapter-ollama

Ollama adapter for Directive AI. Provides runners for local Ollama inference -- no API keys required.

## Install

```bash
npm install @directive-run/core @directive-run/ai @directive-run/adapter-ollama
```

Make sure Ollama is running locally:

```bash
ollama serve
```

## Usage

```typescript
import { createAgentStack } from "@directive-run/ai";
import { createOllamaRunner } from "@directive-run/adapter-ollama";

const runner = createOllamaRunner({
  model: "llama3", // default
  baseURL: "http://localhost:11434", // default
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

- `createOllamaRunner` – Local Ollama chat runner

## Peer Dependencies

- `@directive-run/core`
- `@directive-run/ai`

## License

MIT

[Full documentation](https://directive.run/docs)
