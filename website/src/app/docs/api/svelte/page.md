---
title: Svelte Hooks
description: Complete API reference for all Svelte hooks exported from directive/svelte. Context injection – hooks access the system via setDirectiveContext.
---

Svelte hooks API reference. All hooks access the system via context injection – no system parameter needed. Values are returned as Svelte `Readable` stores. {% .lead %}

---

## Setup

Set the context at the root component:

```svelte
<script>
  import { setDirectiveContext } from 'directive/svelte';
  import { createSystem } from 'directive';
  import { myModule } from './modules/my-module';

  // Create and start the system
  const system = createSystem({ module: myModule });
  system.start();

  // Make the system available to all child components
  setDirectiveContext(system);
</script>

<slot />
```

---

## Quick Reference

| Export | Type | Description |
|---|---|---|
| `useFact` | Hook | Read single/multi facts or apply selector |
| `useDerived` | Hook | Read single/multi derivations or apply selector |
| `useSelector` | Hook | Select from all facts with custom equality |
| `useEvents` | Hook | Typed event dispatchers |
| `useDispatch` | Hook | Low-level event dispatch |
| `useSystem` | Hook | Access full system instance |
| `useWatch` | Hook | Side-effect watcher for facts or derivations (auto-detects kind) |
| `useModule` | Hook | Zero-config scoped system |
| `useInspect` | Hook | System inspection with optional throttle |
| `useConstraintStatus` | Hook | Reactive constraint inspection |
| `useExplain` | Hook | Reactive requirement explanation |
| `useRequirementStatus` | Hook | Single/multi requirement status |
| `useOptimisticUpdate` | Hook | Optimistic mutations with rollback |
| `useDirective` | Hook | Scoped system tied to component lifecycle |
| `createTypedHooks` | Factory | Create fully typed hooks for a schema |
| `createFactStore` | Factory | Fact store outside components |
| `createDerivedStore` | Factory | Derivation store outside components |
| `createDerivedsStore` | Factory | Multi-derivation store outside components |
| `createInspectStore` | Factory | Inspection store outside components |
| `useTimeTravel` | Hook | Reactive time-travel state |
| `shallowEqual` | Utility | Shallow equality for selectors |

---

## useFact

Subscribe to a single fact, multiple facts, or apply a selector. Returns a Svelte `Readable` store.

```typescript
function useFact<K extends string>(key: K): Readable<InferFacts<S>[K]>
function useFact<K extends string[]>(keys: K): Readable<Record<K[number], unknown>>
function useFact<K extends string, R>(
  key: K,
  selector: (value: InferFacts<S>[K]) => R,
  equalityFn?: (a: R, b: R) => boolean,
): Readable<R>
```

### Usage

```svelte
<script>
  import { useFact } from 'directive/svelte';

  // Subscribe to a single fact value
  const count = useFact('count');

  // Subscribe to multiple facts at once
  const multi = useFact(['count', 'name']);

  // Derive a value from a fact with a selector
  const doubled = useFact('count', (c) => c * 2);
</script>

<p>Count: {$count}</p>
<p>Name: {$multi.name}, Count: {$multi.count}</p>
<p>Doubled: {$doubled}</p>
```

---

## useDerived

Subscribe to a single derivation, multiple derivations, or apply a selector. Returns a Svelte `Readable` store.

```typescript
function useDerived<K extends string>(key: K): Readable<InferDerivations<S>[K]>
function useDerived<K extends string[]>(keys: K): Readable<Record<K[number], unknown>>
function useDerived<K extends string, R>(
  key: K,
  selector: (value: InferDerivations<S>[K]) => R,
  equalityFn?: (a: R, b: R) => boolean,
): Readable<R>
```

### Usage

```svelte
<script>
  import { useDerived } from 'directive/svelte';

  // Subscribe to a single derivation
  const total = useDerived('cartTotal');

  // Subscribe to multiple derivations at once
  const stats = useDerived(['isRed', 'elapsed']);

  // Derive a value from a derivation with a selector
  const label = useDerived('status', (s) => s.label);
</script>

<p>Total: ${$total}</p>
<p>{$stats.isRed ? `Red for ${$stats.elapsed}s` : 'Not red'}</p>
<p>Label: {$label}</p>
```

