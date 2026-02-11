---
title: Vue Composables
description: Complete API reference for all Vue composables exported from directive/vue. Context injection – composables access the system automatically via provide/inject.
---

Vue composables API reference. All composables access the system via Vue's provide/inject – no system parameter needed. {% .lead %}

---

## Setup

Provide the system at the app level:

```typescript
import { createApp } from 'vue';
import { createDirectivePlugin } from 'directive/vue';
import { createSystem } from 'directive';

// Create and start the system
const system = createSystem({ module: myModule });
system.start();

// Install the plugin to provide the system to all components
const app = createApp(App);
app.use(createDirectivePlugin(system));
app.mount('#app');
```

Or use `provideSystem` in a component's `setup()`:

```vue
<script setup>
import { provideSystem } from 'directive/vue';

// Provide the system to child components from within setup()
provideSystem(system, statusPlugin);
</script>
```

---

## Quick Reference

| Export | Type | Description |
|---|---|---|
| `createDirectivePlugin` | Plugin | Vue plugin for providing the system |
| `provideSystem` | Composable | Provide system via Vue's inject/provide |
| `useFact` | Composable | Read single/multi facts |
| `useDerived` | Composable | Read single/multi derivations |
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
| `useDirective` | Composable | Scoped system with selected or all subscriptions |
| `createTypedHooks` | Factory | Create typed composables for a schema |
| `useTimeTravel` | Composable | Reactive time-travel state (canUndo, canRedo, undo, redo) |
| `shallowEqual` | Utility | Shallow equality for selectors |

---

## createDirectivePlugin

Vue plugin that provides the Directive system to all descendant components via `inject`.

```typescript
function createDirectivePlugin<M extends ModuleSchema>(
  system: System<M>,
  statusPlugin?: StatusPlugin,
): { install(app: App): void }
```

### Usage

```typescript
import { createApp } from 'vue';
import { createDirectivePlugin } from 'directive/vue';

// Install the plugin with an optional status plugin
const app = createApp(App);
app.use(createDirectivePlugin(system, statusPlugin));
app.mount('#app');
```

---

## provideSystem

Provide the system to child components from within a component's `setup()`. Alternative to the plugin approach.

```typescript
function provideSystem<M extends ModuleSchema>(
  system: System<M>,
  statusPlugin?: StatusPlugin,
): void
```

### Usage

```vue
<script setup>
import { provideSystem } from 'directive/vue';

// Provide the system to child components from within setup()
provideSystem(system, statusPlugin);
</script>
```

---

## useFact

Subscribe to a single fact or multiple facts. Returns a reactive `Ref`.

```typescript
// Single key
function useFact<T>(factKey: string): Ref<T | undefined>

// Multi-key
function useFact<T extends Record<string, unknown>>(factKeys: string[]): ShallowRef<T>
```

### Usage

```vue
<script setup>
import { useFact } from 'directive/vue';

// Subscribe to a single fact – returns Ref<number | undefined>
const count = useFact('count');

// Subscribe to multiple facts – returns ShallowRef<{ userId, loading }>
const multi = useFact(['userId', 'loading']);
</script>

<template>
  <p>Count: {{ count }}</p>
  <p>User: {{ multi.userId }}</p>
</template>
```

