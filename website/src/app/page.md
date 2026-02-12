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
  greeting: (facts, derive) => `Hello, ${derive.fullName}!` // Composition works too
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
    resolve: async (req, ctx) => { /* ... */ }
  }
}
```

### Time-Travel Debugging
Full state history. Go back, go forward, export, import.

```typescript
const system = createSystem({
  module: myModule,
  debug: { timeTravel: true, maxSnapshots: 100 }
});

system.debug.goBack();
system.debug.goForward();
```

### Framework Agnostic
First-class React support, with Vue, Svelte, Solid, and Lit adapters available.

```typescript
import { useFact, useDerived } from 'directive/react';

function UserProfile({ system }) {
  const user = useFact(system, 'user');
  const fullName = useDerived(system, 'fullName');
  // ...
}
```

---

## Get Started

```bash
npm install directive
```

Then check out the [Quick Start guide](/docs/quick-start) to build your first module.
