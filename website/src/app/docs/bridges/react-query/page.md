---
title: React Query Bridge
description: Use Directive constraints to drive React Query prefetching and cache invalidation.
---

Directive decides WHEN to fetch. React Query handles HOW. The bridge connects constraint-driven logic to React Query's cache, so prefetches and invalidations happen automatically when your application state demands them. {% .lead %}

---

## Installation

```bash
npm install directive @tanstack/react-query
```

Import from `directive/react-query`:

```typescript
import { createQueryBridge } from 'directive/react-query';
```

---

## Basic Bridge Setup

Pass your React Query `QueryClient` to `createQueryBridge` along with application-specific facts, constraints, and resolvers:

```typescript
import { QueryClient } from '@tanstack/react-query';
import { createQueryBridge, prefetch } from 'directive/react-query';
import { t } from 'directive';

const queryClient = new QueryClient();

const bridge = createQueryBridge(queryClient, {
  factsSchema: {
    userId: t.string(),
    profileOpen: t.boolean(),
  },
  init: (facts) => {
    facts.userId = '';
    facts.profileOpen = false;
  },
  constraints: {
    prefetchUser: {
      when: (facts) => facts.profileOpen && facts.userId !== '',
      require: (facts) => prefetch(['user', facts.userId]),
    },
  },
});
```

The bridge auto-starts by default. It creates an underlying Directive system, begins syncing React Query cache state into `facts.queryStates`, and evaluates your constraints on every change.

---

## Bridge Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `factsSchema` | `Record<string, ...>` | `{}` | Additional facts beyond `queryStates` |
| `init` | `(facts) => void` | — | Initialize fact values |
| `constraints` | `Record<string, QueryConstraint>` | `{}` | Constraints that produce requirements |
| `resolvers` | `Record<string, QueryResolver>` | `{}` | Custom resolvers (built-ins handle PREFETCH/INVALIDATE) |
| `plugins` | `Plugin[]` | `[]` | Directive plugins |
| `debug` | `boolean` | `false` | Enable time-travel debugging |
| `autoStart` | `boolean` | `true` | Start the system immediately |
| `syncIntervalMs` | `number` | `100` | Polling interval for cache state sync (ms) |

---

## Bridge Instance

`createQueryBridge` returns a `QueryBridge` with these members:

```typescript
const bridge = createQueryBridge(queryClient, { ... });

bridge.system;      // The underlying Directive system
bridge.facts;       // Typed as F & { queryStates: Record<string, QueryStateInfo> }

bridge.startSync(); // Begin syncing cache events to facts
bridge.stopSync();  // Pause cache syncing
bridge.settle();    // Wait for all constraints/resolvers to finish
bridge.destroy();   // Stop sync and destroy the system
```

---

## Constraint-Driven Prefetching

Constraints evaluate against your facts plus `queryStates`. When a constraint's `when` returns `true`, its requirement is emitted and resolved:

```typescript
import { createQueryBridge, prefetch, isQueryFresh } from 'directive/react-query';
import { t } from 'directive';

const bridge = createQueryBridge(queryClient, {
  factsSchema: {
    currentRoute: t.string(),
    userId: t.string(),
  },
  init: (facts) => {
    facts.currentRoute = '/';
    facts.userId = '';
  },
  constraints: {
    prefetchDashboard: {
      when: (facts) => {
        if (facts.currentRoute !== '/dashboard') return false;
        const state = facts.queryStates[JSON.stringify(['dashboard', facts.userId])];
        return !isQueryFresh(state, 60_000);
      },
      require: (facts) => prefetch(
        ['dashboard', facts.userId],
        { staleTime: 60_000 }
      ),
      priority: 10,
    },
  },
});

// Navigate to dashboard -> constraint fires -> React Query prefetches
bridge.facts.currentRoute = '/dashboard';
bridge.facts.userId = 'user-42';
```

---

## Built-in Requirements

The bridge includes built-in resolvers for two requirement types. You do not need to write resolvers for these.

### PREFETCH

Calls `queryClient.prefetchQuery()`:

```typescript
import { prefetch } from 'directive/react-query';

// Minimal
prefetch(['user', userId]);

// With options
prefetch(['user', userId], {
  queryFn: () => fetchUser(userId),
  staleTime: 5 * 60 * 1000,
});
```

The `PrefetchRequirement` shape:

```typescript
{
  type: 'PREFETCH',
  queryKey: QueryKey,
  queryFn?: () => Promise<unknown>,
  staleTime?: number,
}
```

### INVALIDATE

Calls `queryClient.invalidateQueries()`:

```typescript
import { invalidate } from 'directive/react-query';

// Invalidate specific query
invalidate(['user', userId]);

// Exact match only
invalidate(['user', userId], { exact: true });

// Invalidate all queries (no key)
invalidate();
```

The `InvalidateRequirement` shape:

```typescript
{
  type: 'INVALIDATE',
  queryKey?: QueryKey,
  exact?: boolean,
}
```

