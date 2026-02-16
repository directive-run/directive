---
title: Directive + React Query
description: Use React Query for data fetching and caching. Use Directive to decide when to fetch based on constraints.
---

React Query handles data fetching, caching, and cache invalidation. Directive decides WHEN to fetch – constraints evaluate your application state and trigger prefetches or invalidations automatically. Together they eliminate manual useEffect data orchestration. {% .lead %}

{% callout type="note" title="Prerequisites" %}
This guide assumes familiarity with [Core Concepts](/docs/core-concepts) and [Module & System](/docs/module-system). Need to install first? See [Installation](/docs/installation).
{% /callout %}

---

## Why Use Both

**React Query** owns server state: fetching, caching, background refetching, stale-while-revalidate, optimistic updates. It answers "how do I get this data efficiently?"

**Directive** adds constraint-driven orchestration: constraints that evaluate your application state and trigger the right data operations at the right time. It answers "when should I fetch, prefetch, or invalidate?"

Together:
- React Query owns server cache: fetch, cache, deduplicate, retry, background refresh
- Directive owns orchestration: constraints decide when data is needed, resolvers trigger prefetches and invalidations, effects react to cache changes
- No more scattered `useEffect` chains checking conditions and triggering fetches

---

## Query Cache → Directive

Subscribe to React Query's query cache events and write query status into Directive facts.

The `getQueryCache().subscribe(listener)` callback receives typed event objects with `type`, `query`, and additional context.

{% callout type="warning" title="Use stable, schema-declared fact keys" %}
Avoid dynamic fact keys like `` `query_${hash}_status` `` – they create untyped facts outside your schema that can't participate in constraints or derivations. Instead, map specific query keys to declared fact keys.
{% /callout %}

Map known query keys to specific, schema-declared facts:

```typescript
const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
  if (event.type !== 'updated') {
    return;
  }

  // Only sync user-related queries
  const queryKey = event.query.queryKey;
  if (!Array.isArray(queryKey) || queryKey[0] !== 'user') {
    return;
  }

  system.batch(() => {
    system.facts.userData = event.query.state.data;
    system.facts.userQueryStatus = event.query.state.status; // 'pending' | 'error' | 'success'
    system.facts.userQueryError = event.query.state.error;
  });
});
```

{% callout type="note" title="Query cache event types" %}
Events include `'added'`, `'removed'`, `'updated'`, `'observerAdded'`, `'observerRemoved'`, and `'observerResultsUpdated'`. Filter to `'updated'` for state changes.
{% /callout %}

---

## Mutation Cache → Directive

Subscribe to the mutation cache to react to mutation lifecycle events:

```typescript
const unsubscribe = queryClient.getMutationCache().subscribe((event) => {
  if (event.type !== 'updated') {
    return;
  }

  if (!event.mutation) {
    return;
  }

  const { state } = event.mutation;

  system.batch(() => {
    system.facts.lastMutationStatus = state.status;
    system.facts.lastMutationError = state.error;
  });
});
```

This lets Directive constraints react to mutation completion – for example, triggering cache invalidation after a successful mutation.

---

## Constraint-Driven Prefetching

Directive constraints fire when conditions are met. Resolvers call `queryClient.prefetchQuery` to warm the cache before the user navigates:

```typescript
import { createModule, t } from '@directive-run/core';

const dashboardModule = createModule('dashboard', {
  schema: {
    facts: {
      currentRoute: t.string(),
      userId: t.string(),
      profilePrefetched: t.boolean(),
    },
    derivations: {
      shouldPrefetchProfile: t.boolean(),
    },
    events: {},
    requirements: {
      PREFETCH_PROFILE: { userId: t.string() },
    },
  },

  init: (facts) => {
    facts.currentRoute = '';
    facts.userId = '';
    facts.profilePrefetched = false;
  },

  derive: {
    shouldPrefetchProfile: (facts) =>
      facts.currentRoute === '/dashboard' &&
      Boolean(facts.userId) &&
      !facts.profilePrefetched,
  },

  constraints: {
    prefetchProfile: {
      when: (facts) => facts.shouldPrefetchProfile,
      require: (facts) => ({ type: 'PREFETCH_PROFILE', userId: facts.userId }),
    },
  },

  resolvers: {
    prefetch: {
      requirement: 'PREFETCH_PROFILE',
      key: (req) => `profile-${req.userId}`,
      resolve: async (req, context) => {
        await queryClient.prefetchQuery({
          queryKey: ['user', req.userId],
          queryFn: () => api.getUser(req.userId),
        });
        context.facts.profilePrefetched = true;
      },
    },
  },
});
```

The user lands on `/dashboard` → constraint fires → resolver prefetches → when they navigate to the profile page, data is already cached.

---

## Constraint-Driven Invalidation

### Simple: Watch-based

For straightforward invalidation, use `system.watch`:

