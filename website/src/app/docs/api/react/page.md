---
title: React Hooks
description: Complete API reference for all React hooks exported from @directive-run/react. System-first pattern – every hook takes the system as its first argument.
---

React hooks API reference. All hooks use a system-first pattern – pass the system (or statusPlugin for requirement-status hooks) as the first argument. {% .lead %}

---

## Quick Reference

| Export | Type | Description |
|--------|------|-------------|
| `useSelector` | Hook | Auto-tracking selector over facts and derivations |
| `useFact` | Hook | Read single/multi facts |
| `useDerived` | Hook | Read single/multi derivations |
| `useEvents` | Hook | Typed event dispatchers |
| `useDispatch` | Hook | Low-level event dispatch |
| `useWatch` | Hook | Side-effect watcher for facts or derivations |
| `useInspect` | Hook | System inspection (unmet, inflight, constraints) |
| `useRequirementStatus` | Hook | Single/multi requirement status |
| `useSuspenseRequirement` | Hook | Suspense integration for requirements |
| `useDirectiveRef` | Hook | Scoped system tied to component lifecycle |
| `useDirective` | Hook | Scoped system with selected or all subscriptions |
| `useExplain` | Hook | Reactive requirement explanation |
| `useConstraintStatus` | Hook | Reactive constraint inspection |
| `useOptimisticUpdate` | Hook | Optimistic mutations with rollback |
| `DirectiveDevTools` | Component | Floating debug panel |
| `DirectiveHydrator` | Component | SSR snapshot hydration provider |
| `useHydratedSystem` | Hook | Create system from hydration context |
| `useTimeTravel` | Hook | Reactive time-travel state (canUndo, canRedo, undo, redo) |
| `shallowEqual` | Utility | Shallow equality for selectors |

---

## useSelector

Auto-tracking selector over facts and derivations. The selector receives a merged proxy of both facts and derivations, so you can access either with the same syntax. Similar to Zustand's `useStore` pattern. Supports an optional default value and nullable systems.

```typescript
// Original: equalityFn as 3rd param
function useSelector<S, R>(
  system: SingleModuleSystem<S>,
  selector: (state: InferSelectorState<S>) => R,
  equalityFn?: (a: R, b: R) => boolean,
): R

// With default value
function useSelector<S, R>(
  system: SingleModuleSystem<S>,
  selector: (state: InferSelectorState<S>) => R,
  defaultValue: R,
  equalityFn?: (a: R, b: R) => boolean,
): R

// Nullable system (default required)
function useSelector<S, R>(
  system: SingleModuleSystem<S> | null | undefined,
  selector: (state: InferSelectorState<S>) => R,
  defaultValue: R,
  equalityFn?: (a: R, b: R) => boolean,
): R
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `system` | `SingleModuleSystem<S>` or `null` | The Directive system. May be `null`/`undefined` when a default value is provided. |
| `selector` | `(state) => R` | Selector function receiving both facts and derivations |
| `defaultValue` | `R` | Optional default returned before the system starts or when system is null |
| `equalityFn` | `(a, b) => boolean` | Optional custom equality check (4th param when using default, 3rd param without) |

```tsx
import { useSelector, shallowEqual } from '@directive-run/react';

// Basic: select and combine values (facts and derivations)
const summary = useSelector(system, (state) => ({
  userName: state.user?.name,
  itemCount: state.items?.length ?? 0,
}));

// With default value – avoids undefined on first render
const email = useSelector(system, (state) => state.email, "");
const count = useSelector(system, (state) => state.count, 0);

// With default value + custom equality
const ids = useSelector(
  system,
  (state) => state.users?.map(u => u.id) ?? [],
  [],
  shallowEqual,
);

