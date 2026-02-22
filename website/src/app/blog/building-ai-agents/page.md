---
title: Building AI Agents with Directive
description: A practical guide to orchestrating AI agents with approval flows, guardrails, and budget constraints using Directive.
layout: blog
date: 2026-02-06
dateModified: 2026-02-06
slug: building-ai-agents
author: directive-labs
categories: [AI, Tutorial]
---

AI agents are powerful. They can search the web, write code, draft emails, and call external APIs on your behalf. But the gap between a working demo and a production agent is enormous.

Demo agents hallucinate without consequence. Production agents hallucinate into customer-facing responses. Demo agents spend tokens freely. Production agents rack up five-figure bills overnight. Demo agents call any tool available. Production agents execute shell commands on your server.

The missing layer isn't smarter models &ndash; it's **orchestration**. Budget enforcement, safety guardrails, human approval workflows, and structured error handling. The same problems every production system faces, applied to non-deterministic AI.

Directive brings [constraint-driven architecture](/blog/constraint-driven-architecture) to agent orchestration. Instead of scattering safety checks across your codebase, you declare constraints &ndash; what must be true &ndash; and let the runtime enforce them. The same reconciliation loop that manages application state now manages your agents.

This guide walks through the full progression: from a single agent with guardrails to multi-agent pipelines with human oversight.

---

## The Problem: Why Agent Orchestration Is Hard

Here's how most agent code starts:

```typescript
async function runAgent(input: string) {
  let tokenCount = 0;
  let attempts = 0;

  while (attempts < 3) {
    try {
      // Check for PII manually
      if (containsPII(input)) {
        input = redactPII(input);
      }

      const result = await llm.chat({ messages: [{ role: 'user', content: input }] });
      tokenCount += result.usage.total_tokens;

      // Track budget manually
      if (tokenCount > 10000) {
        console.warn('Budget exceeded!');
        break;
      }

      // Check tool calls manually
      if (result.toolCalls?.some((tc) => tc.name === 'shell')) {
        throw new Error('Blocked dangerous tool call');
      }

      // Check confidence manually
      if (result.confidence < 0.7) {
        // ... escalate? retry? log? up to you
      }

      return result;
    } catch (err) {
      attempts++;
      await sleep(1000 * attempts);
    }
  }
}
```

This works for a demo. But notice the problems:

**Safety checks are scattered.** PII filtering is line 6. Tool blocking is line 18. Confidence checking is line 23. Each lives in a different part of the function, easy to miss when modifying the flow.

**Budget tracking is manual.** You're counting tokens yourself, checking the limit yourself, and there's no enforcement &ndash; just a `console.warn` and a `break`.

**No approval workflow.** If an agent wants to call an external API or send an email, there's no mechanism for a human to review and approve before execution.

**Retry logic is hand-built.** The `while` loop with `attempts` is the kind of code that gets copied, modified slightly, and subtly broken across a dozen files.

This is the same "imperative chaos" pattern from [constraint-driven architecture](/blog/constraint-driven-architecture), applied to AI. Directive solves it the same way: declare what must be true, let the runtime handle how.

---

## Your First Orchestrated Agent

Start with a runner &ndash; a thin wrapper around your LLM provider:

```typescript
import {
  createOpenAIRunner,
  createAgentOrchestrator,
  createPIIGuardrail,
  createToolGuardrail,
} from '@directive-run/ai';
import type { AgentLike } from '@directive-run/ai';

// 1. Create a runner for your LLM provider
const runner = createOpenAIRunner({
  apiKey: process.env.OPENAI_API_KEY!,
});

// 2. Define your agent
const agent: AgentLike = {
  name: 'support-agent',
  instructions: 'You are a customer support agent. Be helpful and concise.',
  model: 'gpt-4o',
};

// 3. Wrap the runner in an orchestrator with safety and state tracking
const orchestrator = createAgentOrchestrator({
  runner,
  autoApproveToolCalls: true,

  // Guardrails run automatically on every interaction
  guardrails: {
    input: [createPIIGuardrail({ redact: true })],
    toolCall: [createToolGuardrail({ denylist: ['shell', 'eval', 'filesystem'] })],
  },

  // Enforce a token budget across all runs
  maxTokenBudget: 10000,

  // Custom constraint: escalate when confidence is low
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
        const expert: AgentLike = {
          name: 'expert',
          instructions: 'You are a domain expert. Provide detailed, accurate answers.',
          model: 'gpt-4o',
        };
        await context.runAgent(expert, req.query);
      },
    },
  },
});

// 4. Run the agent
const result = await orchestrator.run(agent, 'My order #12345 hasnt arrived yet');

console.log(result.output);                         // Agent's response
console.log(orchestrator.facts.agent.tokenUsage);    // Cumulative tokens
console.log(orchestrator.facts.agent.status);         // 'completed' | 'paused' | 'error'
```

