---
title: 'Tutorial: Research Pipeline'
description: Build a multi-agent research pipeline with guardrails, streaming, and debugging in 15 minutes.
---

Build a working multi-agent research pipeline from scratch. {% .lead %}

By the end of this tutorial you'll have a system where a researcher agent gathers information, a writer agent drafts content, and a reviewer agent checks quality &ndash; with guardrails, streaming, and debugging wired up.

---

## Prerequisites

```bash
npm install @directive-run/ai
```

You'll need an LLM API key (OpenAI, Anthropic, or any provider). The tutorial uses a generic runner that works with any SDK.

---

## Step 1: Define Your Agents

```typescript
import type { AgentLike } from '@directive-run/ai';

const researcher: AgentLike = {
  name: 'researcher',
  instructions: 'You are a research assistant. Find key facts about the given topic. Return a concise summary.',
  model: 'gpt-4',
};

const writer: AgentLike = {
  name: 'writer',
  instructions: 'You are a technical writer. Turn research notes into a clear, well-structured article.',
  model: 'gpt-4',
};

const reviewer: AgentLike = {
  name: 'reviewer',
  instructions: 'Review the article for accuracy and clarity. Return "APPROVED" or specific revision notes.',
  model: 'gpt-4',
};
```

---

## Step 2: Create a Runner

The runner is the bridge between Directive and your LLM SDK. Here's one for OpenAI:

```typescript
import type { AgentRunner } from '@directive-run/ai';
import OpenAI from 'openai';

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is required');

const openai = new OpenAI({ apiKey });

const runner: AgentRunner = async (agent, input, options) => {
  const response = await openai.chat.completions.create({
    model: agent.model ?? 'gpt-4',
    messages: [
      { role: 'system', content: agent.instructions ?? '' },
      { role: 'user', content: input },
    ],
    signal: options?.signal,
  });

  const output = response.choices[0]?.message?.content ?? '';
  const totalTokens = response.usage?.total_tokens ?? 0;

  return { output, totalTokens };
};
```

---

## Step 3: Create the Orchestrator

```typescript
import {
  createMultiAgentOrchestrator,
  sequential,
  createPIIGuardrail,
} from '@directive-run/ai';

const orchestrator = createMultiAgentOrchestrator({
  runner,

  agents: {
    researcher: { agent: researcher, maxConcurrent: 2 },
    writer: { agent: writer },
    reviewer: { agent: reviewer },
  },

  // Orchestrator-level guardrails (applied to all agents)
  guardrails: {
    input: [createPIIGuardrail({ redact: true })],
  },

  // Named execution pattern
  patterns: {
    pipeline: sequential(['researcher', 'writer', 'reviewer']),
  },

  // Token budget
  maxTokenBudget: 50000,
  budgetWarningThreshold: 0.8,
  onBudgetWarning: ({ percentage }) => {
    console.warn(`Budget: ${(percentage * 100).toFixed(0)}% used`);
  },

  // Enable debugging
  debug: true,
});
```

---

## Step 4: Run the Pipeline

```typescript
const result = await orchestrator.runPattern('pipeline', 'Explain WebAssembly');

console.log('Output:', result.output);
console.log('Tokens:', result.totalTokens);
```

The sequential pattern passes each agent's output as input to the next:

```
researcher receives: "Explain WebAssembly"
    ↓ output becomes input
writer receives: [researcher's findings]
    ↓ output becomes input
reviewer receives: [writer's draft]
    ↓ final output
result.output = [reviewer's feedback or "APPROVED"]
```

---

## Step 5: Add Streaming

Stream tokens as they arrive instead of waiting for the full response:

```typescript
const { stream, result } = orchestrator.runAgentStream<string>(
  'writer',
  'Write about WebAssembly based on these notes: ...'
);

for await (const chunk of stream) {
  if (chunk.type === 'token') {
    process.stdout.write(chunk.data);
  }
}

const final = await result;
console.log(`\nTotal tokens: ${final.totalTokens}`);
```

---

## Step 6: Inspect the Timeline

With `debug: true`, every agent run, guardrail check, and pattern step is recorded:

```typescript
const timeline = orchestrator.timeline!;

// See all events
const events = timeline.getEvents();
console.log(`${events.length} events recorded`);

// Per-agent breakdown
const researcherEvents = timeline.getEventsForAgent('researcher');
const writerEvents = timeline.getEventsForAgent('writer');

// Check for errors
const errors = timeline.getEventsByType('agent_error');
if (errors.length > 0) {
  console.error('Errors:', errors.map((e) => e.errorMessage));
}
```

