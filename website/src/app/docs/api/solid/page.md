---
title: Solid Hooks
description: Complete API reference for all Solid hooks exported from @directive-run/solid. Explicit system parameter – hooks take the system directly, no provider needed.
---

Solid hooks API reference. All hooks take the system as an explicit first parameter – no provider or context needed. Values are returned as Solid `Accessor` functions. {% .lead %}

---

## Setup

Create a system and pass it directly to hooks:

```tsx
import { createSystem } from '@directive-run/core';

// Create and start the system
const system = createSystem({ module: myModule });
system.start();

// Pass `system` to hooks in any component – no provider needed
```

---

## Quick Reference

| Export | Type | Description |
|---|---|---|
| `useFact` | Hook | Read single/multi facts |
| `useDerived` | Hook | Read single/multi derivations |
| `useSelector` | Hook | Select across all facts |
| `useEvents` | Hook | Typed event dispatchers |
| `useDispatch` | Hook | Low-level event dispatch |
| `useWatch` | Hook | Side-effect watcher for facts or derivations |
| `useInspect` | Hook | System inspection with optional throttle |
| `useConstraintStatus` | Hook | Reactive constraint inspection |
| `useExplain` | Hook | Reactive requirement explanation |
| `useRequirementStatus` | Hook | Single/multi requirement status (takes statusPlugin) |
| `useSuspenseRequirement` | Hook | Suspense integration for requirements (takes statusPlugin) |
| `useOptimisticUpdate` | Hook | Optimistic mutations with rollback |
| `useDirective` | Hook | Scoped system with selected or all subscriptions |
| `createTypedHooks` | Factory | Create fully typed hooks for a schema |
| `createDerivedSignal` | Factory | Create a derivation signal outside components |
| `createFactSignal` | Factory | Create a fact signal outside components |
| `useHistory` | Hook | Reactive time-travel state |
| `shallowEqual` | Utility | Shallow equality for selectors |

---

## useFact

Subscribe to fact values reactively. Supports single key or multiple keys. Takes `system` as the first parameter.

```typescript
useFact<T>(system: System, factKey: string): Accessor<T | undefined>
useFact<T extends Record<string, unknown>>(system: System, factKeys: string[]): Accessor<T>
```

```tsx
import { useFact } from '@directive-run/solid';

function Counter() {
  // Subscribe to a single fact value
  const count = useFact(system, 'count');

  return <p>Count: {count()}</p>;
}

function Status() {
  // Subscribe to multiple facts at once
  const state = useFact(system, ['count', 'phase']);

  return <p>{state().count} – {state().phase}</p>;
}
```

