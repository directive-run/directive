---
title: "Building an AI Docs Chatbot with Directive"
description: How the AI adapter and the core runtime work together to power a RAG-backed docs chatbot with streaming, guardrails, and reactive server-side state.
layout: blog
date: 2026-02-12
dateModified: 2026-02-12
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
  → Agent Stack       (guardrails, circuit breaker, streaming runner)
  → SSE Transport     (tokens → Server-Sent Events frames)
  → Browser Widget    (parse SSE, render markdown)
```

The first three stages use Directive's AI adapter (`directive/ai`). The server-side operational state &ndash; request counting, token budget tracking, health monitoring &ndash; uses the core Directive runtime (`createModule`, `createSystem`).

---

## What the AI adapter handles

The `createAgentStack` configures the agent-level protection layer:

```typescript
const stack = createAgentStack({
  runner,
  streaming: { runner: streamingRunner },
  agents: {
    'docs-qa': {
      agent: { name: 'directive-docs-qa', instructions: BASE_INSTRUCTIONS },
      capabilities: ['question-answering', 'code-examples'],
    },
  },
  guardrails: {
    input: [
      createPromptInjectionGuardrail({ strictMode: true }),
      createEnhancedPIIGuardrail({ redact: true }),
    ],
    output: [
      createLengthGuardrail({ maxCharacters: 3_000 }),
    ],
  },
  memory: { maxMessages: 20 },
  circuitBreaker: { failureThreshold: 3, recoveryTimeMs: 30_000 },
  rateLimit: { maxPerMinute: 30 },
  maxTokenBudget: 2000,
})
```

Every message passes through prompt injection detection and PII redaction before reaching the LLM. The circuit breaker trips after three consecutive failures and recovers after 30 seconds. The rate limiter caps throughput at 30 requests per minute across all users.

---

## The embedding pipeline

At build time, a script walks every Markdoc doc page, splits each page into sections (by heading), chunks sections into 200&ndash;400 token pieces, and embeds them via OpenAI's `text-embedding-3-small`. The result is a JSON file of chunks with their vectors, stored in `public/embeddings.json`.

```text
Markdoc pages → parse AST → extract sections → chunk → embed → JSON
```

This runs once per deploy. The embeddings file ships as a static asset alongside the site.

---

## RAG retrieval

When a user sends a question, `createRAGEnricher` embeds the query with the same model, searches the JSON file by cosine similarity, and prepends the top-matching chunks to the prompt:

```typescript
const enricher = createRAGEnricher({
  embedder: createOpenAIEmbedder({ apiKey: openaiKey }),
  storage: createJSONFileStore({
    filePath: path.join(process.cwd(), 'public', 'embeddings.json'),
  }),
})

