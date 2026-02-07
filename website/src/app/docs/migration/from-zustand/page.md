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
// Zustand
import { create } from 'zustand';

interface CounterState {
  count: number;
  increment: () => void;
  decrement: () => void;
}

const useCounter = create<CounterState>((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
  decrement: () => set((state) => ({ count: state.count - 1 })),
}));

// Usage
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
// Directive
import { createModule, createSystem, t } from 'directive';
import { useFact, useSystem } from 'directive/react';

const counterModule = createModule("counter", {
  schema: {
    facts: { count: t.number() },
  },
  init: (facts) => {
    facts.count = 0;
  },
});

const system = createSystem({ module: counterModule });

// Usage
function Counter() {
  const count = useFact('count');
  const { facts } = useSystem();

  return (
    <div>
      <p>{count}</p>
      <button onClick={() => facts.count--}>-</button>
      <button onClick={() => facts.count++}>+</button>
    </div>
  );
}
```

---

## Migrating Async Actions

### Zustand Async

```typescript
// Zustand async pattern
const useUser = create((set, get) => ({
  userId: 0,
  user: null,
  loading: false,
  error: null,

  setUserId: (id) => set({ userId: id }),

  fetchUser: async () => {
    const { userId } = get();
    if (!userId) return;

    set({ loading: true, error: null });
    try {
      const user = await api.getUser(userId);
      set({ user, loading: false });
    } catch (error) {
      set({ error: error.message, loading: false });
    }
  },
}));

// Usage - must call fetchUser manually
function UserProfile() {
  const { userId, user, loading, setUserId, fetchUser } = useUser();

  useEffect(() => {
    fetchUser();
  }, [userId]);
}
```

### Directive Constraints

```typescript
// Directive - automatic data fetching
const userModule = createModule("user", {
  schema: {
    facts: {
      userId: t.number(),
      user: t.object<User>().nullable(),
      loading: t.boolean(),
      error: t.string().nullable(),
    },
  },
  // Constraint handles the "when to fetch" logic
  constraints: {
    needsUser: {
      when: (facts) => facts.userId > 0 && !facts.user && !facts.loading,
      require: { type: "FETCH_USER" },
    },
  },
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

// Usage - just set userId, fetching is automatic
function UserProfile() {
  const userId = useFact('userId');
  const user = useFact('user');
  const { facts } = useSystem();

  // Setting userId triggers constraint automatically
  const handleUserChange = (id) => {
    facts.userId = id;
  };
}
```

---

## Migrating Computed Values

### Zustand Selectors

```typescript
// Zustand - manual subscription optimization
const useCart = create((set) => ({
  items: [],
  addItem: (item) => set((s) => ({ items: [...s.items, item] })),
}));

// Computed via selector (runs on every render)
function CartTotal() {
  const total = useCart((state) =>
    state.items.reduce((sum, item) => sum + item.price, 0)
  );
  return <p>Total: ${total}</p>;
}
```

### Directive Derivations

```typescript
// Directive - auto-tracked, cached
const cartModule = createModule("cart", {
  schema: {
    facts: {
      items: t.array(t.object<CartItem>()),
    },
  },
  derive: {
    // Only recomputes when items change
    total: (facts) =>
      facts.items.reduce((sum, item) => sum + item.price, 0),
    itemCount: (facts) => facts.items.length,
  },
});

function CartTotal() {
  const total = useDerived('total');
  return <p>Total: ${total}</p>;
}
```

---

## Migrating Middleware

### Zustand Middleware

```typescript
// Zustand persist middleware
import { persist } from 'zustand/middleware';

const useStore = create(
  persist(
    (set) => ({
      count: 0,
      increment: () => set((s) => ({ count: s.count + 1 })),
    }),
    { name: 'my-storage' }
  )
);
```

### Directive Plugin

```typescript
// Directive persistence plugin
import { persistencePlugin } from 'directive/plugins';

const system = createSystem({
  module: myModule,
  plugins: [
    persistencePlugin({
      key: 'my-storage',
      storage: localStorage,
    }),
  ],
});
```

---

## Side-by-Side Comparison

### Zustand

```typescript
const useStore = create((set, get) => ({
  // State
  todos: [],
  filter: 'all',

  // Actions
  addTodo: (text) => set((s) => ({
    todos: [...s.todos, { id: Date.now(), text, done: false }]
  })),

  toggleTodo: (id) => set((s) => ({
    todos: s.todos.map(t =>
      t.id === id ? { ...t, done: !t.done } : t
    )
  })),

  // Computed (not reactive)
  getFilteredTodos: () => {
    const { todos, filter } = get();
    if (filter === 'done') return todos.filter(t => t.done);
    if (filter === 'pending') return todos.filter(t => !t.done);
    return todos;
  },
}));
```

### Directive

```typescript
const todoModule = createModule("todos", {
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
  // Reactive derivations
  derive: {
    filteredTodos: (facts) => {
      if (facts.filter === 'done') return facts.todos.filter(t => t.done);
      if (facts.filter === 'pending') return facts.todos.filter(t => !t.done);
      return facts.todos;
    },
    doneCount: (facts) => facts.todos.filter(t => t.done).length,
    pendingCount: (facts) => facts.todos.filter(t => !t.done).length,
  },
});

// Actions are just mutations
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

- See the Quick Start for a complete tutorial
- See Derivations for reactive computed values
- See the React Adapter for hook patterns
