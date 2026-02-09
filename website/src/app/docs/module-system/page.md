---
title: Module & System
description: Learn how to create modules and systems in Directive - the building blocks of your application.
---

Modules encapsulate state and logic. Systems run modules and provide the runtime. {% .lead %}

---

## Creating a Module

A module is created with `createModule`:

```typescript
import { createModule, t } from 'directive';

const counterModule = createModule("counter", {
  schema: {
    facts: {
      count: t.number(),
    },
    derivations: {},
    events: {},
    requirements: {},
  },
  init: (facts) => {
    facts.count = 0;
  },
});
```

### Module Options

| Option | Description |
|--------|-------------|
| `schema` | Type definitions for facts, derivations, events, requirements |
| `init` | Initialize facts with default values |
| `derive` | Computed values |
| `constraints` | Rules that generate requirements |
| `resolvers` | Functions that fulfill requirements |
| `effects` | Side effects that run on changes |

---

## Creating a System

A system runs one or more modules:

```typescript
import { createSystem } from 'directive';

// Single module
const system = createSystem({ module: counterModule });

// With plugins
const system = createSystem({
  module: counterModule,
  plugins: [loggingPlugin(), devtoolsPlugin()],
  debug: { timeTravel: true },
});
```

### System Options

| Option | Description |
|--------|-------------|
| `module` | Single module to run (direct access) |
| `modules` | Multiple modules as `{ name: module }` (namespaced access) |
| `plugins` | Array of plugins |
| `debug` | Debug options (`{ timeTravel, maxSnapshots }`) |
| `errorBoundary` | Error handling strategies per subsystem |
| `initialFacts` | Override initial fact values |
| `zeroConfig` | Enable sensible defaults for dev mode |

---

## System API

### Facts

Read and write facts directly:

```typescript
// Read
const count = system.facts.count;

// Write (triggers reconciliation)
system.facts.count = 10;

// Batch updates
system.batch(() => {
  system.facts.count = 10;
  system.facts.loading = true;
});
```

### Derivations

Access computed values:

```typescript
const doubled = system.derive.doubled;
```

### Settle

Wait for all resolvers to complete:

```typescript
system.facts.userId = 123;
await system.settle();
// All async work is done
```

### Subscribe

React to derivation changes:

```typescript
// Subscribe to specific derivations
const unsubscribe = system.subscribe(["displayName", "isLoggedIn"], () => {
  console.log('Derivation changed:', system.derive.displayName);
});

// Watch a single derivation with values
const unsub2 = system.watch("displayName", (newValue, prevValue) => {
  console.log(`Changed from "${prevValue}" to "${newValue}"`);
});

// Later
unsubscribe();
unsub2();
```

### Events

Dispatch events to update facts:

```typescript
// Via typed accessor (preferred)
system.events.increment();
system.events.setUser({ user: newUser });

// Via dispatch
system.dispatch({ type: "increment" });
system.dispatch({ type: "setUser", user: newUser });
```

Events are defined in the module and handler functions update facts:

```typescript
events: {
  increment: (facts) => { facts.count += 1; },
  setUser: (facts, { user }) => { facts.user = user; },
},
```

### Snapshot

Get a snapshot of current state:

```typescript
const snapshot = system.getSnapshot();
// { facts: { userId: 123, user: {...} }, version: 1 }
```

### Restore

Restore from a snapshot:

```typescript
system.restore(snapshot);
```

---

## Multi-Module Systems

For larger apps, compose multiple modules:

```typescript
const system = createSystem({
  modules: {
    user: userModule,
    cart: cartModule,
    checkout: checkoutModule,
  },
});

// Access with namespace
system.facts.user.userId = 123;
system.facts.cart.items = [...system.facts.cart.items, item];
```

See **[Multi-Module](/docs/advanced/multi-module)** for more details.

---

## Module Lifecycle

1. `createModule()` creates the module definition
2. `createSystem()` creates the runtime with the module (plugins initialized)
3. `system.start()` runs the `init` function, applies `initialFacts`/`hydrate`, then triggers the first reconciliation
4. Constraints evaluate, requirements are generated, resolvers execute
5. System settles when all requirements are fulfilled

When facts change, the reconciliation loop runs until all constraints are satisfied.

---

## Next Steps

- **[Facts](/docs/facts)** - State management
- **[Constraints](/docs/constraints)** - Declarative rules
- **[Resolvers](/docs/resolvers)** - Async handling
