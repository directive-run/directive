---
title: Directive - Constraint-Driven State Management
description: Declare what must be true. Define how to make it true. Let Directive handle when and how to orchestrate it all.
---

{% quick-links %}

{% quick-link title="Quick Start" icon="installation" href="/docs/quick-start" description="Build your first Directive module in 5 minutes. Learn the constraint-resolver pattern." /%}

{% quick-link title="Core Concepts" icon="presets" href="/docs/core-concepts" description="Understand facts, derivations, constraints, and resolvers - the building blocks of Directive." /%}

{% quick-link title="Examples" icon="plugins" href="/docs/examples/counter" description="Real-world patterns: data fetching, forms, multi-module apps, and AI agents." /%}

{% quick-link title="Framework Adapters" icon="theming" href="/docs/adapters/overview" description="First-class hooks for React, Vue, Svelte, Solid, and Lit." /%}

{% /quick-links %}

---

## Try It in 30 Seconds

```bash
npm install @directive-run/core
```

```typescript
import { createModule, createSystem, t } from '@directive-run/core';

const counter = createModule("counter", {
  schema: { count: t.number() },
  init: (facts) => { facts.count = 0; },

  constraints: {
    tooLow: {
      when: (facts) => facts.count < 1,
      require: { type: "INCREMENT" },
    },
  },

  resolvers: {
    increment: {
      requirement: "INCREMENT",
      resolve: (req, context) => { context.facts.count += 1; },
    },
  },
});

const system = createSystem({ module: counter });
system.start();
console.log(system.facts.count); // 1
```

The constraint detected `count < 1`, emitted a requirement, and the resolver fulfilled it &ndash; automatically.

---

## Why Directive?

Traditional state management focuses on **how** state changes. You write reducers, actions, sagas, and thunks - all describing the mechanics of state transitions.

Directive flips this around. You declare **what must be true**, and let the runtime figure out **how** and **when** to make it happen.

```typescript
// Traditional: describe how to change state
dispatch({ type: 'FETCH_USER', id: 123 })
dispatch({ type: 'FETCH_USER_SUCCESS', user })

// Directive: declare what must be true
constraints: {
  needsUser: {
    when: (facts) => facts.userId > 0 && !facts.user,
    require: { type: "FETCH_USER" }
  }
}
```

---

## Key Features

### Auto-Tracking Derivations
No manual dependency arrays. Just access what you need - Directive tracks it automatically.

```typescript
derive: {
  fullName: (facts) => `${facts.firstName} ${facts.lastName}`,
  greeting: (facts, derived) => `Hello, ${derived.fullName}!` // Composition works too
}
```

### Built-in Resilience
Retry policies, timeouts, and error boundaries out of the box.

```typescript
resolvers: {
  fetchUser: {
    requirement: "FETCH_USER",
    retry: { attempts: 3, backoff: "exponential" },
    timeout: 5000,
    resolve: async (req, context) => { /* ... */ }
  }
}
```

### Time-Travel Debugging
Full state history. Go back, go forward, export, import.

```typescript
const system = createSystem({
  module: myModule,
  history: true,
});

system.history.goBack();
system.history.goForward();
```

### Framework Agnostic
First-class React support, with Vue, Svelte, Solid, and Lit adapters available.

```typescript
import { useFact, useDerived } from '@directive-run/react';

function UserProfile({ system }) {
  const user = useFact(system, 'user');
  const fullName = useDerived(system, 'fullName');
  // ...
}
```

---

## Built with Directive

{% use-case-cards /%}

---

## Get Started

```bash
npm install @directive-run/core
```

Then check out the [Quick Start guide](/docs/quick-start) to build your first module.