{% callout type="note" title="Need a transform?" %}
Use [`useSelector`](#useselector) to derive values from facts. It auto-tracks dependencies and supports custom equality.
{% /callout %}

---

## useDerived

Subscribe to derivation values reactively. Supports single key or multiple keys. Takes `system` as the first parameter.

```typescript
useDerived<T>(system: System, derivationId: string): Accessor<T>
useDerived<T extends Record<string, unknown>>(system: System, derivationIds: string[]): Accessor<T>
```

```tsx
import { useDerived } from '@directive-run/solid';

function CartTotal() {
  // Subscribe to a single derivation
  const total = useDerived(system, 'cartTotal');

  return <p>Total: ${total()}</p>;
}

function Stats() {
  // Subscribe to multiple derivations at once
  const stats = useDerived(system, ['isRed', 'elapsed']);

  return <p>{stats().isRed ? `Red for ${stats().elapsed}s` : 'Not red'}</p>;
}
```

{% callout type="note" title="Need a transform?" %}
Use [`useSelector`](#useselector) to derive values from facts. It auto-tracks dependencies and supports custom equality.
{% /callout %}

---

## useSelector

Auto-tracking selector over facts and derivations. Uses `withTracking()` to detect which keys are accessed, then subscribes only to those. Takes `system` as the first parameter.

```typescript
useSelector<R>(system: System, selector: (state: Record<string, unknown>) => R, equalityFn?: (a: R, b: R) => boolean): Accessor<R>
```

```tsx
import { useSelector } from '@directive-run/solid';

function Summary() {
  // Select and combine values from multiple facts
  const summary = useSelector(system, (state) => ({
    userName: state.user?.name,
    itemCount: state.items?.length ?? 0,
  }));

  return <p>{summary().userName} has {summary().itemCount} items</p>;
}
```

---

## useEvents

Returns the system's typed event dispatchers. Takes `system` as the first parameter.

```typescript
useEvents<M extends ModuleSchema>(system: System<M>): System<M>["events"]
```

```tsx
import { useEvents } from '@directive-run/solid';

function Controls() {
  // Get typed event dispatchers for the module
  const events = useEvents(system);

  return <button onClick={() => events.increment()}>+1</button>;
}
```

---

## useDispatch

Get a low-level dispatch function for sending events. Takes `system` as the first parameter.

```typescript
useDispatch<M extends ModuleSchema>(system: System<M>): (event: InferEvents<M>) => void
```

```tsx
import { useDispatch } from '@directive-run/solid';

function IncrementButton() {
  // Get the low-level dispatch function
  const dispatch = useDispatch(system);

  return (
    <button onClick={() => dispatch({ type: 'increment' })}>
      Increment
    </button>
  );
}
```

---

## useWatch

Side-effect watcher for facts or derivations. The key is auto-detected, so no discriminator is needed. Does not cause re-renders. Takes `system` as the first parameter.

```typescript
useWatch<T>(system: System, key: string, callback: (newValue: T, previousValue: T | undefined) => void): void

// Deprecated: "fact" discriminator overload (still works)
useWatch<T>(system: System, kind: "fact", factKey: string, callback: (newValue: T | undefined, previousValue: T | undefined) => void): void
```

```tsx
import { useWatch } from '@directive-run/solid';

function Analytics() {
  // Watch a derivation – auto-detected
  useWatch(system, 'pageViews', (newValue, prevValue) => {
    analytics.track('pageViews', { from: prevValue, to: newValue });
  });

  // Watch a fact – auto-detected, no "fact" discriminator needed
  useWatch(system, 'count', (next, prev) => {
    console.log(`count changed: ${prev} → ${next}`);
  });

  return null;
}
```

{% callout type="warning" title="Deprecated" %}
The four-argument `useWatch(system, "fact", key, callback)` form still works but is deprecated. Use `useWatch(system, key, callback)` instead.
{% /callout %}

---

## useInspect

Consolidated system inspection hook with optional throttling. Takes `system` as the first parameter.

```typescript
useInspect(system: System, options?: { throttleMs?: number }): Accessor<InspectState>
```

```tsx
import { useInspect } from '@directive-run/solid';

function DebugPanel() {
  // Get reactive system inspection data
  const inspection = useInspect(system);

  return (
    <pre>
      Unmet: {inspection().unmet.length}
      Inflight: {inspection().inflight.length}
    </pre>
  );
}

function ThrottledDebug() {
  // Throttle inspection updates to limit render frequency
  const inspection = useInspect(system, { throttleMs: 200 });

  return <p>Settled: {String(inspection().isSettled)}</p>;
}
```

---

## useConstraintStatus

Reactive constraint inspection. Returns all constraints, or a single constraint by ID. Takes `system` as the first parameter.

```typescript
useConstraintStatus(system: System): Accessor<ConstraintInfo[]>
useConstraintStatus(system: System, constraintId: string): Accessor<ConstraintInfo | null>
```

```tsx
import { useConstraintStatus } from '@directive-run/solid';

function ConstraintList() {
  // Get all constraints for the debug panel
  const constraints = useConstraintStatus(system);

  return (
    <ul>
      <For each={constraints()}>{(c) =>
        <li>{c.id}: {c.active ? 'met' : 'unmet'}</li>
      }</For>
    </ul>
  );
}

function TransitionStatus() {
  // Check a specific constraint by ID
  const constraint = useConstraintStatus(system, 'transition');

  return <p>{constraint()?.active ? 'Ready' : 'Waiting'}</p>;
}
```

---

## useExplain

Reactively returns the explanation string for a requirement. Takes `system` as the first parameter.

```typescript
useExplain(system: System, requirementId: string): Accessor<string | null>
```

```tsx
import { useExplain } from '@directive-run/solid';

function WhyPanel() {
  // Get a detailed explanation of why a requirement was generated
  const explanation = useExplain(system, 'FETCH_USER');

  return <p>{explanation() ?? 'No explanation available'}</p>;
}
```

---

## useRequirementStatus

Reactive requirement status. Takes `statusPlugin` as the first parameter (not system). Supports single type or multiple types.

```typescript
useRequirementStatus(statusPlugin: StatusPlugin, type: string): Accessor<RequirementTypeStatus>
useRequirementStatus(statusPlugin: StatusPlugin, types: string[]): Accessor<Record<string, RequirementTypeStatus>>
```

```tsx
import { useRequirementStatus } from '@directive-run/solid';

function UserLoader() {
  // Track the loading state of a specific requirement type
  const status = useRequirementStatus(statusPlugin, 'FETCH_USER');

  return (
    <Switch>
      <Match when={status().isLoading}><Spinner /></Match>
      <Match when={status().hasError}><Error message={status().lastError?.message} /></Match>
      <Match when={true}><UserContent /></Match>
    </Switch>
  );
}

function MultiStatus() {
  // Track multiple requirement types at once
  const statuses = useRequirementStatus(statusPlugin, ['FETCH_USER', 'FETCH_POSTS']);

  return <p>User loading: {String(statuses()['FETCH_USER'].isLoading)}</p>;
}
```

---

## useSuspenseRequirement

Throws a promise while the requirement is pending, integrating with Solid's `<Suspense>`. Takes `statusPlugin` as the first parameter (not system).

```typescript
useSuspenseRequirement(statusPlugin: StatusPlugin, type: string): Accessor<RequirementTypeStatus>
useSuspenseRequirement(statusPlugin: StatusPlugin, types: string[]): Accessor<Record<string, RequirementTypeStatus>>
```

```tsx
import { useSuspenseRequirement } from '@directive-run/solid';
import { Suspense } from 'solid-js';

function UserProfile() {
  // Suspends rendering until the requirement resolves
  const status = useSuspenseRequirement(statusPlugin, 'FETCH_USER');

  return <div>User loaded!</div>;
}

function App() {
  return (
    // Show a fallback while the requirement is being resolved
    <Suspense fallback={<Spinner />}>
      <UserProfile />
    </Suspense>
  );
}
```

---

## useOptimisticUpdate

Optimistic mutation hook. Saves a snapshot before mutating, monitors a requirement type via statusPlugin, and rolls back on failure. Takes `system` as the first parameter.

```typescript
useOptimisticUpdate(system: System, statusPlugin?: StatusPlugin, requirementType?: string): {
  mutate: (updateFn: () => void) => void;
  isPending: Accessor<boolean>;
  error: Accessor<Error | null>;
  rollback: () => void;
}
```

```tsx
import { useOptimisticUpdate } from '@directive-run/solid';

function LikeButton() {
  // Set up optimistic mutations with automatic rollback
  const { mutate, isPending } = useOptimisticUpdate(system, statusPlugin, 'LIKE_POST');

  const handleLike = () => {
    // Optimistically update the UI before the server responds
    mutate(() => { system.facts.likes = (system.facts.likes ?? 0) + 1; });
  };

  return (
    <button onClick={handleLike} disabled={isPending()}>
      {isPending() ? 'Saving...' : 'Like'}
    </button>
  );
}
```

---

## useDirective

Create a scoped Directive system tied to the component lifecycle. Two modes:

- **Selective** – pass `facts` and/or `derived` keys to subscribe to specific state
- **Subscribe all** – omit keys to subscribe to all facts and derivations

```typescript
useDirective<M extends ModuleSchema>(moduleDef: ModuleDef<M>, config?: {
  facts?: string[];
  derived?: string[];
  plugins?: Plugin[];
  trace?: TraceOption;
  errorBoundary?: ErrorBoundaryConfig;
  tickMs?: number;
  zeroConfig?: boolean;
  initialFacts?: Record<string, any>;
  status?: boolean;
}): {
  system: System<M>;
  facts: Accessor<InferFacts<M>>;
  derived: Accessor<InferDerivations<M>>;
  events: System<M>["events"];
  dispatch: (event: InferEvents<M>) => void;
  statusPlugin?: StatusPlugin;
}
```

```tsx
import { useDirective } from '@directive-run/solid';

// Subscribe all: omit keys for everything
function Counter() {
  const { facts, events } = useDirective(counterModule);

  return (
    <div>
      <p>{facts().count}</p>
      <button onClick={() => events.increment()}>+</button>
    </div>
  );
}

// Selective: subscribe to specific keys only
function CounterSelective() {
  const { facts, derived, dispatch } = useDirective(counterModule, {
    facts: ['count'],
    derived: ['doubled'],
  });

  return <p>{facts().count} (doubled: {derived().doubled})</p>;
}
```

---

## createTypedHooks

Factory that returns fully typed versions of the core hooks for a specific schema. Returned hooks take `system` as their first parameter. Useful for shared libraries or when you want narrower types without casting.

```typescript
createTypedHooks<M extends ModuleSchema>(): {
  useDerived: <K extends keyof InferDerivations<M>>(system: System<M>, derivationId: K) => Accessor<InferDerivations<M>[K]>;
  useFact: <K extends keyof InferFacts<M>>(system: System<M>, factKey: K) => Accessor<InferFacts<M>[K] | undefined>;
  useDispatch: (system: System<M>) => (event: InferEvents<M>) => void;
  useEvents: (system: System<M>) => System<M>["events"];
}
```

```tsx
import { createTypedHooks } from '@directive-run/solid';
import type { MySchema } from './schema';

// Create typed hooks – full autocomplete for fact keys and event types
const { useFact, useDerived, useDispatch } = createTypedHooks<MySchema>();

function Counter() {
  // Fully typed – fact key autocompletes, return type inferred
  const count = useFact(system, 'count');

  return <p>{count()}</p>;
}
```

---

## createDerivedSignal

Create a derivation signal outside of a component. Takes the system as a parameter. Returns a tuple of `[Accessor<T>, unsubscribe]`.

```typescript
createDerivedSignal<T>(system: System<any>, derivationId: string): [Accessor<T>, () => void]
```

```tsx
import { createDerivedSignal } from '@directive-run/solid';

// Create a derivation signal outside of components
const [total, unsub] = createDerivedSignal<number>(system, 'cartTotal');
// total() returns the current value
// unsub() cleans up the subscription
```

---

## createFactSignal

Create a fact signal outside of a component. Takes the system as a parameter. Returns a tuple of `[Accessor<T | undefined>, unsubscribe]`.

```typescript
createFactSignal<T>(system: System<any>, factKey: string): [Accessor<T | undefined>, () => void]
```

```tsx
import { createFactSignal } from '@directive-run/solid';

// Create a fact signal outside of components
const [count, unsub] = createFactSignal<number>(system, 'count');
// count() returns the current value
// unsub() cleans up the subscription
```

---

## useHistory

Reactive time-travel state. Returns an Accessor that updates when snapshots are taken or navigation occurs. Returns `null` when time-travel is disabled. Takes `system` as the first parameter.

```typescript
useHistory(system: System): Accessor<HistoryState | null>
```

### HistoryState

```typescript
interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  currentIndex: number;
  totalSnapshots: number;
}
```

```tsx
import { useHistory } from '@directive-run/solid';

function UndoControls() {
  // Get reactive time-travel controls (null when disabled)
  const tt = useHistory(system);

  return (
    <Show when={tt()}>
      {(state) => (
        <div>
          <button onClick={() => state().undo()} disabled={!state().canUndo}>Undo</button>
          <button onClick={() => state().redo()} disabled={!state().canRedo}>Redo</button>
          <span>{state().currentIndex + 1} / {state().totalSnapshots}</span>
        </div>
      )}
    </Show>
  );
}
```

---

## shallowEqual

Shallow equality comparison utility. Useful as an `equalityFn` for selectors to prevent unnecessary signal updates when object references change but values are the same.

```typescript
shallowEqual(a: unknown, b: unknown): boolean
```

```tsx
import { useSelector, shallowEqual } from '@directive-run/solid';

function UserInfo() {
  // Use shallowEqual to prevent updates when name/age haven't changed
  const info = useSelector(system, (state) => ({ name: state.user?.name, age: state.user?.age }), shallowEqual);

  return <p>{info().name}, {info().age}</p>;
}
```

---

## Next Steps

- [Core API](/docs/api/core) – System functions
- [Types](/docs/api/types) – Type definitions
- [Solid Adapter](/docs/adapters/solid) – Setup and patterns
