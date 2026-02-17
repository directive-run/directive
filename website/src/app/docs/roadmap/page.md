---
title: Roadmap
description: Where Directive is headed – what we've shipped, what we're building, and what's on the horizon.
---

A living document organized by theme, not timeline. Priorities may shift as we learn from community feedback. {% .lead %}

---

## Shipped

The core engine is built and tested. These features are available today in `v0.1`.

- [x] Facts (proxy-based reactive state with auto-tracking)
- [x] Derivations (auto-tracked computed values with composition)
- [x] Constraints (sync and async, with priority)
- [x] Resolvers (async resolution with retry and batching)
- [x] Effects (fire-and-forget side effects)
- [x] Events (dispatch and subscribe)
- [x] Module composition (multi-module systems with namespacing)
- [x] Plugin architecture (lifecycle hooks, composable)
- [x] Time-travel debugging (snapshots, replay, export/import)
- [x] React adapter (`useDirective`, `useDirectiveFacts`, `useDirectiveDerive`)
- [x] Error boundaries (configurable recovery strategies)
- [x] Retry policies (exponential backoff, max attempts, timeouts)
- [x] Testing utilities (mock resolvers, fake timers, assertions)
- [x] Schema validation (dev-mode runtime type checking, tree-shaken in prod)

## Building

What we're actively working on right now.

- [ ] Documentation and guides
- [ ] Interactive examples (Sudoku, Checkers, and more)
- [ ] Website polish and developer experience
- [ ] AI adapter for LLM-powered resolvers

## Planned

On deck for `v0.2`. Scoped and ready to build.

- [ ] MCP plugin with validation
- [ ] Browser devtools extension
- [ ] More codemods (Recoil, Jotai)
- [ ] Performance profiler

## Exploring

Ideas we're excited about for `v0.3` and beyond. No commitments yet, but these are directions we believe in.

- [ ] Visual state graph editor
- [ ] Collaboration features (multiplayer state)
- [ ] Server-side Directive (Node.js optimized runtime)
- [ ] Framework adapters for Vue, Svelte, Solid, and Lit

## Not planned

Some things are intentionally out of scope. Directive is a runtime for constraint-driven state – not a general-purpose computation engine.

- **CRDT / distributed state** – Directive manages local application state. Distributed sync is a separate problem best solved by purpose-built tools like Yjs or Automerge.
- **Linear / constraint solvers** – Our constraints are boolean predicates, not mathematical optimization problems. We won't build a SAT solver.
- **Multi-agent planning** – Directive orchestrates state resolution, not AI agent coordination. Use a dedicated agent framework alongside Directive instead.

## Have an idea?

We'd love to hear what you'd build with Directive. Share feature requests, use cases, or feedback in [GitHub Discussions](https://github.com/directive-run/directive/discussions).