Compare this to the imperative version. PII redaction, tool blocking, budget enforcement, and confidence escalation are all declarative. The orchestrator evaluates constraints after each run and triggers resolvers when conditions are met. You didn't write a `while` loop, a token counter, or a try-catch.

---

## Approval Workflows

Production agents often need a human in the loop before executing sensitive actions. Directive makes this a first-class concept.

Set `autoApproveToolCalls: false` and provide an `onApprovalRequest` callback. When the agent tries to call a tool, the orchestrator pauses, fires the callback, and waits for your code to call `approve()` or `reject()`:

```typescript
const orchestrator = createAgentOrchestrator({
  runner,
  autoApproveToolCalls: false,
  approvalTimeoutMs: 60000,

  onApprovalRequest: (request) => {
    // request.id          – unique ID for this approval
    // request.agentName   – which agent wants to act
    // request.description – human-readable summary
    // request.data        – raw tool call payload

    // Push to your frontend via WebSocket, SSE, or polling
    broadcastToAdminDashboard({
      requestId: request.id,
      agent: request.agentName,
      action: request.description,
      details: request.data,
    });
  },
});
```

On the backend, expose approve/reject endpoints:

```typescript
app.post('/api/approvals/:requestId', (req, res) => {
  const { requestId } = req.params;
  const { approved, reason } = req.body;

  if (approved) {
    orchestrator.approve(requestId);
  } else {
    orchestrator.reject(requestId, reason ?? 'Denied by reviewer');
  }

  res.json({ ok: true });
});
```

Query approval state anytime:

```typescript
orchestrator.facts.approval.pending;   // Requests waiting for a decision
orchestrator.facts.approval.approved;  // Requests that were approved
orchestrator.facts.approval.rejected;  // Requests that were rejected
```

This pattern gives you agent autonomy with human oversight. The agent runs freely until it hits a sensitive action, then pauses and waits. No polling, no race conditions &ndash; the orchestrator handles the coordination.

---

## Multi-Agent Coordination

Real workflows involve multiple agents. A research agent gathers information, a writer drafts content, a reviewer checks accuracy. Directive provides three execution patterns: `parallel`, `sequential`, and `supervisor`.

```typescript
import {
  createMultiAgentOrchestrator,
  parallel,
  sequential,
  concatResults,
  collectOutputs,
  aggregateTokens,
} from '@directive-run/ai';
import type { AgentLike, AgentRunner } from '@directive-run/ai';

const researcher: AgentLike = {
  name: 'researcher',
  instructions: 'Find relevant information on the given topic.',
  model: 'gpt-4o',
};

const writer: AgentLike = {
  name: 'writer',
  instructions: 'Write clear, concise content from research notes.',
  model: 'gpt-4o',
};

const reviewer: AgentLike = {
  name: 'reviewer',
  instructions: 'Review drafts for accuracy. Return "approve" or revision notes.',
  model: 'gpt-4o',
};

const orchestrator = createMultiAgentOrchestrator({
  runner,

  agents: {
    researcher: { agent: researcher, maxConcurrent: 3, timeout: 30000 },
    writer:     { agent: writer,     maxConcurrent: 1, timeout: 60000 },
    reviewer:   { agent: reviewer,   maxConcurrent: 1, timeout: 30000 },
  },

  patterns: {
    // Fan out to 3 researchers in parallel, merge their outputs
    research: parallel(
      ['researcher', 'researcher', 'researcher'],
      (results) => concatResults(results, '\n\n---\n\n'),
      { minSuccess: 2 }
    ),

    // Pipeline: writer drafts, reviewer checks
    writeAndReview: sequential(
      ['writer', 'reviewer'],
      {
        transform: (output, agentId) =>
          agentId === 'writer'
            ? `Review this draft for accuracy:\n\n${output}`
            : String(output),
      }
    ),
  },
});
```

Run the full pipeline &ndash; research in parallel, then write, then review:

```typescript
// Step 1: Fan out research
const research = await orchestrator.runPattern(
  'research',
  'Explain constraint-driven architecture for AI agents'
);

// Step 2: Write and review in sequence
const final = await orchestrator.runPattern(
  'writeAndReview',
  `Write an article based on this research:\n\n${research.output}`
);

console.log(final.output);  // The reviewed article
```

For more dynamic coordination, the `supervisor` pattern lets a manager agent delegate to workers in a loop, deciding what to do next based on worker results. See the [multi-agent documentation](/ai/multi-agent) for the full pattern.

---

## Guardrails at Every Layer

Directive ships built-in guardrails for input, tool calls, and output. Layer them to build defense in depth:

**Input guardrails** &ndash; run before the agent sees the message:

- `createPIIGuardrail` &ndash; detect or redact personal information (SSNs, emails, credit cards)
- `createModerationGuardrail` &ndash; block harmful content via your moderation API
- `createRateLimitGuardrail` &ndash; enforce token-per-minute and request-per-minute limits

