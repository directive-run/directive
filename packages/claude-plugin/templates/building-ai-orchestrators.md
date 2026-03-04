---
name: building-ai-orchestrators
description: "Create AI orchestration systems using createAgentOrchestrator (single agent) and createMultiAgentOrchestrator (multi-agent). Define factsSchema with t.*() builders, init state, constraints for trigger conditions, and resolvers for LLM execution. Use when building LLM-powered workflows, agent pipelines, task runners, or multi-agent coordination systems."
---

# Building AI Orchestrators

## Prerequisites

This skill applies when the project uses `@directive-run/ai`. If not found in `package.json`, suggest installing it: `npm install @directive-run/ai`.

## When Claude Should Use This Skill

## Auto-Invoke Triggers
- User asks to "build an AI agent", "create an orchestrator", "set up an LLM workflow"
- User wants agents to coordinate, handoff, or collaborate
- User needs structured AI task execution with constraints and state
- User mentions `createAgentOrchestrator` or `createMultiAgentOrchestrator`
- User asks about `orchestrator.run()` or `orchestrator.runStream()`

## Exclusions
- Do NOT invoke for general Directive (non-AI) patterns – use core Directive docs instead
- Do NOT invoke for testing orchestrators – use `testing-ai-systems` skill
- Do NOT invoke for guardrails, budgets, or security – use `hardening-ai-systems` skill

---

## Quick Reference

## Decision Tree: Which Orchestrator?

```
Need AI orchestration?
├── Single agent doing one job → createAgentOrchestrator
│   ├── Simple: runner + factsSchema + init + resolvers
│   └── Complex: add constraints, retry, plugins
└── Multiple agents coordinating → createMultiAgentOrchestrator
    ├── Agents run in sequence → default sequential
    ├── Agents run in parallel → parallel: true on agents
    └── Dynamic routing → coordinator constraints
```

## createAgentOrchestrator – Core Pattern

```typescript
import { createAgentOrchestrator } from "@directive-run/ai";
import { createAnthropicRunner } from "@directive-run/ai/anthropic";
import { t } from "@directive-run/core";

const orchestrator = createAgentOrchestrator({
  runner: createAnthropicRunner({
    model: "claude-opus-4-6",
    apiKey: process.env.ANTHROPIC_API_KEY,
  }),

  // ALWAYS use t.*() builders – never TypeScript type annotations
  factsSchema: {
    input: t.string(),
    output: t.string().optional(),
    status: t.string<"idle" | "running" | "done" | "error">(),
    attempt: t.number(),
    error: t.string().optional(),
  },

  // init() is required – sets starting state
  init: (facts) => {
    facts.status = "idle";
    facts.attempt = 0;
  },

  constraints: {
    startProcessing: {
      when: (facts) => facts.status === "idle" && facts.input.length > 0,
      require: { type: "PROCESS_INPUT" },
    },
    retryOnError: {
      priority: 10,
      when: (facts) => facts.status === "error" && facts.attempt < 3,
      require: { type: "PROCESS_INPUT" },
    },
  },

  resolvers: {
    processInput: {
      requirement: "PROCESS_INPUT",
      resolve: async (req, context) => {
        context.facts.status = "running";
        context.facts.attempt += 1;

        const result = await context.runner.run({
          prompt: context.facts.input,
          system: "You are a helpful assistant.",
        });

        context.facts.output = result.text;
        context.facts.status = "done";
      },
    },
  },
});

// Execute
const result = await orchestrator.run({ input: "Summarize this text..." });
console.log(result.facts.output);
```

## createMultiAgentOrchestrator – Core Pattern

```typescript
import { createMultiAgentOrchestrator } from "@directive-run/ai";
import { createAnthropicRunner } from "@directive-run/ai/anthropic";
import { t } from "@directive-run/core";

const orchestrator = createMultiAgentOrchestrator({
  // Coordinator defines shared state across all agents
  coordinator: {
    factsSchema: {
      topic: t.string(),
      phase: t.string<"research" | "draft" | "review" | "done">(),
      researchNotes: t.string().optional(),
      draft: t.string().optional(),
      finalOutput: t.string().optional(),
    },
    init: (facts) => {
      facts.phase = "research";
    },
  },

  agents: {
    researcher: {
      runner: createAnthropicRunner({ model: "claude-haiku-4-5" }),
      // Per-agent schema – merged with coordinator facts
      factsSchema: {
        searchDepth: t.number(),
      },
      init: (facts) => {
        facts.searchDepth = 3;
      },
      constraints: {
        doResearch: {
          when: (facts) => facts.phase === "research",
          require: { type: "RESEARCH" },
        },
      },
      resolvers: {
        research: {
          requirement: "RESEARCH",
          resolve: async (req, context) => {
            const result = await context.runner.run({
              prompt: `Research this topic: ${context.facts.topic}`,
            });
            context.facts.researchNotes = result.text;
            context.facts.phase = "draft";
          },
        },
      },
    },

    writer: {
      runner: createAnthropicRunner({ model: "claude-opus-4-6" }),
      factsSchema: {
        style: t.string(),
      },
      init: (facts) => {
        facts.style = "professional";
      },
      constraints: {
        writeDraft: {
          when: (facts) => facts.phase === "draft" && !!facts.researchNotes,
          require: { type: "WRITE" },
        },
      },
      resolvers: {
        write: {
          requirement: "WRITE",
          resolve: async (req, context) => {
            const result = await context.runner.run({
              prompt: `Write a ${context.facts.style} article based on: ${context.facts.researchNotes}`,
            });
            context.facts.draft = result.text;
            context.facts.phase = "done";
          },
        },
      },
    },
  },
});

const result = await orchestrator.run({ topic: "Quantum computing" });
console.log(result.facts.finalOutput);
```

