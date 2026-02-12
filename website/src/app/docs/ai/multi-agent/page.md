---
title: Multi-Agent
description: Orchestrate multiple AI agents with parallel, sequential, and supervisor patterns.
---

Coordinate multiple agents with execution patterns, handoffs, and result merging. {% .lead %}

---

## Setup

Multi-agent orchestration builds on the [Agent Orchestrator](/docs/ai/orchestrator) adapter. Start by defining your agents and a run function, then register them in an orchestrator:

```typescript
import {
  createMultiAgentOrchestrator,
  parallel,
  sequential,
  supervisor,
  concatResults,
  collectOutputs,
  aggregateTokens,
} from 'directive/ai';
import type { AgentLike, AgentRunner, RunResult } from 'directive/ai';

// Define specialized agents – each has a distinct role in the pipeline
const researcher: AgentLike = {
  name: 'researcher',
  instructions: 'You are a research assistant. Find relevant information on the given topic.',
  model: 'gpt-4',
};

const writer: AgentLike = {
  name: 'writer',
  instructions: 'You are a technical writer. Write clear, concise content from research notes.',
  model: 'gpt-4',
};

const reviewer: AgentLike = {
  name: 'reviewer',
  instructions: 'You review drafts for accuracy and clarity. Return "approve" or revision notes.',
  model: 'gpt-4',
};

// Wrap your LLM SDK in a standard runner function
const runner: AgentRunner = async (agent, input, options) => {
  const result = await openaiAgentsRun(agent, input, options);
  return result;
};
```

---

## Creating the Orchestrator

Register agents with concurrency limits, timeouts, and capabilities. Optionally define reusable execution patterns:

```typescript
const orchestrator = createMultiAgentOrchestrator({
  runner,

  // Register each agent with concurrency limits and timeouts
  agents: {
    researcher: {
      agent: researcher,
      maxConcurrent: 3,               // Allow 3 parallel research runs
      timeout: 30000,                  // 30s timeout per run
      capabilities: ['search', 'summarize'],
    },
    writer: {
      agent: writer,
      maxConcurrent: 1,               // Only one writer at a time
      timeout: 60000,
    },
    reviewer: {
      agent: reviewer,
      maxConcurrent: 1,
      timeout: 30000,
    },
  },

  // Define reusable execution patterns
  patterns: {
    // Fan out to 3 researchers, merge their outputs with a separator
    research: parallel(
      ['researcher', 'researcher', 'researcher'],
      (results) => concatResults(results, '\n\n---\n\n'),
      { minSuccess: 2 }               // Succeed if at least 2 of 3 complete
    ),

    // Writer drafts, then reviewer checks – output flows from one to the next
    writeAndReview: sequential(
      ['writer', 'reviewer'],
      {
        transform: (output, agentId) =>
          agentId === 'writer'
            ? `Review this draft for accuracy:\n\n${output}`
            : String(output),
      }
    ),
  },
});
```

The orchestrator validates that all patterns reference registered agents. If a pattern references `'editor'` but no agent with that ID is registered, it throws immediately.

---

## Running a Single Agent

The simplest operation – run one registered agent with concurrency control and timeouts handled automatically:

```typescript
// Run a single registered agent – concurrency and timeouts are handled automatically
const result = await orchestrator.runAgent<string>('researcher', 'What is WebAssembly?');

console.log(result.output);       // The agent's response
console.log(result.totalTokens);  // Token usage
```

If the researcher's `maxConcurrent: 3` slots are all occupied, the call waits until a slot opens (no polling – uses an async semaphore internally).

---

## Parallel Execution

Run multiple agents at the same time and merge their results. Two ways to do this:

### Using a named pattern

```typescript
// Execute the named "research" pattern – fans out to 3 researchers
const research = await orchestrator.runPattern<string>(
  'research',
  'Explain the benefits of constraint-driven architecture'
);
// Result is the concatenated outputs from all 3, separated by ---
```

### Using `runParallel` directly

For one-off parallel runs without defining a pattern:

```typescript
// Broadcast the same input to multiple agents
const combined = await orchestrator.runParallel(
  ['researcher', 'researcher'],
  'What are WebSockets?',
  (results) => concatResults(results)
);

// Send different inputs to each agent in parallel
const answers = await orchestrator.runParallel(
  ['researcher', 'researcher', 'researcher'],
  ['Explain REST', 'Explain GraphQL', 'Explain gRPC'],
  (results) => collectOutputs(results)  // Returns string[]
);
```