---

## useSelector

Select values from the entire facts store with an optional custom equality function. Returns a Svelte `Readable` store.

```typescript
function useSelector<R>(
  selector: (facts: Record<string, any>) => R,
  equalityFn?: (a: R, b: R) => boolean,
): Readable<R>
```

### Usage

```svelte
<script>
  import { useSelector } from 'directive/svelte';

  // Select and combine values from multiple facts
  const summary = useSelector((facts) => ({
    userName: facts.user?.name,
    itemCount: facts.items?.length ?? 0,
  }));
</script>

<p>{$summary.userName} has {$summary.itemCount} items</p>
```

---

## useEvents

Get typed event dispatchers for all events defined in the module schema.

```typescript
function useEvents(): TypedEventDispatchers
```

### Usage

```svelte
<script>
  import { useEvents } from 'directive/svelte';

  // Get typed event dispatchers for the module
  const events = useEvents();
</script>

<button on:click={() => events.increment({ amount: 1 })}>
  Increment
</button>
```

---

## useDispatch

Get the low-level dispatch function for sending events.

```typescript
function useDispatch(): (event: SystemEvent) => void
```

### Usage

```svelte
<script>
  import { useDispatch } from 'directive/svelte';

  // Get the low-level dispatch function
  const dispatch = useDispatch();
</script>

<button on:click={() => dispatch({ type: 'increment' })}>
  Increment
</button>
```

---

## useSystem

Access the full system instance.

```typescript
function useSystem(): SingleModuleSystem<S>
```

### Usage

```svelte
<script>
  import { useSystem } from 'directive/svelte';

  // Access the full system instance for advanced operations
  const system = useSystem();

  function stopSystem() {
    system.stop();
  }
</script>

<button on:click={stopSystem}>Stop</button>
```

---

## useWatch

Execute a side-effect callback when a fact or derivation changes. Auto-detects whether the key refers to a fact or a derivation -- no discriminator needed. Does not return a store; used for effects only. Automatically cleaned up when the component is destroyed.

```typescript
// Unified API – auto-detects fact vs derivation
function useWatch<T>(
  key: string,
  callback: (newValue: T, prevValue: T | undefined) => void,
): void

// Deprecated – still works but prefer the unified form above
function useWatch<T>(
  type: "fact",
  factKey: string,
  callback: (newValue: T, prevValue: T | undefined) => void,
): void
```

### Usage

```svelte
<script>
  import { useWatch } from 'directive/svelte';

  // Watch a derivation – auto-detected
  useWatch('pageViews', (newValue, prevValue) => {
    analytics.track('pageViews', { from: prevValue, to: newValue });
  });

  // Watch a fact – also auto-detected, no "fact" discriminator needed
  useWatch('count', (newValue) => {
    console.log('Count changed to', newValue);
  });
</script>
```

{% callout type="warning" title="Deprecated pattern" %}
The three-argument form `useWatch("fact", "key", cb)` still works but is deprecated. Use the two-argument form `useWatch("key", cb)` instead.
{% /callout %}

---

## useModule

Create a zero-config scoped system from a module definition. The system is tied to the component lifecycle – started on mount, stopped on destroy.

```typescript
function useModule<M>(module: ModuleDef<M>): {
  system: SingleModuleSystem<M>;
  facts: FactsProxy;
  events: TypedEventDispatchers;
  derive: DerivedAccessors;
}
```

### Usage

```svelte
<script>
  import { useModule } from 'directive/svelte';
  import { counterModule } from './modules/counter';

  // Get everything in one call – system, facts, derivations, and events
  const { facts, events, derive } = useModule(counterModule);

  // Subscribe to a derived value
  const count = derive.count;
</script>

<p>Count: {$count}</p>
<button on:click={() => events.increment()}>+</button>
```

---

## useInspect

