# AI Adapters

Adapters connect the orchestrator to LLM providers. Each adapter normalizes provider-specific APIs into Directive's `AgentRunner` interface.

## Decision Tree: "Which adapter do I need?"

```
Which LLM provider?
├── Anthropic (Claude) → createAnthropicRunner from '@directive-run/ai/anthropic'
├── OpenAI (GPT)       → createOpenAIRunner from '@directive-run/ai/openai'
├── Google (Gemini)    → createGeminiRunner from '@directive-run/ai/gemini'
└── Ollama (local)     → createOllamaRunner from '@directive-run/ai/ollama'
    │
    Need streaming?
    ├── Yes → create*StreamingRunner from the same subpath
    └── No  → create*Runner is sufficient
    │
    Need a proxy/self-hosted URL?
    └── Yes → pass baseURL option
```

## CRITICAL: Subpath Imports

Every adapter MUST be imported from its subpath. The main `@directive-run/ai` entry does NOT export adapters.

```typescript
// CORRECT — subpath imports
import { createAnthropicRunner } from "@directive-run/ai/anthropic";
import { createOpenAIRunner } from "@directive-run/ai/openai";
import { createOllamaRunner } from "@directive-run/ai/ollama";
import { createGeminiRunner } from "@directive-run/ai/gemini";
```

### Anti-Pattern #26: Importing adapters from the main entry

```typescript
// WRONG — adapters are NOT exported from the main package
import { createOpenAIRunner } from "@directive-run/ai";
import { createAnthropicRunner } from "@directive-run/ai";

// CORRECT — use subpath imports
import { createOpenAIRunner } from "@directive-run/ai/openai";
import { createAnthropicRunner } from "@directive-run/ai/anthropic";
```

## Anthropic Adapter

```typescript
import {
  createAnthropicRunner,
  createAnthropicStreamingRunner,
} from "@directive-run/ai/anthropic";

// Standard runner
const runner = createAnthropicRunner({
  apiKey: process.env.ANTHROPIC_API_KEY,
  defaultModel: "claude-sonnet-4-5",
  maxTokens: 4096,
});

// Streaming runner
const streamingRunner = createAnthropicStreamingRunner({
  apiKey: process.env.ANTHROPIC_API_KEY,
  defaultModel: "claude-sonnet-4-5",
  maxTokens: 4096,
});

// With proxy URL
const proxiedRunner = createAnthropicRunner({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: "https://my-proxy.example.com/v1",
});
```

## OpenAI Adapter

```typescript
import {
  createOpenAIRunner,
  createOpenAIStreamingRunner,
} from "@directive-run/ai/openai";

const runner = createOpenAIRunner({
  apiKey: process.env.OPENAI_API_KEY,
  defaultModel: "gpt-4o",
  organization: "org-xxx", // Optional
});

// Azure OpenAI
const azureRunner = createOpenAIRunner({
  apiKey: process.env.AZURE_OPENAI_KEY,
  baseURL: "https://my-instance.openai.azure.com/openai/deployments/gpt-4o",
  defaultHeaders: {
    "api-version": "2024-02-01",
  },
});
```

## Ollama Adapter (Local Models)

```typescript
import {
  createOllamaRunner,
  createOllamaStreamingRunner,
} from "@directive-run/ai/ollama";

const runner = createOllamaRunner({
  // Default: http://localhost:11434
  baseURL: "http://localhost:11434",
  defaultModel: "llama3.1",
});

// Remote Ollama instance
const remoteRunner = createOllamaRunner({
  baseURL: "https://ollama.my-server.com",
  defaultModel: "mistral",
});
```

## Gemini Adapter

```typescript
import {
  createGeminiRunner,
  createGeminiStreamingRunner,
} from "@directive-run/ai/gemini";

const runner = createGeminiRunner({
  apiKey: process.env.GOOGLE_API_KEY,
  defaultModel: "gemini-2.0-flash",
});
```

## Token Normalization

### Anti-Pattern #27: Assuming provider-specific token structure

```typescript
// WRONG — Anthropic returns { input_tokens, output_tokens } natively
// but adapters normalize this
const result = await runner.run(agent, prompt);
console.log(result.tokenUsage.input_tokens); // undefined!

// CORRECT — adapters normalize to camelCase
const result = await runner.run(agent, prompt);
console.log(result.tokenUsage.inputTokens);   // number
console.log(result.tokenUsage.outputTokens);   // number
console.log(result.totalTokens);               // inputTokens + outputTokens
```

All adapters normalize token usage to the same shape regardless of provider:

```typescript
interface NormalizedTokenUsage {
  inputTokens: number;
  outputTokens: number;
}

// result.totalTokens = inputTokens + outputTokens
```

## Adapter Hooks

Every adapter supports lifecycle hooks for logging, metrics, or request modification:

```typescript
const runner = createAnthropicRunner({
  apiKey: process.env.ANTHROPIC_API_KEY,
  hooks: {
    // Called before every LLM API call
    onBeforeCall: (agent, prompt, options) => {
      console.log(`Calling ${agent.model} for ${agent.name}`);
      metrics.increment("llm.calls");
    },

    // Called after every successful LLM API call
    onAfterCall: (agent, result) => {
      console.log(`${agent.name}: ${result.totalTokens} tokens`);
      metrics.histogram("llm.tokens", result.totalTokens);
    },

    // Called on LLM API errors
    onError: (agent, error) => {
      console.error(`${agent.name} failed:`, error.message);
      metrics.increment("llm.errors");
    },
  },
});
```

## Using Adapters with Orchestrators

```typescript
import { createAgentOrchestrator } from "@directive-run/ai";
import { createAnthropicRunner } from "@directive-run/ai/anthropic";

const runner = createAnthropicRunner({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Single-agent
const orchestrator = createAgentOrchestrator({ runner });

// Multi-agent — same runner shared across all agents
const multiOrchestrator = createMultiAgentOrchestrator({
  agents: { /* ... */ },
  runner,
});
```

## Switching Adapters

Adapters are interchangeable. Switch providers by changing the import and config:

```typescript
// Before: Anthropic
import { createAnthropicRunner } from "@directive-run/ai/anthropic";
const runner = createAnthropicRunner({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// After: OpenAI — same orchestrator, different runner
import { createOpenAIRunner } from "@directive-run/ai/openai";
const runner = createOpenAIRunner({
  apiKey: process.env.OPENAI_API_KEY,
});

// Orchestrator code remains unchanged
const orchestrator = createAgentOrchestrator({ runner });
```

## Custom BaseURL Patterns

| Provider | Default BaseURL | Custom Use Case |
|---|---|---|
| Anthropic | `https://api.anthropic.com` | Corporate proxy, VPN relay |
| OpenAI | `https://api.openai.com/v1` | Azure OpenAI, LiteLLM proxy |
| Ollama | `http://localhost:11434` | Remote GPU server |
| Gemini | `https://generativelanguage.googleapis.com` | Regional endpoint |

## Quick Reference

| Adapter | Import Path | Key Options |
|---|---|---|
| Anthropic | `@directive-run/ai/anthropic` | `apiKey`, `defaultModel`, `maxTokens` |
| OpenAI | `@directive-run/ai/openai` | `apiKey`, `defaultModel`, `organization` |
| Ollama | `@directive-run/ai/ollama` | `baseURL`, `defaultModel` |
| Gemini | `@directive-run/ai/gemini` | `apiKey`, `defaultModel` |

All adapters support: `baseURL`, `defaultHeaders`, `hooks`, streaming variant.
