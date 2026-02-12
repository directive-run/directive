---
title: Svelte Hooks
description: Complete API reference for all Svelte hooks exported from directive/svelte. All hooks take system as an explicit first parameter.
---

Svelte hooks API reference. All hooks take `system` as an explicit first parameter — no context injection needed. Values are returned as Svelte `Readable` stores. {% .lead %}

---

## Quick Reference

| Export | Type | Description |
|---|---|---|
| `useFact` | Hook | Read single/multi facts — `useFact(system, key)` |
| `useDerived` | Hook | Read single/multi derivations — `useDerived(system, id)` |
| `useSelector` | Hook | Select from all facts with custom equality — `useSelector(system, selector, eq?)` |
| `useEvents` | Hook | Typed event dispatchers — `useEvents(system)` |
| `useDispatch` | Hook | Low-level event dispatch — `useDispatch(system)` |
| `useWatch` | Hook | Side-effect watcher (auto-detects kind) — `useWatch(system, key, cb)` |
| `useInspect` | Hook | System inspection with optional throttle — `useInspect(system, options?)` |
| `useConstraintStatus` | Hook | Reactive constraint inspection — `useConstraintStatus(system, constraintId?)` |
| `useExplain` | Hook | Reactive requirement explanation — `useExplain(system, reqId)` |
| `useRequirementStatus` | Hook | Requirement status — `useRequirementStatus(statusPlugin, type)` |
| `useOptimisticUpdate` | Hook | Optimistic mutations with rollback — `useOptimisticUpdate(system, statusPlugin?, type?)` |
| `useDirective` | Hook | Scoped system with selected or all subscriptions |
| `useTimeTravel` | Hook | Reactive time-travel state — `useTimeTravel(system)` |
| `createTypedHooks` | Factory | Create fully typed hooks for a schema |
| `createFactStore` | Factory | Fact store outside components |
| `createDerivedStore` | Factory | Derivation store outside components |
| `createDerivedsStore` | Factory | Multi-derivation store outside components |
| `createInspectStore` | Factory | Inspection store outside components |
| `shallowEqual` | Utility | Shallow equality for selectors |

---

## useFact

Subscribe to a single fact or multiple facts. Returns a Svelte `Readable` store.

```typescript
function useFact<K extends string>(system: System, key: K): Readable<InferFacts<S>[K]>
function useFact<K extends string[]>(system: System, keys: K): Readable<Record<K[number], unknown>>
```

### Usage

```svelte
<script>
  import { useFact } from 'directive/svelte';
  import { system } from '$lib/directive';

  // Subscribe to a single fact value
  const count = useFact(system, 'count');

  // Subscribe to multiple facts at once
  const multi = useFact(system, ['count', 'name']);
</script>

<p>Count: {$count}</p>
<p>Name: {$multi.name}, Count: {$multi.count}</p>
```

