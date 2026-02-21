---
title: SSE Transport
description: Wrap a Directive streaming source into an HTTP Server-Sent Events response with truncation, heartbeat, error mapping, and abort signal propagation.
---

Turn any streamable source into a Server-Sent Events HTTP response. {% .lead %}

---

## Overview

`createSSETransport` converts token streams into a standard SSE byte stream. It accepts any object implementing the `SSEStreamable` interface (an object with a `.stream()` method). It works with any WinterCG-compatible runtime (Node 18+, Deno, Bun, Cloudflare Workers, Next.js App Router).

```typescript
import { createSSETransport, createStreamingRunner, createAgentOrchestrator } from '@directive-run/ai';

const transport = createSSETransport({
  maxResponseChars: 10_000,
  heartbeatIntervalMs: 15_000,
  errorMessages: {
    INPUT_GUARDRAIL_FAILED: 'Your message was flagged by our safety filter.',
  },
});

// Create a streamable wrapper that SSE transport can use
const streamRunner = createStreamingRunner(myStreamingCallbackRunner);

const docsAgent = {
  name: 'docs-qa',
  instructions: 'Answer questions using the provided documentation context.',
  model: 'claude-sonnet-4-5-20250929',
};

// SSE transport accepts any SSEStreamable – an object with a .stream(agentOrInput, input?) method
const streamable = {
  stream: (input: string) => streamRunner(docsAgent, input),
};

// Next.js route handler
export async function POST(request: Request) {
  const { message } = await request.json();

  return transport.toResponse(streamable, message);
}
```

---

## API

### `createSSETransport(config?)`

Returns an `SSETransport` with two methods: `toResponse()` and `toStream()`.

#### `SSETransportConfig`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `maxResponseChars` | `number` | `Infinity` | Truncate the response after this many characters |
| `truncationMessage` | `string` | `'\n\n*[Response truncated]*'` | Text appended when truncation occurs |
| `heartbeatIntervalMs` | `number` | `0` (disabled) | Send a heartbeat event at this interval to keep the connection alive |
| `errorMessages` | `Record<string, string> \| (error) => string` | – | Map error codes to user-facing messages, or provide a function |
| `headers` | `Record<string, string>` | – | Extra headers merged into the SSE response |

#### `SSEEvent`

The transport emits a discriminated union of five event types. Import for client-side type safety:

```typescript
import type { SSEEvent } from '@directive-run/ai';
```

```typescript
type SSEEvent =
  | { type: 'text'; text: string }
  | { type: 'truncated'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'heartbeat'; timestamp: number };
```

### `toResponse(streamable, input, opts?)`

Creates a full `Response` object with SSE headers (`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`). Pass it directly as the return value from a route handler.

```typescript
export async function POST(request: Request) {
  const { message } = await request.json();

  return transport.toResponse(streamable, message);
}
```

### `toStream(streamable, input, opts?)`

Returns just the `ReadableStream<Uint8Array>` for frameworks like Express or Koa where you pipe the stream into `res.write()` manually.

```typescript
app.post('/api/chat', async (req, res) => {
  const stream = transport.toStream(streamable, req.body.message);
  const reader = stream.getReader();
  res.setHeader('Content-Type', 'text/event-stream');

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
});
```

Both methods accept an optional `{ signal?: AbortSignal }` for cancellation.

---

## SSE Event Types

Each SSE frame is a JSON-encoded `data:` line. Clients parse the `type` discriminant to handle each event:

| Type | Fields | When |
|------|--------|------|
| `text` | `text: string` | Each token from the agent stream |
| `truncated` | `text: string` | The response exceeded `maxResponseChars` and was cut short |
| `done` | – | The stream completed successfully |
| `error` | `message: string` | An error occurred (message is user-facing) |
| `heartbeat` | `timestamp: number` | Keep-alive ping at the configured interval (Unix ms) |

### Client-side parsing

Since the transport uses `data:` framing with custom JSON event types (not named SSE events), use `fetch` with a streaming reader rather than `EventSource`. `EventSource` only supports GET requests and expects standard SSE `event:` fields, which this transport does not use.

```typescript
const res = await fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message }),
});

if (!res.ok) {
  // Handle HTTP errors (429, 400, etc.) before parsing SSE
  const err = await res.json();
  showError(err.error);

  return;
}

const reader = res.body!.getReader();
const decoder = new TextDecoder();
let buffer = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  // Append new bytes – a single SSE frame may split across two reads
  buffer += decoder.decode(value, { stream: true });

  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';  // Retain the incomplete trailing line

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    if (!data) continue;

    const event = JSON.parse(data);

    switch (event.type) {
      case 'text':
        appendToUI(event.text);
        break;
      case 'truncated':
        appendToUI(event.text);  // Show truncation notice
        break;
      case 'done':
        finishStream();
        break;
      case 'error':
        showError(event.message);
        break;
      case 'heartbeat':
        // Connection is alive, no action needed
        break;
    }
  }
}
```

