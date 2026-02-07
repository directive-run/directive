---
title: OpenAI Agents
description: Build AI agents with constraint-driven orchestration, guardrails, and approval workflows.
---

Orchestrate AI agents with guardrails, approvals, and budget control. {% .lead %}

---

## Setup

The `createAgentOrchestrator` function wraps your agent run function with Directive's constraint engine, adding guardrails, approval workflows, and observability:

```typescript
import {
  createAgentOrchestrator,
  createPIIGuardrail,
} from 'directive/openai-agents';
import type { AgentLike, RunFn } from 'directive/openai-agents';

// Define your agent (compatible with OpenAI Agents SDK)
const agent: AgentLike = {
  name: 'assistant',
  instructions: 'You are a helpful assistant.',
  model: 'gpt-4',
};

// Your run function (wraps the OpenAI Agents SDK)
const run: RunFn = async (agent, input, options) => {
  const result = await openaiAgentsRun(agent, input, options);
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

Validate inputs, outputs, and tool calls before they execute. Guardrails run in order and can block or transform data:

```typescript
import {
  createAgentOrchestrator,
  createPIIGuardrail,
  createModerationGuardrail,
  createToolGuardrail,
  createOutputTypeGuardrail,
} from 'directive/openai-agents';

const orchestrator = createAgentOrchestrator({
  runAgent: run,
  autoApproveToolCalls: true,
  guardrails: {
    // Validate input before the agent sees it
    input: [
      createPIIGuardrail({ redact: true }),  // Auto-redact SSNs, emails, etc.
      createModerationGuardrail({
        checkFn: async (text) => {
          const result = await openai.moderations.create({ input: text });
          return result.results[0].flagged;
        },
      }),
    ],

    // Validate output before returning to the user
    output: [
      createOutputTypeGuardrail({
        type: 'string',
        minStringLength: 1,
      }),
    ],

    // Control which tools the agent can call
    toolCall: [
      createToolGuardrail({
        denylist: ['shell', 'filesystem', 'eval'],
      }),
    ],
  },
});
```

When a guardrail fails, a structured `GuardrailError` is thrown with the guardrail name, type, and a user-friendly message:

```typescript
import { isGuardrailError } from 'directive/openai-agents';

try {
  await orchestrator.run(agent, input);
} catch (error) {
  if (isGuardrailError(error)) {
    console.log(error.code);           // 'INPUT_GUARDRAIL_FAILED'
    console.log(error.guardrailName);  // 'input-guardrail-0'
    console.log(error.userMessage);    // 'Input contains PII'
  }
}
```

See [Guardrails](/docs/ai/guardrails) for custom guardrail functions and named guardrails with retry support.

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
      requirement: (req) => req.type === 'COST_WARNING',
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
const orchestrator = createAgentOrchestrator({
  runAgent: run,
  autoApproveToolCalls: true,
  constraints: {
    escalateToExpert: {
      when: (facts) => {
        const output = facts.agent.output as { confidence?: number } | null;
        return (output?.confidence ?? 1) < 0.7;
      },
      require: (facts) => ({
        type: 'RUN_EXPERT',
        query: facts.agent.input,
      }),
      priority: 50,
    },
  },
  resolvers: {
    runExpert: {
      requirement: (req) => req.type === 'RUN_EXPERT',
      resolve: async (req, context) => {
        const expertAgent: AgentLike = {
          name: 'expert',
          instructions: 'You are a domain expert. Provide detailed, accurate answers.',
          model: 'gpt-4',
        };
        const result = await context.runAgent(expertAgent, req.query);
        // Expert result is now available in agent state
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
      // Only retry rate limits and server errors
      return error.message.includes('429') || error.message.includes('500');
    },
    onRetry: (attempt, error, delayMs) => {
      console.log(`Retry ${attempt} in ${delayMs}ms: ${error.message}`);
    },
  },
});
```

---

## Streaming

Run an agent with streaming support. Returns an async iterator for real-time chunks and a promise for the final result:

```typescript
const { stream, result, abort } = orchestrator.runStream<string>(agent, input);

for await (const chunk of stream) {
  switch (chunk.type) {
    case 'token':
      process.stdout.write(chunk.data);
      break;
    case 'tool_start':
      console.log(`Calling tool: ${chunk.tool}`);
      break;
    case 'tool_end':
      console.log(`Tool result: ${chunk.result}`);
      break;
    case 'approval_required':
      showApprovalDialog(chunk.requestId, chunk.toolName);
      break;
    case 'guardrail_triggered':
      console.warn(`Blocked by ${chunk.guardrailName}: ${chunk.reason}`);
      break;
    case 'done':
      console.log(`Finished: ${chunk.totalTokens} tokens, ${chunk.duration}ms`);
      break;
    case 'error':
      console.error(chunk.error);
      break;
  }
}

const finalResult = await result;

// Cancel anytime
abort();
```

See [Streaming](/docs/ai/streaming) for stream utilities like `tapStream`, `filterStream`, and `mapStream`.

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
} from 'directive/openai-agents';

const orchestrator = createOrchestratorBuilder()
  .withConstraint('escalate', {
    when: (facts) => facts.agent.tokenUsage > 5000,
    require: { type: 'ESCALATE' },
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

## Next Steps

- See [Guardrails](/docs/ai/guardrails) for custom guardrail functions and named guardrails
- See [Streaming](/docs/ai/streaming) for stream processing utilities
- See [Multi-Agent](/docs/ai/multi-agent) for parallel, sequential, and supervisor patterns
