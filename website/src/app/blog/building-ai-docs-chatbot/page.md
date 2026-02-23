---
title: "Building an AI Docs Chatbot with Directive"
description: How the AI adapter and the core runtime work together to power a RAG-backed docs chatbot with streaming, guardrails, and reactive server-side state.
layout: blog
date: 2026-02-03
dateModified: 2026-02-03
slug: building-ai-docs-chatbot
author: jason-comes
categories: [AI, Tutorial]
---

The Directive documentation site has an AI chatbot. You can open it from the floating button in the bottom-right corner, ask a question about constraints or resolvers, and get a streamed response grounded in the actual docs. This post walks through how it works &ndash; and how the AI adapter and the core Directive runtime compose into a single system.

---

## Five-stage message pipeline

Every chat message flows through a five-stage pipeline:

```text
User Question
  → RAG Enrichment    (embed query, find relevant doc chunks)
  → Agent Orchestrator (guardrails, circuit breaker, streaming runner)
  → SSE Transport     (tokens → Server-Sent Events frames)
  → Browser Widget    (parse SSE, render markdown)
```

The first three stages use Directive's AI adapter (`@directive-run/ai`). The server-side operational state &ndash; request counting, token budget tracking, health monitoring &ndash; uses the core Directive runtime (`createModule`, `createSystem`).

---

## What the AI adapter handles

Middleware functions compose around the runner to add resilience, and `createAgentOrchestrator` configures the agent-level protection layer:

```typescript
// Compose resilience middleware on the runner
let runner = createAnthropicRunner({ ... });
runner = withRetry(runner, { maxRetries: 2, baseDelayMs: 1_000, maxDelayMs: 10_000 });
runner = withFallback([runner, openaiBackupRunner]);
runner = withBudget(runner, {
  budgets: [
    { window: 'hour', maxCost: 5.00, pricing: haikuPricing },
    { window: 'day', maxCost: 50.00, pricing: haikuPricing },
  ],
});

const orchestrator = createAgentOrchestrator({
  runner,
  guardrails: {
    input: [
      createPromptInjectionGuardrail({ strictMode: true }),
      createEnhancedPIIGuardrail({ redact: true }),
    ],
    output: [
      createLengthGuardrail({ maxCharacters: 3_000 }),
    ],
  },
  memory: createAgentMemory({ maxMessages: 20 }),
  circuitBreaker: createCircuitBreaker({ failureThreshold: 3, recoveryTimeMs: 30_000 }),
  maxTokenBudget: 2000,
});
```

Every message passes through prompt injection detection and PII redaction before reaching the LLM. The circuit breaker trips after three consecutive failures and recovers after 30 seconds. The `with*` middleware on the runner handles retry with exponential backoff on 429/503 errors, provider fallback to an OpenAI backup when Anthropic is down, and cost budget guards that cap hourly and daily LLM spend.

---

## The embedding pipeline

The chatbot draws from two complementary knowledge sources, each chunked and embedded separately at build time.

**Phase 1 &ndash; Documentation pages.** A script walks every Markdoc doc page, splits each page into sections (by heading), chunks sections into ~600-token pieces, and embeds them via OpenAI's `text-embedding-3-small`. Each chunk carries a `sourceType` of `"guide"` (hand-written docs) or `"blog"` (blog posts).

**Phase 2 &ndash; API reference.** A second script uses `ts-morph` to walk every exported symbol in the Directive source code, extract JSDoc comments, parameter types, return types, and `@example` blocks, then outputs a structured JSON file. Each symbol becomes one embedding chunk with `sourceType: "api-reference"` and metadata like `symbolName` and `symbolKind`.

```text
Phase 1: Markdoc pages ─→ parse AST ─→ section chunks ─→ embed
                                                              ╲
                                                                → combined embeddings.json
                                                              ╱
Phase 2: TypeScript src ─→ ts-morph  ─→ function chunks ─→ embed
```

