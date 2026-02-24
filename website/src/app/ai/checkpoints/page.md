---
title: Pattern Checkpoints
description: Save, resume, replay, fork, and track progress of long-running execution patterns across all 6 pattern types.
---

Save execution state mid-pattern for fault tolerance, resume from failures, fork workflows, and track progress. {% .lead %}

Pattern checkpoints capture the full internal state of any execution pattern at configurable intervals. If a process crashes, you resume exactly where you left off — no wasted tokens, no re-running completed agents.

---

## Quick Start

Add a `checkpoint` config to any pattern:

```typescript
import { createMultiAgentOrchestrator, sequential, InMemoryCheckpointStore } from '@directive-run/ai';

const store = new InMemoryCheckpointStore({ maxCheckpoints: 50 });

const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: {
    researcher: { agent: researcher },
    writer: { agent: writer },
    reviewer: { agent: reviewer },
  },
  checkpointStore: store,
});

// Checkpoint every 1 step
const result = await orchestrator.runPattern(
  'pipeline',
  'Write about AI safety',
);

// Or inline with checkpoint config:
const result2 = await orchestrator.runSequential(
  ['researcher', 'writer', 'reviewer'],
  'Write about AI safety',
  {
    checkpoint: { everyN: 1, store },
  },
);
```

---

## Supported Patterns

All 6 multi-step patterns support checkpointing:

| Pattern | Checkpoint granularity | State captured |
|---------|----------------------|----------------|
| `sequential` | Every N agents | Current step, accumulated results, current input |
| `supervisor` | Every N rounds | Round number, supervisor output, worker results |
| `reflect` | Every N iterations | Iteration count, history (scores, feedback), producer outputs |
| `debate` | Every N rounds | Round number, proposals, judgements, tokens consumed |
| `dag` | Every N completed nodes | Per-node statuses, outputs, errors, results |
| `goal` | Every N steps | Facts, completed nodes, failure counts, step metrics, relaxation state |

---

## Configuration

```typescript
interface PatternCheckpointConfig {
  /** Save a checkpoint every N steps/rounds/iterations. @default 5 */
  everyN?: number;
  /** Checkpoint store. Uses the orchestrator's store if not provided. */
  store?: CheckpointStore;
  /** Label prefix for checkpoints. @default pattern type name */
  labelPrefix?: string;
  /** Conditional: only save when this returns true */
  when?: (context: CheckpointContext) => boolean;
}
```

### Checkpoint Context

The `when` predicate receives a `CheckpointContext`:

```typescript
interface CheckpointContext {
  step: number;            // Current step/round/iteration
  patternType: string;     // "sequential", "supervisor", "reflect", etc.
  facts?: Record<string, unknown>;  // Goal pattern only
  satisfaction?: number;            // Goal pattern only (0-1)
}
```

---

## Per-Pattern Examples

### Sequential

```typescript
const result = await orchestrator.runSequential(
  ['researcher', 'writer', 'reviewer'],
  'Write about WASM',
  {
    checkpoint: { everyN: 1, labelPrefix: 'article-pipeline' },
  },
);
```

Captures: agent index, current input, results collected so far.

### Supervisor

```typescript
const result = await orchestrator.runSupervisor(
  'manager',
  ['researcher', 'writer'],
  'Research and write about AI',
  {
    maxRounds: 5,
    checkpoint: { everyN: 2 },
  },
);
```

Captures: round number, supervisor output, worker results, current input.

### Reflect

```typescript
const result = await orchestrator.runReflect(
  'writer',
  'evaluator',
  'Write a blog post',
  {
    maxIterations: 5,
    threshold: 0.8,
    checkpoint: { everyN: 1 },
  },
);
```

Captures: iteration, effective input, history (scores, feedback, durations), producer outputs.

### Debate

```typescript
const result = await orchestrator.runDebate(
  {
    agents: ['optimist', 'pessimist', 'realist'],
    evaluator: 'judge',
    maxRounds: 5,
    checkpoint: { everyN: 1 },
  },
  'Should we use microservices?',
);
```

Captures: round number, current input, proposals and judgements per round, tokens consumed.

### DAG

```typescript
const result = await orchestrator.runDag(
  {
    fetch: { agent: 'fetcher' },
    analyze: { agent: 'analyzer', deps: ['fetch'] },
    summarize: { agent: 'summarizer', deps: ['fetch'] },
    report: { agent: 'reporter', deps: ['analyze', 'summarize'] },
  },
  'Research AI safety',
  (context) => context.outputs.report,
  {
    checkpoint: { everyN: 2 },
  },
);
```

Captures: per-node statuses, outputs, errors, node results, completed count, original input.

### Goal

