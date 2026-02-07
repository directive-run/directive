---
title: React Query Bridge
description: Integrate Directive with React Query for server state management.
---

Use Directive constraints to drive React Query fetching. {% .lead %}

---

## Installation

```bash
npm install directive directive/bridges @tanstack/react-query
```

---

## Basic Integration

Connect Directive requirements to React Query:

```typescript
import { createReactQueryBridge } from 'directive/bridges';
import { queryClient } from './query-client';

const bridge = createReactQueryBridge({
  system,
  queryClient,
  queries: {
    FETCH_USER: {
      queryKey: (req) => ['user', req.userId],
      queryFn: (req) => api.getUser(req.userId),
      onSuccess: (data, context) => {
        context.facts.user = data;
      },
    },
  },
});
```

---

## Using with Constraints

Directive constraints trigger React Query fetches:

```typescript
const userModule = createModule("user", {
  constraints: {
    needsUser: {
      when: (facts) => facts.userId > 0 && !facts.user,
      require: { type: "FETCH_USER", userId: facts.userId },
    },
  },
});

// When userId changes, constraint triggers
// Bridge executes React Query fetch
// On success, fact is updated
```

---

## Mutations

Handle mutations through the bridge:

```typescript
const bridge = createReactQueryBridge({
  system,
  queryClient,
  mutations: {
    UPDATE_USER: {
      mutationFn: (req) => api.updateUser(req.userId, req.data),
      onSuccess: (data, context) => {
        context.facts.user = data;
        queryClient.invalidateQueries(['user', data.id]);
      },
      onError: (error, context) => {
        context.facts.error = error.message;
      },
    },
  },
});
```

---

## Cache Sync

Keep Directive facts in sync with React Query cache:

```typescript
const bridge = createReactQueryBridge({
  system,
  queryClient,
  cacheSync: {
    'user': ['user', (facts) => facts.userId],
    'posts': ['posts', (facts) => facts.userId],
  },
});

// When cache updates, facts update automatically
```

---

## Stale-While-Revalidate

Leverage React Query's SWR pattern:

```typescript
queries: {
  FETCH_USER: {
    queryKey: (req) => ['user', req.userId],
    queryFn: (req) => api.getUser(req.userId),
    staleTime: 5 * 60 * 1000, // 5 minutes
    cacheTime: 30 * 60 * 1000, // 30 minutes
    onSuccess: (data, context) => {
      context.facts.user = data;
    },
  },
}
```

---

## Next Steps

- See Zustand Bridge for state sync
- See Constraints for requirement patterns
- See Resolvers for native async handling
