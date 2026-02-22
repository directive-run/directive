---
title: Agent Orchestrator
description: Build AI agents with constraint-driven orchestration, guardrails, and approval workflows.
---

Orchestrate AI agents with guardrails, approvals, and budget control. {% .lead %}

The orchestrator is **LLM-agnostic** – provide any `runner` function that accepts an agent and input, and Directive handles safety, approvals, and state tracking. Works with OpenAI, Anthropic, Gemini, Ollama, or your own backend.

{% callout title="Need multiple agents?" %}
For parallel, sequential, or supervisor execution with per-agent guardrails and concurrency control, see [Multi-Agent Orchestration](/ai/multi-agent). The multi-agent orchestrator has full feature parity with the single-agent orchestrator documented here.
{% /callout %}

---

## Setup

The `createAgentOrchestrator` function wraps your agent run function with Directive's constraint engine, adding guardrails, approval workflows, and observability:

```typescript
import {
  createAgentOrchestrator,
  createPIIGuardrail,
} from '@directive-run/ai';
import type { AgentLike, AgentRunner } from '@directive-run/ai';

// Describe what the agent does and which model it uses
const agent: AgentLike = {
  name: 'assistant',
  instructions: 'You are a helpful assistant.',
  model: 'gpt-4',
};

// Wrap your LLM SDK in a standard runner function
const runner: AgentRunner = async (agent, input, options) => {
  const result = await myLLMCall(agent, input, options);

  return result;
};

// Wire the runner into an orchestrator with safety and state tracking
const orchestrator = createAgentOrchestrator({
  runner,
  autoApproveToolCalls: true,
});
```

---

## Running an Agent

Run an agent through the orchestrator. All guardrails, approval checks, and state tracking happen automatically:

```typescript
const result = await orchestrator.run<string>(agent, 'What is WebAssembly?');

// Inspect what the agent returned
console.log(result.output);       // The agent's response
console.log(result.totalTokens);  // Token usage
console.log(result.messages);     // Full conversation
console.log(result.toolCalls);    // Any tools called
```

The orchestrator tracks state internally. Check it anytime:

```typescript
// Read live orchestrator state between runs
console.log(orchestrator.facts.agent.status);       // 'idle' | 'running' | 'paused' | 'completed' | 'error'
console.log(orchestrator.facts.agent.tokenUsage);   // Cumulative tokens across all runs
console.log(orchestrator.facts.agent.turnCount);     // Total message count
console.log(orchestrator.facts.conversation);        // Full conversation history
```

---

## Guardrails

Validate inputs, outputs, and tool calls before they execute. See [Guardrails & Safety](/ai/guardrails) for the full API, built-in guardrails, and streaming constraints.

```typescript
import {
  createAgentOrchestrator,
  createPIIGuardrail,
  createToolGuardrail,
} from '@directive-run/ai';

const orchestrator = createAgentOrchestrator({
  runner,
  autoApproveToolCalls: true,
  guardrails: {
    // Scrub personal data from user input before it reaches the agent
    input: [createPIIGuardrail({ redact: true })],

    // Prevent the agent from calling dangerous tools
    toolCall: [createToolGuardrail({ denylist: ['shell', 'eval'] })],
  },
});
```

---

## Approval Workflow

Require human approval before tool calls execute. When the agent wants to call a tool, the orchestrator **pauses the run**, fires your callback, and waits for you to call `approve()` or `reject()` before continuing.

Here's the flow:

1. Agent run hits a tool call
2. Orchestrator pauses and fires `onApprovalRequest` with a request object
3. Your code forwards that request to a human (UI, Slack, email, etc.)
4. The human decides – your code calls `orchestrator.approve(id)` or `orchestrator.reject(id)`
5. The agent run resumes (or fails if rejected/timed out)

### Express API Example

A common pattern is exposing approval over a REST API. The orchestrator fires the callback, you store the pending request, and a separate endpoint handles the human's decision:

```typescript
import express from 'express';

const app = express();
app.use(express.json());

const orchestrator = createAgentOrchestrator({
  runner,
  autoApproveToolCalls: false,
  approvalTimeoutMs: 60000,

  // Step 1: Orchestrator pauses here and fires this callback
  onApprovalRequest: (request) => {
    // request.id    – unique ID for this approval (pass it back to approve/reject)
    // request.agentName – which agent wants to act
    // request.description – human-readable summary of the tool call
    // request.data – the raw tool call payload

    // Step 2: Push to your frontend via WebSocket, SSE, polling, etc.
    broadcastToAdminDashboard({
      requestId: request.id,
      agent: request.agentName,
      action: request.description,
      details: request.data,
    });
  },
});

// Step 3: Human clicks "Approve" or "Reject" in the dashboard, which hits this endpoint
app.post('/api/approvals/:requestId', (req, res) => {
  const { requestId } = req.params;
  const { approved, reason } = req.body;

  if (approved) {
    orchestrator.approve(requestId);      // Unpauses the agent run
  } else {
    orchestrator.reject(requestId, reason ?? 'Denied by reviewer');
  }

  res.json({ ok: true });
});
```

