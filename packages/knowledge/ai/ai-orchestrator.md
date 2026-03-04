# AI Orchestrator (Single-Agent)

The `createAgentOrchestrator` configures a Directive-backed runtime for a single AI agent with constraints, resolvers, guardrails, memory, budgets, and hooks.

## Decision Tree: "How do I set up an orchestrator?"

```
Need to run an AI agent?
├── Single agent → createAgentOrchestrator (this file)
├── Multiple agents → createMultiAgentOrchestrator (see ai-multi-agent.md)
│
Setting up createAgentOrchestrator...
├── Need schema? → factsSchema with t.*() builders (NOT TS types)
├── Need guardrails? → guardrails: { input: [...], output: [...] }
├── Need memory? → memory: createAgentMemory({ strategy, summarizer })
├── Need budget control? → maxTokenBudget + budgetWarningThreshold
├── Need streaming? → orchestrator.runStream(agent, prompt)
└── Need approval workflow? → hooks.onBeforeRun returns { approved: boolean }
```

## Basic Setup

```typescript
import { createAgentOrchestrator, t } from "@directive-run/ai";
import { createAnthropicRunner } from "@directive-run/ai/anthropic";

const runner = createAnthropicRunner({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const orchestrator = createAgentOrchestrator({
  runner,
  factsSchema: {
    confidence: t.number(),
    analysis: t.string(),
    cache: t.array<string>(),
  },
  init: (facts) => {
    facts.confidence = 0;
    facts.analysis = "";
    facts.cache = [];
  },
  constraints: {
    lowConfidence: {
      when: (facts) => facts.confidence < 0.5,
      require: { type: "RE_ANALYZE" },
    },
  },
  resolvers: {
    reAnalyze: {
      requirement: "RE_ANALYZE",
      resolve: async (req, context) => {
        context.facts.confidence = 0;
      },
    },
  },
  guardrails: {
    input: [createPIIGuardrail({ redact: true })],
    output: [createLengthGuardrail({ maxChars: 5000 })],
  },
  maxTokenBudget: 100000,
  budgetWarningThreshold: 0.8,
  memory: createAgentMemory({
    strategy: createSlidingWindowStrategy({ maxMessages: 50 }),
    summarizer: createKeyPointsSummarizer(),
  }),
  debug: true,
  hooks: {
    onStart: () => console.log("Orchestrator started"),
    onBeforeRun: (agent, prompt) => ({ approved: true }),
    onAfterRun: (agent, result) => console.log("Done", result.totalTokens),
    onError: (error) => console.error(error),
    onBudgetWarning: (usage) => console.warn("Budget:", usage),
  },
});
```

## Running the Agent

```typescript
const agent = {
  name: "analyst",
  instructions: "You are a data analyst.",
  model: "claude-sonnet-4-5",
};

// Standard run
const result = await orchestrator.run(agent, "Analyze this dataset");
console.log(result.output);

// Streaming run
const stream = orchestrator.runStream(agent, "Summarize findings");
for await (const chunk of stream) {
  if (chunk.type === "token") {
    process.stdout.write(chunk.data);
  }
}

// Wait for all constraints/resolvers to settle
await orchestrator.system.settle();
```

## OrchestratorState Fields

```typescript
// Access via orchestrator.system.facts
orchestrator.system.facts.status;     // "idle" | "running" | "paused" | "error"
orchestrator.system.facts.tokenUsage; // { inputTokens, outputTokens, total }
orchestrator.system.facts.runCount;   // number of completed runs
orchestrator.system.facts.lastError;  // Error | null
```

## Approval Workflow

```typescript
const orchestrator = createAgentOrchestrator({
  runner,
  hooks: {
    onBeforeRun: async (agent, prompt) => {
      const decision = await reviewPrompt(prompt);

      return { approved: decision.ok, reason: decision.reason };
    },
  },
});

// If not approved, run() throws ApprovalDeniedError
```

## Pause / Resume

```typescript
orchestrator.pause();
// Agent work suspends; in-flight requests complete but new ones queue

orchestrator.resume();
// Queued work begins executing
```

## Checkpoints

```typescript
// Save state
const checkpoint = orchestrator.checkpoint();
const serialized = JSON.stringify(checkpoint);

// Restore state
const restored = createAgentOrchestrator({
  runner,
  checkpoint: JSON.parse(serialized),
});
```

## Anti-Patterns

### #21: TypeScript types instead of t.*() for factsSchema

```typescript
// WRONG — TS types are erased at runtime, no schema validation
const orchestrator = createAgentOrchestrator({
  runner,
  factsSchema: {} as { confidence: number; analysis: string },
});

// CORRECT — use t.*() builders for runtime schema
const orchestrator = createAgentOrchestrator({
  runner,
  factsSchema: {
    confidence: t.number(),
    analysis: t.string(),
  },
});
```

### #22: Mutating arrays/objects in place

```typescript
// WRONG — proxy cannot detect in-place mutations
context.facts.cache.push("new-item");

// CORRECT — replace the entire value
context.facts.cache = [...context.facts.cache, "new-item"];
```

### #23: Returning data from resolve

```typescript
// WRONG — resolvers return void, not data
resolve: async (req, context) => {
  const result = await analyzeData(req.input);

  return result; // Return value is ignored
},

// CORRECT — mutate context.facts to store results
resolve: async (req, context) => {
  const result = await analyzeData(req.input);
  context.facts.analysis = result;
},
```

### #24: Forgetting start() for multi-agent

```typescript
// WRONG — multi-agent orchestrators require explicit start()
const orchestrator = createMultiAgentOrchestrator({ agents, runner });
const result = await orchestrator.runPattern("pipeline", "prompt");

// CORRECT — call start() before running patterns
const orchestrator = createMultiAgentOrchestrator({ agents, runner });
orchestrator.start();
const result = await orchestrator.runPattern("pipeline", "prompt");
```

Note: Single-agent `createAgentOrchestrator` does NOT require `start()`. Only `createMultiAgentOrchestrator` does.

## Quick Reference

| Method | Purpose |
|---|---|
| `orchestrator.run(agent, prompt)` | Run agent, return RunResult |
| `orchestrator.runStream(agent, prompt)` | Run agent, return AsyncIterable<StreamChunk> |
| `orchestrator.pause()` | Suspend new work |
| `orchestrator.resume()` | Resume suspended work |
| `orchestrator.checkpoint()` | Serialize current state |
| `orchestrator.system.settle()` | Wait for all resolvers |
| `orchestrator.system.facts` | Read orchestrator state |