const enrichedInput = await enricher.enrich(userMessage, {
  prefix: `The user is viewing: ${currentPage}`,
  history,
})
```

The enriched input includes the retrieved doc context, conversation history, and the original question. If enrichment fails or times out (5-second cap), the raw message is used as a fallback.

---

## SSE streaming

`createSSETransport` wraps the agent stack's token stream into Server-Sent Events. Five event types flow over the wire:

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

This worked, but it had blind spots. Token usage wasn't tracked server-side. Error streaks were invisible. There was no connection between the agent stack's lifecycle events and the server state. The AI adapter was fully configured, but the operational state around it was imperative code with no observability.

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
  // events, constraints, resolvers, effects...
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

The agent stack's lifecycle hooks feed data back to the module:

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

**AI adapter stack** (agent-level safety): Runs prompt injection detection, PII redaction, circuit breaking, and rate limiting on every agent call. Manages the streaming token pipeline. Enforces per-call token budgets.

The module tracks cumulative metrics. The stack protects individual runs. They communicate via `hooks`: when the stack completes an agent run, it dispatches `requestCompleted` to the module; when it fails, it dispatches `requestFailed`. The module's derived `isHealthy` state can short-circuit the request before the stack is even invoked.

---

## Complete request lifecycle

Here's the full path a single chat message takes, from the user clicking "Send" to the streamed response appearing in the widget. Every numbered step maps to real code in the production chatbot.

### Client side: building the request

**Step 1 &ndash; User submits a question.** The `AIChatWidget` component captures the message text and the current page URL (e.g. `/docs/constraints`).

**Step 2 &ndash; History assembly.** The widget collects the last 20 messages from the conversation state (alternating user/assistant pairs) to send as context.

**Step 3 &ndash; POST to `/api/chat`.** The widget sends a `fetch` request with `{ message, history, pageUrl }` as JSON. The `AbortController` from the widget is attached so the user can cancel mid-stream.

### Server side: validation and rate limiting

**Step 4 &ndash; Origin validation.** The route handler checks the `Origin` header against an allowlist (`directive.run` + `localhost`). Requests from unknown origins get a `403`.

**Step 5 &ndash; Directive module event.** `chatbotSystem.events.incomingRequest({ ip })` fires. The module's `incomingRequest` event handler increments the per-IP request count and the global `totalRequests` counter.

**Step 6 &ndash; Sliding-window rate limit.** The handler reads `chatbotSystem.facts.requestCounts[ip]` and checks the count against `MAX_REQUESTS_PER_WINDOW` (10 requests per 60 seconds). Exceeding the limit returns a `429`.

**Step 7 &ndash; Daily cap check.** A separate counter tracks per-IP daily usage. When the cap is reached (25 questions/day), the widget shows a friendly "come back tomorrow" message. The cap can be disabled via `DISABLE_DAILY_CAP=true` for development.

**Step 8 &ndash; Health gate.** `chatbotSystem.derive.isHealthy` is a derivation that returns `false` when consecutive errors exceed 5 or the daily token budget is exhausted. If unhealthy, the route returns a `503` before touching the AI stack.

**Step 9 &ndash; Input validation.** The message is trimmed and checked: must be a non-empty string under 2,000 characters. History entries are validated individually &ndash; only valid `{ role, content }` pairs with content under 2,000 characters pass through.

### RAG enrichment

**Step 10 &ndash; Embed the query.** `createRAGEnricher` sends the user's question to OpenAI's `text-embedding-3-small` model to get a 1536-dimension vector.

**Step 11 &ndash; Cosine similarity search.** The enricher loads `public/embeddings.json` (generated at build time from all doc pages), computes cosine similarity between the query vector and every chunk vector, and selects the top-k most relevant chunks.

**Step 12 &ndash; Assemble enriched input.** The enricher builds a single string:

```text
[Page context] The user is currently viewing: /docs/constraints
[Doc chunks] (top-k relevant documentation sections)
[History] (last 20 messages for conversational continuity)
[Question] How do I use the `after` property?
```

**Step 13 &ndash; Timeout guard.** The enrichment runs inside a `Promise.race` with a 5-second timeout. If the embedding API is slow, the raw message is used as a fallback &ndash; the chatbot still works, just without RAG context.

### Agent stack execution

**Step 14 &ndash; Input guardrails.** The enriched input passes through two guardrails before reaching the LLM:
- **Prompt injection detection** (`createPromptInjectionGuardrail`): Catches attempts to override the system prompt or extract instructions. In `strictMode`, suspicious inputs are blocked immediately with a user-facing error.
- **PII redaction** (`createEnhancedPIIGuardrail`): Detects and redacts email addresses, phone numbers, SSNs, and other personal information before they reach the model.

If either guardrail fails, the SSE transport sends an `error` event with the mapped message and the stream ends. No LLM call is made.

**Step 15 &ndash; Circuit breaker check.** The agent stack's built-in circuit breaker tracks consecutive failures. After 3 failures, the breaker opens and all requests are rejected for 30 seconds (the recovery window). This prevents cascading failures from a down API.

**Step 16 &ndash; Rate limiter check.** The stack-level rate limiter enforces 30 requests per minute across all users. This is separate from the per-IP limit in Step 6 &ndash; it protects the LLM API from bursts.

**Step 17 &ndash; Streaming LLM call.** `createAnthropicStreamingRunner` sends the enriched input to Claude Haiku 4.5 with `maxTokens: 2000` (the LLM's per-call token limit, separate from the stack's `maxTokenBudget` cap). The system prompt (`BASE_INSTRUCTIONS`) includes the full API reference for Directive to prevent hallucination. The runner returns an `AsyncIterable<string>` of token chunks.

### SSE transport

**Step 18 &ndash; Token framing.** `createSSETransport` reads from the token iterator and writes each chunk as an SSE `data:` frame:

```text
data: {"type":"text","text":"Constraints declare"}

