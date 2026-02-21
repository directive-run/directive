---
title: AI & Agents Overview
description: Constraint-driven AI agent orchestration – guardrails, streaming, multi-agent patterns, memory, evals, and devtools.
---

The AI adapter brings Directive's constraint system to AI agent orchestration. Wrap any LLM framework with safety guardrails, approval workflows, token budgets, and state persistence. {% .lead %}

---

## Architecture

Directive doesn't replace your agent framework &ndash; it wraps it:

```
Your Agent Framework (OpenAI, Anthropic, LangChain, etc.)
    ↕
Directive AI Adapter (guardrails, constraints, state)
    ↕
Your Application
```

The AI adapter is organized into five sections:

| Section | What's Inside |
|---------|---------------|
| **[AI Foundations](#reading-paths)** | Entry ramp &ndash; running agents, resilience, routing |
| **[Agent Orchestrator](#two-orchestrators)** | Single-agent deep dive &ndash; guardrails, streaming, memory |
| **[Multi-Agent Orchestrator](#two-orchestrators)** | Multi-agent deep dive &ndash; patterns, communication, goals |
| **[AI Infrastructure](#infrastructure)** | Integrations &ndash; MCP, RAG, SSE, semantic cache |
| **[AI Observability](#observability)** | Debugging &ndash; timeline, devtools, evals, OTEL, testing |

---

## Reading Paths

### Quick Start Path

Build a working agent system step by step:

1. [Running Agents](/docs/ai/running-agents) &ndash; End-to-end examples
2. [Agent Orchestrator](/docs/ai/orchestrator) &ndash; Single-agent with guardrails
3. [Multi-Agent Orchestrator](/docs/ai/multi-agent) &ndash; Full multi-agent setup
4. [Execution Patterns](/docs/ai/patterns) &ndash; Parallel, sequential, supervisor

### Production Path

Harden for production after the basics:

1. [Resilience & Routing](/docs/ai/resilience-routing) &ndash; Retry, fallback, budgets
2. [Guardrails](/docs/ai/guardrails) &ndash; Input/output validation and PII detection
3. [Self-Healing](/docs/ai/self-healing) &ndash; Automatic error recovery
4. [Evals](/docs/ai/evals) &ndash; Quality measurement in CI
5. [OpenTelemetry](/docs/ai/otel) &ndash; Production observability

### Advanced Path

Unlock the full power of the system:

1. [Goal Engine](/docs/ai/goals) &ndash; Desired-state convergence
2. [Communication](/docs/ai/communication) &ndash; Decentralized agent messaging
3. [Cross-Agent State](/docs/ai/cross-agent-state) &ndash; Shared derivations and scratchpad
4. [Breakpoints & Checkpoints](/docs/ai/breakpoints) &ndash; Human-in-the-loop debugging
5. [DevTools](/docs/ai/devtools) &ndash; Real-time visual debugging (8 views)

---

## Two Orchestrators

Both are backed by a Directive System with reactive state, constraints, guardrails, streaming, approval, memory, retry, budget, hooks, and time-travel debugging. The multi-agent orchestrator has full feature parity &ndash; each registered agent becomes a namespaced Directive module.

| | Single-Agent | Multi-Agent |
|---|---|---|
| **Function** | `createAgentOrchestrator` | `createMultiAgentOrchestrator` |
| **Scope** | One agent at a time | Multiple named agents with concurrency control |
| **State** | `orchestrator.facts.agent` | `orchestrator.facts` (namespaced per agent) |
| **Streaming** | `orchestrator.runStream()` | `orchestrator.runAgentStream()` |
| **Patterns** | &ndash; | `parallel()`, `sequential()`, `supervisor()`, `dag()`, `race()`, `reflect()`, `debate()` |
| **Guardrails** | Orchestrator-level | Orchestrator-level + per-agent |
| **Constraints** | Orchestrator-level | Orchestrator-level + per-agent |
| **Approval** | `approve()` / `reject()` | `approve()` / `reject()` (routes to correct agent) |
| **Derivations** | &ndash; | [Cross-agent derivations](/docs/ai/cross-agent-state) |
| **Scratchpad** | &ndash; | [Shared scratchpad](/docs/ai/cross-agent-state#shared-scratchpad) |
| **Communication** | &ndash; | [Message bus, agent network, handoffs](/docs/ai/communication) |
| **Breakpoints** | 4 types | 6 types (+ `pre_handoff`, `pre_pattern_step`) |
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
| **Middleware** | Composable `with*` wrappers (`withRetry`, `withFallback`, `withBudget`) |
| **Guardrails** | Input, output, and tool-call validators that block or transform data |
| **Constraints** | Declarative rules (e.g., "if confidence < 0.7, escalate to expert") |
| **Memory** | Sliding window, token-based, or hybrid conversation management |
| **Resilience** | Intelligent retry, provider fallback chains, and cost budget guards |
| **Circuit Breaker** | Automatic fault isolation for failing agent calls |
| **Goal Engine** | Desired-state convergence &ndash; declare goals, engine resolves them |
| **Evals** | Dataset-driven quality evaluation with built-in and LLM-as-judge criteria |
| **DevTools** | Real-time debugging UI with 8 specialized views |

---

## Quick Example

```typescript
import { createAgentOrchestrator, createPIIGuardrail } from '@directive-run/ai';
import { createOpenAIRunner } from '@directive-run/ai/openai';

const runner = createOpenAIRunner({
  apiKey: process.env.OPENAI_API_KEY!,
});

const agent = {
  name: 'assistant',
  instructions: 'You are a helpful assistant.',
};

const orchestrator = createAgentOrchestrator({
  runner,

  // Block PII in user input
  guardrails: {
    input: [createPIIGuardrail()],
  },

  // Auto-enforce a 10K token budget
  maxTokenBudget: 10000,

  // React to agent state with declarative rules
  constraints: {
    escalateOnLowConfidence: {
      when: (facts) => facts.agent.output?.confidence < 0.7,
      require: (facts) => ({
        type: 'RUN_EXPERT_AGENT',
        query: facts.agent.input,
      }),
    },
  },
});

const result = await orchestrator.run(agent, 'Hello!');
```

---

## Infrastructure

| Feature | Page | Description |
|---------|------|-------------|
| [MCP Integration](/docs/ai/mcp) | Model Context Protocol | Connect to MCP tool servers |
| [RAG Enricher](/docs/ai/rag) | Retrieval-Augmented Generation | Embedding-based document retrieval |
| [SSE Transport](/docs/ai/sse-transport) | Server-Sent Events | HTTP streaming endpoints |
| [Semantic Cache](/docs/ai/semantic-cache) | Response Caching | Embedding-based cache with ANN indexes |

## Observability

| Feature | Page | Description |
|---------|------|-------------|
| [Debug Timeline](/docs/ai/debug-timeline) | Event Recording | 25+ event types with time-travel correlation |
| [Breakpoints & Checkpoints](/docs/ai/breakpoints) | Pausing & State | Human-in-the-loop debugging, persistent snapshots |
| [DevTools](/docs/ai/devtools) | Visual Debugging | 8 views: Timeline, Flamechart, DAG, Health, Cost, Breakpoints, State, Compare |
| [Evals](/docs/ai/evals) | Quality Measurement | 10 built-in criteria, LLM-as-judge, CI assertions |
| [OpenTelemetry](/docs/ai/otel) | Production Tracing | OTEL spans with GenAI semantic conventions |
| [Testing](/docs/ai/testing) | Test Utilities | Mock runners, test orchestrators, assertion helpers |

---

## Safety & Compliance

Directive provides security guardrails and compliance tooling for AI agent systems. See [Security & Compliance](/docs/security/overview) for full details.

```
User Input
  → Prompt Injection Detection  (block attacks before they reach agents)
  → PII Detection               (redact sensitive data from input)
  → Agent Execution              (safe to process after filtering)
  → Output PII Scan             (catch any data leaks in responses)
  → Audit Trail                 (log every operation for compliance)
```

| Feature | Threat Addressed |
|---------|-----------------|
| [PII Detection](/docs/security/pii) | Personal information leaking to/from agents |
| [Prompt Injection](/docs/security/prompt-injection) | Jailbreaks, instruction overrides |
| [Audit Trail](/docs/security/audit) | Tamper-evident logging |
| [GDPR/CCPA](/docs/security/compliance) | Right to erasure, data export, consent |

---

## Next Steps

- **New to AI adapter?** Start with [Running Agents](/docs/ai/running-agents)
- **Need resilience?** See [Resilience & Routing](/docs/ai/resilience-routing)
- **Want streaming?** See [Streaming](/docs/ai/streaming)
- **Need safety?** See [Guardrails](/docs/ai/guardrails) and [Security & Compliance](/docs/security/overview)
- **Production debugging?** See [DevTools](/docs/ai/devtools) and [Evals](/docs/ai/evals)
