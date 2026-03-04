---
title: Control AI Costs
description: Prevent runaway AI agents from burning through API budgets with token limits and cost tracking.
---

Prevent runaway agents from burning through your API budget. {% .lead %}

---

## The Problem

An agent enters a reasoning loop and burns through $50 of tokens in minutes. A batch job scales to 1,000 concurrent agents overnight. Without guardrails on spending, LLM costs spiral out of control.

## The Solution

Use `maxTokenBudget` on the orchestrator for simple token caps, or `withBudget` middleware for dollar-based limits with time windows:

```typescript
import { createAgentOrchestrator, withBudget } from '@directive-run/ai';

// Option 1: Simple token cap on orchestrator
const orchestrator = createAgentOrchestrator({
  runner, // See Running Agents (/ai/running-agents) for setup
  autoApproveToolCalls: true,
  maxTokenBudget: 50000,
  budgetWarningThreshold: 0.8,
  onBudgetWarning: ({ currentTokens, maxBudget, percentage }) => {
    console.warn(`Budget ${Math.round(percentage * 100)}% used`);
  },
});

// Option 2: Dollar-based limits with time windows
const budgetedRunner = withBudget(runner, {
  maxCostPerCall: 0.50,
  budgets: [
    { window: 'hour', maxCost: 10.00 },
    { window: 'day', maxCost: 100.00 },
  ],
  pricing: {
    inputPerToken: 0.000003,
    outputPerToken: 0.000015,
  },
  onBudgetExceeded: (details) => {
    console.error(`Budget exceeded: ${details.reason}`);
  },
});
```

## How It Works

- **`maxTokenBudget`** is a hard cap on total tokens (input + output) across all agent turns. The agent pauses when exceeded.
- **`budgetWarningThreshold`** fires `onBudgetWarning` at the specified percentage (0.8 = 80%).
- **`withBudget`** wraps a runner with dollar-based cost tracking. It estimates costs before each call and rejects calls that would exceed the budget.
- **`budgets` array** supports multiple time windows. Each window tracks spending independently.
- **`pricing`** maps token counts to dollar costs. Set these to match your LLM provider's pricing.

## Full Example

An orchestrator with both token caps and dollar budgets, plus logging:

```typescript
import {
  createAgentOrchestrator,
  withBudget,
} from '@directive-run/ai';

const budgetedRunner = withBudget(runner, { // See Running Agents (/ai/running-agents) for setup
  maxCostPerCall: 1.00,
  budgets: [
    { window: 'hour', maxCost: 25.00 },
    { window: 'day', maxCost: 200.00 },
  ],
  pricing: {
    inputPerToken: 0.000003,
    outputPerToken: 0.000015,
  },
  onBudgetExceeded: (details) => {
    alertOps(`AI budget exceeded: ${details.reason}`); // Your alerting function
  },
});

const orchestrator = createAgentOrchestrator({
  runner: budgetedRunner,
  autoApproveToolCalls: true,
  maxTokenBudget: 100000,
  budgetWarningThreshold: 0.9,
  onBudgetWarning: ({ percentage }) => {
    console.warn(`Token budget at ${Math.round(percentage * 100)}%`);
  },
});

// Check spending at any time
const hourlySpend = budgetedRunner.getSpent('hour');
const dailySpend = budgetedRunner.getSpent('day');
console.log(`Spent: $${hourlySpend.toFixed(2)}/hr, $${dailySpend.toFixed(2)}/day`);
```

## Related

- [Orchestrator reference](/ai/orchestrator) – `maxTokenBudget` and warning configuration
- [Resilience & Routing](/ai/resilience-routing) – `withBudget`, `withRetry`, and other middleware
- [Handle Agent Errors guide](/ai/guides/handle-agent-errors) – handling `BudgetExceededError`
