---
title: Add Chatbot Memory
description: Give AI agents conversational memory with sliding window, hybrid strategies, and LLM summarization.
---

Give agents conversational memory so they remember earlier messages. {% .lead %}

---

## The Problem

Your chatbot forgets what the user said three messages ago. Long conversations overflow the context window. You need memory management that keeps conversations coherent without burning tokens on the full history.

## The Solution

Use `createAgentMemory` with a strategy that fits your use case — sliding window for simple chats, hybrid for long conversations:

```typescript
import {
  createAgentOrchestrator,
  createAgentMemory,
  createSlidingWindowStrategy,
} from '@directive-run/ai';

const memory = createAgentMemory({
  strategy: createSlidingWindowStrategy({
    maxMessages: 20,
  }),
  maxContextTokens: 4000,
});

const agent = { name: 'assistant', instructions: 'Helpful customer assistant.' };

const orchestrator = createAgentOrchestrator({
  runner, // See Running Agents (/ai/running-agents) for setup
  autoApproveToolCalls: true,
  memory,
});

// Memory is managed automatically across turns
await orchestrator.run(agent, 'My name is Alex.');
await orchestrator.run(agent, 'What is my name?');
// Agent responds: "Your name is Alex."
```

## How It Works

- **`createSlidingWindowStrategy`** keeps the most recent N messages. Oldest messages are dropped when the limit is reached.
- **`createHybridStrategy`** keeps recent messages in full and summarizes older ones, preserving key context while saving tokens.
- **`maxContextTokens`** sets a hard limit on how many tokens the memory contributes to each request.
- **Memory is attached to the orchestrator** and automatically managed on each turn when `autoManage` is enabled (the default).

## Full Example

A chatbot with hybrid memory that summarizes old messages using an LLM:

```typescript
import {
  createAgentOrchestrator,
  createAgentMemory,
  createHybridStrategy,
  createLLMSummarizer,
} from '@directive-run/ai';

const summarizer = createLLMSummarizer(
  async (prompt) => {
    // Use any LLM to generate summaries
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) {
      throw new Error(`Summarizer failed: ${response.status}`);
    }
    const data = await response.json();

    return data.choices[0].message.content;
  },
  {
    maxSummaryLength: 500,
    preserveKeyFacts: true,
  },
);

const memory = createAgentMemory({
  strategy: createHybridStrategy({
    maxMessages: 50,
  }),
  summarizer,
  maxContextTokens: 8000,
  autoManage: true,
  onMemoryManaged: (result) => {
    console.log(`Memory managed: ${result.messagesRemoved} messages removed`);
  },
});

const agent = { name: 'support', instructions: 'Help customers with orders.' };

const orchestrator = createAgentOrchestrator({
  runner, // See Running Agents (/ai/running-agents) for setup
  autoApproveToolCalls: true,
  memory,
});

// Conversation persists across turns
await orchestrator.run(agent, 'I need help with my order #12345.');
await orchestrator.run(agent, 'It was supposed to arrive yesterday.');
await orchestrator.run(agent, 'Can you check the shipping status?');
// Agent has full context from all three messages

// Manually add context if needed
memory.addMessage({
  role: 'system',
  content: 'Customer is a premium member with priority support.',
});

// Get the current context window
const context = memory.getContextMessages();
console.log(`Context: ${context.length} messages`);
```

## Related

- [Memory reference](/ai/memory) — strategy configuration, custom strategies, and persistence
- [Customer Support Bot guide](/ai/guides/customer-support-bot) — memory in a production support agent
