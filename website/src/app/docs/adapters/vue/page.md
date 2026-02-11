---
title: Vue Adapter
description: Integrate Directive with Vue 3 using composables for reactive state management. useFact, useDerived, useEvents, useDispatch, useInspect, and more.
---

Directive provides first-class Vue 3 integration with composables that automatically update on state changes. {% .lead %}

---

## Installation

The Vue adapter is included in the main package:

```typescript
import { createDirectivePlugin, useFact, useDerived, useEvents, useDispatch } from 'directive/vue';
```

---

## Setup

Install the Directive plugin on your Vue app:

```typescript
import { createApp } from 'vue';
import { createModule, createSystem, t } from 'directive';
import { createDirectivePlugin } from 'directive/vue';

const userModule = createModule("user", {
  schema: {
    facts: {
      userId: t.number(),
      user: t.any<User | null>(),
    },
    derivations: {
      displayName: t.string(),
    },
    events: {
      setUserId: { userId: t.number() },
    },
    requirements: {
      FETCH_USER: {},
    },
  },
  init: (facts) => {
    facts.userId = 0;
    facts.user = null;
  },
  derive: {
    displayName: (facts) => facts.user?.name ?? "Guest",
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
      resolve: async (req, ctx) => {
        ctx.facts.user = await api.getUser(ctx.facts.userId);
      },
    },
  },
});

// Create and start the system
const system = createSystem({ module: userModule });
system.start();

const app = createApp(App);

// Install the plugin to make the system available to all components
app.use(createDirectivePlugin(system));
app.mount('#app');
```

Or use `provideSystem` in a parent component instead of the plugin:

```vue
<script setup>
import { provideSystem } from 'directive/vue';
import { system } from './system';

// Provide the system to child components from within setup()
provideSystem(system);
</script>
```

---

## Core Composables

### useFact

Read a single fact, multiple facts, or a selected slice of a fact:

```vue
<script setup lang="ts">
import { useFact } from 'directive/vue';

// Subscribe to a single fact – re-renders when "userId" changes
const userId = useFact<number>('userId');

// Subscribe to multiple facts at once
const { name, email, avatar } = useFact<{ name: string; email: string; avatar: string }>(
  ['name', 'email', 'avatar']
);

// Derive a value with a selector – only updates when the result changes
const upperName = useFact('user', (u) => u?.name?.toUpperCase() ?? 'GUEST');

// Selector with custom equality to prevent unnecessary updates
const ids = useFact('users', (users) => users?.map(u => u.id) ?? [], shallowEqual);
</script>
```

### useDerived

Read a single derivation, multiple derivations, or a selected slice:

```vue
<script setup lang="ts">
import { useDerived } from 'directive/vue';

// Subscribe to a single derivation
const displayName = useDerived<string>('displayName');

// Subscribe to multiple derivations at once
const { isLoggedIn, isAdmin } = useDerived<{ isLoggedIn: boolean; isAdmin: boolean }>(
  ['isLoggedIn', 'isAdmin']
);

// Derive a value with a selector – only updates when the count changes
const itemCount = useDerived('stats', (stats) => stats.itemCount);
</script>
```

### useSelector

