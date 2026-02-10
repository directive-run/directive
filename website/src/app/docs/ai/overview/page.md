---
title: AI & Agents Overview
description: Constraint-driven AI agent orchestration — guardrails, streaming, multi-agent patterns, and memory.
---

The AI adapter brings Directive's constraint system to AI agent orchestration. Wrap any LLM framework with safety guardrails, approval workflows, token budgets, and state persistence. {% .lead %}

---

## Architecture

Directive doesn't replace your agent framework — it wraps it:

```
Your Agent Framework (OpenAI, Anthropic, LangChain, etc.)
    ↕
Directive AI Adapter (guardrails, constraints, state)
    ↕
Your Application
```

---

## Learning Path

Build up from simple to complex:

| Level | Page | What You Learn |
|-------|------|---------------|
| 1 | [Orchestrator](/docs/ai/orchestrator) | Single-agent runs with guardrails and constraints |
| 2 | [Agent Stack](/docs/ai/agent-stack) | Composable agent pipelines with `.run()` / `.stream()` / `.structured()` |
| 3 | [Streaming](/docs/ai/streaming) | Real-time token streaming with backpressure and stream guardrails |
| 4 | [Multi-Agent](/docs/ai/multi-agent) | Parallel, sequential, and supervisor execution patterns |
| 5 | [Guardrails](/docs/ai/guardrails) | Input/output/tool-call validation, PII detection, moderation |
| 6 | [MCP Integration](/docs/ai/mcp) | Model Context Protocol tool servers |
| 7 | [Running Agents](/docs/ai/running-agents) | End-to-end examples and deployment patterns |

---

## Key Concepts

| Concept | Description |
|---------|-------------|
| **Orchestrator** | Wraps an `AgentRunner` with constraints, guardrails, and state tracking |
| **Agent Stack** | Composable `.run()` / `.stream()` / `.structured()` API |
| **Guardrails** | Input, output, and tool-call validators that block or transform data |
| **Constraints** | Declarative rules (e.g., "if confidence < 0.7, escalate to expert") |
| **Memory** | Sliding window, token-based, or hybrid conversation management |
| **Circuit Breaker** | Automatic fault isolation for failing agent calls |

---

## Quick Example

```typescript
import { createAgentOrchestrator, createPIIGuardrail } from 'directive/ai';

const orchestrator = createAgentOrchestrator({
  runner: myAgentRunner,
  guardrails: {
    input: [createPIIGuardrail({ action: 'block' })],
  },
  constraints: {
    budgetLimit: {
      when: (facts) => facts.agent.tokenUsage > 10000,
      require: { type: 'PAUSE_AGENTS' },
    },
  },
  maxTokenBudget: 10000,
});

const result = await orchestrator.run(myAgent, 'Hello!');
```

---

## Next Steps

- **New to AI adapter?** Start with [Orchestrator](/docs/ai/orchestrator)
- **Want streaming?** See [Streaming](/docs/ai/streaming)
- **Need safety?** See [Guardrails](/docs/ai/guardrails) and [Security](/docs/security/overview)