```typescript
const result = await orchestrator.runGoal(
  {
    fetcher: { agent: 'fetcher', produces: ['data'] },
    analyzer: { agent: 'analyzer', produces: ['analysis'], requires: ['data'] },
  },
  { query: 'market trends' },
  (facts) => facts.analysis != null,
  {
    checkpoint: {
      everyN: 3,
      labelPrefix: 'market-analysis',
      when: (context) => (context.satisfaction ?? 0) > 0.3,
    },
  },
);
```

Captures: facts snapshot, completed nodes, failure counts, node input hashes, execution order, step metrics, relaxation state, agent metrics.

---

## Checkpoint Store

### InMemoryCheckpointStore

Built-in in-memory store with configurable retention:

```typescript
import { InMemoryCheckpointStore } from '@directive-run/ai';

const store = new InMemoryCheckpointStore({ maxCheckpoints: 50 });

await store.save(checkpoint);
const loaded = await store.load(checkpoint.id);
const all = await store.list();
await store.delete(checkpoint.id);
await store.clear();
```

### Custom Store

Implement `CheckpointStore` for persistent backends (database, S3, Redis):

```typescript
import type { CheckpointStore, Checkpoint } from '@directive-run/ai';

const store: CheckpointStore = {
  save: async (checkpoint) => {
    await db.insert('checkpoints', checkpoint);

    return checkpoint.id;
  },
  load: async (id) => {
    return await db.findOne('checkpoints', { id });
  },
  list: async () => {
    return await db.find('checkpoints', {}, {
      select: ['id', 'label', 'createdAt'],
    });
  },
  delete: async (id) => {
    const deleted = await db.delete('checkpoints', { id });

    return deleted > 0;
  },
  clear: async () => {
    await db.deleteAll('checkpoints');
  },
};
```

---

## Resume

Each pattern has a dedicated `resume*` method that accepts the checkpoint state and the original pattern definition:

```typescript
// Load checkpoint
const checkpoint = await store.load(checkpointId);
const state = JSON.parse(checkpoint.systemExport);

// Resume based on pattern type
switch (state.type) {
  case 'sequential':
    await orchestrator.resumeSequential(state, pattern);
    break;
  case 'supervisor':
    await orchestrator.resumeSupervisor(state, pattern);
    break;
  case 'reflect':
    await orchestrator.resumeReflect(state, pattern);
    break;
  case 'debate':
    await orchestrator.resumeDebate(state, pattern);
    break;
  case 'dag':
    await orchestrator.resumeDag(state, pattern);
    break;
  case 'goal':
    await orchestrator.resumeGoal(state, pattern);
    break;
}
```

### Replay

`replay()` auto-detects the pattern type and resumes with optional input override:

```typescript
const result = await orchestrator.replay(
  checkpointId,
  pattern,
  { input: 'Modified input for this replay' },
);
```

This loads the checkpoint from the orchestrator's store, restores state, and continues execution from that point.

---

## Fork

Create an independent orchestrator from a checkpoint to explore alternative execution paths:

```typescript
import { forkFromCheckpoint } from '@directive-run/ai';

// Fork from a saved checkpoint
const forked = await forkFromCheckpoint(
  orchestratorOptions,
  store,
  'ckpt_abc123',
);

// The forked orchestrator is fully independent — changes don't affect the original
const result = await forked.runGoal(nodes, newInput, when);
```

The forked orchestrator receives a deep clone of the checkpoint state, so mutations in the fork never affect the original.

---

## Progress

Compute progress from any checkpoint state:

```typescript
import { getCheckpointProgress } from '@directive-run/ai';

const progress = getCheckpointProgress(checkpointState);

console.log(progress.percentage);              // 0-100
console.log(progress.stepsCompleted);          // Steps/rounds/iterations completed
console.log(progress.stepsTotal);              // Total expected (null for unbounded)
console.log(progress.tokensConsumed);          // Tokens used so far
console.log(progress.estimatedTokensRemaining); // Estimated remaining (null when unknowable)
console.log(progress.estimatedStepsRemaining);  // Estimated steps left (null when unknowable)
```

### Progress UI Example

```typescript
function renderProgress(state: PatternCheckpointState) {
  const progress = getCheckpointProgress(state);

  return `
    <div class="progress-bar" style="width: ${progress.percentage}%"></div>
    <span>${progress.stepsCompleted} / ${progress.stepsTotal ?? '?'} steps</span>
    <span>${progress.tokensConsumed.toLocaleString()} tokens</span>
  `;
}
```

### `getPatternStep`

Get the current step number from any checkpoint state:

