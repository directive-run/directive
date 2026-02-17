---
title: Comparison
description: See how Directive compares to Redux, Zustand, XState, and React Query.
---

Understand when to use Directive versus other popular state management solutions. {% .lead %}

Redux, Zustand, XState, and React Query are excellent libraries &ndash; each solving distinct problems well. Directive doesn't aim to replace them. It fills a specific niche: **constraint-driven business logic** where you declare what must be true and let the runtime figure out how. Many apps benefit from pairing Directive *with* these libraries &ndash; for example, React Query for data fetching and caching alongside Directive for the business rules that act on that data.

---

## Feature Comparison

{% comparison-table /%}

---

## Redux

Redux pioneered predictable state management with actions and reducers. Redux Toolkit (RTK) modernizes the experience with less boilerplate, excellent TypeScript inference, and RTK Query for data fetching.

### When Redux is Better

- Large teams with strict conventions
- Extensive middleware ecosystem needed
- Lots of existing Redux code

### When Directive Adds Value

- Complex async flows with declarative retry/timeout
- Automatic dependency tracking instead of manual selectors
- Constraint-driven logic that reacts to state changes without manual dispatch

### vs Redux: Code Comparison

**Redux Toolkit:**
```typescript
// RTK slice – much less boilerplate than legacy Redux
const userSlice = createSlice({
  name: 'user',
  initialState: { userId: 0, user: null, loading: false, error: null },
  reducers: {
    setUserId: (state, action) => { state.userId = action.payload; },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchUser.pending, (state) => { state.loading = true; })
      .addCase(fetchUser.fulfilled, (state, action) => {
        state.loading = false;
        state.user = action.payload;
      })
      .addCase(fetchUser.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? 'Failed';
      });
  },
});

// Async thunk – you dispatch this when the user changes
const fetchUser = createAsyncThunk(
  'user/fetchUser',
  async (userId: number) => api.getUser(userId),
);

// Component must dispatch the thunk at the right time
dispatch(setUserId(123));
dispatch(fetchUser(123));
```

**Directive:**
```typescript
// One module – constraints detect the need automatically
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

// Just set the fact – the constraint handles the rest
system.facts.userId = 123;
```

---

## Zustand

Zustand is a minimal, hooks-first state manager. Its tiny bundle and simple API make it great for straightforward global state.

### When Zustand is Better

- Simple state with no complex async
- Smallest possible bundle
- Quick prototyping

### When Directive Adds Value

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

XState is a state machine and statechart library. Its actor model, visual editor, and formal verification support make it ideal for modeling complex UI flows.

### When XState is Better

- Complex UI flows (wizards, multi-step forms)
- Need visual state machine editor
- Formal verification requirements

### When Directive Adds Value

- Data-driven constraints (vs explicit state/event graphs)
- Less ceremony for common patterns
- AI agent orchestration

### vs XState: Code Comparison

**XState v5:**
```typescript
// Define every possible state and transition explicitly
const userMachine = setup({
  types: {
    context: {} as { userId: number; user: User | null },
    events: {} as
      | { type: 'SET_USER_ID'; userId: number }
      | { type: 'RETRY' },
  },
  guards: {
    hasUserId: (_, params: { userId: number }) => params.userId > 0,
  },
  actors: {
    fetchUser: fromPromise(({ input }: { input: { userId: number } }) =>
      api.getUser(input.userId),
    ),
  },
}).createMachine({
  id: 'user',
  initial: 'idle',
  context: { userId: 0, user: null },
  states: {
    idle: {
      on: {
        SET_USER_ID: {
          target: 'loading',
          guard: { type: 'hasUserId', params: ({ event }) => event },
          actions: assign({ userId: ({ event }) => event.userId }),
        },
      },
    },
    loading: {
      invoke: {
        src: 'fetchUser',
        input: ({ context }) => ({ userId: context.userId }),
        onDone: {
          target: 'success',
          actions: assign({ user: ({ event }) => event.output }),
        },
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

React Query excels at server state synchronization with built-in caching, background refetching, and optimistic updates. TanStack Query extends this to Vue, Solid, Svelte, and Angular.

### When React Query is Better

- Pure data fetching (CRUD)
- Background refetching, stale-while-revalidate
- Pagination, infinite scroll

### When Directive Adds Value

- Complex business logic beyond fetching
- Multi-step async flows
- Cross-cutting constraints that React Query wasn't designed for

### Pairing Directive with React Query

React Query handles *what data to fetch and cache*. Directive handles *what the system should do about it*. They work well together &ndash; use React Query for server state, and Directive for the business rules and coordination that act on that data.

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
      resolve: async (req, context) => {
        context.facts.user = await api.getUser(context.facts.userId);
      },
    },
    fetchPosts: {
      requirement: "FETCH_POSTS",
      resolve: async (req, context) => {
        context.facts.posts = await api.getPosts(context.facts.userId);
      },
    },
    verifyUser: {
      requirement: "VERIFY_USER",
      resolve: async (req, context) => {
        await api.sendVerification(context.facts.user!.email);
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
| Server state + caching | React Query |
| Explicit state machines | XState |
| Large team + conventions | Redux (RTK) |
| UI flow state machines | XState |
| Minimal global store | Zustand |
| Data fetching + caching | React Query |
| Declarative business rules | Directive |
| AI agent orchestration | Directive |
| Complex async with retry | Directive |
| Multi-module coordination | Directive |
| Constraint + fetch combo | Directive + React Query |
| State machines + business rules | XState + Directive |

---

## Migration Paths

Already using another library? See our migration guides:

- **[From Redux](/docs/migration/from-redux)** &ndash; Migrate reducers to modules
- **[From Zustand](/docs/migration/from-zustand)** &ndash; Convert stores to modules
- **[From XState](/docs/migration/from-xstate)** &ndash; Transform machines to constraints

---

## Next Steps

- **[Quick Start](/docs/quick-start)** &ndash; Try Directive in 5 minutes
- **[Core Concepts](/docs/core-concepts)** &ndash; Understand the mental model
- **[Examples](/docs/examples/counter)** &ndash; See real-world patterns
