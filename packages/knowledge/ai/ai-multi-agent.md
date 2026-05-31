# AI multi-agent orchestrator

> Covers `@directive-run/ai/multi-agent` — `createMultiAgentOrchestrator` + 8 composition patterns (parallel / sequential / supervisor / dag / reflect / race / debate / goal).

`createMultiAgentOrchestrator` coordinates multiple agents using 8 composition patterns. Each agent becomes a namespaced Directive module with a shared coordinator. Patterns are pure config objects you assemble with factory functions and pass via the `patterns:` option.

For a single agent, see `ai-orchestrator.md`.

## Decision tree

```
How should agents interact?
├── Independent, combine results → parallel()
├── One feeds the next         → sequential()
├── One agent delegates work   → supervisor()
├── Complex dependency graph   → dag()
├── Producer + evaluator loop  → reflect()
├── First to finish wins       → race()
├── Multiple positions debated → debate()
└── Iterate until goal met     → goal()
```

## Basic setup

Import from the subpath barrel — the main `@directive-run/ai` barrel re-exports these with `@deprecated` notices for v2 removal.

```typescript
import {
  createMultiAgentOrchestrator,
  parallel,
  sequential,
  supervisor,
  dag,
  reflect,
  race,
  debate,
  goal,
} from "@directive-run/ai/multi-agent";
import { createAnthropicRunner } from "@directive-run/ai/anthropic";

const runner = createAnthropicRunner({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const orchestrator = createMultiAgentOrchestrator({
  agents: {
    researcher: { name: "researcher", instructions: "Research the topic thoroughly.", model: "claude-sonnet-4-5" },
    writer:     { name: "writer",     instructions: "Write clear, engaging content.", model: "claude-sonnet-4-5" },
    editor:     { name: "editor",     instructions: "Edit for clarity and correctness.", model: "claude-haiku-4-5" },
  },
  patterns: {
    pipeline:  sequential(["researcher", "writer", "editor"]),
    brainstorm: parallel(["researcher", "writer"], (results) => results.map((r) => String(r.output)).join("\n\n")),
    managed:   supervisor("editor", ["researcher", "writer"]),
    workflow:  dag({
      research:  { handler: "researcher" },
      write:     { handler: "writer", deps: ["research"] },
      edit:      { handler: "editor", deps: ["write"] },
    }),
  },
  runner,
});

// REQUIRED — call start() before runPattern. Single-agent createAgentOrchestrator does NOT need this.
orchestrator.start();

const result = await orchestrator.runPattern("pipeline", "Write about AI");
```

## Patterns in depth

### `parallel(handlers, merge, options?)`

Runs handlers concurrently and combines their results. **`merge` is REQUIRED as positional argument 2** — without it the call fails at registration. `options?` accepts `minSuccess` and `timeout`.

```typescript
const brainstorm = parallel(
  ["researcher", "writer"],
  (results) => results.map((r) => String(r.output)).join("\n\n"),
  { minSuccess: 1, timeout: 30_000 },
);
```

The `results` arg is `RunResult<unknown>[]` — array, in handler order.

### `sequential(handlers, options?)`

Each handler's output feeds as input to the next. `options.transform(output, handlerId, index)` adapts the hand-off; `options.extract(finalOutput)` shapes the return.

```typescript
const pipeline = sequential(["researcher", "writer", "editor"]);

const writeReview = sequential(["writer", "reviewer"], {
  transform: (output) => `Review this draft:\n${output}`,
});
```

### `supervisor(supervisorAgent, workers, options?)`

The supervisor runs first and delegates to workers based on its output. Repeats up to `maxRounds` until the supervisor signals completion.

```typescript
const managed = supervisor("manager", ["worker1", "worker2"], { maxRounds: 3 });
```

### `dag(nodes, merge?, options?)`

**Nodes are a `Record<string, DagNode>`, NOT an array.** Each node's edges are listed in `deps` (not `dependencies`). The runtime validates the graph is acyclic and that all `deps` refer to declared nodes.

```typescript
import type { DagNode, DagExecutionContext } from "@directive-run/ai/multi-agent";

const workflow = dag(
  {
    research:  { handler: "researcher" },
    analyze:   { handler: "analyzer", deps: ["research"] },
    summarize: { handler: "summarizer", deps: ["analyze"] },
  },
  // optional merge — receives the execution context with .outputs Record
  (context: DagExecutionContext) => context.outputs.summarize,
  // optional config
  {
    timeout: 60_000,
    maxConcurrent: 4,
    onNodeError: "skip-downstream", // "fail" (default) | "skip-downstream" | "continue"
  },
);
```

