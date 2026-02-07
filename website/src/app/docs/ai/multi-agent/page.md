---
title: Multi-Agent
description: Orchestrate multiple AI agents with parallel, sequential, and supervisor patterns.
---

Coordinate multiple agents with execution patterns, handoffs, and result merging. {% .lead %}

---

## Setup

Multi-agent orchestration builds on the [OpenAI Agents](/docs/ai/openai-agents) adapter. Start by defining your agents and a run function, then register them in an orchestrator:

```typescript
import {
  createMultiAgentOrchestrator,
  parallel,
  sequential,
  supervisor,
  concatResults,
  collectOutputs,
  aggregateTokens,
} from 'directive/openai-agents';
import type { AgentLike, RunFn, RunResult } from 'directive/openai-agents';

// Define your agents (compatible with OpenAI Agents SDK)
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

// Your run function (wraps the OpenAI Agents SDK `run` call)
const run: RunFn = async (agent, input, options) => {
  // Replace with your actual OpenAI Agents SDK call
  const result = await openaiAgentsRun(agent, input, options);
  return result;
};
```

---

## Creating the Orchestrator

Register agents with concurrency limits, timeouts, and capabilities. Optionally define reusable execution patterns:

```typescript
const orchestrator = createMultiAgentOrchestrator({
  runAgent: run,

  // Agent registry — each agent gets concurrency control and metadata
  agents: {
    researcher: {
      agent: researcher,
      maxConcurrent: 3,    // Allow 3 parallel research runs
      timeout: 30000,       // 30s timeout per run
      capabilities: ['search', 'summarize'],
    },
    writer: {
      agent: writer,
      maxConcurrent: 1,     // Only one writer at a time
      timeout: 60000,
    },
    reviewer: {
      agent: reviewer,
      maxConcurrent: 1,
      timeout: 30000,
    },
  },

  // Reusable execution patterns (optional)
  patterns: {
    research: parallel(
      ['researcher', 'researcher', 'researcher'],
      (results) => concatResults(results, '\n\n---\n\n'),
      { minSuccess: 2 }  // Need at least 2 of 3 to succeed
    ),

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

The simplest operation — run one registered agent with concurrency control and timeouts handled automatically:

```typescript
const result = await orchestrator.runAgent<string>('researcher', 'What is WebAssembly?');

console.log(result.finalOutput);   // The agent's response
console.log(result.totalTokens);   // Token usage
```

If the researcher's `maxConcurrent: 3` slots are all occupied, the call waits until a slot opens (no polling — uses an async semaphore internally).

---

## Parallel Execution

Run multiple agents at the same time and merge their results. Two ways to do this:

### Using a named pattern

```typescript
// Runs 3 researchers in parallel, merges their outputs
const research = await orchestrator.runPattern<string>(
  'research',
  'Explain the benefits of constraint-driven architecture'
);

// research = concatenated outputs from all 3, separated by ---
```

### Using `runParallel` directly

For one-off parallel runs without defining a pattern:

```typescript
// Same input to all agents
const combined = await orchestrator.runParallel(
  ['researcher', 'researcher'],
  'What are WebSockets?',  // broadcast to both
  (results) => concatResults(results)
);

// Different inputs per agent
const answers = await orchestrator.runParallel(
  ['researcher', 'researcher', 'researcher'],
  ['Explain REST', 'Explain GraphQL', 'Explain gRPC'],
  (results) => collectOutputs(results)  // returns string[]
);
```

---

## Sequential Pipelines

Chain agents so each one's output feeds into the next:

### Using a named pattern

```typescript
// Writer drafts, then reviewer reviews the draft
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
    // Customize how each agent's output becomes the next agent's input
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

// results is an array of RunResult for each step
const finalReview = results[results.length - 1].finalOutput;
const totalTokens = aggregateTokens(results);
```

By default, if any agent in the sequence fails the entire pipeline throws. The `continueOnError` option on a `sequential()` pattern lets you skip failures.

---

## Supervisor Pattern

A supervisor agent delegates work to workers in a loop. The supervisor decides what to do next based on worker results:

```typescript
const manager: AgentLike = {
  name: 'manager',
  instructions: `You are a project manager. Analyze the request and delegate to workers.
    Respond with JSON: { "action": "delegate", "worker": "researcher"|"writer", "workerInput": "..." }
    Or when done: { "action": "complete", "finalOutput": "..." }`,
  model: 'gpt-4',
};

const orchestrator = createMultiAgentOrchestrator({
  runAgent: run,
  agents: {
    manager: { agent: manager, maxConcurrent: 1 },
    researcher: { agent: researcher, maxConcurrent: 3 },
    writer: { agent: writer, maxConcurrent: 1 },
  },
  patterns: {
    managed: supervisor('manager', ['researcher', 'writer'], {
      maxRounds: 5,
      extract: (supervisorOutput, workerResults) => ({
        answer: supervisorOutput,
        sources: collectOutputs(workerResults),
        tokens: aggregateTokens(workerResults),
      }),
    }),
  },
});

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
  runAgent: run,
  agents: {
    researcher: { agent: researcher, maxConcurrent: 3 },
    writer: { agent: writer, maxConcurrent: 1 },
    reviewer: { agent: reviewer, maxConcurrent: 1 },
  },

  // Observe handoffs
  onHandoff: (request) => {
    console.log(`Handoff: ${request.fromAgent} → ${request.toAgent}`);
  },
  onHandoffComplete: (result) => {
    console.log(`Handoff complete in ${result.completedAt - result.request.requestedAt}ms`);
  },
});

// Research, then hand off to writer, then to reviewer
const research = await orchestrator.runAgent('researcher', 'What is Directive?');
const draft = await orchestrator.handoff(
  'researcher', 'writer',
  `Write an article based on this research:\n\n${research.finalOutput}`
);
const review = await orchestrator.handoff(
  'writer', 'reviewer',
  `Review this article:\n\n${draft.finalOutput}`
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
} from 'directive/openai-agents';

// Concatenate string outputs with a separator
const merged = concatResults(results, '\n\n');

// Collect all outputs into an array
const outputs = collectOutputs(results);  // T[]

// Pick the best result using a scoring function
const best = pickBestResult(results, (r) => {
  // Score by output length (or confidence, quality, etc.)
  return typeof r.finalOutput === 'string' ? r.finalOutput.length : 0;
});

// Sum up token usage across all results
const totalTokens = aggregateTokens(results);
```

---

## Agent State

Track what each agent is doing:

```typescript
// Single agent state
const state = orchestrator.getAgentState('researcher');
console.log(state.status);      // 'idle' | 'running' | 'completed' | 'error'
console.log(state.runCount);    // How many times this agent has run
console.log(state.totalTokens); // Cumulative token usage

// All agent states
const allStates = orchestrator.getAllAgentStates();
for (const [id, s] of Object.entries(allStates)) {
  console.log(`${id}: ${s.status} (${s.runCount} runs, ${s.totalTokens} tokens)`);
}

// Reset everything
orchestrator.reset();
```

---

## Next Steps

- See [OpenAI Agents](/docs/ai/openai-agents) for single agent patterns and constraints
- See [Guardrails](/docs/ai/guardrails) for input/output validation
- See [Streaming](/docs/ai/streaming) for real-time updates