---

## Step 7: Connect DevTools (Optional)

Visualize the pipeline in the DevTools UI:

```typescript
import { connectDevTools } from '@directive-run/ai';

const devtools = await connectDevTools(orchestrator, { port: 4040 });
console.log('DevTools: ws://localhost:4040');

// Run your pipeline – events stream to the DevTools UI in real time
await orchestrator.runPattern('pipeline', 'Explain WebAssembly');

// Clean up
devtools.close();
```

Open the DevTools UI and watch agents execute in the Timeline view, inspect state in the State view, and review costs in the Cost view.

---

## Step 8: Add Constraints

Make the system smarter with declarative rules:

```typescript
import { requirementGuard } from '@directive-run/core/adapter-utils';

const orchestrator = createMultiAgentOrchestrator({
  // ... previous config ...

  constraints: {
    qualityGate: {
      when: (facts) => {
        const output = String(facts.reviewer?.__agent?.output ?? '');

        return !output.includes('APPROVED');
      },
      require: { type: 'REVISION_NEEDED' },
    },
  },

  resolvers: {
    revisionNeeded: {
      requirement: requirementGuard('REVISION_NEEDED'),
      resolve: async (req, context) => {
        console.log('Reviewer requested revisions – re-running writer');
      },
    },
  },
});
```

---

## Complete Example

```typescript
import {
  createMultiAgentOrchestrator,
  sequential,
  createPIIGuardrail,
  connectDevTools,
} from '@directive-run/ai';
import type { AgentLike, AgentRunner } from '@directive-run/ai';

// Agents
const researcher: AgentLike = { name: 'researcher', instructions: '...', model: 'gpt-4' };
const writer: AgentLike = { name: 'writer', instructions: '...', model: 'gpt-4' };
const reviewer: AgentLike = { name: 'reviewer', instructions: '...', model: 'gpt-4' };

// Runner (plug in your LLM SDK)
const runner: AgentRunner = async (agent, input, options) => {
  // ... your LLM call here ...
  return { output: '...', totalTokens: 0 };
};

// Orchestrator
const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: {
    researcher: { agent: researcher, maxConcurrent: 2 },
    writer: { agent: writer },
    reviewer: { agent: reviewer },
  },
  guardrails: { input: [createPIIGuardrail({ redact: true })] },
  patterns: { pipeline: sequential(['researcher', 'writer', 'reviewer']) },
  maxTokenBudget: 50000,
  debug: true,
});

// Optional: DevTools
const devtools = await connectDevTools(orchestrator, { port: 4040 });

// Run
try {
  const result = await orchestrator.runPattern('pipeline', 'Explain WebAssembly');
  console.log(result.output);
} finally {
  devtools.close();
  orchestrator.dispose();
}
```

---

## Common Errors

### `Unknown agent`

```
[Directive MultiAgent] Unknown agent "reasearcher". Registered agents: researcher, writer, reviewer
```

The agent ID passed to `runAgent()` or referenced in a pattern must match a key in the `agents` map. Check for typos.

### `API key missing or invalid`

Your `AgentRunner` receives the raw error from your LLM SDK. Ensure the API key is set:

```typescript
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
```

### `Guardrail blocked the request`

```typescript
import { isGuardrailError } from '@directive-run/ai';

try {
  await orchestrator.runPattern('pipeline', input);
} catch (error) {
  if (isGuardrailError(error)) {
    console.log(error.guardrailName, error.userMessage);
  }
}
```

See [Guardrails &rarr; Error Handling](/ai/guardrails#error-handling) for the full `GuardrailError` shape.

### `Budget exceeded`

When `maxTokenBudget` is reached, subsequent runs throw. Check `orchestrator.totalTokens` to track usage, and increase the budget or reduce agent calls.

---

## Next Steps

- [Execution Patterns](/ai/patterns) &ndash; Try parallel, DAG, race, reflect, and debate
- [Guardrails](/ai/guardrails) &ndash; Add output validation and tool-call filtering
- [Memory](/ai/memory) &ndash; Add conversation context management
- [Cross-Agent State](/ai/cross-agent-state) &ndash; Share state between agents
- [Evals](/ai/evals) &ndash; Measure quality with dataset-driven evaluation
