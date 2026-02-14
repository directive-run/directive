---
title: Core API Overview
description: Facts, derivations, constraints, resolvers, effects, and events – the building blocks of every Directive module.
---

The Core API is the foundation of every Directive application. Six primitives work together to express complex behavior declaratively. {% .lead %}

---

## The Six Primitives

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
Events → mutate Facts → trigger Derivations
                      → evaluate Constraints → emit Requirements → Resolvers fulfill them
                      → fire Effects (side-effects)
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

## Where to Start

- **New to Directive?** Start with [Facts](/docs/facts) to understand state, then [Derivations](/docs/derivations) for computed values.
- **Building features?** Jump to [Constraints](/docs/constraints) and [Resolvers](/docs/resolvers) for the declarative resolution loop.
- **Adding side effects?** See [Effects](/docs/effects) for fire-and-forget reactions.
- **Handling user input?** See [Events](/docs/events) for typed dispatchers.
- **Putting it all together?** See [Module & System](/docs/module-system).