## Streaming Execution

```typescript
// runStream() returns AsyncIterable<OrchestratorEvent>
const stream = orchestrator.runStream({ input: "Analyze this..." });

for await (const event of stream) {
  switch (event.type) {
    case "token": {
      process.stdout.write(event.text);
      break;
    }
    case "requirement_met": {
      console.log(`Resolved: ${event.requirementType}`);
      break;
    }
    case "done": {
      console.log("Final:", event.facts);
      break;
    }
    case "error": {
      console.error("Failed:", event.error);
      break;
    }
  }
}
```

## createTask – Structured Work Units

```typescript
import { createTask } from "@directive-run/ai";

const summarizeTask = createTask({
  name: "summarize",
  description: "Summarize text to a target length",
  input: {
    text: t.string(),
    maxWords: t.number(),
  },
  output: {
    summary: t.string(),
    wordCount: t.number(),
  },
  // Tasks integrate into orchestrator resolvers
  resolve: async (input, context) => {
    const result = await context.runner.run({
      prompt: `Summarize in ${input.maxWords} words: ${input.text}`,
    });

    return {
      summary: result.text,
      wordCount: result.text.split(" ").length,
    };
  },
});

// Use task inside a resolver
resolvers: {
  summarize: {
    requirement: "SUMMARIZE",
    resolve: async (req, context) => {
      const output = await summarizeTask.run(
        { text: context.facts.input, maxWords: 100 },
        context
      );
      context.facts.summary = output.summary;
    },
  },
},
```

## Resolver Context API

```typescript
resolve: async (req, context) => {
  context.facts          // Read/write orchestrator facts
  context.runner         // Execute LLM calls
  context.signal         // AbortSignal for cancellation
  context.emit(event)    // Emit custom events to stream
  context.plugins        // Access plugin instances
}
```

## factsSchema Type Builders Reference

```typescript
// Primitives
t.string()                          // string
t.number()                          // number
t.boolean()                         // boolean

// Optional / nullable
t.string().optional()               // string | undefined
t.string().nullable()               // string | null

// Union literal types
t.string<"idle" | "running">()      // typed string union
t.number<1 | 2 | 3>()             // typed number union

// Objects and arrays
t.object<MyInterface>()             // typed object
t.array(t.string())                 // string[]
t.array(t.object<Item>())          // Item[]

// Record / map
t.record(t.string(), t.number())    // Record<string, number>
```

## Common Constraint Patterns

```typescript
constraints: {
  // Trigger on status transition
  onIdle: {
    when: (facts) => facts.status === "idle" && !!facts.input,
    require: { type: "START" },
  },

  // Priority for conflict resolution (higher = wins)
  emergency: {
    priority: 100,
    when: (facts) => facts.errorCount > 5,
    require: { type: "ABORT" },
  },

  // Pass data in requirement
  withPayload: {
    when: (facts) => facts.ready,
    require: (facts) => ({ type: "PROCESS", model: facts.preferredModel }),
  },
}
```

---

## Critical Anti-Patterns

## Using TypeScript types instead of t.*() in factsSchema

```typescript
// WRONG – TypeScript type annotations, not schema builders
factsSchema: {
  status: "idle" | "running" | "done",  // type annotation, not runtime schema
  count: number,
}

// CORRECT – t.*() builders provide runtime validation + TypeScript inference
factsSchema: {
  status: t.string<"idle" | "running" | "done">(),
  count: t.number(),
}
```

## Forgetting init()

```typescript
// WRONG – facts start undefined, constraints fail immediately
const orchestrator = createAgentOrchestrator({
  factsSchema: { status: t.string() },
  // missing init: facts.status is undefined
  constraints: {
    start: { when: (facts) => facts.status === "idle", ... },
  },
});

// CORRECT
init: (facts) => {
  facts.status = "idle";
},
```

### Resolver parameter naming
Always use `(req, context)` – never `(req, ctx)` or `(request, context)`.

## Single-line returns without braces

```typescript
// WRONG
when: (facts) => facts.status === "idle" ? true : false,

// CORRECT – always use multi-line blocks when branching
when: (facts) => {
  return facts.status === "idle";
},
```

## Mutating facts outside resolvers

```typescript
// WRONG – direct mutation bypasses reactivity
orchestrator.facts.status = "done";

// CORRECT – always via context.facts inside resolvers
resolve: async (req, context) => {
  context.facts.status = "done";
},
```

---

## Reference Files

- `ai-orchestrator.md` – Full createAgentOrchestrator API, options, lifecycle
- `ai-multi-agent.md` – createMultiAgentOrchestrator, coordinator pattern, agent communication
- `ai-tasks.md` – createTask API, task composition, input/output validation
- `examples/ai-orchestrator.ts` – Complete single-agent example
- `examples/ai-checkpoint.ts` – Checkpoint/resume pattern
- `examples/fraud-analysis.ts` – Multi-agent fraud detection example
