---
title: Vue Composables
description: Complete API reference for all Vue composables exported from @directive-run/vue. All composables take an explicit system parameter – no context injection needed.
---

Vue composables API reference. All composables take an explicit `system` parameter – no provide/inject needed. {% .lead %}

---

## Quick Reference

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
| `useTimeTravel` | Composable | Reactive time-travel state (canUndo, canRedo, undo, redo) |
| `shallowEqual` | Utility | Shallow equality for selectors |

---

## useFact

Subscribe to a single fact or multiple facts. Returns a reactive `Ref`.

```typescript
// Single key
function useFact<T>(system: System, factKey: string): Ref<T | undefined>

// Multi-key
function useFact<T extends Record<string, unknown>>(system: System, factKeys: string[]): ShallowRef<T>
```

### useFact Usage

```html
<script setup>
import { useFact } from '@directive-run/vue';
import { system } from './system';

// Subscribe to a single fact – returns Ref<number | undefined>
const count = useFact(system, 'count');

// Subscribe to multiple facts – returns ShallowRef<{ userId, loading }>
const multi = useFact(system, ['userId', 'loading']);
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
function useDerived<T>(system: System, derivationId: string): Ref<T>

// Multi-key
function useDerived<T extends Record<string, unknown>>(system: System, derivationIds: string[]): ShallowRef<T>
```

### useDerived Usage

```html
<script setup>
import { useDerived } from '@directive-run/vue';
import { system } from './system';

// Subscribe to a single derivation
const total = useDerived(system, 'cartTotal');

// Subscribe to multiple derivations at once
const state = useDerived(system, ['isRed', 'elapsed']);
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
  system: System,
  selector: (facts: Record<string, unknown>) => R,
  equalityFn?: (a: R, b: R) => boolean,
): Ref<R>
```

### useSelector Usage

```html
<script setup>
import { useSelector, shallowEqual } from '@directive-run/vue';
import { system } from './system';

// Select and combine values from multiple facts with shallow equality
const summary = useSelector(
  system,
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
function useEvents<M extends ModuleSchema>(system: System<M>): System<M>["events"]
```

### useEvents Usage

```html
<script setup>
import { useEvents } from '@directive-run/vue';
import { system } from './system';

// Get typed event dispatchers for the module
const events = useEvents(system);
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
function useDispatch<M extends ModuleSchema>(system: System<M>): (event: InferEvents<M>) => void
```

### useDispatch Usage

```html
<script setup>
import { useDispatch } from '@directive-run/vue';
import { system } from './system';

// Get the low-level dispatch function
const dispatch = useDispatch(system);
</script>

<template>
  <button @click="dispatch({ type: 'increment' })">+1</button>
</template>
```

---

## useWatch

Watch a fact or derivation and execute a callback when it changes. Auto-detects whether the key refers to a fact or a derivation – no discriminator needed. Does not cause re-renders; use for side effects only.

```typescript
// Unified API – auto-detects fact vs derivation
function useWatch<T>(
  system: System,
  key: string,
  callback: (newValue: T, previousValue: T | undefined) => void,
): void

// Deprecated – still works but prefer the unified form above
function useWatch<T>(
  system: System,
  kind: "fact",
  factKey: string,
  callback: (newValue: T | undefined, previousValue: T | undefined) => void,
): void
```

### useWatch Usage

```html
<script setup>
import { useWatch } from '@directive-run/vue';
import { system } from './system';

// Watch a derivation – auto-detected
useWatch(system, 'pageViews', (newVal, prevVal) => {
  analytics.track('pageViews', { from: prevVal, to: newVal });
});

// Watch a fact – also auto-detected, no "fact" discriminator needed
useWatch(system, 'userId', (newId, prevId) => {
  console.log(`User changed from ${prevId} to ${newId}`);
});
</script>
```

{% callout type="warning" title="Deprecated pattern" %}
The four-argument form `useWatch(system, "fact", "key", cb)` still works but is deprecated. Use `useWatch(system, "key", cb)` instead.
{% /callout %}

---

## useInspect

Get system inspection data reactively. Supports optional throttling for high-frequency updates.

```typescript
function useInspect(system: System, options?: { throttleMs?: number }): ShallowRef<InspectState>
```

### useInspect Returns

```typescript
interface InspectState {
  isSettled: boolean;
  unmet: Requirement[];
  inflight: Requirement[];
  isWorking: boolean;
  hasUnmet: boolean;
  hasInflight: boolean;
}
```

### useInspect Usage

```html
<script setup>
import { useInspect } from '@directive-run/vue';
import { system } from './system';

// Get reactive system inspection data
const inspection = useInspect(system);

// With throttling to limit update frequency
const throttled = useInspect(system, { throttleMs: 200 });
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
function useConstraintStatus(system: System): ComputedRef<ConstraintInfo[]>

// Single constraint
function useConstraintStatus(system: System, constraintId: string): ComputedRef<ConstraintInfo | null>
```

### useConstraintStatus Usage

```html
<script setup>
import { useConstraintStatus } from '@directive-run/vue';
import { system } from './system';

// Get all constraints for the debug panel
const allConstraints = useConstraintStatus(system);

// Check a specific constraint by ID
const transition = useConstraintStatus(system, 'transition');
</script>

<template>
  <p v-if="transition">Constraint active: {{ transition.id }}</p>
  <ul>
    <li v-for="c in allConstraints" :key="c.id">{{ c.id }}: {{ c.active }}</li>
  </ul>
</template>
```

