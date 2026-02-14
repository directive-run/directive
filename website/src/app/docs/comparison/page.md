---
title: Comparison
description: See how Directive compares to Redux, Zustand, XState, and React Query for state management.
---

Understand when to use Directive versus other popular state management solutions. {% .lead %}

---

## Feature Comparison

| Feature | Redux | Zustand | MobX | XState | React Query | Directive |
|---------|-------|---------|------|--------|-------------|-----------|
| Declarative constraints | - | - | - | Partial | - | **Yes** |
| Auto-tracking derivations | - | - | **Yes** | - | - | **Yes** |
| Built-in retry/timeout | - | - | - | - | **Yes** | **Yes** |
| Time-travel debugging | **Yes** | - | - | **Yes** | - | **Yes** |
| Plugin architecture | Middleware | Middleware | - | - | - | **Yes** |
| AI/Agent integration | - | - | - | - | - | **Yes** |
| Framework agnostic | **Yes** | **Yes** | **Yes** | **Yes** | React-first | **Yes** |
| TypeScript inference | Good | **Good** | Good | Good | **Good** | **Excellent** |
| Bundle size (gzip) | ~2KB | ~1KB | ~5KB | ~4KB | ~13KB | ~3KB |
| Learning curve | Medium | Low | Low | High | Low | Medium |

---

## Redux

Redux pioneered predictable state management with actions and reducers.

### When Redux is Better

- Large teams with strict conventions
- Extensive middleware ecosystem needed
- Lots of existing Redux code

### vs Redux: When Directive is Better

- Complex async flows
- Automatic dependency tracking
- Less boilerplate for constraints

### vs Redux: Code Comparison

**Redux:**
```typescript
// actions.ts – define a constant for every state transition
const FETCH_USER = 'FETCH_USER';
const FETCH_USER_SUCCESS = 'FETCH_USER_SUCCESS';
const FETCH_USER_FAILURE = 'FETCH_USER_FAILURE';

// reducer.ts – manually handle each action type
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

// thunk.ts – orchestrate async flow with dispatches
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
// One module replaces actions + reducer + thunk
const userModule = createModule("user", {
  schema: {
    facts: {
      userId: t.number(),
      user: t.object<User>().nullable(),
      loading: t.boolean(),
      error: t.string().nullable(),
    },
  },

  // Declare the rule – no manual dispatch wiring
  constraints: {
    needsUser: {
      when: (f) => f.userId > 0 && !f.user && !f.loading,
      require: { type: "FETCH_USER" },
    },
  },

  // Retry is declarative – no boilerplate retry wrapper
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

### vs Zustand: When Directive is Better

- Complex constraints and business rules
- Automatic retry/timeout
- Multi-module coordination

### vs Zustand: Code Comparison

**Zustand:**
```typescript
const useUserStore = create((set, get) => ({
  userId: 0,
  user: null,
  loading: false,

  // Must define the fetch logic inline with guard clauses
  fetchUser: async () => {
    if (get().loading || !get().userId) {
      return;
    }

    set({ loading: true });

    try {
      const user = await api.getUser(get().userId);
      set({ user, loading: false });
    } catch (error) {
      set({ loading: false, error });
    }
  },
}));

// Caller must remember to trigger the fetch manually
useUserStore.getState().fetchUser();
```

**Directive:**
```typescript
// Constraints detect the need automatically – no fetchUser() to call
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

