---
title: Comparison
description: See how Directive compares to Redux, Zustand, XState, and React Query for state management.
---

Understand when to use Directive versus other popular state management solutions. {% .lead %}

---

## Feature Comparison

| Feature | Redux | Zustand | XState | React Query | Directive |
|---------|-------|---------|--------|-------------|-----------|
| Declarative constraints | - | - | Partial | - | **Yes** |
| Auto-tracking derivations | - | - | - | - | **Yes** |
| Built-in retry/timeout | - | - | - | **Yes** | **Yes** |
| Time-travel debugging | **Yes** | - | **Yes** | - | **Yes** |
| Plugin architecture | Middleware | Middleware | - | - | **Yes** |
| AI/Agent integration | - | - | - | - | **Yes** |
| Framework agnostic | **Yes** | **Yes** | **Yes** | React-first | **Yes** |
| TypeScript inference | Good | **Good** | Good | **Good** | **Excellent** |
| Bundle size (gzip) | ~2KB | ~1KB | ~4KB | ~13KB | ~3KB |
| Learning curve | Medium | Low | High | Low | Medium |

---

## Redux

Redux pioneered predictable state management with actions and reducers.

### When Redux is Better

- Large teams with strict conventions
- Extensive middleware ecosystem needed
- Lots of existing Redux code

### When Directive is Better

- Complex async flows
- Automatic dependency tracking
- Less boilerplate for constraints

### Code Comparison

**Redux:**
```typescript
// actions.ts
const FETCH_USER = 'FETCH_USER';
const FETCH_USER_SUCCESS = 'FETCH_USER_SUCCESS';
const FETCH_USER_FAILURE = 'FETCH_USER_FAILURE';

// reducer.ts
function userReducer(state, action) {
  switch (action.type) {
    case FETCH_USER:
      return { ...state, loading: true };
    case FETCH_USER_SUCCESS:
      return { ...state, loading: false, user: action.payload };
    case FETCH_USER_FAILURE:
      return { ...state, loading: false, error: action.error };
    default:
      return state;
  }
}

// thunk.ts
const fetchUser = (userId) => async (dispatch) => {
  dispatch({ type: FETCH_USER });
  try {
    const user = await api.getUser(userId);
    dispatch({ type: FETCH_USER_SUCCESS, payload: user });
  } catch (error) {
    dispatch({ type: FETCH_USER_FAILURE, error });
  }
};
```

**Directive:**
```typescript
const userModule = createModule("user", {
  schema: {
    facts: {
      userId: t.number(),
      user: t.object<User>().nullable(),
      loading: t.boolean(),
      error: t.string().nullable(),
    },
  },
  constraints: {
    needsUser: {
      when: (f) => f.userId > 0 && !f.user && !f.loading,
      require: { type: "FETCH_USER" },
    },
  },
  resolvers: {
    fetchUser: {
      requirement: "FETCH_USER",
      retry: { attempts: 3, backoff: "exponential" },
      resolve: async (req, context) => {
        context.facts.loading = true;
        try {
          context.facts.user = await api.getUser(context.facts.userId);
        } catch (e) {
          context.facts.error = e instanceof Error ? e.message : 'Failed';
        }
        context.facts.loading = false;
      },
    },
  },
});
```

---

## Zustand

Zustand is a minimal, hooks-first state manager.

### When Zustand is Better

- Simple state with no complex async
- Smallest possible bundle
- Quick prototyping

### When Directive is Better

- Complex constraints and business rules
- Automatic retry/timeout
- Multi-module coordination

### Code Comparison

**Zustand:**
```typescript
const useUserStore = create((set, get) => ({
  userId: 0,
  user: null,
  loading: false,
  fetchUser: async () => {
    if (get().loading || !get().userId) return;
    set({ loading: true });
    try {
      const user = await api.getUser(get().userId);
      set({ user, loading: false });
    } catch (error) {
      set({ loading: false, error });
    }
  },
}));

// Manual trigger
useUserStore.getState().fetchUser();
```

**Directive:**
```typescript
// Constraint triggers automatically
system.facts.userId = 123;
await system.settle();
// User is fetched automatically
```

---

## XState

XState is a state machine library with full statechart support.

### When XState is Better

- Complex UI flows (wizards, multi-step forms)
- Need visual state machine editor
- Formal verification requirements

### When Directive is Better

- Data-driven constraints
- Less ceremony for common patterns
- AI agent orchestration

### Code Comparison

**XState:**
```typescript
const userMachine = createMachine({
  id: 'user',
  initial: 'idle',
  context: { userId: 0, user: null },
  states: {
    idle: {
      on: {
        SET_USER_ID: {
          target: 'loading',
          actions: assign({ userId: (_, e) => e.userId }),
          cond: (_, e) => e.userId > 0,
        },
      },
    },
    loading: {
      invoke: {
        src: (context) => api.getUser(context.userId),
        onDone: { target: 'success', actions: assign({ user: (_, e) => e.data }) },
        onError: { target: 'error' },
      },
    },
    success: {},
    error: {
      on: { RETRY: 'loading' },
    },
  },
});
```

**Directive:**
```typescript
const userModule = createModule("user", {
  constraints: {
    needsUser: {
      when: (f) => f.userId > 0 && !f.user,
      require: { type: "FETCH_USER" },
    },
  },
  resolvers: {
    fetchUser: {
      requirement: "FETCH_USER",
      retry: { attempts: 3, backoff: "exponential" },
      resolve: async (req, context) => {
        context.facts.user = await api.getUser(context.facts.userId);
      },
    },
  },
});
```

---

## React Query / TanStack Query

React Query excels at server state synchronization.

### When React Query is Better

- Pure data fetching (CRUD)
- Background refetching, stale-while-revalidate
- Pagination, infinite scroll

### When Directive is Better

- Complex business logic beyond fetching
- Multi-step async flows
- Cross-cutting constraints

### Using Together

Directive can wrap React Query:

```typescript
resolvers: {
  fetchUser: {
    requirement: "FETCH_USER",
    resolve: async (req, context) => {
      // Use React Query's queryClient
      const user = await queryClient.fetchQuery({
        queryKey: ['user', context.facts.userId],
        queryFn: () => api.getUser(context.facts.userId),
      });
      context.facts.user = user;
    },
  },
},
```

---

## Decision Guide

| If you need... | Use |
|----------------|-----|
| Simple global state | Zustand |
| Server state + caching | React Query |
| Explicit state machines | XState |
| Large team + conventions | Redux |
| **Constraint-driven logic** | Directive |
| **AI agent orchestration** | Directive |
| **Complex async with retry** | Directive |
| **Multi-module coordination** | Directive |

---

## Migration Paths

Already using another library? See our migration guides:

- **[From Redux](/docs/migration/from-redux)** - Migrate reducers to modules
- **[From Zustand](/docs/migration/from-zustand)** - Convert stores to modules
- **[From XState](/docs/migration/from-xstate)** - Transform machines to constraints

---

## Next Steps

- **[Quick Start](/docs/quick-start)** - Try Directive in 5 minutes
- **[Core Concepts](/docs/core-concepts)** - Understand the mental model
- **[Examples](/docs/examples/counter)** - See real-world patterns
