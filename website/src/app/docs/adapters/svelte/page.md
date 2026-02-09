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

  const system = createSystem({ module: userModule });
  system.start();

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

  const system = createSystem({ module: userModule });
  system.start();
</script>

<DirectiveProvider {system}>
  <YourApp />
</DirectiveProvider>
```

---

## Core Hooks

All hooks below require context to be set via `setDirectiveContext` in a parent component. They return Svelte `Readable` stores — use the `$` prefix for auto-subscription in templates.

### useFact

Read a single fact, multiple facts, or a selected slice of a fact:

```svelte
<script>
  import { useFact } from 'directive/svelte';

  // Single fact — Readable<number | undefined>
  const userId = useFact<number>("userId");

  // Multiple facts — Readable<{ name, email, avatar }>
  const profile = useFact<{ name: string; email: string; avatar: string }>(
    ["name", "email", "avatar"]
  );

  // Selector — Readable<string>, only updates when selected value changes
  const upperName = useFact("user", (user) => user?.name?.toUpperCase() ?? "GUEST");

  // Selector with custom equality
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

  // Single derivation — Readable<string>
  const displayName = useDerived<string>("displayName");

  // Multiple derivations — Readable<{ isLoggedIn, isAdmin }>
  const auth = useDerived<{ isLoggedIn: boolean; isAdmin: boolean }>(
    ["isLoggedIn", "isAdmin"]
  );

  // Selector — only updates when selected value changes
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

  const dispatch = useDispatch();
</script>

<button on:click={() => dispatch({ type: "increment" })}>+1</button>
```

### useFacts

Get direct facts access for mutations. This is NOT reactive — use it in event handlers, not templates:

```svelte
<script>
  import { useFacts } from 'directive/svelte';

  const facts = useFacts();

  function increment() {
    facts.count = (facts.count ?? 0) + 1;
  }
</script>

<button on:click={increment}>+1</button>
```

### useSystem

Access the full system instance:

```svelte
<script>
  import { useSystem } from 'directive/svelte';

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

  // Watch a derivation
  useWatch("pageViews", (newValue, prevValue) => {
    analytics.track("pageViews", { from: prevValue, to: newValue });
  });

  // Watch a fact
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

  const inspection = useInspect({ throttleMs: 200 });
</script>
```

### useConstraintStatus

Read constraint status reactively:

```svelte
<script>
  import { useConstraintStatus } from 'directive/svelte';

  // All constraints
  const constraints = useConstraintStatus();
  // Readable<Array<{ id: string; active: boolean; priority: number }>>

  // Single constraint
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

  const statusPlugin = createRequirementStatusPlugin();
  const system = createSystem({
    module: myModule,
    plugins: [statusPlugin.plugin],
  });
  system.start();

  setDirectiveContext(system, statusPlugin);
</script>