// Just set the fact – the constraint handles the rest
system.facts.userId = 123;
await system.settle();
```

---

## XState

XState is a state machine library with full statechart support.

### When XState is Better

- Complex UI flows (wizards, multi-step forms)
- Need visual state machine editor
- Formal verification requirements

### vs XState: When Directive is Better

- Data-driven constraints
- Less ceremony for common patterns
- AI agent orchestration

### vs XState: Code Comparison

**XState:**
```typescript
// Define every possible state and transition explicitly
const userMachine = createMachine({
  id: 'user',
  initial: 'idle',
  context: { userId: 0, user: null },
  states: {
    idle: {
      on: {
        // Must wire each event to a target state
        SET_USER_ID: {
          target: 'loading',
          actions: assign({ userId: (_, e) => e.userId }),
          cond: (_, e) => e.userId > 0,
        },
      },
    },
    loading: {
      // Invoke an async service for this state
      invoke: {
        src: (context) => api.getUser(context.userId),
        onDone: { target: 'success', actions: assign({ user: (_, e) => e.data }) },
        onError: { target: 'error' },
      },
    },
    success: {},
    error: {
      // Manual retry requires sending another event
      on: { RETRY: 'loading' },
    },
  },
});
```

**Directive:**
```typescript
// No explicit state machine – constraints handle transitions
const userModule = createModule("user", {
  schema: {
    facts: {
      userId: t.number(),
      user: t.object<User>().nullable(),
    },
  },

  init: (facts) => {
    facts.userId = 0;
    facts.user = null;
  },

  // One rule replaces idle/loading/success/error states
  constraints: {
    needsUser: {
      when: (f) => f.userId > 0 && !f.user,
      require: { type: "FETCH_USER" },
    },
  },

  // Retry is built in – no manual RETRY event needed
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

### vs React Query: When Directive is Better

- Complex business logic beyond fetching
- Multi-step async flows
- Cross-cutting constraints

### vs React Query: Code Comparison

**React Query:**
```typescript
// Define a query hook – React Query handles caching and refetching
function UserProfile({ userId }: { userId: number }) {
  const { data: user, isLoading, error } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => api.getUser(userId),
    retry: 3,
    enabled: userId > 0,
  });

  // Each additional dependency needs its own useQuery
  const { data: posts } = useQuery({
    queryKey: ['posts', userId],
    queryFn: () => api.getPosts(userId),
    enabled: !!user, // Manual dependency chain
  });

  // Business logic lives in the component
  if (user && !user.verified) {
    // Must handle this imperatively
  }
}
```

**Directive:**
```typescript
// Constraints express dependencies and business rules declaratively
const userModule = createModule("user", {
  schema: {
    facts: {
      userId: t.number(),
      user: t.object<User>().nullable(),
      posts: t.array(t.object<Post>()),
    },
  },

  constraints: {
    needsUser: {
      when: (f) => f.userId > 0 && !f.user,
      require: { type: "FETCH_USER" },
    },
    needsPosts: {
      when: (f) => f.user !== null && !f.posts.length,
      require: { type: "FETCH_POSTS" },
    },
    needsVerification: {
      when: (f) => f.user !== null && !f.user.verified,
      require: { type: "VERIFY_USER" },
    },
  },

  resolvers: {
    fetchUser: {
      requirement: "FETCH_USER",
      retry: { attempts: 3, backoff: "exponential" },
      resolve: async (req, ctx) => {
        ctx.facts.user = await api.getUser(ctx.facts.userId);
      },
    },
    fetchPosts: {
      requirement: "FETCH_POSTS",
      resolve: async (req, ctx) => {
        ctx.facts.posts = await api.getPosts(ctx.facts.userId);
      },
    },
    verifyUser: {
      requirement: "VERIFY_USER",
      resolve: async (req, ctx) => {
        await api.sendVerification(ctx.facts.user!.email);
      },
    },
  },
});
```

---

## MobX

MobX uses observables and reactions for transparent reactive programming.

### When MobX is Better

- Simple reactive state with minimal structure
- Familiar OOP class-based stores
- Incremental adoption in existing apps

### vs MobX: When Directive is Better

- Declarative constraints over imperative reactions
- Built-in async resolution with retry/timeout
- Multi-module coordination and AI integration

### vs MobX: Code Comparison

**MobX:**
```typescript
// Define an observable store class with actions and reactions
class UserStore {
  userId = 0;
  user: User | null = null;
  loading = false;

  constructor() {
    makeAutoObservable(this);

    // Reactions are imperative – you wire them up manually
    autorun(() => {
      if (this.userId > 0 && !this.user && !this.loading) {
        this.fetchUser();
      }
    });
  }

  // Actions must be explicitly marked or wrapped
  async fetchUser() {
    this.loading = true;
    try {
      const user = await api.getUser(this.userId);
      runInAction(() => {
        this.user = user;
        this.loading = false;
      });
    } catch (error) {
      runInAction(() => {
        this.loading = false;
      });
      // No built-in retry – must implement manually
    }
  }
}
```

**Directive:**
```typescript
// Constraints replace autorun – declarative instead of imperative
const userModule = createModule("user", {
  schema: {
    facts: {
      userId: t.number(),
      user: t.object<User>().nullable(),
      loading: t.boolean(),
      error: t.string().nullable(),
    },
  },

  // Same auto-tracking, but the "what" and "how" are separated
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
      resolve: async (req, ctx) => {
        ctx.facts.loading = true;
        try {
          ctx.facts.user = await api.getUser(ctx.facts.userId);
        } catch (e) {
          ctx.facts.error = e instanceof Error ? e.message : 'Failed';
        }
        ctx.facts.loading = false;
      },
    },
  },
});
```

---

## Decision Guide

| If you need... | Use |
|----------------|-----|
| Simple global state | Zustand |
| Reactive OOP stores | MobX |
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