```typescript
system.watch('userPermissions', (permissions, prev) => {
  if (permissions !== prev) {
    queryClient.invalidateQueries({ queryKey: ['protected-data'] });
  }
});
```

### Advanced: Constraint + Resolver

For complex invalidation logic with versioning:

```typescript
constraints: {
  refreshOnPermissionChange: {
    when: (facts) => facts.permissionsVersion > facts.lastRefreshVersion,
    require: () => ({ type: 'INVALIDATE_PROTECTED_DATA' }),
  },
},

resolvers: {
  invalidate: {
    requirement: 'INVALIDATE_PROTECTED_DATA',
    resolve: async (req, context) => {
      await queryClient.invalidateQueries({ queryKey: ['protected-data'] });
      context.facts.lastRefreshVersion = context.facts.permissionsVersion;
    },
  },
},
```

The versioning pattern prevents re-invalidation until permissions change again.

---

## Constraint-Driven Mutations

Use Directive to orchestrate optimistic updates with automatic rollback:

```typescript
import { createModule, t } from '@directive-run/core';

const todoModule = createModule('todos', {
  schema: {
    facts: {
      pendingUpdate: t.object(),
      updateError: t.object(),
    },
    derivations: {},
    events: {},
    requirements: {
      UPDATE_TODO: { id: t.string(), title: t.string() },
    },
  },

  init: (facts) => {
    facts.pendingUpdate = null;
    facts.updateError = null;
  },

  constraints: {
    submitUpdate: {
      when: (facts) => facts.pendingUpdate !== null,
      require: (facts) => ({
        type: 'UPDATE_TODO',
        id: facts.pendingUpdate.id,
        title: facts.pendingUpdate.title,
      }),
    },
  },

  resolvers: {
    updateTodo: {
      requirement: 'UPDATE_TODO',
      key: (req) => `todo-${req.id}`,
      resolve: async (req, context) => {
        // Cancel in-flight queries for this todo
        await queryClient.cancelQueries({ queryKey: ['todo', req.id] });

        // Snapshot previous data for rollback
        const previousTodo = queryClient.getQueryData(['todo', req.id]);

        // Optimistic update
        queryClient.setQueryData(['todo', req.id], (old: any) => ({
          ...old,
          title: req.title,
        }));

        try {
          await api.updateTodo(req.id, { title: req.title });
          context.facts.pendingUpdate = null;
          context.facts.updateError = null;
          // Refetch to ensure server state is canonical
          await queryClient.invalidateQueries({ queryKey: ['todo', req.id] });
        } catch (err) {
          // Rollback optimistic update
          queryClient.setQueryData(['todo', req.id], previousTodo);
          context.facts.updateError = String(err);
          context.facts.pendingUpdate = null;
          throw err;
        }
      },
    },
  },
});
```

The resolver handles the full optimistic update lifecycle: cancel in-flight → optimistic set → API call → invalidate on success, rollback on failure.

---

## Plugin: Auto-Sync Query Cache

Use a plugin to sync query cache changes into Directive facts. Map known query key prefixes to declared fact keys:

```typescript
import type { Plugin } from '@directive-run/core';

type QueryKeyMapping = {
  prefix: unknown[]; // Query key prefix to match (e.g., ['user'])
  facts: {           // Map to stable, schema-declared fact keys
    data?: string;
    status?: string;
    error?: string;
  };
};

function queryCacheSyncPlugin(
  queryClient: QueryClient,
  mappings: QueryKeyMapping[]
): Plugin {
  let unsubscribe: (() => void) | null = null;

  return {
    name: 'query-cache-sync',

    onInit: (system) => {
      unsubscribe = queryClient.getQueryCache().subscribe((event) => {
        if (event.type !== 'updated') {
          return;
        }

        const { query } = event;
        const queryKey = query.queryKey;

        // Find matching mapping
        const mapping = mappings.find((m) =>
          m.prefix.every((part, i) => queryKey[i] === part)
        );
        if (!mapping) {
          return;
        }

        system.batch(() => {
          if (mapping.facts.data) {
            (system.facts as any)[mapping.facts.data] = query.state.data;
          }
          if (mapping.facts.status) {
            (system.facts as any)[mapping.facts.status] = query.state.status;
          }
          if (mapping.facts.error) {
            (system.facts as any)[mapping.facts.error] = query.state.error;
          }
        });
      });
    },

    onDestroy: () => {
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}

// Usage – map query key prefixes to schema-declared fact keys
const system = createSystem({
  module: dashboardModule,
  plugins: [
    queryCacheSyncPlugin(queryClient, [
      {
        prefix: ['user'],
        facts: { data: 'userData', status: 'userQueryStatus', error: 'userQueryError' },
      },
      {
        prefix: ['todos'],
        facts: { data: 'todosData', status: 'todosQueryStatus' },
      },
    ]),
  ],
});
```

---

## React Integration

Use both `useQuery` and `useDirective` in the same component:

```tsx
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDirectiveRef } from '@directive-run/react';

function UserDashboard({ userId }: { userId: string }) {
  // useDirectiveRef returns the system directly (useDirective returns reactive selections)
  const system = useDirectiveRef(dashboardModule);
  const queryClient = useQueryClient();
  const { data: user, status } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => api.getUser(userId),
  });

  // Sync route, user info, and query status into Directive
  useEffect(() => {
    system.batch(() => {
      system.facts.currentRoute = '/dashboard';
      system.facts.userId = userId;
      system.facts.userData = user ?? null;
      system.facts.userQueryStatus = status;
    });
  }, [system, userId, user, status]);

  if (status === 'pending') {
    return <p>Loading...</p>;
  }

  if (status === 'error') {
    return <p>Error loading user</p>;
  }

  return (
    <div>
      <h1>{user.name}</h1>
      <p>Prefetched: {system.facts.profilePrefetched ? 'Yes' : 'No'}</p>
    </div>
  );
}
```

{% callout type="note" title="SSR / Next.js" %}
For server-side rendering, see [Advanced: SSR & Hydration](/docs/advanced/ssr) for how to serialize and restore both stores during hydration.
{% /callout %}

---

## Error Handling

React to query errors through Directive constraints:

```typescript
// Sync query errors as facts – store the queryKey array, not the hash string
queryClient.getQueryCache().subscribe((event) => {
  if (event.type !== 'updated') {
    return;
  }

  if (event.query.state.status === 'error') {
    system.batch(() => {
      system.facts.queryError = {
        queryKey: event.query.queryKey, // Store the original key array
        error: String(event.query.state.error),
      };
    });
  }
});

// Clean up when done: unsubscribe()

// Constraint triggers recovery
constraints: {
  recoverFromQueryError: {
    when: (facts) => facts.queryError !== null,
    require: (facts) => ({
      type: 'RECOVER_QUERY',
      queryKey: facts.queryError.queryKey,
    }),
  },
},

resolvers: {
  recoverQuery: {
    requirement: 'RECOVER_QUERY',
    retry: { attempts: 2, backoff: 'exponential' },
    resolve: async (req, context) => {
      // Pass the original queryKey array directly – not wrapped in another array
      await queryClient.invalidateQueries({ queryKey: req.queryKey });
      context.facts.queryError = null;
    },
  },
},
```

---

## Testing

Test constraint-driven prefetching with Directive's test utilities:

```typescript
import { createTestSystem } from '@directive-run/core/testing';

test('prefetch constraint fires on dashboard route', async () => {
  const testSystem = createTestSystem({ module: dashboardModule });
  testSystem.start();

  testSystem.batch(() => {
    testSystem.facts.currentRoute = '/dashboard';
    testSystem.facts.userId = 'user-123';
    testSystem.facts.profilePrefetched = false;
  });

  await testSystem.waitForIdle();
  expect(testSystem.allRequirements).toContainEqual(
    expect.objectContaining({
      requirement: expect.objectContaining({
        type: 'PREFETCH_PROFILE',
        userId: 'user-123',
      }),
    })
  );
});

test('prefetch does not re-fire after completion', async () => {
  const testSystem = createTestSystem({ module: dashboardModule });
  testSystem.start();

  testSystem.batch(() => {
    testSystem.facts.currentRoute = '/dashboard';
    testSystem.facts.userId = 'user-123';
    testSystem.facts.profilePrefetched = true;
  });

  await testSystem.waitForIdle();
  expect(testSystem.allRequirements).toEqual([]);
});
```

---

## Avoiding Infinite Loops

React Query integrations are typically unidirectional – cache events flow into Directive facts, and Directive constraints trigger query operations (prefetch, invalidate). This means infinite loops are less likely than with bidirectional state sync.

However, loops can occur if a constraint-triggered invalidation causes a query to refetch, which fires a cache update event, which updates a fact, which re-triggers the constraint. Prevent this with a guard fact:

```typescript
constraints: {
  refreshData: {
    // Only fire when version changes AND we haven't already refreshed this version
    when: (facts) => facts.dataVersion > facts.lastRefreshedVersion,
    require: () => ({ type: 'REFRESH_DATA' }),
  },
},

resolvers: {
  refresh: {
    requirement: 'REFRESH_DATA',
    resolve: async (req, context) => {
      await queryClient.invalidateQueries({ queryKey: ['data'] });
      // Mark this version as refreshed so the constraint doesn't re-fire
      context.facts.lastRefreshedVersion = context.facts.dataVersion;
    },
  },
},
```

---

## Next Steps

- **[Constraints](/docs/constraints)** – How constraints evaluate and emit requirements
- **[Resolvers](/docs/resolvers)** – How resolvers handle async fulfillment
- **[Effects](/docs/effects)** – Fire-and-forget side effects for lightweight reactions
- **[Plugins](/docs/plugins/overview)** – Build custom plugins for cache sync and more