### `reflect(handler, evaluator, options?)`

Producer + evaluator loop. The producer generates output, the evaluator scores it; if the score is below `threshold` the producer retries with feedback, up to `maxIterations`. **`evaluator` is REQUIRED as positional argument 2.**

```typescript
const selfImprove = reflect("writer", "reviewer", {
  maxIterations: 3,
  threshold: 0.8,
  onExhausted: "accept-best", // "accept-last" | "accept-best" | "throw"
  onIteration: (record) => console.log(`iter ${record.iteration}: ${record.score}`),
});
```

### `race(handlers, options?)`

All handlers start simultaneously; the first to complete successfully wins. Use `minSuccess` to wait for N before picking.

```typescript
const fastest = race(["fast-model", "smart-model"], {
  timeout: 5000,
  minSuccess: 1, // must be ≤ handlers.length
});
```

### `debate(config)`

**Takes a single `DebateConfig` object.** The discriminator agents argue from different positions; the `evaluator` agent judges. There is no `judge` field — it's `evaluator`.

```typescript
const consensus = debate({
  handlers: ["optimist", "pessimist"],
  evaluator: "judge",
  maxRounds: 2,
});
```

### `goal(nodes, when, options?)`

Goal-driven execution. Each node declares what it `produces` and `requires`; the runtime infers the execution graph and runs agents until `when(facts)` returns true. There is no single-agent string form.

```typescript
import type { GoalNode } from "@directive-run/ai/multi-agent";

const pipeline = goal(
  {
    researcher: {
      handler: "researcher",
      produces: ["research.findings"],
      requires: ["research.topic"],
      extractOutput: (r) => ({ "research.findings": r.output }),
    },
    writer: {
      handler: "writer",
      produces: ["article.draft"],
      requires: ["research.findings"],
      extractOutput: (r) => ({ "article.draft": r.output }),
    },
  },
  (facts) => facts["article.draft"] != null,
  {
    maxSteps: 10,
    extract: (facts) => facts["article.draft"],
    satisfaction: (facts) => (facts["article.draft"] ? 1.0 : 0.0),
  },
);
```

## Fact propagation

Each agent has its own namespaced facts module. A coordinator module (`__coord`) tracks shared orchestration state.

```typescript
// Per-agent state — module is named after the agent's key in `agents:`
orchestrator.system.facts.researcher.status;
orchestrator.system.facts.writer.output;

// Coordinator state
orchestrator.system.facts.__coord.activePattern;
orchestrator.system.facts.__coord.completedAgents;
```

## Checkpoints

Multi-agent uses the same checkpoint shape as single-agent. **`checkpoint()` is async** — returns a `Promise<Checkpoint>`. Restore on an existing instance via `orch.restore(cp)`. There is no `createMultiAgentOrchestrator({ checkpoint })` constructor option.

```typescript
const cp = await orchestrator.checkpoint({ label: "after-pipeline" });
const serialized = JSON.stringify(cp);

// On a fresh orchestrator with the same agents/patterns/runner:
const restored = createMultiAgentOrchestrator({ agents, patterns, runner });
restored.restore(JSON.parse(serialized));
restored.start();
```

## Tasks alongside agents

Tasks (registered via `tasks:`) share the handler namespace with agents — a `dag` or `sequential` can refer to either by ID. See `ai-tasks.md` for the full task surface.

```typescript
const workflow = dag({
  research:  { handler: "researcher" },
  format:    { handler: "formatter-task" }, // a task, not an agent
  edit:      { handler: "editor", deps: ["research", "format"] },
});
```

## Anti-patterns

### Forgetting `start()` on multi-agent

```typescript
// WRONG — multi-agent orchestrators require explicit start()
const orch = createMultiAgentOrchestrator({ agents, patterns, runner });
await orch.runPattern("pipeline", "prompt"); // throws — not started

// CORRECT
const orch = createMultiAgentOrchestrator({ agents, patterns, runner });
orch.start();
await orch.runPattern("pipeline", "prompt");
```