// Nullable system – returns default until system is available
const status = useSelector(maybeSystem, (state) => state.status, "idle");
```

{% callout type="note" title="Backward compatible" %}
The 3rd parameter is discriminated at runtime: if it's a function and no 4th argument is provided, it's treated as `equalityFn` (original API). Otherwise it's treated as `defaultValue`. Existing code using `useSelector(system, selector, shallowEqual)` continues to work unchanged.
{% /callout %}

{% callout type="warning" title="Function defaults" %}
If your default value is itself a function, the runtime will misinterpret it as `equalityFn`. Force the new API path by passing the equality function (or `undefined`) as the 4th argument:
```tsx
// Wrong — () => {} is treated as equalityFn
useSelector(system, (state) => state.handler, () => {});

// Correct — explicitly pass undefined as equalityFn
useSelector(system, (state) => state.handler, () => {}, undefined);
```
This edge case only applies when the default value is a function. Primitives, objects, and arrays work as expected.
{% /callout %}

---

## useFact

Subscribe to facts from the system. Two overloads: single key or multiple keys.

```typescript
// Single fact
function useFact<S, K extends keyof InferFacts<S>>(
  system: SingleModuleSystem<S>,
  key: K,
): InferFacts<S>[K] | undefined

// Multiple facts
function useFact<S, K extends keyof InferFacts<S>>(
  system: SingleModuleSystem<S>,
  keys: K[],
): Pick<InferFacts<S>, K>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `system` | `SingleModuleSystem<S>` | The Directive system |
| `key` / `keys` | `string` or `string[]` | Fact key(s) to subscribe to |

```tsx
import { useFact } from '@directive-run/react';

// Subscribe to a single fact value
const count = useFact(system, "count");

// Subscribe to multiple facts at once
const { userId, loading } = useFact(system, ["userId", "loading"]);
```

