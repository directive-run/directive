---
title: Core API Overview
description: Facts, derivations, constraints, resolvers, effects, and events – the building blocks of every Directive module.
---

The Core API is the foundation of every Directive application. Six primitives work together to express complex behavior declaratively. {% .lead %}

---

## Primitives

Directive has four core pillars (Facts, Derivations, Constraints, Resolvers) plus two supporting primitives (Effects, Events):

| Primitive | Role | Analogy |
|-----------|------|---------|
| [Facts](/docs/facts) | Observable state | Database rows |
| [Derivations](/docs/derivations) | Computed values from facts | SQL views |
| [Constraints](/docs/constraints) | Rules that must be true | Business rules |
| [Resolvers](/docs/resolvers) | How to fulfill requirements | API calls, side effects |
| [Effects](/docs/effects) | Fire-and-forget reactions | Logging, analytics |
| [Events](/docs/events) | External inputs | Button clicks, messages |

They compose inside a **module**, which is created and run as a **system**. See [Module & System](/docs/module-system) for how it all fits together.

---

## How They Relate

```
                                   ┌──────────────┐
              ┌───────────────────►│  Derivations │
              │                    └──────────────┘
              │
    ┌─────────┴─────────┐          ┌──────────────┐             ┌──────────────┐
    │       Facts       │─────────►│  Constraints │────────────►│  Resolvers   │
    └─────────┬─────────┘          └──────────────┘             └──────┬───────┘
              │                                                        │
              │                    ┌──────────────┐                    │
              └───────────────────►│   Effects    │      mutate facts ◄┘
                                   └──────────────┘
```

1. **Facts** hold state. When facts change, everything downstream re-evaluates.
2. **Derivations** are auto-tracked computed values – they re-run only when their dependencies change.
3. **Constraints** declare what _must_ be true. When a constraint's `when` condition is met, it emits a requirement.
4. **Resolvers** match requirements by type and execute async work to fulfill them.
5. **Effects** run whenever their dependencies change – for logging, analytics, or other side effects.
6. **Events** are typed dispatchers that mutate facts from the outside (UI, network, etc.).

---

## Quick Example

```typescript
import { createModule, createSystem, t } from '@directive-run/core';

// Define a counter module with typed schema, computed values, and events
const counter = createModule('counter', {
  // Declare the shape of all state and computed values up front
  schema: {
    facts: { count: t.number().default(0) },
    derivations: { doubled: t.number() },
    events: { increment: {}, decrement: {} },
    requirements: {},
  },

  // Set the initial state when the system starts
  init: (facts) => { facts.count = 0; },

  // Derivations auto-track their dependencies – no manual subscriptions
  derive: {
    doubled: (facts) => facts.count * 2,
  },

  // Events are typed dispatchers that mutate facts from the outside
  events: {
    increment: (facts) => { facts.count += 1; },
    decrement: (facts) => { facts.count -= 1; },
  },
});

// Wrap the module in a system to start the reconciliation loop
const system = createSystem({ module: counter });
system.start();

// Dispatch an event to increment, then read the derived value
system.events.increment();
console.log(system.read('doubled')); // 2
```

---

## Helpers & Constants

Beyond the six primitives, the core package exports several helpers:

| Export | Purpose |
|--------|---------|
| `t` | Schema type builders (`t.string()`, `t.number()`, `t.object<T>()`, etc.) |
| `req` / `forType` | Requirement construction helpers |
| `RequirementSet` | Set-like container for managing requirements |
| `Backoff` | Constants for retry backoff strategies (`Backoff.Exponential`, etc.) |
| `constraint` / `when` | Fluent constraint builders |
| `module` / `system` | Builder-pattern alternatives to `createModule` / `createSystem` |
| `isSingleModuleSystem` / `isNamespacedSystem` | Type guards for system mode |
| `constraintFactory` / `resolverFactory` | Factory helpers for typed cross-module constraints and resolvers |
| `DirectiveError` | Base error class for all Directive errors |

---

## Lower-Level APIs

For advanced use cases (custom tooling, framework adapters, testing infrastructure), the core package also exports the individual manager constructors that `createSystem` composes internally:

| Export | Purpose |
|--------|---------|
| `createFacts` / `createFactsStore` / `createFactsProxy` | Raw facts store and proxy creation |
| `createDerivationsManager` | Auto-tracked derivation layer |
| `createEffectsManager` | Side-effect scheduling |
| `createConstraintsManager` | Constraint evaluation engine |
| `createResolversManager` | Requirement resolution with retry and batching |
| `createPluginManager` | Plugin lifecycle management |
| `createErrorBoundaryManager` / `createRetryLaterManager` | Error handling and retry-later scheduling |
| `createTimeTravelManager` / `createDisabledTimeTravel` | Time-travel snapshot management |
| `createEngine` | The reconciliation loop that ties everything together |

Most applications should use `createModule` + `createSystem` instead. These lower-level APIs are useful when you need to compose your own system-like abstraction, build framework adapters, or write advanced test harnesses.

---

## Tracking Utilities

The dependency tracking system is also exported for custom derivation-like patterns:

| Export | Purpose |
|--------|---------|
| `withTracking(fn)` | Run a function while recording which facts it reads |
| `withoutTracking(fn)` | Run a function that reads facts without recording dependencies |
| `isTracking()` | Check whether dependency tracking is currently active |
| `getCurrentTracker` / `trackAccess` | Low-level tracker access for custom reactive primitives |

---

## Where to Start

- **New to Directive?** Start with [Facts](/docs/facts) to understand state, then [Derivations](/docs/derivations) for computed values.
- **Building features?** Jump to [Constraints](/docs/constraints) and [Resolvers](/docs/resolvers) for the declarative resolution loop.
- **Adding side effects?** See [Effects](/docs/effects) for fire-and-forget reactions.
- **Handling user input?** See [Events](/docs/events) for typed dispatchers.
- **Putting it all together?** See [Module & System](/docs/module-system).
