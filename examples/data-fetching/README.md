# Data Fetching Example

Demonstrates Directive + React Query for constraint-driven prefetching.

## Run It

```bash
# Install dependencies
pnpm install @tanstack/react-query

# Run with your React setup
```

## What This Demonstrates

### The Philosophy: "Directive WITH React Query"

Instead of replacing React Query, Directive complements it:
- **React Query** handles HOW to fetch: caching, deduplication, retries, background refetch
- **Directive** decides WHEN to fetch: constraint-driven prefetching based on UI state

### React Query Handles

```typescript
// Query options with caching
const queryOptions = {
  user: (userId: string) => ({
    queryKey: ['user', userId],
    queryFn: () => api.fetchUser(userId),
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  }),
};

// Usage in components
const { data: user, isLoading } = useQuery(queryOptions.user(userId));
```

### Directive Adds

```typescript
// Constraint: "If profile panel is open AND user not loaded → prefetch"
constraints: {
  prefetchUserOnProfileOpen: whenThenPrefetch<AppFacts>(
    (facts) => {
      if (!facts.profilePanelOpen) return false;
      if (!facts.currentUserId) return false;
      // Check if already loaded
      const key = JSON.stringify(['user', facts.currentUserId]);
      const state = facts.queryStates[key];
      if (state?.hasData || isQueryLoading(state)) return false;
      return true;
    },
    (facts) => ['user', facts.currentUserId!],
    { priority: 10 }
  ),
}
```

## Key Patterns

### 1. Cache State as Facts

The bridge syncs React Query's cache state to Directive facts:

```typescript
facts.queryStates = {
  '["user","1"]': {
    status: 'success',
    hasData: true,
    dataUpdatedAt: 1705320000000,
  },
  '["userPosts","1"]': {
    status: 'pending',
    hasData: false,
  },
}
```

This allows constraints to check cache state.

### 2. Priority Ordering

```typescript
constraints: {
  prefetchUser: { priority: 10 },      // Fetch user first
  prefetchUserPosts: { priority: 5 },  // Then posts
  prefetchComments: { priority: 1 },   // Then comments
}
```

### 3. UI State Triggers Prefetch

```typescript
// In React component
useEffect(() => {
  bridge.facts.profilePanelOpen = profileOpen;
}, [profileOpen]);

// Directive sees the change and evaluates constraints
// If constraint matches → requirement created → resolver prefetches
```

### 4. Built-in Helpers

```typescript
import {
  whenThenPrefetch,  // Constraint helper
  isQueryLoading,    // Check cache loading state
  isQueryFresh,      // Check if data is fresh
  prefetch,          // Create prefetch requirement
  invalidate,        // Create invalidate requirement
} from 'directive/react-query';
```

## When to Use Directive with React Query

| Scenario | Use Directive? |
|----------|---------------|
| Single query on component mount | No, useQuery alone |
| Prefetch on route change | Maybe, or use router loader |
| Prefetch based on UI state | Yes - constraint-driven |
| Coordinated prefetching | Yes - priority + dependencies |
| Conditional prefetching | Yes - constraint logic |
| Complex invalidation rules | Yes - constraint-driven |

## Try It

1. Click a user → watch "unmet requirements" increment briefly
2. Profile opens → Directive prefetches user + posts automatically
3. Select a post → expand comments → another prefetch
4. Check React Query DevTools for cache hits

## Files

- `types.ts` - Type definitions
- `api.ts` - Mock API
- `directive.ts` - Directive bridge configuration
- `index.tsx` - React app

## The Key Insight

**You don't manually call `queryClient.prefetchQuery()`.**

Instead:
1. Declare constraints: "If X, then prefetch Y"
2. Update facts: `bridge.facts.profilePanelOpen = true`
3. Directive evaluates constraints
4. Matching constraints produce PREFETCH requirements
5. Built-in resolver calls `queryClient.prefetchQuery()`

This declarative approach means prefetching logic is:
- Centralized (not scattered across components)
- Testable (constraint evaluation is pure)
- Inspectable (see all unmet requirements)