---

## Sequential Pipelines

Chain agents so each one's output feeds into the next:

### Using a named pattern

```typescript
// Execute the named pipeline – writer drafts, reviewer checks the draft
const results = await orchestrator.runPattern<string>(
  'writeAndReview',
  'Write a guide to Directive multi-agent orchestration'
);
```

### Using `runSequential` directly

```typescript
const results = await orchestrator.runSequential<string>(
  ['researcher', 'writer', 'reviewer'],
  'Create a blog post about AI safety',
  {
    // Shape how each agent's output becomes the next agent's input
    transform: (output, agentId, index) => {
      if (agentId === 'researcher') {
        return `Write a blog post based on this research:\n\n${output}`;
      }
      if (agentId === 'writer') {
        return `Review this blog post draft:\n\n${output}`;
      }
      return String(output);
    },
  }
);

// Each step's RunResult is available in the array
const finalReview = results[results.length - 1].output;
const totalTokens = aggregateTokens(results);  // Sum tokens across the pipeline
```

By default, if any agent in the sequence fails the entire pipeline throws. The `continueOnError` option on a `sequential()` pattern lets you skip failures.

---

## Supervisor Pattern

A supervisor agent delegates work to workers in a loop. The supervisor decides what to do next based on worker results:

```typescript
// The supervisor decides which workers to call and when the task is complete
const manager: AgentLike = {
  name: 'manager',
  instructions: `You are a project manager. Analyze the request and delegate to workers.
    Respond with JSON: { "action": "delegate", "worker": "researcher"|"writer", "workerInput": "..." }
    Or when done: { "action": "complete", "output": "..." }`,
  model: 'gpt-4',
};

const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: {
    manager: { agent: manager, maxConcurrent: 1 },
    researcher: { agent: researcher, maxConcurrent: 3 },
    writer: { agent: writer, maxConcurrent: 1 },
  },

  patterns: {
    // Supervisor loop – manager delegates, workers execute, results feed back
    managed: supervisor('manager', ['researcher', 'writer'], {
      maxRounds: 5,    // Safety limit to prevent infinite delegation loops
      extract: (supervisorOutput, workerResults) => ({
        answer: supervisorOutput,
        sources: collectOutputs(workerResults),
        tokens: aggregateTokens(workerResults),
      }),
    }),
  },
});

// Kick off the supervised workflow
const result = await orchestrator.runPattern('managed', 'Research and write about WASM');
```

The supervisor loop:
1. Runs the supervisor with the initial input
2. If supervisor returns `{ action: "delegate", worker: "researcher", workerInput: "..." }`, runs that worker
3. Feeds worker result back to supervisor: `"Worker researcher completed with result: ..."`
4. Repeats until supervisor returns `{ action: "complete" }` or `maxRounds` is reached

---

## Handoffs

Transfer work from one agent to another with tracking:

```typescript
const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: {
    researcher: { agent: researcher, maxConcurrent: 3 },
    writer: { agent: writer, maxConcurrent: 1 },
    reviewer: { agent: reviewer, maxConcurrent: 1 },
  },

  // Observe each handoff for logging or metrics
  onHandoff: (request) => {
    console.log(`Handoff: ${request.fromAgent} → ${request.toAgent}`);
  },
  onHandoffComplete: (result) => {
    console.log(`Handoff complete in ${result.completedAt - result.request.requestedAt}ms`);
  },
});

// Chain agents together with explicit handoffs
const research = await orchestrator.runAgent('researcher', 'What is Directive?');

const draft = await orchestrator.handoff(
  'researcher', 'writer',
  `Write an article based on this research:\n\n${research.output}`
);

const review = await orchestrator.handoff(
  'writer', 'reviewer',
  `Review this article:\n\n${draft.output}`
);
```

Handoffs are tracked with unique IDs. Query pending handoffs with `orchestrator.getPendingHandoffs()`.

---

## Result Merging Utilities

Four built-in helpers for combining results from parallel runs:

```typescript
import {
  concatResults,
  collectOutputs,
  pickBestResult,
  aggregateTokens,
} from 'directive/ai';

// Join all string outputs with a separator
const merged = concatResults(results, '\n\n');

// Gather every output into an array
const outputs = collectOutputs(results);  // T[]

// Select the single best result using a custom scoring function
const best = pickBestResult(results, (r) => {
  return typeof r.output === 'string' ? r.output.length : 0;
});

// Sum token usage across every result in the batch
const totalTokens = aggregateTokens(results);
```

