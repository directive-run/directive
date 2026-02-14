---
title: Migrating from Zustand
description: Step-by-step guide to migrate from Zustand to Directive with before/after comparisons.
---

Migrate your Zustand application to Directive. {% .lead %}

---

## Key Differences

| Zustand | Directive |
|---------|-----------|
| Store with set() | Facts (direct mutation) |
| Computed selectors | Derivations (auto-tracked) |
| Manual async | Constraints + Resolvers |
| Middleware | Plugins |

---

## Before: Zustand Store

```typescript
// Before: Zustand approach – state and actions live together in a store
import { create } from 'zustand';

// Define the shape: state + action methods bundled in one interface
interface CounterState {
  count: number;
  increment: () => void;
  decrement: () => void;
}

// Create a store with set() for immutable updates
const useCounter = create<CounterState>((set) => ({
  count: 0,

  // Each action must call set() and return a new state slice
  increment: () => set((state) => ({ count: state.count + 1 })),
  decrement: () => set((state) => ({ count: state.count - 1 })),
}));

// Usage – destructure state and actions from the hook
function Counter() {
  const { count, increment, decrement } = useCounter();

  return (
    <div>
      <p>{count}</p>
      <button onClick={decrement}>-</button>
      <button onClick={increment}>+</button>
    </div>
  );
}
```

## After: Directive

```typescript
// After: Directive approach – declare facts, mutate directly
import { createModule, createSystem, t } from 'directive';
import { useFact } from 'directive/react';

// Define a module with typed schema – no action methods needed
const counterModule = createModule("counter", {
  schema: {
    facts: { count: t.number() },
  },

  // Set initial values for all facts
  init: (facts) => {
    facts.count = 0;
  },
});

// Wire up the system and start the runtime
const system = createSystem({ module: counterModule });
system.start();

// Usage – subscribe to individual facts, mutate directly on system.facts
function Counter() {
  const count = useFact(system, "count");

  return (
    <div>
      <p>{count}</p>
      <button onClick={() => system.facts.count--}>-</button>
      <button onClick={() => system.facts.count++}>+</button>
    </div>
  );
}
```

---

## Migrating Async Actions

### Zustand Async

```typescript
// Before: Zustand async pattern – you manage loading/error states and trigger fetches manually
const useUser = create((set, get) => ({
  // State
  userId: 0,
  user: null,
  loading: false,
  error: null,

  // Action to update the userId
  setUserId: (id) => set({ userId: id }),

  // Async action – caller is responsible for invoking this at the right time
  fetchUser: async () => {
    const { userId } = get();
    if (!userId) {
      return;
    }

    // Manually toggle loading state before the request
    set({ loading: true, error: null });

    try {
      const user = await api.getUser(userId);
      set({ user, loading: false });
    } catch (error) {
      set({ error: error.message, loading: false });
    }
  },
}));

// Usage – must wire up useEffect to call fetchUser whenever userId changes
function UserProfile() {
  const { userId, user, loading, setUserId, fetchUser } = useUser();

  useEffect(() => {
    fetchUser();
  }, [userId]);
}
```

### Directive Constraints

```typescript
// After: Directive approach – declare when data is needed, let the runtime fetch it
const userModule = createModule("user", {
  schema: {
    facts: {
      userId: t.number(),
      user: t.object<User>().nullable(),
      loading: t.boolean(),
      error: t.string().nullable(),
    },
  },

  // Constraint declares WHAT must be true – no useEffect needed
  constraints: {
    needsUser: {
      // Fires automatically whenever this condition becomes true
      when: (facts) => facts.userId > 0 && !facts.user && !facts.loading,
      require: { type: "FETCH_USER" },
    },
  },

  // Resolver defines HOW to fulfill the requirement
  resolvers: {
    fetchUser: {
      requirement: "FETCH_USER",
      resolve: async (req, context) => {
        context.facts.loading = true;

        try {
          context.facts.user = await api.getUser(context.facts.userId);
        } catch (error) {
          context.facts.error = error.message;
        } finally {
          context.facts.loading = false;
        }
      },
    },
  },
});

// Usage – just set userId, the constraint triggers fetching automatically
function UserProfile() {
  const userId = useFact(system, "userId");
  const user = useFact(system, "user");

  // No useEffect, no manual fetch call – just mutate the fact
  const handleUserChange = (id) => {
    system.facts.userId = id;
  };
}
```

---

## Migrating Computed Values

### Zustand Selectors