**Tool call guardrails** &ndash; run before a tool executes:

- `createToolGuardrail` &ndash; allowlist or denylist tools by name

**Output guardrails** &ndash; run before the response reaches the user:

- `createOutputTypeGuardrail` &ndash; enforce output type (string, object, array)
- `createOutputSchemaGuardrail` &ndash; validate against a custom schema or Zod
- `createLengthGuardrail` &ndash; cap response length by characters or tokens
- `createContentFilterGuardrail` &ndash; block responses matching keywords or patterns

**Custom guardrails** are plain functions:

```typescript
import type { GuardrailFn, InputGuardrailData } from '@directive-run/ai';

const noCodeExecution: GuardrailFn<InputGuardrailData> = (data) => {
  if (data.input.includes('exec(') || data.input.includes('eval(')) {
    return { passed: false, reason: 'Code execution not allowed' };
  }
  return { passed: true };
};
```

When a guardrail blocks a request, a structured `GuardrailError` is thrown. Use `isGuardrailError(error)` to type-narrow and access `error.userMessage` (safe to display in your UI), `error.guardrailName`, and `error.code`.

```typescript
import { isGuardrailError } from '@directive-run/ai';

try {
  await orchestrator.run(agent, userInput);
} catch (error) {
  if (isGuardrailError(error)) {
    showToast(error.userMessage);  // "Input contains personal information"
  }
}
```

---

## Production Resilience

Guardrails protect against bad inputs and outputs. But what happens when the LLM provider itself goes down? A `429` rate limit at 2 AM shouldn't take your agent offline, and a transient `503` shouldn't lose the user's request.

Directive's resilience middleware composes around your runner &ndash; retry, fallback, and cost budget guards that work with any provider:

```typescript
import {
  createAgentOrchestrator,
  createOpenAIRunner,
  createAnthropicRunner,
  createPIIGuardrail,
  createToolGuardrail,
  withRetry,
  withFallback,
  withBudget,
} from '@directive-run/ai';
import type { AgentLike } from '@directive-run/ai';

// Primary provider
let runner = createAnthropicRunner({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

// Fallback provider – used only when the primary fails
const openaiRunner = createOpenAIRunner({
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-4o-mini',
});

// Compose resilience middleware on the runner
// P2: Intelligent retry – respects Retry-After headers on 429,
// exponential backoff on 503, never retries 400/401/403
runner = withRetry(runner, { maxRetries: 2, baseDelayMs: 1_000, maxDelayMs: 10_000 });

// P0: Provider fallback – automatic failover when primary is down
runner = withFallback([runner, openaiRunner]);

// P1: Cost budget – rolling windows prevent runaway spend
runner = withBudget(runner, {
  budgets: [
    { window: 'hour' as const, maxCost: 5.00, pricing: { inputPerMillion: 0.8, outputPerMillion: 4 } },
    { window: 'day' as const, maxCost: 50.00, pricing: { inputPerMillion: 0.8, outputPerMillion: 4 } },
  ],
});

// Guardrails still apply on top of resilience
const orchestrator = createAgentOrchestrator({
  runner,
  guardrails: {
    input: [createPIIGuardrail({ redact: true })],
    toolCall: [createToolGuardrail({ denylist: ['shell', 'eval'] })],
  },
});
```

The composition order matters: budget checks run first (reject before spending), then retry wraps the call, then fallback catches provider-level failures. Each `with*` wrapper returns a new runner, so you can compose them in the order that makes sense for your use case.

See the [Resilience & Routing documentation](/ai/resilience-routing) for the full API including model selection, structured outputs, and constraint-driven provider routing.

---

## Getting Started

Install Directive and start building:

```bash
npm install @directive-run/core
```

Explore the full AI documentation:

- **[AI & Agents Overview](/ai/overview)** &ndash; architecture and learning path
- **[Running Agents](/ai/running-agents)** &ndash; provider setup for OpenAI, Anthropic, and Ollama
- **[Resilience & Routing](/ai/resilience-routing)** &ndash; retry, fallback, budgets, and model selection
- **[Agent Orchestrator](/ai/orchestrator)** &ndash; single-agent patterns, constraints, and approval workflows
- **[Guardrails & Safety](/ai/guardrails)** &ndash; input, output, and streaming validation
- **[Multi-Agent Patterns](/ai/multi-agent)** &ndash; parallel, sequential, and supervisor coordination

If you haven't read the first article in this series, **[Constraint-Driven Architecture](/blog/constraint-driven-architecture)** explains the paradigm from scratch &ndash; why declaring "what must be true" beats writing imperative handlers.

The same constraints that manage application state now manage your agents. Budget limits, safety rules, escalation policies, approval workflows &ndash; all declarative, all enforced by the runtime. Constraints for agents, not just state.
