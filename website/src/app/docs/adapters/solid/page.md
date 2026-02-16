---
title: Solid Adapter
description: Integrate Directive with SolidJS using signal-based hooks for reactive state management. useFact, useDerived, useEvents, useDispatch, and more.
---

Directive provides first-class SolidJS integration with hooks that bridge Directive state into Solid signals for fine-grained reactivity. All hooks take the `system` as an explicit first parameter – no provider or context needed. {% .lead %}

---

## Installation

The Solid adapter is included in the main package:

```typescript
import { useFact, useDerived, useEvents, useDispatch } from '@directive-run/solid';
```

---

## Setup

Create a system and pass it directly to hooks – no provider wrapper needed:

```tsx
import { createSystem } from '@directive-run/core';
import { userModule } from './modules/user';

// Create and start the system
const system = createSystem({ module: userModule });
system.start();

// Pass `system` directly to hooks in any component
function App() {
  return <YourApp />;
}
```

---

## Creating Systems

Every hook below requires a `system` as its first parameter. There are two ways to create one:

- **Global system** – call `createSystem()` at module level for app-wide state shared across components (shown in [Setup](#setup) above)
- **`useDirective`** – creates a system scoped to a component's lifecycle, auto-starts on creation and destroys on cleanup

For most Solid apps, use a global system and pass it to hooks. Use `useDirective` when you need per-component system isolation.

### useDirective

Creates a scoped system **and** subscribes to facts and derivations. Two modes:

- **Selective** – specify `facts` and/or `derived` keys to subscribe only to those
- **Subscribe all** – omit keys to subscribe to everything (good for prototyping or small modules)

```tsx
import { useDirective } from '@directive-run/solid';
import { counterModule } from './modules/counter';

// Subscribe all: omit keys for everything
function Counter() {
  const { system, facts, derived, events, dispatch } = useDirective(counterModule);

  return (
    <div>
      <p>Count: {facts().count}, Doubled: {derived().doubled}</p>
      <button onClick={() => events.increment()}>+</button>
    </div>
  );
}

// Selective: subscribe to specific keys only
function CounterSelective() {
  const { system, facts, derived, dispatch } = useDirective(counterModule, {
    facts: ['count'],
    derived: ['doubled'],
  });

  return <p>{facts().count}</p>;
}
```

The module parameter must be a stable reference (defined outside the component). Inline objects will create a new system on every reactive update.

---

## Core Hooks

All hooks below take `system` as their first parameter.

### useSelector

The go-to hook for **transforms and derived values** from facts. Directive auto-tracks which fact keys your selector reads and subscribes only to those:

```tsx
import { useSelector, shallowEqual } from '@directive-run/solid';

function Summary() {
  // Transform a single fact value
  const upperName = useSelector(system, (state) => state.user?.name?.toUpperCase() ?? "GUEST");

  // Extract a slice from state
  const itemCount = useSelector(system, (state) => state.items?.length ?? 0);

  // Combine values with custom equality
  const summary = useSelector(
    system,
    (state) => ({
      userName: state.user?.name,
      itemCount: state.items?.length ?? 0,
    }),
    (a, b) => a.userName === b.userName && a.itemCount === b.itemCount
  );

  // Custom equality to prevent unnecessary updates on array/object results
  const ids = useSelector(
    system,
    (facts) => facts.users?.map(u => u.id) ?? [],
    shallowEqual,
  );

  return <p>{summary().userName} has {summary().itemCount} items</p>;
}
```

### useFact

Read a single fact or multiple facts. Returns a reactive `Accessor`:

```tsx
// Subscribe to a single fact – signal updates when "userId" changes
const userId = useFact(system, "userId");
// userId() => number | undefined

// Subscribe to multiple facts at once
const data = useFact(system, ["name", "email"]);
// data() => { name: string; email: string }
```

{% callout type="note" title="Need a transform?" %}
Use [`useSelector`](#useselector) to derive values from facts. It auto-tracks dependencies and supports custom equality.
{% /callout %}

Usage in a component:

```tsx
function UserProfile() {
  // Subscribe to the userId
  const userId = useFact(system, "userId");

  // Subscribe to the user object
  const user = useFact(system, "user");

  return (
    <div>
      <p>ID: {userId()}</p>
      <p>User: {user()?.name}</p>
    </div>
  );
}
```

### useDerived

Read a single derivation or multiple derivations. Returns a reactive `Accessor`:

```tsx
// Subscribe to a single derivation
const displayName = useDerived(system, "displayName");
// displayName() => string

// Subscribe to multiple derivations at once
const state = useDerived(system, ["isLoggedIn", "isAdmin"]);
// state() => { isLoggedIn: boolean; isAdmin: boolean }
```

{% callout type="note" title="Need a transform?" %}
Use [`useSelector`](#useselector) to derive values from facts with auto-tracking and custom equality support.
{% /callout %}

Usage in a component:

```tsx
function Greeting() {
  // Subscribe to the display name derivation
  const displayName = useDerived(system, "displayName");

  return <h1>Hello, {displayName()}!</h1>;
}
```

### useEvents

Get a typed reference to the system's event dispatchers:

```tsx
function Counter() {
  // Get typed event dispatchers for the module
  const events = useEvents(system);

  return (
    <div>
      <button onClick={() => events.increment()}>+</button>
      <button onClick={() => events.setCount({ count: 0 })}>Reset</button>
    </div>
  );
}
```

The returned reference is stable (memoized on the system instance).

### useDispatch

Low-level event dispatch for untyped or system events:

```tsx
function IncrementButton() {
  // Get the low-level dispatch function
  const dispatch = useDispatch(system);

  return (
    <button onClick={() => dispatch({ type: "increment" })}>
      +1
    </button>
  );
}
```

### useWatch

Watch a fact or derivation for changes – runs a callback as a side effect without creating a signal for rendering. The key is auto-detected as either a fact or derivation, so no discriminator is needed:

```tsx
// Watch a derivation for analytics tracking
useWatch(system, "pageViews", (newValue, prevValue) => {
  analytics.track("pageViews", { from: prevValue, to: newValue });
});

// Watch a fact – auto-detected, no "fact" discriminator needed
useWatch(system, "userId", (newValue, prevValue) => {
  analytics.track("userId_changed", { from: prevValue, to: newValue });
});
```

{% callout type="warning" title="Deprecated: \"fact\" discriminator" %}
The old `useWatch("fact", key, callback)` three-argument pattern still works but is deprecated. Use `useWatch(system, key, callback)` instead – the runtime auto-detects whether the key is a fact or derivation.

```tsx
// Deprecated – still works but not recommended
useWatch("fact", "userId", (newValue, prevValue) => { /* ... */ });

// Preferred – auto-detects fact vs derivation
useWatch(system, "userId", (newValue, prevValue) => { /* ... */ });
```
{% /callout %}

---

## Inspection

### useInspect

Get system inspection data as a signal. Accepts an optional `{ throttleMs }` parameter for high-frequency updates. Returns `Accessor<InspectState>`:

```tsx
function Inspector() {
  // Get reactive system inspection data
  const inspection = useInspect(system);

  return (
    <pre>
      Settled: {inspection().isSettled ? "Yes" : "No"}
      Unmet: {inspection().unmet.length}
      Inflight: {inspection().inflight.length}
      Working: {inspection().isWorking ? "Yes" : "No"}
    </pre>
  );
}
```

With throttling:

```tsx
// Throttle inspection updates to limit render frequency
const inspection = useInspect(system, { throttleMs: 200 });
```

`InspectState` fields:

| Field | Type | Description |
|---|---|---|
| `isSettled` | `boolean` | No pending work |
| `unmet` | `Array` | Unmet requirements |
| `inflight` | `Array` | In-flight resolvers |
| `isWorking` | `boolean` | Has inflight resolvers |
| `hasUnmet` | `boolean` | Has unmet requirements |
| `hasInflight` | `boolean` | Has in-flight resolvers |

### useConstraintStatus

Read constraint status reactively:

```tsx
// Get all constraints for the debug panel
const constraints = useConstraintStatus(system);
// constraints(): Array<{ id: string; active: boolean; priority: number }>

// Check a specific constraint by ID
const auth = useConstraintStatus(system, "requireAuth");
// auth(): { id: "requireAuth", active: true, priority: 50 } | null
```

### useExplain

Get a reactive explanation of why a requirement exists:

```tsx
function RequirementDebug(props) {
  // Get a detailed explanation of why a requirement was generated
  const explanation = useExplain(system, props.requirementId);

  return (
    <Show when={explanation()} fallback={<p>No active requirement</p>}>
      <pre>{explanation()}</pre>
    </Show>
  );
}
```

---

## Async Status

These hooks require a `statusPlugin` instance. Create one and pass it to the hooks directly:

```tsx
import { createRequirementStatusPlugin } from '@directive-run/core';
import { useRequirementStatus } from '@directive-run/solid';

// Create the status plugin for tracking requirement resolution
const statusPlugin = createRequirementStatusPlugin();

// Pass the plugin when creating the system
const system = createSystem({
  module: myModule,
  plugins: [statusPlugin.plugin],
});
system.start();

// Pass statusPlugin directly to hooks that need it
function UserLoader() {
  const status = useRequirementStatus(statusPlugin, "FETCH_USER");
  // ...
}
```

### useRequirementStatus

Get full status for a single requirement type or multiple types. Takes `statusPlugin` as the first parameter:

```tsx
import { Show } from 'solid-js';

// Track the loading state of a specific requirement type
function UserLoader() {
  const status = useRequirementStatus(statusPlugin, "FETCH_USER");

  return (
    <Show when={!status().isLoading} fallback={<Spinner />}>
      <Show when={!status().hasError} fallback={<Error message={status().lastError?.message} />}>
        <UserContent />
      </Show>
    </Show>
  );
}

// Track multiple requirement types at once
function DashboardLoader() {
  const statuses = useRequirementStatus(statusPlugin, ["FETCH_USER", "FETCH_SETTINGS"]);
  // statuses(): Record<string, RequirementTypeStatus>

  return (
    <Show when={!statuses()["FETCH_USER"].isLoading}>
      <Dashboard />
    </Show>
  );
}
```

### useSuspenseRequirement

Integrates with Solid's `Suspense` – throws a promise while the requirement is pending. Takes `statusPlugin` as the first parameter:

```tsx
import { Suspense } from 'solid-js';

function UserProfile() {
  // Suspends rendering until the requirement resolves
  useSuspenseRequirement(statusPlugin, "FETCH_USER");
  // Only renders after FETCH_USER resolves
  return <div>User loaded!</div>;
}

// Multiple requirements
function Dashboard() {
  useSuspenseRequirement(statusPlugin, ["FETCH_USER", "FETCH_SETTINGS"]);
  // Only renders after both resolve
  return <div>Everything loaded!</div>;
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

### useOptimisticUpdate

Apply optimistic mutations with automatic rollback on resolver failure:

```tsx
function SaveButton() {
  // Set up optimistic mutations with automatic rollback
  const { mutate, isPending, error, rollback } = useOptimisticUpdate(
    system,
    statusPlugin,    // optional – enables auto-rollback on resolver failure
    "SAVE_DATA"      // requirement type to watch
  );

  const handleSave = () => {
    mutate(() => {
      // Optimistically update the UI before the server responds
      system.facts.savedAt = Date.now();
      system.facts.status = "saved";
    });
    // If "SAVE_DATA" resolver fails, facts are rolled back automatically
  };

  return (
    <button onClick={handleSave} disabled={isPending()}>
      {isPending() ? "Saving..." : "Save"}
    </button>
  );
}
```

Manual rollback is also available via `rollback()`.

---

## Signal Factories

Create signals outside of components. Useful for stores or other reactive contexts. Returns a tuple of `[Accessor<T>, cleanup]`:

### createDerivedSignal

```typescript
import { createDerivedSignal } from '@directive-run/solid';

const system = createSystem({ module: myModule });
system.start();

// Create a derivation signal outside of components
const [isRed, cleanup] = createDerivedSignal<boolean>(system, "isRed");

// Use isRed() anywhere
console.log(isRed());

// Clean up when done
cleanup();
```

### createFactSignal

```typescript
import { createFactSignal } from '@directive-run/solid';

const system = createSystem({ module: myModule });
system.start();

// Create a fact signal outside of components
const [phase, cleanup] = createFactSignal<string>(system, "phase");

console.log(phase());

cleanup();
```

---

## Typed Hooks

Create fully typed hooks for your module schema. Returned hooks take `system` as their first parameter:

```typescript
import { createTypedHooks } from '@directive-run/solid';

// Create typed hooks – full autocomplete for keys and events
const {
  useDerived, useFact, useDispatch, useEvents
} = createTypedHooks<typeof myModule.schema>();

function Profile() {
  // Fully typed – fact key autocompletes, return type inferred
  const count = useFact(system, "count");       // Type: Accessor<number>
  const doubled = useDerived(system, "doubled"); // Type: Accessor<number>
  const dispatch = useDispatch(system);
  const events = useEvents(system);

  dispatch({ type: "increment" });       // Typed!
  events.increment();                    // Typed!
}
```

---

## Time Travel

`useTimeTravel` returns an `Accessor<TimeTravelState | null>` – `null` when disabled, otherwise the full reactive API. Call `timeTravel()` to read, and destructure inside `<Show>` to access properties:

### Undo / Redo Controls

```tsx
import { useTimeTravel } from '@directive-run/solid';
import { Show } from 'solid-js';

function UndoRedo() {
  const timeTravel = useTimeTravel(system);

  return (
    <Show when={timeTravel()}>
      {(state) => {
        const { canUndo, canRedo, undo, redo, currentIndex, totalSnapshots } = state();

        return (
          <div>
            <button onClick={undo} disabled={!canUndo}>Undo</button>
            <button onClick={redo} disabled={!canRedo}>Redo</button>
            <span>{currentIndex + 1} / {totalSnapshots}</span>
          </div>
        );
      }}
    </Show>
  );
}
```

### Snapshot Timeline

`snapshots` is lightweight metadata only (no facts data). Use `getSnapshotFacts(id)` to lazily load a snapshot's state on demand:

```tsx
import { Show, For } from 'solid-js';

function SnapshotTimeline() {
  const timeTravel = useTimeTravel(system);

  return (
    <Show when={timeTravel()}>
      {(state) => (
        <ul>
          <For each={state().snapshots}>
            {(snap) => (
              <li>
                <button onClick={() => state().goTo(snap.id)}>
                  {snap.trigger} – {new Date(snap.timestamp).toLocaleTimeString()}
                </button>
                <button onClick={() => console.log(state().getSnapshotFacts(snap.id))}>
                  Inspect
                </button>
              </li>
            )}
          </For>
        </ul>
      )}
    </Show>
  );
}
```

### Navigation

```tsx
function NavigationControls() {
  const timeTravel = useTimeTravel(system);

  return (
    <Show when={timeTravel()}>
      {(state) => {
        const { goBack, goForward, goTo, replay } = state();

        return (
          <div>
            <button onClick={() => goBack(5)}>Back 5</button>
            <button onClick={() => goForward(5)}>Forward 5</button>
            <button onClick={() => goTo(0)}>Jump to Start</button>
            <button onClick={replay}>Replay All</button>
          </div>
        );
      }}
    </Show>
  );
}
```

### Session Persistence

```tsx
function SessionControls() {
  const timeTravel = useTimeTravel(system);

  return (
    <Show when={timeTravel()}>
      {(state) => {
        const { exportSession, importSession } = state();

        return (
          <div>
            <button onClick={() => localStorage.setItem('debug', exportSession())}>
              Save Session
            </button>
            <button onClick={() => {
              const saved = localStorage.getItem('debug');
              if (saved) {
                importSession(saved);
              }
            }}>
              Restore Session
            </button>
          </div>
        );
      }}
    </Show>
  );
}
```

### Changesets

Group multiple fact mutations into a single undo/redo unit:

```tsx
function BatchedAction() {
  const timeTravel = useTimeTravel(system);

  function handleComplexAction() {
    timeTravel()?.beginChangeset('Move piece A→B');
    // ... multiple fact mutations ...
    timeTravel()?.endChangeset();
    // Now undo/redo treats all mutations as one step
  }

  return <button onClick={handleComplexAction}>Move Piece</button>;
}
```

### Recording Control

```tsx
function RecordingToggle() {
  const timeTravel = useTimeTravel(system);

  return (
    <Show when={timeTravel()}>
      {(state) => {
        const { isPaused, pause, resume } = state();

        return (
          <button onClick={isPaused ? resume : pause}>
            {isPaused ? 'Resume' : 'Pause'} Recording
          </button>
        );
      }}
    </Show>
  );
}
```

See [Time-Travel](/docs/advanced/time-travel) for the full `TimeTravelState` interface and keyboard shortcuts.

---

## Patterns

### Loading States

```tsx
import { Show } from 'solid-js';

function UserCard() {
  // Subscribe to loading, error, and user states
  const loading = useFact(system, "loading");
  const error = useFact(system, "error");
  const user = useFact(system, "user");

  return (
    <Show when={!loading()} fallback={<Spinner />}>
      <Show when={!error()} fallback={<Error message={error()} />}>
        <Show when={user()} fallback={<EmptyState />}>
          <UserDetails user={user()!} />
        </Show>
      </Show>
    </Show>
  );
}
```

### Writing Facts

Write facts through the system directly:

```tsx
function UserIdInput() {
  // Subscribe to the current userId
  const userId = useFact(system, "userId");

  return (
    <input
      type="number"
      value={userId() ?? 0}
      onInput={(e) => { system.facts.userId = parseInt(e.currentTarget.value); }}
    />
  );
}
```

Or dispatch events:

```tsx
function IncrementButton() {
  const dispatch = useDispatch(system);

  return <button onClick={() => dispatch({ type: "increment" })}>+</button>;
}
```

---

## Testing

```tsx
import { render, screen } from '@solidjs/testing-library';
import { createTestSystem } from '@directive-run/core/testing';
import { useFact } from '@directive-run/solid';
import { userModule } from './modules/user';
import { UserProfile } from './UserProfile';

test('displays user name', async () => {
  // Create a test system with mock data
  const system = createTestSystem({ module: userModule });
  system.facts.user = { id: 1, name: 'Test User' };

  // Components receive system directly – no provider needed
  render(() => <UserProfile system={system} />);

  expect(screen.getByText('Test User')).toBeInTheDocument();
});
```

---

## API Reference

| Export | Type | Description |
|---|---|---|
| `useFact` | Hook | Read single/multi facts |
| `useDerived` | Hook | Read single/multi derivations |
| `useSelector` | Hook | Select across all facts |
| `useEvents` | Hook | Typed event dispatchers |
| `useDispatch` | Hook | Low-level event dispatch |
| `useWatch` | Hook | Side-effect watcher for facts or derivations |
| `useInspect` | Hook | System inspection (unmet, inflight, settled) with optional throttle |
| `useConstraintStatus` | Hook | Reactive constraint inspection |
| `useExplain` | Hook | Reactive requirement explanation |
| `useRequirementStatus` | Hook | Single/multi requirement status (takes statusPlugin) |
| `useSuspenseRequirement` | Hook | Suspense integration for requirements (takes statusPlugin) |
| `useOptimisticUpdate` | Hook | Optimistic mutations with rollback |
| `useDirective` | Hook | Scoped system with selected or all subscriptions |
| `createTypedHooks` | Factory | Create fully typed hooks for a schema |
| `createDerivedSignal` | Factory | Create a derivation signal outside components |
| `createFactSignal` | Factory | Create a fact signal outside components |
| `useTimeTravel` | Hook | Reactive time-travel state (canUndo, canRedo, undo, redo) |
| `shallowEqual` | Utility | Shallow equality for selectors |

---

## Next Steps

- **[Quick Start](/docs/quick-start)** – Build your first module
- **[Facts](/docs/facts)** – State management deep dive
- **[Testing](/docs/testing/overview)** – Testing Solid components
