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

1. [Running Agents](/ai/running-agents) &ndash; End-to-end examples
2. [Agent Orchestrator](/ai/orchestrator) &ndash; Single-agent with guardrails
3. [Multi-Agent Orchestrator](/ai/multi-agent) &ndash; Full multi-agent setup
4. [Execution Patterns](/ai/patterns) &ndash; Parallel, sequential, supervisor

### Production Path

Harden for production after the basics:

1. [Resilience & Routing](/ai/resilience-routing) &ndash; Retry, fallback, budgets
2. [Guardrails](/ai/guardrails) &ndash; Input/output validation and PII detection
3. [Self-Healing](/ai/self-healing) &ndash; Automatic error recovery
4. [Evals](/ai/evals) &ndash; Quality measurement in CI
5. [OpenTelemetry](/ai/otel) &ndash; Production observability

### Advanced Path

Unlock the full power of the system:

1. [Pattern Checkpoints](/ai/checkpoints) &ndash; Save/resume, fork, progress tracking
2. [Goal Pattern](/ai/patterns#goal) &ndash; Desired-state resolution with satisfaction scoring and relaxation
3. [Communication](/ai/communication) &ndash; Decentralized agent messaging
4. [Cross-Agent State](/ai/cross-agent-state) &ndash; Shared derivations and scratchpad
5. [Breakpoints & Checkpoints](/ai/breakpoints) &ndash; Human-in-the-loop debugging
6. [DevTools](/ai/devtools) &ndash; Real-time visual debugging (Timeline, Cost, State &plus; 5 more planned)

---

## Two Orchestrators

Both are backed by a Directive System with reactive state, constraints, guardrails, streaming, approval, memory, retry, budget, hooks, and time-travel debugging. The multi-agent orchestrator has full feature parity &ndash; each registered agent becomes a namespaced Directive module.

| | Single-Agent | Multi-Agent |
|---|---|---|
| **Function** | `createAgentOrchestrator` | `createMultiAgentOrchestrator` |
| **Scope** | One agent at a time | Multiple named agents with concurrency control |
| **State** | `orchestrator.facts.agent` | `orchestrator.facts` (namespaced per agent) |
| **Streaming** | `orchestrator.runStream()` | `orchestrator.runAgentStream()` |
| **Patterns** | &ndash; | `parallel()`, `sequential()`, `supervisor()`, `dag()`, `race()`, `reflect()`, `debate()`, `goal()` |
| **Guardrails** | Orchestrator-level | Orchestrator-level + per-agent |
| **Constraints** | Orchestrator-level | Orchestrator-level + per-agent |
| **Approval** | `approve()` / `reject()` | `approve()` / `reject()` (routes to correct agent) |
| **Derivations** | &ndash; | [Cross-agent derivations](/ai/cross-agent-state) |
| **Scratchpad** | &ndash; | [Shared scratchpad](/ai/cross-agent-state#shared-scratchpad) |
| **Communication** | &ndash; | [Message bus, agent network, handoffs](/ai/communication) |
| **Breakpoints** | 4 types | 6 types (+ `pre_handoff`, `pre_pattern_step`) |
| **`totalTokens`** | `orchestrator.totalTokens` | `orchestrator.totalTokens` |
| **`waitForIdle()`** | `orchestrator.waitForIdle()` | `orchestrator.waitForIdle()` |
| **Budget warning** | `budgetWarningThreshold` + `onBudgetWarning` | `budgetWarningThreshold` + `onBudgetWarning` |
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
| **Goal Pattern** | Desired-state goal resolution &ndash; declare produces/requires, runtime resolves |
| **Checkpoints** | Save/resume mid-pattern state for fault tolerance, forking, and progress tracking |
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
| [MCP Integration](/ai/mcp) | Model Context Protocol | Connect to MCP tool servers |
| [RAG Enricher](/ai/rag) | Retrieval-Augmented Generation | Embedding-based document retrieval |
| [SSE Transport](/ai/sse-transport) | Server-Sent Events | HTTP streaming endpoints |
| [Semantic Cache](/ai/semantic-cache) | Response Caching | Embedding-based cache with ANN indexes |

## Observability

| Feature | Page | Description |
|---------|------|-------------|
| [Debug Timeline](/ai/debug-timeline) | Event Recording | 25+ event types with time-travel correlation |
| [Pattern Checkpoints](/ai/checkpoints) | Fault Tolerance | Save/resume all 8 patterns, progress tracking, forking |
| [Breakpoints & Checkpoints](/ai/breakpoints) | Pausing & State | Human-in-the-loop debugging, persistent snapshots |
| [DevTools](/ai/devtools) | Visual Debugging | 3 active views (Timeline, Cost, State) &plus; 5 planned (Flamechart, DAG, Health, Breakpoints, Compare) |
| [Evals](/ai/evals) | Quality Measurement | 10 built-in criteria, LLM-as-judge, CI assertions |
| [OpenTelemetry](/ai/otel) | Production Tracing | OTEL spans with GenAI semantic conventions |
| [Testing](/ai/testing) | Test Utilities | Mock runners, test orchestrators, assertion helpers |

---

## Safety & Compliance

Directive provides security guardrails and compliance tooling for AI agent systems. See [Security & Compliance](/ai/security/overview) for full details.

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
| [PII Detection](/ai/security/pii) | Personal information leaking to/from agents |
| [Prompt Injection](/ai/security/prompt-injection) | Jailbreaks, instruction overrides |
| [Audit Trail](/ai/security/audit) | Tamper-evident logging |
| [GDPR/CCPA](/ai/security/compliance) | Right to erasure, data export, consent |

---

## Next Steps

- **New to AI adapter?** Start with [Running Agents](/ai/running-agents)
- **Need resilience?** See [Resilience & Routing](/ai/resilience-routing)
- **Want streaming?** See [Streaming](/ai/streaming)
- **Need safety?** See [Guardrails](/ai/guardrails) and [Security & Compliance](/ai/security/overview)
- **Production debugging?** See [DevTools](/ai/devtools) and [Evals](/ai/evals)
