---
title: Multi-Agent Orchestrator
description: Orchestrate multiple AI agents with concurrency control, per-agent guardrails, and shared state.
---

Coordinate multiple agents with concurrency control, per-agent configuration, and a reactive Directive System backbone. {% .lead %}

The multi-agent orchestrator has **full feature parity** with the [single-agent orchestrator](/ai/orchestrator): guardrails (orchestrator-level + per-agent), streaming, approval workflows, pause/resume, memory, hooks, retry, budget, plugins, time-travel debugging, constraints, and resolvers. Each registered agent becomes a namespaced module in a Directive System.

---

## Setup

Multi-agent orchestration builds on the [Agent Orchestrator](/ai/orchestrator) adapter. Define your agents, a runner, and register them:

```typescript
import { createMultiAgentOrchestrator, createPIIGuardrail } from '@directive-run/ai';
import type { AgentLike, AgentRunner, MultiAgentOrchestrator } from '@directive-run/ai';

const researcher: AgentLike = {
  name: 'researcher',
  instructions: 'You are a research assistant. Find relevant information on the given topic.',
  model: 'gpt-4',
};

const writer: AgentLike = {
  name: 'writer',
  instructions: 'You are a technical writer. Write clear, concise content from research notes.',
  model: 'gpt-4',
};

const reviewer: AgentLike = {
  name: 'reviewer',
  instructions: 'You review drafts for accuracy and clarity. Return "approve" or revision notes.',
  model: 'gpt-4',
};

const runner: AgentRunner = async (agent, input, options) => {
  return { output: '...', totalTokens: 0 };
};
```

---

## Creating the Orchestrator

```typescript
const orchestrator = createMultiAgentOrchestrator({
  runner,

  agents: {
    researcher: {
      agent: researcher,
      maxConcurrent: 3,
      timeout: 30000,
      capabilities: ['search', 'summarize'],
      description: 'Finds and summarizes information on any topic',
    },
    writer: {
      agent: writer,
      maxConcurrent: 1,
      timeout: 60000,
      guardrails: {
        output: [createPIIGuardrail({ redact: true })],
      },
    },
    reviewer: {
      agent: reviewer,
      maxConcurrent: 1,
      timeout: 30000,
    },
  },
});
```

