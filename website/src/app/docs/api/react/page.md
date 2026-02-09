---
title: React Hooks Reference
description: React hooks API reference for Directive integration. System-first pattern — every hook takes the system as its first parameter.
---

React adapter API reference. All hooks use a system-first pattern — pass the system or statusPlugin as the first argument. {% .lead %}

---

## useFact

Subscribe to a single fact. Types are inferred from the system reference.

```typescript
function useFact<S extends ModuleSchema, K extends keyof InferFacts<S> & string>(
  system: SingleModuleSystem<S>,
  factKey: K,
): InferFacts<S>[K] | undefined
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `system` | `SingleModuleSystem<S>` | The Directive system |
| `factKey` | `K` | The fact key to subscribe to (autocompleted) |

### Usage

```typescript
function Counter() {
  const count = useFact(system, "count");   // inferred: number
  return <p>{count}</p>;
}
```

---

## useFactSelector

Subscribe to a derived value from a fact using a selector. Only re-renders when the selected value changes.

```typescript
function useFactSelector<S extends ModuleSchema, K extends keyof InferFacts<S> & string, R>(
  system: SingleModuleSystem<S>,
  factKey: K,
  selector: (value: InferFacts<S>[K] | undefined) => R,
  equalityFn?: (a: R, b: R) => boolean,
): R
```

### Usage

```typescript
const selectUserName = (user) => user?.name ?? "Guest";

function UserName() {
  const name = useFactSelector(system, "user", selectUserName);
  return <p>Hello, {name}</p>;
}

