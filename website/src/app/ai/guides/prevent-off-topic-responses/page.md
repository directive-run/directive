---
title: Prevent Off-Topic Responses
description: Stop AI agents from answering questions outside their intended domain using input guardrails.
---

Stop AI agents from answering questions outside their intended domain. {% .lead %}

---

## The Problem

Your customer support agent starts answering questions about cooking recipes. Your code review bot opines on politics. Without topic boundaries, agents drift into domains where their responses are unreliable, off-brand, or outright harmful.

## The Solution

Use `createModerationGuardrail` with a `checkFn` that rejects off-topic input before it reaches the LLM:

```typescript
import {
  createAgentOrchestrator,
  createModerationGuardrail,
} from '@directive-run/ai';

const topicGuardrail = createModerationGuardrail({
  checkFn: (text) => {
    const offTopicPatterns = [
      /recipe|cooking|food/i,
      /politic|election|vote/i,
      /sport|game score|nfl|nba/i,
    ];

    return offTopicPatterns.some((pattern) => pattern.test(text));
  },
  message: 'I can only help with product-related questions.',
});

const orchestrator = createAgentOrchestrator({
  runner, // See Running Agents (/ai/running-agents) for setup
  autoApproveToolCalls: true,
  guardrails: {
    input: [topicGuardrail],
  },
});
```

## How It Works

- **`checkFn` receives the raw input text** before it reaches the agent. Return `true` to flag (block), `false` to allow.
- **`message` is sent back to the user** when the guardrail blocks a request, instead of the agent's response.
- **Input guardrails run in order.** The first one that rejects stops the chain. Place your cheapest/fastest checks first.
- **`checkFn` can be async.** Call an external moderation API, run a classifier, or check a database.

## Full Example

A support agent that only answers questions about your product, with an async classifier for more nuanced detection:

```typescript
import {
  createAgentOrchestrator,
  createModerationGuardrail,
} from '@directive-run/ai';

// Simple keyword guardrail for obvious off-topic input
const keywordGuardrail = createModerationGuardrail({
  checkFn: (text) => {
    const blocked = [/recipe|cooking/i, /politic|election/i];

    return blocked.some((p) => p.test(text));
  },
  message: 'I can only help with Acme product questions.',
});

// Async classifier for subtler cases
const classifierGuardrail = createModerationGuardrail({
  checkFn: async (text) => {
    const response = await fetch('https://api.example.com/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, allowedTopics: ['product', 'billing', 'support'] }),
    });
    if (!response.ok) {
      return false; // Fail open — allow input if classifier is down
    }
    const result = await response.json();

    return !result.isOnTopic;
  },
  message: 'That question is outside my area of expertise.',
});

const agent = { name: 'support', instructions: 'Help customers with Acme products.' };

const orchestrator = createAgentOrchestrator({
  runner, // See Running Agents (/ai/running-agents) for setup
  autoApproveToolCalls: true,
  guardrails: {
    input: [keywordGuardrail, classifierGuardrail],
  },
});

// Blocked immediately by keyword guardrail
const result = await orchestrator.run(agent, 'How do I make pasta?');
// result.status === 'blocked'
// result.message === 'I can only help with Acme product questions.'

// Passes keyword check, evaluated by classifier
const result2 = await orchestrator.run(agent, 'Tell me about the weather');
// If classifier says off-topic:
// result2.message === 'That question is outside my area of expertise.'
```

## Related

- [Interactive Example](/docs/examples/topic-guard) — try the guardrail in your browser
- [Guardrails reference](/ai/guardrails) — all built-in guardrails and custom guardrail API
- [Customer Support Bot guide](/ai/guides/customer-support-bot) — full support agent with PII detection and escalation
