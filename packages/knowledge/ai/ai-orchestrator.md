# AI Orchestrator (single-agent)

> Covers `@directive-run/ai` — `createAgentOrchestrator` for single-agent runs with constraints, resolvers, guardrails, memory, budgets, approval, breakpoints, retry, structured output, circuit breakers, checkpoints.

`createAgentOrchestrator` builds a Directive-backed runtime for ONE AI agent with constraints, resolvers, guardrails, memory, budgets, approval, breakpoints, retry, structured output, circuit breakers, checkpoints, and observability hooks.

For multiple agents (pipelines, debates, DAGs), see `ai-multi-agent.md`.

## Decision tree

```
Setting up createAgentOrchestrator…
├── Custom orchestrator state? → factsSchema with t.*() builders (NOT TS types)
├── Need input/output guardrails? → guardrails: { input: [...], output: [...] }
├── Need conversation memory? → memory: createAgentMemory({ strategy })
├── Need token budget? → maxTokenBudget + onBudgetWarning (TOP-LEVEL — not in hooks)
├── Need streaming? → orchestrator.runStream(agent, input) returns { stream, result, abort }
├── Need approval before tool calls? → onApprovalRequest + orchestrator.approve()/reject()
├── Need human-in-the-loop pauses? → breakpoints: [...] + onBreakpoint callback
├── Need observability? → hooks.onAgentStart / onAgentComplete / onAgentError / onAgentRetry / onGuardrailCheck
├── Need automatic retry on failure? → agentRetry: { maxRetries, baseDelayMs }
├── Need structured output? → outputSchema: zodSchema (with maxSchemaRetries)
├── Need failure isolation? → circuitBreaker: createCircuitBreaker(...)
└── Need save/restore? → checkpointStore + orchestrator.checkpoint()/restore()
```

## Basic setup

```typescript
import { createAgentOrchestrator } from "@directive-run/ai";
import { createAnthropicRunner } from "@directive-run/ai/anthropic";
import { t } from "@directive-run/core";

const runner = createAnthropicRunner({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const orchestrator = createAgentOrchestrator({
  runner,
  factsSchema: {
    confidence: t.number(),
    analysis: t.string(),
  },
  init: (facts) => {
    facts.confidence = 0;
    facts.analysis = "";
  },
  constraints: {
    lowConfidence: {
      when: (facts) => facts.confidence < 0.5,
      require: { type: "RE_ANALYZE" },
    },
  },
  resolvers: {
    reAnalyze: {
      requirement: (req): req is { type: "RE_ANALYZE" } => req.type === "RE_ANALYZE",
      resolve: async (req, context) => {
        context.facts.confidence = 1;
      },
    },
  },
});

const result = await orchestrator.run(
  { name: "analyst", instructions: "You are a data analyst.", model: "claude-sonnet-4-5" },
  "Analyze this dataset",
);

console.log(result.output, result.tokenUsage);
```

## Running an agent

`run(agent, input, options?)` resolves to `RunResult<T>`.
`runStream(agent, input, options?)` returns `{ stream, result, abort }` — `stream` is the async iterator, `result` is a promise for the final result, `abort` cancels the in-flight run.

```typescript
// Standard run
const result = await orchestrator.run(agent, "Analyze this dataset");
console.log(result.output, result.tokenUsage);

// Streaming run — destructure the three handles
const { stream, result, abort } = orchestrator.runStream(agent, "Summarize findings");

for await (const chunk of stream) {
  if (chunk.type === "token") {
    process.stdout.write(chunk.data);
  }
  if (chunk.type === "approval_required") {
    // Show your approval UI; resolve with orchestrator.approve(chunk.requestId)
  }
  if (chunk.type === "guardrail_triggered") {
    console.warn("guardrail:", chunk.guardrail);
  }
}

const final = await result;

// Wait for any in-flight resolvers to drain
await orchestrator.waitForIdle();
```

## Reading orchestrator state

State lives on `orchestrator.facts.agent` — the `AgentState` is nested under `agent` because the orchestrator's facts shape is `OrchestratorState & F` (your custom facts merged with the orchestrator's built-ins).

