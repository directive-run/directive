---
title: Memory
description: Conversation memory management with sliding window, token-based, and hybrid strategies plus LLM summarization.
---

Manage conversation context with automatic trimming, summarization, and token budgets. {% .lead %}

Memory strategies control which messages stay in context and which get summarized. Attach memory to either orchestrator &ndash; shared across all agents or per-agent.

---

## Quick Start

```typescript
import {
  createAgentMemory,
  createSlidingWindowStrategy,
  createAgentOrchestrator,
} from '@directive-run/ai';

const memory = createAgentMemory({
  strategy: createSlidingWindowStrategy({ maxMessages: 50 }),
});

const orchestrator = createAgentOrchestrator({
  runner,
  memory,
});
```

---

## Creating Memory

```typescript
import {
  createAgentMemory,
  createSlidingWindowStrategy,
  createTokenBasedStrategy,
  createHybridStrategy,
} from '@directive-run/ai';
import type { AgentMemoryConfig, AgentMemory } from '@directive-run/ai';

const memory = createAgentMemory({
  strategy: createSlidingWindowStrategy(),

  // Optional: summarize trimmed messages instead of dropping them
  summarizer: createKeyPointsSummarizer(),

  // Auto-manage when message count exceeds threshold
  autoManage: true,

  // Callbacks
  onMemoryManaged: (result) => {
    console.log(`Trimmed ${result.before.messageCount - result.after.messageCount} messages`);
  },
  onManageError: (error) => {
    console.error('Memory management failed:', error);
  },

  // Token limit for context window
  maxContextTokens: 8000,
});
```

### Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `strategy` | `MemoryStrategy` | *required* | How to trim messages |
| `summarizer` | `MessageSummarizer` | &ndash; | Summarize trimmed messages |
| `autoManage` | `boolean` | `false` | Auto-trigger management when threshold exceeded |
| `onMemoryManaged` | `(result) => void` | &ndash; | Callback after management |
| `onManageError` | `(error) => void` | &ndash; | Callback on management failure |
| `maxContextTokens` | `number` | &ndash; | Token limit for context messages |

---

## Strategies

### Sliding Window

Keep the N most recent messages. Older messages are candidates for summarization:

```typescript
const strategy = createSlidingWindowStrategy({
  maxMessages: 50,
  preserveRecentCount: 5,    // Always keep last 5 messages
  countSystemMessages: false, // Don't count system messages toward limit
});
```

### Token-Based

Keep messages until the token budget is reached:

```typescript
const strategy = createTokenBasedStrategy({
  maxTokens: 4000,
  preserveRecentCount: 3,
  countSystemMessages: true,
});
```

### Hybrid

Combine message count and token limits &ndash; whichever is hit first triggers trimming:

```typescript
const strategy = createHybridStrategy({
  maxMessages: 100,
  maxTokens: 8000,
  preserveRecentCount: 5,
  countSystemMessages: false,
});
```

### Strategy Config

All strategies share a common config shape:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxMessages` | `number` | &ndash; | Maximum message count (sliding/hybrid) |
| `maxTokens` | `number` | &ndash; | Maximum token budget (token/hybrid) |
| `preserveRecentCount` | `number` | `0` | Always keep this many recent messages |
| `countSystemMessages` | `boolean` | `true` | Include system messages in counts |

---

## Summarizers

When messages are trimmed, summarizers compress them into summaries that stay in context.

### Truncation

Simple truncation to a max length:

```typescript
import { createTruncationSummarizer } from '@directive-run/ai';

const summarizer = createTruncationSummarizer(500); // max 500 chars
```

### Key Points

Rule-based extraction of user questions and key exchanges:

```typescript
import { createKeyPointsSummarizer } from '@directive-run/ai';

const summarizer = createKeyPointsSummarizer();
```

### LLM Summarizer

Use an LLM to generate high-quality summaries:

```typescript
import { createLLMSummarizer } from '@directive-run/ai';

const summarizer = createLLMSummarizer(
  async (prompt) => {
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
    });

    return response.choices[0].message.content ?? '';
  },
  {
    maxSummaryLength: 500,
    preserveKeyFacts: true,
  }
);
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxSummaryLength` | `number` | &ndash; | Maximum summary length in characters |
| `preserveKeyFacts` | `boolean` | `false` | Instruct the LLM to preserve key facts |

---

## AgentMemory API

```typescript
const memory = createAgentMemory({ strategy, summarizer });

// Add messages
memory.addMessage({ role: 'user', content: 'Hello!' });
memory.addMessages([
  { role: 'assistant', content: 'Hi there!' },
  { role: 'user', content: 'Tell me about WASM' },
]);

// Get messages for context window (includes summaries as system messages)
const context = memory.getContextMessages();

// Manually trigger memory management
const result = await memory.manage();
console.log(result.before.messageCount);
console.log(result.after.messageCount);
console.log(result.after.estimatedTokens);

// Check state
const state = memory.getState();
console.log(state.messages);                // Active messages
console.log(state.summaries);               // Summary strings
console.log(state.totalMessagesProcessed);  // Lifetime count
console.log(state.estimatedTokens);         // Current token estimate

// Check if management is running
console.log(memory.isManaging());

// Export/import for persistence
const exported = memory.export();
memory.import(exported);

// Clear everything
memory.clear();
```

### MemoryState

```typescript
interface MemoryState {
  messages: MemoryMessage[];
  summaries: string[];
  totalMessagesProcessed: number;
  estimatedTokens: number;
}
```

---

## Token Estimation

The memory system uses a built-in token estimator (~4 characters per token). This is used internally by the token-based and hybrid strategies to track token budgets.

For custom tokenization, pass a `tokenizer` function to the strategy config:

```typescript
const memory = createAgentMemory({
  strategy: createTokenBasedStrategy({
    maxTokens: 8000,
  }),
});
```

---

## Multi-Agent Memory

Attach shared memory or per-agent memory to a multi-agent orchestrator:

```typescript
import {
  createMultiAgentOrchestrator,
  createAgentMemory,
  createSlidingWindowStrategy,
  createTokenBasedStrategy,
} from '@directive-run/ai';

const sharedMemory = createAgentMemory({
  strategy: createSlidingWindowStrategy({ maxMessages: 50 }),
});

const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: {
    researcher: {
      agent: researcher,
      // Per-agent memory overrides shared memory
      memory: createAgentMemory({
        strategy: createTokenBasedStrategy({ maxTokens: 8000 }),
      }),
    },
    writer: { agent: writer },  // Uses shared memory
  },
  memory: sharedMemory,
});
```

---

## Next Steps

- [Agent Orchestrator](/ai/orchestrator) &ndash; Single-agent setup
- [Multi-Agent Orchestrator](/ai/multi-agent) &ndash; Multi-agent setup
- [Streaming](/ai/streaming) &ndash; Real-time token streaming
