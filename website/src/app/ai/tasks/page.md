---
title: Tasks
description: Register imperative code alongside agents in any execution pattern.
---

Register imperative code tasks alongside LLM agents. Tasks and agents share the same ID namespace, so they work in any execution pattern – DAG, Sequential, Parallel, Race, or any other. {% .lead %}

---

## The Problem

Real pipelines need imperative code between agent runs: data transforms, API calls, validation logic, state machine transitions. Without tasks, you're forced to use `transform` functions or lifecycle hooks – which are invisible in the DevTools Agent Graph.

## The Solution

Register tasks at the orchestrator level. They appear as first-class nodes in the graph, emit timeline events, and participate in breakpoints and checkpoints alongside agents.

```typescript
import { createMultiAgentOrchestrator, dag } from '@directive-run/ai'

const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: {
    researcher: { agent: researchAgent },
    writer: { agent: writerAgent },
  },
  tasks: {
    transform: {
      run: async (input, signal, context) => {
        context.reportProgress(25, 'Parsing research');
        const data = JSON.parse(input);

        context.reportProgress(75, 'Normalizing');
        const normalized = { ...data, processed: true };

        context.reportProgress(100, 'Complete');
        return normalized; // Non-string returns are JSON.stringify'd
      },
      label: 'Data Transform',
      description: 'Parses and normalizes research data',
    },
  },
  patterns: {
    pipeline: dag({
      research: { handler: 'researcher' },
      process: { handler: 'transform', deps: ['research'] },
      write: { handler: 'writer', deps: ['process'] },
    }),
  },
})
```

## TaskRegistration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `run` | `(input, signal, context) => unknown \| Promise<unknown>` | required | The function to execute |
| `label` | `string` | task ID | Display label for DevTools graph |
| `description` | `string` | – | DevTools tooltip/detail panel text |
| `timeout` | `number` | – | Abort after this many milliseconds |
| `maxConcurrent` | `number` | `1` | Max parallel executions (semaphore) |
| `retry` | `object` | – | `{ attempts, backoff?, delayMs? }` |

### Retry Configuration

```typescript
tasks: {
  validate: {
    run: async (input) => {
      const data = JSON.parse(input);
      if (!data.result) {
        throw new Error('Missing result');
      }
      return input;
    },
    retry: {
      attempts: 3,           // Including first try
      backoff: 'exponential', // 'fixed' | 'exponential'
      delayMs: 500,           // Base delay between retries
    },
  },
}
```

Each retry emits a `task_error` timeline event with the `attempt` number before retrying. Only the final failure propagates to the pattern's error strategy.

## TaskContext

Task functions receive a `TaskContext` as the third argument:

```typescript
run: async (input: string, signal: AbortSignal, context: TaskContext) => {
  // Read-only memory snapshot
  const messages = context.memory;

  // Read-only scratchpad snapshot
  const topic = context.scratchpad.topic;

  // Read upstream agent state
  const researcherState = context.readAgentState('researcher');
  console.log(researcherState?.lastOutput);

  // Report progress (emits task_progress timeline events)
  context.reportProgress(50, 'Halfway done');

  return result;
}
```

| Property | Type | Description |
|----------|------|-------------|
| `taskId` | `string` | This task's registered ID |
| `memory` | `ReadonlyArray<{ role, content }>` | Conversation history snapshot |
| `scratchpad` | `Readonly<Record<string, unknown>>` | Scratchpad state snapshot |
| `readAgentState` | `(nodeId) => { status, lastOutput?, lastError?, totalTokens } \| undefined` | Read any agent or task's state |
| `reportProgress` | `(percent, message?) => void` | Emit progress to DevTools |

## Tasks in Every Pattern

Tasks work in any pattern position. The `handler` field references IDs from both the `agents` and `tasks` registries – patterns don't know or care which is which.

### DAG

```typescript
dag({
  classify: { handler: 'classifier' },                     // agent
  transform: { handler: 'transform', deps: ['classify'] }, // task
  analyze: { handler: 'analyzer', deps: ['transform'] },   // agent
})
```

### Sequential

```typescript
sequential(['classifier', 'transform', 'writer'])
// Output of each step feeds as input to the next
```

### Parallel

```typescript
parallel(
  ['transform', 'validate'], // Both tasks run concurrently
  (results) => results.map(r => String(r.output)).join('\n'),
)
```

### Supervisor

Tasks can be workers – the supervisor delegates to them like any agent:

```typescript
supervisor('manager', ['researcher', 'transform', 'writer'], {
  maxRounds: 5,
})
// Supervisor can delegate: { action: "delegate", worker: "transform", workerInput: "..." }
```

### Race

Tasks compete alongside agents – the first to complete wins:

```typescript
race(['fast-transform', 'slow-transform', 'fallback-agent'], {
  timeout: 5000,
})
```

### Reflect

A task can be the handler or the evaluator:

```typescript
// Task as evaluator – score output with imperative logic instead of an LLM
reflect('writer', 'validate-score', {
  maxIterations: 3,
  threshold: 0.8,
})
```

### Debate

Tasks can participate as debaters or serve as the judge:

```typescript
debate({
  handlers: ['optimist', 'pessimist', 'score-proposals'], // task as debater
  evaluator: 'judge',
  maxRounds: 2,
})
```

### Goal

Tasks produce and require facts like agents:

```typescript
goal(
  {
    fetch: {
      handler: 'fetcher',         // agent
      produces: ['raw_data'],
      extractOutput: (r) => ({ raw_data: r.output }),
    },
    normalize: {
      handler: 'normalize-task',  // task
      produces: ['clean_data'],
      requires: ['raw_data'],
      extractOutput: (r) => ({ clean_data: r.output }),
    },
    analyze: {
      handler: 'analyzer',       // agent
      produces: ['analysis'],
      requires: ['clean_data'],
      extractOutput: (r) => ({ analysis: r.output }),
    },
  },
  (facts) => facts.analysis != null,
  { maxSteps: 5, extract: (facts) => facts.analysis },
)
```

## Dynamic Registration

```typescript
orchestrator.registerTask('newTask', {
  run: async (input) => JSON.stringify({ result: input }),
  label: 'New Task',
});

orchestrator.unregisterTask('newTask');
orchestrator.getTaskIds();    // All registered task IDs
orchestrator.getTaskState('transform'); // { status, lastOutput, lastError, ... }
```

Task and agent IDs share a namespace – registering a task with an existing agent ID (or vice versa) throws an error.

## What Tasks Don't Do

- **No token budgeting** – Tasks don't call LLMs. `totalTokens` is always 0.
- **No self-healing reroute** – Tasks aren't reroutable. Use `retry` instead.
- **No `runSingleAgent` access** – If a task needs to call an agent, make it a separate node.
- **No guardrail enforcement** – Tasks bypass input/output guardrails (they're imperative code, not LLM calls).

## Related

- [Execution Patterns](/ai/patterns) – All 8 patterns support tasks
- [Multi-Agent Orchestrator](/ai/multi-agent) – Task registration API
- [DAG Pipeline Guide](/ai/guides/dag-pipeline) – Adding tasks to DAGs
- [Data Pipeline Example](/ai/examples/data-pipeline) – Live demo with mixed agents + tasks
- [DevTools](/ai/devtools) – Task node visualization