{% callout type="note" title="Need a transform?" %}
Use [`useSelector`](#useselector) to derive values from facts. It auto-tracks dependencies and supports custom equality.
{% /callout %}

---

## useDerived

Subscribe to a single derivation or multiple derivations.

```typescript
// Single key
function useDerived<T>(derivationId: string): Ref<T>

// Multi-key
function useDerived<T extends Record<string, unknown>>(derivationIds: string[]): ShallowRef<T>
```

### Usage

```vue
<script setup>
import { useDerived } from 'directive/vue';

// Subscribe to a single derivation
const total = useDerived('cartTotal');

// Subscribe to multiple derivations at once
const state = useDerived(['isRed', 'elapsed']);
</script>

<template>
  <p>Total: ${{ total }}</p>
  <p>{{ state.isRed ? 'Red' : 'Not red' }}</p>
</template>
```

{% callout type="note" title="Need a transform?" %}
Use [`useSelector`](#useselector) to derive values from facts. It auto-tracks dependencies and supports custom equality.
{% /callout %}

---

## useSelector

Auto-tracking cross-fact selector. Uses `withTracking()` to detect which facts the selector accesses, then subscribes only to those keys.

```typescript
function useSelector<R>(
  selector: (facts: Record<string, unknown>) => R,
  equalityFn?: (a: R, b: R) => boolean,
): Ref<R>
```

### Usage

```vue
<script setup>
import { useSelector, shallowEqual } from 'directive/vue';

// Select and combine values from multiple facts with shallow equality
const summary = useSelector(
  (facts) => ({
    userName: facts.user?.name,
    itemCount: facts.items?.length ?? 0,
  }),
  shallowEqual,
);
</script>

<template>
  <p>{{ summary.userName }} has {{ summary.itemCount }} items</p>
</template>
```

---

## useEvents

Returns the system's typed events dispatcher object.

```typescript
function useEvents<M extends ModuleSchema>(): System<M>["events"]
```

### Usage

```vue
<script setup>
import { useEvents } from 'directive/vue';

// Get typed event dispatchers for the module
const events = useEvents();
</script>

<template>
  <button @click="events.increment()">+1</button>
  <button @click="events.addItem({ name: 'Widget' })">Add</button>
</template>
```

---

## useDispatch

Get a low-level dispatch function for sending events.

```typescript
function useDispatch<M extends ModuleSchema>(): (event: InferEvents<M>) => void
```

### Usage

```vue
<script setup>
import { useDispatch } from 'directive/vue';

// Get the low-level dispatch function
const dispatch = useDispatch();
</script>

<template>
  <button @click="dispatch({ type: 'increment' })">+1</button>
</template>
```

---

## useWatch

Watch a fact or derivation and execute a callback when it changes. Auto-detects whether the key refers to a fact or a derivation -- no discriminator needed. Does not cause re-renders; use for side effects only.

```typescript
// Unified API – auto-detects fact vs derivation
function useWatch<T>(
  key: string,
  callback: (newValue: T, previousValue: T | undefined) => void,
): void

// Deprecated – still works but prefer the unified form above
function useWatch<T>(
  kind: "fact",
  factKey: string,
  callback: (newValue: T | undefined, previousValue: T | undefined) => void,
): void
```

### Usage

```vue
<script setup>
import { useWatch } from 'directive/vue';

// Watch a derivation – auto-detected
useWatch('pageViews', (newVal, prevVal) => {
  analytics.track('pageViews', { from: prevVal, to: newVal });
});

// Watch a fact – also auto-detected, no "fact" discriminator needed
useWatch('userId', (newId, prevId) => {
  console.log(`User changed from ${prevId} to ${newId}`);
});
</script>
```

{% callout type="warning" title="Deprecated pattern" %}
The three-argument form `useWatch("fact", "key", cb)` still works but is deprecated. Use the two-argument form `useWatch("key", cb)` instead.
{% /callout %}

---

## useInspect

Get system inspection data reactively. Supports optional throttling for high-frequency updates.

```typescript
function useInspect(options?: { throttleMs?: number }): ShallowRef<InspectState>
```

### Returns

```typescript
interface InspectState {
  unmet: Requirement[];
  inflight: Requirement[];
  settled: Requirement[];
  isSettled: boolean;
  isWorking: boolean;
  hasUnmet: boolean;
  hasInflight: boolean;
  constraints: ConstraintInfo[];
}
```

### Usage

```vue
<script setup>
import { useInspect } from 'directive/vue';

// Get reactive system inspection data
const inspection = useInspect();

// With throttling to limit update frequency
const throttled = useInspect({ throttleMs: 200 });
</script>

<template>
  <div v-if="inspection.isWorking">
    <p>Unmet: {{ inspection.unmet.length }}</p>
    <p>Inflight: {{ inspection.inflight.length }}</p>
  </div>
</template>
```

---

## useConstraintStatus

Get all constraints or a single constraint by ID. Reactively updates when constraint state changes.

```typescript
// All constraints
function useConstraintStatus(): ShallowRef<ConstraintInfo[]>

// Single constraint
function useConstraintStatus(constraintId: string): ShallowRef<ConstraintInfo | null>
```

### Usage

```vue
<script setup>
import { useConstraintStatus } from 'directive/vue';

// Get all constraints for the debug panel
const allConstraints = useConstraintStatus();

// Check a specific constraint by ID
const transition = useConstraintStatus('transition');
</script>

<template>
  <p v-if="transition">Constraint active: {{ transition.id }}</p>
  <ul>
    <li v-for="c in allConstraints" :key="c.id">{{ c.id }}: {{ c.isMet }}</li>
  </ul>
</template>
```

---

## useExplain

Reactively returns the explanation string for a requirement type.

```typescript
function useExplain(requirementId: string): Ref<string | null>
```

### Usage

```vue
<script setup>
import { useExplain } from 'directive/vue';

// Get a detailed explanation of why a requirement was generated
const explanation = useExplain('FETCH_USER');
</script>

<template>
  <p v-if="explanation">Why: {{ explanation }}</p>
</template>
```

---

## useRequirementStatus

Get requirement status reactively. Reads the status plugin from injection context (provided via `createDirectivePlugin` or `provideSystem`).

```typescript
// Single type
function useRequirementStatus(type: string): ShallowRef<RequirementTypeStatus>

// Multi-type
function useRequirementStatus(types: string[]): ShallowRef<Record<string, RequirementTypeStatus>>
```

### Returns

```typescript
interface RequirementTypeStatus {
  isLoading: boolean;
  hasError: boolean;
  lastError: Error | null;
  inflight: number;
  settled: number;
}
```

### Usage

```vue
<script setup>
import { useRequirementStatus } from 'directive/vue';

// Track a single requirement type
const status = useRequirementStatus('FETCH_USER');

// Track multiple requirement types at once
const multi = useRequirementStatus(['FETCH_USER', 'FETCH_POSTS']);
</script>

<template>
  <Spinner v-if="status.isLoading" />
  <ErrorBanner v-else-if="status.hasError" :error="status.lastError" />
  <UserContent v-else />
</template>
```

---

## useOptimisticUpdate

Optimistic update composable. Saves a snapshot before mutating, monitors a requirement type via the status plugin, and rolls back on failure.

```typescript
function useOptimisticUpdate(
  statusPlugin?: StatusPlugin,
  requirementType?: string,
): OptimisticUpdateResult
```

### Returns

```typescript
interface OptimisticUpdateResult {
  mutate: (updateFn: () => void) => void;
  isPending: Ref<boolean>;
  error: Ref<Error | null>;
  rollback: () => void;
}
```

### Usage

```vue
<script setup>
import { useOptimisticUpdate } from 'directive/vue';

// Set up optimistic mutations with automatic rollback
const { mutate, isPending, error, rollback } = useOptimisticUpdate();

function toggleLike() {
  // Optimistically update the UI before the server responds
  mutate(() => {
    facts.liked = !facts.liked;
    facts.likeCount += facts.liked ? 1 : -1;
  });
}
</script>

<template>
  <button @click="toggleLike" :disabled="isPending">
    {{ isPending ? 'Saving...' : 'Like' }}
  </button>
  <p v-if="error">Failed: {{ error.message }}</p>
</template>
```

---

## useSystem

Access the full system instance from injection context.

```typescript
function useSystem<M extends ModuleSchema>(): System<M>
```

### Usage

```vue
<script setup>
import { useSystem } from 'directive/vue';

// Access the full system instance for advanced operations
const system = useSystem();

function doSomething() {
  // Take a snapshot of the entire system state
  const snapshot = system.getSnapshot();
  console.log('Current state:', snapshot);
}
</script>
```

---

## useDirective

Create a scoped Directive system tied to the component lifecycle. The system is created on mount, started automatically, and destroyed on unmount. Two modes:

- **Selective** — pass `facts` and/or `derived` keys to subscribe to specific state
- **Subscribe all** — omit keys to subscribe to all facts and derivations

```typescript
function useDirective<M extends ModuleSchema>(
  moduleDef: ModuleDef<M>,
  config?: {
    facts?: string[];
    derived?: string[];
    plugins?: Plugin[];
    debug?: DebugConfig;
    errorBoundary?: ErrorBoundaryConfig;
    tickMs?: number;
    zeroConfig?: boolean;
    initialFacts?: Record<string, any>;
    status?: boolean;
  },
): {
  system: System<M>;
  facts: ShallowRef<InferFacts<M>>;
  derived: ShallowRef<InferDerivations<M>>;
  events: System<M>["events"];
  dispatch: (event: InferEvents<M>) => void;
  statusPlugin?: StatusPlugin;
}
```

### Usage

```vue
<script setup>
import { useDirective } from 'directive/vue';
import { counterModule } from './counter-module';

// Subscribe all: omit keys for everything
const { facts, derived, events, dispatch } = useDirective(counterModule, {
  debug: { timeTravel: true },
  status: true,
});
</script>

<template>
  <p>Count: {{ facts.count }}</p>
  <p>Double: {{ derived.double }}</p>
  <button @click="events.increment()">+1</button>
</template>
```

Selective subscriptions:

```vue
<script setup>
import { useDirective } from 'directive/vue';
import { counterModule } from './counter-module';

// Selective: subscribe to specific keys only
const { facts, derived, dispatch } = useDirective(counterModule, {
  facts: ['count'],
  derived: ['doubled'],
});
</script>

<template>
  <p>{{ facts.count }}</p>
  <button @click="dispatch({ type: 'increment' })">+1</button>
</template>
```

---

## createTypedHooks

Factory function that returns typed versions of the core composables for a specific module schema. Provides full autocompletion for fact keys, derivation IDs, and event types.

```typescript
function createTypedHooks<M extends ModuleSchema>(): {
  useFact: <K extends keyof InferFacts<M>>(factKey: K) => Ref<InferFacts<M>[K] | undefined>;
  useDerived: <K extends keyof InferDerivations<M>>(derivationId: K) => Ref<InferDerivations<M>[K]>;
  useDispatch: () => (event: InferEvents<M>) => void;
  useSystem: () => System<M>;
  useEvents: () => System<M>["events"];
}
```

### Usage

```typescript
// typed-hooks.ts
import { createTypedHooks } from 'directive/vue';
import type { MyModuleSchema } from './my-module';

// Create typed composables – full autocomplete for fact keys and event types
export const { useFact, useDerived, useDispatch, useSystem, useEvents } =
  createTypedHooks<MyModuleSchema>();
```

```vue
<script setup>
import { useFact, useDerived } from './typed-hooks';

// Fully typed – factKey autocompletes, return type inferred
const count = useFact('count');       // Ref<number | undefined>

// Derivation types are also fully inferred
const total = useDerived('cartTotal'); // Ref<number>
</script>
```

---

## useTimeTravel

Reactive time-travel composable. Returns a `ShallowRef` that updates when snapshots are taken or navigation occurs. Returns `null` when time-travel is disabled.

```typescript
function useTimeTravel(): ShallowRef<TimeTravelState | null>
```

### Returns

```typescript
interface TimeTravelState {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  currentIndex: number;
  totalSnapshots: number;
}
```

### Usage

```vue
<script setup>
import { useTimeTravel } from 'directive/vue';

// Get reactive time-travel controls (null when disabled)
const tt = useTimeTravel();
</script>

<template>
  <div v-if="tt">
    <button :disabled="!tt.canUndo" @click="tt.undo()">Undo</button>
    <button :disabled="!tt.canRedo" @click="tt.redo()">Redo</button>
    <span>{{ tt.currentIndex + 1 }} / {{ tt.totalSnapshots }}</span>
  </div>
</template>
```

Enable time-travel in the system configuration:

```typescript
// Enable time-travel debugging on the system
const system = createSystem({
  module: myModule,
  debug: { timeTravel: true, maxSnapshots: 100 },
});
```

---

## shallowEqual

Utility function for shallow equality comparison. Useful as the `equalityFn` parameter for `useSelector`.

```typescript
function shallowEqual(a: unknown, b: unknown): boolean
```

### Usage

```vue
<script setup>
import { useSelector, shallowEqual } from 'directive/vue';

// Use shallowEqual to prevent updates when x/y values haven't changed
const coords = useSelector(
  (facts) => ({ x: facts.x, y: facts.y }),
  shallowEqual,
);
</script>
```

---

## Next Steps

- See [Core API](/docs/api/core) for system functions
- See [Types](/docs/api/types) for type definitions
- See [Vue Adapter](/docs/adapters/vue) for setup and patterns
