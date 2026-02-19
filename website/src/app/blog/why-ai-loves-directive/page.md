---
title: Why AI Loves Directive
description: AI frameworks handle LLM calls. Production agents need budget enforcement, PII redaction, tool control, approval workflows, and provider resilience. Directive adds the orchestration layer without replacing your framework.
layout: blog
date: 2026-02-11
dateModified: 2026-02-11
slug: why-ai-loves-directive
author: directive-labs
categories: [AI, Architecture]
---

AI frameworks are excellent at calling LLMs. They handle prompt templates, tool definitions, streaming responses, and multi-turn conversations. What they don't handle is everything around the LLM call &ndash; the production concerns that determine whether your agent is safe to deploy.

Budget enforcement. PII redaction. Tool access control. Human-in-the-loop approval. Output validation. Provider resilience. These aren't LLM problems. They're orchestration problems. And they're the difference between a demo agent and a production agent.

Most teams solve these problems imperatively &ndash; `if` checks scattered across handler functions, manual token counters, middleware that developers forget to include in new routes. It works until it doesn't. A missed check in one code path leads to a $2,000 overnight bill, a PII leak to a third-party tool, or a hallucinated `DROP TABLE` that reaches your database.

Directive adds a **constraint layer** to your existing agent setup. It doesn't replace your LLM framework. It doesn't wrap your API calls. It sits between your agent code and production, enforcing rules that are declared once and evaluated on every cycle. The same [constraint-driven architecture](/blog/constraint-driven-architecture) that manages application state now manages your agents.

---

## The $2,000 overnight bill

A support agent with access to a search tool and an email tool ran in a loop overnight. A malformed query triggered a retry cascade. Each retry consumed tokens, generated a new search, and fired another email. By morning: a four-figure LLM bill and 400 duplicate messages in the support inbox.

The root cause wasn't the agent. It was the budget. Budget was a variable that got checked *sometimes*. Not a constraint that was enforced *always*.

```typescript
import {
  createAgentOrchestrator,
  createPIIGuardrail,
} from '@directive-run/ai';

const orchestrator = createAgentOrchestrator({
  runner,
  autoApproveToolCalls: true,

  // Budget is a constraint, not a variable
  maxTokenBudget: 50000,

  // Custom constraint: warn ops at 80%
  constraints: {
    budgetWarning: {
      when: (facts) =>
        facts.agent.tokenUsage >= 40000 &&
        facts.agent.status === 'running',
      require: { type: 'WARN_OPS', percent: 80 },
      priority: 50,
    },
  },
});
```

`maxTokenBudget` creates an automatic hard-stop constraint at 100%. The custom constraint adds an 80% warning. Both are enforced by the reconciliation loop on every cycle. No code path can bypass them.

---

## Six production problems, six declarative solutions

### Budget enforcement

The orchestrator tracks cumulative token usage across all runs. Declare a budget, and the runtime enforces it:

```typescript
const orchestrator = createAgentOrchestrator({
  runner,
  autoApproveToolCalls: true,
  maxTokenBudget: 100000,

  constraints: {
    budgetWarning: {
      when: (facts) =>
        facts.agent.tokenUsage >= 80000 &&
        facts.agent.status === 'running',
      require: { type: 'WARN_BUDGET', percent: 80 },
      priority: 50,
    },
    budgetCritical: {
      when: (facts) =>
        facts.agent.tokenUsage >= 95000 &&
        facts.agent.status === 'running',
      require: { type: 'WARN_BUDGET', percent: 95 },
      priority: 75,
    },
  },

  resolvers: {
    warnBudget: {
      requirement: 'WARN_BUDGET',
      resolve: async (req, context) => {
        await notifyOpsChannel(
          `Agent at ${req.percent}% of token budget`
        );
      },
    },
  },
});
```

`maxTokenBudget` creates the hard stop. Custom constraints add graduated warnings at 80% and 95%. The runtime enforces all of them regardless of which code path the agent takes.

### PII detection

Scrub personal information from inputs before the agent sees them, and from outputs before they reach the user:

```typescript
import { createPIIGuardrail } from '@directive-run/ai';

const orchestrator = createAgentOrchestrator({
  runner,
  autoApproveToolCalls: true,
  guardrails: {
    input: [createPIIGuardrail({ redact: true })],
    output: [createPIIGuardrail({ redact: true })],
  },
});
```

Four lines of guardrail config. PII is redacted on both sides of the agent &ndash; every input, every output, every code path. No function call to forget. The guardrail runs because it's declared, not because your handler remembers to invoke it.

### Tool access control

Block dangerous tools by name, or inspect arguments for destructive operations:

```typescript
import { createToolGuardrail } from '@directive-run/ai';
import type { GuardrailFn, ToolCallGuardrailData } from '@directive-run/ai';

// Built-in: block tools by name
const toolGuard = createToolGuardrail({
  denylist: ['shell', 'eval', 'filesystem_write', 'db_execute'],
});

// Custom: inspect tool arguments for SQL mutations
const sqlGuard: GuardrailFn<ToolCallGuardrailData> = (data) => {
  if (data.toolName !== 'db_query') {
    return { passed: true };
  }

  const args = JSON.stringify(data.args);
  if (/\b(DROP|DELETE|TRUNCATE|ALTER|INSERT|UPDATE)\b/i.test(args)) {
    return {
      passed: false,
      reason: 'Mutation detected in read-only query tool',
    };
  }
  return { passed: true };
};

const orchestrator = createAgentOrchestrator({
  runner,
  autoApproveToolCalls: true,
  guardrails: {
    toolCall: [toolGuard, sqlGuard],
  },
});
```

The name-based denylist catches known dangerous tools. The custom guardrail catches a model hallucinating a `DROP TABLE` into a read-only query tool. Both run before the tool executes. If either fails, the tool call is blocked and a structured `GuardrailError` is thrown.

### Human-in-the-loop approval

Require a human to approve tool calls before they execute. The orchestrator pauses, fires a callback, and waits:

```typescript
const orchestrator = createAgentOrchestrator({
  runner,
  autoApproveToolCalls: false,
  approvalTimeoutMs: 60000,

  onApprovalRequest: (request) => {
    // Push to your review UI via WebSocket, SSE, or polling
    broadcastToAdminDashboard({
      requestId: request.id,
      agent: request.agentName,
      action: request.description,
      details: request.data,
    });
  },
});

// When the human decides:
orchestrator.approve(requestId);
// or
orchestrator.reject(requestId, 'Not authorized');

// Check approval state anytime
orchestrator.facts.approval.pending;   // Requests waiting for review
orchestrator.facts.approval.approved;  // Approved requests
orchestrator.facts.approval.rejected;  // Rejected requests
```

The agent runs freely until it hits a tool call. The orchestrator pauses, fires your callback, and waits for `approve()` or `reject()`. No polling, no race conditions &ndash; the reconciliation loop handles the coordination.

### Output validation

Enforce output structure with schemas or type guards:

```typescript
import {
  createOutputSchemaGuardrail,
  createOutputTypeGuardrail,
} from '@directive-run/ai';
import { z } from 'zod';

const orchestrator = createAgentOrchestrator({
  runner,
  autoApproveToolCalls: true,
  guardrails: {
    output: [
      // Enforce that the agent returns a string
      createOutputTypeGuardrail('string'),

      // Or validate against a Zod schema
      createOutputSchemaGuardrail(
        z.object({
          answer: z.string().min(1),
          confidence: z.number().min(0).max(1),
          sources: z.array(z.string().url()),
        })
      ),
    ],
  },
});
```

When the agent's output doesn't match the schema, the guardrail blocks it before it reaches the user. The error includes validation details so you can log, retry with a modified prompt, or escalate.

### Provider resilience

Your agent works perfectly &ndash; until the provider returns `429 Too Many Requests` at 2 AM. Or a transient `503` drops the user's request mid-conversation. Single-provider dependence is a production risk.

Directive's resilience middleware composes around your runner without changing a line of agent code:

```typescript
import {
  withRetry,
  withFallback,
  withBudget,
  createOpenAIRunner,
} from '@directive-run/ai';

// Start with your primary provider
let resilientRunner = runner;

// HTTP-status-aware retry – respects Retry-After on 429,
// exponential backoff on 503, never retries 400/401/403
resilientRunner = withRetry(resilientRunner, {
  maxRetries: 2,
  baseDelayMs: 1_000,
  maxDelayMs: 10_000,
});

// Automatic failover when the primary provider is down
resilientRunner = withFallback([
  resilientRunner,
  createOpenAIRunner({
    apiKey: process.env.OPENAI_API_KEY!,
    model: 'gpt-4o-mini',
  }),
]);

// Rolling budget windows prevent runaway spend
resilientRunner = withBudget(resilientRunner, {
  budgets: [
    { window: 'hour' as const, maxCost: 5.00, pricing: { inputPerMillion: 0.8, outputPerMillion: 4 } },
    { window: 'day' as const, maxCost: 50.00, pricing: { inputPerMillion: 0.8, outputPerMillion: 4 } },
  ],
});
```

Retry, fallback, and budget compose as middleware. Each `with*` wrapper checks its condition before each call (reject before spending), retries transient failures with appropriate backoff, and falls back to the next provider when the primary is unavailable. Three wrappers. Zero imperative retry loops.

---

## Framework-agnostic by design

Directive is not an LLM wrapper. It doesn't call OpenAI, Anthropic, or Ollama. It manages facts, evaluates constraints, and dispatches resolvers. Your LLM calls happen in the `runner` function &ndash; Directive doesn't know or care which provider is behind it.