---

## useExplain

Reactively returns the explanation string for a requirement type.

```typescript
function useExplain(system: System, requirementId: string): Ref<string | null>
```

### useExplain Usage

```html
<script setup>
import { useExplain } from '@directive-run/vue';
import { system } from './system';

// Get a detailed explanation of why a requirement was generated
const explanation = useExplain(system, 'FETCH_USER');
</script>

<template>
  <p v-if="explanation">Why: {{ explanation }}</p>
</template>
```

---

## useRequirementStatus

Get requirement status reactively. Takes the `statusPlugin` as the first parameter.

```typescript
// Single type
function useRequirementStatus(statusPlugin: StatusPlugin, type: string): ShallowRef<RequirementTypeStatus>

// Multi-type
function useRequirementStatus(statusPlugin: StatusPlugin, types: string[]): ShallowRef<Record<string, RequirementTypeStatus>>
```

### useRequirementStatus Returns

```typescript
interface RequirementTypeStatus {
  pending: number;
  inflight: number;
  failed: number;
  isLoading: boolean;
  hasError: boolean;
  lastError: Error | null;
}
```

### useRequirementStatus Usage

```html
<script setup>
import { useRequirementStatus } from '@directive-run/vue';
import { statusPlugin } from './system';

// Track a single requirement type
const status = useRequirementStatus(statusPlugin, 'FETCH_USER');

// Track multiple requirement types at once
const multi = useRequirementStatus(statusPlugin, ['FETCH_USER', 'FETCH_POSTS']);
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
  system: System,
  statusPlugin?: StatusPlugin,
  requirementType?: string,
): OptimisticUpdateResult
```

### useOptimisticUpdate Returns

```typescript
interface OptimisticUpdateResult {
  mutate: (updateFn: () => void) => void;
  isPending: Ref<boolean>;
  error: Ref<Error | null>;
  rollback: () => void;
}
```

### useOptimisticUpdate Usage

```html
<script setup>
import { useOptimisticUpdate } from '@directive-run/vue';
import { system, statusPlugin } from './system';

// Set up optimistic mutations with automatic rollback
const { mutate, isPending, error, rollback } = useOptimisticUpdate(system, statusPlugin, 'TOGGLE_LIKE');

function toggleLike() {
  // Optimistically update the UI before the server responds
  mutate(() => {
    system.facts.liked = !system.facts.liked;
    system.facts.likeCount += system.facts.liked ? 1 : -1;
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

## useDirective

Create a scoped Directive system tied to the component lifecycle. The system is created on mount, started automatically, and destroyed on unmount. Two modes:

- **Selective** – pass `facts` and/or `derived` keys to subscribe to specific state
- **Subscribe all** – omit keys to subscribe to all facts and derivations

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

### useDirective Usage

```html
<script setup>
import { useDirective } from '@directive-run/vue';
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

```html
<script setup>
import { useDirective } from '@directive-run/vue';
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

Factory function that returns typed versions of the core composables for a specific module schema. Provides full autocompletion for fact keys, derivation IDs, and event types. Returned hooks take `system` as the first parameter.

```typescript
function createTypedHooks<M extends ModuleSchema>(): {
  useFact: <K extends keyof InferFacts<M>>(system: System<M>, factKey: K) => Ref<InferFacts<M>[K] | undefined>;
  useDerived: <K extends keyof InferDerivations<M>>(system: System<M>, derivationId: K) => Ref<InferDerivations<M>[K]>;
  useDispatch: (system: System<M>) => (event: InferEvents<M>) => void;
  useEvents: (system: System<M>) => System<M>["events"];
}
```

### createTypedHooks Usage

```typescript
// typed-hooks.ts
import { createTypedHooks } from '@directive-run/vue';
import type { MyModuleSchema } from './my-module';

// Create typed composables – full autocomplete for fact keys and event types
export const { useFact, useDerived, useDispatch, useEvents } =
  createTypedHooks<MyModuleSchema>();
```

```html
<script setup>
import { useFact, useDerived } from './typed-hooks';
import { system } from './system';

// Fully typed – factKey autocompletes, return type inferred
const count = useFact(system, 'count');       // Ref<number | undefined>

// Derivation types are also fully inferred
const total = useDerived(system, 'cartTotal'); // Ref<number>
</script>
```

---

## useTimeTravel

Reactive time-travel composable. Returns a `ShallowRef` that updates when snapshots are taken or navigation occurs. Returns `null` when time-travel is disabled.

```typescript
function useTimeTravel(system: System): ShallowRef<TimeTravelState | null>
```

### useTimeTravel Returns

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

### useTimeTravel Usage

```html
<script setup>
import { useTimeTravel } from '@directive-run/vue';
import { system } from './system';

// Get reactive time-travel controls (null when disabled)
const tt = useTimeTravel(system);
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

### shallowEqual Usage

```html
<script setup>
import { useSelector, shallowEqual } from '@directive-run/vue';
import { system } from './system';

// Use shallowEqual to prevent updates when x/y values haven't changed
const coords = useSelector(
  system,
  (facts) => ({ x: facts.x, y: facts.y }),
  shallowEqual,
);
</script>
```

---

## Next Steps

- [Core API](/docs/api/core) – System functions
- [Types](/docs/api/types) – Type definitions
- [Vue Adapter](/docs/adapters/vue) – Setup and patterns
