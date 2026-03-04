---
title: Stream Agent Responses
description: Stream agent output to the browser in real time with SSE, abort on disconnect, and streaming guardrails.
---

Stream agent output to the browser in real time instead of waiting for the full response. {% .lead %}

---

## The Problem

Your agent takes 15–30 seconds to generate a response. Users see a blank screen, have no way to cancel, and if the connection drops mid-generation the server keeps burning tokens. You need token-by-token streaming with cancellation and safety checks on partial output.

## The Solution

Wrap a provider runner with `createStreamingRunner`, pipe it through `createSSETransport` in a route handler, and read the stream on the client:

```typescript
import {
  createAgentOrchestrator,
  createStreamingRunner,
  createSSETransport,
} from '@directive-run/ai';
import { createAnthropicStreamingRunner } from '@directive-run/ai/anthropic';

const streamingRunner = createStreamingRunner(
  createAnthropicStreamingRunner({ model: 'claude-sonnet-4-5-20250514' })
);

const orchestrator = createAgentOrchestrator({
  runner: streamingRunner,
  autoApproveToolCalls: true,
});

// Next.js route handler
export async function POST(request: Request) {
  const { input } = await request.json();
  const { stream, abort } = orchestrator.runStream('assistant', input, {
    signal: request.signal,
  });

  return createSSETransport(stream).toResponse();
}
```

## How It Works

- **`orchestrator.runStream()`** returns `{ stream, result, abort }`. The `stream` is an `AsyncIterable<StreamChunk>` with 8 chunk types: `text`, `tool_call`, `tool_result`, `thinking`, `error`, `done`, `heartbeat`, and `metadata`.
- **`createSSETransport`** converts the async iterable to a `text/event-stream` response with automatic heartbeats (every 15s), JSON serialization, and error mapping.
- **`signal: request.signal`** cancels the LLM call when the client disconnects – no wasted tokens on abandoned requests.
- **Streaming guardrails** evaluate partial output every N tokens. Use `createLengthStreamingGuardrail` to cap output length and `createPatternStreamingGuardrail` to block dangerous patterns mid-stream.

## Full Example

Server route with streaming guardrails, input validation, and error mapping:

```typescript
import {
  createAgentOrchestrator,
  createStreamingRunner,
  createSSETransport,
  createLengthStreamingGuardrail,
  createPatternStreamingGuardrail,
} from '@directive-run/ai';
import { createAnthropicStreamingRunner } from '@directive-run/ai/anthropic';

const streamingRunner = createStreamingRunner(
  createAnthropicStreamingRunner({ model: 'claude-sonnet-4-5-20250514' })
);

const orchestrator = createAgentOrchestrator({
  runner: streamingRunner,
  autoApproveToolCalls: true,
  streamingGuardrails: [
    createLengthStreamingGuardrail({ maxTokens: 4096 }),
    createPatternStreamingGuardrail({
      patterns: [/\bpassword\b/i, /\bsecret_key\b/i],
      action: 'truncate',
    }),
  ],
});

// POST /api/chat
export async function POST(request: Request) {
  const body = await request.json();
  const input = typeof body.input === 'string' ? body.input.trim() : '';

  if (!input) {
    return new Response(JSON.stringify({ error: 'input required' }), {
      status: 400,
    });
  }

  try {
    const { stream } = orchestrator.runStream('assistant', input, {
      signal: request.signal,
    });

    return createSSETransport(stream, {
      heartbeatMs: 15000,
      onError: (error) => ({
        type: 'error',
        message: error.message.includes('budget')
          ? 'Token limit reached'
          : 'Generation failed',
      }),
    }).toResponse();
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Stream failed' }), {
      status: 500,
    });
  }
}
```

Client consuming the stream with abort support:

```typescript
const controller = new AbortController();

const response = await fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ input: 'Explain quantum computing' }),
  signal: controller.signal,
});

if (!response.body) {
  throw new Error('No response body');
}

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = '';

while (true) {
  const { done, value } = await reader.read();

  if (done) {
    break;
  }

  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';

  for (const line of lines) {
    if (!line.startsWith('data: ')) {
      continue;
    }

    let data;
    try {
      data = JSON.parse(line.slice(6));
    } catch {
      continue; // Skip malformed frames
    }

    if (data.type === 'text') {
      appendToUI(data.content);
    } else if (data.type === 'error') {
      showError(data.message);
    } else if (data.type === 'done') {
      showComplete(data.usage);
    }
  }
}

// Cancel button
cancelButton.onclick = () => controller.abort();
```

{% callout type="note" title="Why not EventSource?" %}
`createSSETransport` uses custom JSON events with metadata and error types. The native `EventSource` API only supports GET requests and plain text events. Use `fetch` with a streaming reader for full control over the request body, headers, and typed events.
{% /callout %}

## Related

- [Streaming reference](/ai/streaming) – `createStreamingRunner` and chunk types
- [SSE Transport reference](/ai/sse-transport) – `createSSETransport` options
- [Guardrails](/ai/guardrails) – streaming guardrail configuration
- [Handle Agent Errors guide](/ai/guides/handle-agent-errors) – retry and fallback for failed streams
- [Control AI Costs guide](/ai/guides/control-ai-costs) – budget limits during streaming
