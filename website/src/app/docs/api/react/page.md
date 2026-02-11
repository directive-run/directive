---
title: React Hooks
description: Complete API reference for all React hooks exported from directive/react. System-first pattern – every hook takes the system as its first argument.
---

React hooks API reference. All hooks use a system-first pattern – pass the system (or statusPlugin for requirement-status hooks) as the first argument. {% .lead %}

---

## Quick Reference

| Export | Type | Description |
|--------|------|-------------|
| `useFact` | Hook | Read single/multi facts or apply selector |
| `useDerived` | Hook | Read single/multi derivations or apply selector |
| `useSelector` | Hook | Auto-tracking selector over all facts |
| `useEvents` | Hook | Typed event dispatchers |
| `useDispatch` | Hook | Low-level event dispatch |
| `useWatch` | Hook | Side-effect watcher for facts or derivations |
| `useInspect` | Hook | System inspection (unmet, inflight, constraints) |
| `useRequirementStatus` | Hook | Single/multi requirement status |
| `useSuspenseRequirement` | Hook | Suspense integration for requirements |
| `useDirectiveRef` | Hook | Scoped system tied to component lifecycle |
| `useDirective` | Hook | Scoped system with selected subscriptions |
| `useModule` | Hook | Zero-config scoped system |
| `useExplain` | Hook | Reactive requirement explanation |
| `useConstraintStatus` | Hook | Reactive constraint inspection |
| `useOptimisticUpdate` | Hook | Optimistic mutations with rollback |
| `DirectiveDevTools` | Component | Floating debug panel |
| `DirectiveHydrator` | Component | SSR snapshot hydration provider |
| `useHydratedSystem` | Hook | Create system from hydration context |
| `useTimeTravel` | Hook | Reactive time-travel state (canUndo, canRedo, undo, redo) |
| `shallowEqual` | Utility | Shallow equality for selectors |

---

## useFact

Subscribe to facts from the system. Three overloads: single key, multiple keys, or selector on a single key.

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

// Selector on a single fact
function useFact<S, K extends keyof InferFacts<S>, R>(
  system: SingleModuleSystem<S>,
  key: K,
  selector: (value: InferFacts<S>[K] | undefined) => R,
  equalityFn?: (a: R, b: R) => boolean,
): R
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `system` | `SingleModuleSystem<S>` | The Directive system |
| `key` / `keys` | `string` or `string[]` | Fact key(s) to subscribe to |
| `selector` | `(value) => R` | Optional transform function |
| `equalityFn` | `(a, b) => boolean` | Optional custom equality check |

```tsx
import { useFact } from 'directive/react';

// Subscribe to a single fact value
const count = useFact(system, "count");

// Subscribe to multiple facts at once
const { userId, loading } = useFact(system, ["userId", "loading"]);

// Derive a value from a fact with a selector
const name = useFact(system, "user", (u) => u?.name ?? "Guest");
```

---

## useDerived

Subscribe to derivations from the system. Three overloads: single key, multiple keys, or selector on a single key.

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

// Selector on a single derivation
function useDerived<S, K extends keyof InferDerivations<S>, R>(
  system: SingleModuleSystem<S>,
  key: K,
  selector: (value: InferDerivations<S>[K]) => R,
  equalityFn?: (a: R, b: R) => boolean,
): R
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `system` | `SingleModuleSystem<S>` | The Directive system |
| `key` / `keys` | `string` or `string[]` | Derivation key(s) to subscribe to |
| `selector` | `(value) => R` | Optional transform function |
| `equalityFn` | `(a, b) => boolean` | Optional custom equality check |

```tsx
import { useDerived } from 'directive/react';

// Subscribe to a single computed derivation
const total = useDerived(system, "cartTotal");

// Subscribe to multiple derivations at once
const { isRed, elapsed } = useDerived(system, ["isRed", "elapsed"]);

// Derive a value from a derivation with a selector
const count = useDerived(system, "stats", (s) => s.itemCount);
```

---

## useSelector

Auto-tracking selector over all facts. Similar to Zustand's `useStore` pattern.

```typescript
function useSelector<S, R>(
  system: SingleModuleSystem<S>,
  selector: (facts: InferFacts<S>) => R,
  equalityFn?: (a: R, b: R) => boolean,
): R
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `system` | `SingleModuleSystem<S>` | The Directive system |
| `selector` | `(facts) => R` | Selector function over all facts |
| `equalityFn` | `(a, b) => boolean` | Optional custom equality check |

```tsx
import { useSelector } from 'directive/react';

