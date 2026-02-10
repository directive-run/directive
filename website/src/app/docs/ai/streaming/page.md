---
title: Streaming
description: Stream AI agent responses with backpressure, guardrails, and stream operators.
---

Process agent responses token-by-token with real-time guardrails. {% .lead %}

---

## Orchestrator Streaming

The simplest way to stream — use `orchestrator.runStream()` which wraps the agent run with guardrails, approval checks, and state tracking:

```typescript
import { createAgentOrchestrator } from 'directive/ai';
import type { AgentLike } from 'directive/ai';

const orchestrator = createAgentOrchestrator({
  runner,
  autoApproveToolCalls: true,
});

const agent: AgentLike = {
  name: 'assistant',
  instructions: 'You are a helpful assistant.',
  model: 'gpt-4',
};

const { stream, result, abort } = orchestrator.runStream<string>(agent, 'Explain WebAssembly');

for await (const chunk of stream) {
  switch (chunk.type) {
    case 'token':
      process.stdout.write(chunk.data);
      break;
    case 'tool_start':
      console.log(`\nCalling tool: ${chunk.tool}`);
      break;
    case 'tool_end':
      console.log(`Tool done: ${chunk.result}`);
      break;
    case 'guardrail_triggered':
      console.warn(`Guardrail ${chunk.guardrailName}: ${chunk.reason}`);
      break;
    case 'approval_required':
      // Show UI for approval — call orchestrator.approve(chunk.requestId)
      break;
    case 'done':
      console.log(`\n\nDone: ${chunk.totalTokens} tokens in ${chunk.duration}ms`);
      break;
    case 'error':
      console.error(chunk.error);
      break;
  }
}

// Get the final result after stream completes
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
| `approval_required` | `requestId`, `toolName` | Tool call needs approval |
| `approval_resolved` | `requestId`, `approved` | Approval decision made |
| `progress` | `phase`, `message` | Status update (starting, generating, tool_calling, finishing) |
| `done` | `totalTokens`, `duration`, `droppedTokens` | Stream completed |
| `error` | `error`, `partialOutput?` | An error occurred |

---

## Cancellation

Abort a stream at any time:

```typescript
const { stream, result, abort } = orchestrator.runStream(agent, input);

// Cancel after 5 seconds
setTimeout(() => abort(), 5000);

// Or pass an AbortSignal
const controller = new AbortController();
const { stream: s2 } = orchestrator.runStream(agent, input, {
  signal: controller.signal,
});

// Cancel from elsewhere
controller.abort();
```

---

## Stack Streaming

The `AgentStack` offers two streaming methods. `stack.stream()` yields raw token strings, while `stack.streamChunks()` yields the same rich `StreamChunk` types as the orchestrator:

```typescript
import { createAgentStack } from 'directive/ai';

const stack = createAgentStack({
  runner,
  streaming: { runner: myStreamingRunner },
  agents: { chat: { agent: chatAgent, capabilities: ['chat'] } },
});

// Token-only stream
const tokenStream = stack.stream('chat', 'Hello!');
for await (const token of tokenStream) {
  process.stdout.write(token);
}

// Rich chunk stream (tokens, tool calls, guardrails, progress)
const { stream, result, abort } = stack.streamChunks('chat', 'Hello!');
for await (const chunk of stream) {
  if (chunk.type === 'token') process.stdout.write(chunk.data);
}
const finalResult = await result;
```

Both methods automatically track tokens, record observability spans, and publish to the message bus.

---

## Standalone Streaming

For streaming outside the orchestrator (e.g., direct agent runs without guardrails/approvals), use `createStreamingRunner`:

```typescript
import { createStreamingRunner } from 'directive/ai';
import type { StreamRunOptions } from 'directive/ai';

const streamRunner = createStreamingRunner(
  // Your base run function with streaming callbacks
  async (agent, input, callbacks) => {
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
      if (callbacks.signal?.aborted) break;

      const token = chunk.choices[0]?.delta?.content ?? '';
      if (token) {
        callbacks.onToken?.(token);
        fullContent += token;
      }
    }

    return {
      output: fullContent,
      messages,
      toolCalls: [],
      totalTokens: Math.ceil(fullContent.length / 4),
    };
  }
);

// Use the runner
const { stream, result, abort } = streamRunner(agent, 'Hello', {
  backpressure: 'buffer',
  guardrailCheckInterval: 50,
});
```

---

## Backpressure

Control what happens when the consumer is slower than the producer:

```typescript
// Buffer all tokens (default — lossless, uses memory)
const { stream } = streamRunner(agent, input, {
  backpressure: 'buffer',
});

// Drop tokens when buffer is full (lossy, fast)
const { stream: s2 } = streamRunner(agent, input, {
  backpressure: 'drop',
  bufferSize: 100,
});

// Block producer when buffer is full (lossless, may slow response)
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
} from 'directive/ai';

const streamRunner = createStreamingRunner(baseRunner, {
  streamingGuardrails: [
    // Stop if output exceeds token limit
    createLengthStreamingGuardrail({
      maxTokens: 2000,
      warnAt: 1500,
    }),

    // Stop on forbidden patterns
    createPatternStreamingGuardrail({
      patterns: [
        { regex: /\b\d{3}-\d{2}-\d{4}\b/, name: 'SSN' },
        { regex: /\bpassword\s*[:=]/i, name: 'Password leak' },
      ],
    }),
  ],
});

