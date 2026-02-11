---
title: Solid Hooks
description: Complete API reference for all Solid hooks exported from directive/solid. Context injection – hooks access the system via DirectiveProvider.
---

Solid hooks API reference. All hooks access the system via context injection – no system parameter needed. Values are returned as Solid `Accessor` functions. {% .lead %}

---

## Setup

Wrap your app with `DirectiveProvider`:

```tsx
import { DirectiveProvider } from 'directive/solid';
import { createSystem } from 'directive';

// Create and start the system
const system = createSystem({ module: myModule });
system.start();

function App() {
  return (
    // Provide the system to all child components
    <DirectiveProvider system={system}>
      <MyApp />
    </DirectiveProvider>
  );
}
```

---

## Quick Reference

| Export | Type | Description |
|---|---|---|
| `DirectiveProvider` | Component | Provides system context to child components |
| `useFact` | Hook | Read single/multi facts or apply selector |
| `useDerived` | Hook | Read single/multi derivations or apply selector |
| `useSelector` | Hook | Select across all facts |
| `useEvents` | Hook | Typed event dispatchers |
| `useDispatch` | Hook | Low-level event dispatch |
| `useWatch` | Hook | Side-effect watcher for facts or derivations |
| `useSystem` | Hook | Access full system instance |
| `useModule` | Hook | Zero-config scoped system |
| `useInspect` | Hook | System inspection with optional throttle |
| `useConstraintStatus` | Hook | Reactive constraint inspection |
| `useExplain` | Hook | Reactive requirement explanation |
| `useRequirementStatus` | Hook | Single/multi requirement status |
| `useSuspenseRequirement` | Hook | Suspense integration for requirements |
| `useOptimisticUpdate` | Hook | Optimistic mutations with rollback |
| `useDirective` | Hook | Scoped system tied to reactive lifecycle |
| `createTypedHooks` | Factory | Create fully typed hooks for a schema |
| `createDerivedSignal` | Factory | Create a derivation signal outside components |
| `createFactSignal` | Factory | Create a fact signal outside components |
| `useTimeTravel` | Hook | Reactive time-travel state |
| `shallowEqual` | Utility | Shallow equality for selectors |

---

## DirectiveProvider

Provides the Directive system to all child components via Solid context. Optionally accepts a `statusPlugin` for requirement status hooks.

```typescript
function DirectiveProvider<M extends ModuleSchema>(props: {
  system: System<M>;
  children: JSX.Element;
  statusPlugin?: StatusPlugin;
}): JSX.Element
```

```tsx
import { DirectiveProvider } from 'directive/solid';

function App() {
  return (
    // Provide the system and status plugin to all descendants
    <DirectiveProvider system={system} statusPlugin={statusPlugin}>
      <MyApp />
    </DirectiveProvider>
  );
}
```

---

## useFact

Subscribe to fact values reactively. Supports single key, multiple keys, or a selector.

```typescript
useFact<T>(factKey: string): Accessor<T | undefined>
useFact<T extends Record<string, unknown>>(factKeys: string[]): Accessor<T>
useFact<T, R>(factKey: string, selector: (value: T | undefined) => R, equalityFn?: (a: R, b: R) => boolean): Accessor<R>
```

```tsx
import { useFact } from 'directive/solid';

function Counter() {
  // Subscribe to a single fact value
  const count = useFact('count');

  return <p>Count: {count()}</p>;
}

function Status() {
  // Subscribe to multiple facts at once
  const state = useFact(['count', 'phase']);

  return <p>{state().count} – {state().phase}</p>;
}

function UserName() {
  // Derive a value from a fact with a selector
  const name = useFact('user', (u) => u?.name ?? 'Guest');

  return <p>Hello, {name()}</p>;
}
```

---

## useDerived

Subscribe to derivation values reactively. Supports single key, multiple keys, or a selector.

```typescript
useDerived<T>(derivationId: string): Accessor<T>
useDerived<T extends Record<string, unknown>>(derivationIds: string[]): Accessor<T>
useDerived<T, R>(derivationId: string, selector: (value: T) => R, equalityFn?: (a: R, b: R) => boolean): Accessor<R>
```

```tsx
import { useDerived } from 'directive/solid';

function CartTotal() {
  // Subscribe to a single derivation
  const total = useDerived('cartTotal');

  return <p>Total: ${total()}</p>;
}

function Stats() {
  // Subscribe to multiple derivations at once
  const stats = useDerived(['isRed', 'elapsed']);

  return <p>{stats().isRed ? `Red for ${stats().elapsed}s` : 'Not red'}</p>;
}

function ItemCount() {
  // Derive a value from a derivation with a selector
  const count = useDerived('stats', (s) => s.itemCount);

  return <p>Items: {count()}</p>;
}
```

---

## useSelector

Auto-tracking cross-fact selector. Uses `withTracking()` to detect which facts are accessed, then subscribes only to those keys.

```typescript
useSelector<R>(selector: (facts: Record<string, unknown>) => R, equalityFn?: (a: R, b: R) => boolean): Accessor<R>
```