<slot />
```

### useRequirementStatus

```svelte
<script>
  import { useRequirementStatus } from 'directive/svelte';

  // Single requirement type
  const status = useRequirementStatus("FETCH_USER");
  // Readable<{ isLoading, hasError, pending, inflight, failed, lastError }>

  // Multiple requirement types
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
  import { useOptimisticUpdate } from 'directive/svelte';

  const { mutate, isPending, error, rollback } = useOptimisticUpdate("SAVE_DATA");

  function handleSave() {
    mutate(() => {
      // Optimistic update — applied immediately
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

const isRed = createDerivedStore<boolean>(system, 'isRed');
```

### createDerivedsStore

```typescript
import { createDerivedsStore } from 'directive/svelte';

const state = createDerivedsStore<{ isRed: boolean; elapsed: number }>(
  system, ['isRed', 'elapsed']
);
```

### createFactStore

```typescript
import { createFactStore } from 'directive/svelte';

const phase = createFactStore<string>(system, 'phase');
```

### createInspectStore

```typescript
import { createInspectStore } from 'directive/svelte';

const inspection = createInspectStore(system);
```

All factories return `Readable` stores that work with `$` auto-subscription:

```svelte
<script>
  import { createDerivedStore, createFactStore } from 'directive/svelte';
  import { system } from './system';

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

### createDirective / useDirective

Create a system scoped to a component's lifecycle. The system starts automatically and is destroyed when the component unmounts:

```svelte
<script>
  import { createDirective, setDirectiveContext } from 'directive/svelte';
  import { counterModule } from './counterModule';

  // Module must be a stable reference (defined outside component)
  const system = createDirective(counterModule);
  setDirectiveContext(system);
</script>

<CounterDisplay />
```

With full system options:

```svelte
<script>
  import { createDirective, setDirectiveContext } from 'directive/svelte';
  import { loggingPlugin } from 'directive/plugins';
  import { counterModule } from './counterModule';

  // Options must be a stable reference
  const options = { module: counterModule, plugins: [loggingPlugin()] };
  const system = createDirective(options);
  setDirectiveContext(system);
</script>
```

`useDirective` is an alias for `createDirective`.

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

export const { useFact, useDerived, useDispatch, useEvents, useSystem } = createTypedHooks<typeof schema>();
```

```svelte
<script>
  import { useFact, useDerived, useEvents } from './hooks';

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

  const system = useSystem();
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

  const ids = useFact("users", (users) => users?.map(u => u.id) ?? [], shallowEqual);
</script>
```

---

## Time-Travel Debugging

Use `useTimeTravel` for reactive undo/redo controls. Returns a `Readable<TimeTravelState | null>` store that updates when snapshot state changes:

```svelte
<script>
  import { useTimeTravel } from 'directive/svelte';

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
| `useFacts` | Hook | Direct facts access for mutations (non-reactive) |
| `useSystem` | Hook | Access full system instance |
| `useWatch` | Hook | Side-effect watcher for facts or derivations |
| `useModule` | Hook | Zero-config scoped system |
| `useInspect` | Hook | System inspection (unmet, inflight, settled) with optional throttle |
| `useConstraintStatus` | Hook | Reactive constraint inspection |
| `useExplain` | Hook | Reactive requirement explanation |
| `useRequirementStatus` | Hook | Single/multi requirement status |
| `useOptimisticUpdate` | Hook | Optimistic mutations with rollback |
| `createDirective` | Hook | Scoped system tied to component lifecycle |
| `useDirective` | Hook | Alias for `createDirective` |
| `createTypedHooks` | Factory | Create fully typed hooks for a schema |
| `createFactStore` | Factory | Fact store outside components |
| `createDerivedStore` | Factory | Derivation store outside components |
| `createDerivedsStore` | Factory | Multi-derivation store outside components |
| `createInspectStore` | Factory | Inspection store outside components |
| `useTimeTravel` | Hook | Reactive time-travel state (canUndo, canRedo, undo, redo) |
| `shallowEqual` | Utility | Shallow equality for selectors |

---

## Deprecated Hooks

{% callout type="warning" title="Deprecated" %}
The following hooks still work but delegate to the consolidated API above. They will be removed in a future major version.
{% /callout %}

| Deprecated | Use Instead |
|---|---|
| `useFactSelector(key, fn, eq?)` | `useFact(key, fn, eq?)` |
| `useDeriveds(keys)` | `useDerived(keys)` |
| `useDerivedSelector(key, fn, eq?)` | `useDerived(key, fn, eq?)` |
| `useIsSettled()` | `useInspect().isSettled` |
| `useIsResolving(type)` | `useRequirementStatus(type).isLoading` |
| `useLatestError(type)` | `useRequirementStatus(type).lastError` |
| `useInspectThrottled(opts)` | `useInspect(opts)` |
| `useRequirements()` | `useInspect()` |
| `useRequirementsThrottled(opts)` | `useInspect(opts)` |
| `useRequirementStatuses()` | `useRequirementStatus(types)` |

---

## Next Steps

- **[Quick Start](/docs/quick-start)** -- Build your first module
- **[Facts](/docs/facts)** -- State management deep dive
- **[React Adapter](/docs/adapters/react)** -- React integration for comparison
- **[Testing](/docs/testing/overview)** -- Testing Svelte components
