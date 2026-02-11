---
title: Svelte Adapter
description: Integrate Directive with Svelte using reactive stores. setDirectiveContext, useFact, useDerived, useEvents, useDispatch, and more.
---

Directive provides first-class Svelte integration with stores that automatically update on state changes. {% .lead %}

---

## Installation

The Svelte adapter is included in the main package:

```typescript
import { setDirectiveContext, useFact, useDerived, useEvents, useDispatch } from 'directive/svelte';
```

---

## Setup

Call `setDirectiveContext` in a parent component to make the system available to children:

```svelte
<script lang="ts">
  import { createModule, createSystem, t } from 'directive';
  import { setDirectiveContext } from 'directive/svelte';
  import { userModule } from './modules/user';

  // Create and start the system
  const system = createSystem({ module: userModule });
  system.start();

  // Make the system available to all child components
  setDirectiveContext(system);
</script>

<slot />
```

For reusability, create a `DirectiveProvider.svelte` component:

```svelte
<!-- DirectiveProvider.svelte -->
<script lang="ts">
  import { setDirectiveContext } from 'directive/svelte';
  import type { System, ModuleSchema } from 'directive';

  export let system: System<ModuleSchema>;
  export let statusPlugin = undefined;

  // Provide the system and optional status plugin to children
  setDirectiveContext(system, statusPlugin);
</script>

<slot />
```

Then use it in your app:

```svelte
<script>
  import DirectiveProvider from './DirectiveProvider.svelte';
  import { createSystem } from 'directive';
  import { userModule } from './modules/user';

  // Create and start the system
  const system = createSystem({ module: userModule });
  system.start();
</script>

<DirectiveProvider {system}>
  <YourApp />
</DirectiveProvider>
```

---

## Core Hooks

All hooks below require context to be set via `setDirectiveContext` in a parent component. They return Svelte `Readable` stores – use the `$` prefix for auto-subscription in templates.

### useFact

Read a single fact, multiple facts, or a selected slice of a fact:

```svelte
<script>
  import { useFact } from 'directive/svelte';

  // Subscribe to a single fact – Readable<number | undefined>
  const userId = useFact<number>("userId");

  // Subscribe to multiple facts at once
  const profile = useFact<{ name: string; email: string; avatar: string }>(
    ["name", "email", "avatar"]
  );

  // Derive a value with a selector – only updates when the result changes
  const upperName = useFact("user", (user) => user?.name?.toUpperCase() ?? "GUEST");

  // Selector with custom equality to prevent unnecessary updates
  const ids = useFact("users", (users) => users?.map(u => u.id) ?? [], shallowEqual);
</script>

<div>
  <p>ID: {$userId}</p>
  <p>Name: {$profile.name}, Email: {$profile.email}</p>
  <p>Upper: {$upperName}</p>
</div>
```

### useDerived

Read a single derivation, multiple derivations, or a selected slice:

```svelte
<script>
  import { useDerived } from 'directive/svelte';

  // Subscribe to a single derivation
  const displayName = useDerived<string>("displayName");

  // Subscribe to multiple derivations at once
  const auth = useDerived<{ isLoggedIn: boolean; isAdmin: boolean }>(
    ["isLoggedIn", "isAdmin"]
  );

  // Derive a value with a selector – only updates when the count changes
  const itemCount = useDerived("stats", (stats) => stats.itemCount);
</script>

<h1>Hello, {$displayName}!</h1>
<span>{$auth.isLoggedIn ? ($auth.isAdmin ? "Admin" : "User") : "Guest"}</span>
<p>Items: {$itemCount}</p>
```

### useSelector

