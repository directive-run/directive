---
title: React Adapter
description: Integrate Directive with React using system-first hooks. useFact, useDerived, useEvents, useDispatch — types flow from the system reference, no provider needed.
---

Directive's React hooks use a **system-first** pattern: pass the system as the first argument, and TypeScript infers everything else. No context, no provider, no factory. {% .lead %}

---

## Installation

The React adapter is included in the main package:

```typescript
import { useFact, useDerived, useEvents, useDispatch } from 'directive/react';
```

---

## Quick Start

```tsx
import { createSystem } from 'directive';
import { useFact, useDerived, useEvents } from 'directive/react';
import { counterModule } from './modules/counter';

const system = createSystem({ module: counterModule });
system.start();

function Counter() {
  const count = useFact(system, "count");        // inferred: number
  const doubled = useDerived(system, "doubled");  // inferred: number
  const events = useEvents(system);               // typed event dispatchers

  return (
    <div>
      <p>Count: {count}, Doubled: {doubled}</p>
      <button onClick={() => events.increment()}>+</button>
    </div>
  );
}
```

Every hook takes the system as its first parameter. TypeScript infers the fact keys, derivation keys, and event types from the system reference — no manual generics needed.

---

## Core Hooks

### useFact

Read a single fact, multiple facts, or a selected slice of a fact:

```tsx
// Single fact — re-renders when "userId" changes
const userId = useFact(system, "userId");

// Multiple facts — re-renders when any listed fact changes
const { name, email, avatar } = useFact(system, ["name", "email", "avatar"]);

// Selector — re-renders only when the selected value changes
const upperName = useFact(system, "user", (user) => user?.name?.toUpperCase() ?? "GUEST");

// Selector with custom equality
const ids = useFact(system, "users", (users) => users?.map(u => u.id) ?? [], shallowEqual);
```

### useDerived

Read a single derivation, multiple derivations, or a selected slice:

```tsx
// Single derivation
const displayName = useDerived(system, "displayName");

// Multiple derivations
const { isLoggedIn, isAdmin } = useDerived(system, ["isLoggedIn", "isAdmin"]);

// Selector — only re-renders when selected value changes
const itemCount = useDerived(system, "stats", (stats) => stats.itemCount);
```

### useSelector

Select from all facts with **auto-tracking**. Directive detects which fact keys your selector reads and subscribes only to those — no manual dependency lists:

```tsx
const summary = useSelector(system, (facts) => ({
  userName: facts.user?.name,
  itemCount: facts.items?.length ?? 0,
}));
```

{% callout type="note" title="Auto-tracking" %}
`useSelector` uses Directive's tracking system to detect accessed fact keys at subscription time. Inline selectors work without `useCallback` — the hook stores the selector in a ref internally (Zustand pattern).
{% /callout %}

### useEvents

Get a typed reference to the system's event dispatchers:

```tsx
function Counter() {
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
const dispatch = useDispatch(system);
dispatch({ type: "increment" });
```

### useWatch

Watch a derivation or fact for changes without causing re-renders — runs a callback as a side effect:

```tsx
// Watch a derivation
useWatch(system, "pageViews", (newValue, prevValue) => {
  analytics.track("pageViews", { from: prevValue, to: newValue });
});

// Watch a fact
useWatch(system, "fact", "userId", (newValue, prevValue) => {
  analytics.track("userId_changed", { from: prevValue, to: newValue });
});
```

---

## Scoped Systems

### useDirectiveRef

Create a system scoped to a component's lifecycle. The system starts in a `useEffect` and is destroyed on unmount:

```tsx
import { useDirectiveRef, useFact, useEvents } from 'directive/react';

function Counter() {
  const system = useDirectiveRef(counterModule);
  const count = useFact(system, "count");
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
  const { system, statusPlugin } = useDirectiveRef(myModule, { status: true });
  const status = useRequirementStatus(statusPlugin, "FETCH_DATA");
  const count = useFact(system, "count");
  // ...
}
```

With initial facts and plugins:

```tsx
const system = useDirectiveRef(myModule, {
  initialFacts: { count: 10 },
  plugins: [loggingPlugin()],
  debug: { timeTravel: true },
});
```

### useDirective

Higher-level hook that creates a scoped system and subscribes to selected facts and derivations in one call:

```tsx
import { useDirective } from 'directive/react';

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
```

### useModule

Zero-config hook that creates a scoped system and subscribes to all facts and derivations:

```tsx
import { useModule } from 'directive/react';

function Counter() {
  const { system, facts, derived, events, dispatch } = useModule(counterModule);

  return (
    <div>
      <p>Count: {facts.count}, Doubled: {derived.doubled}</p>
      <button onClick={() => events.increment()}>+</button>
    </div>
  );
}
```

With status plugin:

```tsx
const { system, facts, derived, events, dispatch, statusPlugin } = useModule(counterModule, {
  status: true,
});
```

---

## SSR & Hydration

### DirectiveHydrator

Wrap your app (or a subtree) with a distributable snapshot from the server:

