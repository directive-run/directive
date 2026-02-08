---
title: React Adapter
description: Integrate Directive with React using hooks for reactive state management. DirectiveProvider, useFact, useDerived, useDispatch, and more.
---

Directive provides first-class React integration with hooks that automatically re-render on state changes. {% .lead %}

---

## Installation

The React adapter is included in the main package:

```typescript
import { DirectiveProvider, useFact, useDerived, useDispatch } from 'directive/react';
```

---

## Setup

Wrap your app with `DirectiveProvider`:

```tsx
import { createSystem } from 'directive';
import { DirectiveProvider } from 'directive/react';
import { userModule } from './modules/user';

const system = createSystem({ module: userModule });
system.start();

function App() {
  return (
    <DirectiveProvider system={system}>
      <YourApp />
    </DirectiveProvider>
  );
}
```

---

## Core Hooks

### useFact

Read a single fact reactively. The component re-renders when the fact changes:

```tsx
function UserProfile() {
  const userId = useFact<number>("userId");
  const user = useFact<User | null>("user");

  return (
    <div>
      <p>ID: {userId}</p>
      <p>User: {user?.name}</p>
    </div>
  );
}
```

### useFactSelector

Select part of a fact — only re-renders when the selected value changes:

```tsx
function UserName() {
  const name = useFactSelector("user", (user) => user?.name ?? "Guest");
  return <span>{name}</span>;
}
```

With custom equality:

```tsx
const ids = useFactSelector(
  "users",
  (users) => users?.map(u => u.id) ?? [],
  (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
);
```

### useDerived

Read a single derivation reactively:

```tsx
function Greeting() {
  const displayName = useDerived<string>("displayName");
  return <h1>Hello, {displayName}!</h1>;
}
```

### useDerivations

Read multiple derivations at once:

```tsx
function StatusBar() {
  const state = useDerivations<{ isLoggedIn: boolean; isAdmin: boolean }>(
    ["isLoggedIn", "isAdmin"]
  );

  return <span>{state.isLoggedIn ? (state.isAdmin ? "Admin" : "User") : "Guest"}</span>;
}
```

### useDerivedSelector

Select part of a derivation — only re-renders when the selected value changes:

```tsx
function ItemCount() {
  const count = useDerivedSelector("stats", (stats) => stats.itemCount);
  return <p>Items: {count}</p>;
}
```

### useSelector

