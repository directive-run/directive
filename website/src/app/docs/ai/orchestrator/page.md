---
title: Agent Orchestrator
description: Build AI agents with constraint-driven orchestration, guardrails, and approval workflows.
---

Orchestrate AI agents with guardrails, approvals, and budget control. {% .lead %}

The orchestrator is **LLM-agnostic** — provide any `run` function that accepts an agent and input, and Directive handles safety, approvals, and state tracking. Works with OpenAI, Anthropic, Ollama, or your own backend.

---

## Setup

The `createAgentOrchestrator` function wraps your agent run function with Directive's constraint engine, adding guardrails, approval workflows, and observability:

```typescript
import {
  createAgentOrchestrator,
  createPIIGuardrail,
} from 'directive/ai';
import type { AgentLike, RunFn } from 'directive/ai';

// Define your agent
const agent: AgentLike = {
  name: 'assistant',
  instructions: 'You are a helpful assistant.',
  model: 'gpt-4',
};

// Your run function (wraps any LLM SDK)
const run: RunFn = async (agent, input, options) => {
  const result = await myLLMCall(agent, input, options);
  return result;
};

// Create the orchestrator
const orchestrator = createAgentOrchestrator({
  runAgent: run,
  autoApproveToolCalls: true,
});
```

---

## Running an Agent

Run an agent through the orchestrator. All guardrails, approval checks, and state tracking happen automatically:

```typescript
const result = await orchestrator.run<string>(agent, 'What is WebAssembly?');

console.log(result.finalOutput);   // The agent's response
console.log(result.totalTokens);   // Token usage
console.log(result.messages);      // Full conversation
console.log(result.toolCalls);     // Any tools called
```

The orchestrator tracks state internally. Check it anytime:

```typescript
console.log(orchestrator.facts.agent.status);      // 'idle' | 'running' | 'paused' | 'completed' | 'error'
console.log(orchestrator.facts.agent.tokenUsage);   // Cumulative tokens across all runs
console.log(orchestrator.facts.agent.turnCount);     // Total message count
console.log(orchestrator.facts.conversation);        // Full conversation history
```

---

## Guardrails

Validate inputs, outputs, and tool calls before they execute. See [Guardrails & Safety](/docs/ai/guardrails) for the full API, built-in guardrails, and streaming constraints.

```typescript
import {
  createAgentOrchestrator,
  createPIIGuardrail,
  createToolGuardrail,
} from 'directive/ai';

const orchestrator = createAgentOrchestrator({
  runAgent: run,
  autoApproveToolCalls: true,
  guardrails: {
    input: [createPIIGuardrail({ redact: true })],
    toolCall: [createToolGuardrail({ denylist: ['shell', 'eval'] })],
  },
});
```

---

## Approval Workflow

Require human approval before tool calls execute. Set `autoApproveToolCalls: false` and provide an `onApprovalRequest` callback:

```typescript
const orchestrator = createAgentOrchestrator({
  runAgent: run,
  autoApproveToolCalls: false,
  approvalTimeoutMs: 60000,  // 60s timeout (default: 5 minutes)

  onApprovalRequest: (request) => {
    console.log(`Approval needed: ${request.description}`);
    console.log(`Agent: ${request.agentName}`);
    console.log(`Tool call data:`, request.data);

    // Show in your UI, send to Slack, etc.
    notifyApprover(request);
  },
});

// In your approval UI handler:
function handleApproval(requestId: string, approved: boolean) {
  if (approved) {
    orchestrator.approve(requestId);
  } else {
    orchestrator.reject(requestId, 'Not authorized for this action');
  }
}
```

The agent run pauses at each tool call until `approve()` or `reject()` is called. If the timeout expires, the run fails with an error.

Check pending approvals anytime:

```typescript
const pending = orchestrator.facts.approval.pending;
const approved = orchestrator.facts.approval.approved;
const rejected = orchestrator.facts.approval.rejected;
```

---

## Budget Control

Set a token budget that automatically pauses agents when exceeded:

```typescript
const orchestrator = createAgentOrchestrator({
  runAgent: run,
  autoApproveToolCalls: true,
  maxTokenBudget: 10000,
});

await orchestrator.run(agent, 'Summarize this document...');

// Check usage
console.log(orchestrator.facts.agent.tokenUsage);  // e.g., 3500
console.log(orchestrator.facts.agent.status);       // 'completed'

// After many runs, if budget is exceeded:
// orchestrator.facts.agent.status === 'paused'
```

For more granular cost control, use custom constraints:

```typescript
const orchestrator = createAgentOrchestrator({
  runAgent: run,
  autoApproveToolCalls: true,
  constraints: {
    costWarning: {
      priority: 100,
      when: (facts) => facts.agent.tokenUsage > 5000,
      require: { type: 'COST_WARNING' },
    },
  },
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
  runAgent: run,
  autoApproveToolCalls: true,
  constraints: {
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

---

## Lifecycle Hooks

Observe agent runs, guardrail checks, and retries without modifying behavior:

```typescript
const orchestrator = createAgentOrchestrator({
  runAgent: run,
  autoApproveToolCalls: true,
  hooks: {
    onAgentStart: ({ agentName, input, timestamp }) => {
      console.log(`[${agentName}] Starting at ${timestamp}`);
    },
    onAgentComplete: ({ agentName, tokenUsage, durationMs }) => {
      console.log(`[${agentName}] Done: ${tokenUsage} tokens in ${durationMs}ms`);
    },
    onAgentError: ({ agentName, error, durationMs }) => {
      console.error(`[${agentName}] Failed after ${durationMs}ms:`, error.message);
    },
    onGuardrailCheck: ({ guardrailName, guardrailType, passed, reason }) => {
      if (!passed) {
        console.warn(`Guardrail ${guardrailName} (${guardrailType}) blocked: ${reason}`);
      }
    },
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
  runAgent: run,
  autoApproveToolCalls: true,
  agentRetry: {
    attempts: 3,
    backoff: 'exponential',   // 'exponential' | 'linear' | 'fixed'
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    isRetryable: (error) => {
      return error.message.includes('429') || error.message.includes('500');
    },
    onRetry: (attempt, error, delayMs) => {
      console.log(`Retry ${attempt} in ${delayMs}ms: ${error.message}`);
    },
  },
});
```

---

## Pause & Resume

Manually control agent execution:

```typescript
// Pause all agent activity
orchestrator.pause();
console.log(orchestrator.facts.agent.status); // 'paused'

// Resume
orchestrator.resume();
console.log(orchestrator.facts.agent.status); // 'running' or 'idle'

// Reset all state (conversation, token usage, approvals)
orchestrator.reset();

// Clean up when done
orchestrator.dispose();
```

---

## Builder Pattern

For complex configurations, use the fluent builder:

```typescript
import {
  createOrchestratorBuilder,
  createPIIGuardrail,
  createToolGuardrail,
  createOutputTypeGuardrail,
} from 'directive/ai';

const orchestrator = createOrchestratorBuilder()
  .withConstraint('escalate', {
    when: (facts) => facts.agent.tokenUsage > 5000,
    require: { type: 'ESCALATE' },
  })
  .withResolver('escalate', {
    requirement: 'ESCALATE',
    resolve: async (req, ctx) => {
      console.warn('Token budget escalation:', ctx.facts.agent.tokenUsage);
    },
  })
  .withInputGuardrail('pii', createPIIGuardrail({ redact: true }))
  .withToolCallGuardrail('tools', createToolGuardrail({ denylist: ['shell'] }))
  .withOutputGuardrail('type', createOutputTypeGuardrail({ type: 'string' }))
  .withBudget(10000)
  .withDebug()
  .build({
    runAgent: run,
    autoApproveToolCalls: true,
  });
```

---

## Framework Integration

The orchestrator exposes a `.system` property — a standard Directive system — so all framework hooks work out of the box. The bridge keys are `__agent`, `__approval`, `__conversation`, and `__toolCalls`.

### React

```tsx
import { useAgentOrchestrator, useFact, useSelector, useWatch, useInspect } from 'directive/react';

function AgentPanel() {
  const orchestrator = useAgentOrchestrator({
    runAgent: run,
    autoApproveToolCalls: true,
  });
  const { system } = orchestrator;

  // Subscribe to individual bridge keys
  const agent = useFact(system, '__agent');
  const conversation = useFact(system, '__conversation');
  const approval = useFact(system, '__approval');

  // Or use useSelector for derived values
  const summary = useSelector(system, (facts) => ({
    status: facts.__agent?.status,
    tokens: facts.__agent?.tokenUsage,
    pending: facts.__approval?.pending?.length ?? 0,
  }));

  // Track settled/working status
  const { isSettled } = useInspect(system);

  // Side-effect on agent state changes (no re-render)
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

```vue
<script setup>
import { createAgentOrchestrator } from 'directive/ai';
import { useFact, useSelector, useInspect } from 'directive/vue';
import { onUnmounted } from 'vue';

const orchestrator = createAgentOrchestrator({ run, autoApproveToolCalls: true });
onUnmounted(() => orchestrator.dispose());

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

```svelte
<script>
import { createAgentOrchestrator } from 'directive/ai';
import { useFact, useInspect } from 'directive/svelte';
import { onDestroy } from 'svelte';

const orchestrator = createAgentOrchestrator({ run, autoApproveToolCalls: true });
onDestroy(() => orchestrator.dispose());

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
import { createAgentOrchestrator } from 'directive/ai';
import { useFact, useInspect } from 'directive/solid';
import { onCleanup } from 'solid-js';

function AgentPanel() {
  const orchestrator = createAgentOrchestrator({ run, autoApproveToolCalls: true });
  onCleanup(() => orchestrator.dispose());

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
import { createAgentOrchestrator } from 'directive/ai';
import { FactController, InspectController } from 'directive/lit';

class AgentPanel extends LitElement {
  private orchestrator = createAgentOrchestrator({ run, autoApproveToolCalls: true });
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

- See [Guardrails & Safety](/docs/ai/guardrails) for input validation, PII detection, and streaming constraints
- See [Streaming](/docs/ai/streaming) for real-time response processing
- See [Multi-Agent Patterns](/docs/ai/multi-agent) for parallel, sequential, and supervisor patterns
- See [Agent Stack](/docs/ai/agent-stack) for the all-in-one composition API