When a symbol appears in both the generated API reference and a hand-written `/docs/api/*` page, the pipeline deduplicates and keeps only the generated version (it's canonical, since it comes directly from the source code).

The combined result is a single JSON file stored in `public/embeddings.json`, shipped as a static asset alongside the site. This runs once per deploy.

---

## Generating the API reference

The Phase 2 extraction script (`scripts/extract-api-docs.ts`) uses `ts-morph` to load the package entry points and follow re-exports to find the original declaration of every public symbol. For each export, it extracts the function signature, JSDoc body, `@param` tags, `@returns`, `@example` blocks, and `@throws` &ndash; then writes both a structured JSON file (for the embedding pipeline) and a readable Markdown file (for the team).

```typescript
// scripts/extract-api-docs.ts (simplified)
const project = new Project({ tsConfigFilePath: 'tsconfig.json' })
const entryFile = project.getSourceFileOrThrow('src/index.ts')

for (const [name, declarations] of entryFile.getExportedDeclarations()) {
  const decl = declarations[0]
  const jsDocs = decl.getJsDocs?.()
  entries.push({
    name,
    kind: decl.getKindName(),
    signature: decl.getType().getText(),
    description: jsDocs?.[0]?.getDescription() ?? '',
    params: extractParams(decl),
    returns: extractReturns(decl),
    examples: extractExamples(jsDocs),
  })
}
```

The output groups symbols by module (`directive` vs. `directive/ai`) and sorts alphabetically within each group. The current extraction produces over 400 entries &ndash; 128 functions, 187 interfaces, 80 type aliases, and more &ndash; with over 100 entries carrying runnable `@example` blocks.

Adding `pnpm build:api-docs` to the deploy sequence keeps the reference in sync with the source code. When a contributor adds JSDoc to an exported function, the chatbot automatically learns about it on the next deploy.

---

## RAG retrieval

When a user sends a question, `createRAGEnricher` embeds the query with the same model, searches the JSON file by cosine similarity, and returns the top-matching chunks. But raw similarity isn't always enough &ndash; a question about `createModule`'s parameters should prioritize API reference chunks, while a conceptual question about constraint design should prioritize guide pages.

The route handler classifies each query as `"api"` or `"conceptual"` using a zero-cost regex check, then re-ranks the results:

```typescript
// Classify intent (regex-based, zero runtime cost)
const intent = classifyIntent(message) // "api" | "conceptual"

// Over-fetch top 7 chunks
const matches = await enricher.retrieve(message, 7)

// Re-rank with source-type boost
const ranked = matches.map((chunk) => {
  let boost = 0
  if (intent === 'api' && chunk.metadata.sourceType === 'api-reference') boost += 0.1
  if (intent === 'conceptual' && chunk.metadata.sourceType === 'guide') boost += 0.05
  if (safePath && chunk.metadata.url?.startsWith(safePath)) boost += 0.05

  return { ...chunk, boostedScore: chunk.similarity + boost }
})

// Diversity cap: max 2 chunks per symbolName, take top 5
```

The re-ranking ensures that asking "what does `system.inspect()` return?" surfaces the generated API reference entry (with the exact return type from the source code), while asking "how do constraints work?" surfaces the hand-written guide page (with conceptual explanations and diagrams). The diversity cap prevents any single symbol from dominating all five context slots.

If enrichment fails or times out (5-second cap), the raw message is used as a fallback.

---

## SSE streaming

`createSSETransport` wraps the orchestrator's token stream into Server-Sent Events. Five event types flow over the wire:

| Event | Purpose |
|-------|---------|
| `text` | Incremental token content |
| `truncated` | Final tokens when response hits the character limit |
| `done` | Stream complete |
| `error` | Error with user-facing message |
| `heartbeat` | Connection keep-alive (when enabled) |

The transport maps error codes to friendly messages and handles response truncation at 3,000 characters.

---

## Version one: imperative server state

The first version of the chatbot tracked rate limits with a raw `Map`:

```typescript
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

function evictExpired() {
  const now = Date.now()
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(ip)
  }
}

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW })
    if (rateLimitMap.size > MAX_RATE_LIMIT_ENTRIES) evictExpired()

    return false
  }

  entry.count++

  return entry.count > MAX_REQUESTS_PER_WINDOW
}
```

This worked, but it had blind spots. Token usage wasn't tracked server-side. Error streaks were invisible. There was no connection between the AI adapter's lifecycle events and the server state. The AI adapter was fully configured, but the operational state around it was imperative code with no observability.

---

## Version two: Directive module

The refactored version wraps the same state in a `createModule`:

```typescript
const docsChatbot = createModule('docs-chatbot', {
  schema: {
    facts: {
      requestCounts: t.object<Record<string, RateLimitEntry>>(), // { count: number; resetAt: number }
      dailyCounts: t.object<Record<string, DailyCapEntry>>(),
      totalRequests: t.number(),
      totalTokensUsed: t.number(),
      consecutiveErrors: t.number(),
      lastErrorAt: t.number(),
    },
    derivations: {
      isHealthy: t.boolean(),
      tokenBudgetPercent: t.number(),
      isOverBudget: t.boolean(),
      activeIPs: t.number(),
    },
    events: {
      incomingRequest: { ip: t.string() },
      requestCompleted: { tokens: t.number() },
      requestFailed: {},
      evictExpired: {},
    },
    requirements: { LOG_BUDGET_WARNING: {} },
  },

  init: (facts) => {
    facts.requestCounts = {}
    facts.dailyCounts = {}
    facts.totalRequests = 0
    facts.totalTokensUsed = 0
    facts.consecutiveErrors = 0
    facts.lastErrorAt = 0
  },

  derive: {
    isHealthy: (facts) =>
      facts.consecutiveErrors < 5 && facts.totalTokensUsed < DAILY_TOKEN_BUDGET,
    tokenBudgetPercent: (facts) =>
      (facts.totalTokensUsed / DAILY_TOKEN_BUDGET) * 100,
    isOverBudget: (facts) =>
      facts.totalTokensUsed >= DAILY_TOKEN_BUDGET,
    activeIPs: (facts) =>
      Object.keys(facts.requestCounts).length,
  },

  events: {
    incomingRequest: (facts, { ip }) => {
      const now = Date.now()
      const counts = { ...facts.requestCounts }
      const entry = counts[ip]

      if (!entry || now > entry.resetAt) {
        counts[ip] = { count: 1, resetAt: now + RATE_LIMIT_WINDOW }
      } else {
        counts[ip] = { ...entry, count: entry.count + 1 }
      }

      facts.requestCounts = counts
      facts.totalRequests += 1
    },

    requestCompleted: (facts, { tokens }) => {
      facts.totalTokensUsed += tokens
      facts.consecutiveErrors = 0
    },

    requestFailed: (facts) => {
      facts.consecutiveErrors += 1
      facts.lastErrorAt = Date.now()
    },
  },

  constraints: {
    budgetExceeded: {
      when: (facts) => facts.totalTokensUsed >= DAILY_TOKEN_BUDGET,
      require: { type: 'LOG_BUDGET_WARNING' },
    },
  },

  resolvers: {
    logBudgetWarning: {
      requirement: 'LOG_BUDGET_WARNING',
      resolve: async (req, context) => {
        console.warn(
          `[docs-chatbot] Daily token budget exceeded: ${context.facts.totalTokensUsed} tokens`,
        )
      },
    },
  },

  effects: {
    logMetrics: {
      deps: ['totalRequests', 'totalTokensUsed', 'consecutiveErrors'],
      run: (facts) => {
        if (facts.totalRequests > 0) {
          console.log(
            `[docs-chatbot] requests=${facts.totalRequests} tokens=${facts.totalTokensUsed} errors=${facts.consecutiveErrors}`,
          )
        }
      },
    },
  },
})
```

The route handler dispatches events instead of mutating a `Map`:

```typescript
chatbotSystem.events.incomingRequest({ ip })

const entry = chatbotSystem.facts.requestCounts[ip]
if (entry && entry.count > MAX_REQUESTS_PER_WINDOW) {
  return new Response(/* 429 */)
}

if (!chatbotSystem.derive.isHealthy) {
  return new Response(/* 503 */)
}
```

The orchestrator's lifecycle hooks feed data back to the module:

```typescript
hooks: {
  onAgentComplete: ({ tokenUsage }) => {
    chatbotSystem.events.requestCompleted({ tokens: tokenUsage })
  },
  onAgentError: () => {
    chatbotSystem.events.requestFailed()
  },
}
```

An effect logs metrics in development. A constraint fires when the daily token budget is exceeded.

---

## How the core module and AI adapter compose

The chatbot has two Directive layers that compose through lifecycle hooks:

**Core module** (server-side operational state): Tracks per-IP request counts, cumulative token usage, error streaks, and system health. Runs as a singleton `createSystem` in the server process. Provides derivations like `isHealthy` and `isOverBudget` that the route handler reads synchronously.

**AI adapter orchestrator** (agent-level safety): Runs prompt injection detection, PII redaction, circuit breaking, and rate limiting on every agent call. Manages the streaming token pipeline. Enforces per-call token budgets.

The module tracks cumulative metrics. The orchestrator protects individual runs. They communicate via `hooks`: when the orchestrator completes an agent run, it dispatches `requestCompleted` to the module; when it fails, it dispatches `requestFailed`. The module's derived `isHealthy` state can short-circuit the request before the orchestrator is even invoked.

---

## Full route handler

Here's the complete Next.js API route. The module, orchestrator, enricher, and transport are all singletons initialized once per server process:

```typescript
// app/api/chat/route.ts
import { NextRequest } from 'next/server'
import path from 'node:path'
import {
  createAgentOrchestrator,
  createAgentMemory,
  createCircuitBreaker,
  createPromptInjectionGuardrail,
  createEnhancedPIIGuardrail,
  createRAGEnricher,
  createJSONFileStore,
  createSSETransport,
  createLengthGuardrail,
  withRetry,
  withFallback,
  withBudget,
} from '@directive-run/ai'
import { createAnthropicRunner, createAnthropicStreamingRunner } from '@directive-run/ai/anthropic'
import { createOpenAIRunner, createOpenAIEmbedder } from '@directive-run/ai/openai'
import { createSystem } from '@directive-run/core'
import { docsChatbot, MAX_REQUESTS_PER_WINDOW, DAILY_CAP_PER_IP } from './module'

// ── Singletons ──────────────────────────────────────────────

const chatbotSystem = createSystem({ module: docsChatbot })
chatbotSystem.start()

const enricher = createRAGEnricher({
  embedder: createOpenAIEmbedder({ apiKey: process.env.OPENAI_API_KEY! }),
  storage: createJSONFileStore({
    filePath: path.join(process.cwd(), 'public', 'embeddings.json'),
  }),
})

const transport = createSSETransport({
  maxResponseChars: 3_000,
  errorMessages: {
    INPUT_GUARDRAIL_FAILED:
      'Your message was flagged by our safety filter. Please rephrase your question.',
  },
})

// OpenAI fallback runner (only created if API key is available)
const openaiKey = process.env.OPENAI_API_KEY
const haikuPricing = { inputPerMillion: 0.8, outputPerMillion: 4 }

// Compose resilience middleware on the runner
let runner = createAnthropicRunner({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: 'claude-haiku-4-5-20251001',
  maxTokens: 2000,
})

// Retry 429/503 with exponential backoff (never retries 400/401/403)
runner = withRetry(runner, { maxRetries: 2, baseDelayMs: 1_000, maxDelayMs: 10_000 })

// Fall back to OpenAI when Anthropic is unavailable
if (openaiKey) {
  const openaiRunner = createOpenAIRunner({ apiKey: openaiKey, model: 'gpt-4o-mini' })
  runner = withFallback([runner, openaiRunner])
}

// Cap hourly and daily spend using Haiku pricing
runner = withBudget(runner, {
  budgets: [
    { window: 'hour', maxCost: 5.00, pricing: haikuPricing },
    { window: 'day', maxCost: 50.00, pricing: haikuPricing },
  ],
})

const streamingRunner = createAnthropicStreamingRunner({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: 'claude-haiku-4-5-20251001',
  maxTokens: 2000,
})

const docsQaAgent = { name: 'directive-docs-qa', instructions: SYSTEM_PROMPT }

const orchestrator = createAgentOrchestrator({
  runner,
  guardrails: {
    input: [
      createPromptInjectionGuardrail({ strictMode: true }),
      createEnhancedPIIGuardrail({ redact: true }),
    ],
    output: [createLengthGuardrail({ maxCharacters: 3_000 })],
  },
  memory: createAgentMemory({ maxMessages: 20 }),
  circuitBreaker: createCircuitBreaker({ failureThreshold: 3, recoveryTimeMs: 30_000 }),
  maxTokenBudget: 2000,

  hooks: {
    onAgentComplete: ({ tokenUsage }) => {
      chatbotSystem.events.requestCompleted({ tokens: tokenUsage })
    },
    onAgentError: () => {
      chatbotSystem.events.requestFailed()
    },
  },
})

// ── Route handler ───────────────────────────────────────────

export async function POST(request: NextRequest) {
  // 1. Track request in the Directive module
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  chatbotSystem.events.incomingRequest({ ip })

  // 2. Rate limit + health gate (read directly from module state)
  const entry = chatbotSystem.facts.requestCounts[ip]
  if (entry && entry.count > MAX_REQUESTS_PER_WINDOW) {
    return new Response(JSON.stringify({ error: 'Too many requests.' }), { status: 429 })
  }

  if (!chatbotSystem.derive.isHealthy) {
    return new Response(JSON.stringify({ error: 'Service temporarily unavailable.' }), { status: 503 })
  }

  // 3. Parse and validate input
  const { message, history = [], pageUrl } = await request.json()
  if (!message || typeof message !== 'string' || message.length > 2000) {
    return new Response(JSON.stringify({ error: 'Invalid message.' }), { status: 400 })
  }

  // 4. RAG enrichment with intent-aware re-ranking (5s timeout fallback)
  const intent = classifyIntent(message) // "api" | "conceptual"
  let enrichedInput = message
  try {
    const matches = await Promise.race([
      enricher.retrieve(message, 7),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 5_000),
      ),
    ])
    // Re-rank: boost API chunks for API queries, guide chunks for conceptual queries
    const ranked = matches
      .map((chunk) => {
        let boost = 0
        if (intent === 'api' && chunk.metadata.sourceType === 'api-reference') boost += 0.1
        if (intent === 'conceptual' && chunk.metadata.sourceType === 'guide') boost += 0.05
        return { ...chunk, boostedScore: chunk.similarity + boost }
      })
      .sort((a, b) => b.boostedScore - a.boostedScore)
      .slice(0, 5)
    enrichedInput = formatEnrichedInput(ranked, message, history, pageUrl)
  } catch {
    // Fall back to raw message
  }

  // 5. Stream the response via the SSE transport
  const dailyRemaining = Math.max(0, DAILY_CAP_PER_IP - (chatbotSystem.facts.dailyCounts[ip]?.count ?? 0))
  const stream = streamingRunner(docsQaAgent, enrichedInput, { signal: request.signal })
  const sseResponse = transport.toResponse(stream)

  sseResponse.headers.set('X-Daily-Remaining', String(dailyRemaining))

  return sseResponse
}
```

Five numbered comments, five phases &ndash; the same flow as the diagram below, in runnable code.

---

## Request lifecycle

Here's the full path a message takes, from the user clicking "Send" to the streamed response appearing in the widget:

```
CLIENT (AIChatWidget)
  │
  │  POST /api/chat { message, history, pageUrl }
  │
  ▼
SERVER (Next.js API Route)
  │
  ├─ Origin check ··········· 403
  ├─ Directive module event
  ├─ Rate limit ············· 429
  ├─ Daily cap ·············· 429
  ├─ Health gate ············ 503
  ├─ Input validation ······· 400
  │
  ▼
RAG Enricher
  │
  ├─ Classify intent (api / conceptual)
  ├─ Embed query (OpenAI)
  ├─ Cosine similarity search (top 7)
  ├─ Re-rank with source-type boost
  ├─ Diversity cap + top 5
  ├─ Assemble enriched input
  ├─ 5s timeout fallback
  │
  ▼
Agent Orchestrator + Middleware
  │
  ├─ Input guardrails
  │   ├─ Prompt injection
  │   └─ PII redaction
  ├─ Cost budget guard ($5/hr, $50/day)
  ├─ Intelligent retry (429/503 → backoff)
  ├─ Provider fallback (Anthropic → OpenAI)
  ├─ Circuit breaker (3 fails → open)
  ├─ Streaming LLM (Claude Haiku 4.5)
  │
  ▼
SSE Transport
  │
  ├─ Token → data: frame
  ├─ Truncation at 3k chars
  ├─ done / error event
  │
  ▼
CLIENT (response stream)
  │
  ├─ SSE reader + markdown renderer
  ├─ X-Daily-Remaining header
  │
  ▼
Post-Response Hooks
  │
  ├─ onAgentComplete → requestCompleted event
  └─ onAgentError → requestFailed event
```

### Validation and gating

The route handler runs five checks before touching the AI orchestrator. Origin validation rejects unknown domains. The Directive module tracks per-IP request counts (10 per 60 seconds) and daily caps (25 questions/day, configurable). The `isHealthy` derivation short-circuits with a `503` when consecutive errors exceed 5 or the daily token budget is exhausted.

### RAG and agent execution

The enricher classifies the query intent (API vs. conceptual), embeds the query, over-fetches the top 7 chunks by cosine similarity, re-ranks with source-type boosting, caps diversity at 2 chunks per symbol, and assembles the enriched input with page context and conversation history. If the embedding API is slow, a 5-second timeout falls back to the raw message.

The enriched input passes through prompt injection detection and PII redaction before reaching Claude Haiku 4.5. The circuit breaker adds a second layer of protection beyond the per-IP limits.

### Streaming and post-response

`createSSETransport` frames each token as an SSE `data:` line, truncates at 3,000 characters, and propagates the client's `AbortSignal` all the way to the LLM call &ndash; no orphaned connections when users navigate away.

After the stream completes, lifecycle hooks feed metrics back to the Directive module: `onAgentComplete` dispatches `requestCompleted` (updating token usage), and `onAgentError` dispatches `requestFailed` (updating health state). The `tokenBudgetPercent` and `isHealthy` derivations recompute automatically.

The entire round-trip &ndash; from user click to first visible token &ndash; typically completes in under 2 seconds. The latency comes from two network hops: the OpenAI embedding call and the Anthropic streaming call. Everything else is synchronous and sub-millisecond.

---

## Getting started

Install Directive and configure the required API keys:

```bash
pnpm add @directive-run/core
```

```bash
# .env.local (make sure this file is in your .gitignore)
OPENAI_API_KEY=sk-...        # Embeddings + RAG query
ANTHROPIC_API_KEY=sk-ant-...  # Chat response generation
```

Generate the API reference and embeddings before building the site:

```bash
pnpm build:api-docs     # ts-morph extracts JSDoc → JSON + Markdown
pnpm build:embeddings   # Embeds docs + API reference → public/embeddings.json
pnpm build              # Next.js site build
```

See the [AI & Agents docs](/ai/overview) for the full AI adapter API, [SSE Transport](/ai/sse-transport) for streaming setup, and [RAG Enricher](/ai/rag) for the embedding pipeline.