Select from all facts (like Zustand's `useStore`):

```svelte
<script>
  import { useSelector } from 'directive/svelte';

  // Select and combine values from multiple facts with custom equality
  const summary = useSelector(
    (facts) => ({
      userName: facts.user?.name,
      itemCount: facts.items?.length ?? 0,
    }),
    (a, b) => a.userName === b.userName && a.itemCount === b.itemCount
  );
</script>

<p>{$summary.userName} has {$summary.itemCount} items</p>
```

### useEvents

Get a typed reference to the system's event dispatchers:

```svelte
<script>
  import { useEvents } from 'directive/svelte';

  // Get typed event dispatchers for the module
  const events = useEvents();
</script>

<button on:click={() => events.increment()}>+</button>
<button on:click={() => events.setCount({ count: 0 })}>Reset</button>
```

The returned reference is stable (memoized on the system instance).

### useDispatch

Low-level event dispatch for untyped or system events:

```svelte
<script>
  import { useDispatch } from 'directive/svelte';

  // Get the low-level dispatch function
  const dispatch = useDispatch();
</script>

<button on:click={() => dispatch({ type: "increment" })}>+1</button>
```

### useSystem

Access the full system instance:

```svelte
<script>
  import { useSystem } from 'directive/svelte';

  // Access the full system instance for advanced operations
  const system = useSystem();
</script>

<div>
  <button on:click={() => console.log(system.getSnapshot())}>Snapshot</button>
  <button on:click={() => console.log(system.inspect())}>Inspect</button>
</div>
```

### useWatch

Watch a derivation or fact for changes. Automatically cleans up on component destroy:

```svelte
<script>
  import { useWatch } from 'directive/svelte';

  // Watch a derivation for analytics tracking
  useWatch("pageViews", (newValue, prevValue) => {
    analytics.track("pageViews", { from: prevValue, to: newValue });
  });

  // Watch a fact for tracking user changes
  useWatch("fact", "userId", (newValue, prevValue) => {
    analytics.track("userId_changed", { from: prevValue, to: newValue });
  });
</script>
```

### useModule

Zero-config hook that creates a scoped system and subscribes to all facts and derivations:

```svelte
<script>
  import { useModule } from 'directive/svelte';
  import { counterModule } from './counterModule';

  // Get everything in one call – system, facts, derivations, and events
  const { system, facts, derived, events, dispatch } = useModule(counterModule);
</script>

<div>
  <p>Count: {$facts.count}, Doubled: {$derived.doubled}</p>
  <button on:click={() => events.increment()}>+</button>
</div>
```

---

## Inspection

### useInspect

Get system inspection data (unmet requirements, inflight resolvers, constraint status). Returns `Readable<InspectState>` where `InspectState` includes: `isSettled`, `unmet`, `inflight`, `isWorking`, `hasUnmet`, `hasInflight`.

```svelte
<script>
  import { useInspect } from 'directive/svelte';

  // Get reactive system inspection data
  const inspection = useInspect();
</script>

<pre>
  Settled: {$inspection.isSettled}
  Unmet: {$inspection.unmet.length}
  Inflight: {$inspection.inflight.length}
</pre>
```

With throttling for high-frequency updates:

```svelte
<script>
  import { useInspect } from 'directive/svelte';

  // Throttle updates to limit render frequency
  const inspection = useInspect({ throttleMs: 200 });
</script>
```

### useConstraintStatus

Read constraint status reactively:

```svelte
<script>
  import { useConstraintStatus } from 'directive/svelte';

  // Get all constraints for the debug panel
  const constraints = useConstraintStatus();
  // Readable<Array<{ id: string; active: boolean; priority: number }>>

  // Check a specific constraint by ID
  const auth = useConstraintStatus("requireAuth");
  // Readable<{ id: "requireAuth", active: true, priority: 50 } | null>
</script>

{#each $constraints as c}
  <p>{c.id}: {c.active ? 'Active' : 'Inactive'} (priority {c.priority})</p>
{/each}
```

### useExplain

Get a reactive explanation of why a requirement exists:

```svelte
<script>
  import { useExplain } from 'directive/svelte';

  export let requirementId;

  // Get a detailed explanation of why a requirement was generated
  const explanation = useExplain(requirementId);
</script>

{#if $explanation}
  <pre>{$explanation}</pre>
{:else}
  <p>No active requirement</p>
{/if}
```

---

## Async Status

These hooks require passing a `statusPlugin` to `setDirectiveContext`:

```svelte
<script>
  import { createSystem, createRequirementStatusPlugin } from 'directive';
  import { setDirectiveContext } from 'directive/svelte';
  import { myModule } from './modules/myModule';

  // Create the status plugin for tracking requirement resolution
  const statusPlugin = createRequirementStatusPlugin();

  // Pass the plugin when creating the system
  const system = createSystem({
    module: myModule,
    plugins: [statusPlugin.plugin],
  });
  system.start();

  // Provide the system with the status plugin
  setDirectiveContext(system, statusPlugin);
</script>

<slot />
```

### useRequirementStatus

```svelte
<script>
  import { useRequirementStatus } from 'directive/svelte';

  // Track a single requirement type
  const status = useRequirementStatus("FETCH_USER");
  // Readable<{ isLoading, hasError, pending, inflight, failed, lastError }>

  // Track multiple requirement types at once
  const statuses = useRequirementStatus(["FETCH_USER", "FETCH_SETTINGS"]);
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

```svelte
<script>
  import { useOptimisticUpdate, useSystem } from 'directive/svelte';

  // Access the system's facts proxy for direct writes
  const { facts } = useSystem();

  // Set up optimistic mutations with automatic rollback
  const { mutate, isPending, error, rollback } = useOptimisticUpdate(undefined, "SAVE_DATA");

  function handleSave() {
    mutate(() => {
      // Optimistic update – applied immediately
      facts.savedAt = Date.now();
      facts.status = "saved";
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
import { createDerivedStore } from 'directive/svelte';

// Create a single derivation store outside of components
const isRed = createDerivedStore<boolean>(system, 'isRed');
```

### createDerivedsStore

```typescript
import { createDerivedsStore } from 'directive/svelte';

// Create a multi-derivation store outside of components
const state = createDerivedsStore<{ isRed: boolean; elapsed: number }>(
  system, ['isRed', 'elapsed']
);
```

### createFactStore

```typescript
import { createFactStore } from 'directive/svelte';

// Create a single fact store outside of components
const phase = createFactStore<string>(system, 'phase');
```

### createInspectStore

```typescript
import { createInspectStore } from 'directive/svelte';

// Create an inspection store outside of components
const inspection = createInspectStore(system);
```

All factories return `Readable` stores that work with `$` auto-subscription:

```svelte
<script>
  import { createDerivedStore, createFactStore } from 'directive/svelte';
  import { system } from './system';

  // Create stores from the shared system instance
  const isRed = createDerivedStore<boolean>(system, 'isRed');
  const phase = createFactStore<string>(system, 'phase');
</script>

<div>
  <p>Phase: {$phase}</p>
  <p>{$isRed ? 'Red' : 'Not Red'}</p>
</div>
```

---

## Scoped Systems

### useDirective

Create a system scoped to a component's lifecycle. The system starts automatically and is destroyed when the component unmounts:

```svelte
<script>
  import { useDirective, setDirectiveContext } from 'directive/svelte';
  import { counterModule } from './counterModule';

  // Create a scoped system tied to this component's lifecycle
  // Module must be a stable reference (defined outside component)
  const system = useDirective(counterModule);

  // Make the system available to child components
  setDirectiveContext(system);
</script>

<CounterDisplay />
```

With full system options:

```svelte
<script>
  import { useDirective, setDirectiveContext } from 'directive/svelte';
  import { loggingPlugin } from 'directive/plugins';
  import { counterModule } from './counterModule';

  // Options must be a stable reference
  const options = { module: counterModule, plugins: [loggingPlugin()] };
  const system = useDirective(options);

  // Make the system available to child components
  setDirectiveContext(system);
</script>
```

---

## Typed Hooks

Create fully typed hooks for your module schema. `createTypedHooks` returns all core hooks including `useEvents`:

```typescript
import { createTypedHooks } from 'directive/svelte';
import type { ModuleSchema } from 'directive';
import { t } from 'directive';

const schema = {
  facts: { count: t.number(), user: t.any<User | null>() },
  derivations: { doubled: t.number() },
  events: { increment: {}, setUser: { user: t.any<User>() } },
  requirements: {},
} satisfies ModuleSchema;

// Create typed hooks – full autocomplete for keys and events
export const { useFact, useDerived, useDispatch, useEvents, useSystem } = createTypedHooks<typeof schema>();
```

```svelte
<script>
  import { useFact, useDerived, useEvents } from './hooks';

  // Fully typed – fact key autocompletes, return type inferred
  const count = useFact("count");      // Readable<number>
  const doubled = useDerived("doubled"); // Readable<number>
  const events = useEvents();
</script>

<div>
  <p>{$count} x 2 = {$doubled}</p>
  <button on:click={() => events.increment()}>+1</button>
</div>
```

---

## Patterns

### Loading States

```svelte
<script>
  import { useFact } from 'directive/svelte';

  // Subscribe to loading and error states
  const loading = useFact<boolean>("loading");
  const error = useFact<string | null>("error");
  const user = useFact<User | null>("user");
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

```svelte
<script>
  import { useSystem, useFact } from 'directive/svelte';

  // Access the full system for direct fact writes
  const system = useSystem();

  // Subscribe to the current userId
  const userId = useFact<number>("userId");
</script>

<input
  type="number"
  value={$userId ?? 0}
  on:input={(e) => { system.facts.userId = parseInt(e.target.value); }}
/>
```

Or dispatch events:

```svelte
<script>
  import { useEvents } from 'directive/svelte';

  const events = useEvents();
</script>

<button on:click={() => events.increment()}>+</button>
```

### Complete Module Example

```typescript
import { createModule, t } from 'directive';

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
      require: { type: "FETCH_USER", userId: 0 },
      bind: (facts) => ({ userId: facts.userId }),
    },
  },
  resolvers: {
    fetchUser: {
      requirement: "FETCH_USER",
      resolve: async (req, ctx) => {
        ctx.facts.loading = true;
        ctx.facts.user = await api.getUser(req.userId);
        ctx.facts.loading = false;
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
import { createSystem } from 'directive';
import { userModule } from './modules/user';

export function createClientSystem() {
  const system = createSystem({ module: userModule });

  // Only start the system in the browser
  if (browser) {
    system.start();
  }
  return system;
}
```

```svelte
<!-- src/routes/+layout.svelte -->
<script>
  import { browser } from '$app/environment';
  import { setDirectiveContext } from 'directive/svelte';
  import { createClientSystem } from '$lib/directive';

  const system = createClientSystem();

  // Only set context in the browser (SSR will skip this)
  if (browser) {
    setDirectiveContext(system);
  }
</script>

<slot />
```

---

## Testing

```typescript
import { render, screen } from '@testing-library/svelte';
import { createTestSystem } from 'directive/testing';
import DirectiveProvider from './DirectiveProvider.svelte';
import UserProfile from './UserProfile.svelte';
import { userModule } from './modules/user';

test('displays user name', async () => {
  // Create a test system with mock data
  const system = createTestSystem({ module: userModule });
  system.facts.user = { id: 1, name: 'Test User' };

  render(DirectiveProvider, {
    props: { system },
    slots: { default: UserProfile },
  });

  expect(screen.getByText('Test User')).toBeInTheDocument();
});
```

---

## Utilities

### shallowEqual

Re-exported utility for use with selector overloads:

```svelte
<script>
  import { useFact, shallowEqual } from 'directive/svelte';

  // Use shallowEqual to prevent updates when values haven't changed
  const ids = useFact("users", (users) => users?.map(u => u.id) ?? [], shallowEqual);
</script>
```

---

## Time-Travel Debugging

Use `useTimeTravel` for reactive undo/redo controls. Returns a `Readable<TimeTravelState | null>` store that updates when snapshot state changes:

```svelte
<script>
  import { useTimeTravel } from 'directive/svelte';

  // Get reactive time-travel controls (null when disabled)
  const tt = useTimeTravel();
</script>

{#if $tt}
  <button on:click={$tt.undo} disabled={!$tt.canUndo}>Undo</button>
  <button on:click={$tt.redo} disabled={!$tt.canRedo}>Redo</button>
  <span>{$tt.currentIndex + 1} / {$tt.totalSnapshots}</span>
{/if}
```

Returns `null` when time-travel is disabled. See [Time-Travel](/docs/advanced/time-travel) for changesets and keyboard shortcuts.

---

## API Reference

| Export | Type | Description |
|---|---|---|
| `useFact` | Hook | Read single/multi facts or apply selector |
| `useDerived` | Hook | Read single/multi derivations or apply selector |
| `useSelector` | Hook | Select from all facts with custom equality |
| `useEvents` | Hook | Typed event dispatchers |
| `useDispatch` | Hook | Low-level event dispatch |
| `useSystem` | Hook | Access full system instance |
| `useWatch` | Hook | Side-effect watcher for facts or derivations |
| `useModule` | Hook | Zero-config scoped system |
| `useInspect` | Hook | System inspection (unmet, inflight, settled) with optional throttle |
| `useConstraintStatus` | Hook | Reactive constraint inspection |
| `useExplain` | Hook | Reactive requirement explanation |
| `useRequirementStatus` | Hook | Single/multi requirement status |
| `useOptimisticUpdate` | Hook | Optimistic mutations with rollback |
| `useDirective` | Hook | Scoped system tied to component lifecycle |
| `createTypedHooks` | Factory | Create fully typed hooks for a schema |
| `createFactStore` | Factory | Fact store outside components |
| `createDerivedStore` | Factory | Derivation store outside components |
| `createDerivedsStore` | Factory | Multi-derivation store outside components |
| `createInspectStore` | Factory | Inspection store outside components |
| `useTimeTravel` | Hook | Reactive time-travel state (canUndo, canRedo, undo, redo) |
| `shallowEqual` | Utility | Shallow equality for selectors |

---

## Next Steps

- **[Quick Start](/docs/quick-start)** – Build your first module
- **[Facts](/docs/facts)** – State management deep dive
- **[React Adapter](/docs/adapters/react)** – React integration for comparison
- **[Testing](/docs/testing/overview)** – Testing Svelte components
