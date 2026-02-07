---
title: Svelte Adapter
description: Use Directive with Svelte stores for reactive state management.
---

Integrate Directive with Svelte using custom stores. {% .lead %}

---

## Installation

```bash
npm install directive
```

---

## Basic Usage

```typescript
import { createModule, createSystem, t } from 'directive';
import { writable, derived } from 'svelte/store';

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

// Create Svelte store from Directive
function createDirectiveStore() {
  const { subscribe, set } = writable(system.facts.count);

  system.subscribe((facts) => {
    set(facts.count);
  });

  return {
    subscribe,
    increment: () => system.facts.count++,
    decrement: () => system.facts.count--,
  };
}

export const counter = createDirectiveStore();
```

---

## Store Factory

```typescript
// stores/directive.ts
import { readable } from 'svelte/store';

export function createFactStore<T>(system: System, key: string) {
  return readable<T>(system.facts[key], (set) => {
    const unsubscribe = system.subscribe((facts) => {
      set(facts[key]);
    });
    return unsubscribe;
  });
}

export function createDeriveStore<T>(system: System, key: string) {
  return readable<T>(system.derive[key], (set) => {
    const unsubscribe = system.subscribe((facts, derive) => {
      set(derive[key]);
    });
    return unsubscribe;
  });
}
```

---

## Component Example

```svelte
<script>
  import { counter } from './stores/counter';
</script>

<div>
  <p>Count: {$counter}</p>
  <button on:click={counter.decrement}>-</button>
  <button on:click={counter.increment}>+</button>
</div>
```

---

## With Constraints

```typescript
import { createModule, createSystem, t } from 'directive';
import { readable, writable } from 'svelte/store';

const userModule = createModule("user", {
  schema: {
    facts: {
      userId: t.number(),
      user: t.object<User>().nullable(),
      loading: t.boolean(),
    },
  },
  init: (facts) => {
    facts.userId = 0;
    facts.user = null;
    facts.loading = false;
  },
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
        context.facts.user = await api.getUser(context.facts.userId);
        context.facts.loading = false;
      },
    },
  },
});

const system = createSystem({ module: userModule });

// Stores
export const userId = writable(0);
export const user = readable(null, (set) => {
  return system.subscribe((facts) => set(facts.user));
});
export const loading = readable(false, (set) => {
  return system.subscribe((facts) => set(facts.loading));
});

// Sync writable to Directive
userId.subscribe((value) => {
  system.facts.userId = value;
});
```

---

## SvelteKit Integration

```typescript
// src/lib/directive.ts
import { browser } from '$app/environment';

export function createClientSystem() {
  if (!browser) return null;

  const system = createSystem({ module: myModule });
  return system;
}

// src/routes/+page.svelte
<script>
  import { onMount } from 'svelte';
  import { createClientSystem } from '$lib/directive';

  let system;
  onMount(() => {
    system = createClientSystem();
  });
</script>
```

---

## Next Steps

- See the React adapter for comparison
- Learn about Constraints for declarative logic
- Check the Counter example for a complete walkthrough
