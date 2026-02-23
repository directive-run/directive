---
title: Smart Model Routing
description: Route AI requests to the right model based on complexity, agent role, or input patterns.
---

Route requests to the right model based on complexity, saving money without sacrificing quality. {% .lead %}

---

## The Problem

You're using GPT-4o for everything — including simple classification tasks that GPT-4o-mini handles just as well at 1/10th the cost. Complex reasoning tasks need the expensive model, but most requests don't.

## The Solution

Use `withModelSelection` to route requests based on input length, agent name, or regex patterns:

```typescript
import {
  withModelSelection,
  byInputLength,
  byAgentName,
} from '@directive-run/ai';

const smartRunner = withModelSelection(runner, [ // See Running Agents (/ai/running-agents) for setup
  // Short inputs -> cheap model
  byInputLength(200, 'gpt-4o-mini'),
  // Specific agents -> specific models
  byAgentName('classifier', 'gpt-4o-mini'),
  byAgentName('reasoner', 'gpt-4o'),
]);
```

## How It Works

- **`withModelSelection`** wraps a runner and overrides the model before each call based on matching rules.
- **Rules are evaluated in order.** The first match wins. If no rule matches, the original model is used.
- **`byInputLength`** routes based on character count. Short inputs often need less reasoning power.
- **`byAgentName`** routes based on the agent's name. Assign expensive models to agents that need them.
- **`byPattern`** routes based on regex matches against the input text.
- **Both array and object forms are supported.** Pass `[...rules]` for quick setup or `{ rules, onModelSelected }` when you need the selection callback.

## Full Example

A multi-agent system with cost-optimized model routing:

```typescript
import {
  createMultiAgentOrchestrator,
  withModelSelection,
  byInputLength,
  byAgentName,
  byPattern,
} from '@directive-run/ai';

const smartRunner = withModelSelection(runner, { // See Running Agents (/ai/running-agents) for setup
  rules: [
    // Classification tasks -> cheapest model
    byAgentName('classifier', 'gpt-4o-mini'),
    byAgentName('tagger', 'gpt-4o-mini'),

    // Code-related tasks -> best model
    byPattern(/```[\s\S]*```/, 'gpt-4o'),
    byAgentName('code-reviewer', 'gpt-4o'),

    // Short messages -> cheap model, long messages -> expensive model
    byInputLength(500, 'gpt-4o-mini'),
    byInputLength(Infinity, 'gpt-4o'),
  ],
  onModelSelected: (original, selected) => {
    if (original !== selected) {
      console.log(`Model routed: ${original} -> ${selected}`);
    }
  },
});

const orchestrator = createMultiAgentOrchestrator({
  runner: smartRunner,
  agents: {
    classifier: {
      agent: { name: 'classifier', instructions: 'Classify the intent of user messages.' },
    },
    'code-reviewer': {
      agent: { name: 'code-reviewer', instructions: 'Review code for bugs, security issues, and best practices.' },
    },
    assistant: {
      agent: { name: 'assistant', instructions: 'General-purpose assistant for user queries.' },
    },
  },
});

// Classifier always uses gpt-4o-mini (cheap)
await orchestrator.runAgent('classifier', 'I want to return my order');

// Code reviewer always uses gpt-4o (powerful)
await orchestrator.runAgent('code-reviewer', 'Review this function...');

// General assistant routes by input length
await orchestrator.runAgent('assistant', 'Hi'); // -> gpt-4o-mini
await orchestrator.runAgent('assistant', longDetailedPrompt); // -> gpt-4o
```

## Related

- [Resilience & Routing](/ai/resilience-routing) — `withModelSelection` and other routing middleware
- [Control AI Costs guide](/ai/guides/control-ai-costs) — budget limits and cost tracking
- [Handle Agent Errors guide](/ai/guides/handle-agent-errors) — `withFallback` for provider failover