data: {"type":"text","text":" what must be true"}
```

**Step 19 &ndash; Response truncation.** The transport tracks cumulative character count. At 3,000 characters, it sends a `truncated` event with any remaining content and closes the stream. This prevents runaway responses from consuming excessive tokens.

**Step 20 &ndash; Heartbeat (optional).** When `heartbeatIntervalMs` is configured, periodic `heartbeat` events keep the connection alive through proxies and load balancers. The production chatbot disables heartbeats since responses are short-lived.

**Step 21 &ndash; Completion.** When the token iterator is exhausted, the transport sends a `done` event and closes the stream.

**Step 22 &ndash; Abort propagation.** If the user closes the widget or navigates away, the browser aborts the fetch request. The `AbortSignal` propagates through the SSE transport to the streaming runner, which cancels the in-flight API call. No orphaned connections.

### Client side: rendering the response

**Step 23 &ndash; SSE reader.** The widget reads the response body as a `ReadableStream`, parsing each `data:` line. Text events are appended to a growing response string.

**Step 24 &ndash; Inline markdown rendering.** As tokens arrive, the widget renders the accumulated text as markdown with syntax-highlighted code blocks (prism-react-renderer). The rendering updates on every chunk, giving the user a real-time typing effect.

**Step 25 &ndash; Daily remaining update.** The response headers include `X-Daily-Remaining` and `X-Daily-Limit`. The widget reads these to show a "5 questions remaining today" indicator.

### Post-response lifecycle hooks

**Step 26 &ndash; Success hook.** When the stream completes normally, the agent stack fires `onAgentComplete({ tokenUsage })`. This dispatches `chatbotSystem.events.requestCompleted({ tokens })`, which updates `totalTokensUsed` in the Directive module. The `tokenBudgetPercent` derivation recomputes automatically.

**Step 27 &ndash; Error hook.** If the LLM call fails, `onAgentError()` fires instead. This dispatches `chatbotSystem.events.requestFailed()`, incrementing `consecutiveErrors`. If this crosses the threshold, the `isHealthy` derivation flips to `false`, and subsequent requests are short-circuited at Step 8 before touching the AI stack.

### Full flow diagram

```
CLIENT (AIChatWidget)
  │
  │  User types question
  │  Build payload + history
  │  POST /api/chat
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
  ├─ Embed query (OpenAI)
  ├─ Cosine similarity search
  ├─ Assemble enriched input
  ├─ 5s timeout fallback
  │
  ▼
Agent Stack
  │
  ├─ Input guardrails
  │   ├─ Prompt injection
  │   └─ PII redaction
  ├─ Circuit breaker (3 fails → open)
  ├─ Rate limiter (30/min)
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
  ├─ SSE reader
  ├─ Markdown renderer
  ├─ X-Daily-Remaining header
  │
  ▼
Post-Response Hooks
  │
  ├─ onAgentComplete
  │   → requestCompleted event
  │   → update token metrics
  │
  └─ onAgentError
      → requestFailed event
      → update health state
```

The entire round-trip &ndash; from user click to first visible token &ndash; typically completes in under 2 seconds. The bulk of the latency comes from two network hops: the OpenAI embedding call (Step 10) and the Anthropic streaming call (Step 17). The RAG search, guardrail checks, and Directive module operations are all synchronous and sub-millisecond.

---

## Getting started

Install Directive and configure the required API keys:

```bash
pnpm add directive
```

```bash
# .env.local (make sure this file is in your .gitignore)
OPENAI_API_KEY=sk-...        # Embeddings + RAG query
ANTHROPIC_API_KEY=sk-ant-...  # Chat response generation
```

See the [AI & Agents docs](/docs/ai/overview) for the full AI adapter API, [SSE Transport](/docs/ai/sse-transport) for streaming setup, and [RAG Enricher](/docs/ai/rag) for the embedding pipeline.