```typescript
import type { AgentRunner } from '@directive-run/ai';

// OpenAI
const openaiRunner: AgentRunner = async (agent, input, options) => {
  return await openai.chat.completions.create({
    model: agent.model,
    messages: [{ role: 'user', content: input }],
  });
};

// Anthropic
const anthropicRunner: AgentRunner = async (agent, input, options) => {
  return await anthropic.messages.create({
    model: agent.model,
    messages: [{ role: 'user', content: input }],
  });
};

// Local model
const ollamaRunner: AgentRunner = async (agent, input, options) => {
  return await ollama.chat({
    model: agent.model,
    messages: [{ role: 'user', content: input }],
  });
};
```

Swap `openaiRunner` for `anthropicRunner` and the constraints, guardrails, and approval workflows don't change. The orchestrator evaluates facts, not API responses. As long as your runner updates the facts, the safety layer enforces.

This matters for teams running multiple models. Your production agent uses GPT-4 for quality. Your batch processor uses a cheaper model for cost. Your on-device agent uses a local model for latency. The same constraints protect all three.

---

## Multi-agent orchestration

Real workflows involve multiple agents. A researcher gathers information, a writer drafts content, a reviewer checks accuracy. Directive provides three execution patterns:

```typescript
import {
  createMultiAgentOrchestrator,
  parallel,
  sequential,
  supervisor,
  concatResults,
  aggregateTokens,
} from '@directive-run/ai';

const orchestrator = createMultiAgentOrchestrator({
  runner,

  agents: {
    researcher: { agent: researcher, maxConcurrent: 3, timeout: 30000 },
    writer:     { agent: writer,     maxConcurrent: 1, timeout: 60000 },
    reviewer:   { agent: reviewer,   maxConcurrent: 1, timeout: 30000 },
  },

  patterns: {
    // Fan out to 3 researchers, merge results
    research: parallel(
      ['researcher', 'researcher', 'researcher'],
      (results) => concatResults(results, '\n\n---\n\n'),
      { minSuccess: 2 }
    ),

    // Writer drafts, then reviewer checks
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

// Run the full pipeline
const research = await orchestrator.runPattern(
  'research',
  'Explain constraint-driven architecture for AI agents'
);
const article = await orchestrator.runPattern(
  'writeAndReview',
  `Write an article based on this research:\n\n${research.output}`
);
```

**`parallel`** fans out to multiple agents simultaneously. Use `minSuccess` to tolerate partial failures &ndash; if 2 of 3 researchers succeed, the pattern completes.

**`sequential`** chains agents in order. Each agent's output is transformed and passed as input to the next. Use `transform` to shape the handoff.

**`supervisor`** lets a manager agent delegate to workers dynamically, deciding what to do next based on results. See the [multi-agent documentation](/docs/ai/multi-agent) for the full pattern.

Constraints apply to the entire orchestrator, not individual agents. A budget constraint covers all agents' cumulative token usage. A PII guardrail scans all agents' inputs and outputs. The safety layer is system-wide.

---

## What you keep

Directive doesn't replace your agent code. It adds a layer around it.

- **Your LLM provider** stays the same. OpenAI, Anthropic, Ollama, or your own fine-tuned model.
- **Your tools** don't change. Directive validates tool calls; it doesn't redefine them.
- **Your prompts** are yours. Directive doesn't modify system prompts or inject instructions.
- **Your agent logic** stays in your runner function. Directive orchestrates around it.

What Directive adds: budget enforcement that can't be bypassed. PII detection that runs on every path. Tool access control that evaluates before execution. Approval workflows that pause and resume cleanly. Output validation that catches schema violations. All declared once, enforced everywhere.

---

## Get started

Install Directive:

```bash
npm install @directive-run/core
```

Build your first orchestrated agent:

```typescript
import {
  createAgentOrchestrator,
  createPIIGuardrail,
  createToolGuardrail,
} from '@directive-run/ai';

const orchestrator = createAgentOrchestrator({
  runner,
  autoApproveToolCalls: true,
  maxTokenBudget: 50000,
  guardrails: {
    input: [createPIIGuardrail({ redact: true })],
    toolCall: [createToolGuardrail({ denylist: ['shell', 'eval'] })],
  },
});

const result = await orchestrator.run(agent, 'Help me with my account');
```

Explore the AI documentation:

- **[AI & Agents Overview](/docs/ai/overview)** &ndash; architecture and learning path
- **[Agent Orchestrator](/docs/ai/orchestrator)** &ndash; single-agent patterns, constraints, and approval workflows
- **[Guardrails & Safety](/docs/ai/guardrails)** &ndash; built-in and custom guardrails
- **[Multi-Agent Patterns](/docs/ai/multi-agent)** &ndash; parallel, sequential, and supervisor coordination
- **[Resilience & Routing](/docs/ai/resilience-routing)** &ndash; retry, fallback, budgets, and model selection
- **[Building AI Agents](/blog/building-ai-agents)** &ndash; the full tutorial
- **[Declarative AI Guardrails](/blog/declarative-ai-guardrails)** &ndash; building guardrails with `createModule`

Your agent framework handles the LLM. Directive handles everything else.