```tsx
import { useSelector } from 'directive/solid';

function Summary() {
  // Select and combine values from multiple facts
  const summary = useSelector((facts) => ({
    userName: facts.user?.name,
    itemCount: facts.items?.length ?? 0,
  }));

  return <p>{summary().userName} has {summary().itemCount} items</p>;
}
```

---

## useEvents

Returns the system's typed event dispatchers.

```typescript
useEvents<M extends ModuleSchema>(): System<M>["events"]
```

```tsx
import { useEvents } from 'directive/solid';

function Controls() {
  // Get typed event dispatchers for the module
  const events = useEvents();

  return <button onClick={() => events.increment()}>+1</button>;
}
```

---

## useDispatch

Get a low-level dispatch function for sending events.

```typescript
useDispatch<M extends ModuleSchema>(): (event: InferEvents<M>) => void
```

```tsx
import { useDispatch } from 'directive/solid';

function IncrementButton() {
  // Get the low-level dispatch function
  const dispatch = useDispatch();

  return (
    <button onClick={() => dispatch({ type: 'increment' })}>
      Increment
    </button>
  );
}
```

---

## useWatch

Side-effect watcher for facts or derivations. The key is auto-detected, so no discriminator is needed. Does not cause re-renders.

```typescript
useWatch<T>(key: string, callback: (newValue: T, previousValue: T | undefined) => void): void

// Deprecated: "fact" discriminator overload (still works)
useWatch<T>(kind: "fact", factKey: string, callback: (newValue: T | undefined, previousValue: T | undefined) => void): void
```

```tsx
import { useWatch } from 'directive/solid';

function Analytics() {
  // Watch a derivation -- auto-detected
  useWatch('pageViews', (newValue, prevValue) => {
    analytics.track('pageViews', { from: prevValue, to: newValue });
  });

  // Watch a fact -- auto-detected, no "fact" discriminator needed
  useWatch('count', (next, prev) => {
    console.log(`count changed: ${prev} → ${next}`);
  });

  return null;
}
```

{% callout type="warning" title="Deprecated" %}
The three-argument `useWatch("fact", key, callback)` overload still works but is deprecated. Use `useWatch(key, callback)` instead.
{% /callout %}

---

## useSystem

Access the full system instance from context.

```typescript
useSystem<M extends ModuleSchema>(): System<M>
```

```tsx
import { useSystem } from 'directive/solid';

function DebugInfo() {
  // Access the full system instance for advanced operations
  const system = useSystem();

  return <pre>{JSON.stringify(system.inspect(), null, 2)}</pre>;
}
```

---

## useModule

Zero-config hook that creates a scoped system from a module definition, subscribes to all facts and derivations, and returns everything. The system is started on creation and destroyed on cleanup.

```typescript
useModule<M extends ModuleSchema>(moduleDef: ModuleDef<M>, config?: {
  plugins?: Plugin[];
  debug?: DebugConfig;
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
import { useModule } from 'directive/solid';

function Counter() {
  // Get everything in one call – facts, derivations, and events
  const { facts, events } = useModule(counterModule);

  return (
    <div>
      <p>{facts().count}</p>
      <button onClick={() => events.increment()}>+</button>
    </div>
  );
}
```

---

## useInspect

Consolidated system inspection hook with optional throttling.

```typescript
useInspect(options?: { throttleMs?: number }): Accessor<InspectState>
```

```tsx
import { useInspect } from 'directive/solid';

function DebugPanel() {
  // Get reactive system inspection data
  const inspection = useInspect();

  return (
    <pre>
      Unmet: {inspection().unmet.length}
      Inflight: {inspection().inflight.length}
    </pre>
  );
}

function ThrottledDebug() {
  // Throttle inspection updates to limit render frequency
  const inspection = useInspect({ throttleMs: 200 });

  return <p>Settled: {String(inspection().isSettled)}</p>;
}
```

---

## useConstraintStatus

Reactive constraint inspection. Returns all constraints, or a single constraint by ID.

```typescript
useConstraintStatus(): Accessor<ConstraintInfo[]>
useConstraintStatus(constraintId: string): Accessor<ConstraintInfo | null>
```

```tsx
import { useConstraintStatus } from 'directive/solid';

function ConstraintList() {
  // Get all constraints for the debug panel
  const constraints = useConstraintStatus();

  return (
    <ul>
      <For each={constraints()}>{(c) =>
        <li>{c.id}: {c.isMet ? 'met' : 'unmet'}</li>
      }</For>
    </ul>
  );
}

function TransitionStatus() {
  // Check a specific constraint by ID
  const constraint = useConstraintStatus('transition');

  return <p>{constraint()?.isMet ? 'Ready' : 'Waiting'}</p>;
}
```

---

## useExplain

Reactively returns the explanation string for a requirement.

```typescript
useExplain(requirementId: string): Accessor<string | null>
```

```tsx
import { useExplain } from 'directive/solid';

function WhyPanel() {
  // Get a detailed explanation of why a requirement was generated
  const explanation = useExplain('FETCH_USER');

  return <p>{explanation() ?? 'No explanation available'}</p>;
}
```