---

## Constraint Helpers

Two shorthand functions reduce boilerplate for common patterns.

### whenThenPrefetch

```typescript
import { whenThenPrefetch } from 'directive/react-query';

const bridge = createQueryBridge(queryClient, {
  factsSchema: { userId: t.string(), profileOpen: t.boolean() },
  init: (facts) => { facts.userId = ''; facts.profileOpen = false; },
  constraints: {
    userProfile: whenThenPrefetch(
      (facts) => facts.profileOpen && facts.userId !== '',
      (facts) => ['user', facts.userId],
      { staleTime: 30_000, priority: 5 },
    ),
  },
});
```

Signature:

```typescript
whenThenPrefetch<F>(
  when: (facts: F & { queryStates }) => boolean,
  queryKey: (facts: F & { queryStates }) => QueryKey,
  options?: { queryFn?; staleTime?; priority? },
): QueryConstraint<F>
```

### whenThenInvalidate

```typescript
import { whenThenInvalidate } from 'directive/react-query';

const bridge = createQueryBridge(queryClient, {
  factsSchema: { justLoggedOut: t.boolean() },
  init: (facts) => { facts.justLoggedOut = false; },
  constraints: {
    clearOnLogout: whenThenInvalidate(
      (facts) => facts.justLoggedOut,
      () => ['user'],
      { exact: false, priority: 100 },
    ),
  },
});
```

Signature:

```typescript
whenThenInvalidate<F>(
  when: (facts: F & { queryStates }) => boolean,
  queryKey?: (facts: F & { queryStates }) => QueryKey,
  options?: { exact?; priority? },
): QueryConstraint<F>
```

---

## Query State Helpers

The bridge syncs React Query cache state into `facts.queryStates` as `QueryStateInfo` objects:

```typescript
interface QueryStateInfo {
  status: 'pending' | 'error' | 'success';
  fetchStatus: 'fetching' | 'paused' | 'idle';
  hasData: boolean;
  dataUpdatedAt: number | undefined;
  error: string | null;
}
```

Keys in `queryStates` are the JSON-stringified query key (e.g., `JSON.stringify(['user', '42'])`).

Three helper functions inspect query state:

```typescript
import { isQueryLoading, isQueryFresh, isQueryError } from 'directive/react-query';

const state = bridge.facts.queryStates[JSON.stringify(['user', userId])];

isQueryLoading(state);          // true if pending or fetching
isQueryFresh(state, 60_000);    // true if data exists and is less than 60s old
isQueryError(state);            // true if status is 'error'
```

Use these inside constraints to avoid redundant fetches:

```typescript
constraints: {
  smartPrefetch: {
    when: (facts) => {
      const state = facts.queryStates[JSON.stringify(['posts'])];
      return facts.currentRoute === '/blog' && !isQueryLoading(state) && !isQueryFresh(state, 30_000);
    },
    require: prefetch(['posts']),
  },
},
```

---

## React Hooks

`createQueryBridgeHooks` provides typed React hooks for reading bridge state in components. Requires React to be installed.

```typescript
import { createQueryBridge, createQueryBridgeHooks } from 'directive/react-query';

const bridge = createQueryBridge(queryClient, { ... });
const { useFacts, useQueryState } = createQueryBridgeHooks(bridge);

function UserProfile({ userId }: { userId: string }) {
  const { profileOpen } = useFacts();
  const userState = useQueryState(['user', userId]);

  if (!profileOpen) return null;
  if (userState?.status === 'pending') return <div>Loading...</div>;
  if (userState?.status === 'error') return <div>Error: {userState.error}</div>;

  return <div>User loaded</div>;
}
```

- `useFacts()` returns all application facts (typed as `F & { queryStates }`). Re-renders on any fact change.
- `useQueryState(queryKey)` returns the `QueryStateInfo` for a specific query key. Re-renders only when query states change.

Both hooks use `useSyncExternalStore` internally for tear-free reads.

---

## Custom Resolvers

For requirements beyond PREFETCH and INVALIDATE, add custom resolvers:

```typescript
const bridge = createQueryBridge(queryClient, {
  constraints: {
    refreshAll: {
      when: (facts) => facts.forceRefresh,
      require: { type: 'REFRESH_ALL' },
    },
  },
  resolvers: {
    refreshAll: {
      requirement: (req): req is Requirement => req.type === 'REFRESH_ALL',
      resolve: async (req, ctx) => {
        await ctx.queryClient.invalidateQueries();
        ctx.facts.forceRefresh = false;
      },
    },
  },
});
```

The resolver context (`QueryResolverContext`) provides:

- `facts` — Current application facts
- `queryClient` — The React Query client
- `signal` — An `AbortSignal` for cancellation

---

## Next Steps

- See [Constraints](/docs/constraints) for requirement patterns
- See [Resolvers](/docs/resolvers) for retry and batching
- See [Zustand Bridge](/docs/bridges/zustand) for state store sync