```typescript
// Built-in agent state
orchestrator.facts.agent.status;        // "idle" | "running" | "paused" | "completed" | "error"
orchestrator.facts.agent.currentAgent;  // string | null — the agent name when running
orchestrator.facts.agent.input;         // string | null — current prompt
orchestrator.facts.agent.output;        // unknown | null — last output
orchestrator.facts.agent.error;         // string | null — last error message
orchestrator.facts.agent.tokenUsage;    // number — cumulative tokens used
orchestrator.facts.agent.turnCount;     // number — completed turns
orchestrator.facts.agent.startedAt;     // number | null — ms timestamp
orchestrator.facts.agent.completedAt;   // number | null

// Cumulative tokens (also exposed at the top of the orchestrator)
orchestrator.totalTokens;

// Approval queue (when autoApproveToolCalls: false)
orchestrator.facts.approval.pending;    // ApprovalRequest[]
orchestrator.facts.approval.approved;   // string[]
orchestrator.facts.approval.rejected;   // RejectedRequest[]

// Conversation + tool call history
orchestrator.facts.conversation;        // Message[]
orchestrator.facts.toolCalls;           // ToolCall[]
```

## Token budget

`maxTokenBudget` is the cap. When usage crosses it the orchestrator pauses (sets `facts.agent.status = "paused"`). `budgetWarningThreshold` (0–1, default 0.8) fires `onBudgetWarning` BEFORE the cap. **Both options are top-level — NOT inside `hooks:`**.

```typescript
const orchestrator = createAgentOrchestrator({
  runner,
  maxTokenBudget: 100_000,
  budgetWarningThreshold: 0.8,
  onBudgetWarning: ({ currentTokens, maxBudget, percentage }) => {
    console.warn(`Token usage at ${Math.round(percentage * 100)}% (${currentTokens}/${maxBudget})`);
  },
});
```

## Memory

```typescript
import { createAgentMemory, createSlidingWindowStrategy, createKeyPointsSummarizer } from "@directive-run/ai";

const orchestrator = createAgentOrchestrator({
  runner,
  memory: createAgentMemory({
    strategy: createSlidingWindowStrategy({ maxMessages: 50 }),
    summarizer: createKeyPointsSummarizer(),
  }),
});
```

When `memory` is configured, prior conversation context is auto-injected into each agent run, and the agent's response is auto-stored. See `ai-guardrails-memory.md` for memory strategies in depth.

## Guardrails

```typescript
import {
  createPIIGuardrail,
  createLengthGuardrail,
  createPromptInjectionGuardrail,
} from "@directive-run/ai/guardrails";

const orchestrator = createAgentOrchestrator({
  runner,
  guardrails: {
    input: [
      createPIIGuardrail({ redact: true }),
      createPromptInjectionGuardrail({ strictMode: true }),
    ],
    output: [
      createLengthGuardrail({ maxCharacters: 5000 }),
    ],
  },
});
```

See `ai-guardrails-memory.md` for the full list of guardrail factories and their actual option shapes.

## Lifecycle hooks (observability)

These hooks fire purely for observability — they cannot block, deny, or modify runs. To block a run before it executes, use `breakpoints` (next section) or guardrails.

```typescript
const orchestrator = createAgentOrchestrator({
  runner,
  hooks: {
    onAgentStart:   (e) => console.log(`▶ ${e.agentName} @ ${e.timestamp}`),
    onAgentComplete: (e) => console.log(`✓ ${e.agentName} — ${e.tokenUsage} tokens in ${e.durationMs}ms`),
    onAgentError:    (e) => console.error(`✗ ${e.agentName}:`, e.error),
    onAgentRetry:    (e) => console.warn(`↻ ${e.agentName} attempt ${e.attempt}`),
    onGuardrailCheck: (e) => console.log(`${e.passed ? "✓" : "✗"} ${e.guardrailName}`),
    onBreakpoint:    (req) => console.log(`⏸ breakpoint ${req.id}`),
  },
});
```

The full event payload shapes live in `@directive-run/ai`'s `OrchestratorLifecycleHooks` interface.

## Human-in-the-loop: breakpoints + approval

For approval workflows (pause before a sensitive tool call), Directive offers two layered mechanisms:

### Tool-call approval (`autoApproveToolCalls: false`)