```tsx
// Server: generate snapshot
const snapshot = system.getDistributableSnapshot({
  includeDerivations: ['effectivePlan', 'canUseFeature'],
  ttlSeconds: 3600,
});

// Client: hydrate
import { DirectiveHydrator, useHydratedSystem } from 'directive/react';

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
  const system = useHydratedSystem(dashboardModule);
  const plan = useDerived(system, "effectivePlan");
  // system.facts are pre-populated from the server snapshot
  return <p>Plan: {plan}</p>;
}
```

---

## Inspection

### useInspect

Get system inspection data (unmet requirements, inflight resolvers, constraint status):

```tsx
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

With throttling for high-frequency updates:

```tsx
const inspection = useInspect(system, { throttleMs: 200 });
```

### useConstraintStatus

Read constraint status reactively:

```tsx
// All constraints
const constraints = useConstraintStatus(system);
// constraints: Array<{ id: string; active: boolean; priority: number }>

// Single constraint
const auth = useConstraintStatus(system, "requireAuth");
// auth: { id: "requireAuth", active: true, priority: 50 } | null
```

### useExplain

Get a reactive explanation of why a requirement exists:

```tsx
function RequirementDebug({ requirementId }) {
  const explanation = useExplain(system, requirementId);

  if (!explanation) return <p>No active requirement</p>;
  return <pre>{explanation}</pre>;
}
```

---

## Async Status

These hooks require a `statusPlugin`:

```tsx
import { createRequirementStatusPlugin, createSystem } from 'directive';
import { useRequirementStatus, useSuspenseRequirement } from 'directive/react';

const statusPlugin = createRequirementStatusPlugin();
const system = createSystem({
  module: myModule,
  plugins: [statusPlugin.plugin],
});
system.start();
```

### useRequirementStatus

```tsx
// Single requirement type
const status = useRequirementStatus(statusPlugin, "FETCH_USER");
// status: { isLoading, hasError, pending, inflight, failed, lastError }

// Multiple requirement types
const statuses = useRequirementStatus(statusPlugin, ["FETCH_USER", "FETCH_SETTINGS"]);
// statuses: Record<string, RequirementTypeStatus>
```

### useSuspenseRequirement

Integrates with React Suspense — throws a promise while the requirement is pending:

```tsx
import { Suspense } from 'react';

function UserProfile() {
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
  const { mutate, isPending, error, rollback } = useOptimisticUpdate(
    system,
    statusPlugin,    // optional — enables auto-rollback on resolver failure
    "SAVE_DATA"      // requirement type to watch
  );

  const handleSave = () => {
    mutate(() => {
      // Optimistic update — applied immediately via system.batch()
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
import { DirectiveDevTools } from 'directive/react';

function App() {
  return (
    <>
      <MyApp />
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

## Migration from Deprecated Hooks

The following hooks are deprecated but still work. They delegate to the new consolidated API:

| Deprecated | Use Instead |
|---|---|
| `useFacts(system, keys)` | `useFact(system, keys)` |
| `useFactSelector(system, key, fn)` | `useFact(system, key, fn)` |
| `useDerivations(system, keys)` | `useDerived(system, keys)` |
| `useDerivedSelector(system, key, fn)` | `useDerived(system, key, fn)` |
| `useDirectiveRefWithStatus(mod)` | `useDirectiveRef(mod, { status: true })` |
| `useIsSettled(system)` | `useInspect(system).isSettled` |
| `useRequirements(system)` | `useInspect(system)` |
| `useRequirementsThrottled(system, opts)` | `useInspect(system, opts)` |
| `useInspectThrottled(system, opts)` | `useInspect(system, opts)` |
| `useIsResolving(plugin, type)` | `useRequirementStatus(plugin, type).isLoading` |
| `useLatestError(plugin, type)` | `useRequirementStatus(plugin, type).lastError` |
| `useRequirementStatuses(plugin, types)` | `useRequirementStatus(plugin, types)` |
| `useSuspenseRequirements(plugin, opts)` | `useSuspenseRequirement(plugin, types)` |
| `useSystem(mod, opts)` | `useDirective(mod, opts)` or `useModule(mod)` |
| `useDirectiveDevTools(system)` | `useInspect(system)` |
| `useWatchFact(system, key, fn)` | `useWatch(system, "fact", key, fn)` |

---

## Testing

```tsx
import { render, screen } from '@testing-library/react';
import { createTestSystem } from 'directive/testing';
import { useFact } from 'directive/react';
import { userModule } from './modules/user';

function UserProfile({ system }) {
  const user = useFact(system, "user");
  return <p>{user?.name}</p>;
}

test('displays user name', async () => {
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

## Time-Travel Debugging

Use `useTimeTravel` for reactive undo/redo controls that re-render when snapshot state changes:

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

Returns `null` when time-travel is disabled. See [Time-Travel](/docs/advanced/time-travel) for changesets and keyboard shortcuts.

---

## Next Steps

- **[Quick Start](/docs/quick-start)** — Build your first module
- **[Facts](/docs/facts)** — State management deep dive
- **[Testing](/docs/testing/overview)** — Testing React components