---

## useRequirementStatus

Reactive requirement status. Requires a `statusPlugin` on the provider. Supports single type or multiple types.

```typescript
useRequirementStatus(type: string): Accessor<RequirementTypeStatus>
useRequirementStatus(types: string[]): Accessor<Record<string, RequirementTypeStatus>>
```

```tsx
import { useRequirementStatus } from 'directive/solid';

function UserLoader() {
  // Track the loading state of a specific requirement type
  const status = useRequirementStatus('FETCH_USER');

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
  const statuses = useRequirementStatus(['FETCH_USER', 'FETCH_POSTS']);

  return <p>User loading: {String(statuses()['FETCH_USER'].isLoading)}</p>;
}
```

---

## useSuspenseRequirement

Throws a promise while the requirement is pending, integrating with Solid's `<Suspense>`. Requires a `statusPlugin` on the provider.

```typescript
useSuspenseRequirement(type: string): Accessor<RequirementTypeStatus>
useSuspenseRequirement(types: string[]): Accessor<Record<string, RequirementTypeStatus>>
```

```tsx
import { useSuspenseRequirement } from 'directive/solid';
import { Suspense } from 'solid-js';

function UserProfile() {
  // Suspends rendering until the requirement resolves
  const status = useSuspenseRequirement('FETCH_USER');

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

Optimistic mutation hook. Saves a snapshot before mutating, monitors a requirement type via statusPlugin, and rolls back on failure.

```typescript
useOptimisticUpdate(statusPlugin?: StatusPlugin, requirementType?: string): {
  mutate: (updateFn: () => void) => void;
  isPending: Accessor<boolean>;
  error: Accessor<Error | null>;
  rollback: () => void;
}
```

```tsx
import { useOptimisticUpdate, useSystem } from 'directive/solid';

function LikeButton() {
  // Access the system's facts proxy
  const { facts } = useSystem();

  // Set up optimistic mutations with automatic rollback
  const { mutate, isPending } = useOptimisticUpdate(statusPlugin, 'LIKE_POST');

  const handleLike = () => {
    // Optimistically update the UI before the server responds
    mutate(() => { facts.likes = (facts.likes ?? 0) + 1; });
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

Create a scoped Directive system tied to the component lifecycle. The system is started on creation and destroyed on cleanup. Uses a WeakMap cache to avoid re-creation on re-render.

```typescript
useDirective<M extends ModuleSchema>(options: ModuleDef<M> | CreateSystemOptionsSingle<M>): System<M>
```

```tsx
import { useDirective, useFact } from 'directive/solid';

function Counter() {
  // Create a scoped system tied to this component's lifecycle
  const system = useDirective(counterModule);

  return <p>System running: {system.isSettled}</p>;
}
```

---

## createTypedHooks

Factory that returns fully typed versions of the core hooks for a specific schema. Useful for shared libraries or when you want narrower types without casting.

```typescript
createTypedHooks<M extends ModuleSchema>(): {
  useDerived: <K extends keyof InferDerivations<M>>(derivationId: K) => Accessor<InferDerivations<M>[K]>;
  useFact: <K extends keyof InferFacts<M>>(factKey: K) => Accessor<InferFacts<M>[K] | undefined>;
  useDispatch: () => (event: InferEvents<M>) => void;
  useSystem: () => System<M>;
  useEvents: () => System<M>["events"];
}
```

```tsx
import { createTypedHooks } from 'directive/solid';
import type { MySchema } from './schema';

// Create typed hooks – full autocomplete for fact keys and event types
const { useFact, useDerived, useDispatch } = createTypedHooks<MySchema>();

function Counter() {
  // Fully typed – fact key autocompletes, return type inferred
  const count = useFact('count');

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
import { createDerivedSignal } from 'directive/solid';

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
import { createFactSignal } from 'directive/solid';

// Create a fact signal outside of components
const [count, unsub] = createFactSignal<number>(system, 'count');
// count() returns the current value
// unsub() cleans up the subscription
```

---

## useTimeTravel

Reactive time-travel state. Returns an Accessor that updates when snapshots are taken or navigation occurs. Returns `null` when time-travel is disabled.

```typescript
useTimeTravel(): Accessor<TimeTravelState | null>
```

### TimeTravelState

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

```tsx
import { useTimeTravel } from 'directive/solid';

function UndoControls() {
  // Get reactive time-travel controls (null when disabled)
  const tt = useTimeTravel();

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
import { useFact, shallowEqual } from 'directive/solid';

function UserInfo() {
  // Use shallowEqual to prevent updates when name/age haven't changed
  const info = useFact('user', (u) => ({ name: u?.name, age: u?.age }), shallowEqual);

  return <p>{info().name}, {info().age}</p>;
}
```

---

## Next Steps

- See [Core API](/docs/api/core) for system functions
- See [Types](/docs/api/types) for type definitions
- See [Solid Adapter](/docs/adapters/solid) for setup and patterns