Select from all facts (like Zustand's `useStore`):

```vue
<script setup>
import { useSelector } from 'directive/vue';

// Select and combine values from multiple facts with custom equality
const summary = useSelector(
  (facts) => ({
    userName: facts.user?.name,
    itemCount: facts.items?.length ?? 0,
  }),
  (a, b) => a.userName === b.userName && a.itemCount === b.itemCount
);
</script>

<template>
  <p>{{ summary.userName }} has {{ summary.itemCount }} items</p>
</template>
```

### useEvents

Get a typed reference to the system's event dispatchers:

```vue
<script setup>
import { useEvents } from 'directive/vue';

// Get typed event dispatchers for the module
const events = useEvents();
</script>

<template>
  <button @click="events.increment()">+</button>
  <button @click="events.setCount({ count: 0 })">Reset</button>
</template>
```

### useDispatch

Low-level event dispatch for untyped or system events:

```vue
<script setup>
import { useDispatch } from 'directive/vue';

// Get the low-level dispatch function
const dispatch = useDispatch();
</script>

<template>
  <button @click="dispatch({ type: 'setUserId', userId: 42 })">
    Load User
  </button>
</template>
```

### useWatch

Watch a fact or derivation for changes without causing re-renders -- runs a callback as a side effect. `useWatch` auto-detects whether the key refers to a fact or a derivation, so there is no need to pass a discriminator:

```vue
<script setup>
import { useWatch } from 'directive/vue';

// Watch a derivation for analytics tracking
useWatch<string>('phase', (newPhase, oldPhase) => {
  analytics.track('phaseChange', { from: oldPhase, to: newPhase });
});

// Watch a fact – auto-detected, no "fact" discriminator needed
useWatch('userId', (newId, oldId) => {
  analytics.track('userId_changed', { from: oldId, to: newId });
});
</script>
```

{% callout type="warning" title="Deprecated pattern" %}
The three-argument form `useWatch("fact", "key", cb)` still works but is deprecated. Use the two-argument form `useWatch("key", cb)` instead -- `useWatch` now auto-detects whether the key is a fact or derivation.
{% /callout %}

### useSystem

Access the full system instance:

```vue
<script setup>
import { useSystem } from 'directive/vue';

// Access the full system instance for advanced operations
const system = useSystem();
</script>

<template>
  <div>
    <button @click="console.log(system.inspect())">Inspect</button>
    <button @click="system.facts.count++">Increment</button>
  </div>
</template>
```

---

## Inspection

### useInspect

Get system inspection data (unmet requirements, inflight resolvers, constraint status) as a reactive `ShallowRef<InspectState>`:

```vue
<script setup>
import { useInspect } from 'directive/vue';

// Get reactive system inspection data
const inspection = useInspect();
// InspectState: { isSettled, unmet, inflight, isWorking, hasUnmet, hasInflight }
</script>

<template>
  <Spinner v-if="inspection.isWorking" />
  <pre v-else>
    Settled: {{ inspection.isSettled }}
    Unmet: {{ inspection.unmet.length }}
    Inflight: {{ inspection.inflight.length }}
  </pre>
</template>
```

With throttling for high-frequency updates:

```vue
<script setup>
import { useInspect } from 'directive/vue';

// Throttle updates to limit render frequency
const inspection = useInspect({ throttleMs: 200 });
</script>
```

### useConstraintStatus

Read constraint status reactively:

```vue
<script setup>
import { useConstraintStatus } from 'directive/vue';

// Get all constraints for the debug panel
const constraints = useConstraintStatus();
// Array<{ id: string; active: boolean; priority: number }>

// Check a specific constraint by ID
const auth = useConstraintStatus('requireAuth');
// { id: "requireAuth", active: true, priority: 50 } | null
</script>
```

### useExplain

Get a reactive explanation of why a requirement exists:

```vue
<script setup>
import { useExplain } from 'directive/vue';

// Get a detailed explanation of why a requirement was generated
const explanation = useExplain('FETCH_USER');
</script>

<template>
  <pre v-if="explanation">{{ explanation }}</pre>
  <p v-else>No active requirement</p>
</template>
```

---

## Requirement Status Composables

These composables require passing a `statusPlugin` to `createDirectivePlugin` or `provideSystem`:

```typescript
import { createApp } from 'vue';
import { createSystem } from 'directive';
import { createRequirementStatusPlugin } from 'directive';
import { createDirectivePlugin, useRequirementStatus } from 'directive/vue';

// Create the status plugin for tracking requirement resolution
const statusPlugin = createRequirementStatusPlugin();

// Pass the plugin when creating the system
const system = createSystem({
  module: myModule,
  plugins: [statusPlugin.plugin],
});
system.start();

const app = createApp(App);

// Install the plugin with the status plugin for injection
app.use(createDirectivePlugin(system, statusPlugin));
app.mount('#app');
```

### useRequirementStatus

```vue
<script setup>
import { useRequirementStatus } from 'directive/vue';

// Track a single requirement type
const status = useRequirementStatus('FETCH_USER');
// status: { isLoading, hasError, pending, inflight, failed, lastError }

// Track multiple requirement types at once
const statuses = useRequirementStatus(['FETCH_USER', 'FETCH_SETTINGS']);
// statuses: Record<string, RequirementTypeStatus>
</script>

<template>
  <Spinner v-if="status.isLoading" />
  <Error v-else-if="status.hasError" :message="status.lastError?.message" />
  <UserContent v-else />
</template>
```

### useOptimisticUpdate

Apply optimistic mutations with automatic rollback on resolver failure:

```vue
<script setup>
import { useOptimisticUpdate, useSystem } from 'directive/vue';

// Access the system's facts proxy
const { facts } = useSystem();

// Set up optimistic mutations with automatic rollback
const { mutate, isPending, error, rollback } = useOptimisticUpdate(undefined, 'SAVE_DATA');

function handleSave() {
  mutate(() => {
    // Optimistically update the UI before the server responds
    facts.savedAt = Date.now();
    facts.status = 'saved';
  });
  // If "SAVE_DATA" resolver fails, facts are rolled back automatically
}
</script>

<template>
  <button :disabled="isPending" @click="handleSave">
    {{ isPending ? 'Saving...' : 'Save' }}
  </button>
</template>
```

---

## Scoped Systems

### useDirective

Create a system scoped to a component's lifecycle. The system is automatically started on mount and destroyed on unmount:

```vue
<script setup>
import { useDirective, provideSystem, useDerived } from 'directive/vue';
import { counterModule } from './counterModule';

// Create a scoped system tied to this component's lifecycle
const system = useDirective(counterModule);

// Provide the system to child components
provideSystem(system);
</script>
```

You can also pass full system options:

```typescript
// Define options outside the component for stability
const systemOptions = {
  module: counterModule,
  plugins: [loggingPlugin()],
};

// Inside <script setup>
const system = useDirective(systemOptions);
```

### useModule

Zero-config composable that creates a scoped system and subscribes to all facts and derivations:

```vue
<script setup>
import { useModule } from 'directive/vue';
import { counterModule } from './counterModule';

// Get everything in one call – system, facts, derivations, and events
const { system, facts, derived, events, dispatch } = useModule(counterModule);
</script>

<template>
  <div>
    <p>Count: {{ facts.count }}, Doubled: {{ derived.doubled }}</p>
    <button @click="events.increment()">+</button>
  </div>
</template>
```

---

## Typed Composables

Create fully typed composables for your module schema:

```typescript
import { createTypedHooks } from 'directive/vue';

// Create typed composables – full autocomplete for keys and events
const { useDerived, useFact, useDispatch, useSystem, useEvents } =
  createTypedHooks<typeof myModule.schema>();
```

```vue
<script setup>
// Fully typed – return types are inferred from the schema
const count = useFact('count');       // Type: Ref<number | undefined>
const doubled = useDerived('doubled'); // Type: Ref<number>
const dispatch = useDispatch();
const events = useEvents();

dispatch({ type: 'increment' });       // Typed!
events.increment();                    // Also typed!
</script>
```

---

## Time-Travel Debugging

Use `useTimeTravel` for reactive undo/redo controls. Returns a `ShallowRef<TimeTravelState | null>` that updates when snapshot state changes:

```vue
<script setup>
import { useTimeTravel } from 'directive/vue';

// Get reactive time-travel controls (null when disabled)
const tt = useTimeTravel();
</script>

<template>
  <div v-if="tt">
    <button @click="tt.undo" :disabled="!tt.canUndo">Undo</button>
    <button @click="tt.redo" :disabled="!tt.canRedo">Redo</button>
    <span>{{ tt.currentIndex + 1 }} / {{ tt.totalSnapshots }}</span>
  </div>
</template>
```

Returns `null` when time-travel is disabled. See [Time-Travel](/docs/advanced/time-travel) for changesets and keyboard shortcuts.

---

## Patterns

### Loading States

```vue
<script setup>
import { useFact, useDerived } from 'directive/vue';

// Subscribe to the user fact
const user = useFact<User | null>('user');

// Subscribe to the display name derivation
const displayName = useDerived<string>('displayName');
</script>

<template>
  <Spinner v-if="!user" />
  <div v-else>
    <h1>{{ displayName }}</h1>
    <UserDetails :user="user" />
  </div>
</template>
```

### Writing Facts

Write facts through the system directly:

```vue
<script setup>
import { useFact, useSystem } from 'directive/vue';

// Subscribe to the current userId
const userId = useFact<number>('userId');

// Access the system's facts proxy for direct writes
const { facts } = useSystem();
</script>

<template>
  <input
    type="number"
    :value="userId ?? 0"
    @input="facts.userId = parseInt(($event.target as HTMLInputElement).value)"
  />
</template>
```

Or dispatch events:

```vue
<script setup>
import { useDispatch } from 'directive/vue';

const dispatch = useDispatch();
</script>

<template>
  <button @click="dispatch({ type: 'increment' })">+</button>
</template>
```

---

## Testing

```typescript
import { mount } from '@vue/test-utils';
import { createTestSystem } from 'directive/testing';
import { createDirectivePlugin } from 'directive/vue';
import { userModule } from './modules/user';
import UserProfile from './UserProfile.vue';

test('displays user name', async () => {
  // Create a test system with mock data
  const system = createTestSystem({ module: userModule });
  system.facts.user = { id: 1, name: 'Test User' };

  const wrapper = mount(UserProfile, {
    global: {
      plugins: [createDirectivePlugin(system)],
    },
  });

  expect(wrapper.text()).toContain('Test User');
});
```

---

## Utilities

### shallowEqual

Re-exported from the core package for use with selector-based composables:

```typescript
import { shallowEqual } from 'directive/vue';

// Use shallowEqual to prevent updates when x/y values haven't changed
const coords = useFact('position', (p) => ({ x: p?.x, y: p?.y }), shallowEqual);
```

---

## API Reference

| Export | Type | Description |
|---|---|---|
| `createDirectivePlugin` | Plugin | Vue plugin for providing the system |
| `provideSystem` | Composable | Provide system via Vue's inject/provide |
| `useFact` | Composable | Read single/multi facts or apply selector |
| `useDerived` | Composable | Read single/multi derivations or apply selector |
| `useSelector` | Composable | Select from all facts with custom equality |
| `useEvents` | Composable | Typed event dispatchers |
| `useDispatch` | Composable | Low-level event dispatch |
| `useWatch` | Composable | Side-effect watcher for facts or derivations (auto-detects kind) |
| `useInspect` | Composable | System inspection (unmet, inflight, settled) |
| `useConstraintStatus` | Composable | Reactive constraint inspection |
| `useExplain` | Composable | Reactive requirement explanation |
| `useRequirementStatus` | Composable | Single/multi requirement status |
| `useOptimisticUpdate` | Composable | Optimistic mutations with rollback |
| `useSystem` | Composable | Access full system instance |
| `useDirective` | Composable | Scoped system tied to component lifecycle |
| `useModule` | Composable | Zero-config scoped system |
| `createTypedHooks` | Factory | Create typed composables for a schema |
| `useTimeTravel` | Composable | Reactive time-travel state (canUndo, canRedo, undo, redo) |
| `shallowEqual` | Utility | Shallow equality for selectors |

---

## Next Steps

- **[Quick Start](/docs/quick-start)** – Build your first module
- **[Facts](/docs/facts)** – State management deep dive
- **[Testing](/docs/testing/overview)** – Testing Vue components
