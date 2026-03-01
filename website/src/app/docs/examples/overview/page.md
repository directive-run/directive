---
title: Examples
description: Interactive examples that show Directive in action &ndash; from everyday patterns to complex constraint-driven apps.
---

Learn Directive by playing with it. Every example runs live in the browser, and every line of source code is visible below the demo. {% .lead %}

---

## Getting Started

### [Counter](/docs/examples/counter)

The simplest Directive demo. A number-matching game showing the constraint&ndash;resolver loop: set a target, watch the counter resolve to match it.

**Directive features:** facts, constraints, resolvers, effects

### [Auth Flow](/docs/examples/auth-flow)

Login, token refresh with countdown, constraint ordering, and session management. A ticking `now` fact drives reactive expiry detection.

**Directive features:** constraint `after` ordering, auto-tracked derivations, resolvers with retry, effects for status logging

### [Dashboard Loader](/docs/examples/dashboard-loader)

Multi-step data loading with dependency ordering and error recovery.

**Directive features:** constraint `after` ordering, multi-module composition

---

## Multi-Module & Advanced

### [Shopping Cart](/docs/examples/shopping-cart)

Business rules as constraints: quantity limits, coupon validation via API, auth-gated checkout with retry, and derivation composition for totals.

**Directive features:** `devtoolsPlugin({ panel: true })`, multi-module, constraint priority + `after`, error boundaries

### [Async Chains](/docs/examples/async-chains)

Three-module chain (auth &rarr; permissions &rarr; dashboard) with configurable failure rates, retry with exponential backoff, and visual chain status.

**Directive features:** cross-module `after` chains, `crossModuleDeps`, `loggingPlugin`, `devtoolsPlugin({ trace: true })`

### [Form Wizard](/docs/examples/form-wizard)

Multi-step form with constraint-gated advancement, per-step validation, async email checking, and persistence for save-and-resume.

**Directive features:** `persistencePlugin`, constraint-gated advancement, schema validation, async cross-module constraints

---

## Games & Puzzles

### [Sudoku](/docs/examples/sudoku)

The perfect Directive showcase. Sudoku is literally a constraint satisfaction problem &ndash; no duplicates in rows, columns, or 3&times;3 boxes &ndash; and those rules map 1:1 to Directive's constraint&ndash;resolver flow.

**Directive features:** 14 auto-tracked derivations, prioritized constraints, temporal constraints, time-travel debugging

### [Checkers](/docs/examples/checkers)

Two-player checkers with move validation, king promotion, and forced captures &ndash; all expressed as constraints.

**Directive features:** constraint-driven game rules, derived valid moves, time-travel undo

---

## Debugging & Robustness

### [Time Machine](/docs/examples/time-machine)

A drawing canvas with full undo/redo powered by Directive's time-travel debugging. Step through every state snapshot to see exactly how your system evolved.

**Directive features:** time-travel debugging, snapshots, undo/redo

### [Error Boundaries](/docs/examples/error-boundaries)

Circuit breakers, retry policies, and graceful degradation. See how Directive recovers from resolver failures without crashing your app.

**Directive features:** error boundaries, retry policies, circuit breaker pattern

---

## Full-Feature Showcases

### [Fraud Case Analysis](/docs/examples/fraud-analysis)

Multi-stage fraud detection pipeline combining every major Directive feature: 6 constraints with priority + `after` ordering, 6 resolvers with retry and custom keys, 3 effects, 9 derivations with composition, local PII detection, checkpoints, and DevTools with time-travel.

**Directive features:** competing constraints, user-adjustable constraint thresholds, `devtoolsPlugin({ panel: true })`, local PII detection, checkpoints, retry + exponential backoff, dynamic requirements

- **[Pitch Deck](/ai/examples/pitch-deck)** &ndash; Goal execution pattern with 4 agents building a startup pitch evaluation

---

## More Examples

Looking for a specific pattern? These examples aren't in the sidebar but are still available:

- [Theme & Locale](/docs/examples/theme-locale) &ndash; UI preferences with persistence
- [Pagination](/docs/examples/pagination) &ndash; Cursor-based infinite scroll
- [URL Sync](/docs/examples/url-sync) &ndash; Bidirectional URL-state sync
- [Notifications](/docs/examples/notifications) &ndash; Toast queue with auto-dismiss
- [Optimistic Updates](/docs/examples/optimistic-updates) &ndash; Instant UI with rollback
- [WebSocket](/docs/examples/websocket) &ndash; Real-time WebSocket integration
- [Permissions](/docs/examples/permissions) &ndash; Role-based access control
- [Contact Form](/docs/examples/contact-form) &ndash; Simple form submission
- [Feature Flags](/docs/examples/feature-flags) &ndash; Runtime feature toggles
- [A/B Testing](/docs/examples/ab-testing) &ndash; Experiment assignment
- [Dynamic Modules](/docs/examples/dynamic-modules) &ndash; Lazy module loading
- [Debounce Constraints](/docs/examples/debounce-constraints) &ndash; Rate-limited constraints
- [Topic Guard](/docs/examples/topic-guard) &ndash; Content filtering
- [Multi-System DevTools](/docs/examples/multi-system-devtools) &ndash; Multi-system debugging
- [Mixed DevTools](/docs/examples/mixed-devtools) &ndash; Heterogeneous system debugging
- [Batch Resolver](/docs/examples/batch-resolver) &ndash; Batched requirement resolution
- [Provider Routing](/docs/examples/provider-routing) &ndash; Multi-provider routing

---

## Next Steps

- **[Quick Start](/docs/quick-start)** &ndash; Guided tutorial for your first module
- **[Core Concepts](/docs/core-concepts)** &ndash; Understand the theory behind the examples
- **[Choosing Primitives](/docs/choosing-primitives)** &ndash; When to use each Directive primitive
- **[Guides](/docs/guides/overview)** &ndash; Task-oriented recipes for common patterns