### Configuration Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `runner` | `AgentRunner` | *required* | Base LLM execution function |
| `agents` | `AgentRegistry` | *required* | Map of agent ID to `AgentRegistration` |
| `patterns` | `Record<string, ExecutionPattern>` | `{}` | Named [execution patterns](/ai/patterns) |
| `guardrails` | `GuardrailsConfig` | &ndash; | Orchestrator-level guardrails (applied to all agents) |
| `hooks` | `MultiAgentLifecycleHooks` | &ndash; | Lifecycle hooks for observability |
| `memory` | `AgentMemory` | &ndash; | Shared [memory](/ai/memory) across all agents |
| `agentRetry` | `AgentRetryConfig` | &ndash; | Default retry config for all agents |
| `maxTokenBudget` | `number` | &ndash; | Maximum token budget across all agent runs |
| `budgetWarningThreshold` | `number` | `0.8` | Fires `onBudgetWarning` at this fraction of budget |
| `onBudgetWarning` | `(event) => void` | &ndash; | Budget warning callback |
| `plugins` | `Plugin[]` | `[]` | Plugins for the underlying Directive System |
| `onApprovalRequest` | `(request) => void` | &ndash; | Approval request callback |
| `autoApproveToolCalls` | `boolean` | `true` | Auto-approve tool calls |
| `approvalTimeoutMs` | `number` | `300000` | Approval timeout (ms) |
| `constraints` | `Record<string, OrchestratorConstraint>` | &ndash; | Orchestrator-level constraints |
| `resolvers` | `Record<string, OrchestratorResolver>` | &ndash; | Orchestrator-level resolvers |
| `circuitBreaker` | `CircuitBreaker` | &ndash; | Orchestrator-level circuit breaker |
| `derive` | `Record<string, CrossAgentDerivationFn>` | &ndash; | [Cross-agent derivations](/ai/cross-agent-state) |
| `scratchpad` | `{ init: Record<string, unknown> }` | &ndash; | [Shared scratchpad](/ai/cross-agent-state#shared-scratchpad) |
| `breakpoints` | `BreakpointConfig[]` | `[]` | [Breakpoints](/ai/breakpoints) |
| `onBreakpoint` | `(request) => void` | &ndash; | Breakpoint callback |
| `breakpointTimeoutMs` | `number` | `300000` | Breakpoint auto-cancel timeout |
| `onHandoff` | `(request) => void` | &ndash; | [Handoff](/ai/communication#handoffs) start callback |
| `onHandoffComplete` | `(result) => void` | &ndash; | Handoff complete callback |
| `maxHandoffHistory` | `number` | `1000` | Max completed handoff results to retain |
| `debug` | `boolean` | `false` | Enable debug logging and time-travel |

### Agent Registration

Each entry in the `agents` map is an `AgentRegistration`:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `agent` | `AgentLike` | *required* | The agent instance |
| `maxConcurrent` | `number` | `1` | Max parallel runs for this agent |
| `timeout` | `number` | &ndash; | Per-run timeout (ms) |
| `runOptions` | `Omit<RunOptions, 'signal'>` | &ndash; | Default run options |
| `description` | `string` | &ndash; | Human-readable description |
| `capabilities` | `string[]` | &ndash; | Capability tags for routing |
| `guardrails.input` | `GuardrailFn[]` | &ndash; | Per-agent input guardrails |
| `guardrails.output` | `GuardrailFn[]` | &ndash; | Per-agent output guardrails |
| `guardrails.toolCall` | `GuardrailFn[]` | &ndash; | Per-agent tool call guardrails |
| `retry` | `AgentRetryConfig` | &ndash; | Per-agent retry config |
| `constraints` | `Record<string, OrchestratorConstraint>` | &ndash; | Per-agent constraints |
| `resolvers` | `Record<string, OrchestratorResolver>` | &ndash; | Per-agent resolvers |
| `memory` | `AgentMemory` | &ndash; | Per-agent memory |
| `circuitBreaker` | `CircuitBreaker` | &ndash; | Per-agent circuit breaker |

---

## Running a Single Agent

```typescript
const result = await orchestrator.runAgent<string>('researcher', 'What is WebAssembly?');

console.log(result.output);
console.log(result.totalTokens);
```

If all `maxConcurrent` slots are occupied, the call waits until a slot opens (async semaphore &ndash; no polling).

```typescript
// With cancellation
const controller = new AbortController();
const result = await orchestrator.runAgent('researcher', 'Explain WASM', {
  signal: controller.signal,
});
```

### `run()` and `runStream()` Aliases

```typescript
const result = await orchestrator.run<string>('researcher', 'What is WebAssembly?');
const { stream } = orchestrator.runStream<string>('writer', 'Write about AI');
```

### `totalTokens` Getter

```typescript
console.log(orchestrator.totalTokens);  // Cumulative across all agents
```

---

## Agent State

```typescript
const state = orchestrator.getAgentState('researcher');
console.log(state.status);      // 'idle' | 'running' | 'completed' | 'error'
console.log(state.runCount);
console.log(state.totalTokens);
console.log(state.lastInput);
console.log(state.lastOutput);
console.log(state.lastError);

const allStates = orchestrator.getAllAgentStates();
```

### Pause & Resume

```typescript
orchestrator.pause();
orchestrator.resume();
```

When paused, `runAgent()` calls throw immediately.

### Wait for Idle

```typescript
await orchestrator.waitForIdle();
await orchestrator.waitForIdle(10000);  // With timeout
```

### Reset and Dispose

```typescript
orchestrator.reset();   // Reset states, drain semaphores, clear handoffs
orchestrator.dispose();  // Reset + destroy the Directive System
```

---

## Dynamic Agent Management

```typescript
orchestrator.registerAgent('editor', {
  agent: editor,
  maxConcurrent: 2,
  timeout: 30000,
  capabilities: ['proofread', 'format'],
});

const result = await orchestrator.runAgent('editor', 'Fix the grammar...');

console.log(orchestrator.getAgentIds());

orchestrator.unregisterAgent('editor');  // Must be idle
```

---

## Guardrails

Guardrails run at two levels: orchestrator-level (all agents) then per-agent (additive):

```typescript
const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: {
    researcher: {
      agent: researcher,
      guardrails: {
        output: [createOutputTypeGuardrail({ type: 'string', minStringLength: 10 })],
      },
    },
    writer: {
      agent: writer,
      guardrails: {
        input: [createPIIGuardrail({ redact: true })],
        output: [createPIIGuardrail()],
        toolCall: [createToolGuardrail({ denylist: ['shell'] })],
      },
    },
  },

  guardrails: {
    input: [createPIIGuardrail({ redact: true })],
    toolCall: [createToolGuardrail({ denylist: ['eval', 'exec'] })],
  },
});
```

See [Guardrails](/ai/guardrails) for the full API.

---

## Streaming

```typescript
const { stream, result, abort } = orchestrator.runAgentStream<string>('writer', 'Write about AI');

for await (const chunk of stream) {
  switch (chunk.type) {
    case 'token':
      process.stdout.write(chunk.data);
      break;
    case 'done':
      console.log(`\n${chunk.totalTokens} tokens`);
      break;
  }
}
```

See [Streaming](/ai/streaming) for chunk types and stream operators.

---

## Approval Workflow

```typescript
const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: { researcher: { agent: researcher }, writer: { agent: writer } },
  autoApproveToolCalls: false,
  approvalTimeoutMs: 60000,

  onApprovalRequest: (request) => {
    broadcastToAdminDashboard(request);
  },
});

orchestrator.approve(requestId);
orchestrator.reject(requestId, 'Denied by reviewer');
```

---

## Lifecycle Hooks

```typescript
const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: { /* ... */ },

  hooks: {
    onAgentStart: ({ agentId, agentName, input, timestamp }) => {
      console.log(`[${agentId}] Starting`);
    },
    onAgentComplete: ({ agentId, tokenUsage, durationMs }) => {
      console.log(`[${agentId}] Done: ${tokenUsage} tokens in ${durationMs}ms`);
    },
    onAgentError: ({ agentId, error, durationMs }) => {
      console.error(`[${agentId}] Failed:`, error.message);
    },
    onGuardrailCheck: ({ agentId, guardrailName, guardrailType, passed, reason }) => { },
    onAgentRetry: ({ agentId, attempt, error, delayMs }) => { },
    onPatternStart: ({ patternId, patternType }) => { },
    onPatternComplete: ({ patternId, durationMs, error }) => { },
  },
});
```

---

## Retries

```typescript
const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: {
    researcher: {
      agent: researcher,
      retry: { attempts: 5, backoff: 'exponential', baseDelayMs: 500 },
    },
    writer: { agent: writer },
  },

  agentRetry: {
    attempts: 3,
    backoff: 'exponential',
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    isRetryable: (error) => error.message.includes('429'),
  },
});
```

---

## Budget Control

```typescript
const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: { researcher: { agent: researcher }, writer: { agent: writer } },
  maxTokenBudget: 50000,
  budgetWarningThreshold: 0.75,
  onBudgetWarning: ({ currentTokens, maxBudget, percentage }) => {
    console.warn(`Budget: ${(percentage * 100).toFixed(0)}% used`);
  },
});
```

---

## Constraints & Resolvers

```typescript
import { requirementGuard } from '@directive-run/core/adapter-utils';

const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: {
    researcher: {
      agent: researcher,
      constraints: {
        lowConfidence: {
          when: (facts) => (facts.agent.output?.confidence ?? 1) < 0.5,
          require: { type: 'RUN_AGENT', agent: 'expert', input: 'Verify findings' },
        },
      },
    },
    expert: { agent: expert },
  },

  constraints: {
    budgetAlert: {
      priority: 100,
      when: (facts) => facts.globalTokens > 40000,
      require: { type: 'BUDGET_ALERT' },
    },
  },

  resolvers: {
    budgetAlert: {
      requirement: requirementGuard('BUDGET_ALERT'),
      resolve: async (req, context) => {
        console.warn('Approaching budget limit');
      },
    },
  },
});
```

---

## Concurrency Control

Each agent gets its own `Semaphore` instance:

```typescript
import { Semaphore } from '@directive-run/ai';

const sem = new Semaphore(3);

const release = await sem.acquire();
try {
  await doWork();
} finally {
  release();
}

console.log(sem.available);  // Free permits
console.log(sem.waiting);    // Queued callers
sem.drain();                 // Reject all waiters
```

---

## Debug & Time-Travel

```typescript
const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: { /* ... */ },
  debug: true,
});

const { system } = orchestrator;
```

---

## Error Handling

Unregistered agents and patterns throw with descriptive errors:

```typescript
// '[Directive MultiAgent] Unknown agent "nonexistent". Registered agents: researcher, writer'
await orchestrator.runAgent('nonexistent', 'hello');

// '[Directive MultiAgent] Unknown pattern "nonexistent". Available patterns: research'
await orchestrator.runPattern('nonexistent', 'hello');
```

See [Execution Patterns](/ai/patterns) for pattern-specific error handling (parallel `minSuccess`, sequential `continueOnError`, supervisor worker validation).

---

## Framework Integration

The orchestrator exposes `.system` &ndash; a Directive System with namespaced modules. Each agent's state lives under its ID with bridge keys `__agent`, `__approval`, `__conversation`, `__toolCalls`.

### React

```tsx
import { useFact, useSelector, useInspect } from '@directive-run/react';

function MultiAgentPanel({ orchestrator }: { orchestrator: MultiAgentOrchestrator }) {
  const { system } = orchestrator;
  const researcherAgent = useFact(system, 'researcher::__agent');
  const writerAgent = useFact(system, 'writer::__agent');
  const { isSettled } = useInspect(system);

  return (
    <div>
      <p>Researcher: {researcherAgent?.status}</p>
      <p>Writer: {writerAgent?.status}</p>
      <p>{isSettled ? 'Idle' : 'Working...'}</p>
    </div>
  );
}
```

Framework adapters for Vue, Svelte, Solid, and Lit follow the same pattern &ndash; see [Framework Adapters](/docs/adapters/overview).

---

## Next Steps

- [Execution Patterns](/ai/patterns) &ndash; Parallel, sequential, supervisor, DAG, race, reflect, debate
- [Communication](/ai/communication) &ndash; Message bus, agent network, handoffs
- [Cross-Agent State](/ai/cross-agent-state) &ndash; Derivations and scratchpad
- [Self-Healing](/ai/self-healing) &ndash; Automatic error recovery
- [Goal Engine](/ai/goals) &ndash; Desired-state convergence
- [Memory](/ai/memory) &ndash; Conversation context management