Select from all facts (like Zustand's `useStore`):

```tsx
function Summary() {
  const summary = useSelector((facts) => ({
    userName: facts.user?.name,
    itemCount: facts.items?.length ?? 0,
  }));

  return <p>{summary.userName} has {summary.itemCount} items</p>;
}
```

### useDispatch

Dispatch events:

```tsx
function IncrementButton() {
  const dispatch = useDispatch();

  return (
    <button onClick={() => dispatch({ type: "increment" })}>
      +1
    </button>
  );
}
```

### useSystem

Access the full system instance:

```tsx
function DebugPanel() {
  const system = useSystem();

  return (
    <div>
      <button onClick={() => console.log(system.getSnapshot())}>Snapshot</button>
      <button onClick={() => console.log(system.inspect())}>Inspect</button>
    </div>
  );
}
```

---

## Status Hooks

### useIsSettled

Check if the system has settled (no pending work):

```tsx
function LoadingIndicator() {
  const isSettled = useIsSettled();
  return isSettled ? null : <Spinner />;
}
```

### useWatch

Watch a derivation without causing re-renders — runs a callback as a side effect:

```tsx
function Analytics() {
  useWatch("pageViews", (newValue, prevValue) => {
    analytics.track("pageViews", { from: prevValue, to: newValue });
  });

  return null;
}
```

### useInspect

Get system inspection data (unmet requirements, inflight resolvers):

```tsx
function DebugPanel() {
  const inspection = useInspect();

  return (
    <pre>
      Unmet: {inspection.unmet.length}
      Inflight: {inspection.inflight.length}
    </pre>
  );
}
```

### useRequirements

Focused view of requirement state:

```tsx
function LoadingBar() {
  const { isWorking, hasUnmet, hasInflight } = useRequirements();
  if (!isWorking) return null;
  return <Spinner label={hasInflight ? 'Loading...' : 'Processing...'} />;
}
```

---

## Requirement Status Hooks

These hooks require a `statusPlugin` — either via `DirectiveProvider` or passed directly to the hook:

```tsx
import { createRequirementStatusPlugin } from 'directive';
import { DirectiveProvider, useRequirementStatus } from 'directive/react';

const statusPlugin = createRequirementStatusPlugin();
const system = createSystem({
  module: myModule,
  plugins: [statusPlugin.plugin],
});
system.start();

function App() {
  return (
    <DirectiveProvider system={system} statusPlugin={statusPlugin}>
      <YourApp />
    </DirectiveProvider>
  );
}
```

### useRequirementStatus

```tsx
function UserLoader() {
  const status = useRequirementStatus("FETCH_USER");

  if (status.isLoading) return <Spinner />;
  if (status.hasError) return <Error message={status.lastError?.message} />;
  return <UserContent />;
}
```

### useIsResolving

```tsx
function SaveButton() {
  const isSaving = useIsResolving("SAVE_DATA");
  return (
    <button disabled={isSaving}>
      {isSaving ? "Saving..." : "Save"}
    </button>
  );
}
```

### useLatestError

```tsx
function ErrorDisplay() {
  const error = useLatestError("FETCH_USER");
  if (!error) return null;
  return <div className="error">{error.message}</div>;
}
```

### useSuspenseRequirement

Integrates with React Suspense:

```tsx
import { Suspense } from 'react';
import { useSuspenseRequirement } from 'directive/react';

function UserProfile() {
  useSuspenseRequirement("FETCH_USER");
  // Only renders after FETCH_USER is resolved
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

## System Override

All hooks accept an optional `system` parameter that bypasses the context provider. This is useful when you have nested providers and need to access an outer system from inside an inner scope.

### Problem: Provider Shadowing

When you nest providers, the inner one shadows the outer — components inside lose access to the global system:

```tsx
<DirectiveProvider system={globalSystem}>
  {/* globalSystem is available here */}
  <DirectiveProvider system={formSystem}>
    {/* Only formSystem is available — globalSystem is shadowed */}
  </DirectiveProvider>
</DirectiveProvider>
```

### Solution: Pass the System Directly

Every hook accepts an optional system as the last positional argument:

```tsx
function FormPage() {
  const appSystem = useSystem();  // grab global before scoping
  const { system: formSystem, Provider } = useDirectiveRef(formModule);

  return (
    <Provider>
      <FormFields appSystem={appSystem} />
    </Provider>
  );
}

function FormFields({ appSystem }) {
  // Scoped system (via context — default)
  const email = useFact('email');
  const isValid = useDerived('isFormValid');

  // Global system (via explicit override)
  const theme = useFact('theme', appSystem);
  const user = useDerived('currentUser', appSystem);

  return <input value={email} />;
}
```

### Hook Signatures

**Simple hooks** — positional `system?` as last arg:

```tsx
useFact('count')                     // from context (unchanged)
useFact('count', globalSystem)       // from explicit system
useDerived('doubled', globalSystem)
useDerivations(['a', 'b'], globalSystem)
useDispatch(globalSystem)
useWatch('id', callback, globalSystem)
useIsSettled(globalSystem)
useInspect(globalSystem)
useRequirements(globalSystem)
```

**Selector hooks** — last arg is either a function (equality) or an options object:

```tsx
// Existing: equality function
useFactSelector('user', u => u.name, shallowEqual)

// New: options object with system
useFactSelector('user', u => u.name, { system: globalSystem })

// New: options object with both
useFactSelector('user', u => u.name, { system: globalSystem, equalityFn: shallowEqual })

// Same pattern for useDerivedSelector and useSelector
useDerivedSelector('stats', s => s.count, { system: globalSystem })
useSelector(facts => facts.count, { system: globalSystem })
```

**Throttled hooks** — `system` merged into options:

```tsx
useInspectThrottled({ throttleMs: 200, system: globalSystem })
useRequirementsThrottled({ throttleMs: 200, system: globalSystem })
```

**Status hooks** — positional `statusPlugin?` as last arg:

```tsx
useRequirementStatus('FETCH_USER', statusPlugin)
useIsResolving('FETCH_USER', statusPlugin)
useLatestError('FETCH_USER', statusPlugin)
useRequirementStatuses(statusPlugin)
useSuspenseRequirement('FETCH_USER', statusPlugin)
useSuspenseRequirements(['FETCH_USER', 'FETCH_SETTINGS'], statusPlugin)
```

---

## Scoped Systems

### useDirectiveRef

Create a system scoped to a component's lifecycle (like XState's `useActorRef`):

```tsx
import { useDirectiveRef } from 'directive/react';

function Counter() {
  const { system, Provider } = useDirectiveRef(counterModule);

  return (
    <Provider>
      <CounterDisplay />
      <button onClick={() => system.dispatch({ type: 'increment' })}>+</button>
    </Provider>
  );
}
```

### useDirectiveRefWithStatus

Same as `useDirectiveRef` but with status plugin pre-configured:

```tsx
function App() {
  const { Provider } = useDirectiveRefWithStatus(myModule);

  return (
    <Provider>
      <Content />
    </Provider>
  );
}
```

---

## Typed Hooks

Create fully typed hooks for your module schema:

```tsx
import { createTypedHooks } from 'directive/react';

const { useDerived, useFact, useFacts, useDispatch, useSystem } = createTypedHooks<typeof myModule.schema>();

function Profile() {
  const count = useFact("count");    // Type: number
  const doubled = useDerived("doubled"); // Type: number
  const dispatch = useDispatch();

  dispatch({ type: "increment" });   // Typed!
}
```

---

## Patterns

### Loading States

```tsx
function UserCard() {
  const loading = useFact<boolean>("loading");
  const error = useFact<string | null>("error");
  const user = useFact<User | null>("user");

  if (loading) return <Spinner />;
  if (error) return <Error message={error} />;
  if (!user) return <EmptyState />;

  return <UserDetails user={user} />;
}
```

### Writing Facts

Write facts through the system directly:

```tsx
function UserIdInput() {
  const system = useSystem();
  const userId = useFact<number>("userId");

  return (
    <input
      type="number"
      value={userId ?? 0}
      onChange={(e) => { system.facts.userId = parseInt(e.target.value); }}
    />
  );
}
```

Or dispatch events:

```tsx
function IncrementButton() {
  const dispatch = useDispatch();
  return <button onClick={() => dispatch({ type: "increment" })}>+</button>;
}
```

---

## Testing

```tsx
import { render, screen } from '@testing-library/react';
import { createTestSystem } from 'directive/testing';
import { DirectiveProvider } from 'directive/react';
import { userModule } from './modules/user';
import { UserProfile } from './UserProfile';

test('displays user name', async () => {
  const system = createTestSystem({ module: userModule });
  system.facts.user = { id: 1, name: 'Test User' };

  render(
    <DirectiveProvider system={system}>
      <UserProfile />
    </DirectiveProvider>
  );

  expect(screen.getByText('Test User')).toBeInTheDocument();
});
```

---

## Next Steps

- **[Quick Start](/docs/quick-start)** — Build your first module
- **[Facts](/docs/facts)** — State management deep dive
- **[Testing](/docs/testing/overview)** — Testing React components