Get system inspection data reactively. Supports an optional throttle to limit update frequency.

```typescript
function useInspect(opts?: { throttleMs?: number }): Readable<SystemInspection>
```

### Usage

```svelte
<script>
  import { useInspect } from 'directive/svelte';

  // Get reactive system inspection data with throttled updates
  const inspection = useInspect({ throttleMs: 200 });
</script>

<pre>
  Unmet: {$inspection.unmet.length}
  Inflight: {$inspection.inflight.length}
  Settled: {$inspection.isSettled}
</pre>
```

---

## useConstraintStatus

Get reactive constraint inspection data. Optionally filter by constraint ID.

```typescript
function useConstraintStatus(constraintId?: string): Readable<ConstraintStatus>
```

### Usage

```svelte
<script>
  import { useConstraintStatus } from 'directive/svelte';

  // Check a specific constraint by ID
  const status = useConstraintStatus('transition');
</script>

{#if $status.active}
  <p>Constraint "{$status.id}" is active</p>
{/if}
```

---

## useExplain

Get a reactive explanation of why a requirement was generated and how it was resolved.

```typescript
function useExplain(requirementType: string): Readable<ExplanationResult>
```

### Usage

```svelte
<script>
  import { useExplain } from 'directive/svelte';

  // Get a detailed explanation of why a requirement was generated
  const explanation = useExplain('FETCH_USER');
</script>

{#if $explanation}
  <p>Source: {$explanation.source}</p>
  <p>Status: {$explanation.status}</p>
{/if}
```

---

## useRequirementStatus

Get requirement status reactively. Supports a single type or multiple types.

```typescript
function useRequirementStatus(type: string): Readable<RequirementTypeStatus>
function useRequirementStatus(types: string[]): Readable<Map<string, RequirementTypeStatus>>
```

### Usage

```svelte
<script>
  import { useRequirementStatus } from 'directive/svelte';

  // Track the loading state of a specific requirement type
  const status = useRequirementStatus('FETCH_USER');
</script>

{#if $status.isLoading}
  <p>Loading...</p>
{:else if $status.hasError}
  <p>Error: {$status.lastError?.message}</p>
{:else}
  <p>User loaded</p>
{/if}
```

---

## useOptimisticUpdate

Perform optimistic mutations with automatic rollback on failure. Returns a dispatch function and status.

```typescript
function useOptimisticUpdate(requirementType: string): OptimisticUpdateResult
```

```typescript
interface OptimisticUpdateResult {
  dispatch: (mutation: (facts: FactsProxy) => void) => void;
  isPending: Readable<boolean>;
  error: Readable<Error | null>;
}
```

### Usage

```svelte
<script>
  import { useOptimisticUpdate } from 'directive/svelte';

  // Set up optimistic mutations with automatic rollback
  const { dispatch, isPending, error } = useOptimisticUpdate('UPDATE_ITEM');

  function updateName(name) {
    // Optimistically update the UI before the server responds
    dispatch((facts) => {
      facts.item = { ...facts.item, name };
    });
  }
</script>

<input on:change={(e) => updateName(e.target.value)} />
{#if $isPending}<span>Saving...</span>{/if}
{#if $error}<span>Failed: {$error.message}</span>{/if}
```

---

## useDirective

Create a scoped system tied to the component lifecycle. Started on mount, stopped on destroy. Returns the system and all subscription helpers.

```typescript
function useDirective<M>(
  module: ModuleDef<M>,
  opts?: { plugins?; debug?; initialFacts? },
): {
  system: SingleModuleSystem<M>;
  fact: typeof useFact;
  derived: typeof useDerived;
  events: TypedEventDispatchers;
  dispatch: (event: SystemEvent) => void;
  inspect: Readable<SystemInspection>;
}
```

### Usage

```svelte
<script>
  import { useDirective } from 'directive/svelte';
  import { counterModule } from './modules/counter';

  // Create a scoped system tied to this component's lifecycle
  const { fact, events } = useDirective(counterModule);

  // Subscribe to the current count
  const count = fact('count');
</script>

<p>Count: {$count}</p>
<button on:click={() => events.increment()}>+</button>
```