```typescript
const orchestrator = createAgentOrchestrator({
  runner,
  autoApproveToolCalls: false,
  onApprovalRequest: (request) => {
    showApprovalDialog(request); // your UI
  },
  approvalTimeoutMs: 5 * 60 * 1000,
});

// In your UI handler:
orchestrator.approve(request.id);
// or
orchestrator.reject(request.id, "policy violation");
```

### Breakpoints (arbitrary pause points)

```typescript
import type { BreakpointConfig } from "@directive-run/ai";

const orchestrator = createAgentOrchestrator({
  runner,
  breakpoints: [
    { id: "review-prompt", before: "agent_start" },
    { id: "review-output", after: "agent_complete" },
  ],
  onBreakpoint: (request) => {
    showReviewUI(request);
  },
  breakpointTimeoutMs: 5 * 60 * 1000,
});

// Resume (optionally with input modifications)
orchestrator.resumeBreakpoint("review-prompt");

// Or cancel
orchestrator.cancelBreakpoint("review-prompt", "user aborted");
```

## Retry + circuit breaker + self-healing

```typescript
import { createCircuitBreaker } from "@directive-run/ai";

const orchestrator = createAgentOrchestrator({
  runner,
  agentRetry: {
    maxRetries: 3,
    baseDelayMs: 500,
    maxDelayMs: 5000,
    isRetryable: (err) => err.message.includes("rate_limit"),
    onRetry: ({ attempt, error, delayMs }) => console.warn(`retry ${attempt} in ${delayMs}ms:`, error.message),
  },
  circuitBreaker: createCircuitBreaker({
    failureThreshold: 5,
    recoveryTimeMs: 60_000,
    halfOpenMaxRequests: 1,
  }),
});
```

See `ai-budget-resilience.md` for the resilience surface in depth (retry, fallback, circuit breaker, health monitor, self-healing).

## Structured output

```typescript
import { z } from "zod";

const orchestrator = createAgentOrchestrator({
  runner,
  outputSchema: z.object({
    summary: z.string(),
    confidence: z.number().min(0).max(1),
  }),
  maxSchemaRetries: 2,
});

const result = await orchestrator.run(agent, "Summarize this article");
// result.output is typed and parsed by the Zod schema; up to 2 retries on validation failure
```

`outputSchema` accepts anything with a `safeParse(value)` method — Zod, Valibot, or your own validator.

## Pause / resume

```typescript
orchestrator.pause();   // in-flight runs complete; new ones queue
orchestrator.resume();  // queued work begins executing
orchestrator.reset();   // clears conversation, approval, and tool-call state
```

## Checkpoints (save / restore)

`checkpoint()` is **async** — it returns a Promise. Restore on an EXISTING orchestrator instance with `restore()`; there is no constructor option that takes a checkpoint.

```typescript
import { createInMemoryCheckpointStore } from "@directive-run/ai";

const orchestrator = createAgentOrchestrator({
  runner,
  checkpointStore: createInMemoryCheckpointStore(),
});

// Save
const cp = await orchestrator.checkpoint({ label: "after-analysis" });
const serialized = JSON.stringify(cp);

// Restore — on the same instance, or a fresh one with the same config shape
const newOrchestrator = createAgentOrchestrator({ runner, /* same options */ });
newOrchestrator.restore(JSON.parse(serialized));
```

## Anti-patterns

### TS types instead of `t.*()` for `factsSchema`

```typescript
// WRONG — TS types are erased at runtime; no schema validation, no defaults
factsSchema: {} as { confidence: number; analysis: string }

// CORRECT — t.*() builders provide runtime shape + types
factsSchema: { confidence: t.number(), analysis: t.string() }
```

### In-place array/object mutation

```typescript
// WRONG — the proxy can't detect in-place mutations
context.facts.cache.push("new-item");

// CORRECT — replace the value
context.facts.cache = [...context.facts.cache, "new-item"];
```

### Returning data from `resolve`

```typescript
// WRONG — resolvers return void; return value is ignored
resolve: async (req, context) => {
  return await analyzeData(req.input);
}

// CORRECT — mutate facts to store results
resolve: async (req, context) => {
  context.facts.analysis = await analyzeData(req.input);
}
```

### Confusing single-agent with multi-agent lifecycle

