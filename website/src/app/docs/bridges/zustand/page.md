---
title: Zustand Bridge
description: Add constraint-driven orchestration to Zustand stores with middleware or two-way binding.
---

Use Directive WITH Zustand, not instead of it. Zustand handles your state. Directive adds constraints, requirement resolution, and coordination on top. {% .lead %}

---

## Installation

```bash
npm install directive zustand
```

Import from `directive/zustand`:

```typescript
import { createDirectiveMiddleware } from 'directive/zustand';
```

{% callout type="note" title="Renamed in v0.x" %}
`directiveMiddleware` has been renamed to `createDirectiveMiddleware`. The old name still works as a deprecated alias but will be removed in a future release. Update your imports to use `createDirectiveMiddleware`.
{% /callout %}

---

## Middleware Pattern

The primary integration is `createDirectiveMiddleware` — a standard Zustand middleware that wraps your store with Directive's constraint engine. Every `setState` call triggers constraint evaluation automatically.

```typescript
import { create } from 'zustand';
import { createDirectiveMiddleware } from 'directive/zustand';

interface TodoState {
  todos: Array<{ id: string; text: string; done: boolean }>;
  filter: 'all' | 'active' | 'done';
  synced: boolean;
  addTodo: (text: string) => void;
  toggleTodo: (id: string) => void;
}

const useTodoStore = create(
  createDirectiveMiddleware<TodoState>(
    (set, get) => ({
      todos: [],
      filter: 'all',
      synced: true,
      addTodo: (text) =>
        set((s) => ({
          todos: [...s.todos, { id: crypto.randomUUID(), text, done: false }],
          synced: false,
        })),
      toggleTodo: (id) =>
        set((s) => ({
          todos: s.todos.map((t) =>
            t.id === id ? { ...t, done: !t.done } : t
          ),
          synced: false,
        })),
    }),
    {
      constraints: {
        needsSync: {
          when: (state) => !state.synced && state.todos.length > 0,
          require: { type: 'SYNC_TODOS' },
        },
        tooManyOpen: {
          when: (state) => state.todos.filter((t) => !t.done).length > 50,
          require: { type: 'WARN_OVERLOAD' },
          priority: 100,
        },
      },
      resolvers: {
        syncTodos: {
          requirement: (req): req is { type: 'SYNC_TODOS' } =>
            req.type === 'SYNC_TODOS',
          resolve: async (req, { getState, setState, signal }) => {
            const response = await fetch('/api/todos', {
              method: 'POST',
              body: JSON.stringify(getState().todos),
              signal,
            });
            if (response.ok) {
              setState({ synced: true });
            }
          },
        },
        warnOverload: {
          requirement: (req): req is { type: 'WARN_OVERLOAD' } =>
            req.type === 'WARN_OVERLOAD',
          resolve: (req, { getState }) => {
            const open = getState().todos.filter((t) => !t.done).length;
            console.warn(`${open} open todos — consider completing some`);
          },
        },
      },
    }
  )
);
```

The store works exactly like any Zustand store. Call `addTodo()` or `toggleTodo()` and Directive evaluates constraints after each state change. If `synced` becomes `false`, the `needsSync` constraint fires and the resolver pushes data to the server.

---

## Middleware Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `constraints` | `Record<string, ZustandConstraint<T>>` | `{}` | Constraints evaluated against store state |
| `resolvers` | `Record<string, ZustandResolver<T, R>>` | `{}` | Resolvers that fulfill requirements |
| `onRequirementCreated` | `(req: Requirement) => void` | — | Called when a constraint produces a requirement |
| `onRequirementResolved` | `(req: Requirement) => void` | — | Called when a resolver completes |
| `autoStart` | `boolean` | `true` | Start the Directive engine immediately |
| `plugins` | `Plugin[]` | `[]` | Directive plugins (logging, devtools, etc.) |
| `debug` | `boolean` | `false` | Enable time-travel debugging |

---

## Constraints

A `ZustandConstraint<T>` receives your full Zustand state in `when` and produces a requirement when the condition is met:

```typescript
interface ZustandConstraint<T> {
  when: (state: T) => boolean | Promise<boolean>;
  require: Requirement | ((state: T) => Requirement);
  priority?: number;
}
```

The `require` field can be a static object or a function that derives the requirement from current state:

```typescript
constraints: {
  // Static requirement
  needsAuth: {
    when: (state) => !state.token,
    require: { type: 'AUTHENTICATE' },
  },

  // Dynamic requirement derived from state
  needsFetch: {
    when: (state) => state.userId > 0 && !state.profile,
    require: (state) => ({ type: 'FETCH_PROFILE', userId: state.userId }),
    priority: 50,
  },
}
```

Higher `priority` values are evaluated first. Default is `0`.

---

## Resolver Context

Resolvers receive a `ZustandResolverContext<T>` with full control over the store:

```typescript
interface ZustandResolverContext<T> {
  getState: () => T;                                        // Read current state
  setState: (partial: Partial<T> | ((s: T) => Partial<T>)) => void;  // Merge state
  replaceState: (state: T) => void;                         // Replace entire state
  signal: AbortSignal;                                      // Cancellation signal
}
```

Use `signal` to abort long-running operations when the store is destroyed or a new resolution supersedes the current one:

```typescript
resolvers: {
  fetchData: {
    requirement: (req): req is { type: 'FETCH_DATA' } =>
      req.type === 'FETCH_DATA',
    key: (req) => `fetch-data`,  // Deduplicate concurrent requests
    resolve: async (req, { setState, signal }) => {
      const res = await fetch('/api/data', { signal });
      const data = await res.json();
      setState({ data, loading: false });
    },
  },
}
```

