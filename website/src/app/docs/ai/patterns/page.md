---
title: Execution Patterns
description: Parallel, sequential, supervisor, DAG, race, reflect, and debate patterns for multi-agent orchestration.
---

Declarative and imperative execution patterns for coordinating multiple agents. {% .lead %}

Patterns define **how** agents run together. Register named patterns for reuse, or call imperative methods for one-off execution. All patterns respect agent concurrency limits, timeouts, and guardrails.

---

## Quick Start

```typescript
import { createMultiAgentOrchestrator, parallel, sequential, concatResults } from '@directive-run/ai';

const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: {
    researcher: {
      agent: researcher,
      maxConcurrent: 3,
    },
    writer: { agent: writer },
    reviewer: { agent: reviewer },
  },
  patterns: {
    research: parallel(
      ['researcher', 'researcher'],
      (results) => concatResults(results),
    ),
    pipeline: sequential(['researcher', 'writer', 'reviewer']),
  },
});

// Run a named pattern
const result = await orchestrator.runPattern('pipeline', 'Write about WASM');
```

---

## Pattern Overview

| Pattern | Use Case | Agents | Result |
|---------|----------|--------|--------|
| `parallel` | Fan-out, redundancy | Same or different | Merged via callback |
| `sequential` | Pipelines, chains | Different roles | Last agent's output |
| `supervisor` | Dynamic delegation | Manager + workers | Supervisor's final answer |
| `dag` | Complex dependencies | Any topology | Merged leaf outputs |
| `race` | Fastest wins | Competing agents | Winner's output |
| `reflect` | Self-improvement | Agent + evaluator | Best iteration |
| `debate` | Adversarial refinement | Multiple + judge | Winner per round |

---

## Parallel

Run multiple agents simultaneously and merge their results.

### Named Pattern

```typescript
import { parallel, concatResults } from '@directive-run/ai';

const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: {
    researcher: {
      agent: researcher,
      maxConcurrent: 3,
    },
  },

  patterns: {
    research: parallel(
      ['researcher', 'researcher', 'researcher'],
      (results) => concatResults(results, '\n\n---\n\n'),
      { minSuccess: 2 }
    ),
  },
});

const output = await orchestrator.runPattern<string>('research', 'Explain WASM');
```

### Imperative

```typescript
// Same input to all agents
const combined = await orchestrator.runParallel(
  ['researcher', 'researcher'],
  'What are WebSockets?',
  (results) => concatResults(results)
);

// Different inputs per agent
const answers = await orchestrator.runParallel(
  ['researcher', 'researcher', 'researcher'],
  ['Explain REST', 'Explain GraphQL', 'Explain gRPC'],
  (results) => collectOutputs(results)
);
```

When passing an array of inputs, the count must match the agent count.

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `minSuccess` | `number` | all | Minimum successful results. Failed agents are caught silently when set |
| `timeout` | `number` | &ndash; | Overall timeout for the batch (ms) |

---

## Sequential

Chain agents so each one's output feeds into the next.

### Named Pattern

```typescript
import { sequential } from '@directive-run/ai';

const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: {
    researcher: { agent: researcher },
    writer: { agent: writer },
    reviewer: { agent: reviewer },
  },

  patterns: {
    pipeline: sequential(['researcher', 'writer', 'reviewer'], {
      transform: (output, agentId) => {
        if (agentId === 'researcher') {
          return `Write based on this research:\n\n${output}`;
        }
        if (agentId === 'writer') {
          return `Review this draft:\n\n${output}`;
        }

        return String(output);
      },
    }),
  },
});
```

### Imperative

```typescript
const results = await orchestrator.runSequential<string>(
  ['researcher', 'writer', 'reviewer'],
  'Create a blog post about AI safety',
  {
    transform: (output, agentId, index) => {
      if (agentId === 'researcher') {
        return `Write based on this research:\n\n${output}`;
      }

      return String(output);
    },
  }
);

const finalReview = results[results.length - 1].output;
const totalTokens = aggregateTokens(results);
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `transform` | `(output, agentId, index) => string` | auto-stringify | Shape each agent's output for the next |
| `extract` | `(output) => T` | identity | Extract final result (named patterns only) |
| `continueOnError` | `boolean` | `false` | Skip failed agents instead of aborting |

---

## Supervisor

A supervisor agent delegates work to workers in a loop until it declares the task complete.

```typescript
import { supervisor, collectOutputs, aggregateTokens } from '@directive-run/ai';