```typescript
// Single-agent orchestrator — NO start() needed
const orch = createAgentOrchestrator({ runner });
await orch.run(agent, "prompt"); // ✓ ready

// Multi-agent orchestrator — start() IS required before runPattern
const multi = createMultiAgentOrchestrator({ agents, runner });
multi.start();
await multi.runPattern("pipeline", "prompt");
```

### Hook names from a guess instead of the type

```typescript
// WRONG — onStart / onBeforeRun / onAfterRun / onError do not exist on OrchestratorLifecycleHooks
hooks: {
  onStart: () => {},
  onBeforeRun: () => ({ approved: true }),
  onAfterRun: () => {},
  onError: () => {},
}

// CORRECT — actual names are onAgent*
hooks: {
  onAgentStart:    (e) => {},
  onAgentComplete: (e) => {},
  onAgentError:    (e) => {},
  onAgentRetry:    (e) => {},
  onGuardrailCheck: (e) => {},
}
```

### Putting `onBudgetWarning` inside `hooks`

```typescript
// WRONG — onBudgetWarning is a TOP-LEVEL option
{ hooks: { onBudgetWarning: () => {} } }

// CORRECT
{ onBudgetWarning: (event) => {}, maxTokenBudget: 100_000 }
```

### Treating `checkpoint()` as sync

```typescript
// WRONG — checkpoint() returns a Promise
const cp = orchestrator.checkpoint();
const json = JSON.stringify(cp); // serializes "[object Promise]"

// CORRECT — await it
const cp = await orchestrator.checkpoint({ label: "snapshot-1" });
const json = JSON.stringify(cp);
```

### Restoring via constructor option

```typescript
// WRONG — there is no `checkpoint` option on createAgentOrchestrator
const orch = createAgentOrchestrator({ runner, checkpoint: savedCheckpoint });

// CORRECT — restore on an existing instance
const orch = createAgentOrchestrator({ runner });
orch.restore(savedCheckpoint);
```

### Iterating `runStream`'s return value directly

```typescript
// WRONG — runStream returns { stream, result, abort }, not an AsyncIterable
const stream = orchestrator.runStream(agent, "prompt");
for await (const chunk of stream) { /* never iterates the right thing */ }

// CORRECT — destructure
const { stream, result, abort } = orchestrator.runStream(agent, "prompt");
for await (const chunk of stream) { /* … */ }
const final = await result;
```

## Quick reference

| Method | Purpose |
|---|---|
| `orch.run(agent, input, opts?)` | Run agent → `Promise<RunResult<T>>` |
| `orch.runStream(agent, input, opts?)` | Run agent → `{ stream, result, abort }` |
| `orch.approve(id)` / `orch.reject(id, reason?)` | Resolve a pending approval request |
| `orch.pause()` / `orch.resume()` / `orch.reset()` | Lifecycle control |
| `orch.waitForIdle(timeoutMs?)` | Resolves when orchestrator is back at idle |
| `orch.checkpoint(opts?)` | Async — `Promise<Checkpoint>` |
| `orch.restore(cp, opts?)` | Restore state on an existing instance |
| `orch.resumeBreakpoint(id, mods?)` / `orch.cancelBreakpoint(id, reason?)` | Resume/cancel a paused breakpoint |
| `orch.facts.agent.*` | Read built-in agent state |
| `orch.totalTokens` | Cumulative token count |
| `orch.timeline` | DebugTimeline (when `debug: true`); `null` otherwise |

## See also

- [`ai-multi-agent.md`](./ai-multi-agent.md) — the multi-agent flavor; 8 composition patterns and pattern factories
- [`ai-adapters.md`](./ai-adapters.md) — provider runners that produce the `runner` this orchestrator wraps
- [`ai-guardrails-memory.md`](./ai-guardrails-memory.md) — full surface of the `guardrails:` and `memory:` options on this orchestrator
- [`ai-budget-resilience.md`](./ai-budget-resilience.md) — full surface of the `circuitBreaker:`, `selfHealing:`, `agentRetry:`, `maxTokenBudget:` options
- [`ai-debug-observability.md`](./ai-debug-observability.md) — full surface of the `debug:`, `breakpoints:`, `onBreakpoint:` options + `orchestrator.timeline`
- [`ai-testing-evals.md`](./ai-testing-evals.md) — `createTestOrchestrator` for unit testing this surface
