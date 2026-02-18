---
title: React Adapter
description: Integrate Directive with React using system-first hooks. useFact, useDerived, useEvents, useDispatch – types flow from the system reference, no provider needed.
---

Directive's React hooks use a **system-first** pattern: pass the system as the first argument, and TypeScript infers everything else. No context, no provider, no factory. {% .lead %}

---

## Installation

The React adapter is included in the main package:

```typescript
import { useFact, useDerived, useEvents, useDispatch } from '@directive-run/react';
```

---

## Setup

Create a system at module level and pass it explicitly to hooks:

```typescript
import { createModule, createSystem, t } from '@directive-run/core';

const userModule = createModule("user", {
  schema: {
    facts: {
      userId: t.number(),
      user: t.object<User | null>(),
    },
    derivations: {
      displayName: t.string(),
    },
    events: {
      setUserId: { userId: t.number() },
    },
    requirements: {
      FETCH_USER: {},
    },
  },
  init: (facts) => {
    facts.userId = 0;
    facts.user = null;
  },
  derive: {
    displayName: (facts) => facts.user?.name ?? "Guest",
  },
  constraints: {
    needsUser: {
      when: (facts) => facts.userId > 0 && !facts.user,
      require: { type: "FETCH_USER" },
    },
  },
  resolvers: {
    fetchUser: {
      requirement: "FETCH_USER",
      resolve: async (req, context) => {
        context.facts.user = await api.getUser(context.facts.userId);
      },
    },
  },
});

// Create and start the system
const system = createSystem({ module: userModule });
system.start();

// Export for use in components
export { system };
```

Then pass the system to hooks in your components:

```tsx
import { useFact, useDerived, useEvents } from '@directive-run/react';
import { system } from './system';

function UserProfile() {
  // Subscribe to the user fact
  const user = useFact(system, "user");

  // Subscribe to the display name derivation
  const displayName = useDerived(system, "displayName");

  // Get typed event dispatchers
  const events = useEvents(system);

  return (
    <div>
      <h1>{displayName}</h1>
      <button onClick={() => events.setUserId({ userId: 42 })}>Load User</button>
    </div>
  );
}
```

Every hook takes the system as its first parameter. TypeScript infers the fact keys, derivation keys, and event types from the system reference – no manual generics needed.

---

## Creating Systems

Every hook below requires a `system` reference. There are three ways to create one:

