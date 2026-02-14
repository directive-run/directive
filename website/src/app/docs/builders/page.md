---
title: Builders
description: Fluent builder APIs for creating constraints, modules, and systems with TypeScript inference.
---

Fluent builder APIs for creating constraints, modules, and systems. Builders provide an ergonomic alternative to object literals with full TypeScript inference. {% .lead %}

---

## Constraint Builders

Two ways to build typed constraints outside of `createModule()`.

### `constraint()` – Full Builder

Chain `.when()`, `.require()`, optional fields, then `.build()`. All fields from `TypedConstraintDef` are supported.

```typescript
import { constraint } from 'directive';

const escalate = constraint<typeof schema>()
  .when(f => f.confidence < 0.7)
  .require({ type: 'ESCALATE' })
  .priority(50)
  .after('healthCheck')
  .deps('confidence')
  .timeout(5000)
  .async(true)
  .build();
```

The chain enforces order: `.when()` first, `.require()` second, then any optional methods, then `.build()`.

| Method | Required | Description |
|--------|----------|-------------|
| `.when(fn)` | Yes | Condition function – receives typed facts |
| `.require(value)` | Yes | Requirement(s), function, array, or `null` |
| `.priority(n)` | No | Higher runs first |
| `.after(...ids)` | No | Wait for other constraints' resolvers |
| `.deps(...keys)` | No | Explicit fact dependencies (required for async) |
| `.timeout(ms)` | No | Timeout for async evaluation |
| `.async(bool)` | No | Mark as async constraint |
| `.build()` | Yes | Returns `TypedConstraintDef<M>` |

### `when()` – Quick Shorthand

Returns a valid constraint directly – no `.build()` needed. Optional chaining via `with*` methods returns a new immutable constraint each time.

```typescript
import { when } from 'directive';

// Minimal – ready to use immediately
const pause = when<typeof schema>(f => f.errors > 3)
  .require({ type: 'PAUSE' });

// With options (immutable – each call returns a new constraint)
const halt = when<typeof schema>(f => f.errors > 10)
  .require({ type: 'HALT' })
  .withPriority(100)
  .withAfter('healthCheck');
```

| Method | Description |
|--------|-------------|
| `.require(value)` | Required – returns the constraint |
| `.withPriority(n)` | Returns new constraint with priority |
| `.withAfter(...ids)` | Returns new constraint with after deps |
| `.withDeps(...keys)` | Returns new constraint with explicit deps |
| `.withTimeout(ms)` | Returns new constraint with timeout |
| `.withAsync(bool)` | Returns new constraint marked async |

### `require` Accepts Multiple Forms

Both builders accept the same `require` values:

```typescript
// Static requirement
.require({ type: 'PAUSE' })

// Dynamic (function)
.require(f => ({ type: 'TRANSITION', to: f.phase === 'red' ? 'green' : 'red' }))

// Multiple requirements
.require([{ type: 'PAUSE' }, { type: 'ESCALATE' }])

// Suppress (no requirement even when condition matches)
.require(null)
```

### Using Builder Output in Modules

Builder output is a plain `TypedConstraintDef<M>` – drop it directly into `constraints`:

```typescript
const myConstraint = when<typeof schema>(f => f.errors > 3)
  .require({ type: 'PAUSE' })
  .withPriority(50);

const myModule = createModule('example', {
  schema,
  constraints: {
    pause: myConstraint,    // Works directly
    escalate: constraint<typeof schema>()
      .when(f => f.confidence < 0.5)
      .require({ type: 'ESCALATE' })
      .build(),             // Also works
  },
  // ...
});
```

---

## Module Builder

The `module()` builder provides a fluent alternative to `createModule()`.

```typescript
import { module, t } from 'directive';

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
import { system } from 'directive';

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

## Complete Examples

### Module with Constraint Builders

A full module definition using `when()` and `constraint()` for reusable, composable constraints.

```typescript
import { createModule, constraint, when, t } from 'directive';
import type { ModuleSchema } from 'directive';

