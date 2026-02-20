---
title: AI & Agents Overview
description: Constraint-driven AI agent orchestration – guardrails, streaming, multi-agent patterns, and memory.
---

The AI adapter brings Directive's constraint system to AI agent orchestration. Wrap any LLM framework with safety guardrails, approval workflows, token budgets, and state persistence. {% .lead %}

---

## Architecture

Directive doesn't replace your agent framework – it wraps it:

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
| 1 | [Running Agents](/docs/ai/running-agents) | End-to-end examples and deployment patterns |
| 2 | [Resilience & Routing](/docs/ai/resilience-routing) | `pipe()` composition, retry, fallback, budgets, model selection, structured outputs |
| 3 | [Orchestrator](/docs/ai/orchestrator) | Single-agent runs with guardrails and constraints |
| 4 | [Guardrails](/docs/ai/guardrails) | Input/output/tool-call validation, PII detection, moderation |
| 5 | [Streaming](/docs/ai/streaming) | Real-time token streaming with backpressure and stream guardrails |
| 6 | [Multi-Agent](/docs/ai/multi-agent) | Parallel, sequential, supervisor patterns with per-agent guardrails and streaming |
| 7 | [MCP Integration](/docs/ai/mcp) | Model Context Protocol tool servers |
| 8 | [SSE Transport](/docs/ai/sse-transport) | Server-Sent Events streaming for HTTP endpoints |
| 9 | [RAG Enricher](/docs/ai/rag) | Embedding-based retrieval-augmented generation |
| 10 | [Debug Timeline](/docs/ai/debug-timeline) | Trace and inspect agent execution events |
| 11 | [Self-Healing](/docs/ai/self-healing) | Automatic error recovery and agent rerouting |

---

## Two Orchestrators

Directive ships two orchestrators. Both are backed by a Directive System with reactive state, constraints, guardrails, streaming, approval, memory, retry, budget, hooks, and time-travel debugging. The multi-agent orchestrator has full feature parity with the single-agent orchestrator &mdash; each registered agent becomes a namespaced Directive module with its own reactive state and constraint evaluation.

| | Single-Agent | Multi-Agent |
|---|---|---|
| **Function** | `createAgentOrchestrator` | `createMultiAgentOrchestrator` |
| **Scope** | One agent at a time | Multiple named agents with concurrency control |
| **State** | `orchestrator.facts.agent` | `orchestrator.facts` (namespaced per agent) |
| **Streaming** | `orchestrator.runStream()` | `orchestrator.runAgentStream()` |
| **Patterns** | &ndash; | `parallel()`, `sequential()`, `supervisor()` |
| **Guardrails** | Orchestrator-level | Orchestrator-level + per-agent |
| **Constraints** | Orchestrator-level | Orchestrator-level + per-agent |
| **Approval** | `approve()` / `reject()` | `approve()` / `reject()` (routes to correct agent) |
| **Use when** | Simple chatbot, single-purpose agent | Pipelines, fan-out, delegation, routing |

```typescript
// Single-agent
const single = createAgentOrchestrator({ runner, guardrails, maxTokenBudget: 10000 });
const result = await single.run(agent, 'Hello!');

// Multi-agent
const multi = createMultiAgentOrchestrator({
  runner,
  agents: { researcher: { agent: researcher }, writer: { agent: writer } },
  guardrails,
  maxTokenBudget: 50000,
});
const result = await multi.runAgent('researcher', 'What is WASM?');
```

---

## Key Concepts

| Concept | Description |
|---------|-------------|
| **Orchestrator** | Wraps an `AgentRunner` with constraints, guardrails, and state tracking |
| **Multi-Agent Orchestrator** | Coordinates multiple named agents with concurrency, patterns, and per-agent configuration |
| **`pipe()`** | Left-to-right middleware composition: `pipe(runner, withRetry(...), withBudget(...))` |
| **Middleware** | Composable `with*` wrappers (`withRetry`, `withFallback`, `withBudget`) that stack on any runner |
| **Guardrails** | Input, output, and tool-call validators that block or transform data |
| **Constraints** | Declarative rules (e.g., "if confidence < 0.7, escalate to expert") |
| **Memory** | Sliding window, token-based, or hybrid conversation management |
| **Resilience** | Intelligent retry, provider fallback chains, and cost budget guards |
| **Circuit Breaker** | Automatic fault isolation for failing agent calls |

---

## Quick Example

```typescript
import { createAgentOrchestrator, createPIIGuardrail } from '@directive-run/ai';

const orchestrator = createAgentOrchestrator({
  runner: myAgentRunner,

  // Block any user input that contains personal information
  guardrails: {
    input: [createPIIGuardrail()],
  },

  // Pause agents automatically when token spend exceeds the budget
  constraints: {
    budgetLimit: {
      when: (facts) => facts.agent.tokenUsage > 10000,
      require: { type: 'PAUSE_AGENTS' },
    },
  },

  maxTokenBudget: 10000,
});

// Run the agent – guardrails and constraints are applied automatically
const result = await orchestrator.run(myAgent, 'Hello!');
```

---

## Safety & Compliance

Directive provides security guardrails and compliance tooling for AI agent systems. See the [Security & Compliance](/docs/security/overview) section for full details. Apply multiple layers of protection:

```
User Input
  → Prompt Injection Detection  (block attacks before they reach agents)
  → PII Detection               (redact sensitive data from input)
  → Agent Execution              (safe to process after filtering)
  → Output PII Scan             (catch any data leaks in responses)
  → Audit Trail                 (log every operation for compliance)
```

| Feature | Page | Threat Addressed |
|---------|------|-----------------|
| [PII Detection](/docs/security/pii) | Input/output scanning | Personally identifiable information leaking to/from agents |
| [Prompt Injection](/docs/security/prompt-injection) | Input validation | Jailbreaks, instruction overrides, encoding evasion |
| [Audit Trail](/docs/security/audit) | Observability | Tamper-evident logging of every system operation |
| [GDPR/CCPA](/docs/security/compliance) | Data governance | Right to erasure, data export, consent tracking, retention |

| Scenario | Features |
|----------|---------|
| User-facing chatbot | PII detection + prompt injection + audit trail |
| Internal tool | Audit trail + GDPR compliance |
| Healthcare/finance | All four features |
| Development/testing | Audit trail only |

---

## Next Steps

- **New to AI adapter?** Start with [Running Agents](/docs/ai/running-agents)
- **Need resilience?** See [Resilience & Routing](/docs/ai/resilience-routing) for retry, fallback, and budgets
- **Want streaming?** See [Streaming](/docs/ai/streaming)
- **Need safety?** See [Guardrails](/docs/ai/guardrails) and [Security & Compliance](/docs/security/overview)
