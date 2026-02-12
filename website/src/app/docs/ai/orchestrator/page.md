---
title: Agent Orchestrator
description: Build AI agents with constraint-driven orchestration, guardrails, and approval workflows.
---

Orchestrate AI agents with guardrails, approvals, and budget control. {% .lead %}

The orchestrator is **LLM-agnostic** – provide any `runner` function that accepts an agent and input, and Directive handles safety, approvals, and state tracking. Works with OpenAI, Anthropic, Ollama, or your own backend.

---

## Setup

The `createAgentOrchestrator` function wraps your agent run function with Directive's constraint engine, adding guardrails, approval workflows, and observability:

```typescript
import {
  createAgentOrchestrator,
  createPIIGuardrail,
} from 'directive/ai';
import type { AgentLike, AgentRunner } from 'directive/ai';

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

Validate inputs, outputs, and tool calls before they execute. See [Guardrails & Safety](/docs/ai/guardrails) for the full API, built-in guardrails, and streaming constraints.

```typescript
import {
  createAgentOrchestrator,
  createPIIGuardrail,
  createToolGuardrail,
} from 'directive/ai';

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

Require human approval before tool calls execute. Set `autoApproveToolCalls: false` and provide an `onApprovalRequest` callback:

```typescript
const orchestrator = createAgentOrchestrator({
  runner,
  autoApproveToolCalls: false,       // Require human sign-off for every tool call
  approvalTimeoutMs: 60000,          // Fail after 60s if no decision (default: 5 minutes)

  // Called each time the agent wants to use a tool
  onApprovalRequest: (request) => {
    console.log(`Approval needed: ${request.description}`);
    console.log(`Agent: ${request.agentName}`);
    console.log(`Tool call data:`, request.data);

    // Forward to your UI, Slack, email, etc.
    notifyApprover(request);
  },
});

// Wire this into your approval UI
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
// Query the current approval state at any time
const pending = orchestrator.facts.approval.pending;
const approved = orchestrator.facts.approval.approved;
const rejected = orchestrator.facts.approval.rejected;
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

### Constraint Helpers

Use `constraint()` and `when()` for ergonomic constraint construction:

```typescript
import { constraint, when } from 'directive/ai';

interface MyFacts { confidence: number; errors: number }

const orchestrator = createAgentOrchestrator<MyFacts>({
  runner,
  autoApproveToolCalls: true,

  constraints: {
    // Fluent builder – chain .when().require().priority().build()
    escalate: constraint<MyFacts>()
      .when((f) => f.confidence < 0.7)
      .require({ type: 'ESCALATE' })
      .priority(50)
      .build(),

    // Quick shorthand – one-liner that returns a constraint directly
    pause: when<MyFacts>((f) => f.errors > 3)
      .require({ type: 'PAUSE' }),

    // Shorthand with explicit priority for conflict resolution
    halt: when<MyFacts>((f) => f.errors > 10)
      .require({ type: 'HALT' })
      .withPriority(100),
  },
});
```

Both produce plain `OrchestratorConstraint` objects – zero runtime overhead, just ergonomic sugar. The `when()` shorthand returns a constraint directly (no `.build()` needed), and `.withPriority()` returns a new constraint with the priority set.

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
  // Escalate when token usage gets high
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

  // Layer on guardrails for input, tools, and output
  .withInputGuardrail('pii', createPIIGuardrail({ redact: true }))
  .withToolCallGuardrail('tools', createToolGuardrail({ denylist: ['shell'] }))
  .withOutputGuardrail('type', createOutputTypeGuardrail({ type: 'string' }))

  // Set budget and enable debug logging
  .withBudget(10000)
  .withDebug()

  // Finalize with the runner
  .build({
    runner,
    autoApproveToolCalls: true,
  });
```

---

## Framework Integration

The orchestrator exposes a `.system` property – a standard Directive system – so all framework hooks work out of the box. The bridge keys are `__agent`, `__approval`, `__conversation`, and `__toolCalls`.

### React

```tsx
import { useAgentOrchestrator, useFact, useSelector, useWatch, useInspect } from 'directive/react';

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
  const summary = useSelector(system, (facts) => ({
    status: facts.__agent?.status,
    tokens: facts.__agent?.tokenUsage,
    pending: facts.__approval?.pending?.length ?? 0,
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
import { createAgentOrchestrator } from 'directive/ai';
import { useFact, useSelector, useInspect } from 'directive/vue';
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
import { createAgentOrchestrator } from 'directive/ai';
import { useFact, useInspect } from 'directive/svelte';
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
import { createAgentOrchestrator } from 'directive/ai';
import { useFact, useInspect } from 'directive/solid';
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
import { createAgentOrchestrator } from 'directive/ai';
import { FactController, InspectController } from 'directive/lit';

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

- See [Guardrails & Safety](/docs/ai/guardrails) for input validation, PII detection, and streaming constraints
- See [Streaming](/docs/ai/streaming) for real-time response processing
- See [Multi-Agent Patterns](/docs/ai/multi-agent) for parallel, sequential, and supervisor patterns
- See [Agent Stack](/docs/ai/agent-stack) for the all-in-one composition API