{% callout type="warning" title="Buffering is required" %}
A single SSE frame can split across two `reader.read()` calls. Always retain the incomplete trailing line in a buffer (as shown above) rather than splitting on `'\n'` and parsing every fragment. Without buffering, `JSON.parse` will throw on partial frames.
{% /callout %}

---

## Error Mapping

Map internal error codes to user-friendly messages. Pass a record of code-to-message pairs, or a function for full control:

```typescript
// Record-based mapping
const transport = createSSETransport({
  errorMessages: {
    INPUT_GUARDRAIL_FAILED: 'Your message was flagged by our safety filter.',
    RATE_LIMIT_EXCEEDED: 'Too many requests. Please wait a moment.',
    CIRCUIT_OPEN: 'The service is temporarily unavailable.',
  },
});

// Function-based mapping
const transport = createSSETransport({
  errorMessages: (error) => {
    if (error instanceof RateLimitError) {
      return 'Slow down, please.';
    }

    return 'Something went wrong. Please try again.';
  },
});
```

When an error has a `code` property that matches a key in the record, that message is sent. Otherwise the default message is used: "AI service temporarily unavailable. Please try again."

{% callout type="warning" title="Throwing error mappers" %}
If a function-based `errorMessages` mapper throws, the transport catches the exception and falls back to the default error message. This prevents a broken mapper from crashing the SSE stream.
{% /callout %}

---

## Truncation

Protect against runaway responses by capping the total character count:

```typescript
const transport = createSSETransport({
  maxResponseChars: 8_000,
  truncationMessage: '\n\n---\n*Response limit reached.*',
});
```

When the limit is hit, the transport sends the truncation message as a `truncated` event, sends a `done` event, and aborts the underlying token stream. The final stream `result` is still awaited to ensure metrics and token counts are recorded.

{% callout type="note" title="Truncation sizing" %}
The `truncationMessage` length is **not** counted against `maxResponseChars`. Suggested values:

| Use case | `maxResponseChars` |
|---|---|
| Chat widget | 8,000–12,000 |
| Docs Q&A | 15,000–25,000 |
| Summarization | 3,000–5,000 |
{% /callout %}

---

## Heartbeat

Long-running responses can be dropped by proxies and load balancers that enforce idle timeouts. Enable heartbeat to send periodic keep-alive events:

```typescript
const transport = createSSETransport({
  heartbeatIntervalMs: 15_000,  // Send a heartbeat every 15 seconds
});
```

Heartbeat events are `{ type: "heartbeat", timestamp: 1707836400000 }` where `timestamp` is Unix milliseconds (`Date.now()`). The timer is cleaned up automatically when the stream closes or errors.

{% callout type="note" title="Proxy idle timeouts" %}
Most reverse proxies enforce idle-connection timeouts: nginx defaults to 60s, AWS ALB to 60s, and Cloudflare to 100s. Set `heartbeatIntervalMs` to 15,000–25,000 ms to stay well within these limits.
{% /callout %}

---

## Abort Signal Propagation

Pass an `AbortSignal` to cancel the stream from the server side. This is useful for tying the stream lifetime to the HTTP request:

```typescript
export async function POST(request: Request) {
  const { message } = await request.json();

  return transport.toResponse(streamable, message, {
    signal: request.signal,  // Cancels the agent stream if the client disconnects
  });
}
```

The signal is forwarded to the streaming runner, which aborts the underlying LLM call.

---

## `createAnthropicStreamingRunner`

A built-in streaming runner that calls the Anthropic Messages API with server-sent events. It is re-exported from the `@directive-run/ai` entry point (and also available from `@directive-run/ai/anthropic`). Pair it with the SSE transport for an end-to-end Anthropic streaming pipeline.

```typescript
import {
  createAnthropicRunner,
  createAnthropicStreamingRunner,
} from '@directive-run/ai/anthropic';
import { createStreamingRunner } from '@directive-run/ai';

const anthropicStreamingRunner = createAnthropicStreamingRunner({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: 'claude-sonnet-4-5-20250929',
  maxTokens: 4096,
});

const streamRunner = createStreamingRunner(anthropicStreamingRunner);

const chatAgent = { name: 'chat', instructions: 'You are helpful.', model: 'claude-sonnet-4-5-20250929' };

// Create a streamable wrapper for SSE transport
const streamable = {
  stream: (input: string) => streamRunner(chatAgent, input),
};
```

