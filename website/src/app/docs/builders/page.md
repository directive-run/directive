---
title: Builders & Helpers
description: Fluent builder APIs for modules and systems, plus factory helpers for typed definitions.
---

Fluent builder APIs for modules and systems, plus factory helpers for typed constraints and resolvers. Builders provide an ergonomic alternative to object literals with full TypeScript inference. {% .lead %}

---

## Constraints as Object Literals

Constraints, resolvers, and effects are defined as plain object literals inside `createModule()`. TypeScript provides full type inference on the object literal – no builder functions needed:

```typescript
const myModule = createModule("example", {
  schema,
  constraints: {
    needsData: {
      when: (facts) => !facts.data,
      require: { type: "FETCH_DATA" },
      priority: 50,
    },
  },
});
```

For reusable typed constraints outside of `createModule()`, use the [factory helpers](/docs/api/core#constraintfactory) (`constraintFactory`, `typedConstraint`) documented in the Core API.

---

## Module Builder

The `module()` builder provides a fluent alternative to `createModule()`.

```typescript
import { module, t } from '@directive-run/core';

const counter = module('counter')
  .schema({
    facts: { count: t.number(), name: t.string() },
    derivations: { doubled: t.number() },
    events: { increment: {}, decrement: {} },
    requirements: {},
  })
  .init(facts => {
    facts.count = 0;
    facts.name = 'counter';
  })
  .derive({
    doubled: facts => facts.count * 2,
  })
  .events({
    increment: facts => { facts.count++; },
    decrement: facts => { facts.count--; },
  })
  .build();
```

All methods are optional except `.schema()` and `.build()`. The builder validates that all declared derivations and events have implementations.

---

## System Builder

The `system()` builder provides a fluent alternative to `createSystem()`.

### Single Module

```typescript
import { system } from '@directive-run/core';

const sys = system()
  .module(counterModule)
  .plugins([loggingPlugin()])
  .debug({ timeTravel: true })
  .initialFacts({ count: 10 })
  .build();

sys.start();
```

### Multiple Modules (Namespaced)

```typescript
const sys = system()
  .modules({ auth: authModule, cart: cartModule })
  .plugins([loggingPlugin()])
  .errorBoundary({ onResolverError: 'retry' })
  .initOrder('auto')
  .build();

sys.start();
```

Calling `.module()` or `.modules()` narrows the builder type – you can't mix them.

| Method | Single | Namespaced | Description |
|--------|--------|------------|-------------|
| `.module(mod)` | Yes | – | Single module, direct access |
| `.modules({ ... })` | – | Yes | Object of modules, namespaced access |
| `.plugins([...])` | Yes | Yes | Register plugins |
| `.debug({...})` | Yes | Yes | Debug/time-travel config |
| `.errorBoundary({...})` | Yes | Yes | Error recovery strategies |
| `.tickMs(n)` | Yes | Yes | Tick interval (ms) |
| `.zeroConfig()` | Yes | Yes | Sensible defaults for dev |
| `.initialFacts({...})` | Yes | Yes | Facts to set after init |
| `.initOrder(order)` | – | Yes | Module initialization order |
| `.build()` | Yes | Yes | Creates the system |

---

## Complete Example

Wire up multiple modules, plugins, and configuration using the `system()` and `module()` builders.

```typescript
import { system, module, createModule, t } from '@directive-run/core';
import { loggingPlugin } from '@directive-run/core/plugins';
import type { ModuleSchema } from '@directive-run/core';

// Auth module (using module builder)
const authModule = module('auth')
  .schema({
    facts: { token: t.string(), role: t.string<'guest' | 'user' | 'admin'>() },
    derivations: { isAuthenticated: t.boolean() },
    events: {
      login: { token: t.string(), role: t.string() },
      logout: {},
    },
    requirements: {},
  } satisfies ModuleSchema)
  .init(facts => {
    facts.token = '';
    facts.role = 'guest';
  })
  .derive({
    isAuthenticated: (facts) => facts.token !== '',
  })
  .events({
    login: (facts, { token, role }) => {
      facts.token = token;
      facts.role = role as 'guest' | 'user' | 'admin';
    },
    logout: (facts) => {
      facts.token = '';
      facts.role = 'guest';
    },
  })
  .build();

// Data module (using createModule with object literal constraints)
const dataSchema = {
  facts: {
    users: t.array<{ id: string; name: string }>(),
    loaded: t.boolean(),
  },
  derivations: { userCount: t.number() },
  events: {},
  requirements: { LOAD_USERS: {} },
} satisfies ModuleSchema;

const dataModule = createModule('data', {
  schema: dataSchema,
  init: (facts) => { facts.users = []; facts.loaded = false; },
  derive: { userCount: (facts) => facts.users.length },
  constraints: {
    loadWhenNeeded: {
      when: (facts) => !facts.loaded,
      require: { type: 'LOAD_USERS' },
    },
  },
  resolvers: {
    loadUsers: {
      requirement: 'LOAD_USERS',
      resolve: async (_req, context) => {
        const res = await fetch('/api/users');
        if (!res.ok) {
          throw new Error(`Failed to load users: ${res.status}`);
        }

        context.facts.users = await res.json();
        context.facts.loaded = true;
      },
    },
  },
});

// System builder wires everything together
const app = system()
  .modules({ auth: authModule, data: dataModule })
  .plugins([loggingPlugin()])
  .debug({ timeTravel: true, maxSnapshots: 50 })
  .errorBoundary({ onResolverError: 'retry' })
  .zeroConfig()
  .initialFacts({
    auth: { token: 'restored-token', role: 'user' },
  })
  .build();

app.start();

// Namespaced access
app.facts.auth.token;           // 'restored-token'
app.derive.data.userCount;      // 0 (until resolver completes)
app.events.auth.logout();       // dispatch logout event
```

---

## When to Use Builders vs Object Literals

| Scenario | Recommended |
|----------|-------------|
| Inline constraints in `createModule()` | Object literals |
| Reusable typed constraints shared across modules | `constraintFactory()` or `typedConstraint()` |
| Simple system setup | `createSystem()` |
| System with many options | `system()` builder |

Both approaches produce identical runtime output – builders are syntax sugar with type inference.

---

## Next Steps

- **[Constraints](/docs/constraints)** – How constraints drive the reconciliation loop
- **[Module & System](/docs/module-system)** – Full module and system API
- **[Core API](/docs/core-api)** – Full API overview