const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: {
    manager: {
      agent: manager,
      maxConcurrent: 1,
    },
    researcher: {
      agent: researcher,
      maxConcurrent: 3,
    },
    writer: {
      agent: writer,
      maxConcurrent: 1,
    },
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

### How the Loop Works

1. Runs the supervisor with the initial input
2. Parses the supervisor's output as JSON
3. If `{ action: "delegate", worker: "researcher", workerInput: "..." }` &ndash; runs that worker
4. Feeds the worker result back: `"Worker researcher completed with result: ..."`
5. Repeats until `{ action: "complete" }` or `maxRounds` is reached

The supervisor validates worker names. Delegating to an unregistered worker throws immediately.

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxRounds` | `number` | `5` | Maximum delegation rounds |
| `extract` | `(output, workerResults) => T` | identity | Extract final result |

---

## DAG (Directed Acyclic Graph)

Define complex dependency graphs where agents run as soon as their dependencies complete.

```typescript
import { dag, concatResults } from '@directive-run/ai';

const pipeline = dag(
  {
    researcher: { agent: 'researcher' },
    analyst: { agent: 'analyst', deps: ['researcher'] },
    writer: { agent: 'writer', deps: ['researcher'] },
    editor: { agent: 'editor', deps: ['analyst', 'writer'], priority: 10 },
  },
  (context) => concatResults(Object.values(context.results).map((r) => String(r.output))),
  { timeout: 60000, maxConcurrent: 3 }
);
```

### DagNode

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `agent` | `string` | *required* | Agent ID |
| `deps` | `string[]` | `[]` | Upstream node IDs that must complete first |
| `when` | `(context: DagExecutionContext) => boolean` | &ndash; | Conditional edge &ndash; evaluated when deps are met |
| `transform` | `(context: DagExecutionContext) => string` | &ndash; | Build input from dependency results |
| `timeout` | `number` | &ndash; | Per-node timeout (ms) |
| `priority` | `number` | `0` | Tiebreaker when multiple nodes are ready (higher = first) |

### DagExecutionContext

```typescript
interface DagExecutionContext {
  input: string;                                // Original input to the DAG
  outputs: Record<string, unknown>;             // Outputs keyed by node ID
  statuses: Record<string, DagNodeStatus>;      // Statuses keyed by node ID
  errors: Record<string, string>;               // Error messages keyed by node ID
  results: Record<string, RunResult<unknown>>;  // Full RunResult keyed by node ID
}
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `timeout` | `number` | &ndash; | Overall DAG timeout (ms) |
| `maxConcurrent` | `number` | &ndash; | Max parallel nodes |
| `onNodeError` | `"fail" \| "skip-downstream" \| "continue"` | `"fail"` | Error handling strategy |

---

## Race

Run multiple agents in parallel &ndash; the first successful result wins. Remaining agents are cancelled.

```typescript
import { race } from '@directive-run/ai';
import type { RaceResult } from '@directive-run/ai';

const fastest = race<string>(
  ['gpt4-agent', 'claude-agent', 'gemini-agent'],
  {
    extract: (output) => String(output),
    timeout: 10000,
    minSuccess: 1,
  }
);

const result: RaceResult<string> = await orchestrator.runPattern('fastest', 'Summarize this');
console.log(result.winnerId);   // 'claude-agent'
console.log(result.result);     // The winning output
```

### RaceResult

```typescript
interface RaceResult<T> {
  winnerId: string;
  result: T;
  allResults?: RunResult<unknown>[];
}
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `extract` | `(output) => T` | identity | Extract result from winner's output |
| `timeout` | `number` | &ndash; | Overall timeout (ms) |
| `minSuccess` | `number` | `1` | Minimum successful results before declaring a winner |
| `signal` | `AbortSignal` | &ndash; | External cancellation signal |

Timeline events: `race_start`, `race_winner`, `race_cancelled`.

---

## Reflect

An agent produces output, an evaluator scores it, and the agent retries with feedback until the score passes a threshold.

```typescript
import { reflect } from '@directive-run/ai';

const selfImprove = reflect<string>(
  'writer',
  'evaluator',
  {
    maxIterations: 3,
    threshold: 0.8,
    onExhausted: 'accept-best',
    onIteration: ({ iteration, score, feedback }) => {
      console.log(`Iteration ${iteration}: score=${score}, feedback=${feedback}`);
    },
  }
);

const result = await orchestrator.runPattern('selfImprove', 'Write a technical blog post');
console.log(result.result);        // Best output
console.log(result.iterations);    // Number of iterations run
console.log(result.exhausted);     // true if maxIterations reached without passing
```

The evaluator agent must return JSON with `score` (0&ndash;1) and optional `feedback`:

```json
{ "score": 0.6, "feedback": "Needs more technical depth in section 2" }
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxIterations` | `number` | `2` | Maximum improvement attempts |
| `threshold` | `number \| ((iteration: number) => number)` | &ndash; | Score threshold to pass (0&ndash;1), or function for dynamic thresholds |
| `parseEvaluation` | `(output) => { score, feedback? }` | JSON.parse | Custom evaluation parser |
| `buildRetryInput` | `(input, feedback, iteration) => string` | &ndash; | Custom retry input builder (`iteration` is a number) |
| `extract` | `(output) => T` | identity | Extract final result |
| `onExhausted` | `"accept-last" \| "accept-best" \| "throw"` | `"accept-last"` | What to do when max iterations reached |
| `onIteration` | `(record) => void` | &ndash; | Callback per iteration |
| `signal` | `AbortSignal` | &ndash; | Cancellation signal |
| `timeout` | `number` | &ndash; | Overall timeout (ms) |

### Return Shape

```typescript
interface ReflectResult<T> {
  result: T;
  iterations: number;
  history: ReflectIterationRecord[];
  exhausted: boolean;
}
```

Timeline events: `reflection_iteration` with `score`, `feedback`, and `durationMs`.

### `withReflection` Middleware

Wrap any runner with reflection so that every call goes through evaluate-and-retry:

```typescript
import { withReflection } from '@directive-run/ai';

const reflectingRunner = withReflection(runner, {
  evaluator: evaluatorAgent,
  evaluatorRunner: runner,
  maxIterations: 3,
  parseEvaluation: (output) => JSON.parse(String(output)),
  buildRetryInput: (input, feedback, iteration) =>
    `Attempt ${iteration}: ${feedback}\n\nOriginal: ${input}`,
  onExhausted: 'accept-best',
});

// Every call now auto-reflects
const result = await reflectingRunner(agent, 'Write a blog post');
```

---

## Debate

Multiple agents propose solutions, a judge evaluates each round, and the process repeats.

```typescript
import { debate } from '@directive-run/ai';
import type { DebateResult } from '@directive-run/ai';

const adversarial = debate<string>({
  agents: ['optimist', 'pessimist', 'realist'],
  evaluator: 'judge',
  maxRounds: 3,
  extract: (output) => String(output),
});

const result: DebateResult<string> = await orchestrator.runPattern('adversarial', 'Should we use microservices?');

console.log(result.winnerId);
console.log(result.rounds.length);
for (const round of result.rounds) {
  console.log(round.proposals.map((p) => p.agentId));
  console.log(round.judgement.winnerId, round.judgement.score);
}
```

Standalone execution without a named pattern:

```typescript
import { runDebate } from '@directive-run/ai';

const result = await runDebate(orchestrator, {
  agents: ['agent-a', 'agent-b'],
  evaluator: 'judge',
  maxRounds: 2,
}, 'Debate topic here');
```

### DebateResult

```typescript
interface DebateResult<T> {
  winnerId: string;
  result: T;
  rounds: Array<{
    proposals: Array<{ agentId: string; output: unknown }>;
    judgement: { winnerId: string; feedback?: string; score?: number };
  }>;
}
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `agents` | `string[]` | *required* | Competing agent IDs |
| `evaluator` | `string` | *required* | Judge agent ID |
| `maxRounds` | `number` | `2` | Number of debate rounds |
| `extract` | `(output) => T` | identity | Extract final result |
| `parseJudgement` | `(output) => { winnerId, feedback?, score? }` | JSON.parse | Custom judge parser |
| `signal` | `AbortSignal` | &ndash; | Cancellation signal |
| `timeout` | `number` | &ndash; | Overall timeout (ms) |

Timeline events: `debate_round` with round number, `winnerId`, `score`, and `agentCount`.

---

## Result Merging

Four built-in helpers for combining results from parallel runs:

```typescript
import {
  concatResults,
  collectOutputs,
  pickBestResult,
  aggregateTokens,
} from '@directive-run/ai';

// Join string outputs with a separator (default: '\n\n')
const merged = concatResults(results, '\n\n---\n\n');

// Gather outputs into a typed array
const outputs = collectOutputs<string>(results);

// Select the best result by a scoring function
const best = pickBestResult(results, (r) =>
  typeof r.output === 'string' ? r.output.length : 0
);

// Sum token usage
const totalTokens = aggregateTokens(results);
```

| Helper | Signature | Description |
|--------|-----------|-------------|
| `concatResults` | `(results, separator?) => string` | Concatenate outputs. Non-strings are `JSON.stringify`'d |
| `collectOutputs` | `(results) => T[]` | Collect outputs into an array |
| `pickBestResult` | `(results, scoreFn) => RunResult<T>` | Highest-scoring result. Throws if empty |
| `aggregateTokens` | `(results) => number` | Sum `totalTokens` across results |

---

## Agent Selection Helpers

Route work to agents based on runtime state using Directive constraints.

### `selectAgent`

```typescript
import { selectAgent } from '@directive-run/ai';

const routeToExpert = selectAgent(
  (facts) => facts.complexity > 0.8,
  'expert',
  (facts) => String(facts.query),
  100  // priority
);

// Dynamic agent selection
const dynamicRoute = selectAgent(
  (facts) => facts.needsProcessing === true,
  (facts) => facts.preferredAgent as string,
  (facts) => `Process this: ${facts.data}`
);
```

### `runAgentRequirement`

Create `RUN_AGENT` requirements for constraint definitions:

```typescript
import { runAgentRequirement } from '@directive-run/ai';

const constraints = {
  needsResearch: {
    when: (facts) => facts.hasUnknowns,
    require: runAgentRequirement('researcher', 'Find relevant data', {
      priority: 'high',
    }),
  },
};
```

### `findAgentsByCapability`

```typescript
import { findAgentsByCapability } from '@directive-run/ai';

const matches = findAgentsByCapability(agents, ['search', 'summarize']);
// Returns agent IDs where capabilities include ALL required ones
```

### `capabilityRoute`

Create a constraint that routes by capability match:

```typescript
import { capabilityRoute } from '@directive-run/ai';

const route = capabilityRoute(
  agents,
  (facts) => facts.requiredCapabilities as string[],
  (facts) => facts.query as string,
  {
    priority: 50,
    select: (matches, registry) => matches[0],  // Custom tiebreaker
  }
);
```

### `spawnOnCondition`

Spawn an agent when a condition becomes true:

```typescript
import { spawnOnCondition } from '@directive-run/ai';

const spawn = spawnOnCondition({
  when: (facts) => facts.errorCount > 3,
  agent: 'debugger',
  input: 'Investigate recurring errors',
  priority: 90,
});
```

### `spawnPool`

Spawn multiple instances of an agent:

```typescript
import { spawnPool } from '@directive-run/ai';

const pool = spawnPool(
  (facts) => facts.batchReady === true,
  { agent: 'processor', input: 'Process batch item', count: 5 }
);
```

### `derivedConstraint`

Trigger agent runs based on derived state:

```typescript
import { derivedConstraint } from '@directive-run/ai';

const onHighCost = derivedConstraint(
  'totalCost',
  (value) => (value as number) > 100,
  { agent: 'cost-optimizer', input: 'Reduce costs', priority: 80 }
);
```

---

## Pattern Composition

Compose multiple patterns into a pipeline where each pattern's output feeds as input to the next:

```typescript
import { composePatterns, parallel, sequential, concatResults } from '@directive-run/ai';

const workflow = composePatterns(
  parallel(['researcher', 'researcher'], (results) => concatResults(results)),
  sequential(['writer', 'reviewer']),
);

const result = await workflow(orchestrator, 'Research and write about AI safety');
```

Between patterns, output is automatically stringified (`string` passes through; objects are `JSON.stringify`'d).

### Pattern Serialization

Save and restore pattern definitions:

```typescript
import { patternToJSON, patternFromJSON } from '@directive-run/ai';

const json = patternToJSON(myPattern);
const restored = patternFromJSON<string>(json, {
  merge: (results) => concatResults(results),
});
```

---

## Next Steps

- [Multi-Agent Orchestrator](/docs/ai/multi-agent) &ndash; Setup, configuration, and agent management
- [Communication](/docs/ai/communication) &ndash; Message bus and agent network
- [Cross-Agent State](/docs/ai/cross-agent-state) &ndash; Shared derivations and scratchpad
- [Goal Engine](/docs/ai/goals) &ndash; Desired-state convergence
