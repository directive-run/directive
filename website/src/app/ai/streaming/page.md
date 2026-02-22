---
title: Streaming
description: Stream AI agent responses with backpressure, guardrails, and stream operators.
---

Process agent responses token-by-token with real-time guardrails. {% .lead %}

---

## Orchestrator Streaming

The simplest way to stream – use `orchestrator.runStream()` which wraps the agent run with guardrails, approval checks, and state tracking:

```typescript
import { createAgentOrchestrator } from '@directive-run/ai';
import type { AgentLike } from '@directive-run/ai';

const orchestrator = createAgentOrchestrator({
  runner,
  autoApproveToolCalls: true,
});

const agent: AgentLike = {
  name: 'assistant',
  instructions: 'You are a helpful assistant.',
  model: 'gpt-4',
};

// Start a streaming run – returns the stream, a result promise, and an abort handle
const { stream, result, abort } = orchestrator.runStream<string>(agent, 'Explain WebAssembly');

for await (const chunk of stream) {
  switch (chunk.type) {
    case 'token':
      process.stdout.write(chunk.data);                // Append each token as it arrives
      break;
    case 'tool_start':
      console.log(`\nCalling tool: ${chunk.tool}`);    // Agent is invoking a tool
      break;
    case 'tool_end':
      console.log(`Tool done: ${chunk.result}`);       // Tool returned a result
      break;
    case 'guardrail_triggered':
      console.warn(`Guardrail ${chunk.guardrailName}: ${chunk.reason}`);  // Safety check fired
      break;
    case 'approval_required':
      // Pause and show UI – call orchestrator.approve(chunk.requestId) to continue
      break;
    case 'done':
      console.log(`\n\nDone: ${chunk.totalTokens} tokens in ${chunk.duration}ms`);
      break;
    case 'error':
      console.error(chunk.error);
      break;
  }
}

// Await the completed result after the stream closes
const finalResult = await result;
```

---

## Chunk Types

Every stream chunk has a `type` discriminant:

| Type | Fields | When |
|------|--------|------|
| `token` | `data`, `tokenCount` | Each token from the agent |
| `tool_start` | `tool`, `toolCallId`, `arguments` | Agent starts calling a tool |
| `tool_end` | `tool`, `toolCallId`, `result` | Tool call completes |
| `message` | `message` | Full message added to conversation |
| `guardrail_triggered` | `guardrailName`, `reason`, `partialOutput`, `stopped` | A guardrail blocked content |
| `approval_required` | `requestId`, `toolName` | Tool call needs approval \* |
| `approval_resolved` | `requestId`, `approved` | Approval decision made \* |
| `progress` | `phase`, `percent?`, `message` | Status update (starting, generating, tool_calling, finishing) |
| `done` | `totalTokens`, `duration`, `droppedTokens` | Stream completed |
| `error` | `error`, `partialOutput?` | An error occurred |

\* `approval_required` and `approval_resolved` are only emitted by orchestrator streaming (`runStream` / `runAgentStream`), not by the base `createStreamingRunner`.

---

## Cancellation

Abort a stream at any time:

```typescript
const { stream, result, abort } = orchestrator.runStream(agent, input);

// Cancel after a timeout using the abort handle
setTimeout(() => abort(), 5000);

// Or pass an AbortSignal for external cancellation control
const controller = new AbortController();
const { stream: s2 } = orchestrator.runStream(agent, input, {
  signal: controller.signal,
});

// Trigger cancellation from anywhere that holds the controller
controller.abort();
```

---

## Multi-Agent Streaming

Stream from a specific agent in a multi-agent orchestrator with `runAgentStream()`. All guardrails, approval checks, and state tracking apply:

```typescript
import { createMultiAgentOrchestrator } from '@directive-run/ai';

const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: {
    researcher: { agent: researcher, maxConcurrent: 3 },
    writer: { agent: writer, maxConcurrent: 1 },
  },
  guardrails: {
    input: [createPIIGuardrail({ redact: true })],
  },
});

// Stream a specific agent's output
const { stream, result, abort } = orchestrator.runAgentStream<string>('writer', 'Write about AI');

for await (const chunk of stream) {
  if (chunk.type === 'token') process.stdout.write(chunk.data);
  if (chunk.type === 'done') console.log(`\nDone: ${chunk.totalTokens} tokens`);
}

const finalResult = await result;
```

The chunk types are identical to `orchestrator.runStream()` &ndash; see the [Chunk Types](#chunk-types) table above.

### Guardrail Failures in Multi-Agent Streaming

When a guardrail blocks an agent during a multi-agent streaming run, the stream emits a `guardrail_triggered` chunk with `stopped: true` before the `error` chunk. This lets UI code show a guardrail-specific message instead of a generic error:

```typescript
for await (const chunk of stream) {
  if (chunk.type === 'guardrail_triggered' && chunk.stopped) {
    showBanner(`Blocked by ${chunk.guardrailName}: ${chunk.reason}`);
    break;  // Stream is already terminated
  }
}
```

Both orchestrator-level and per-agent guardrails can trigger this behavior. The `partialOutput` field contains whatever the agent generated before the guardrail fired.

---

## Direct Streaming Runner

For streaming outside the orchestrator (e.g., direct agent runs without guardrails/approvals), use `createStreamingRunner` directly:

```typescript
import { createStreamingRunner } from '@directive-run/ai';

const streamRunner = createStreamingRunner(myStreamingCallbackRunner);

const chatAgent = {
  name: 'chat',
  instructions: 'You are a helpful assistant.',
  model: 'gpt-4',
};

// Start a streaming run – returns the stream, a result promise, and an abort handle
const { stream, result, abort } = streamRunner(chatAgent, 'Hello!');

for await (const chunk of stream) {
  if (chunk.type === 'token') process.stdout.write(chunk.data);
}

const finalResult = await result;
```

The streaming runner handles token tracking and lifecycle hooks automatically.

---

## Provider Streaming Runners

Directive ships pre-built streaming runners for OpenAI, Anthropic, and Gemini. These handle SSE parsing, token extraction, and lifecycle hooks automatically:

### OpenAI Streaming

```typescript
import { createOpenAIStreamingRunner } from '@directive-run/ai/openai';
import { createStreamingRunner } from '@directive-run/ai';

const openaiStreamingRunner = createOpenAIStreamingRunner({
  apiKey: process.env.OPENAI_API_KEY!,
  hooks: {
    onAfterCall: ({ durationMs, tokenUsage }) => {
      console.log(`${durationMs}ms – ${tokenUsage.inputTokens}in/${tokenUsage.outputTokens}out`);
    },
  },
});

const streamRunner = createStreamingRunner(openaiStreamingRunner);

const chatAgent = {
  name: 'chat',
  instructions: 'You are a helpful assistant.',
  model: 'gpt-4',
};

const { stream, result } = streamRunner(chatAgent, 'Hello!');
```

### Anthropic Streaming

```typescript
import { createAnthropicStreamingRunner } from '@directive-run/ai/anthropic';
import { createStreamingRunner } from '@directive-run/ai';

const anthropicStreamingRunner = createAnthropicStreamingRunner({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const streamRunner = createStreamingRunner(anthropicStreamingRunner);

const chatAgent = {
  name: 'chat',
  instructions: 'You are a helpful assistant.',
  model: 'claude-sonnet-4-5-20250929',
};

const { stream, result } = streamRunner(chatAgent, 'Hello!');
```

### Gemini Streaming

```typescript
import { createGeminiStreamingRunner } from '@directive-run/ai/gemini';
import { createStreamingRunner } from '@directive-run/ai';

const geminiStreamingRunner = createGeminiStreamingRunner({
  apiKey: process.env.GEMINI_API_KEY!,
});

const streamRunner = createStreamingRunner(geminiStreamingRunner);

const chatAgent = {
  name: 'chat',
  instructions: 'You are a helpful assistant.',
  model: 'gemini-2.0-flash',
};

const { stream, result } = streamRunner(chatAgent, 'Hello!');
```

All streaming runners return `tokenUsage` with input/output breakdown and support the same `hooks` interface as the standard runners.

---

## Custom Streaming Runner

Build a custom streaming runner by wrapping your LLM SDK's streaming API with `createStreamingRunner`:

```typescript
import { createStreamingRunner } from '@directive-run/ai';
import type { StreamRunOptions } from '@directive-run/ai';

// Build a streaming runner by wrapping your LLM SDK's streaming API
const streamRunner = createStreamingRunner(
  async (agent, input, callbacks) => {
    // Start a streaming completion request
    const stream = await openai.chat.completions.create({
      model: agent.model ?? 'gpt-4',
      messages: [
        { role: 'system', content: agent.instructions ?? '' },
        { role: 'user', content: input },
      ],
      stream: true,
    });

    const messages = [];
    let fullContent = '';

    for await (const chunk of stream) {
      if (callbacks.signal?.aborted) break;    // Stop if the caller cancelled

      const token = chunk.choices[0]?.delta?.content ?? '';
      if (token) {
        callbacks.onToken?.(token);            // Push each token to the stream
        fullContent += token;
      }
    }

    // Return the final assembled result
    return {
      output: fullContent,
      messages,
      toolCalls: [],
      totalTokens: Math.ceil(fullContent.length / 4),
    };
  }
);

// Use the runner with backpressure and guardrail options
const { stream, result, abort } = streamRunner(agent, 'Hello', {
  backpressure: 'buffer',
  guardrailCheckInterval: 50,
});
```

---

## Backpressure

Control what happens when the consumer is slower than the producer:

```typescript
// Buffer – keeps all tokens in memory (lossless, default)
const { stream } = streamRunner(agent, input, {
  backpressure: 'buffer',
});

// Drop – discards tokens when the buffer fills up (lossy, but fast)
const { stream: s2 } = streamRunner(agent, input, {
  backpressure: 'drop',
  bufferSize: 100,
});

// Block – pauses the producer until the consumer catches up (lossless, may slow response)
const { stream: s3 } = streamRunner(agent, input, {
  backpressure: 'block',
  bufferSize: 500,
});
```

The `done` chunk includes `droppedTokens` count when using the `drop` strategy.

---

## Streaming Guardrails

Evaluate guardrails on partial output as tokens arrive, without waiting for the full response:

```typescript
import {
  createStreamingRunner,
  createLengthStreamingGuardrail,
  createPatternStreamingGuardrail,
  combineStreamingGuardrails,
} from '@directive-run/ai';

const streamRunner = createStreamingRunner(baseRunner, {
  streamingGuardrails: [
    // Halt the stream if the output grows too long
    createLengthStreamingGuardrail({
      maxTokens: 2000,
      warnAt: 1500,               // Emit a warning chunk at 75%
    }),

    // Halt the stream when sensitive data patterns appear
    createPatternStreamingGuardrail({
      patterns: [
        { regex: /\b\d{3}-\d{2}-\d{4}\b/, name: 'SSN' },
        { regex: /\bpassword\s*[:=]/i, name: 'Password leak' },
      ],
    }),
  ],
});

const { stream } = streamRunner(agent, input, {
  guardrailCheckInterval: 50,     // Evaluate guardrails every 50 tokens
  stopOnGuardrail: true,          // Terminate the stream on any guardrail failure
});

for await (const chunk of stream) {
  if (chunk.type === 'guardrail_triggered') {
    console.warn(`${chunk.guardrailName}: ${chunk.reason}`);
    if (chunk.stopped) break;     // Stream was halted by the guardrail
  }
}
```

### Combining Guardrails

Merge multiple streaming guardrails into one:

```typescript
import { combineStreamingGuardrails } from '@directive-run/ai';

// Merge multiple streaming guardrails into a single checker
const combined = combineStreamingGuardrails([
  createLengthStreamingGuardrail({ maxTokens: 2000 }),
  createPatternStreamingGuardrail({ patterns: [...] }),
]);

const streamRunner = createStreamingRunner(baseRunner, {
  streamingGuardrails: [combined],
});
```

### Adapting Output Guardrails

Reuse existing output guardrails as streaming guardrails:

```typescript
import { adaptOutputGuardrail } from '@directive-run/ai';

// Reuse an existing output guardrail as a streaming guardrail
const streamingVersion = adaptOutputGuardrail(
  'pii-streaming',        // Name for logging and error messages
  myOutputGuardrail,       // Your existing guardrail function
  { minTokens: 100 },     // Wait for 100 tokens before first check
);
```

---

## Stream Operators

Transform, filter, and inspect streams with composable operators:

### Collect Tokens

Consume an entire stream and return the concatenated text:

```typescript
import { collectTokens } from '@directive-run/ai';

// Consume the entire stream and return the concatenated text
const { stream } = orchestrator.runStream(agent, input);
const fullOutput = await collectTokens(stream);
```

### Tap

Observe chunks without modifying the stream (logging, metrics):

```typescript
import { tapStream } from '@directive-run/ai';

const { stream } = orchestrator.runStream(agent, input);

// Observe each chunk for side effects (logging, metrics) without modifying it
const logged = tapStream(stream, (chunk) => {
  if (chunk.type === 'token') tokenCount++;
  if (chunk.type === 'error') reportError(chunk.error);
});

for await (const chunk of logged) {
  // Chunks are unchanged – tap only inspects them
}
```

### Filter

Keep only specific chunk types:

```typescript
import { filterStream } from '@directive-run/ai';

const { stream } = orchestrator.runStream(agent, input);

// Keep only the chunk types you care about
const tokensOnly = filterStream(stream, ['token', 'done']);

for await (const chunk of tokensOnly) {
  // TypeScript narrows chunk.type to 'token' | 'done'
}
```

### Map

Transform chunks:

```typescript
import { mapStream } from '@directive-run/ai';

const { stream } = orchestrator.runStream(agent, input);

// Transform each chunk as it flows through the stream
const uppercased = mapStream(stream, (chunk) => {
  if (chunk.type === 'token') {
    return { ...chunk, data: chunk.data.toUpperCase() };
  }
  return chunk;  // Pass non-token chunks through unchanged
});
```

---

## Framework Integration

The streaming API is framework-agnostic – `orchestrator.runStream()` works the same everywhere. The framework layer handles reactive UI updates as chunks arrive.

### React

```tsx
import { useState, useCallback } from 'react';
import { useAgentOrchestrator, useFact } from '@directive-run/react';

function ChatStream() {
  const orchestrator = useAgentOrchestrator({ runner, autoApproveToolCalls: true });
  const agent = useFact(orchestrator.system, '__agent');
  const [output, setOutput] = useState('');

  const send = useCallback(async (input: string) => {
    setOutput('');  // Clear previous output before starting a new stream

    const { stream } = orchestrator.runStream(myAgent, input);

    // Append each token to state as it arrives
    for await (const chunk of stream) {
      if (chunk.type === 'token') setOutput((prev) => prev + chunk.data);
    }
  }, [orchestrator]);

  return (
    <div>
      <p>{output}</p>
      {agent?.status === 'running' && <span className="cursor" />}
    </div>
  );
}
```

### Vue

```html
<script setup>
import { ref, onUnmounted } from 'vue';
import { createAgentOrchestrator } from '@directive-run/ai';
import { useFact } from '@directive-run/vue';

const orchestrator = createAgentOrchestrator({ runner, autoApproveToolCalls: true });
onUnmounted(() => orchestrator.dispose());

const agent = useFact(orchestrator.system, '__agent');
const output = ref('');

async function send(input: string) {
  output.value = '';  // Reset before each new stream

  const { stream } = orchestrator.runStream(myAgent, input);
  for await (const chunk of stream) {
    if (chunk.type === 'token') output.value += chunk.data;  // Append tokens reactively
  }
}
</script>

<template>
  <p>{{ output }}</p>
  <span v-if="agent?.status === 'running'" class="cursor" />
</template>
```

### Svelte

```html
<script>
import { createAgentOrchestrator } from '@directive-run/ai';
import { useFact } from '@directive-run/svelte';
import { onDestroy } from 'svelte';

const orchestrator = createAgentOrchestrator({ runner, autoApproveToolCalls: true });
onDestroy(() => orchestrator.dispose());

const agent = useFact(orchestrator.system, '__agent');
let output = '';

async function send(input) {
  output = '';  // Clear previous response

  const { stream } = orchestrator.runStream(myAgent, input);
  for await (const chunk of stream) {
    if (chunk.type === 'token') output += chunk.data;  // Svelte reactively updates the template
  }
}
</script>

<p>{output}</p>
{#if $agent?.status === 'running'}<span class="cursor" />{/if}
```

### Solid

```tsx
import { createSignal } from 'solid-js';
import { createAgentOrchestrator } from '@directive-run/ai';
import { useFact } from '@directive-run/solid';
import { onCleanup } from 'solid-js';

function ChatStream() {
  const orchestrator = createAgentOrchestrator({ runner, autoApproveToolCalls: true });
  onCleanup(() => orchestrator.dispose());

  const agent = useFact(orchestrator.system, '__agent');
  const [output, setOutput] = createSignal('');

  async function send(input: string) {
    setOutput('');  // Reset signal before streaming

    const { stream } = orchestrator.runStream(myAgent, input);
    for await (const chunk of stream) {
      if (chunk.type === 'token') setOutput((prev) => prev + chunk.data);
    }
  }

  return (
    <div>
      <p>{output()}</p>
      {agent()?.status === 'running' && <span class="cursor" />}
    </div>
  );
}
```

### Lit

```typescript
import { LitElement, html } from 'lit';
import { createAgentOrchestrator } from '@directive-run/ai';
import { FactController } from '@directive-run/lit';

class ChatStream extends LitElement {
  private orchestrator = createAgentOrchestrator({ runner, autoApproveToolCalls: true });
  private agent = new FactController(this, this.orchestrator.system, '__agent');
  private output = '';

  disconnectedCallback() {
    super.disconnectedCallback();
    this.orchestrator.dispose();
  }

  async send(input: string) {
    this.output = '';
    this.requestUpdate();  // Clear the display immediately

    const { stream } = this.orchestrator.runStream(myAgent, input);
    for await (const chunk of stream) {
      if (chunk.type === 'token') {
        this.output += chunk.data;
        this.requestUpdate();  // Re-render after each token
      }
    }
  }

  render() {
    return html`
      <p>${this.output}</p>
      ${this.agent.value?.status === 'running' ? html`<span class="cursor"></span>` : ''}
    `;
  }
}
```

---

## Stream Channels

Low-level primitives for custom agent-to-agent streaming:

```typescript
import { createStreamChannel, createBidirectionalStream, pipeThrough } from '@directive-run/ai';

// Unidirectional channel (producer → consumer)
const channel = createStreamChannel<string>({ bufferSize: 100 });
channel.send('hello');
channel.close();

for await (const value of channel) {
  console.log(value);  // 'hello'
}

// Bidirectional stream (two-way communication)
const { sideA, sideB } = createBidirectionalStream<string, number>();
sideA.send('question');    // sideB receives 'question'
sideB.send(42);            // sideA receives 42

// Pipe streams through a transform
const transformed = pipeThrough(sourceStream, async function* (chunks) {
  for await (const chunk of chunks) {
    yield chunk.toUpperCase();
  }
});
```

---

## Next Steps

- [Agent Orchestrator](/ai/orchestrator) &ndash; Full orchestrator API
- [Guardrails](/ai/guardrails) &ndash; Input/output validation
- [Multi-Agent Orchestrator](/ai/multi-agent) &ndash; Multi-agent streaming