---

## createTypedHooks

Factory that creates fully typed hooks for a specific module schema. Useful when you want autocomplete without passing the system every time.

```typescript
function createTypedHooks<S extends ModuleSchema>(): {
  useFact: TypedUseFact<S>;
  useDerived: TypedUseDerived<S>;
  useSelector: TypedUseSelector<S>;
  useEvents: TypedUseEvents<S>;
  useDispatch: TypedUseDispatch<S>;
  useWatch: TypedUseWatch<S>;
  useRequirementStatus: TypedUseRequirementStatus<S>;
}
```

### Usage

```typescript
// hooks.ts
import { createTypedHooks } from 'directive/svelte';
import type { MyModuleSchema } from './modules/my-module';

// Create typed hooks – full autocomplete for fact keys and event types
export const {
  useFact,
  useDerived,
  useEvents,
} = createTypedHooks<MyModuleSchema>();
```

```svelte
<script>
  import { useFact, useEvents } from './hooks';

  // Fully typed – fact key autocompletes, return type inferred
  const count = useFact('count');

  // Typed event dispatchers
  const events = useEvents();
</script>
```

---

## Store Factories

Create Svelte `Readable` stores outside of components. Unlike hooks, these take the system as a parameter and can be used in plain `.ts` files.

### createFactStore

```typescript
function createFactStore<K extends string>(
  system: SingleModuleSystem<any>,
  key: K,
): Readable<InferFacts<S>[K]>
```

### createDerivedStore

```typescript
function createDerivedStore<K extends string>(
  system: SingleModuleSystem<any>,
  key: K,
): Readable<InferDerivations<S>[K]>
```

### createDerivedsStore

```typescript
function createDerivedsStore(
  system: SingleModuleSystem<any>,
  keys: string[],
): Readable<Record<string, unknown>>
```

### createInspectStore

```typescript
function createInspectStore(
  system: SingleModuleSystem<any>,
  opts?: { throttleMs?: number },
): Readable<SystemInspection>
```

### Usage

```typescript
// stores.ts – create stores outside of components
import { createFactStore, createDerivedStore } from 'directive/svelte';

// Subscribe to a single fact as a Readable store
export const count$ = createFactStore(system, 'count');

// Subscribe to a derivation as a Readable store
export const total$ = createDerivedStore(system, 'cartTotal');
```

```svelte
<script>
  import { count$, total$ } from './stores';
</script>

<p>Count: {$count$}, Total: {$total$}</p>
```

---

## useTimeTravel

Reactive time-travel state. Returns a `Readable` store containing the time-travel controls, or `null` when time-travel is disabled.

```typescript
function useTimeTravel(): Readable<TimeTravelState | null>
```

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

```svelte
<script>
  import { useTimeTravel } from 'directive/svelte';

  // Get reactive time-travel controls (null when disabled)
  const tt = useTimeTravel();
</script>

{#if $tt}
  <button on:click={$tt.undo} disabled={!$tt.canUndo}>Undo</button>
  <button on:click={$tt.redo} disabled={!$tt.canRedo}>Redo</button>
  <span>{$tt.currentIndex + 1} / {$tt.totalSnapshots}</span>
{/if}
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

Utility function for shallow equality comparison. Useful as an `equalityFn` for selectors to prevent unnecessary store updates.

```typescript
function shallowEqual(a: unknown, b: unknown): boolean
```

### Usage

```svelte
<script>
  import { useSelector, shallowEqual } from 'directive/svelte';

  // Use shallowEqual to prevent updates when values haven't changed
  const summary = useSelector(
    (facts) => ({ name: facts.name, count: facts.count }),
    shallowEqual,
  );
</script>

<p>{$summary.name}: {$summary.count}</p>
```

---

## Next Steps

- See [Core API](/docs/api/core) for system functions
- See [Types](/docs/api/types) for type definitions
- See [Svelte Adapter](/docs/adapters/svelte) for setup and patterns