Single-agent `createAgentOrchestrator` does NOT require `start()`. Only multi-agent does.

### Array-form `dag` and `dependencies` key

```typescript
// WRONG — dag takes Record<string, DagNode>, not an array; and the edge key is `deps`
dag([
  { id: "research",  handler: "researcher" },
  { id: "write",     handler: "writer", dependencies: ["research"] },
])

// CORRECT
dag({
  research: { handler: "researcher" },
  write:    { handler: "writer", deps: ["research"] },
})
```

### `parallel` without the merge arg

```typescript
// WRONG — merge is a REQUIRED positional argument, not in options
parallel(["researcher", "writer"], { minSuccess: 1 })

// CORRECT — merge first, options second
parallel(
  ["researcher", "writer"],
  (results) => results.map((r) => String(r.output)).join("\n"),
  { minSuccess: 1 },
)
```

### `reflect` with a single agent

```typescript
// WRONG — reflect needs a SEPARATE evaluator handler; stopWhen is not an option
reflect("writer", { maxIterations: 3, stopWhen: (out) => out.includes("FINAL") })

// CORRECT — handler + evaluator + threshold (the evaluator decides when to stop)
reflect("writer", "reviewer", { maxIterations: 3, threshold: 0.8 })
```

### `debate` with `judge:` option

```typescript
// WRONG — debate uses `evaluator`, not `judge`; and it's a single config arg
debate(["researcher", "writer"], { maxRounds: 5, judge: "editor" })

// CORRECT — single config object, evaluator key
debate({ handlers: ["researcher", "writer"], evaluator: "editor", maxRounds: 5 })
```

### `goal` with a single agent string

```typescript
// WRONG — goal does not take a single agent + goalCheck; it takes a node map + when()
goal("researcher", { maxIterations: 10, goalCheck: (out, facts) => facts.confidence > 0.9 })

// CORRECT — declarative node map + a when() predicate
goal(
  {
    researcher: {
      handler: "researcher",
      produces: ["confidence"],
      requires: ["topic"],
      extractOutput: (r) => ({ confidence: (r.output as { confidence: number }).confidence }),
    },
  },
  (facts) => (facts.confidence as number) > 0.9,
  { maxSteps: 10 },
)
```

### Handler IDs that don't match `agents:` keys

```typescript
// WRONG — handler refs must match the keys in agents/tasks
createMultiAgentOrchestrator({
  agents: { researcher: {...}, writer: {...} },
  patterns: { pipeline: sequential(["research-agent", "write-agent"]) }, // wrong names
});

// CORRECT
patterns: { pipeline: sequential(["researcher", "writer"]) }
```

### `race` with `minSuccess` greater than the handler count

```typescript
// WRONG — minSuccess can never exceed handlers.length
race(["researcher", "writer"], { minSuccess: 3 }) // 2 handlers, impossible
```

### Restoring via a constructor option

```typescript
// WRONG — there is no `checkpoint` option on createMultiAgentOrchestrator
createMultiAgentOrchestrator({ agents, patterns, runner, checkpoint: cp })

// CORRECT — restore on an existing instance, then start()
const orch = createMultiAgentOrchestrator({ agents, patterns, runner });
orch.restore(cp);
orch.start();
```

## Quick reference

| Pattern | Signature | Required arg 2 |
|---|---|---|
| `parallel(handlers, merge, options?)` | `string[], (results) => T, { minSuccess?, timeout? }` | merge |
| `sequential(handlers, options?)` | `string[], { transform?, extract?, continueOnError? }` | — |
| `supervisor(supervisorAgent, workers, options?)` | `string, string[], { maxRounds?, extract? }` | workers |
| `dag(nodes, merge?, options?)` | `Record<string, DagNode>, (ctx) => T, { timeout?, maxConcurrent?, onNodeError? }` | — |
| `reflect(handler, evaluator, options?)` | `string, string, { maxIterations?, threshold?, onExhausted?, onIteration? }` | evaluator |
| `race(handlers, options?)` | `string[], { timeout?, minSuccess?, extract? }` | — |
| `debate(config)` | `{ handlers, evaluator, maxRounds?, extract?, parseJudgement? }` | — (single arg) |
| `goal(nodes, when, options?)` | `Record<string, GoalNode>, (facts) => boolean, { maxSteps?, extract?, satisfaction? }` | when |