// Select and combine values from multiple facts
const summary = useSelector(system, (facts) => ({
  userName: facts.user?.name,
  itemCount: facts.items?.length ?? 0,
}));
```

---

## useEvents

Returns typed event dispatchers. Each event type becomes a callable function.

```typescript
function useEvents<S>(
  system: SingleModuleSystem<S>,
): TypedEventDispatchers<S>
```

```tsx
import { useEvents } from 'directive/react';

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
import { useDispatch } from 'directive/react';

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

// @deprecated -- still works for backward compatibility
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
import { useWatch } from 'directive/react';

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

// @deprecated -- old pattern still works but is no longer needed
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

### Returns

`SystemInspection` with `unmet`, `inflight`, `isSettled`, `constraints`, and more.

```tsx
import { useInspect } from 'directive/react';

// Get reactive system inspection data
const inspection = useInspect(system);

// Show a spinner while the system is still resolving
if (!inspection.isSettled) return <Spinner />;
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
import { useConstraintStatus } from 'directive/react';

// Check if the auth constraint is currently active
const auth = useConstraintStatus(system, "requireAuth");

// Redirect to login when the constraint fires
if (auth.active) return <LoginPrompt />;
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

### Returns

`ExplanationResult` with `constraints` (which constraints produced it) and `status` (current resolution status).

```tsx
import { useExplain } from 'directive/react';

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
import { useRequirementStatus } from 'directive/react';

// Track the loading state of a specific requirement type
const status = useRequirementStatus(statusPlugin, "FETCH_USER");

// Render loading, error, or content based on status
if (status.isLoading) return <Spinner />;
if (status.hasError) return <Error message={status.lastError?.message} />;
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
import { useSuspenseRequirement } from 'directive/react';

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

### Returns

`OptimisticUpdateResult` with `mutate`, `isPending`, and `error`.

```tsx
import { useOptimisticUpdate } from 'directive/react';

// Set up optimistic mutations for the save operation
const { mutate, isPending, error } = useOptimisticUpdate(
  system, statusPlugin, "SAVE_DATA"
);

async function handleSave() {
  await mutate(
    () => { system.facts.name = "New Name"; },       // optimistic update
    async () => { await api.saveName("New Name"); }   // actual async operation
  );
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
import { useDirectiveRef, useFact } from 'directive/react';

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

Higher-level scoped system with selected subscriptions baked in.

```typescript
function useDirective<M>(
  module: ModuleDef<M>,
  opts?: {
    facts?: string[];
    derived?: string[];
    status?: boolean;
    plugins?: Plugin[];
    debug?: DebugConfig;
    initialFacts?: Partial<InferFacts<M>>;
  },
): { system: SingleModuleSystem<M>; [key: string]: any }
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `module` | `ModuleDef<M>` | The module definition |
| `opts.facts` | `string[]` | Fact keys to auto-subscribe to |
| `opts.derived` | `string[]` | Derivation keys to auto-subscribe to |

```tsx
import { useDirective } from 'directive/react';

function Counter() {
  // Create a scoped system with automatic fact subscriptions
  const { system, count } = useDirective(counterModule, {
    facts: ["count"],
  });

  return <p>{count}</p>;
}
```

---

## useModule

Zero-config scoped system. Returns everything in one call: `system`, `facts`, `events`, and `derive`.

```typescript
function useModule<M>(
  module: ModuleDef<M>,
): {
  system: SingleModuleSystem<M>;
  facts: InferFacts<M>;
  events: TypedEventDispatchers<M>;
  derive: InferDerivations<M>;
}
```

```tsx
import { useModule } from 'directive/react';

function Counter() {
  // Get everything in one call – facts, derivations, and events
  const { facts, events, derive } = useModule(counterModule);

  return (
    <div>
      <p>{derive.doubled}</p>
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
import { DirectiveDevTools } from 'directive/react';

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
import { DirectiveHydrator } from 'directive/react';

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
import { useHydratedSystem, useFact } from 'directive/react';

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

```tsx
import { useTimeTravel } from 'directive/react';

// Get reactive time-travel controls
const tt = useTimeTravel(system);

// Only render controls when time-travel is enabled
if (!tt) return null;

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
import { useFact, shallowEqual } from 'directive/react';

// Use shallowEqual to prevent re-renders when x/y values haven't changed
const coords = useFact(
  system,
  "position",
  (p) => ({ x: p?.x, y: p?.y }),
  shallowEqual,
);
```

---

## Next Steps

- See [Core API](/docs/api/core) for system functions
- See [Types](/docs/api/types) for type definitions
- See [React Adapter](/docs/adapters/react) for setup and patterns
