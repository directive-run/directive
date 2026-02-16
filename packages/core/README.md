# @directive-run/core

[![npm](https://img.shields.io/npm/v/@directive-run/core?color=%236366f1)](https://www.npmjs.com/package/@directive-run/core)
[![downloads](https://img.shields.io/npm/dm/@directive-run/core)](https://www.npmjs.com/package/@directive-run/core)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@directive-run/core)](https://bundlephobia.com/package/@directive-run/core)
[![CI](https://img.shields.io/github/actions/workflow/status/directive-run/directive/ci.yml?branch=main&label=CI)](https://github.com/directive-run/directive/actions)
[![license](https://img.shields.io/npm/l/@directive-run/core)](https://github.com/directive-run/directive/blob/main/LICENSE)

Constraint-driven runtime for TypeScript. Declare requirements, let the runtime resolve them.

- **Auto-tracking derivations** &ndash; computed values that track their own dependencies, no manual dep arrays
- **Typed constraint/resolver cycle** &ndash; constraints declare what must be true, resolvers make it true
- **Events** &ndash; typed event handlers with payloads for imperative actions
- **Plugin architecture** &ndash; logging, devtools, persistence, and custom lifecycle hooks
- **Framework adapters** &ndash; first-class bindings for React, Vue, Svelte, Solid, and Lit

## Install

```bash
npm install @directive-run/core
```

## Quick Start

```typescript
import { createModule, createSystem, t } from "@directive-run/core";

const counter = createModule("counter", {
  schema: {
    facts: { count: t.number() },
    derivations: { doubled: t.number() },
    events: { increment: {}, reset: {} },
    requirements: {},
  },

  init: (facts) => {
    facts.count = 0;
  },

  derive: {
    doubled: (facts) => facts.count * 2,
  },

  events: {
    increment: (facts) => {
      facts.count += 1;
    },
    reset: (facts) => {
      facts.count = 0;
    },
  },
});

const system = createSystem({ module: counter });
system.start();

system.events.increment();
console.log(system.facts.count);     // 1
console.log(system.read("doubled")); // 2
```

## Derived State

Derivations auto-track which facts they read. No dependency arrays, no manual subscriptions. Derivations can depend on other derivations for composition:

```typescript
const app = createModule("app", {
  schema: {
    facts: { items: t.array<string>(), filter: t.string() },
    derivations: {
      filtered: t.array<string>(),
      count: t.number(),
      summary: t.string(),
    },
    events: {},
    requirements: {},
  },

  init: (facts) => {
    facts.items = ["apple", "banana", "avocado"];
    facts.filter = "a";
  },

  derive: {
    filtered: (facts) => facts.items.filter((i) => i.startsWith(facts.filter)),
    count: (_facts, derive) => derive.filtered.length,
    summary: (_facts, derive) => `${derive.count} items match`,
  },
});
```

## Constraints and Resolvers

The constraint/resolver cycle is the core of Directive. Constraints declare _what_ must be true. Resolvers declare _how_ to make it true. The runtime connects them automatically.

```typescript
import { createModule, createSystem, t } from "@directive-run/core";

const userModule = createModule("user", {
  schema: {
    facts: {
      userId: t.string().nullable(),
      profile: t.object<{ name: string }>().nullable(),
    },
    derivations: {},
    events: { login: { userId: t.string() } },
    requirements: { FETCH_PROFILE: { userId: t.string() } },
  },

  init: (facts) => {
    facts.userId = null;
    facts.profile = null;
  },

  events: {
    login: (facts, payload) => {
      facts.userId = payload.userId;
    },
  },

  constraints: {
    needsProfile: {
      when: (facts) => facts.userId !== null && facts.profile === null,
      require: (facts) => ({ type: "FETCH_PROFILE", userId: facts.userId! }),
    },
  },

  resolvers: {
    fetchProfile: {
      requirement: "FETCH_PROFILE",
      retry: { attempts: 3, backoff: "exponential" },
      resolve: async (req, context) => {
        const res = await fetch(`/api/users/${req.userId}`);
        context.facts.profile = await res.json();
      },
    },
  },
});

const system = createSystem({ module: userModule });
system.start();

// Dispatching login sets userId, which triggers the constraint,
// which emits the requirement, which the resolver fulfills automatically.
system.events.login({ userId: "u-123" });
```

## Events

Events provide typed imperative actions with payloads. Define them in your schema and handle them with `events`:

```typescript
events: {
  addItem: (facts, payload: { name: string; price: number }) => {
    facts.items = [...facts.items, { name: payload.name, price: payload.price }];
  },
  removeItem: (facts, payload: { id: string }) => {
    facts.items = facts.items.filter((i) => i.id !== payload.id);
  },
},

// Typed and autocompleted:
system.events.addItem({ name: "Widget", price: 9.99 });
```

## Framework Adapters

| Package | Framework | Reactivity Model |
|---------|-----------|-----------------|
| [`@directive-run/react`](https://www.npmjs.com/package/@directive-run/react) | React 18+ | `useSyncExternalStore` hooks |
| [`@directive-run/vue`](https://www.npmjs.com/package/@directive-run/vue) | Vue 3+ | `Ref` / `ShallowRef` composables |
| [`@directive-run/svelte`](https://www.npmjs.com/package/@directive-run/svelte) | Svelte 4+ | `Readable` stores |
| [`@directive-run/solid`](https://www.npmjs.com/package/@directive-run/solid) | Solid.js 1+ | `Accessor` signals |
| [`@directive-run/lit`](https://www.npmjs.com/package/@directive-run/lit) | Lit 3+ | `ReactiveController` classes |

## Subpath Exports

| Import | Purpose |
|--------|---------|
| `@directive-run/core` | Core runtime &ndash; modules, systems, schema types |
| `@directive-run/core/plugins` | Logging, devtools, persistence, observability, circuit breaker |
| `@directive-run/core/testing` | Mock resolvers, fake timers, assertion helpers |
| `@directive-run/core/migration` | Redux/Zustand/XState migration helpers |
| `@directive-run/core/worker` | Web Worker support |

## Why Directive?

- **Declarative over imperative** &ndash; describe what your system needs, not how to wire it up. Constraints and resolvers replace manual data-fetching orchestration.
- **Auto-tracking over manual subscriptions** &ndash; derivations detect their own dependencies at runtime. No selector functions, no dependency arrays, no stale closures.
- **Constraint-driven over event-driven** &ndash; instead of chaining events to coordinate async work, declare constraints that the runtime satisfies automatically with retry, batching, and error boundaries.
- **Framework-agnostic core** &ndash; one state layer, five framework adapters. Move between React, Vue, Svelte, Solid, and Lit without rewriting your state logic.

## Documentation

- [Getting Started](https://directive.run/docs/getting-started)
- [API Reference](https://directive.run/docs/api)
- [GitHub](https://github.com/directive-run/directive)

## License

MIT
