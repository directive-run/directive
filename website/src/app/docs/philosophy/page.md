---
title: Philosophy
description: The design principles and beliefs that shaped Directive's constraint-driven architecture.
---

Directive is built on a belief: applications should declare what must be true, not script how to get there. {% .lead %}

---

## Constraints Over Actions

Most state management libraries are built around actions – named events that trigger state transitions. Click a button, dispatch an action, run a reducer. The developer is the orchestrator, manually wiring cause to effect.

Directive starts from a different premise: **model the rules, not the steps.**

A constraint says "when this condition holds, this requirement must be fulfilled." It doesn't care *when* or *how* the condition became true. It doesn't need to be wired to a button click or a lifecycle hook. It simply watches reality and reacts when the world doesn't match the rules.

This idea isn't new. Database triggers, CSS layout engines, spreadsheet formulas, and constraint solvers all work this way. Directive brings the same principle to application state: declare invariants, and let the runtime enforce them.

The practical result is that adding a new rule doesn't require tracing every code path that might trigger it. You add the constraint, and it activates whenever its condition is met – regardless of what caused the state change.

---

## The Runtime Knows More Than You

In traditional state management, the developer is responsible for timing, ordering, deduplication, and error recovery. When should this API call fire? What if two components trigger it simultaneously? What if it fails?

Directive's position is that these are runtime concerns, not developer concerns.

When you declare a constraint and a resolver, you're expressing intent: "this must be true" and "here's how to make it true." The runtime handles the rest – when to execute, how to deduplicate concurrent requests, when to retry, and how to sequence dependent operations.

This isn't about taking control away. It's about putting orchestration logic where it belongs: in a system designed to handle it consistently, rather than scattered across dozens of event handlers where subtle timing bugs hide.

---

## State as Ground Truth

In Directive, facts are the single source of truth. Everything else is derived.

- **Derivations** are computed from facts. They don't store their own state – they recompute when their dependencies change.
- **Constraints** evaluate against facts. They're pure functions that inspect reality and generate requirements.
- **Requirements** are transient. They exist only as long as a constraint is active and unfulfilled.

There's no separate "action log" or "event history" that you need to reconcile with actual state. Facts are reality. If you want to know what's true, read the facts. If you want to know what's computed, read a derivation. If you want to know what's needed, check the active requirements.

This principle eliminates an entire class of bugs where derived state drifts out of sync with source state because someone forgot to update a cache or reset a flag.

---

## Separation of Detection and Execution

Constraints detect what's needed. Resolvers handle how to fulfill it. These are deliberately separate concepts.

A constraint doesn't know *how* a user gets fetched – it just knows one is needed. A resolver doesn't know *why* it was triggered – it just knows what requirement to fulfill.

This separation makes systems composable. You can:
- Swap a resolver's implementation without touching constraints
- Add new constraints that reuse existing resolvers
- Test detection logic (constraints) independently from execution logic (resolvers)
- Have multiple constraints generate the same requirement type, and a single resolver handles all of them

The same principle applies to effects. Effects observe state changes without participating in the constraint-resolution cycle. They're strictly one-way – they read facts but don't generate requirements. This keeps observation separate from orchestration.

---

## Resilience by Default

Most frameworks treat error handling, retries, and timeouts as afterthoughts. You build the happy path first, then bolt on error handling when things break in production.

Directive treats failure as a first-class concern:

- **Retry policies** are declared on resolvers, not implemented ad-hoc in every async function
- **Timeouts** prevent resolvers from hanging indefinitely
- **Error boundaries** catch failures and provide configurable recovery
- **Deduplication keys** prevent redundant work automatically

This isn't just convenience. When resilience is declarative and built into the resolution layer, it's consistent. Every resolver gets the same quality of error handling, not just the ones where someone remembered to add a try/catch.

---

## Inspectability Over Magic

Directive automates orchestration, but it doesn't hide what it's doing. Every decision the runtime makes is observable.

- **`inspect()`** shows current facts, active constraints, pending requirements, and running resolvers
- **`explain()`** traces why a particular requirement was generated – which constraint, which fact values
- **Time-travel** lets you step through state changes and see exactly what happened at each point

Automatic doesn't mean opaque. When something unexpected happens, you should be able to trace from effect back to cause without guessing. The runtime should explain itself.

This is a deliberate design choice: the cost of adding inspectability is paid once in the framework. The alternative – adding logging and debugging to every ad-hoc event handler – is paid repeatedly by every developer on every project.

---

## Framework Agnostic, Opinion Strong

Directive works with React, Vue, Svelte, Solid, and Lit. It runs in browsers, servers, and workers. It doesn't depend on any particular rendering framework or runtime environment.

But it has strong opinions about how state should flow:

- State changes flow through the reconciliation loop, not around it
- Side effects are explicit (effects and resolvers), not implicit
- Derived state is computed, not stored
- Async operations are managed by the runtime, not by components

These opinions exist because they eliminate real problems. Race conditions disappear when the runtime manages async. Stale derived state disappears when derivations are auto-tracked. Scattered logic disappears when constraints centralize rules.

The framework adapters are thin – they connect Directive's reactive system to each framework's rendering cycle. The system itself can live wherever makes sense for your use case:

```tsx
import { createSystem } from '@directive-run/core';
import { useDirectiveRef, useFact, useDerived } from '@directive-run/react';
import { chatModule } from './modules/chat';

// Option 1: Component-scoped system (tied to component lifecycle)
function Chat() {
  // Create a system that lives as long as this component
  const system = useDirectiveRef(chatModule);

  // Subscribe to reactive state – re-renders when facts change
  const messages = useFact(system, "messages");

  // Derived values recompute automatically when dependencies change
  const unreadCount = useDerived(system, "unreadCount");

  // System starts on mount, stops on unmount – no manual cleanup
  return <MessageList messages={messages} badge={unreadCount} />;
}

// Option 2: Application singleton (shared across components)
// Create a long-lived system outside any component
// const system = createSystem({ module: chatModule });
// system.start();
//
// function Chat() {
//   // Multiple components can subscribe to the same system
//   const messages = useFact(system, "messages");
//   const unreadCount = useDerived(system, "unreadCount");
//   return <MessageList messages={messages} badge={unreadCount} />;
// }
```

Component-scoped systems are good for isolated features – a form, a widget, a modal. Application singletons are good for shared state that multiple components read from. Either way, the hooks and the module definition are the same. The core logic doesn't change regardless of which UI framework you use or where the system lives.

---

## Next Steps

- **[Why Directive](/docs/why-directive)** – The specific problems Directive solves
- **[Core Concepts](/docs/core-concepts)** – The technical mental model
- **[Quick Start](/docs/quick-start)** – Build your first module
