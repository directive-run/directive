---
title: Customer Support Bot
description: Build a support agent that redacts PII, escalates stuck conversations, and stays within budget.
---

Build a production support agent with PII redaction, auto-escalation, and budget controls. {% .lead %}

---

## The Problem

You need a customer support agent that handles real user data safely. It must redact personal information before processing, automatically escalate when it gets stuck, and not blow through your API budget on a single conversation.

## The Solution

Combine `createPIIGuardrail` for data protection, constraints for escalation logic, and resolvers for the escalation action:

```typescript
import {
  createAgentOrchestrator,
  createPIIGuardrail,
} from '@directive-run/ai';

const orchestrator = createAgentOrchestrator({
  runner, // See Running Agents (/ai/running-agents) for setup
  autoApproveToolCalls: true,
  maxTokenBudget: 20000,
  guardrails: {
    input: [
      createPIIGuardrail({
        redact: true,
        redactReplacement: '[REDACTED]',
      }),
    ],
  },
  constraints: {
    escalate: {
      when: (facts) => facts.agent.turnCount > 5,
      require: { type: 'ESCALATE', reason: 'Too many turns' },
    },
  },
  resolvers: {
    escalate: {
      requirement: 'ESCALATE',
      resolve: async (req, context) => {
        // Your notification function — Directive doesn't provide this
        await notifyHumanAgent(context.facts.agent.conversationId, req.reason);
        context.facts.agent.status = 'paused';
      },
    },
  },
});
```

## How It Works

- **`createPIIGuardrail`** scans input for SSNs, credit cards, emails, and phone numbers. With `redact: true`, it replaces matches with `[REDACTED]` and lets the request continue. Without `redact`, it blocks the request entirely.
- **Constraints watch facts** on every turn. When `turnCount > 5`, the constraint fires and emits an `ESCALATE` requirement.
- **The resolver handles escalation** by notifying a human agent and pausing the orchestrator. The conversation can resume when a human takes over.
- **`maxTokenBudget`** prevents a single conversation from consuming excessive tokens.

## Full Example

A complete support bot with PII protection, custom patterns, tiered escalation, and budget warnings:

```typescript
import {
  createAgentOrchestrator,
  createPIIGuardrail,
  createModerationGuardrail,
} from '@directive-run/ai';

// Block abusive input
const moderationGuardrail = createModerationGuardrail({
  checkFn: (text) => {
    const abusivePatterns = [/threat/i, /harm/i, /kill/i];

    return abusivePatterns.some((p) => p.test(text));
  },
  message: 'I cannot respond to abusive messages. Connecting you with a human agent.',
});

// Redact PII with custom patterns
const piiGuardrail = createPIIGuardrail({
  redact: true,
  redactReplacement: '[REDACTED]',
  patterns: [
    /\b\d{3}-\d{2}-\d{4}\b/,                       // SSN
    /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,    // Credit card
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,  // Email
    /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,                // Phone
  ],
});

const orchestrator = createAgentOrchestrator({
  runner, // See Running Agents (/ai/running-agents) for setup
  autoApproveToolCalls: true,
  maxTokenBudget: 30000,
  budgetWarningThreshold: 0.8,
  onBudgetWarning: ({ percentage }) => {
    console.warn(`Support bot budget at ${Math.round(percentage * 100)}%`);
  },
  guardrails: {
    input: [moderationGuardrail, piiGuardrail],
  },
  constraints: {
    softEscalate: {
      priority: 10,
      when: (facts) => facts.agent.turnCount > 3,
      require: { type: 'SOFT_ESCALATE' },
    },
    hardEscalate: {
      priority: 100,
      when: (facts) => facts.agent.turnCount > 6,
      require: { type: 'HARD_ESCALATE', reason: 'Conversation stuck' },
    },
  },
  resolvers: {
    softEscalate: {
      requirement: 'SOFT_ESCALATE',
      resolve: async (req, context) => {
        // Inject a system hint to wrap up
        context.facts.agent.systemPrompt += '\nPlease try to resolve this quickly.';
      },
    },
    hardEscalate: {
      requirement: 'HARD_ESCALATE',
      resolve: async (req, context) => {
        // Your notification function — Directive doesn't provide this
        await notifyHumanAgent(context.facts.agent.conversationId, req.reason);
        context.facts.agent.status = 'paused';
      },
    },
  },
});
```

## Related

- [Guardrails reference](/ai/guardrails) — PII detection, moderation, and custom guardrails
- [Orchestrator reference](/ai/orchestrator) — constraints, resolvers, and lifecycle
- [Prevent Off-Topic Responses guide](/ai/guides/prevent-off-topic-responses) — topic boundary guardrails
- [Control AI Costs guide](/ai/guides/control-ai-costs) — detailed budget management