### React UI Example

In a frontend app, use the orchestrator's reactive state to render pending approvals and wire the buttons directly:

```tsx
function ApprovalPanel({ orchestrator }) {
  const approval = useFact(orchestrator.system, '__approval');

  return (
    <div>
      {approval?.pending?.map((req) => (
        <div key={req.id}>
          <p><strong>{req.agentName}</strong> wants to: {req.description}</p>
          <pre>{JSON.stringify(req.data, null, 2)}</pre>
          <button onClick={() => orchestrator.approve(req.id)}>Approve</button>
          <button onClick={() => orchestrator.reject(req.id, 'Denied')}>Reject</button>
        </div>
      ))}
    </div>
  );
}
```

### Querying Approval State

Check pending approvals anytime:

```typescript
const pending = orchestrator.facts.approval.pending;    // Requests waiting for a decision
const approved = orchestrator.facts.approval.approved;  // Requests that were approved
const rejected = orchestrator.facts.approval.rejected;  // Requests that were rejected
```

---

## Budget Control

Set a token budget that automatically pauses agents when exceeded:

```typescript
const orchestrator = createAgentOrchestrator({
  runner,
  autoApproveToolCalls: true,
  maxTokenBudget: 10000,             // Agent auto-pauses when this limit is hit
});

await orchestrator.run(agent, 'Summarize this document...');

// Track cumulative spend after each run
console.log(orchestrator.facts.agent.tokenUsage);  // e.g., 3500
console.log(orchestrator.facts.agent.status);       // 'completed'

// After many runs, once the budget is exhausted:
// orchestrator.facts.agent.status === 'paused'
```

For more granular cost control, use custom constraints:

```typescript
const orchestrator = createAgentOrchestrator({
  runner,
  autoApproveToolCalls: true,

  // Fire a warning when token usage crosses 5,000
  constraints: {
    costWarning: {
      priority: 100,
      when: (facts) => facts.agent.tokenUsage > 5000,
      require: { type: 'COST_WARNING' },
    },
  },

  // Handle the warning by logging (could also notify, throttle, etc.)
  resolvers: {
    costWarning: {
      requirement: 'COST_WARNING',
      resolve: async (req, context) => {
        console.warn('Token usage high:', context.facts.agent.tokenUsage);
      },
    },
  },
});
```

---

## Constraints & Resolvers

Add custom orchestrator-level constraints that react to agent state. Constraints evaluate after each run and trigger resolvers when conditions are met:

```typescript
// Type the output generic so facts.agent.output is typed
interface MyOutput { confidence?: number }

const orchestrator = createAgentOrchestrator<{}, MyOutput>({
  runner,
  autoApproveToolCalls: true,

  constraints: {
    // Escalate to an expert when the agent is not confident enough
    escalateToExpert: {
      when: (facts) => (facts.agent.output?.confidence ?? 1) < 0.7,
      require: (facts) => ({
        type: 'RUN_EXPERT',
        query: facts.agent.input,
      }),
      priority: 50,
    },
  },

  resolvers: {
    // Spin up a more capable agent with the same question
    runExpert: {
      requirement: 'RUN_EXPERT',
      resolve: async (req, context) => {
        const expertAgent: AgentLike = {
          name: 'expert',
          instructions: 'You are a domain expert. Provide detailed, accurate answers.',
          model: 'gpt-4',
        };
        const result = await context.runAgent(expertAgent, req.query);
      },
    },
  },
});
```

Resolvers receive a context with `facts` (the combined orchestrator state), `runAgent` (to run additional agents), and `signal` (for cancellation).

### Defining Constraints

Constraints are plain objects with `when`, `require`, and optional `priority`:

```typescript
constraints: {
  escalate: {
    when: (facts) => facts.agent.output?.confidence < 0.7,
    require: { type: 'ESCALATE' },
    priority: 50,
  },
  pause: {
    when: (facts) => facts.agent.tokenUsage > 10000,
    require: { type: 'PAUSE' },
  },
},
```

---

## Lifecycle Hooks

Observe agent runs, guardrail checks, and retries without modifying behavior:

```typescript
const orchestrator = createAgentOrchestrator({
  runner,
  autoApproveToolCalls: true,

  hooks: {
    // Log when an agent begins processing
    onAgentStart: ({ agentName, input, timestamp }) => {
      console.log(`[${agentName}] Starting at ${timestamp}`);
    },

    // Track performance after each successful run
    onAgentComplete: ({ agentName, tokenUsage, durationMs }) => {
      console.log(`[${agentName}] Done: ${tokenUsage} tokens in ${durationMs}ms`);
    },

    // Surface errors with timing context
    onAgentError: ({ agentName, error, durationMs }) => {
      console.error(`[${agentName}] Failed after ${durationMs}ms:`, error.message);
    },

    // Alert when a guardrail blocks content
    onGuardrailCheck: ({ guardrailName, guardrailType, passed, reason }) => {
      if (!passed) {
        console.warn(`Guardrail ${guardrailName} (${guardrailType}) blocked: ${reason}`);
      }
    },

    // Monitor automatic retries
    onAgentRetry: ({ agentName, attempt, error, delayMs }) => {
      console.log(`[${agentName}] Retry #${attempt} in ${delayMs}ms: ${error.message}`);
    },
  },
});
```

---

## Retries

Configure automatic retries with backoff for transient failures:

```typescript
const orchestrator = createAgentOrchestrator({
  runner,
  autoApproveToolCalls: true,

  agentRetry: {
    attempts: 3,                  // Try up to 3 times before giving up
    backoff: 'exponential',       // 'exponential' | 'linear' | 'fixed'
    baseDelayMs: 1000,            // First retry waits 1s
    maxDelayMs: 30000,            // Cap delay at 30s

    // Only retry rate limits and server errors
    isRetryable: (error) => {
      return error.message.includes('429') || error.message.includes('500');
    },

    onRetry: (attempt, error, delayMs) => {
      console.log(`Retry ${attempt} in ${delayMs}ms: ${error.message}`);
    },
  },
});
```

For HTTP-status-aware retry with provider fallback and cost budget guards, see [Resilience & Routing](/ai/resilience-routing). The `withRetry` wrapper respects `Retry-After` headers on `429` responses and uses exponential backoff with jitter on `503`, while `withFallback` chains multiple providers for automatic failover.

---

## Composing Middleware with `pipe()`

Use `pipe()` to compose middleware left-to-right onto a runner before passing it to the orchestrator. This is cleaner than nested `with*()` calls:

```typescript
import {
  createAgentOrchestrator,
  pipe,
  withRetry,
  withFallback,
  withBudget,
  withModelSelection,
  byInputLength,
} from '@directive-run/ai';

// pipe() applies middleware left to right – innermost first
const runner = pipe(
  baseRunner,
  (r) => withModelSelection(r, [byInputLength(200, 'gpt-4o-mini')]),
  (r) => withFallback([r, backupRunner]),
  (r) => withRetry(r, { maxRetries: 3 }),
  (r) => withBudget(r, {
    budgets: [{ window: 'hour', maxCost: 5, pricing }],
  }),
);

const orchestrator = createAgentOrchestrator({ runner, autoApproveToolCalls: true });
```

See [Resilience & Routing](/ai/resilience-routing) for all available middleware wrappers.

---

## Pause & Resume

Manually control agent execution:

```typescript
// Pause all agent activity (e.g., user clicked "stop")
orchestrator.pause();
console.log(orchestrator.facts.agent.status); // 'paused'

// Resume from where the agent left off
orchestrator.resume();
console.log(orchestrator.facts.agent.status); // 'running' or 'idle'

// Wipe conversation, token usage, and approvals for a fresh session
orchestrator.reset();

// Release resources when the component or process shuts down
orchestrator.dispose();
```

---

## Framework Integration

The orchestrator exposes a `.system` property – a standard Directive system – so all framework hooks work out of the box. The bridge keys are `__agent`, `__approval`, `__conversation`, and `__toolCalls`.

### React

```tsx
import { useAgentOrchestrator, useFact, useSelector, useWatch, useInspect } from '@directive-run/react';

