# AI Tasks

Tasks are deterministic, non-LLM work units that run alongside agents in orchestration patterns. Use tasks for data transformation, API calls, file I/O, or any work that does not need an LLM.

## Decision Tree: "Should this be an agent or a task?"

```
Does this work need an LLM?
├── Yes → Use an agent (AgentLike)
└── No  → Use a task (TaskRegistration)
    │
    Does it need to call other agents?
    ├── Yes → Make it an agent, not a task (#33)
    └── No  → Task is correct
        │
        What does it receive?
        └── Always a string → parse with JSON.parse() if structured (#34)
```

## TaskRegistration Shape

```typescript
interface TaskRegistration {
  // The work function – input is ALWAYS a string
  run: (input: string, context: TaskContext) => Promise<string>;

  // Human-readable label for debugging/logging
  label?: string;

  // Abort after this many ms
  timeout?: number;

  // Max parallel executions of this task
  maxConcurrent?: number;

  // Retry on failure
  retry?: {
    attempts: number;
    backoff: "exponential" | "linear" | "none";
  };
}
```

## TaskContext Shape

```typescript
interface TaskContext {
  // Shared memory across runs
  memory: AgentMemory;

  // Ephemeral key-value store for the current pattern execution
  scratchpad: Record<string, unknown>;

  // Read another agent's current state (read-only)
  readAgentState: (agentName: string) => AgentState;

  // Report progress (0-100)
  reportProgress: (percent: number, message?: string) => void;

  // Cancellation signal
  signal: AbortSignal;
}
```

## Registering Tasks

```typescript
import { createMultiAgentOrchestrator } from "@directive-run/ai";

const orchestrator = createMultiAgentOrchestrator({
  agents: {
    researcher: { name: "researcher", instructions: "...", model: "claude-sonnet-4-5" },
    writer: { name: "writer", instructions: "...", model: "claude-sonnet-4-5" },
  },
  tasks: {
    formatter: {
      label: "Format research output",
      timeout: 5000,
      maxConcurrent: 3,
      retry: { attempts: 2, backoff: "linear" },
      run: async (input, context) => {
        context.reportProgress(0, "Parsing input");
        const data = JSON.parse(input);

        context.reportProgress(50, "Formatting");
        const formatted = formatData(data);

        context.reportProgress(100, "Done");

        return JSON.stringify(formatted);
      },
    },
    validate: {
      label: "Validate output schema",
      run: async (input, context) => {
        const parsed = JSON.parse(input);
        if (!parsed.title || !parsed.body) {
          throw new Error("Missing required fields: title, body");
        }

        return input;
      },
    },
  },
  runner,
});
```

## Tasks in Patterns

Tasks work in all composition patterns. Reference them by their key, just like agents:

### Sequential

```typescript
patterns: {
  pipeline: sequential(["researcher", "formatter", "writer"]),
  // researcher (agent) → formatter (task) → writer (agent)
},
```

### DAG

```typescript
patterns: {
  workflow: dag([
    { id: "research", handler: "researcher" },
    { id: "format", handler: "formatter", dependencies: ["research"] },
    { id: "validate", handler: "validate", dependencies: ["format"] },
    { id: "write", handler: "writer", dependencies: ["validate"] },
  ]),
},
```

### Parallel

```typescript
patterns: {
  gather: parallel(["researcher", "formatter"], mergeResults),
},
```

## Reading Agent State from a Task

```typescript
tasks: {
  summarize: {
    run: async (input, context) => {
      const researcherState = context.readAgentState("researcher");
      const lastOutput = researcherState.lastOutput;

      return `Summary of: ${lastOutput}`;
    },
  },
},
```

## Using the Scratchpad

The scratchpad persists across tasks within a single pattern execution:

```typescript
tasks: {
  step1: {
    run: async (input, context) => {
      const parsed = JSON.parse(input);
      context.scratchpad.itemCount = parsed.items.length;

      return input;
    },
  },
  step2: {
    run: async (input, context) => {
      const count = context.scratchpad.itemCount as number;

      return `Processed ${count} items: ${input}`;
    },
  },
},
```

## Anti-Patterns

### #33: Tasks calling agents internally

```typescript
// WRONG – tasks cannot invoke agents
tasks: {
  enhance: {
    run: async (input, context) => {
      // Tasks have no runner access – this won't work
      const result = await runner.run(someAgent, input);

      return result.output;
    },
  },
},

// CORRECT – use a pattern to compose agents and tasks
patterns: {
  enhance: sequential(["enhancer-agent", "format-task"]),
},
```

### #34: Expecting structured input (not a string)

```typescript
// WRONG – task input is always a string
tasks: {
  process: {
    run: async (input, context) => {
      // input.items is undefined – input is a string
      return input.items.map((i) => i.name).join(", ");
    },
  },
},

// CORRECT – parse the string input
tasks: {
  process: {
    run: async (input, context) => {
      const data = JSON.parse(input);

      return data.items.map((i: { name: string }) => i.name).join(", ");
    },
  },
},
```

### #35: Task and agent IDs collide

```typescript
// WRONG – "researcher" exists as both agent and task
agents: {
  researcher: { name: "researcher", instructions: "...", model: "claude-sonnet-4-5" },
},
tasks: {
  researcher: { run: async (input) => input }, // Name collision!
},

// CORRECT – use distinct names
agents: {
  researcher: { name: "researcher", instructions: "...", model: "claude-sonnet-4-5" },
},
tasks: {
  formatResearch: { run: async (input) => input },
},
```

## Quick Reference

| Feature | Agent | Task |
|---|---|---|
| Uses LLM | Yes | No |
| Input type | string | string |
| Can call other agents | Via patterns | No |
| Retry support | Via orchestrator | Built-in retry config |
| Progress reporting | No | `context.reportProgress()` |
| Concurrency control | Via patterns | `maxConcurrent` |
| Scratchpad access | No | Yes |
| Works in all patterns | Yes | Yes |
