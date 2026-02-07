---
title: Vue Adapter
description: Use Directive with Vue 3 composables for reactive state management.
---

Integrate Directive with Vue 3 using composables. {% .lead %}

---

## Installation

```bash
npm install directive
```

---

## Basic Usage

```typescript
import { createModule, createSystem, t } from 'directive';
import { ref, computed, watchEffect } from 'vue';

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

// Create reactive refs
export function useCounter() {
  const count = ref(system.facts.count);

  // Sync from Directive to Vue
  system.subscribe((facts) => {
    count.value = facts.count;
  });

  const increment = () => {
    system.facts.count++;
  };

  const decrement = () => {
    system.facts.count--;
  };

  return { count, increment, decrement };
}
```

---

## Composable Pattern

```typescript
// composables/useDirective.ts
import { ref, onUnmounted } from 'vue';

export function useFact<T>(system: System, key: string) {
  const value = ref<T>(system.facts[key]);

  const unsubscribe = system.subscribe((facts) => {
    value.value = facts[key];
  });

  onUnmounted(() => unsubscribe());

  return value;
}

export function useDerived<T>(system: System, key: string) {
  const value = ref<T>(system.derive[key]);

  const unsubscribe = system.subscribe((facts, derive) => {
    value.value = derive[key];
  });

  onUnmounted(() => unsubscribe());

  return value;
}
```

---

## Component Example

```vue
<script setup lang="ts">
import { useCounter } from './composables/useCounter';

const { count, increment, decrement } = useCounter();
</script>

<template>
  <div>
    <p>Count: {{ count }}</p>
    <button @click="decrement">-</button>
    <button @click="increment">+</button>
  </div>
</template>
```

---

## Pinia Integration

```typescript
import { defineStore } from 'pinia';
import { createSystem, createModule, t } from 'directive';

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

export const useUserStore = defineStore('user', {
  state: () => ({
    userId: system.facts.userId,
    user: system.facts.user,
  }),
  actions: {
    setUserId(id: number) {
      system.facts.userId = id;
    },
  },
});

// Sync Directive to Pinia
system.subscribe((facts) => {
  const store = useUserStore();
  store.$patch({
    userId: facts.userId,
    user: facts.user,
  });
});
```

---

## Next Steps

- See the React adapter for comparison
- Learn about Constraints for declarative logic
- Check the Counter example for a complete walkthrough
