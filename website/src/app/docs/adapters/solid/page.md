---
title: Solid Adapter
description: Use Directive with Solid signals for reactive state management.
---

Integrate Directive with Solid using signals. {% .lead %}

---

## Installation

```bash
npm install directive
```

---

## Basic Usage

```typescript
import { createModule, createSystem, t } from 'directive';
import { createSignal, createEffect, onCleanup } from 'solid-js';

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

const system = createSystem({ module: counterModule });

export function useCounter() {
  const [count, setCount] = createSignal(system.facts.count);

  createEffect(() => {
    const unsubscribe = system.subscribe((facts) => {
      setCount(facts.count);
    });
    onCleanup(unsubscribe);
  });

  const increment = () => system.facts.count++;
  const decrement = () => system.facts.count--;

  return { count, increment, decrement };
}
```

---

## Signal Factory

```typescript
// lib/directive.ts
import { createSignal, onCleanup } from 'solid-js';

export function createFactSignal<T>(system: System, key: string) {
  const [value, setValue] = createSignal<T>(system.facts[key]);

  const unsubscribe = system.subscribe((facts) => {
    setValue(() => facts[key]);
  });

  onCleanup(unsubscribe);

  return value;
}

export function createDeriveSignal<T>(system: System, key: string) {
  const [value, setValue] = createSignal<T>(system.derive[key]);

  const unsubscribe = system.subscribe((facts, derive) => {
    setValue(() => derive[key]);
  });

  onCleanup(unsubscribe);

  return value;
}
```

---

## Component Example

```tsx
import { useCounter } from './lib/counter';

export function Counter() {
  const { count, increment, decrement } = useCounter();

  return (
    <div>
      <p>Count: {count()}</p>
      <button onClick={decrement}>-</button>
      <button onClick={increment}>+</button>
    </div>
  );
}
```

---

## With Resources

```typescript
import { createResource } from 'solid-js';
import { createModule, createSystem, t } from 'directive';

const userModule = createModule("user", {
  schema: {
    facts: {
      userId: t.number(),
      user: t.object<User>().nullable(),
    },
  },
  constraints: {
    needsUser: {
      when: (facts) => facts.userId > 0 && !facts.user,
      require: { type: "FETCH_USER" },
    },
  },
  resolvers: {
    fetchUser: {
      requirement: "FETCH_USER",
      resolve: async (req, context) => {
        context.facts.user = await api.getUser(context.facts.userId);
      },
    },
  },
});

const system = createSystem({ module: userModule });

export function useUser() {
  const [userId, setUserId] = createSignal(0);

  // Sync signal to Directive
  createEffect(() => {
    system.facts.userId = userId();
  });

  // Get user from Directive
  const user = createFactSignal(system, 'user');

  return { userId, setUserId, user };
}
```

---

## SolidStart Integration

```typescript
// src/lib/directive.ts
import { isServer } from 'solid-js/web';

export function createClientSystem() {
  if (isServer) return null;

  const system = createSystem({ module: myModule });
  return system;
}
```

---

## Next Steps

- See the React adapter for comparison
- Learn about Constraints for declarative logic
- Check the Counter example for a complete walkthrough
