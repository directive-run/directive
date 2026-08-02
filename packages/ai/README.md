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
| Alias (same table) | `OPENAI_TOKEN_PRICING` | `ANTHROPIC_TOKEN_PRICING` | `OLLAMA_TOKEN_PRICING` | `GEMINI_TOKEN_PRICING` |
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

### One pricing constant, every cost surface

Each `*_PRICING` entry carries the same rates under both field spellings, so
there is no wrong constant to grab. `estimateCost` reads the bare `.input` /
`.output` numbers; `withBudget` and `createConstraintRouter` are typed against
`TokenPricing` and read `.inputPerMillion` / `.outputPerMillion`. Both pairs are
derived from one source, so they cannot drift. Where a provider prices cache
tokens separately, `.cacheRead` / `.cacheWrite` and their `*PerMillion`
spellings come along the same way:

```typescript
import { withBudget } from "@directive-run/ai";
import { ANTHROPIC_PRICING } from "@directive-run/ai/anthropic";

const pricing = ANTHROPIC_PRICING["claude-sonnet-4-5-20250929"];
const guarded = withBudget(runner, {
  pricing,
  budgets: [{ window: "day", maxCost: 10, pricing }],
});
```

`ANTHROPIC_TOKEN_PRICING` and its siblings are aliases for the same tables, kept
so existing code keeps working.

Hand-built pricing objects are still validated at construction. A rate that is
missing, non-finite, or negative throws with a message naming the fix &ndash; it
used to produce `NaN` or negative costs that silently disabled the budget, which
is the worst possible failure for a spend guard. Zero is accepted: local models
genuinely bill nothing.

Use `toTokenPricingTable` to widen your own `{ input, output }` table the same
way:

```typescript
import { toTokenPricingTable } from "@directive-run/ai";

const MY_PRICING = toTokenPricingTable({ "my-model": { input: 3, output: 15 } });
```

### Cache tokens are priced, not free

`TokenPricing` carries two optional cache rates alongside input and output:

```typescript
const pricing = {
  inputPerMillion: 3,
  outputPerMillion: 15,
  cacheReadPerMillion: 0.3,   // optional – defaults to inputPerMillion
  cacheWritePerMillion: 3.75, // optional – defaults to inputPerMillion
};
```

When a rate is omitted, cache tokens are billed at the **input** rate. That is
deliberately conservative and never free: with prompt caching on, `inputTokens`
is only the uncached remainder, so pricing input and output alone would read a
heavily cached run as nearly costless while the provider bills it in full &ndash;
and a cache *write* bills above the input rate on every provider that offers
one. `ANTHROPIC_PRICING` publishes the real ratios (cache read 0.1x input, cache
write 1.25x input), so no configuration is needed to price Anthropic caching
correctly.

## Cost Caps &ndash; `withBudget`

`withBudget` wraps any runner with a per-call cap and rolling time-window caps.

```typescript
import { withBudget, BudgetExceededError } from "@directive-run/ai";
import { ANTHROPIC_PRICING } from "@directive-run/ai/anthropic";

const pricing = ANTHROPIC_PRICING["claude-sonnet-4-5-20250929"];

const guarded = withBudget(baseRunner, {
  maxCostPerCall: 0.10,
  pricing,                        // required for maxCostPerCall to do anything
  charsPerToken: 4,               // input-token estimate, default 4
  estimatedOutputMultiplier: 1.0, // 0.3 for summarization, 3.0 for generation
  budgets: [
    { window: "hour", maxCost: 5.00, pricing },
    { window: "day", maxCost: 50.00, pricing },
  ],
  onBudgetExceeded: ({ estimated, actual, remaining, window, phase }) => {
    if (phase === "pre-call") {
      console.warn(`[budget] ${window} blocked – est $${estimated.toFixed(4)}, remaining $${remaining.toFixed(4)}`);
      return;
    }
    console.warn(`[budget] ${window} overran after the fact – billed $${actual!.toFixed(4)} against a $${remaining.toFixed(4)} cap`);
  },
});
```

### `onBudgetExceeded` fires in two phases &ndash; only one of them throws

| `phase` | When | Thrown | Money spent |
|---|---|---|---|
| `"pre-call"` | The estimate exceeds a cap | `BudgetExceededError` | none &ndash; the call never ran |
| `"post-call"` | The provider billed more than `maxCostPerCall` | nothing | already spent |

The `"post-call"` case is the one to read twice if you already use this
callback: it fires **after a call that succeeded**, once the money is gone.
`withBudget` gates an *estimate*, so a call estimated at a cent that bills five
dollars clears the gate; it cannot be blocked, but it is reported rather than
absorbed in silence. Treat `phase: "post-call"` as an alert, not as a failure,
and do not retry on it.

`estimated` is always the pre-call estimate, in both phases. `actual` is what
the provider billed and is present only when `phase` is `"post-call"`. The
callback receives a frozen copy, so writing to it cannot alter the
`BudgetExceededError` that follows.

### Reading spend

```typescript
import type { BudgetRunner } from "@directive-run/ai";

const runner = guarded as BudgetRunner;

runner.getSpent("hour");   // rolling hour window; 0 if no hour budget configured
runner.getSpent("day");    // rolling day window
runner.getSpent("total");  // lifetime spend for this runner
runner.getUnpricedCallCount(); // calls charged at the estimate, not at billed usage
```

`getSpent("total")` is priced with the top-level `pricing` when supplied, and
otherwise with the first budget window's rates &ndash; it returns `0` only when
neither is configured.

`getUnpricedCallCount()` is how you find out the ledger is approximate. When a
runner reports no `tokenUsage`, or reports a non-finite or negative token count,
`withBudget` charges the pre-call estimate instead of skipping the call, and
counts it here. A count that tracks your call count means the runner never
reports usage and every `getSpent` figure is an estimate.

### Configuration is validated at construction

Rates and caps are read once, validated, and copied when the wrapper is built.
A rate that is missing, non-finite, negative, or `-0` throws with a message
naming the fix; a `window` that is not `"hour"` or `"day"` throws rather than
silently disabling the cap; and mutating the objects you passed in afterwards
has no effect. Zero rates are accepted &ndash; local models genuinely bill nothing
&ndash; but pairing all-zero rates with a non-zero cap warns, since that cap can
never trip.

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

> **Cost tracking.** `withBudget` and `createConstraintRouter` price all four token classes. Cache rates come from the pricing object's `cacheReadPerMillion` / `cacheWritePerMillion`, and `ANTHROPIC_PRICING` publishes the real ratios (read 0.1x input, write 1.25x input). A hand-built pricing object that omits them bills cache tokens at the input rate &ndash; conservative, so a cached run reads as somewhat more expensive than it is, never as free. `estimateCost` takes one bare rate and one token count, so it prices whichever class you hand it; sum the classes yourself if you use it directly.

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
