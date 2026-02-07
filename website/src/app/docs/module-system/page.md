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
| `module` | Single module to run |
| `modules` | Multiple modules (multi-module system) |
| `plugins` | Array of plugins |
| `debug` | Debug options |
| `onError` | Global error handler |

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

React to changes:

```typescript
const unsubscribe = system.subscribe((facts, derive) => {
  console.log('Facts changed:', facts);
});

// Later
unsubscribe();
```

### Events

Emit and listen to events:

```typescript
// Emit
system.emit({ type: 'USER_CLICKED', payload: { x: 100, y: 200 } });

// Listen
system.on('USER_CLICKED', (event) => {
  console.log('User clicked at:', event.payload);
});
```

### Snapshot

Get a snapshot of current state:

```typescript
const snapshot = system.snapshot();
// { facts: {...}, derive: {...}, timestamp: 1234567890 }
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
system.facts.cart.items.push(item);
```

See **[Multi-Module](/docs/advanced/multi-module)** for more details.

---

## Module Lifecycle

1. createModule creates the module definition
2. createSystem creates the runtime with the module
3. init function runs to set initial facts
4. System is ready - constraints start evaluating

When facts change, the reconciliation loop runs until all constraints are satisfied.

---

## Next Steps

- **[Facts](/docs/facts)** - State management
- **[Constraints](/docs/constraints)** - Declarative rules
- **[Resolvers](/docs/resolvers)** - Async handling