```typescript
import { getPatternStep } from '@directive-run/ai';

const step = getPatternStep(checkpointState);
// Returns: step (sequential/goal), round (supervisor/debate),
//          iteration (reflect), completedCount (dag)
```

---

## Diff

Compare two checkpoint states to see what changed between them:

```typescript
import { diffCheckpoints } from '@directive-run/ai';

const diff = diffCheckpoints(checkpointA, checkpointB);

console.log(diff.patternType);    // Pattern type
console.log(diff.stepDelta);      // Steps advanced
console.log(diff.tokensDelta);    // Tokens consumed between checkpoints

// Goal-specific: fact changes
if (diff.facts) {
  console.log(diff.facts.added);   // New fact keys
  console.log(diff.facts.removed); // Removed fact keys
  console.log(diff.facts.changed); // Changed values: [{ key, before, after }]
}

// DAG/goal: nodes completed between checkpoints
if (diff.nodesCompleted) {
  console.log(diff.nodesCompleted); // Node IDs completed between A and B
}
```

Both checkpoints must be from the same pattern type — `diffCheckpoints` throws if types differ.

---

## Conditional Checkpointing

Use the `when` predicate to save checkpoints only when conditions are met:

```typescript
// Only checkpoint when satisfaction exceeds 50%
checkpoint: {
  everyN: 1,
  when: (context) => (context.satisfaction ?? 0) > 0.5,
}

// Only checkpoint during specific steps
checkpoint: {
  everyN: 1,
  when: (context) => context.step > 2,
}

// Combine with everyN: check every 3 steps, but only save if condition met
checkpoint: {
  everyN: 3,
  when: (context) => context.patternType === 'goal',
}
```

---

## Lifecycle Hooks

The multi-agent orchestrator fires hooks when checkpoints are saved or fail:

```typescript
const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: { /* ... */ },
  hooks: {
    onCheckpointSave: ({ checkpointId, patternType, step, timestamp }) => {
      console.log(`Checkpoint saved: ${checkpointId} at step ${step}`);
    },
    onCheckpointError: ({ patternType, step, error, timestamp }) => {
      console.error(`Checkpoint failed at step ${step}:`, error);
    },
  },
});
```

### Timeline Events

Checkpoints emit timeline events for debugging:

| Event | Fields |
|-------|--------|
| `checkpoint_save` | `checkpointId`, `patternType`, `step` |
| `checkpoint_restore` | `checkpointId`, `patternType`, `step` |

```typescript
const saves = timeline.getEventsByType('checkpoint_save');
const restores = timeline.getEventsByType('checkpoint_restore');
```

---

## API Reference

### Functions

| Function | Description |
|----------|-------------|
| `getPatternStep(state)` | Get current step/round/iteration from any checkpoint state |
| `getCheckpointProgress(state)` | Compute progress (percentage, tokens, estimates) |
| `diffCheckpoints(a, b)` | Compare two checkpoint states |
| `forkFromCheckpoint(options, store, id)` | Create independent orchestrator from checkpoint |

### Resume Methods (on `MultiAgentOrchestrator`)

| Method | Pattern |
|--------|---------|
| `resumeSequential(state, pattern)` | Sequential |
| `resumeSupervisor(state, pattern, options?)` | Supervisor |
| `resumeReflect(state, pattern, options?)` | Reflect |
| `resumeDebate(state, pattern)` | Debate |
| `resumeDag(state, pattern, options?)` | DAG |
| `resumeGoal(state, pattern)` | Goal |
| `replay(checkpointId, pattern, options?)` | Auto-detect |

### Types

| Type | Description |
|------|-------------|
| `PatternCheckpointConfig` | Checkpoint configuration |
| `CheckpointContext` | Context passed to `when` predicate |
| `PatternCheckpointState` | Union of all per-pattern states |
| `SequentialCheckpointState` | Sequential checkpoint |
| `SupervisorCheckpointState` | Supervisor checkpoint |
| `ReflectCheckpointState` | Reflect checkpoint |
| `DebateCheckpointState` | Debate checkpoint |
| `DagCheckpointState` | DAG checkpoint |
| `GoalCheckpointState` | Goal checkpoint |
| `CheckpointProgress` | Progress computed from state |
| `CheckpointDiff` | Diff between two states |
| `CheckpointStore` | Store interface |
| `InMemoryCheckpointStore` | Built-in in-memory store |

---

## Next Steps

- [Breakpoints & Checkpoints](/ai/breakpoints) &ndash; Orchestrator-level checkpoints and breakpoints
- [Execution Patterns](/ai/patterns) &ndash; All 8 pattern types
- [Debug Timeline](/ai/debug-timeline) &ndash; Checkpoint timeline events
- [DevTools](/ai/devtools) &ndash; Visual debugging with checkpoint events
