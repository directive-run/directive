# @directive-run/ai

[![npm](https://img.shields.io/npm/v/@directive-run/ai?color=%236366f1)](https://www.npmjs.com/package/@directive-run/ai)
[![downloads](https://img.shields.io/npm/dm/@directive-run/ai)](https://www.npmjs.com/package/@directive-run/ai)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@directive-run/ai)](https://bundlephobia.com/package/@directive-run/ai)
[![license](https://img.shields.io/npm/l/@directive-run/ai)](https://github.com/directive-run/directive/blob/main/LICENSE)

AI agent orchestration with guardrails, cost tracking, and multi-agent coordination. Built on [Directive](https://www.npmjs.com/package/@directive-run/core)'s constraint-driven runtime.

- **No SDK dependencies** &ndash; pure `fetch` adapters for OpenAI, Anthropic, Ollama, and Gemini
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
import { createAgentOrchestrator } from "@directive-run/ai";
import { createOpenAIRunner } from "@directive-run/ai/openai";

const runner = createOpenAIRunner({ apiKey: process.env.OPENAI_API_KEY! });

const orchestrator = createAgentOrchestrator({
  runner,
  guardrails: {
    input: [async (data) => ({ passed: data.input.length < 10000 })],
  },
});

const result = await orchestrator.run(
  { name: "assistant", instructions: "You are a helpful assistant." },
  "Hello!",
);
console.log(result.output);
```

## Provider Adapters

Adapters are thin wrappers around each provider's HTTP API. No SDK dependencies &ndash; pure `fetch`.

| | OpenAI | Anthropic | Ollama | Gemini |
|---|--------|-----------|--------|--------|
| Import | `@directive-run/ai/openai` | `@directive-run/ai/anthropic` | `@directive-run/ai/ollama` | `@directive-run/ai/gemini` |
| Default model | `gpt-4o` | `claude-sonnet-4-5-20250929` | `llama3` | `gemini-2.0-flash` |
| API key required | Yes | Yes | No | Yes |
| Streaming runner | `createOpenAIStreamingRunner` | `createAnthropicStreamingRunner` | &ndash; | `createGeminiStreamingRunner` |
| Embedder | `createOpenAIEmbedder` | &ndash; | &ndash; | &ndash; |
| Pricing constants | `OPENAI_PRICING` | `ANTHROPIC_PRICING` | `OLLAMA_PRICING` | `GEMINI_PRICING` |
| Budget-shaped pricing | `OPENAI_TOKEN_PRICING` | `ANTHROPIC_TOKEN_PRICING` | `OLLAMA_TOKEN_PRICING` | `GEMINI_TOKEN_PRICING` |
| Prompt caching | &ndash; | `promptCaching: "automatic"` | &ndash; | &ndash; |
| Compatible APIs | Azure, Together, any OpenAI-compatible | &ndash; | &ndash; | &ndash; |

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

### Pricing constants come in two shapes

`estimateCost` takes a bare per-million rate, so it pairs with `*_PRICING`
(`{ input, output }`). `withBudget` and `withProviderRouting` are typed against
`TokenPricing`, so they pair with `*_TOKEN_PRICING`
(`{ inputPerMillion, outputPerMillion }`). Same numbers, different field names —
pick the one that matches the surface you are calling:

```typescript
import { withBudget } from "@directive-run/ai";
import { ANTHROPIC_TOKEN_PRICING } from "@directive-run/ai/anthropic";

const pricing = ANTHROPIC_TOKEN_PRICING["claude-sonnet-4-5-20250929"];
const guarded = withBudget(runner, {
  pricing,
  budgets: [{ window: "day", maxCost: 10, pricing }],
});
```

Passing a `*_PRICING` entry where `TokenPricing` is expected throws at
construction with a message naming the fix. It used to produce `NaN` costs that
silently disabled the budget, which is the worst possible failure for a spend
guard.

## Prompt Caching (Anthropic)

Opt in with `promptCaching: "automatic"` to place a `cache_control` breakpoint on the agent's instructions. Anthropic caches that stable system prefix, so repeat calls that share it read from cache (~0.1x input cost) instead of reprocessing it &ndash; the variable message suffix stays uncached. It is off by default (bare-string system, byte-for-byte the prior behavior), non-breaking, and needs no beta header on `anthropic-version: 2023-06-01`.

```typescript
import { createAnthropicRunner } from "@directive-run/ai/anthropic";

const runner = createAnthropicRunner({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  promptCaching: "automatic",
});
const result = await runner(agent, "Hello");

// Cache usage is surfaced on tokenUsage (present only when caching is active):
const { inputTokens, cacheReadTokens = 0, cacheCreationTokens = 0 } =
  result.tokenUsage!;
// cacheCreationTokens – tokens written to cache on the first call (~1.25x cost)
// cacheReadTokens     – tokens served from cache on repeat calls (~0.1x cost)
```

`inputTokens` is the **uncached** remainder only; `cacheReadTokens` / `cacheCreationTokens` are separate, additive fields, and `totalTokens` includes all four (input + output + cache-read + cache-creation). When caching is off the cache fields are omitted and `totalTokens` is `inputTokens + outputTokens`, exactly as before. Currently supported on the non-streaming `createAnthropicRunner`.

> **Minimum cacheable prefix (the #1 gotcha).** Anthropic silently ignores `cache_control` when the cached prefix is below a per-model minimum &ndash; roughly 1024 tokens on Sonnet-tier models, 2048 on Sonnet-4.6 & Haiku-3.5, and 4096 on Opus & Haiku-4.5. There is no error: caching just doesn't happen and `cacheReadTokens` stays `0` across repeat calls (that `0` is your diagnostic). Because Directive caches `agent.instructions`, short instructions commonly fall below this threshold. The `ephemeral` breakpoint also has a **5-minute default TTL** &ndash; prefixes not re-read within that window are evicted.

> **Cost tracking caveat.** `withBudget` / `estimateCost` currently weight all tokens equally, so with caching on they do **not** yet reflect the cheaper cache-read (~0.1x) or pricier cache-write (~1.25x) rates &ndash; a cached run will read as more expensive than it actually is. Cache-aware cost pricing is a planned follow-up.

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
import { createMultiAgentOrchestrator, parallel } from "@directive-run/ai";
import { createOpenAIRunner } from "@directive-run/ai/openai";

const runner = createOpenAIRunner({ apiKey: process.env.OPENAI_API_KEY! });

const researchAgent = { name: "researcher", instructions: "Research the topic thoroughly." };
const writerAgent = { name: "writer", instructions: "Write a clear summary." };

const orchestrator = createMultiAgentOrchestrator({
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
const result = await orchestrator.runPattern("researchAndWrite", "Quantum computing basics");
```

## Subpath Exports

| Import | Purpose |
|--------|---------|
| `@directive-run/ai` | Orchestrator, guardrails, multi-agent, streaming, memory |
| `@directive-run/ai/testing` | Mock runners, test helpers |
| `@directive-run/ai/openai` | OpenAI / Azure / Together adapter |
| `@directive-run/ai/anthropic` | Anthropic Claude adapter |
| `@directive-run/ai/ollama` | Local Ollama inference adapter |
| `@directive-run/ai/gemini` | Google Gemini adapter |

## Testing

Mock runners for unit testing without real LLM calls:

```typescript
import { createAgentOrchestrator } from "@directive-run/ai";
import { createMockAgentRunner } from "@directive-run/ai/testing";

const mock = createMockAgentRunner({
  responses: {
    assistant: { output: "This is a mock response." },
  },
});

const orchestrator = createAgentOrchestrator({ runner: mock.run });

const result = await orchestrator.run(
  { name: "assistant", instructions: "You are a helpful assistant." },
  "Hello!",
);
// result.output === "This is a mock response."
```

## Related Blog Posts

- [Building AI Agents with Directive](https://directive.run/blog/building-ai-agents) – orchestrating agents with approval flows, guardrails, and budget constraints
- [Declarative AI Guardrails](https://directive.run/blog/declarative-ai-guardrails) – why your agent framework needs a constraint layer
- [Why AI Loves Directive](https://directive.run/blog/why-ai-loves-directive) – budget enforcement, PII redaction, tool control, and provider resilience
- [Building an AI Docs Chatbot with Directive](https://directive.run/blog/building-ai-docs-chatbot) – RAG-backed chatbot with streaming, guardrails, and reactive state

## Documentation

- [AI Guide](https://directive.run/docs/ai)
- [API Reference](https://directive.run/docs/api)
- [GitHub](https://github.com/directive-run/directive)

## License

MIT