- **Global system** – call `createSystem()` at module level for app-wide state shared across components (shown in [Setup](#setup) above)
- **`useDirectiveRef`** (recommended) – creates a system scoped to a component's lifecycle, auto-starts on mount and destroys on unmount
- **`useDirective`** – creates a scoped system **and** subscribes to facts and derivations in one call

For most React apps, prefer `useDirectiveRef` so each component owns its own system lifecycle. Use a global system when multiple components need to share the same state.

The two hooks below are progressive shortcuts – each adds more automatic behavior:

| Hook | Creates system | Subscribes to state | You choose what to subscribe to |
|---|---|---|---|
| `useDirectiveRef` | Yes | No – use `useFact`, `useDerived`, etc. separately | Full control |
| `useDirective` | Yes | Yes – selected keys, or **everything** if none specified | You pick the keys (or omit for all) |

### useDirectiveRef

Create a system scoped to a component's lifecycle. The system starts in a `useEffect` and is destroyed on unmount:

```tsx
import { useDirectiveRef, useFact, useEvents } from '@directive-run/react';

function Counter() {
  // Create a scoped system tied to this component's lifecycle
  const system = useDirectiveRef(counterModule);

  // Subscribe to the current count
  const count = useFact(system, "count");

  // Get typed event dispatchers
  const events = useEvents(system);

  return (
    <div>
      <p>{count}</p>
      <button onClick={() => events.increment()}>+</button>
    </div>
  );
}
```

With status plugin:

```tsx
function App() {
  // Create a scoped system with the status plugin enabled
  const { system, statusPlugin } = useDirectiveRef(myModule, { status: true });

  // Track the loading state of a specific requirement
  const status = useRequirementStatus(statusPlugin, "FETCH_DATA");

  // Subscribe to a fact value
  const count = useFact(system, "count");
  // ...
}
```

With initial facts and plugins:

```tsx
// Create a scoped system with plugins and initial state
const system = useDirectiveRef(myModule, {
  initialFacts: { count: 10 },
  plugins: [loggingPlugin()],
  debug: { timeTravel: true },
});
```

### useDirective

Creates a scoped system **and** subscribes to facts and derivations. Two modes:

- **Selective** – specify `facts` and/or `derived` keys to subscribe only to those (component re-renders only when selected keys change)
- **Subscribe all** – omit keys to subscribe to everything (good for prototyping or small modules)

```tsx
import { useDirective } from '@directive-run/react';

// Selective: subscribe to specific keys only
function Counter() {
  const { dispatch, facts, derived } = useDirective(counterModule, {
    facts: ["count"],
    derived: ["doubled"],
  });

  return (
    <div>
      <p>Count: {facts.count}, Doubled: {derived.doubled}</p>
      <button onClick={() => dispatch({ type: "increment" })}>+</button>
    </div>
  );
}

// Subscribe all: omit keys to get everything
function CounterFull() {
  const { system, facts, derived, events, dispatch } = useDirective(counterModule);

  return (
    <div>
      <p>Count: {facts.count}, Doubled: {derived.doubled}</p>
      <button onClick={() => events.increment()}>+</button>
    </div>
  );
}
```

System config (`plugins`, `initialFacts`, `debug`, etc.) goes in the same options object:

```tsx
const { facts, derived, events, dispatch } = useDirective(counterModule, {
  initialFacts: { count: 10 },
  plugins: [loggingPlugin()],
  debug: { timeTravel: true },
  status: true, // adds statusPlugin to return value
});
```

---

## Core Hooks

### useSelector

The go-to hook for **transforms and derived values** from facts. Directive auto-tracks which fact keys your selector reads and subscribes only to those &ndash; no manual dependency lists:

```tsx
// Transform a single fact value
const upperName = useSelector(system, (state) => state.user?.name?.toUpperCase() ?? "GUEST");

// Combine values from multiple facts and derivations
const summary = useSelector(system, (state) => ({
  userName: state.user?.name,
  itemCount: state.items?.length ?? 0,
}));

// Custom equality to prevent unnecessary re-renders on array/object results
const ids = useSelector(
  system,
  (state) => state.users?.map(u => u.id) ?? [],
  undefined,
  shallowEqual,
);
```

#### Default values

Pass a default value as the 3rd parameter. The default is returned before the system starts (when using `useDirectiveRef`, `start()` runs in a `useEffect` after first render) or when the selector returns `undefined`:

```tsx
// Without default – requires ?? fallback at each call site
const email = useSelector(system, (state) => state.email) ?? "";

// With default – cleaner, prevents React's "uncontrolled to controlled" warning
const email = useSelector(system, (state) => state.email, "");
const status = useSelector(system, (state) => state.status, "idle");
const canSubmit = useSelector(system, (state) => state.canSubmit, false);
```

When a default value is provided, the system parameter may be `null` or `undefined`. The hook returns the default and recomputes automatically when the system becomes available:

```tsx
// Nullable system – useful for conditional or lazy initialization
const status = useSelector(maybeSystem, (state) => state.status, "idle");
```

{% callout type="note" title="Auto-tracking" %}
`useSelector` uses Directive's tracking system to detect accessed fact keys at subscription time. Inline selectors work without `useCallback` &ndash; the hook stores the selector in a ref internally (Zustand pattern).
{% /callout %}

### useFact

Read a single fact or multiple facts:

```tsx
// Subscribe to a single fact – re-renders when "userId" changes
const userId = useFact(system, "userId");

// Subscribe to multiple facts at once
const { name, email, avatar } = useFact(system, ["name", "email", "avatar"]);
```

{% callout type="note" title="Need a transform?" %}
Use [`useSelector`](#useselector) to derive values from facts. It auto-tracks dependencies and supports custom equality.
{% /callout %}

### useDerived

Read a single derivation or multiple derivations:

```tsx
// Subscribe to a single derivation
const displayName = useDerived(system, "displayName");

// Subscribe to multiple derivations at once
const { isLoggedIn, isAdmin } = useDerived(system, ["isLoggedIn", "isAdmin"]);
```

{% callout type="note" title="Need a transform?" %}
Use [`useSelector`](#useselector) to derive values from facts with auto-tracking and custom equality support.
{% /callout %}

### useEvents

Get a typed reference to the system's event dispatchers:

```tsx
function Counter() {
  // Get typed event dispatchers for the system
  const events = useEvents(system);

  return (
    <div>
      <button onClick={() => events.increment()}>+</button>
      <button onClick={() => events.setCount({ count: 0 })}>Reset</button>
    </div>
  );
}
```

The returned reference is stable across renders (memoized on the system instance).

### useDispatch

Low-level event dispatch for untyped or system events:

```tsx
// Get the low-level dispatch function
const dispatch = useDispatch(system);

// Send an event object directly
dispatch({ type: "increment" });
```

### useWatch

Watch a fact or derivation for changes without causing re-renders – auto-detects whether the key is a fact or derivation:

```tsx
// Watch a fact (auto-detected)
useWatch(system, "userId", (newValue, prevValue) => {
  analytics.track("userId_changed", { from: prevValue, to: newValue });
});

// Watch a derivation (auto-detected)
useWatch(system, "pageViews", (newValue, prevValue) => {
  analytics.track("pageViews", { from: prevValue, to: newValue });
});

```

---

## SSR & Hydration

### DirectiveHydrator

Wrap your app (or a subtree) with a distributable snapshot from the server:

```tsx
// Server: generate a distributable snapshot
const snapshot = system.getDistributableSnapshot({
  includeDerivations: ['effectivePlan', 'canUseFeature'],
  ttlSeconds: 3600,
});

// Client: hydrate from the server snapshot
import { DirectiveHydrator, useHydratedSystem } from '@directive-run/react';

function App({ serverSnapshot }) {
  return (
    <DirectiveHydrator snapshot={serverSnapshot}>
      <Dashboard />
    </DirectiveHydrator>
  );
}
```

### useHydratedSystem

Create a scoped system pre-populated with data from the server snapshot:

```tsx
function Dashboard() {
  // Create a system pre-hydrated from the server snapshot
  const system = useHydratedSystem(dashboardModule);

  // Derivation starts with the server-rendered value
  const plan = useDerived(system, "effectivePlan");

  return <p>Plan: {plan}</p>;
}
```

---

## Inspection

### useInspect

Get system inspection data (unmet requirements, inflight resolvers, constraint status):

```tsx
function DebugPanel() {
  // Get reactive system inspection data
  const inspection = useInspect(system);

  return (
    <pre>
      Unmet: {inspection.unmet.length}
      Inflight: {inspection.inflight.length}
    </pre>
  );
}
```

With throttling for high-frequency updates:

```tsx
// Throttle inspection updates to limit render frequency
const inspection = useInspect(system, { throttleMs: 200 });
```

### useConstraintStatus

Read constraint status reactively:

```tsx
// Get all constraints for the debug panel
const constraints = useConstraintStatus(system);
// constraints: Array<{ id: string; active: boolean; priority: number }>

// Check a specific constraint by ID
const auth = useConstraintStatus(system, "requireAuth");
// auth: { id: "requireAuth", active: true, priority: 50 } | null
```

### useExplain

Get a reactive explanation of why a requirement exists:

```tsx
function RequirementDebug({ requirementId }) {
  // Get a detailed explanation of why a requirement exists
  const explanation = useExplain(system, requirementId);

  if (!explanation) {
    return <p>No active requirement</p>;
  }

  return <pre>{explanation}</pre>;
}
```

---

## Async Status

These hooks require a `statusPlugin`:

```tsx
import { createRequirementStatusPlugin, createSystem } from '@directive-run/core';
import { useRequirementStatus, useSuspenseRequirement } from '@directive-run/react';

// Create the status plugin for tracking requirement resolution
const statusPlugin = createRequirementStatusPlugin();

// Pass the plugin when creating the system
const system = createSystem({
  module: myModule,
  plugins: [statusPlugin.plugin],
});
system.start();
```

### useRequirementStatus

```tsx
// Track a single requirement type
const status = useRequirementStatus(statusPlugin, "FETCH_USER");
// status: { isLoading, hasError, pending, inflight, failed, lastError }

// Track multiple requirement types at once
const statuses = useRequirementStatus(statusPlugin, ["FETCH_USER", "FETCH_SETTINGS"]);
// statuses: Record<string, RequirementTypeStatus>
```

### useSuspenseRequirement

Integrates with React Suspense – throws a promise while the requirement is pending:

```tsx
import { Suspense } from 'react';

function UserProfile() {
  // Suspends rendering until the requirement resolves
  useSuspenseRequirement(statusPlugin, "FETCH_USER");

  return <div>User loaded!</div>;
}

function Dashboard() {
  // Suspends until both requirements resolve
  useSuspenseRequirement(statusPlugin, ["FETCH_USER", "FETCH_SETTINGS"]);

  return <div>Everything loaded!</div>;
}

function App() {
  return (
    // Show a fallback while requirements are being resolved
    <Suspense fallback={<Spinner />}>
      <UserProfile />
    </Suspense>
  );
}
```

---

## Optimistic Updates

### useOptimisticUpdate

Apply optimistic mutations with automatic rollback on resolver failure:

```tsx
function SaveButton() {
  // Set up optimistic mutations with automatic rollback
  const { mutate, isPending, error, rollback } = useOptimisticUpdate(
    system,
    statusPlugin,
    "SAVE_DATA"
  );

  const handleSave = () => {
    mutate(() => {
      // Optimistic update – applied immediately via system.batch()
      system.facts.savedAt = Date.now();
      system.facts.status = "saved";
    });
    // If "SAVE_DATA" resolver fails, facts are rolled back automatically
  };

  return (
    <button onClick={handleSave} disabled={isPending}>
      {isPending ? "Saving..." : "Save"}
    </button>
  );
}
```

Manual rollback is also available via `rollback()`.

---

## DevTools

### DirectiveDevTools

Dev-only floating panel (tree-shaken in production):

```tsx
import { DirectiveDevTools } from '@directive-run/react';

function App() {
  return (
    <>
      <MyApp />
      {/* Floating debug panel – tree-shaken in production */}
      <DirectiveDevTools system={system} position="bottom-right" defaultOpen={false} />
    </>
  );
}
```

Features:
- Facts and derivations tables with live values
- Unmet requirements and inflight resolver counts
- Keyboard shortcut: press `Escape` to close
- Accessible: proper table headers, focus management

---

## Writing Facts

Write facts through the system directly:

```tsx
function UserIdInput() {
  // Subscribe to the current userId
  const userId = useFact(system, "userId");

  return (
    <input
      type="number"
      value={userId ?? 0}
      onChange={(e) => { system.facts.userId = parseInt(e.target.value); }}
    />
  );
}
```

---

## Testing

```tsx
import { render, screen } from '@testing-library/react';
import { createTestSystem } from '@directive-run/core/testing';
import { useFact } from '@directive-run/react';
import { userModule } from './modules/user';

function UserProfile({ system }) {
  // Subscribe to the user fact
  const user = useFact(system, "user");

  return <p>{user?.name}</p>;
}

test('displays user name', async () => {
  // Create a test system with mock data
  const system = createTestSystem({ module: userModule });
  system.facts.user = { id: 1, name: 'Test User' };

  render(<UserProfile system={system} />);

  expect(screen.getByText('Test User')).toBeInTheDocument();
});
```

---

## API Reference

| Export | Type | Description |
|---|---|---|
| `useFact` | Hook | Read single/multi facts |
| `useDerived` | Hook | Read single/multi derivations |
| `useSelector` | Hook | Auto-tracking selector over facts and derivations |
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

## Time-Travel Debugging

`useTimeTravel` returns `null` when disabled, otherwise a reactive `TimeTravelState` with the full API. Destructure to pull out exactly what you need:

### Undo / Redo Controls

```tsx
import { useTimeTravel } from '@directive-run/react';

function UndoRedo() {
  const timeTravel = useTimeTravel(system);

  if (!timeTravel) {
    return null;
  }

  const { canUndo, canRedo, undo, redo, currentIndex, totalSnapshots } = timeTravel;

  return (
    <div>
      <button onClick={undo} disabled={!canUndo}>Undo</button>
      <button onClick={redo} disabled={!canRedo}>Redo</button>
      <span>{currentIndex + 1} / {totalSnapshots}</span>
    </div>
  );
}
```

### Snapshot Timeline

`snapshots` is lightweight metadata only (no facts data). Use `getSnapshotFacts(id)` to lazily load a snapshot's state on demand:

```tsx
function SnapshotTimeline() {
  const timeTravel = useTimeTravel(system);

  if (!timeTravel) {
    return null;
  }

  const { snapshots, goTo, getSnapshotFacts } = timeTravel;

  return (
    <ul>
      {snapshots.map((snap) => (
        <li key={snap.id}>
          <button onClick={() => goTo(snap.id)}>
            {snap.trigger} – {new Date(snap.timestamp).toLocaleTimeString()}
          </button>
          <button onClick={() => console.log(getSnapshotFacts(snap.id))}>
            Inspect
          </button>
        </li>
      ))}
    </ul>
  );
}
```

### Navigation

```tsx
function NavigationControls() {
  const timeTravel = useTimeTravel(system);

  if (!timeTravel) {
    return null;
  }

  const { goBack, goForward, goTo, replay } = timeTravel;

  return (
    <div>
      <button onClick={() => goBack(5)}>Back 5</button>
      <button onClick={() => goForward(5)}>Forward 5</button>
      <button onClick={() => goTo(0)}>Jump to Start</button>
      <button onClick={replay}>Replay All</button>
    </div>
  );
}
```

### Session Persistence

```tsx
function SessionControls() {
  const timeTravel = useTimeTravel(system);

  if (!timeTravel) {
    return null;
  }

  const { exportSession, importSession } = timeTravel;

  return (
    <div>
      <button onClick={() => localStorage.setItem('debug', exportSession())}>
        Save Session
      </button>
      <button onClick={() => {
        const saved = localStorage.getItem('debug');
        if (saved) importSession(saved);
      }}>
        Restore Session
      </button>
    </div>
  );
}
```

### Changesets

Group multiple fact mutations into a single undo/redo unit:

```tsx
function BatchedAction() {
  const timeTravel = useTimeTravel(system);

  function handleComplexAction() {
    timeTravel?.beginChangeset('Move piece A→B');
    // ... multiple fact mutations ...
    timeTravel?.endChangeset();
    // Now undo/redo treats all mutations as one step
  }

  return <button onClick={handleComplexAction}>Move Piece</button>;
}
```

### Recording Control

```tsx
function RecordingToggle() {
  const timeTravel = useTimeTravel(system);

  if (!timeTravel) {
    return null;
  }

  const { isPaused, pause, resume } = timeTravel;

  return (
    <button onClick={isPaused ? resume : pause}>
      {isPaused ? 'Resume' : 'Pause'} Recording
    </button>
  );
}
```

See [Time-Travel](/docs/advanced/time-travel) for the full `TimeTravelState` interface and keyboard shortcuts.

---

## Next Steps

- **[Quick Start](/docs/quick-start)** – Build your first module
- **[Facts](/docs/facts)** – State management deep dive
- **[Testing](/docs/testing/overview)** – Testing React components