function AgentPanel() {
  // Initialize the orchestrator as a React hook (auto-disposes on unmount)
  const orchestrator = useAgentOrchestrator({
    runner,
    autoApproveToolCalls: true,
  });
  const { system } = orchestrator;

  // Subscribe to individual bridge keys – re-renders when they change
  const agent = useFact(system, '__agent');
  const conversation = useFact(system, '__conversation');
  const approval = useFact(system, '__approval');

  // Derive a summary object – only re-renders when derived values change
  const summary = useSelector(system, (state) => ({
    status: state.__agent?.status,
    tokens: state.__agent?.tokenUsage,
    pending: state.__approval?.pending?.length ?? 0,
  }));

  // Check whether the orchestrator has finished all pending work
  const { isSettled } = useInspect(system);

  // Fire a side-effect when the agent finishes (does not cause re-render)
  useWatch(system, 'fact', '__agent', (next, prev) => {
    if (prev?.status === 'running' && next?.status === 'completed') {
      console.log('Agent finished:', next.output);
    }
  });

  return (
    <div>
      <p>Status: {agent?.status}</p>
      <p>Tokens: {agent?.tokenUsage}</p>
      <p>Messages: {conversation?.length ?? 0}</p>
      <p>Pending approvals: {approval?.pending?.length ?? 0}</p>
      <p>{isSettled ? 'Idle' : 'Working...'}</p>
    </div>
  );
}
```

### Vue

```html
<script setup>
import { createAgentOrchestrator } from '@directive-run/ai';
import { useFact, useSelector, useInspect } from '@directive-run/vue';
import { onUnmounted } from 'vue';

const orchestrator = createAgentOrchestrator({ runner, autoApproveToolCalls: true });
onUnmounted(() => orchestrator.dispose()); // Clean up on component teardown

// Reactive refs that update when the orchestrator state changes
const agent = useFact(orchestrator.system, '__agent');
const conversation = useFact(orchestrator.system, '__conversation');
const { isSettled } = useInspect(orchestrator.system);
</script>

<template>
  <p>Status: {{ agent?.status }}</p>
  <p>Tokens: {{ agent?.tokenUsage }}</p>
  <p>Messages: {{ conversation?.length ?? 0 }}</p>
  <p>{{ isSettled ? 'Idle' : 'Working...' }}</p>
</template>
```

### Svelte

```html
<script>
import { createAgentOrchestrator } from '@directive-run/ai';
import { useFact, useInspect } from '@directive-run/svelte';
import { onDestroy } from 'svelte';

const orchestrator = createAgentOrchestrator({ runner, autoApproveToolCalls: true });
onDestroy(() => orchestrator.dispose());

// Svelte stores – use $store syntax in the template for reactivity
const agent = useFact(orchestrator.system, '__agent');
const conversation = useFact(orchestrator.system, '__conversation');
const inspect = useInspect(orchestrator.system);
</script>

<p>Status: {$agent?.status}</p>
<p>Tokens: {$agent?.tokenUsage}</p>
<p>Messages: {$conversation?.length ?? 0}</p>
<p>{$inspect.isSettled ? 'Idle' : 'Working...'}</p>
```

### Solid

```tsx
import { createAgentOrchestrator } from '@directive-run/ai';
import { useFact, useInspect } from '@directive-run/solid';
import { onCleanup } from 'solid-js';

function AgentPanel() {
  const orchestrator = createAgentOrchestrator({ runner, autoApproveToolCalls: true });
  onCleanup(() => orchestrator.dispose());

  // Solid signals – call agent() and conversation() to read current values
  const agent = useFact(orchestrator.system, '__agent');
  const conversation = useFact(orchestrator.system, '__conversation');
  const inspect = useInspect(orchestrator.system);

  return (
    <div>
      <p>Status: {agent()?.status}</p>
      <p>Tokens: {agent()?.tokenUsage}</p>
      <p>Messages: {conversation()?.length ?? 0}</p>
      <p>{inspect().isSettled ? 'Idle' : 'Working...'}</p>
    </div>
  );
}
```

### Lit

```typescript
import { LitElement, html } from 'lit';
import { createAgentOrchestrator } from '@directive-run/ai';
import { FactController, InspectController } from '@directive-run/lit';

class AgentPanel extends LitElement {
  private orchestrator = createAgentOrchestrator({ runner, autoApproveToolCalls: true });

  // Reactive controllers – trigger re-render when their values change
  private agent = new FactController(this, this.orchestrator.system, '__agent');
  private conversation = new FactController(this, this.orchestrator.system, '__conversation');
  private inspect = new InspectController(this, this.orchestrator.system);

  disconnectedCallback() {
    super.disconnectedCallback();
    this.orchestrator.dispose();
  }

  render() {
    return html`
      <p>Status: ${this.agent.value?.status}</p>
      <p>Tokens: ${this.agent.value?.tokenUsage}</p>
      <p>Messages: ${this.conversation.value?.length ?? 0}</p>
      <p>${this.inspect.value?.isSettled ? 'Idle' : 'Working...'}</p>
    `;
  }
}
```

---

## Next Steps

- [Guardrails & Safety](/ai/guardrails) – Input validation, PII detection, and streaming constraints
- [Streaming](/ai/streaming) – Real-time response processing
- [Multi-Agent Patterns](/ai/multi-agent) – Parallel, sequential, and supervisor patterns
