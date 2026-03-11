---
title: Vue Adapter
description: Integrate Directive with Vue 3 using composables for reactive state management. useFact, useDerived, useEvents, useDispatch, useInspect, and more.
---

Directive provides first-class Vue 3 integration with composables that automatically update on state changes. All composables take an explicit `system` parameter – no context injection needed. {% .lead %}

---

## Installation

The Vue adapter is included in the main package:

```typescript
import { useFact, useDerived, useEvents, useDispatch } from '@directive-run/vue';
```

---

## Setup

Create a system at module level and pass it explicitly to composables:

```typescript
import { createModule, createSystem, t } from '@directive-run/core';

const userModule = createModule("user", {
  schema: {
    facts: {
      userId: t.number(),
      user: t.object<User | null>(),
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
      resolve: async (req, context) => {
        context.facts.user = await api.getUser(context.facts.userId);
      },
    },
  },
});

// Create and start the system
const system = createSystem({ module: userModule });
system.start();

// Export for use in components
export { system };
```

Then pass the system to composables in your components:

```html
<script setup>
import { useFact, useDerived } from '@directive-run/vue';
import { system } from './system';

const user = useFact(system, 'user');
const displayName = useDerived(system, 'displayName');
</script>

<template>
  <h1>{{ displayName }}</h1>
</template>
```

---

## Creating Systems

Every composable below requires a `system` passed as the first parameter. There are two ways to create one:

- **Global system** – call `createSystem()` at module level for app-wide state shared across components (shown in [Setup](#setup) above)
- **`useDirective`** – creates a system scoped to a component's lifecycle, auto-starts on mount and destroys on unmount

For most Vue apps, use a global system. Use `useDirective` when you need per-component system isolation.

### useDirective

Creates a scoped system **and** subscribes to facts and derivations. Two modes:

- **Selective** – specify `facts` and/or `derived` keys to subscribe only to those
- **Subscribe all** – omit keys to subscribe to everything (good for prototyping or small modules)

```html
<script setup>
import { useDirective } from '@directive-run/vue';
import { counterModule } from './counterModule';

// Subscribe all: omit keys for everything
const { system, facts, derived, events, dispatch } = useDirective(counterModule);
</script>

<template>
  <div>
    <p>Count: {{ facts.count }}, Doubled: {{ derived.doubled }}</p>
    <button @click="events.increment()">+</button>
  </div>
</template>
```

With system config and selective subscriptions:

```html
<script setup>
import { useDirective } from '@directive-run/vue';
import { counterModule } from './counterModule';

// Selective: subscribe to specific keys only
const { facts, derived, dispatch } = useDirective(counterModule, {
  facts: ['count'],
  derived: ['doubled'],
  plugins: [loggingPlugin()],
});
</script>
```

---

## Core Composables

### useSelector

The go-to composable for **transforms and derived values** from facts. Directive auto-tracks which fact keys your selector reads and subscribes only to those:

```html
<script setup>
import { useSelector, shallowEqual } from '@directive-run/vue';
import { system } from './system';

// Transform a single fact value
const upperName = useSelector(system, (state) => state.user?.name?.toUpperCase() ?? 'GUEST');

// Extract a slice from state
const itemCount = useSelector(system, (state) => state.items?.length ?? 0);

// Combine values from multiple facts and derivations
const summary = useSelector(
  system,
  (state) => ({
    userName: state.user?.name,
    itemCount: state.items?.length ?? 0,
  }),
  (a, b) => a.userName === b.userName && a.itemCount === b.itemCount
);

// Custom equality to prevent unnecessary updates on array/object results
const ids = useSelector(
  system,
  (facts) => facts.users?.map(u => u.id) ?? [],
  shallowEqual,
);
</script>

<template>
  <p>{{ summary.userName }} has {{ summary.itemCount }} items</p>
</template>
```

### useFact

Read a single fact or multiple facts:

```html
<script setup>
import { useFact } from '@directive-run/vue';
import { system } from './system';

// Subscribe to a single fact – re-renders when "userId" changes
const userId = useFact(system, 'userId');

// Subscribe to multiple facts at once
const { name, email, avatar } = useFact(system, ['name', 'email', 'avatar']);
</script>
```

{% callout type="note" title="Need a transform?" %}
Use [`useSelector`](#useselector) to derive values from facts. It auto-tracks dependencies and supports custom equality.
{% /callout %}

### useDerived

Read a single derivation or multiple derivations:

```html
<script setup>
import { useDerived } from '@directive-run/vue';
import { system } from './system';

// Subscribe to a single derivation
const displayName = useDerived(system, 'displayName');

// Subscribe to multiple derivations at once
const { isLoggedIn, isAdmin } = useDerived(system, ['isLoggedIn', 'isAdmin']);
</script>
```

{% callout type="note" title="Need a transform?" %}
Use [`useSelector`](#useselector) to derive values from facts with auto-tracking and custom equality support.
{% /callout %}

### useEvents

Get a typed reference to the system's event dispatchers:

```html
<script setup>
import { useEvents } from '@directive-run/vue';
import { system } from './system';

// Get typed event dispatchers for the module
const events = useEvents(system);
</script>

<template>
  <button @click="events.increment()">+</button>
  <button @click="events.setCount({ count: 0 })">Reset</button>
</template>
```

### useDispatch

Low-level event dispatch for untyped or system events:

```html
<script setup>
import { useDispatch } from '@directive-run/vue';
import { system } from './system';

// Get the low-level dispatch function
const dispatch = useDispatch(system);
</script>

<template>
  <button @click="dispatch({ type: 'setUserId', userId: 42 })">
    Load User
  </button>
</template>
```

### useWatch

Watch a fact or derivation for changes without causing re-renders – runs a callback as a side effect. `useWatch` auto-detects whether the key refers to a fact or a derivation, so there is no need to pass a discriminator:

```html
<script setup>
import { useWatch } from '@directive-run/vue';
import { system } from './system';

// Watch a derivation for analytics tracking
useWatch(system, 'phase', (newPhase, oldPhase) => {
  analytics.track('phaseChange', { from: oldPhase, to: newPhase });
});

// Watch a fact – auto-detected, no "fact" discriminator needed
useWatch(system, 'userId', (newId, oldId) => {
  analytics.track('userId_changed', { from: oldId, to: newId });
});
</script>
```

{% callout type="warning" title="Deprecated pattern" %}
The four-argument form `useWatch(system, "fact", "key", cb)` still works but is deprecated. Use `useWatch(system, "key", cb)` instead – `useWatch` now auto-detects whether the key is a fact or derivation.
{% /callout %}

---

## Inspection

### useInspect

Get system inspection data (unmet requirements, inflight resolvers, constraint status) as a reactive `ShallowRef<InspectState>`:

```html
<script setup>
import { useInspect } from '@directive-run/vue';
import { system } from './system';

// Get reactive system inspection data
const inspection = useInspect(system);
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

```html
<script setup>
import { useInspect } from '@directive-run/vue';
import { system } from './system';

// Throttle updates to limit render frequency
const inspection = useInspect(system, { throttleMs: 200 });
</script>
```

### useConstraintStatus

Read constraint status reactively:

```html
<script setup>
import { useConstraintStatus } from '@directive-run/vue';
import { system } from './system';

// Get all constraints for the debug panel
const constraints = useConstraintStatus(system);
// Array<{ id: string; active: boolean; priority: number }>

// Check a specific constraint by ID
const auth = useConstraintStatus(system, 'requireAuth');
// { id: "requireAuth", active: true, priority: 50 } | null
</script>
```

### useExplain

Get a reactive explanation of why a requirement exists:

```html
<script setup>
import { useExplain } from '@directive-run/vue';
import { system } from './system';

// Get a detailed explanation of why a requirement was generated
const explanation = useExplain(system, 'FETCH_USER');
</script>

<template>
  <pre v-if="explanation">{{ explanation }}</pre>
  <p v-else>No active requirement</p>
</template>
```

---

## Requirement Status Composables

These composables require a `statusPlugin` created via `createRequirementStatusPlugin`:

```typescript
import { createSystem, createRequirementStatusPlugin } from '@directive-run/core';

// Create the status plugin for tracking requirement resolution
const statusPlugin = createRequirementStatusPlugin();

// Pass the plugin when creating the system
const system = createSystem({
  module: myModule,
  plugins: [statusPlugin.plugin],
});
system.start();

export { system, statusPlugin };
```

### useRequirementStatus

Pass the `statusPlugin` as the first parameter:

```html
<script setup>
import { useRequirementStatus } from '@directive-run/vue';
import { statusPlugin } from './system';

// Track a single requirement type
const status = useRequirementStatus(statusPlugin, 'FETCH_USER');
// status: { isLoading, hasError, pending, inflight, failed, lastError }

// Track multiple requirement types at once
const statuses = useRequirementStatus(statusPlugin, ['FETCH_USER', 'FETCH_SETTINGS']);
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

```html
<script setup>
import { useOptimisticUpdate } from '@directive-run/vue';
import { system, statusPlugin } from './system';

// Set up optimistic mutations with automatic rollback
const { mutate, isPending, error, rollback } = useOptimisticUpdate(system, statusPlugin, 'SAVE_DATA');

function handleSave() {
  mutate(() => {
    // Optimistically update the UI before the server responds
    system.facts.savedAt = Date.now();
    system.facts.status = 'saved';
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

## Typed Composables

Create fully typed composables for your module schema. Returned hooks take `system` as the first parameter:

```typescript
import { createTypedHooks } from '@directive-run/vue';

// Create typed composables – full autocomplete for keys and events
const { useDerived, useFact, useDispatch, useEvents } =
  createTypedHooks<typeof myModule.schema>();
```

```html
<script setup>
import { useFact, useDerived, useDispatch, useEvents } from './typed-hooks';
import { system } from './system';

// Fully typed – return types are inferred from the schema
const count = useFact(system, 'count');       // Type: Ref<number | undefined>
const doubled = useDerived(system, 'doubled'); // Type: Ref<number>
const dispatch = useDispatch(system);
const events = useEvents(system);

dispatch({ type: 'increment' });       // Typed!
events.increment();                    // Also typed!
</script>
```

---

## Time-Travel Debugging

`useHistory` returns a `ShallowRef<HistoryState | null>` – `null` when disabled, otherwise the full reactive API. The ref auto-unwraps in templates, so you can access properties directly:

### Undo / Redo Controls

```html
<script setup>
import { useHistory } from '@directive-run/vue';
import { system } from './system';

const history = useHistory(system);
</script>

<template>
  <div v-if="history">
    <button @click="history.undo" :disabled="!history.canUndo">Undo</button>
    <button @click="history.redo" :disabled="!history.canRedo">Redo</button>
    <span>{{ history.currentIndex + 1 }} / {{ history.totalSnapshots }}</span>
  </div>
</template>
```

### Snapshot Timeline

`snapshots` is lightweight metadata only (no facts data). Use `getSnapshotFacts(id)` to lazily load a snapshot's state on demand:

```html
<template>
  <ul v-if="history">
    <li v-for="snap in history.snapshots" :key="snap.id">
      <button @click="history.goTo(snap.id)">
        {{ snap.trigger }} – {{ new Date(snap.timestamp).toLocaleTimeString() }}
      </button>
      <button @click="console.log(history.getSnapshotFacts(snap.id))">
        Inspect
      </button>
    </li>
  </ul>
</template>
```

### Navigation

```html
<template>
  <div v-if="history">
    <button @click="history.goBack(5)">Back 5</button>
    <button @click="history.goForward(5)">Forward 5</button>
    <button @click="history.goTo(0)">Jump to Start</button>
    <button @click="history.replay()">Replay All</button>
  </div>
</template>
```

### Session Persistence

```html
<script setup>
import { useHistory } from '@directive-run/vue';
import { system } from './system';

const history = useHistory(system);

function saveSession() {
  if (history.value) {
    localStorage.setItem('debug', history.value.exportSession());
  }
}

function restoreSession() {
  const saved = localStorage.getItem('debug');
  if (saved && history.value) {
    history.value.importSession(saved);
  }
}
</script>

<template>
  <div v-if="history">
    <button @click="saveSession">Save Session</button>
    <button @click="restoreSession">Restore Session</button>
  </div>
</template>
```

### Changesets

Group multiple fact mutations into a single undo/redo unit:

```html
<script setup>
import { useHistory } from '@directive-run/vue';
import { system } from './system';

const history = useHistory(system);

function handleComplexAction() {
  history.value?.beginChangeset('Move piece A→B');
  // ... multiple fact mutations ...
  history.value?.endChangeset();
  // Now undo/redo treats all mutations as one step
}
</script>

<template>
  <button @click="handleComplexAction">Move Piece</button>
</template>
```

### Recording Control

```html
<template>
  <button v-if="history" @click="history.isPaused ? history.resume() : history.pause()">
    {{ history.isPaused ? 'Resume' : 'Pause' }} Recording
  </button>
</template>
```

See [Time-Travel](/docs/advanced/history) for the full `HistoryState` interface and keyboard shortcuts.

---

## Patterns

### Loading States

```html
<script setup>
import { useFact, useDerived } from '@directive-run/vue';
import { system } from './system';

// Subscribe to the user fact
const user = useFact(system, 'user');

// Subscribe to the display name derivation
const displayName = useDerived(system, 'displayName');
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

```html
<script setup>
import { useFact } from '@directive-run/vue';
import { system } from './system';

// Subscribe to the current userId
const userId = useFact(system, 'userId');
</script>

<template>
  <input
    type="number"
    :value="userId ?? 0"
    @input="system.facts.userId = parseInt(($event.target as HTMLInputElement).value)"
  />
</template>
```

Or dispatch events:

```html
<script setup>
import { useDispatch } from '@directive-run/vue';
import { system } from './system';

const dispatch = useDispatch(system);
</script>

<template>
  <button @click="dispatch({ type: 'increment' })">+</button>
</template>
```

---

## Testing

```typescript
import { mount } from '@vue/test-utils';
import { createTestSystem } from '@directive-run/core/testing';
import { useFact, useDerived } from '@directive-run/vue';
import { userModule } from './modules/user';
import UserProfile from './UserProfile.vue';

test('displays user name', async () => {
  // Create a test system with namespaced modules
  const system = createTestSystem({ modules: { user: userModule } });
  system.start();
  system.facts.user.user = { id: 1, name: 'Test User' };

  // Components receive system explicitly – no plugin needed
  const wrapper = mount(UserProfile, {
    props: { system },
  });

  expect(wrapper.text()).toContain('Test User');
});
```

---

## Utilities

### shallowEqual

Re-exported from the core package for use with `useSelector`:

```typescript
import { useSelector, shallowEqual } from '@directive-run/vue';
import { system } from './system';

// Use shallowEqual to prevent updates when x/y values haven't changed
const coords = useSelector(system, (state) => ({ x: state.position?.x, y: state.position?.y }), shallowEqual);
```

---

## API Reference

| Export | Type | Description |
|---|---|---|
| `useFact` | Composable | Read single/multi facts |
| `useDerived` | Composable | Read single/multi derivations |
| `useSelector` | Composable | Select from all facts with custom equality |
| `useEvents` | Composable | Typed event dispatchers |
| `useDispatch` | Composable | Low-level event dispatch |
| `useWatch` | Composable | Side-effect watcher for facts or derivations (auto-detects kind) |
| `useInspect` | Composable | System inspection (unmet, inflight, settled) |
| `useConstraintStatus` | Composable | Reactive constraint inspection |
| `useExplain` | Composable | Reactive requirement explanation |
| `useRequirementStatus` | Composable | Single/multi requirement status (takes statusPlugin) |
| `useOptimisticUpdate` | Composable | Optimistic mutations with rollback |
| `useDirective` | Composable | Scoped system with selected or all subscriptions |
| `createTypedHooks` | Factory | Create typed composables for a schema |
| `useHistory` | Composable | Reactive time-travel state (canUndo, canRedo, undo, redo) |
| `shallowEqual` | Utility | Shallow equality for selectors |

---

## Next Steps

- **[Quick Start](/docs/quick-start)** – Build your first module
- **[Facts](/docs/facts)** – State management deep dive
- **[Testing](/docs/testing/overview)** – Testing Vue components