{% callout type="note" title="Need a transform?" %}
Use [`useSelector`](#useselector) to derive values from facts. It auto-tracks dependencies and supports custom equality.
{% /callout %}

---

## useDerived

Subscribe to derivations from the system. Two overloads: single key or multiple keys.

```typescript
// Single derivation
function useDerived<S, K extends keyof InferDerivations<S>>(
  system: SingleModuleSystem<S>,
  key: K,
): InferDerivations<S>[K]

// Multiple derivations
function useDerived<S, K extends keyof InferDerivations<S>>(
  system: SingleModuleSystem<S>,
  keys: K[],
): Pick<InferDerivations<S>, K>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `system` | `SingleModuleSystem<S>` | The Directive system |
| `key` / `keys` | `string` or `string[]` | Derivation key(s) to subscribe to |

```tsx
import { useDerived } from '@directive-run/react';

// Subscribe to a single computed derivation
const total = useDerived(system, "cartTotal");

// Subscribe to multiple derivations at once
const { isRed, elapsed } = useDerived(system, ["isRed", "elapsed"]);
```

{% callout type="note" title="Need a transform?" %}
Use [`useSelector`](#useselector) to derive values from facts. It auto-tracks dependencies and supports custom equality.
{% /callout %}

---

## useEvents

Returns typed event dispatchers. Each event type becomes a callable function.

```typescript
function useEvents<S>(
  system: SingleModuleSystem<S>,
): TypedEventDispatchers<S>
```

```tsx
import { useEvents } from '@directive-run/react';

// Get typed event dispatchers for the system
const events = useEvents(system);

// Dispatch events with full type safety
events.increment();
events.setUser({ user: newUser });
```

---

## useDispatch

Low-level event dispatch. Returns a single dispatch function that accepts an event object.

```typescript
function useDispatch<S>(
  system: SingleModuleSystem<S>,
): (event: InferEvents<S>) => void
```

```tsx
import { useDispatch } from '@directive-run/react';

// Get the low-level dispatch function
const dispatch = useDispatch(system);

// Send an event object directly
dispatch({ type: "increment" });
```

---

## useWatch

Side-effect watcher for facts or derivations. Auto-detects whether the key is a fact or derivation. Does not cause re-renders.

```typescript
// Watch a fact or derivation (auto-detected)
function useWatch<T>(
  system: SingleModuleSystem<any>,
  key: string,
  callback: (newValue: T, prevValue: T | undefined) => void,
  opts?: { equalityFn?: (a: T, b: T) => boolean },
): void

// @deprecated – still works for backward compatibility
function useWatch<T>(
  system: SingleModuleSystem<any>,
  kind: "fact",
  factKey: string,
  callback: (newValue: T, prevValue: T | undefined) => void,
): void
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `system` | `SingleModuleSystem` | The Directive system |
| `key` | `string` | The fact or derivation key to watch (auto-detected) |
| `callback` | `(newVal, prevVal) => void` | Called when the value changes |
| `opts.equalityFn` | `(a, b) => boolean` | Optional custom equality check to control when the callback fires |

```tsx
import { useWatch } from '@directive-run/react';

// Watch a fact (auto-detected)
useWatch(system, "count", (newVal, oldVal) => {
  console.log(`count: ${oldVal} -> ${newVal}`);
});

// Watch a derivation (auto-detected)
useWatch(system, "doubled", (newVal, oldVal) => {
  console.log(`doubled: ${oldVal} -> ${newVal}`);
});

// With custom equality function
useWatch(system, "position", (newVal, oldVal) => {
  canvas.moveTo(newVal.x, newVal.y);
}, { equalityFn: (a, b) => a?.x === b?.x && a?.y === b?.y });

// @deprecated – old pattern still works but is no longer needed
useWatch(system, "fact", "userId", (newVal, oldVal) => {
  console.log(`userId changed: ${oldVal} -> ${newVal}`);
});
```

---

## useInspect

Get system inspection data reactively. Supports optional throttling.

```typescript
function useInspect(
  system: SingleModuleSystem<any>,
  opts?: { throttleMs?: number },
): SystemInspection
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `system` | `SingleModuleSystem` | The Directive system |
| `opts.throttleMs` | `number` | Optional minimum ms between updates |

### useInspect Returns

`SystemInspection` with `unmet`, `inflight`, `isSettled`, `constraints`, and more.

```tsx
import { useInspect } from '@directive-run/react';

// Get reactive system inspection data
const inspection = useInspect(system);

// Show a spinner while the system is still resolving
if (!inspection.isSettled) {
  return <Spinner />;
}
```

---

## useConstraintStatus

Reactive constraint inspection. Returns status for a single constraint or all constraints.

```typescript
// Single constraint
function useConstraintStatus(
  system: SingleModuleSystem<any>,
  constraintId: string,
): ConstraintStatus

// All constraints
function useConstraintStatus(
  system: SingleModuleSystem<any>,
): Record<string, ConstraintStatus>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `system` | `SingleModuleSystem` | The Directive system |
| `constraintId` | `string` | Optional constraint to inspect |

```tsx
import { useConstraintStatus } from '@directive-run/react';

// Check if the auth constraint is currently active
const auth = useConstraintStatus(system, "requireAuth");

// Redirect to login when the constraint fires
if (auth.active) {
  return <LoginPrompt />;
}
```

---

## useExplain

Reactive requirement explanation. Shows why a requirement is active and its current resolution status.

```typescript
function useExplain(
  system: SingleModuleSystem<any>,
  requirementType: string,
): ExplanationResult
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `system` | `SingleModuleSystem` | The Directive system |
| `requirementType` | `string` | The requirement type to explain |

### useExplain Returns

`ExplanationResult` with `constraints` (which constraints produced it) and `status` (current resolution status).

```tsx
import { useExplain } from '@directive-run/react';

// Get a detailed explanation of why a requirement exists
const explanation = useExplain(system, "FETCH_USER");
// explanation.constraints – which constraints produced this requirement
// explanation.status – current resolution status
```

---

## useRequirementStatus

Get requirement resolution status. Takes `statusPlugin` (not `system`) as the first argument. Supports single or multiple requirement types.

```typescript
// Single requirement type
function useRequirementStatus(
  statusPlugin: StatusPlugin,
  type: string,
): RequirementTypeStatus

// Multiple requirement types
function useRequirementStatus(
  statusPlugin: StatusPlugin,
  types: string[],
): Map<string, RequirementTypeStatus>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `statusPlugin` | `StatusPlugin` | The requirement status plugin |
| `type` / `types` | `string` or `string[]` | Requirement type(s) to track |

```tsx
import { useRequirementStatus } from '@directive-run/react';

// Track the loading state of a specific requirement type
const status = useRequirementStatus(statusPlugin, "FETCH_USER");

// Render loading, error, or content based on status
if (status.isLoading) {
  return <Spinner />;
}

if (status.hasError) {
  return <Error message={status.lastError?.message} />;
}
```

---

## useSuspenseRequirement

Suspends while a requirement is being resolved. Use inside a React `<Suspense>` boundary.

```typescript
function useSuspenseRequirement(
  statusPlugin: StatusPlugin,
  type: string,
): RequirementTypeStatus
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `statusPlugin` | `StatusPlugin` | The requirement status plugin |
| `type` | `string` | The requirement type to wait for |

```tsx
import { useSuspenseRequirement } from '@directive-run/react';

function UserProfile() {
  // Suspends rendering until the requirement resolves
  const status = useSuspenseRequirement(statusPlugin, "FETCH_USER");

  return <div>User loaded!</div>;
}

// Wrap with Suspense to show a fallback while loading
<Suspense fallback={<Spinner />}>
  <UserProfile />
</Suspense>
```

---

## useOptimisticUpdate

Optimistic mutations with automatic rollback on failure.

```typescript
function useOptimisticUpdate(
  system: SingleModuleSystem<any>,
  statusPlugin: StatusPlugin,
  requirementType: string,
): OptimisticUpdateResult
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `system` | `SingleModuleSystem` | The Directive system |
| `statusPlugin` | `StatusPlugin` | The requirement status plugin |
| `requirementType` | `string` | The requirement type for the operation |

### useOptimisticUpdate Returns

`OptimisticUpdateResult` with `mutate`, `isPending`, `error`, and `rollback`.

```tsx
import { useOptimisticUpdate } from '@directive-run/react';

// Set up optimistic mutations for the save operation
const { mutate, isPending, error, rollback } = useOptimisticUpdate(
  system, statusPlugin, "SAVE_DATA"
);

function handleSave() {
  // Optimistically update facts; rolls back automatically on resolver failure
  mutate(() => { system.facts.name = "New Name"; });
}
```

---

## useDirectiveRef

Scoped system tied to component lifecycle. Created on mount, destroyed on unmount.

```typescript
function useDirectiveRef<M>(
  module: ModuleDef<M>,
  opts?: {
    status?: boolean;
    plugins?: Plugin[];
    debug?: DebugConfig;
    initialFacts?: Partial<InferFacts<M>>;
  },
): SingleModuleSystem<M>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `module` | `ModuleDef<M>` | The module definition |
| `opts.status` | `boolean` | Enable the status plugin |
| `opts.plugins` | `Plugin[]` | Additional plugins |
| `opts.debug` | `DebugConfig` | Debug configuration |
| `opts.initialFacts` | `Partial<InferFacts<M>>` | Initial fact values |

```tsx
import { useDirectiveRef, useFact } from '@directive-run/react';

function Counter() {
  // Create a scoped system tied to this component's lifecycle
  const system = useDirectiveRef(counterModule);

  // Subscribe to the current count
  const count = useFact(system, "count");

  return <p>{count}</p>;
}
```

---

## useDirective

Higher-level scoped system with subscriptions baked in. Two modes:

- **Selective** – pass `facts` and/or `derived` keys to subscribe to specific state
- **Subscribe all** – omit keys to subscribe to all facts and derivations

```typescript
function useDirective<M, FK, DK>(
  module: ModuleDef<M> | UseDirectiveRefOptions<M>,
  selections?: {
    facts?: FK[];
    derived?: DK[];
    status?: boolean;
    plugins?: Plugin[];
    debug?: DebugConfig;
    initialFacts?: Partial<InferFacts<M>>;
  },
): {
  system: SingleModuleSystem<M>;
  dispatch: (event: InferEvents<M>) => void;
  events: SingleModuleSystem<M>["events"];
  facts: Pick<InferFacts<M>, FK>;
  derived: Pick<InferDerivations<M>, DK>;
  statusPlugin?: StatusPlugin;
}
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `module` | `ModuleDef<M>` | The module definition |
| `selections.facts` | `string[]` | Fact keys to subscribe to (omit for all) |
| `selections.derived` | `string[]` | Derivation keys to subscribe to (omit for all) |

```tsx
import { useDirective } from '@directive-run/react';

// Selective: subscribe to specific keys
function Counter() {
  const { dispatch, facts: { count }, derived: { doubled } } = useDirective(counterModule, {
    facts: ["count"],
    derived: ["doubled"],
  });

  return <p>{count} (doubled: {doubled})</p>;
}

// Subscribe all: omit keys for everything
function CounterFull() {
  const { facts, derived, events, dispatch } = useDirective(counterModule);

  return (
    <div>
      <p>{derived.doubled}</p>
      <button onClick={events.increment}>+</button>
    </div>
  );
}
```

---

## DirectiveDevTools

Component that renders a floating debug panel showing facts, derivations, constraints, and requirements.

```typescript
function DirectiveDevTools(props: { system: SingleModuleSystem<any> }): JSX.Element
```

```tsx
import { DirectiveDevTools } from '@directive-run/react';

function App() {
  return (
    <>
      <MyApp />
      {/* Floating debug panel showing facts, derivations, and constraints */}
      <DirectiveDevTools system={system} />
    </>
  );
}
```

---

## DirectiveHydrator

Component that provides SSR snapshot data to child components via React context.

```typescript
function DirectiveHydrator(props: {
  snapshot: SerializedSnapshot;
  children: React.ReactNode;
}): JSX.Element
```

```tsx
import { DirectiveHydrator } from '@directive-run/react';

function App({ serverSnapshot }) {
  return (
    // Provide SSR snapshot data to all child components
    <DirectiveHydrator snapshot={serverSnapshot}>
      <MyApp />
    </DirectiveHydrator>
  );
}
```

---

## useHydratedSystem

Creates a system pre-hydrated from the nearest `DirectiveHydrator` context.

```typescript
function useHydratedSystem<M>(
  module: ModuleDef<M>,
  opts?: { plugins?: Plugin[]; debug?: DebugConfig },
): SingleModuleSystem<M>
```

```tsx
import { useHydratedSystem, useFact } from '@directive-run/react';

function Counter() {
  // Create a system pre-hydrated from the server snapshot
  const system = useHydratedSystem(counterModule);

  // Subscribe to the count – starts with the server-rendered value
  const count = useFact(system, "count");

  return <p>{count}</p>;
}
```

---

## useTimeTravel

Reactive time-travel state. Returns `null` when time-travel is disabled on the system.

```typescript
function useTimeTravel(
  system: SingleModuleSystem<any>,
): TimeTravelState | null
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

```tsx
import { useTimeTravel } from '@directive-run/react';

// Get reactive time-travel controls
const tt = useTimeTravel(system);

// Only render controls when time-travel is enabled
if (!tt) {
  return null;
}

return (
  <div>
    <button onClick={tt.undo} disabled={!tt.canUndo}>Undo</button>
    <button onClick={tt.redo} disabled={!tt.canRedo}>Redo</button>
  </div>
);
```

---

## shallowEqual

Utility for shallow equality comparison. Pass as `equalityFn` to prevent re-renders when object shape is the same.

```typescript
function shallowEqual(a: unknown, b: unknown): boolean
```

```tsx
import { useSelector, shallowEqual } from '@directive-run/react';

// As equalityFn (3rd param – no default value)
const coords = useSelector(
  system,
  (facts) => ({ x: facts.position?.x, y: facts.position?.y }),
  shallowEqual,
);

// As equalityFn (4th param – with default value)
const coords = useSelector(
  system,
  (facts) => ({ x: facts.position?.x ?? 0, y: facts.position?.y ?? 0 }),
  { x: 0, y: 0 },
  shallowEqual,
);
```

---

## Next Steps

- [Core API](/docs/api/core) – System functions
- [Types](/docs/api/types) – Type definitions
- [React Adapter](/docs/adapters/react) – Setup and patterns