The `key` function controls deduplication. Two requirements that produce the same key are treated as one, preventing duplicate in-flight resolutions.

---

## Two-Way Binding

If you already have a Zustand store and a separate Directive system, `bindZustandToDirective` creates a two-way sync between them without rewriting either:

```typescript
import { create } from 'zustand';
import { createModule, createSystem, t } from 'directive';
import { bindZustandToDirective } from 'directive/zustand';

// Existing Zustand store
const useAppStore = create((set) => ({
  count: 0,
  userName: 'guest',
  increment: () => set((s) => ({ count: s.count + 1 })),
}));

// Existing Directive system
const analyticsModule = createModule('analytics', {
  schema: {
    facts: {
      count: t.number(),
      userName: t.string(),
    },
  },
  init: (facts) => {
    facts.count = 0;
    facts.userName = 'guest';
  },
  constraints: {
    highUsage: {
      when: (facts) => facts.count > 1000,
      require: { type: 'ALERT_HIGH_USAGE' },
    },
  },
  resolvers: {
    alertHighUsage: {
      requirement: 'ALERT_HIGH_USAGE',
      resolve: async (req, ctx) => {
        await fetch('/api/alerts', {
          method: 'POST',
          body: JSON.stringify({ user: ctx.facts.userName }),
        });
      },
    },
  },
});

const system = createSystem({ module: analyticsModule });

// Bind them together
const { sync, unsync } = bindZustandToDirective(useAppStore, system, {
  toFacts: (state) => ({ count: state.count, userName: state.userName }),
  fromFacts: (facts) => ({ count: facts.count as number }),
  watchFacts: ['count'],
});

// Start syncing — initial Zustand state is pushed to Directive
sync();

// Later, stop syncing
unsync();
```

The `mapping` object controls the bridge:

| Property | Type | Description |
|----------|------|-------------|
| `toFacts` | `(state: T) => Partial<Record<string, unknown>>` | Map Zustand state to Directive facts |
| `fromFacts` | `(facts: Record<string, unknown>) => Partial<T>` | Map Directive facts back to Zustand state |
| `watchFacts` | `string[]` | Directive fact keys to watch (defaults to keys returned by `toFacts`) |

Changes flow both directions: Zustand `setState` calls update Directive facts, and Directive resolver mutations update Zustand state.

---

## Helper Utilities

### getDirectiveSystem

Extract the underlying Directive system from a middleware-enhanced store for inspection or manual control:

```typescript
import { getDirectiveSystem } from 'directive/zustand';

const system = getDirectiveSystem(useTodoStore);

// Inspect current state
console.log(system?.inspect());

// Manually trigger evaluation
await (useTodoStore as any).evaluate();
```

### subscribeToRequirements

Subscribe to the requirement lifecycle — useful for analytics, logging, or coordinating external systems:

```typescript
import { subscribeToRequirements } from 'directive/zustand';

const unsubscribe = subscribeToRequirements(useTodoStore, (req, event) => {
  if (event === 'created') {
    console.log('Requirement created:', req.type);
  } else if (event === 'resolved') {
    console.log('Requirement resolved:', req.type);
  } else if (event === 'canceled') {
    console.log('Requirement canceled:', req.type);
  }
});

// Stop listening
unsubscribe();
```

### createConstraint / createResolver

Type helpers for defining constraints and resolvers outside the middleware call. Useful when constraints are complex or shared across stores:

```typescript
import { createConstraint, createResolver } from 'directive/zustand';
import type { Requirement } from 'directive';

interface AppState {
  items: string[];
  synced: boolean;
}

interface SyncReq extends Requirement {
  type: 'SYNC_ITEMS';
  items: string[];
}

const syncConstraint = createConstraint<AppState>({
  when: (state) => !state.synced && state.items.length > 0,
  require: (state) => ({ type: 'SYNC_ITEMS', items: state.items }),
});

const syncResolver = createResolver<AppState, SyncReq>({
  requirement: (req): req is SyncReq => req.type === 'SYNC_ITEMS',
  key: () => 'sync-items',
  resolve: async (req, { setState, signal }) => {
    await fetch('/api/sync', {
      method: 'POST',
      body: JSON.stringify(req.items),
      signal,
    });
    setState({ synced: true });
  },
});

// Use them in middleware
const useStore = create(
  createDirectiveMiddleware<AppState>(
    (set) => ({ items: [], synced: true }),
    {
      constraints: { syncItems: syncConstraint },
      resolvers: { syncItems: syncResolver },
    }
  )
);
```

---

## Migration Strategy

Moving from plain Zustand to Directive-enhanced Zustand is incremental — you never need to rewrite your store.

1. **Add middleware** — Wrap your existing `create()` call with `createDirectiveMiddleware`. Your store keeps working unchanged.
2. **Identify implicit rules** — Find the scattered `if` checks and manual orchestration logic in your components or actions.
3. **Extract constraints** — Move those conditions into `constraints`. Each constraint declares one condition and one requirement.
4. **Add resolvers** — Implement the fulfillment logic that was previously buried in event handlers or effects.
5. **Remove manual orchestration** — Delete the `useEffect` chains, manual state checks, and orchestration code from your components.

The middleware approach means you can adopt Directive one constraint at a time. Existing actions, selectors, and component bindings are unaffected.

---

## Next Steps

- See [From Zustand](/docs/migration/from-zustand) for a full migration walkthrough
- See [Redux Bridge](/docs/bridges/redux) for Redux integration
- See [Constraints](/docs/constraints) for constraint patterns and best practices
- See [Resolvers](/docs/resolvers) for resolver configuration and retry policies
