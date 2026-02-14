---
title: Advanced Features
description: Multi-module composition, time-travel debugging, snapshots, SSR hydration, and error handling strategies.
---

Advanced features for production Directive applications – composition patterns, debugging tools, server rendering, and fault tolerance. {% .lead %}

---

## Features

| Feature | Page | When to Use |
|---------|------|------------|
| [Multi-Module](/docs/advanced/multi-module) | Compose multiple modules into one system | Apps with distinct domains (auth, cart, UI) |
| [Time-Travel](/docs/advanced/time-travel) | Step through state history, undo/redo | Debugging complex state transitions |
| [Snapshots](/docs/advanced/time-travel#snapshots) | Serialize, restore, and distribute system state | Persistence, sharing, migration |
| [SSR & Hydration](/docs/advanced/ssr) | Server-render Directive state, hydrate on client | Next.js, Remix, SvelteKit |
| [Error Handling](/docs/advanced/errors) | Error boundaries, retry policies, circuit breakers | Production resilience |

---

## Multi-Module Composition

Combine modules with namespaced access:

```typescript
import { createSystem } from '@directive-run/core';

// Compose multiple modules into a single system
const system = createSystem({
  modules: { auth: authModule, cart: cartModule },
});

// Each module's facts live under its namespace
system.facts.auth.user;
system.facts.cart.items;
```

---

## Time-Travel Debugging

Enable snapshots and navigate state history:

```typescript
// Enable time-travel with a snapshot history limit
const system = createSystem({
  module: myModule,
  debug: { timeTravel: true, maxSnapshots: 100 },
});

// Navigate backward and forward through state history
system.debug.goBack();    // Undo
system.debug.goForward(); // Redo
```

---

## Next Steps

- **Building a large app?** Start with [Multi-Module](/docs/advanced/multi-module)
- **Debugging issues?** See [Time-Travel](/docs/advanced/time-travel)
- **Going to production?** See [Error Handling](/docs/advanced/errors)