{% callout type="note" title="Need a transform?" %}
Use [`useSelector`](#useselector) to derive values from facts. It auto-tracks dependencies and supports custom equality.
{% /callout %}

---

## useDerived

Subscribe to a single derivation or multiple derivations. Returns a Svelte `Readable` store.

```typescript
function useDerived<K extends string>(system: System, key: K): Readable<InferDerivations<S>[K]>
function useDerived<K extends string[]>(system: System, keys: K): Readable<Record<K[number], unknown>>
```

### Usage

```svelte
<script>
  import { useDerived } from 'directive/svelte';
  import { system } from '$lib/directive';

  // Subscribe to a single derivation
  const total = useDerived(system, 'cartTotal');

  // Subscribe to multiple derivations at once
  const stats = useDerived(system, ['isRed', 'elapsed']);
</script>

<p>Total: ${$total}</p>
<p>{$stats.isRed ? `Red for ${$stats.elapsed}s` : 'Not red'}</p>
```

{% callout type="note" title="Need a transform?" %}
Use [`useSelector`](#useselector) to derive values from facts. It auto-tracks dependencies and supports custom equality.
{% /callout %}

---

## useSelector

Select values from the entire facts store with an optional custom equality function. Returns a Svelte `Readable` store.

```typescript
function useSelector<R>(
  system: System,
  selector: (facts: Record<string, any>) => R,
  equalityFn?: (a: R, b: R) => boolean,
): Readable<R>
```

### Usage

```svelte
<script>
  import { useSelector } from 'directive/svelte';
  import { system } from '$lib/directive';

  // Select and combine values from multiple facts
  const summary = useSelector(system, (facts) => ({
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
function useEvents(system: System): TypedEventDispatchers
```

### Usage

```svelte
<script>
  import { useEvents } from 'directive/svelte';
  import { system } from '$lib/directive';

  // Get typed event dispatchers for the module
  const events = useEvents(system);
</script>

<button on:click={() => events.increment({ amount: 1 })}>
  Increment
</button>
```

---

## useDispatch

Get the low-level dispatch function for sending events.

```typescript
function useDispatch(system: System): (event: SystemEvent) => void
```

### Usage

```svelte
<script>
  import { useDispatch } from 'directive/svelte';
  import { system } from '$lib/directive';

  // Get the low-level dispatch function
  const dispatch = useDispatch(system);
</script>

<button on:click={() => dispatch({ type: 'increment' })}>
  Increment
</button>
```

---

## useWatch

Execute a side-effect callback when a fact or derivation changes. Auto-detects whether the key refers to a fact or a derivation -- no discriminator needed. Does not return a store; used for effects only. Automatically cleaned up when the component is destroyed.

```typescript
// Unified API – auto-detects fact vs derivation
function useWatch<T>(
  system: System,
  key: string,
  callback: (newValue: T, prevValue: T | undefined) => void,
): void

// Deprecated – still works but prefer the unified form above
function useWatch<T>(
  system: System,
  type: "fact",
  factKey: string,
  callback: (newValue: T, prevValue: T | undefined) => void,
): void
```

### Usage

```svelte
<script>
  import { useWatch } from 'directive/svelte';
  import { system } from '$lib/directive';

  // Watch a derivation – auto-detected
  useWatch(system, 'pageViews', (newValue, prevValue) => {
    analytics.track('pageViews', { from: prevValue, to: newValue });
  });

  // Watch a fact – also auto-detected, no "fact" discriminator needed
  useWatch(system, 'count', (newValue) => {
    console.log('Count changed to', newValue);
  });
</script>
```

{% callout type="warning" title="Deprecated pattern" %}
The four-argument form `useWatch(system, "fact", "key", cb)` still works but is deprecated. Use `useWatch(system, "key", cb)` instead.
{% /callout %}

---

## useInspect

Get system inspection data reactively. Supports an optional throttle to limit update frequency.

```typescript
function useInspect(system: System, opts?: { throttleMs?: number }): Readable<InspectState>
```

### Usage

```svelte
<script>
  import { useInspect } from 'directive/svelte';
  import { system } from '$lib/directive';

  // Get reactive system inspection data with throttled updates
  const inspection = useInspect(system, { throttleMs: 200 });
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
function useConstraintStatus(system: System): Readable<ConstraintInfo[]>
function useConstraintStatus(system: System, constraintId: string): Readable<ConstraintInfo | null>
```

```typescript
interface ConstraintInfo {
  id: string;
  active: boolean;
  priority: number;
}
```

### Usage

```svelte
<script>
  import { useConstraintStatus } from 'directive/svelte';
  import { system } from '$lib/directive';

  // Check a specific constraint by ID
  const status = useConstraintStatus(system, 'transition');
</script>

{#if $status}
  <p>Constraint "{$status.id}" is {$status.active ? 'active' : 'inactive'} (priority: {$status.priority})</p>
{/if}
```

---

## useExplain

Get a reactive explanation of why a requirement was generated and how it was resolved.

```typescript
function useExplain(system: System, requirementType: string): Readable<string | null>
```

### Usage

```svelte
<script>
  import { useExplain } from 'directive/svelte';
  import { system } from '$lib/directive';

  // Get a reactive explanation string for a requirement
  const explanation = useExplain(system, 'FETCH_USER');
</script>

{#if $explanation}
  <p>{$explanation}</p>
{/if}
```

---

## useRequirementStatus

Get requirement status reactively. Takes `statusPlugin` as its first parameter (not `system`). Supports a single type or multiple types.

```typescript
function useRequirementStatus(statusPlugin: StatusPlugin, type: string): Readable<RequirementTypeStatus>
function useRequirementStatus(statusPlugin: StatusPlugin, types: string[]): Readable<Record<string, RequirementTypeStatus>>
```

### Usage

```svelte
<script>
  import { useRequirementStatus } from 'directive/svelte';

  // statusPlugin is created via createRequirementStatusPlugin()
  // and passed to createSystem({ plugins: [statusPlugin.plugin] })

  // Track the loading state of a specific requirement type
  const status = useRequirementStatus(statusPlugin, 'FETCH_USER');
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
function useOptimisticUpdate(
  system: System,
  statusPlugin?: StatusPlugin,
  requirementType?: string,
): OptimisticUpdateResult
```

```typescript
interface OptimisticUpdateResult {
  mutate: (updateFn: () => void) => void;
  isPending: Readable<boolean>;
  error: Readable<Error | null>;
  rollback: () => void;
}
```

### Usage

```svelte
<script>
  import { useOptimisticUpdate } from 'directive/svelte';
  import { system } from '$lib/directive';

  // Set up optimistic mutations with automatic rollback
  const { mutate, isPending, error, rollback } = useOptimisticUpdate(system, statusPlugin, 'UPDATE_ITEM');

  function updateName(name) {
    // Optimistically update facts; rolls back automatically on resolver failure
    mutate(() => {
      system.facts.item = { ...system.facts.item, name };
    });
  }
</script>

<input on:change={(e) => updateName(e.target.value)} />
{#if $isPending}<span>Saving...</span>{/if}
{#if $error}<span>Failed: {$error.message}</span>{/if}
```

---

## useDirective

Create a scoped system tied to the component lifecycle. Two modes:

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
  facts: Readable<InferFacts<M>>;
  derived: Readable<InferDerivations<M>>;
  events: System<M>["events"];
  dispatch: (event: InferEvents<M>) => void;
  statusPlugin?: StatusPlugin;
}
```

### Usage

```svelte
<script>
  import { useDirective } from 'directive/svelte';
  import { counterModule } from './modules/counter';

  // Subscribe all: omit keys for everything
  const { facts, derived, events, dispatch } = useDirective(counterModule);
</script>

<p>Count: {$facts.count}</p>
<p>Doubled: {$derived.doubled}</p>
<button on:click={() => events.increment()}>+</button>
```

Selective subscriptions:

```svelte
<script>
  import { useDirective } from 'directive/svelte';
  import { counterModule } from './modules/counter';

  // Selective: subscribe to specific keys only
  const { facts, derived, dispatch } = useDirective(counterModule, {
    facts: ['count'],
    derived: ['doubled'],
  });
</script>

<p>Count: {$facts.count}</p>
<button on:click={() => dispatch({ type: 'increment' })}>+</button>
```

---

## createTypedHooks

Factory that creates fully typed hooks for a specific module schema. The returned hooks still take `system` as the first parameter but provide full autocomplete for keys and events.

```typescript
function createTypedHooks<M extends ModuleSchema>(): {
  useFact: <K extends keyof InferFacts<M>>(system: System, factKey: K) => Readable<InferFacts<M>[K] | undefined>;
  useDerived: <K extends keyof InferDerivations<M>>(system: System, derivationId: K) => Readable<InferDerivations<M>[K]>;
  useDispatch: (system: System) => (event: InferEvents<M>) => void;
  useEvents: (system: System) => System<M>["events"];
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
  import { system } from '$lib/directive';

  // Fully typed – fact key autocompletes, return type inferred
  const count = useFact(system, 'count');

  // Typed event dispatchers
  const events = useEvents(system);
</script>
```

---

## Store Factories

Create Svelte `Readable` stores outside of components. These take the system as a parameter and can be used in plain `.ts` files.

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
function useTimeTravel(system: System): Readable<TimeTravelState | null>
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
  import { system } from '$lib/directive';

  // Get reactive time-travel controls (null when disabled)
  const tt = useTimeTravel(system);
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
  import { system } from '$lib/directive';

  // Use shallowEqual to prevent updates when values haven't changed
  const summary = useSelector(
    system,
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
