---
title: Svelte Adapter
description: Integrate Directive with Svelte using reactive stores. useFact, useDerived, useEvents, useDispatch, and more – all hooks take system as an explicit first parameter.
---

Directive provides first-class Svelte integration with stores that automatically update on state changes. All hooks take `system` as an explicit first parameter – no context injection needed. {% .lead %}

---

## Installation

The Svelte adapter is included in the main package:

```typescript
import { useFact, useDerived, useEvents, useDispatch } from '@directive-run/svelte';
```

---

## Setup

Create a system and pass it directly to hooks – no context provider required:

```html
<script lang="ts">
  import { createSystem } from '@directive-run/core';
  import { useFact, useDerived, useEvents } from '@directive-run/svelte';
  import { userModule } from './modules/user';

  // Create and start the system
  const system = createSystem({ module: userModule });
  system.start();

  // Pass system directly to hooks
  const user = useFact(system, 'user');
  const displayName = useDerived(system, 'displayName');
  const events = useEvents(system);
</script>

<h1>Hello, {$displayName}!</h1>
<button on:click={() => events.setUserId({ userId: 1 })}>Load User</button>
```

For shared state across components, export the system from a module:

```typescript
// src/lib/directive.ts
import { createSystem } from '@directive-run/core';
import { userModule } from './modules/user';

export const system = createSystem({ module: userModule });
system.start();
```

Then import and use it in any component:

```html
<script>
  import { system } from '$lib/directive';
  import { useFact, useEvents } from '@directive-run/svelte';

  const user = useFact(system, 'user');
  const events = useEvents(system);
</script>

<p>User: {$user?.name ?? 'Guest'}</p>
<button on:click={() => events.setUserId({ userId: 1 })}>Load</button>
```

---

## Creating Systems

Every hook below requires a `system` passed as the first argument. There are two ways to create one:

