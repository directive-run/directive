---
title: 'Guide: Goal-Directed Pipeline'
description: Build an adaptive pipeline where the runtime infers execution order from dependency declarations and drives toward a goal condition.
---

Build a pipeline that declares what it needs, not how to run. {% .lead %}

The goal pattern infers agent execution order from `produces`/`requires` declarations and drives toward a `when()` condition. Use it when you want the runtime to handle ordering, stall detection, and progress tracking automatically.

---

## When to Use Goal vs DAG

| | DAG | Goal |
|---|-----|------|
| **Topology** | Static – you wire edges with `deps` | Dynamic – inferred from `produces`/`requires` |
| **Completion** | All nodes run | `when()` condition is met |
| **Stall handling** | None | Progressive relaxation |
| **Progress** | Node count | Satisfaction score (0–1) |

Use **DAG** when you know the exact execution order. Use **Goal** when you want the runtime to figure it out.

---

## Step 1: Define Agents

```typescript
import type { AgentLike, AgentRunner } from '@directive-run/ai';

const researcher: AgentLike = {
  name: 'researcher',
  instructions: 'Research the given topic. Return key findings as a structured summary.',
  model: 'gpt-4',
};

const analyst: AgentLike = {
  name: 'analyst',
  instructions: 'Analyze the research findings. Return insights and recommendations.',
  model: 'gpt-4',
};

const writer: AgentLike = {
  name: 'writer',
  instructions: 'Write a report from the analysis. Return the final report text.',
  model: 'gpt-4',
};
```

---

## Step 2: Create the Orchestrator

```typescript
import { createMultiAgentOrchestrator, goal } from '@directive-run/ai';

const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: {
    researcher: { agent: researcher },
    analyst: { agent: analyst },
    writer: { agent: writer },
  },
});
```

---

## Step 3: Run the Goal

```typescript
const result = await orchestrator.runGoal(
  // Node declarations: what each agent produces and requires
  {
    researcher: {
      handler: 'researcher',
      produces: ['findings'],
      extractOutput: (r) => ({ findings: r.output }),
    },
    analyst: {
      handler: 'analyst',
      produces: ['analysis'],
      requires: ['findings'],
      buildInput: (facts) => `Analyze these findings: ${facts.findings}`,
      extractOutput: (r) => ({ analysis: r.output }),
    },
    writer: {
      handler: 'writer',
      produces: ['report'],
      requires: ['analysis'],
      buildInput: (facts) => `Write a report from this analysis: ${facts.analysis}`,
      extractOutput: (r) => ({ report: r.output }),
    },
  },

  // Initial facts (seed input)
  { topic: 'AI safety trends in 2026' },

  // Goal condition – stop when this returns true
  (facts) => facts.report != null,

  // Options
  {
    maxSteps: 10,
    extract: (facts) => facts.report,
  },
);

console.log(result.output);
```

The runtime:
1. Checks which nodes have their `requires` satisfied
2. Runs ready nodes in parallel
3. Merges `extractOutput` results into the fact pool
4. Checks the `when()` goal condition
5. Repeats until goal is met or `maxSteps` is reached

---

## Step 4: Add Checkpointing

Save progress so you can resume after failures:

```typescript
import { InMemoryCheckpointStore } from '@directive-run/ai';

const store = new InMemoryCheckpointStore({ maxCheckpoints: 20 });

const result = await orchestrator.runGoal(
  nodes,
  { topic: 'AI safety' },
  (facts) => facts.report != null,
  {
    maxSteps: 10,
    extract: (facts) => facts.report,
    checkpoint: { everyN: 1, store },
  },
);
```

Resume from a checkpoint:

```typescript
const checkpoint = await store.load(checkpointId);
const state = JSON.parse(checkpoint.systemExport);
await orchestrator.resumeGoal(state, { nodes, when: goalCondition });
```

---

## Step 5: Track Progress

```typescript
import { getCheckpointProgress } from '@directive-run/ai';

const progress = getCheckpointProgress(checkpointState);
console.log(`${progress.percentage}% complete`);
console.log(`${progress.stepsCompleted} steps, ${progress.tokensConsumed} tokens`);
```

---

## Named Goal Pattern

Register the goal as a reusable pattern:

```typescript
const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: {
    researcher: { agent: researcher },
    analyst: { agent: analyst },
    writer: { agent: writer },
  },
  patterns: {
    report: goal(
      {
        researcher: {
          handler: 'researcher',
          produces: ['findings'],
          extractOutput: (r) => ({ findings: r.output }),
        },
        analyst: {
          handler: 'analyst',
          produces: ['analysis'],
          requires: ['findings'],
          extractOutput: (r) => ({ analysis: r.output }),
        },
        writer: {
          handler: 'writer',
          produces: ['report'],
          requires: ['analysis'],
          extractOutput: (r) => ({ report: r.output }),
        },
      },
      (facts) => facts.report != null,
      { maxSteps: 10, extract: (facts) => facts.report },
    ),
  },
});

const result = await orchestrator.runPattern('report', 'AI safety trends');
```

---

## GoalNode Options

| Field | Type | Description |
|-------|------|-------------|
| `handler` | `string` | Agent ID from the registry |
| `produces` | `string[]` | Fact keys this node writes |
| `requires` | `string[]` | Fact keys this node needs (must be produced by other nodes) |
| `extractOutput` | `(result) => Record<string, unknown>` | Map agent output to fact keys |
| `buildInput` | `(facts) => string` | Build agent input from current facts |
| `allowRerun` | `boolean` | Allow the node to run again if goal is not yet met |
| `maxRuns` | `number` | Maximum times this node can execute |

---

## Next Steps

- [Execution Patterns](/ai/patterns#goal) &ndash; Full goal pattern reference
- [Pattern Checkpoints](/ai/checkpoints) &ndash; Save/resume, fork, progress tracking
- [DAG Pipeline](/ai/guides/dag-pipeline) &ndash; Static dependency graphs