```typescript
// Before: Zustand selectors – computed values recalculate on every render
const useCart = create((set) => ({
  items: [],
  addItem: (item) => set((s) => ({ items: [...s.items, item] })),
}));

// Selector runs the reduce on every render, even if items haven't changed
function CartTotal() {
  const total = useCart((state) =>
    state.items.reduce((sum, item) => sum + item.price, 0)
  );

  return <p>Total: ${total}</p>;
}
```

### Directive Derivations

```typescript
// After: Directive derivations – auto-tracked and cached, only recompute when deps change
const cartModule = createModule("cart", {
  schema: {
    facts: {
      items: t.array(t.object<CartItem>()),
    },
  },

  init: (facts) => {
    facts.items = [];
  },

  // Derivations automatically track which facts they read
  derive: {
    // Recomputes only when `items` changes – no manual memoization
    total: (facts) =>
      facts.items.reduce((sum, item) => sum + item.price, 0),

    itemCount: (facts) => facts.items.length,
  },
});

// Subscribe to a derived value – re-renders only when `total` changes
function CartTotal() {
  const total = useDerived(system, "total");

  return <p>Total: ${total}</p>;
}
```

---

## Migrating Middleware

### Zustand Middleware

```typescript
// Before: Zustand persist middleware – wrap the store creator in a HOF
import { persist } from 'zustand/middleware';

const useStore = create(
  // Middleware wraps the entire store definition
  persist(
    (set) => ({
      count: 0,
      increment: () => set((s) => ({ count: s.count + 1 })),
    }),
    { name: 'my-storage' }  // Storage key for localStorage
  )
);
```

### Directive Plugin

```typescript
// After: Directive plugin – pass plugins as config, no wrapping needed
import { persistencePlugin } from 'directive/plugins';

const system = createSystem({
  module: myModule,

  // Plugins are composable and declarative
  plugins: [
    persistencePlugin({
      key: 'my-storage',    // Same storage key concept
      storage: localStorage, // Choose your storage backend
    }),
  ],
});
```

---

## Side-by-Side Comparison

### Zustand

```typescript
// Before: Zustand – state, actions, and computed values in one store object
const useStore = create((set, get) => ({
  // State – plain values
  todos: [],
  filter: 'all',

  // Actions – each must call set() with new state
  addTodo: (text) => set((s) => ({
    todos: [...s.todos, { id: Date.now(), text, done: false }]
  })),

  toggleTodo: (id) => set((s) => ({
    todos: s.todos.map(t =>
      t.id === id ? { ...t, done: !t.done } : t
    )
  })),

  // Computed – not reactive, recalculates on every call via get()
  getFilteredTodos: () => {
    const { todos, filter } = get();
    if (filter === 'done') {
      return todos.filter(t => t.done);
    }

    if (filter === 'pending') {
      return todos.filter(t => !t.done);
    }

    return todos;
  },
}));
```

### Directive

```typescript
// After: Directive – facts for state, derivations for computed, plain functions for actions
const todoModule = createModule("todos", {
  // Typed schema defines the shape of your facts
  schema: {
    facts: {
      todos: t.array(t.object<Todo>()),
      filter: t.string<'all' | 'done' | 'pending'>(),
    },
  },

  init: (facts) => {
    facts.todos = [];
    facts.filter = 'all';
  },

  // Reactive derivations – auto-tracked, cached, recompute only when deps change
  derive: {
    filteredTodos: (facts) => {
      if (facts.filter === 'done') {
        return facts.todos.filter(t => t.done);
      }

      if (facts.filter === 'pending') {
        return facts.todos.filter(t => !t.done);
      }

      return facts.todos;
    },

    doneCount: (facts) => facts.todos.filter(t => t.done).length,
    pendingCount: (facts) => facts.todos.filter(t => !t.done).length,
  },
});

const system = createSystem({ module: todoModule });
system.start();

// Actions are just plain functions that mutate facts – no dispatch, no set()
function addTodo(text: string) {
  system.facts.todos = [
    ...system.facts.todos,
    { id: Date.now(), text, done: false }
  ];
}

function toggleTodo(id: number) {
  system.facts.todos = system.facts.todos.map(t =>
    t.id === id ? { ...t, done: !t.done } : t
  );
}
```

---

## Next Steps

- [Quick Start](/docs/quick-start) – Complete tutorial
- [Derivations](/docs/derivations) – Reactive computed values
- [React Adapter](/docs/adapters/react) – Hook patterns