- **Global system** – call `createSystem()` at module level for app-wide state shared across components (shown in [Setup](#setup) above)
- **`useDirective`** – creates a system scoped to a component's lifecycle, auto-starts on mount and destroys on unmount

For most Svelte apps, use a global system exported from a shared module. Use `useDirective` when you need per-component system isolation.

### useDirective

Creates a scoped system **and** subscribes to facts and derivations. Two modes:

- **Selective** – specify `facts` and/or `derived` keys to subscribe only to those
- **Subscribe all** – omit keys to subscribe to everything (good for prototyping or small modules)

```html
<script>
  import { useDirective } from '@directive-run/svelte';
  import { counterModule } from './counterModule';

  // Subscribe all: omit keys for everything
  const { system, facts, derived, events, dispatch } = useDirective(counterModule);
</script>

<div>
  <p>Count: {$facts.count}, Doubled: {$derived.doubled}</p>
  <button on:click={() => events.increment()}>+</button>
</div>
```

With selective subscriptions and config:

```html
<script>
  import { useDirective } from '@directive-run/svelte';
  import { loggingPlugin } from '@directive-run/core/plugins';
  import { counterModule } from './counterModule';

  // Selective: subscribe to specific keys only
  const { system, facts, derived, dispatch } = useDirective(counterModule, {
    facts: ['count'],
    derived: ['doubled'],
    plugins: [loggingPlugin()],
  });
</script>
```

---

## Core Hooks

All hooks below take `system` as an explicit first parameter and return Svelte `Readable` stores – use the `$` prefix for auto-subscription in templates.

### useSelector

The go-to hook for **transforms and derived values** from facts. Directive auto-tracks which fact keys your selector reads and subscribes only to those:

```html
<script>
  import { useSelector, shallowEqual } from '@directive-run/svelte';
  import { system } from '$lib/directive';

  // Transform a single fact value
  const upperName = useSelector(system, (state) => state.user?.name?.toUpperCase() ?? "GUEST");

  // Extract a slice from state
  const itemCount = useSelector(system, (state) => state.items?.length ?? 0);

  // Combine values from multiple facts and derivations
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
</script>

<p>{$summary.userName} has {$summary.itemCount} items</p>
```

### useFact

Read a single fact or multiple facts:

```html
<script>
  import { useFact } from '@directive-run/svelte';
  import { system } from '$lib/directive';

  // Subscribe to a single fact – Readable<number | undefined>
  const userId = useFact(system, "userId");

  // Subscribe to multiple facts at once
  const profile = useFact(system, ["name", "email", "avatar"]);
</script>

<div>
  <p>ID: {$userId}</p>
  <p>Name: {$profile.name}, Email: {$profile.email}</p>
</div>
```

{% callout type="note" title="Need a transform?" %}
Use [`useSelector`](#useselector) to derive values from facts. It auto-tracks dependencies and supports custom equality.
{% /callout %}

### useDerived

Read a single derivation or multiple derivations:

```html
<script>
  import { useDerived } from '@directive-run/svelte';
  import { system } from '$lib/directive';

  // Subscribe to a single derivation
  const displayName = useDerived(system, "displayName");

  // Subscribe to multiple derivations at once
  const auth = useDerived(system, ["isLoggedIn", "isAdmin"]);
</script>

<h1>Hello, {$displayName}!</h1>
<span>{$auth.isLoggedIn ? ($auth.isAdmin ? "Admin" : "User") : "Guest"}</span>
```

{% callout type="note" title="Need a transform?" %}
Use [`useSelector`](#useselector) to derive values from facts with auto-tracking and custom equality support.
{% /callout %}

### useEvents

Get a typed reference to the system's event dispatchers:

```html
<script>
  import { useEvents } from '@directive-run/svelte';
  import { system } from '$lib/directive';

  // Get typed event dispatchers for the module
  const events = useEvents(system);
</script>

<button on:click={() => events.increment()}>+</button>
<button on:click={() => events.setCount({ count: 0 })}>Reset</button>
```

The returned reference is stable (memoized on the system instance).

### useDispatch

Low-level event dispatch for untyped or system events:

```html
<script>
  import { useDispatch } from '@directive-run/svelte';
  import { system } from '$lib/directive';

  // Get the low-level dispatch function
  const dispatch = useDispatch(system);
</script>

<button on:click={() => dispatch({ type: "increment" })}>+1</button>
```

### useWatch

Watch a fact or derivation for changes. `useWatch` auto-detects whether the key refers to a fact or a derivation, so there is no need to pass a discriminator. Automatically cleans up on component destroy:

```html
<script>
  import { useWatch } from '@directive-run/svelte';
  import { system } from '$lib/directive';

  // Watch a derivation for analytics tracking
  useWatch(system, "pageViews", (newValue, prevValue) => {
    analytics.track("pageViews", { from: prevValue, to: newValue });
  });

  // Watch a fact – auto-detected, no "fact" discriminator needed
  useWatch(system, "userId", (newValue, prevValue) => {
    analytics.track("userId_changed", { from: prevValue, to: newValue });
  });
</script>
```

{% callout type="warning" title="Deprecated pattern" %}
The four-argument form `useWatch(system, "fact", "key", cb)` still works but is deprecated. Use `useWatch(system, "key", cb)` instead – `useWatch` now auto-detects whether the key is a fact or derivation.
{% /callout %}

---

## Inspection

### useInspect

Get system inspection data (unmet requirements, inflight resolvers, constraint status). Returns `Readable<InspectState>` where `InspectState` includes: `isSettled`, `unmet`, `inflight`, `isWorking`, `hasUnmet`, `hasInflight`.

```html
<script>
  import { useInspect } from '@directive-run/svelte';
  import { system } from '$lib/directive';

  // Get reactive system inspection data
  const inspection = useInspect(system);
</script>

<pre>
  Settled: {$inspection.isSettled}
  Unmet: {$inspection.unmet.length}
  Inflight: {$inspection.inflight.length}
</pre>
```

With throttling for high-frequency updates:

```html
<script>
  import { useInspect } from '@directive-run/svelte';
  import { system } from '$lib/directive';

  // Throttle updates to limit render frequency
  const inspection = useInspect(system, { throttleMs: 200 });
</script>
```

### useConstraintStatus

Read constraint status reactively:

```html
<script>
  import { useConstraintStatus } from '@directive-run/svelte';
  import { system } from '$lib/directive';

  // Get all constraints for the debug panel
  const constraints = useConstraintStatus(system);
  // Readable<Array<{ id: string; active: boolean; priority: number }>>

  // Check a specific constraint by ID
  const auth = useConstraintStatus(system, "requireAuth");
  // Readable<{ id: "requireAuth", active: true, priority: 50 } | null>
</script>

{#each $constraints as c}
  <p>{c.id}: {c.active ? 'Active' : 'Inactive'} (priority {c.priority})</p>
{/each}
```

### useExplain

Get a reactive explanation of why a requirement exists:

```html
<script>
  import { useExplain } from '@directive-run/svelte';
  import { system } from '$lib/directive';

  export let requirementId;

  // Get a detailed explanation of why a requirement was generated
  const explanation = useExplain(system, requirementId);
</script>

{#if $explanation}
  <pre>{$explanation}</pre>
{:else}
  <p>No active requirement</p>
{/if}
```

---

## Async Status

### useRequirementStatus

`useRequirementStatus` takes `statusPlugin` as its first parameter (not `system`):

```html
<script>
  import { createSystem, createRequirementStatusPlugin } from '@directive-run/core';
  import { useRequirementStatus } from '@directive-run/svelte';
  import { myModule } from './modules/myModule';

  // Create the status plugin for tracking requirement resolution
  const statusPlugin = createRequirementStatusPlugin();

  // Pass the plugin when creating the system
  const system = createSystem({
    module: myModule,
    plugins: [statusPlugin.plugin],
  });
  system.start();

  // Track a single requirement type – statusPlugin is the first param
  const status = useRequirementStatus(statusPlugin, "FETCH_USER");
  // Readable<{ isLoading, hasError, pending, inflight, failed, lastError }>

  // Track multiple requirement types at once
  const statuses = useRequirementStatus(statusPlugin, ["FETCH_USER", "FETCH_SETTINGS"]);
  // Readable<Record<string, RequirementTypeStatus>>
</script>

{#if $status.isLoading}
  <Spinner />
{:else if $status.hasError}
  <Error message={$status.lastError?.message} />
{:else}
  <UserContent />
{/if}
```

### useOptimisticUpdate

Apply optimistic mutations with automatic rollback on resolver failure:

```html
<script>
  import { createSystem, createRequirementStatusPlugin } from '@directive-run/core';
  import { useOptimisticUpdate } from '@directive-run/svelte';
  import { myModule } from './modules/myModule';

  const statusPlugin = createRequirementStatusPlugin();
  const system = createSystem({
    module: myModule,
    plugins: [statusPlugin.plugin],
  });
  system.start();

  // Set up optimistic mutations with automatic rollback
  const { mutate, isPending, error, rollback } = useOptimisticUpdate(system, statusPlugin, "SAVE_DATA");

  function handleSave() {
    mutate(() => {
      // Optimistic update – applied immediately
      system.facts.savedAt = Date.now();
      system.facts.status = "saved";
    });
    // If "SAVE_DATA" resolver fails, facts are rolled back automatically
  }
</script>

<button on:click={handleSave} disabled={$isPending}>
  {$isPending ? "Saving..." : "Save"}
</button>
```

---

## Store Factories

Store factories work outside components and accept a system instance directly. Use them when you need stores before a component mounts or in shared modules:

### createDerivedStore

```typescript
import { createDerivedStore } from '@directive-run/svelte';

// Create a single derivation store outside of components
const isRed = createDerivedStore(system, 'isRed');
```

### createDerivedsStore

```typescript
import { createDerivedsStore } from '@directive-run/svelte';

// Create a multi-derivation store outside of components
const state = createDerivedsStore(system, ['isRed', 'elapsed']);
```

### createFactStore

```typescript
import { createFactStore } from '@directive-run/svelte';

// Create a single fact store outside of components
const phase = createFactStore(system, 'phase');
```

### createInspectStore

```typescript
import { createInspectStore } from '@directive-run/svelte';

// Create an inspection store outside of components
const inspection = createInspectStore(system);
```

All factories return `Readable` stores that work with `$` auto-subscription:

```html
<script>
  import { createDerivedStore, createFactStore } from '@directive-run/svelte';
  import { system } from './system';

  // Create stores from the shared system instance
  const isRed = createDerivedStore(system, 'isRed');
  const phase = createFactStore(system, 'phase');
</script>

<div>
  <p>Phase: {$phase}</p>
  <p>{$isRed ? 'Red' : 'Not Red'}</p>
</div>
```

---

## Typed Hooks

Create fully typed hooks for your module schema. `createTypedHooks` returns typed versions of all core hooks – the returned hooks still take `system` as the first parameter but provide full autocomplete for keys and events:

```typescript
import { createTypedHooks } from '@directive-run/svelte';
import type { ModuleSchema } from '@directive-run/core';
import { t } from '@directive-run/core';

const schema = {
  facts: { count: t.number(), user: t.object<User | null>() },
  derivations: { doubled: t.number() },
  events: { increment: {}, setUser: { user: t.object<User>() } },
  requirements: {},
} satisfies ModuleSchema;

// Create typed hooks – full autocomplete for keys and events
export const { useFact, useDerived, useDispatch, useEvents } = createTypedHooks<typeof schema>();
```

```html
<script>
  import { useFact, useDerived, useEvents } from './hooks';
  import { system } from '$lib/directive';

  // Fully typed – fact key autocompletes, return type inferred
  const count = useFact(system, "count");      // Readable<number>
  const doubled = useDerived(system, "doubled"); // Readable<number>
  const events = useEvents(system);
</script>

<div>
  <p>{$count} x 2 = {$doubled}</p>
  <button on:click={() => events.increment()}>+1</button>
</div>
```

---

## Patterns

### Loading States

```html
<script>
  import { useFact } from '@directive-run/svelte';
  import { system } from '$lib/directive';

  // Subscribe to loading and error states
  const loading = useFact(system, "loading");
  const error = useFact(system, "error");
  const user = useFact(system, "user");
</script>

{#if $loading}
  <Spinner />
{:else if $error}
  <Error message={$error} />
{:else if !$user}
  <EmptyState />
{:else}
  <UserDetails user={$user} />
{/if}
```

### Writing Facts

Write facts through the system directly:

```html
<script>
  import { useFact } from '@directive-run/svelte';
  import { system } from '$lib/directive';

  // Subscribe to the current userId
  const userId = useFact(system, "userId");
</script>

<input
  type="number"
  value={$userId ?? 0}
  on:input={(e) => { system.facts.userId = parseInt(e.target.value); }}
/>
```

Or dispatch events:

```html
<script>
  import { useEvents } from '@directive-run/svelte';
  import { system } from '$lib/directive';

  const events = useEvents(system);
</script>

<button on:click={() => events.increment()}>+</button>
```

### Complete Module Example

```typescript
import { createModule, t } from '@directive-run/core';

const userModule = createModule("user", {
  schema: {
    facts: {
      userId: t.number(),
      user: t.object<User>().nullable(),
      loading: t.boolean(),
    },
    derivations: {
      displayName: t.string(),
      isLoaded: t.boolean(),
    },
    events: {
      setUserId: { userId: t.number() },
    },
    requirements: {
      FETCH_USER: { userId: t.number() },
    },
  },
  init: (facts) => {
    facts.userId = 0;
    facts.user = null;
    facts.loading = false;
  },
  derive: {
    displayName: (facts) => facts.user?.name ?? "Guest",
    isLoaded: (facts) => facts.user !== null,
  },
  constraints: {
    needsUser: {
      when: (facts) => facts.userId > 0 && !facts.user && !facts.loading,
      require: (facts) => ({ type: "FETCH_USER", userId: facts.userId }),
    },
  },
  resolvers: {
    fetchUser: {
      requirement: "FETCH_USER",
      resolve: async (req, context) => {
        context.facts.loading = true;
        context.facts.user = await api.getUser(req.userId);
        context.facts.loading = false;
      },
    },
  },
});
```

---

## SvelteKit Integration

```typescript
// src/lib/directive.ts
import { browser } from '$app/environment';
import { createSystem } from '@directive-run/core';
import { userModule } from './modules/user';

// Create the system – export for use in components
export const system = createSystem({ module: userModule });

// Only start the system in the browser
if (browser) {
  system.start();
}
```

```html
<!-- src/routes/+layout.svelte -->
<script>
  import { system } from '$lib/directive';
  import { useFact, useDerived } from '@directive-run/svelte';

  // Use hooks directly with the imported system
  const user = useFact(system, 'user');
  const displayName = useDerived(system, 'displayName');
</script>

<slot />
```

---

## Testing

```typescript
import { render, screen } from '@testing-library/svelte';
import { createTestSystem } from '@directive-run/core/testing';
import UserProfile from './UserProfile.svelte';
import { userModule } from './modules/user';

test('displays user name', async () => {
  // Create a test system with namespaced modules
  const system = createTestSystem({ modules: { user: userModule } });
  system.start();
  system.facts.user.user = { id: 1, name: 'Test User' };

  // Pass system as a prop – component uses it with hooks directly
  render(UserProfile, {
    props: { system },
  });

  expect(screen.getByText('Test User')).toBeInTheDocument();
});
```

---

## Utilities

### shallowEqual

Re-exported utility for use with `useSelector`:

```html
<script>
  import { useSelector, shallowEqual } from '@directive-run/svelte';
  import { system } from '$lib/directive';

  // Use shallowEqual to prevent updates when values haven't changed
  const ids = useSelector(system, (state) => state.users?.map(u => u.id) ?? [], shallowEqual);
</script>
```

---

## Time-Travel Debugging

`useHistory` returns a `Readable<HistoryState | null>` store – `null` when disabled, otherwise the full reactive API. Use `$history` to auto-subscribe in templates:

### Undo / Redo Controls

```html
<script>
  import { useHistory } from '@directive-run/svelte';
  import { system } from '$lib/directive';

  const history = useHistory(system);
</script>

{#if $history}
  {@const { canGoBack, canGoForward, goBack, goForward, currentIndex, totalSnapshots } = $history}
  <button on:click={() => goBack()} disabled={!canGoBack}>Undo</button>
  <button on:click={() => goForward()} disabled={!canGoForward}>Redo</button>
  <span>{currentIndex + 1} / {totalSnapshots}</span>
{/if}
```

### Snapshot Timeline

`snapshots` is lightweight metadata only (no facts data). Use `getSnapshotFacts(id)` to lazily load a snapshot's state on demand:

```html
{#if $history}
  {@const { snapshots, goTo, getSnapshotFacts } = $history}
  <ul>
    {#each snapshots as snap (snap.id)}
      <li>
        <button on:click={() => goTo(snap.id)}>
          {snap.trigger} – {new Date(snap.timestamp).toLocaleTimeString()}
        </button>
        <button on:click={() => console.log(getSnapshotFacts(snap.id))}>
          Inspect
        </button>
      </li>
    {/each}
  </ul>
{/if}
```

### Navigation

```html
{#if $history}
  {@const { goBack, goForward, goTo, replay } = $history}
  <button on:click={() => goBack(5)}>Back 5</button>
  <button on:click={() => goForward(5)}>Forward 5</button>
  <button on:click={() => goTo(0)}>Jump to Start</button>
  <button on:click={replay}>Replay All</button>
{/if}
```

### Session Persistence

```html
<script>
  import { useHistory } from '@directive-run/svelte';
  import { system } from '$lib/directive';

  const history = useHistory(system);

  function saveSession() {
    if ($history) {
      localStorage.setItem('debug', $history.exportSession());
    }
  }

  function restoreSession() {
    const saved = localStorage.getItem('debug');
    if (saved && $history) {
      $history.importSession(saved);
    }
  }
</script>

{#if $history}
  <button on:click={saveSession}>Save Session</button>
  <button on:click={restoreSession}>Restore Session</button>
{/if}
```

### Changesets

Group multiple fact mutations into a single undo/redo unit:

```html
<script>
  import { useHistory } from '@directive-run/svelte';
  import { system } from '$lib/directive';

  const history = useHistory(system);

  function handleComplexAction() {
    $history?.beginChangeset('Move piece A→B');
    // ... multiple fact mutations ...
    $history?.endChangeset();
    // Now undo/redo treats all mutations as one step
  }
</script>

<button on:click={handleComplexAction}>Move Piece</button>
```

### Recording Control

```html
{#if $history}
  {@const { isPaused, pause, resume } = $history}
  <button on:click={isPaused ? resume : pause}>
    {isPaused ? 'Resume' : 'Pause'} Recording
  </button>
{/if}
```

See [Time-Travel](/docs/advanced/history) for the full `HistoryState` interface and keyboard shortcuts.

---

## API Reference

| Export | Type | Description |
|---|---|---|
| `useFact` | Hook | Read single/multi facts – `useFact(system, key)` |
| `useDerived` | Hook | Read single/multi derivations – `useDerived(system, id)` |
| `useSelector` | Hook | Select from all facts with custom equality – `useSelector(system, selector, eq?)` |
| `useEvents` | Hook | Typed event dispatchers – `useEvents(system)` |
| `useDispatch` | Hook | Low-level event dispatch – `useDispatch(system)` |
| `useWatch` | Hook | Side-effect watcher (auto-detects kind) – `useWatch(system, key, cb)` |
| `useInspect` | Hook | System inspection with optional throttle – `useInspect(system, options?)` |
| `useConstraintStatus` | Hook | Reactive constraint inspection – `useConstraintStatus(system, constraintId?)` |
| `useExplain` | Hook | Reactive requirement explanation – `useExplain(system, reqId)` |
| `useRequirementStatus` | Hook | Requirement status – `useRequirementStatus(statusPlugin, type)` |
| `useOptimisticUpdate` | Hook | Optimistic mutations with rollback – `useOptimisticUpdate(system, statusPlugin?, type?)` |
| `useDirective` | Hook | Scoped system with selected or all subscriptions |
| `useHistory` | Hook | Reactive time-travel state – `useHistory(system)` |
| `createTypedHooks` | Factory | Create fully typed hooks for a schema |
| `createFactStore` | Factory | Fact store outside components |
| `createDerivedStore` | Factory | Derivation store outside components |
| `createDerivedsStore` | Factory | Multi-derivation store outside components |
| `createInspectStore` | Factory | Inspection store outside components |
| `shallowEqual` | Utility | Shallow equality for selectors |

---

## Next Steps

- **[Quick Start](/docs/quick-start)** – Build your first module
- **[Facts](/docs/facts)** – State management deep dive
- **[React Adapter](/docs/adapters/react)** – React integration for comparison
- **[Testing](/docs/testing/overview)** – Testing Svelte components
