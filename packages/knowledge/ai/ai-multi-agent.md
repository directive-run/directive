# AI Multi-Agent Orchestrator

`createMultiAgentOrchestrator` coordinates multiple agents using 8 composition patterns. Each agent becomes a namespaced Directive module with a shared coordinator.

## Decision Tree: "Which pattern do I need?"

```
How should agents interact?
├── Independent, combine results → parallel()
├── One feeds the next        → sequential()
├── One agent delegates        → supervisor()
├── Complex dependency graph   → dag()
├── Agent critiques own output → reflect()
├── First to finish wins      → race()
├── Agents argue to consensus → debate()
└── Iterate until goal met    → goal()
```

## Basic Setup

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
} from "@directive-run/ai";
import { createAnthropicRunner } from "@directive-run/ai/anthropic";

const runner = createAnthropicRunner({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const orchestrator = createMultiAgentOrchestrator({
  agents: {
    researcher: {
      name: "researcher",
      instructions: "Research the topic thoroughly.",
      model: "claude-sonnet-4-5",
    },
    writer: {
      name: "writer",
      instructions: "Write clear, engaging content.",
      model: "claude-sonnet-4-5",
    },
    editor: {
      name: "editor",
      instructions: "Edit for clarity and correctness.",
      model: "claude-haiku-3-5",
    },
  },
  patterns: {
    pipeline: sequential(["researcher", "writer", "editor"]),
    brainstorm: parallel(["researcher", "writer"], mergeResults),
    managed: supervisor("editor", ["researcher", "writer"]),
    workflow: dag([
      { id: "research", handler: "researcher" },
      { id: "write", handler: "writer", dependencies: ["research"] },
      { id: "edit", handler: "editor", dependencies: ["write"] },
    ]),
  },
  runner,
});

// REQUIRED for multi-agent — must call start() before running patterns
orchestrator.start();

const result = await orchestrator.runPattern("pipeline", "Write about AI");
```

## Pattern Details

### parallel — Run agents concurrently, merge results

```typescript
const brainstorm = parallel(
  ["researcher", "writer"],
  (results) => {
    // results: Map<string, RunResult>
    const combined = Array.from(results.values())
      .map((r) => r.output)
      .join("\n\n");

    return combined;
  },
);
```

### sequential — Chain agents in order

```typescript
// Each agent receives the previous agent's output as its prompt
const pipeline = sequential(["researcher", "writer", "editor"]);
```

### supervisor — One agent delegates to workers

```typescript
// Editor decides which worker to invoke and when to stop
const managed = supervisor("editor", ["researcher", "writer"]);
```

### dag — Directed acyclic graph of dependencies

```typescript
// DagNode shape
interface DagNode {
  id: string;
  handler: string;          // agent name
  dependencies?: string[];  // node IDs this depends on
  transform?: (input: string, depResults: Map<string, string>) => string;
}

const workflow = dag([
  { id: "research", handler: "researcher" },
  {
    id: "write",
    handler: "writer",
    dependencies: ["research"],
    transform: (input, deps) => {
      const research = deps.get("research");

      return `Based on research:\n${research}\n\nWrite about: ${input}`;
    },
  },
  { id: "edit", handler: "editor", dependencies: ["write"] },
]);
```

### reflect — Agent critiques and revises its own output

```typescript
const selfImprove = reflect("writer", {
  maxIterations: 3,
  stopWhen: (output, iteration) => {
    return output.includes("FINAL") || iteration >= 3;
  },
});
```

### race — First agent to finish wins

```typescript
const fastest = race(["researcher", "writer"], {
  minSuccess: 1,       // How many must complete (default: 1)
  timeout: 30000,      // Cancel remaining after timeout
});
```

### debate — Agents argue to consensus

```typescript
const consensus = debate(["researcher", "writer"], {
  maxRounds: 5,
  judge: "editor",     // Agent that decides when consensus is reached
});
```

### goal — Iterate until a condition is met

```typescript
const iterative = goal("researcher", {
  maxIterations: 10,
  goalCheck: (output, facts) => {
    return facts.confidence > 0.9;
  },
});
```

## Fact Propagation

Each agent has its own namespaced facts. The coordinator module (`__coord`) holds shared state:

```typescript
// Read agent-specific facts
orchestrator.system.facts.researcher.status;
orchestrator.system.facts.writer.lastOutput;

// Read coordinator facts
orchestrator.system.facts.__coord.activePattern;
orchestrator.system.facts.__coord.completedAgents;
```

## Checkpoint Serialization

```typescript
// Save entire multi-agent state
const checkpoint = orchestrator.checkpoint();
const serialized = JSON.stringify(checkpoint);

// Restore from checkpoint
const restored = createMultiAgentOrchestrator({
  agents,
  patterns,
  runner,
  checkpoint: JSON.parse(serialized),
});
restored.start();
```

## Tasks in Multi-Agent Patterns

Tasks and agents share the DAG/sequential/parallel namespace. See `ai-tasks.md` for details.

```typescript
const workflow = dag([
  { id: "research", handler: "researcher" },
  { id: "format", handler: "formatter-task" },  // task, not agent
  { id: "edit", handler: "editor", dependencies: ["research", "format"] },
]);
```

## Anti-Patterns

### #24: Forgetting start() for multi-agent

```typescript
// WRONG — multi-agent orchestrators require explicit start()
const orchestrator = createMultiAgentOrchestrator({ agents, runner });
const result = await orchestrator.runPattern("pipeline", "prompt");
// Error: Orchestrator not started

// CORRECT
const orchestrator = createMultiAgentOrchestrator({ agents, runner });
orchestrator.start();
const result = await orchestrator.runPattern("pipeline", "prompt");
```

### #30: race minSuccess greater than agent count

```typescript
// WRONG — minSuccess cannot exceed the number of agents
const broken = race(["researcher", "writer"], {
  minSuccess: 3, // Only 2 agents, will never satisfy
});

// CORRECT — minSuccess <= agents.length
const working = race(["researcher", "writer"], {
  minSuccess: 1,
});
```

### Reusing agent names across patterns

```typescript
// WRONG — agent names must match keys in the agents config
patterns: {
  pipeline: sequential(["research-agent", "write-agent"]),
  // These don't match the keys "researcher", "writer"
},

// CORRECT — use the exact keys from agents config
patterns: {
  pipeline: sequential(["researcher", "writer"]),
},
```

## Quick Reference

| Pattern | Use Case | Key Option |
|---|---|---|
| `parallel()` | Independent work, merge results | merge function |
| `sequential()` | Pipeline, each feeds next | agent order |
| `supervisor()` | Dynamic delegation | supervisor agent |
| `dag()` | Complex dependencies | DagNode[] |
| `reflect()` | Self-improvement loop | maxIterations, stopWhen |
| `race()` | Fastest wins | minSuccess, timeout |
| `debate()` | Consensus building | maxRounds, judge |
| `goal()` | Condition-driven iteration | goalCheck |