const schema = {
  facts: {
    items: t.array<string>(),
    status: t.string<'idle' | 'loading' | 'error'>(),
    errorCount: t.number(),
    lastFetch: t.number(),
  },
  derivations: {
    isEmpty: t.boolean(),
    shouldRetry: t.boolean(),
  },
  events: {
    addItem: { item: t.string() },
    clearErrors: {},
  },
  requirements: {
    FETCH_ITEMS: {},
    PAUSE: {},
    ALERT: { message: t.string() },
  },
} satisfies ModuleSchema;

// Reusable constraints defined outside the module
const fetchWhenEmpty = when<typeof schema>(f => f.items.length === 0 && f.status === 'idle')
  .require({ type: 'FETCH_ITEMS' });

const pauseOnErrors = when<typeof schema>(f => f.errorCount > 3)
  .require({ type: 'PAUSE' })
  .withPriority(90);

const alertOnCritical = constraint<typeof schema>()
  .when(f => f.errorCount > 10)
  .require(f => ({ type: 'ALERT', message: `${f.errorCount} errors detected` }))
  .priority(100)
  .after('pauseOnErrors')
  .deps('errorCount')
  .build();

const itemsModule = createModule('items', {
  schema,
  init: (facts) => {
    facts.items = [];
    facts.status = 'idle';
    facts.errorCount = 0;
    facts.lastFetch = 0;
  },
  derive: {
    isEmpty: (facts) => facts.items.length === 0,
    shouldRetry: (facts) => facts.status === 'error' && facts.errorCount <= 3,
  },
  events: {
    addItem: (facts, { item }) => { facts.items = [...facts.items, item]; },
    clearErrors: (facts) => { facts.errorCount = 0; facts.status = 'idle'; },
  },
  // Mix builder-created and inline constraints
  constraints: {
    fetchWhenEmpty,
    pauseOnErrors,
    alertOnCritical,
    // Inline constraint (object literal) works alongside builders
    staleData: {
      when: (facts) => Date.now() - facts.lastFetch > 60_000,
      require: { type: 'FETCH_ITEMS' },
      priority: 10,
    },
  },
  resolvers: {
    fetchItems: {
      requirement: 'FETCH_ITEMS',
      retry: { attempts: 3, backoff: 'exponential', initialDelay: 500 },
      resolve: async (_req, ctx) => {
        ctx.facts.status = 'loading';
        // ... fetch logic
        ctx.facts.lastFetch = Date.now();
        ctx.facts.status = 'idle';
      },
    },
  },
});
```

### Full App with System Builder

Wire up multiple modules, plugins, and configuration using the `system()` builder.

```typescript
import { system, module, when, t } from 'directive';
import { loggingPlugin } from 'directive/plugins';
import type { ModuleSchema } from 'directive';

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

// Data module (using createModule + constraint builders)
const dataSchema = {
  facts: {
    users: t.array<{ id: string; name: string }>(),
    loaded: t.boolean(),
  },
  derivations: { userCount: t.number() },
  events: {},
  requirements: { LOAD_USERS: {} },
} satisfies ModuleSchema;

const loadWhenNeeded = when<typeof dataSchema>(f => !f.loaded)
  .require({ type: 'LOAD_USERS' });

const dataModule = createModule('data', {
  schema: dataSchema,
  init: (facts) => { facts.users = []; facts.loaded = false; },
  derive: { userCount: (facts) => facts.users.length },
  constraints: { loadWhenNeeded },
  resolvers: {
    loadUsers: {
      requirement: 'LOAD_USERS',
      resolve: async (_req, ctx) => {
        const res = await fetch('/api/users');
        ctx.facts.users = await res.json();
        ctx.facts.loaded = true;
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
| Reusable constraints shared across modules | `constraint()` or `when()` |
| Quick one-off constraint | `when()` shorthand |
| Constraint with many optional fields | `constraint()` full builder |
| Simple system setup | `createSystem()` |
| System with many options | `system()` builder |

Both approaches produce identical runtime output – builders are syntax sugar with type inference.

---

## Next Steps

- **[Constraints](/docs/constraints)** – How constraints drive the reconciliation loop
- **[Module & System](/docs/module-system)** – Full module and system API
- **[Glossary](/docs/glossary)** – All Directive terms defined
