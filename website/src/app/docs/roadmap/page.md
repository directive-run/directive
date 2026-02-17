---
title: Roadmap
description: Where Directive is headed – what we've shipped, what we're building, and what's on the horizon.
---

A living document organized by theme, not timeline. Priorities may shift as we learn from community feedback. {% .lead %}

---

## Shipped

The core engine plus a full ecosystem &ndash; reactive state, AI orchestration, framework adapters, plugins, and developer tools.

### Core Engine

- [x] Facts (proxy-based reactive state with auto-tracking)
- [x] Derivations (auto-tracked computed values with composition)
- [x] Constraints (sync and async, with priority and explicit deps)
- [x] Resolvers (async resolution with retry, batching, and cancel)
- [x] Effects (fire-and-forget side effects with auto-tracked deps)
- [x] Events (dispatch and subscribe)
- [x] Module composition (multi-module systems with `::` namespacing)
- [x] Error boundaries (configurable recovery strategies)
- [x] Retry policies (exponential backoff, max attempts, timeouts)
- [x] Schema validation (dev-mode runtime type checking, tree-shaken in prod)

### Framework Adapters

- [x] React (`useDirective`, `useDirectiveFacts`, `useDirectiveDerive`)
- [x] Vue (composables with reactive integration)
- [x] Svelte (stores and runes support)
- [x] Solid (signals integration)
- [x] Lit (reactive controllers)
- [x] Preact (lightweight adapter)
- [x] Angular (service-based adapter with signals)

### AI & Agents

- [x] AI package (`@directive-run/ai`) with constraint-driven orchestration
- [x] Multi-agent system (planning, delegation, tool use, memory)
- [x] RAG pipelines (retrieval-augmented generation with fact grounding)
- [x] Guardrails (input/output validation, content filtering, budget limits)
- [x] Streaming support (token-level streaming with backpressure)
- [x] Budget and cost tracking (per-request and aggregate limits)
- [x] OpenAI adapter
- [x] Anthropic adapter
- [x] Ollama adapter (local models)

### Plugins & Observability

- [x] Plugin architecture (lifecycle hooks, composable)
- [x] Logging plugin (structured, filterable)
- [x] DevTools plugin (state inspection, event log)
- [x] Persistence plugin (localStorage, sessionStorage, custom backends)
- [x] MCP plugin (Model Context Protocol with validation)
- [x] Performance profiler (constraint evaluation timing, resolver metrics)
- [x] Time-travel debugging (snapshots, replay, export/import)
- [x] Changeset-based versioning

### Security & Safety

- [x] Prototype pollution guards (all merged objects use `Object.create(null)`)
- [x] Re-entrance guards (flush coalescing, max iteration limits)
- [x] Blocked property checks on dispatch and proxy access
- [x] Error isolation (throwing callbacks cannot bypass recovery)
- [x] Resolver cancel/finally race condition protection
- [x] Namespace collision detection (fact/derivation overlap warnings)

### Developer Experience

- [x] Testing utilities (mock resolvers, fake timers, assertion helpers)
- [x] Interactive examples (Sudoku, Checkers, and more)
- [x] Documentation site with guides and API reference
- [x] Migration codemods (Redux, Zustand, XState)
- [x] TypeScript-first API with full type inference

## Building

What we're actively working on right now.

- [-] Browser DevTools extension with time-travel UI
- [-] "Why didn't this fire?" debugger for inactive constraints
- [-] Online interactive playground
- [-] More codemods (Recoil, Jotai)

## Planned

Scoped and ready to build.

- [ ] Actor model support (`createActor()`)
- [ ] TypeScript Language Service plugin
- [ ] Stale-while-revalidate resolver strategy
- [ ] Schema-driven form generation
- [ ] SSR hydration patterns cookbook
- [ ] Video tutorials

## Exploring

Ideas we're excited about. No commitments yet, but these are directions we believe in.

- [ ] Visual Constraint Editor
- [ ] AI-powered constraint suggestions
- [ ] Collaborative debugging
- [ ] Codegen CLI
- [ ] Community examples gallery

## Not planned

Some things are intentionally out of scope. Directive is a runtime for constraint-driven state &ndash; not a general-purpose computation engine.

- **CRDT / distributed state** &ndash; Directive manages local application state. Distributed sync is a separate problem best solved by purpose-built tools like Yjs or Automerge.
- **Linear / constraint solvers** &ndash; Our constraints are boolean predicates, not mathematical optimization problems. We won't build a SAT solver.

## Have an idea?

We'd love to hear what you'd build with Directive. Share feature requests, use cases, or feedback in [GitHub Discussions](https://github.com/directive-run/directive/discussions).