// With custom equality
const ids = useFactSelector(
  system, "users",
  (users) => users?.map(u => u.id) ?? [],
  (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
);
```

---

## useDerived

Subscribe to a derivation. Types are inferred from the system reference.

```typescript
function useDerived<S extends ModuleSchema, K extends keyof InferDerivations<S> & string>(
  system: SingleModuleSystem<S>,
  derivationId: K,
): InferDerivations<S>[K]
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `system` | `SingleModuleSystem<S>` | The Directive system |
| `derivationId` | `K` | The derivation to subscribe to (autocompleted) |

### Usage

```typescript
function CartTotal() {
  const total = useDerived(system, "cartTotal");
  return <p>Total: ${total}</p>;
}
```

---

## useDerivations

Subscribe to multiple derivations.

```typescript
function useDerivations<T extends Record<string, unknown>>(
  system: SingleModuleSystem<any>,
  derivationIds: string[],
): T
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `system` | `SingleModuleSystem<any>` | The Directive system |
| `derivationIds` | `string[]` | The derivations to subscribe to |

### Usage

```typescript
function StatusDisplay() {
  const state = useDerivations(system, ["isRed", "elapsed"]);
  return <p>{state.isRed ? `Red for ${state.elapsed}s` : "Not red"}</p>;
}
```

---

## useDerivedSelector

Subscribe to a derived value from a derivation using a selector. Only re-renders when the selected value changes.

```typescript
function useDerivedSelector<T, R>(
  system: SingleModuleSystem<any>,
  derivationId: string,
  selector: (value: T) => R,
  equalityFn?: (a: R, b: R) => boolean,
): R
```

### Usage

```typescript
function ItemCount() {
  const count = useDerivedSelector(system, "stats", (stats) => stats.itemCount);
  return <p>Items: {count}</p>;
}
```

---

## useSelector

Select values from the entire system (like Zustand's `useStore`).

```typescript
function useSelector<R>(
  system: SingleModuleSystem<any>,
  selector: (facts: Record<string, any>) => R,
  equalityFn?: (a: R, b: R) => boolean,
): R
```

### Usage

```typescript
function Summary() {
  const summary = useSelector(system, (facts) => ({
    userName: facts.user?.name,
    itemCount: facts.items?.length ?? 0,
  }));
  return <p>{summary.userName} has {summary.itemCount} items</p>;
}
```

---

## useDispatch

Get the dispatch function for sending events. Types are inferred from the system reference.

```typescript
function useDispatch<S extends ModuleSchema>(
  system: SingleModuleSystem<S>,
): (event: InferEvents<S>) => void
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `system` | `SingleModuleSystem<S>` | The Directive system |

### Usage

```typescript
function IncrementButton() {
  const dispatch = useDispatch(system);
  return (
    <button onClick={() => dispatch({ type: "increment" })}>
      Increment
    </button>
  );
}
```

---

## useWatch

Watch a derivation and execute a callback when it changes (no re-renders).

```typescript
function useWatch<T>(
  system: SingleModuleSystem<any>,
  derivationId: string,
  callback: (newValue: T, prevValue: T | undefined) => void,
): void
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `system` | `SingleModuleSystem<any>` | The Directive system |
| `derivationId` | `string` | The derivation to watch |
| `callback` | `function` | Called with new and previous values |

### Usage

```typescript
function Analytics() {
  useWatch(system, "pageViews", (newValue, prevValue) => {
    analytics.track("pageViews", { from: prevValue, to: newValue });
  });
  return null;
}
```

---

## useIsSettled

Check if the system has settled (no pending operations).

```typescript
function useIsSettled(system: SingleModuleSystem<any>): boolean
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `system` | `SingleModuleSystem<any>` | The Directive system |

### Usage

```typescript
function LoadingIndicator() {
  const isSettled = useIsSettled(system);
  return isSettled ? null : <Spinner />;
}
```

---

## useRequirements

Get current requirements state reactively.

```typescript
function useRequirements(system: SingleModuleSystem<any>): RequirementsState
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `system` | `SingleModuleSystem<any>` | The Directive system |

### Usage

```typescript
function LoadingIndicator() {
  const { isWorking, hasUnmet, hasInflight } = useRequirements(system);
  if (!isWorking) return null;
  return <Spinner label={hasInflight ? 'Loading...' : 'Processing...'} />;
}
```

---

## useInspect

Get system inspection data reactively. Useful for debugging.

```typescript
function useInspect(system: SingleModuleSystem<any>): SystemInspection
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `system` | `SingleModuleSystem<any>` | The Directive system |

### Usage

```typescript
function DebugPanel() {
  const inspection = useInspect(system);
  return (
    <pre>
      Unmet: {inspection.unmet.length}
      Inflight: {inspection.inflight.length}
    </pre>
  );
}
```

---

## useInspectThrottled

Get system inspection data with throttled updates.

```typescript
function useInspectThrottled(
  system: SingleModuleSystem<any>,
  options?: ThrottledHookOptions,
): SystemInspection
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `system` | `SingleModuleSystem<any>` | The Directive system |
| `options.throttleMs` | `number` (optional) | Minimum ms between updates. Default: `100` |

---

## useRequirementsThrottled

Get requirements state with throttled updates.

```typescript
function useRequirementsThrottled(
  system: SingleModuleSystem<any>,
  options?: ThrottledHookOptions,
): RequirementsState
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `system` | `SingleModuleSystem<any>` | The Directive system |
| `options.throttleMs` | `number` (optional) | Minimum ms between updates. Default: `100` |

---

## useRequirementStatus

Get requirement status reactively. Takes the statusPlugin as its first parameter.

```typescript
function useRequirementStatus(statusPlugin: StatusPlugin, type: string): RequirementTypeStatus
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `statusPlugin` | `StatusPlugin` | The requirement status plugin |
| `type` | `string` | The requirement type to get status for |

### Usage

```typescript
function UserLoader() {
  const status = useRequirementStatus(statusPlugin, "FETCH_USER");
  if (status.isLoading) return <Spinner />;
  if (status.hasError) return <Error message={status.lastError?.message} />;
  return <UserContent />;
}
```

---

## useSuspenseRequirement

Suspends while a requirement is being resolved. Use with React Suspense.

```typescript
function useSuspenseRequirement(statusPlugin: StatusPlugin, type: string): RequirementTypeStatus
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `statusPlugin` | `StatusPlugin` | The requirement status plugin |
| `type` | `string` | The requirement type to wait for |

### Usage

```typescript
function UserProfile() {
  const status = useSuspenseRequirement(statusPlugin, "FETCH_USER");
  return <div>User loaded!</div>;
}

function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <UserProfile />
    </Suspense>
  );
}
```

---

## useIsResolving

Check if a requirement type is currently being resolved.

```typescript
function useIsResolving(statusPlugin: StatusPlugin, type: string): boolean
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `statusPlugin` | `StatusPlugin` | The requirement status plugin |
| `type` | `string` | The requirement type to check |

---

## useLatestError

Get the last error for a requirement type.

```typescript
function useLatestError(statusPlugin: StatusPlugin, type: string): Error | null
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `statusPlugin` | `StatusPlugin` | The requirement status plugin |
| `type` | `string` | The requirement type to get error for |

---

## useRequirementStatuses

Get status for all tracked requirement types.

```typescript
function useRequirementStatuses(statusPlugin: StatusPlugin): Map<string, RequirementTypeStatus>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `statusPlugin` | `StatusPlugin` | The requirement status plugin |

---

## useSuspenseRequirements

Wait for multiple requirements, suspending until all are resolved.

```typescript
function useSuspenseRequirements(
  statusPlugin: StatusPlugin,
  types: string[],
): Map<string, RequirementTypeStatus>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `statusPlugin` | `StatusPlugin` | The requirement status plugin |
| `types` | `string[]` | The requirement types to wait for |

---

## useDirectiveRef

Create and manage a Directive system with automatic lifecycle (created on mount, destroyed on unmount). Returns the system directly.

```typescript
function useDirectiveRef<M>(
  options: ModuleDef<M> | { module: ModuleDef<M>; plugins?; debug?; initialFacts? }
): SingleModuleSystem<M>
```

### Usage

```typescript
function Counter() {
  const system = useDirectiveRef(counterModule);
  const count = useFact(system, "count");
  const dispatch = useDispatch(system);

  return (
    <div>
      <p>{count}</p>
      <button onClick={() => dispatch({ type: "increment" })}>+</button>
    </div>
  );
}
```

---

## useDirectiveRefWithStatus

Same as `useDirectiveRef` but with a status plugin pre-configured.

```typescript
function useDirectiveRefWithStatus<M>(
  options: ModuleDef<M> | { module: ModuleDef<M>; plugins?; debug?; initialFacts? }
): { system: SingleModuleSystem<M>; statusPlugin: StatusPlugin }
```

### Usage

```typescript
function App() {
  const { system, statusPlugin } = useDirectiveRefWithStatus(myModule);
  const status = useRequirementStatus(statusPlugin, "FETCH_DATA");
  const count = useFact(system, "count");
  // ...
}
```

---

## useTimeTravel

Reactive time-travel state. Re-renders when snapshot state changes. Returns `null` when time-travel is disabled.

```typescript
function useTimeTravel(system: SingleModuleSystem<any>): TimeTravelState | null
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `system` | `SingleModuleSystem<any>` | The Directive system |

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

```tsx
import { useTimeTravel } from 'directive/react';

function UndoControls() {
  const tt = useTimeTravel(system);
  if (!tt) return null;

  return (
    <div>
      <button onClick={tt.undo} disabled={!tt.canUndo}>Undo</button>
      <button onClick={tt.redo} disabled={!tt.canRedo}>Redo</button>
      <span>{tt.currentIndex + 1} / {tt.totalSnapshots}</span>
    </div>
  );
}
```

Enable time-travel in the system configuration:

```typescript
const system = createSystem({
  module: myModule,
  debug: { timeTravel: true, maxSnapshots: 100 },
});
```

---

## Next Steps

- See [Core API](/docs/api/core) for system functions
- See [Types](/docs/api/types) for type definitions
- See [React Adapter](/docs/adapters/react) for setup