---

## Agent State

Track what each agent is doing:

```typescript
// Inspect a single agent's current state
const state = orchestrator.getAgentState('researcher');
console.log(state.status);      // 'idle' | 'running' | 'completed' | 'error'
console.log(state.runCount);    // How many times this agent has run
console.log(state.totalTokens); // Cumulative token usage

// Iterate over all registered agents
const allStates = orchestrator.getAllAgentStates();
for (const [id, s] of Object.entries(allStates)) {
  console.log(`${id}: ${s.status} (${s.runCount} runs, ${s.totalTokens} tokens)`);
}

// Clear all state for every agent
orchestrator.reset();
```

---

## Framework Integration

Track multi-agent state through the orchestrator's `.system`. The `__agent` bridge key holds the active agent status.

### React

```tsx
import { useAgentOrchestrator, useFact, useSelector } from 'directive/react';

function MultiAgentPanel() {
  const orchestrator = useAgentOrchestrator({ runner, autoApproveToolCalls: true });
  const { system } = orchestrator;

  const agent = useFact(system, '__agent');
  const summary = useSelector(system, (facts) => ({
    status: facts.__agent?.status,
    tokens: facts.__agent?.tokenUsage,
  }));

  return (
    <div>
      <p>Status: {agent?.status}</p>
      <p>Tokens: {summary.tokens}</p>
    </div>
  );
}
```

### Vue

```html
<script setup>
import { createMultiAgentOrchestrator } from 'directive/ai';
import { useFact, useInspect } from 'directive/vue';
import { onUnmounted } from 'vue';

const orchestrator = createMultiAgentOrchestrator({ runner, agents: { /* ... */ } });
onUnmounted(() => orchestrator.dispose());

const agent = useFact(orchestrator.system, '__agent');
const { isSettled } = useInspect(orchestrator.system);
</script>

<template>
  <p>Status: {{ agent?.status }}</p>
  <p>{{ isSettled ? 'Idle' : 'Working...' }}</p>
</template>
```

### Svelte

```html
<script>
import { createMultiAgentOrchestrator } from 'directive/ai';
import { useFact, useInspect } from 'directive/svelte';
import { onDestroy } from 'svelte';

const orchestrator = createMultiAgentOrchestrator({ runner, agents: { /* ... */ } });
onDestroy(() => orchestrator.dispose());

const agent = useFact(orchestrator.system, '__agent');
const inspect = useInspect(orchestrator.system);
</script>

<p>Status: {$agent?.status}</p>
<p>{$inspect.isSettled ? 'Idle' : 'Working...'}</p>
```

### Solid

```tsx
import { createMultiAgentOrchestrator } from 'directive/ai';
import { useFact, useInspect } from 'directive/solid';
import { onCleanup } from 'solid-js';

function MultiAgentPanel() {
  const orchestrator = createMultiAgentOrchestrator({ runner, agents: { /* ... */ } });
  onCleanup(() => orchestrator.dispose());

  const agent = useFact(orchestrator.system, '__agent');
  const inspect = useInspect(orchestrator.system);

  return (
    <div>
      <p>Status: {agent()?.status}</p>
      <p>{inspect().isSettled ? 'Idle' : 'Working...'}</p>
    </div>
  );
}
```

### Lit

```typescript
import { LitElement, html } from 'lit';
import { createMultiAgentOrchestrator } from 'directive/ai';
import { FactController, InspectController } from 'directive/lit';

class MultiAgentPanel extends LitElement {
  private orchestrator = createMultiAgentOrchestrator({ runner, agents: { /* ... */ } });
  private agent = new FactController(this, this.orchestrator.system, '__agent');
  private inspect = new InspectController(this, this.orchestrator.system);

  disconnectedCallback() {
    super.disconnectedCallback();
    this.orchestrator.dispose();
  }

  render() {
    return html`
      <p>Status: ${this.agent.value?.status}</p>
      <p>${this.inspect.value?.isSettled ? 'Idle' : 'Working...'}</p>
    `;
  }
}
```

---

## Next Steps

- See [Agent Orchestrator](/docs/ai/orchestrator) for single agent patterns and constraints
- See [Guardrails](/docs/ai/guardrails) for input/output validation
- See [Streaming](/docs/ai/streaming) for real-time updates