### `AnthropicStreamingRunnerOptions`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `apiKey` | `string` | *required* | Anthropic API key |
| `model` | `string` | `'claude-sonnet-4-5-20250929'` | Default model (overridden by `agent.model`) |
| `maxTokens` | `number` | `4096` | Maximum tokens to generate |
| `baseURL` | `string` | `'https://api.anthropic.com/v1'` | API base URL |
| `fetch` | `typeof fetch` | `globalThis.fetch` | Custom fetch implementation |

The runner reads each SSE event from the Anthropic API, emits tokens via `callbacks.onToken()`, tracks input/output token counts from `message_start` and `message_delta` events, and returns the assembled result.

---

## Full Example: Next.js Route Handler

A complete Next.js App Router endpoint combining [RAG enrichment](/docs/ai/rag), SSE transport, and a streaming runner:

```typescript
// app/api/chat/route.ts
import {
  createAnthropicRunner,
  createAnthropicStreamingRunner,
} from '@directive-run/ai/anthropic';
import { createOpenAIEmbedder } from '@directive-run/ai/openai';
import {
  createStreamingRunner,
  createRAGEnricher,
  createJSONFileStore,
  createSSETransport,
} from '@directive-run/ai';

const apiKey = process.env.ANTHROPIC_API_KEY!;

const enricher = createRAGEnricher({
  embedder: createOpenAIEmbedder({ apiKey: process.env.OPENAI_API_KEY! }),
  storage: createJSONFileStore({ filePath: './embeddings.json' }),
  topK: 5,
  minSimilarity: 0.3,
});

const docsAgent = {
  name: 'docs-qa',
  instructions: 'Answer questions using the provided documentation context.',
  model: 'claude-sonnet-4-5-20250929',
};

const streamRunner = createStreamingRunner(
  createAnthropicStreamingRunner({ apiKey }),
);

// SSE transport accepts any SSEStreamable
const streamable = {
  stream: (input: string) => streamRunner(docsAgent, input),
};

const transport = createSSETransport({
  maxResponseChars: 10_000,
  heartbeatIntervalMs: 15_000,
  errorMessages: {
    INPUT_GUARDRAIL_FAILED: 'Your message was flagged by our safety filter.',
  },
});

export async function POST(request: Request) {
  const { message, history } = await request.json();

  const enrichedInput = await enricher.enrich(message, {
    history,
    filter: (chunk) => chunk.metadata.type === 'docs',
  });

  return transport.toResponse(streamable, enrichedInput, {
    signal: request.signal,
  });
}
```

---

## Multi-Agent + SSE

Route SSE streams from a multi-agent orchestrator by agent ID. Each agent streams through the same transport:

```typescript
import { createMultiAgentOrchestrator, createStreamingRunner, createSSETransport } from '@directive-run/ai';
import { createAnthropicRunner, createAnthropicStreamingRunner } from '@directive-run/ai/anthropic';

const apiKey = process.env.ANTHROPIC_API_KEY!;

const researcher = { name: 'researcher', instructions: 'Research topics.', model: 'claude-sonnet-4-5-20250929' };
const writer = { name: 'writer', instructions: 'Write articles.', model: 'claude-sonnet-4-5-20250929' };

const streamRunner = createStreamingRunner(
  createAnthropicStreamingRunner({ apiKey }),
);

const orchestrator = createMultiAgentOrchestrator({
  runner: createAnthropicRunner({ apiKey }),
  agents: {
    researcher: { agent: researcher },
    writer: { agent: writer },
  },
});

const agentMap: Record<string, typeof researcher> = { researcher, writer };

const transport = createSSETransport({
  maxResponseChars: 10_000,
  heartbeatIntervalMs: 15_000,
});

// Route requests to the correct agent via a body field
export async function POST(request: Request) {
  const { message, agentId } = await request.json();
  const agentDef = agentMap[agentId];
  if (!agentDef) {
    return new Response(JSON.stringify({ error: `Unknown agent: ${agentId}` }), { status: 400 });
  }

  const streamable = {
    stream: (input: string) => streamRunner(agentDef, input),
  };

  return transport.toResponse(streamable, message, { signal: request.signal });
}
```

---

## Next Steps

- [RAG Enricher](/docs/ai/rag) – Retrieval-augmented generation pipeline
- [Agent Orchestrator](/docs/ai/orchestrator) – Full orchestrator API
- [Multi-Agent](/docs/ai/multi-agent) – Parallel, sequential, and supervisor patterns
- [Streaming](/docs/ai/streaming) – Token streaming, backpressure, and stream operators
- [Guardrails](/docs/ai/guardrails) – Input/output validation and safety
