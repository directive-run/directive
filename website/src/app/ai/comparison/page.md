---
title: AI Framework Comparison
description: How Directive's AI adapter compares to LangChain, CrewAI, AutoGen, and Vercel AI SDK.
---

How Directive compares to popular AI agent frameworks. {% .lead %}

Directive's AI adapter doesn't replace your LLM framework &ndash; it wraps it with constraint-driven orchestration. This means you keep your existing agent code and gain guardrails, reactive state, time-travel debugging, and declarative patterns on top.

---

## At a Glance

| Feature | Directive AI | LangChain/LangGraph | CrewAI | AutoGen | Vercel AI SDK |
|---------|-------------|---------------------|--------|---------|--------------|
| **Approach** | Constraint-driven wrapper | Graph-based chains | Role-based crews | Conversational agents | Streaming-first UI |
| **Framework lock-in** | None &ndash; wraps any runner | LangChain ecosystem | CrewAI agents | AutoGen agents | Vercel ecosystem |
| **Reactive state** | Directive System backbone | LangGraph state | Shared memory | Chat history | React state |
| **Guardrails** | Input + output + tool-call | LangSmith eval | &ndash; | &ndash; | &ndash; |
| **Execution patterns** | 8 built-in (parallel, sequential, supervisor, DAG, race, reflect, debate, goal) | LangGraph nodes/edges | Sequential/parallel | Round-robin chat | &ndash; |
| **Constraints** | Declarative `when`/`require` | &ndash; | &ndash; | &ndash; | &ndash; |
| **Time-travel debug** | Built-in snapshots + fork | LangSmith tracing | &ndash; | &ndash; | &ndash; |
| **DevTools** | Visual debugger (12 views) | LangSmith dashboard | &ndash; | AutoGen Studio | &ndash; |
| **Streaming** | Token-level with backpressure | LangChain streaming | &ndash; | &ndash; | Core strength |
| **Memory** | 3 strategies + summarizers | LangChain memory | Crew memory | Chat history | &ndash; |
| **Evals** | 10 built-in criteria + LLM judge | LangSmith evals | &ndash; | &ndash; | &ndash; |
| **Self-healing** | Circuit breaker + auto-reroute | &ndash; | &ndash; | &ndash; | &ndash; |
| **Goal pattern** | Desired-state goal resolution | &ndash; | Goal-oriented tasks | &ndash; | &ndash; |
| **Pattern checkpoints** | Save/resume all 8 patterns | LangGraph checkpointing | &ndash; | &ndash; | &ndash; |
| **TypeScript** | First-class, fully typed | Python-first, TS port | Python only | Python-first, TS port | First-class |
| **Bundle size** | Tree-shakeable, zero-cost debug | Large dependency tree | N/A (Python) | N/A (Python) | Small |

---

## LangChain / LangGraph

LangChain provides a comprehensive toolkit for building LLM applications with chains, agents, and tools. LangGraph adds graph-based orchestration with nodes and edges.

### When LangChain is Better

- You need the broadest ecosystem of integrations (100+ LLM providers, vector stores, tools)
- Your team is Python-first
- You want LangSmith's hosted tracing and evaluation platform

### When Directive Adds Value

- You want framework-agnostic orchestration that wraps any LLM SDK
- You need declarative constraints that automatically trigger agent runs
- You want reactive state (derivations, scratchpad) that drives UI updates
- You need visual debugging (Timeline, Cost, State) without a hosted service
- You want self-healing with automatic agent rerouting

### Using Together

Directive can wrap a LangChain runner. Use LangChain for your LLM calls and tool integrations, Directive for orchestration, guardrails, and state management.

---

## CrewAI

CrewAI provides role-based agent teams with tasks, tools, and process flows. Agents have roles, goals, and backstories.

### When CrewAI is Better

- You want the simplest mental model for multi-agent systems
- Role-based metaphors (researcher, writer, reviewer) fit your use case
- You're building in Python

### When Directive Adds Value

- You need TypeScript-native orchestration
- You want per-agent and orchestrator-level guardrails (input, output, tool-call)
- You need 8 execution patterns beyond sequential and parallel (including goal-directed resolution)
- You want reactive cross-agent derivations and shared scratchpad
- You need breakpoints, checkpoints, and time-travel debugging

Directive's goal pattern goes beyond CrewAI's role-based goals. CrewAI goals are natural-language descriptions that guide agent behavior (`goal="Identify trending topics"`). Directive goals are machine-checkable conditions with dependency resolution, quantitative satisfaction tracking, and progressive relaxation &ndash; the runtime knows exactly how close you are to done and can self-correct when progress stalls.

---

## AutoGen

Microsoft's AutoGen enables multi-agent conversations where agents chat with each other to solve problems.

### When AutoGen is Better

- Conversational multi-agent patterns (round-robin, group chat) are your primary use case
- You want AutoGen Studio's visual builder
- Your team uses Python

### When Directive Adds Value

- You need structured execution patterns (DAG, race, reflect, debate) beyond conversation
- You want constraint-driven orchestration with declarative rules
- You need token budgets, circuit breakers, and self-healing
- You want a reactive state backbone that drives UI updates
- You need evals with 10 built-in criteria and LLM-as-judge scoring

---

## Vercel AI SDK

Vercel AI SDK provides streaming-first UI primitives for React, with excellent DX for chatbots and generative UI.

### When Vercel AI SDK is Better

- You're building a chat UI and want the fastest path to streaming responses
- You want React Server Components integration
- Your use case is primarily single-agent chat

### When Directive Adds Value

- You need multi-agent orchestration with patterns, constraints, and guardrails
- You want framework-agnostic state (works with React, Vue, Svelte, Solid, Lit)
- You need time-travel debugging and visual DevTools (Timeline, Cost, State)
- You want declarative agent routing based on runtime state
- You need production features: evals, OTEL, self-healing, goal pattern

### Using Together

Use Vercel AI SDK for the streaming UI layer and Directive for backend orchestration, guardrails, and state management.

---

## Directive's Unique Differentiators

Features no other framework provides:

1. **Constraint-driven orchestration** &ndash; Declare `when`/`require` rules; the runtime resolves them automatically
2. **Goal pattern** &ndash; Declare desired end-state with `produces`/`requires` declarations; runtime resolves through dependency-ordered agent runs with satisfaction scoring and progressive relaxation
3. **Reactive Directive System backbone** &ndash; Every agent is a namespaced module with reactive facts, derivations, and effects
4. **Cross-agent derivations** &ndash; Compute values across all agent states reactively
5. **Visual DevTools** &ndash; Timeline, Cost, State (plus 5 more views planned: Flamechart, DAG, Health, Breakpoints, Compare)
6. **Self-healing** &ndash; Circuit breakers with automatic agent rerouting and health scoring
7. **Pattern checkpoints** &ndash; Save/resume mid-execution for all 8 pattern types with progress tracking, forking, and diffing
8. **Framework-agnostic** &ndash; Wraps any `AgentRunner` function, no LLM SDK lock-in

---

## Next Steps

- [Overview](/ai/overview) &ndash; Full feature map and reading paths
- [Running Agents](/ai/running-agents) &ndash; Get started with Directive AI
- [Execution Patterns](/ai/patterns) &ndash; See all 8 patterns in action