const { stream } = streamRunner(agent, input, {
  guardrailCheckInterval: 50,     // Check every 50 tokens
  stopOnGuardrail: true,          // Stop stream on guardrail failure
});

for await (const chunk of stream) {
  if (chunk.type === 'guardrail_triggered') {
    console.warn(`${chunk.guardrailName}: ${chunk.reason}`);
    if (chunk.stopped) break;
  }
}
```

### Combining Guardrails

Merge multiple streaming guardrails into one:

```typescript
import { combineStreamingGuardrails } from 'directive/ai';

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
import { adaptOutputGuardrail } from 'directive/ai';

const streamingVersion = adaptOutputGuardrail(
  'pii-streaming',        // name
  myOutputGuardrail,       // existing guardrail function
  { minTokens: 100 },     // options (optional)
);
```

---

## Stream Operators

Transform, filter, and inspect streams with composable operators:

### Collect Tokens

Consume an entire stream and return the concatenated text:

```typescript
import { collectTokens } from 'directive/ai';

const { stream } = orchestrator.runStream(agent, input);
const fullOutput = await collectTokens(stream);
```

### Tap

Observe chunks without modifying the stream (logging, metrics):

```typescript
import { tapStream } from 'directive/ai';

const { stream } = orchestrator.runStream(agent, input);

const logged = tapStream(stream, (chunk) => {
  if (chunk.type === 'token') tokenCount++;
  if (chunk.type === 'error') reportError(chunk.error);
});

for await (const chunk of logged) {
  // Same chunks, but tap ran first
}
```

### Filter

Keep only specific chunk types:

```typescript
import { filterStream } from 'directive/ai';

const { stream } = orchestrator.runStream(agent, input);

// Only get token and done chunks
const tokensOnly = filterStream(stream, ['token', 'done']);

for await (const chunk of tokensOnly) {
  // chunk.type is narrowed to 'token' | 'done'
}
```

### Map

Transform chunks:

```typescript
import { mapStream } from 'directive/ai';

const { stream } = orchestrator.runStream(agent, input);

const uppercased = mapStream(stream, (chunk) => {
  if (chunk.type === 'token') {
    return { ...chunk, data: chunk.data.toUpperCase() };
  }
  return chunk;
});
```

---

## Framework Integration

The streaming API is framework-agnostic — `orchestrator.runStream()` works the same everywhere. The framework layer handles reactive UI updates as chunks arrive.

### React

```tsx
import { useState, useCallback } from 'react';
import { useAgentOrchestrator, useFact } from 'directive/react';

function ChatStream() {
  const orchestrator = useAgentOrchestrator({ runner, autoApproveToolCalls: true });
  const agent = useFact(orchestrator.system, '__agent');
  const [output, setOutput] = useState('');

  const send = useCallback(async (input: string) => {
    setOutput('');
    const { stream } = orchestrator.runStream(myAgent, input);

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

```vue
<script setup>
import { ref, onUnmounted } from 'vue';
import { createAgentOrchestrator } from 'directive/ai';
import { useFact } from 'directive/vue';

const orchestrator = createAgentOrchestrator({ runner, autoApproveToolCalls: true });
onUnmounted(() => orchestrator.dispose());

const agent = useFact(orchestrator.system, '__agent');
const output = ref('');

async function send(input: string) {
  output.value = '';
  const { stream } = orchestrator.runStream(myAgent, input);
  for await (const chunk of stream) {
    if (chunk.type === 'token') output.value += chunk.data;
  }
}
</script>

<template>
  <p>{{ output }}</p>
  <span v-if="agent?.status === 'running'" class="cursor" />
</template>
```

### Svelte

```svelte
<script>
import { createAgentOrchestrator } from 'directive/ai';
import { useFact } from 'directive/svelte';
import { onDestroy } from 'svelte';

const orchestrator = createAgentOrchestrator({ runner, autoApproveToolCalls: true });
onDestroy(() => orchestrator.dispose());

const agent = useFact(orchestrator.system, '__agent');
let output = '';

async function send(input) {
  output = '';
  const { stream } = orchestrator.runStream(myAgent, input);
  for await (const chunk of stream) {
    if (chunk.type === 'token') output += chunk.data;
  }
}
</script>

<p>{output}</p>
{#if $agent?.status === 'running'}<span class="cursor" />{/if}
```

### Solid

```tsx
import { createSignal } from 'solid-js';
import { createAgentOrchestrator } from 'directive/ai';
import { useFact } from 'directive/solid';
import { onCleanup } from 'solid-js';

function ChatStream() {
  const orchestrator = createAgentOrchestrator({ runner, autoApproveToolCalls: true });
  onCleanup(() => orchestrator.dispose());

  const agent = useFact(orchestrator.system, '__agent');
  const [output, setOutput] = createSignal('');

  async function send(input: string) {
    setOutput('');
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
import { createAgentOrchestrator } from 'directive/ai';
import { FactController } from 'directive/lit';

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
    this.requestUpdate();
    const { stream } = this.orchestrator.runStream(myAgent, input);
    for await (const chunk of stream) {
      if (chunk.type === 'token') {
        this.output += chunk.data;
        this.requestUpdate();
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

## Next Steps

- See [Agent Orchestrator](/docs/ai/orchestrator) for the full orchestrator API
- See [Guardrails](/docs/ai/guardrails) for input/output validation
- See [Multi-Agent](/docs/ai/multi-agent) for parallel and sequential patterns
