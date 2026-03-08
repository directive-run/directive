---
title: From Redux to Directive in 10 Minutes
description: A practical migration guide showing how Redux Toolkit patterns map to Directive's constraint-driven model, with real auth examples and incremental adoption strategies.
layout: blog
date: 2026-02-10
dateModified: 2026-02-10
slug: from-redux-to-directive
author: directive-labs
categories: [Migration, Tutorial]
---

Redux changed how we think about state management.

Unidirectional data flow, immutable updates, time-travel debugging – these ideas moved the industry forward. Redux Toolkit made the experience dramatically better by eliminating boilerplate and adding opinionated defaults. If you're using RTK today and it's working, that's a legitimate success story.

But there's a pattern that emerges in every Redux codebase past a certain size. You have slices, each with their own reducers. You have async thunks that dispatch actions to update loading states. You have selectors that derive computed values, and middleware that intercepts actions for logging or analytics. Each piece is reasonable in isolation. Together, they form a ceremony that scales linearly with every feature you add.

What if the ceremony itself is the problem? Not the implementation – RTK is well-engineered – but the model. The idea that every state change must be an action, processed by a reducer, selected by a selector, and coordinated by a thunk.

Directive takes a different approach. You declare what must be true, and the runtime figures out how to make it true. No actions, no reducers, no dispatch. Facts replace the store, derivations replace selectors, constraints replace conditionals, and resolvers replace thunks.

This guide walks through a real migration: a Redux Toolkit auth slice rewritten as a Directive module, concept by concept.

---

## The Redux version

Here's a realistic auth slice built with Redux Toolkit. It handles login, logout, and session verification – the kind of code that exists in nearly every application.

```typescript
import {
  createSlice,
  createAsyncThunk,
  createSelector,
  configureStore,
} from "@reduxjs/toolkit";

// Async thunks – each one manages its own loading/error lifecycle
export const login = createAsyncThunk(
  "auth/login",
  async (
    credentials: { email: string; password: string },
    { rejectWithValue }
  ) => {
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
      });
      if (!response.ok) {
        throw new Error("Invalid credentials");
      }

      return await response.json();
    } catch (err) {
      return rejectWithValue((err as Error).message);
    }
  }
);

export const logout = createAsyncThunk("auth/logout", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
});

export const checkSession = createAsyncThunk(
  "auth/checkSession",
  async (_, { rejectWithValue }) => {
    try {
      const response = await fetch("/api/auth/session");
      if (!response.ok) {
        throw new Error("Session expired");
      }

      return await response.json();
    } catch (err) {
      return rejectWithValue((err as Error).message);
    }
  }
);

// Slice – reducers handle every action's pending/fulfilled/rejected states
const authSlice = createSlice({
  name: "auth",
  initialState: {
    user: null as { id: string; email: string; role: string } | null,
    token: null as string | null,
    status: "idle" as "idle" | "loading" | "succeeded" | "failed",
    error: null as string | null,
    sessionChecked: false,
  },
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(login.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(login.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.user = action.payload.user;
        state.token = action.payload.token;
      })
      .addCase(login.rejected, (state, action) => {
        state.status = "failed";
        state.error = (action.payload as string) ?? "Login failed";
      })
      .addCase(logout.fulfilled, (state) => {
        state.user = null;
        state.token = null;
        state.status = "idle";
        state.sessionChecked = false;
      })
      .addCase(checkSession.pending, (state) => {
        state.status = "loading";
      })
      .addCase(checkSession.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.user = action.payload.user;
        state.token = action.payload.token;
        state.sessionChecked = true;
      })
      .addCase(checkSession.rejected, (state) => {
        state.status = "idle";
        state.user = null;
        state.token = null;
        state.sessionChecked = true;
      });
  },
});

// Selectors – manual derivations from the state tree
const selectAuth = (state: { auth: typeof authSlice.getInitialState }) =>
  state.auth;
export const selectUser = createSelector(selectAuth, (auth) => auth.user);
export const selectIsAuthenticated = createSelector(
  selectAuth,
  (auth) => auth.user !== null && auth.token !== null
);
export const selectIsAdmin = createSelector(
  selectUser,
  (user) => user?.role === "admin"
);
export const selectAuthStatus = createSelector(
  selectAuth,
  (auth) => auth.status
);

export const { clearError } = authSlice.actions;

const store = configureStore({
  reducer: { auth: authSlice.reducer },
});
```

That's roughly 110 lines for three async operations, five selectors, and a handful of state transitions. Each `createAsyncThunk` generates three action types. Each action type needs a case in `extraReducers`. Each selector is a manual derivation that you wire up yourself.

This code works. It's type-safe, predictable, and debuggable. But count the concepts: actions, action creators, thunks, reducers, extra reducers, selectors, `rejectWithValue`, `configureStore`. That's the ceremony.

---

## The Directive version

Here's the same auth logic as a Directive module:

```typescript
import { createModule, createSystem, t } from "@directive-run/core";

const auth = createModule("auth", {
  schema: {
    user: t.object<{ id: string; email: string; role: string }>().optional(),
    token: t.string().optional(),
    sessionChecked: t.boolean(),
    error: t.string().optional(),
  },

  init: (facts) => {
    facts.user = undefined;
    facts.token = undefined;
    facts.sessionChecked = false;
    facts.error = undefined;
  },

  derive: {
    isAuthenticated: (facts) =>
      facts.user !== undefined && facts.token !== undefined,
    isAdmin: (facts) => facts.user?.role === "admin",
    status: (facts, derived) => {
      if (facts.error) {
        return "failed" as const;
      }

      if (!facts.sessionChecked) {
        return "loading" as const;
      }

      if (derived.isAuthenticated) {
        return "succeeded" as const;
      }

      return "idle" as const;
    },
  },

  effects: {
    clearErrorOnLogin: {
      run: (facts, prev) => {
        if (!prev?.user && facts.user) {
          facts.error = undefined;
        }
      },
    },
  },

  constraints: {
    needsSession: {
      when: (facts) => !facts.sessionChecked,
      require: { type: "CHECK_SESSION" },
    },
    sessionExpired: {
      when: (facts) =>
        facts.sessionChecked &&
        facts.token === undefined &&
        facts.user !== undefined,
      require: { type: "CLEAR_STALE_USER" },
    },
  },

  resolvers: {
    checkSession: {
      requirement: "CHECK_SESSION",
      retry: { attempts: 2, backoff: "exponential" },
      resolve: async (_req, context) => {
        try {
          const response = await fetch("/api/auth/session");
          if (!response.ok) {
            throw new Error("Session expired");
          }

          const data = await response.json();
          context.facts.user = data.user;
          context.facts.token = data.token;
        } catch {
          context.facts.user = undefined;
          context.facts.token = undefined;
        }
        context.facts.sessionChecked = true;
      },
    },
    clearStaleUser: {
      requirement: "CLEAR_STALE_USER",
      resolve: async (_req, context) => {
        context.facts.user = undefined;
      },
    },
  },
});

const system = createSystem({ module: auth });
system.start();
```

And the login/logout functions are plain functions that mutate facts:

```typescript
async function login(email: string, password: string) {
  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) {
      throw new Error("Invalid credentials");
    }

    const data = await response.json();
    system.facts.user = data.user;
    system.facts.token = data.token;
    system.facts.error = undefined;
  } catch (err) {
    system.facts.error = (err as Error).message;
  }
}

async function logout() {
  const res = await fetch("/api/auth/logout", { method: "POST" });
  if (!res.ok) {
    throw new Error(`Logout failed: ${res.status}`);
  }

  system.facts.user = undefined;
  system.facts.token = undefined;
  system.facts.sessionChecked = false;
}
```

---

## What disappeared

Look at what's no longer there:

**No actions or action creators.** There's no `login.pending`, `login.fulfilled`, `login.rejected`. You mutate facts directly. The runtime tracks what changed.

**No reducers.** There's no `extraReducers` builder mapping action types to state transitions. Facts are the store – assign a value and it's updated.

**No manual selectors.** Derivations are auto-tracked. `isAuthenticated` reads `facts.user` and `facts.token`, and Directive automatically knows to recompute it when either changes. No `createSelector`, no input selectors, no memoization wiring.

**No loading state management.** In Redux, every async thunk generates three action types, and you write three cases in `extraReducers` to manage loading states. In Directive, the `status` derivation computes the current state from facts. There's no separate loading flag to keep in sync.

**No dispatch.** You call `system.facts.user = data.user` instead of `dispatch(login.fulfilled(data))`. The simplicity is the point.

---

## The mental model, mapped

If you're coming from Redux, every concept has a direct counterpart. The mapping isn't 1:1 – Directive's concepts are fewer and more composable – but the intent translates cleanly.

| Redux Concept | Directive Concept | What Changes |
|---|---|---|
| Actions + Dispatch | Fact mutations | Assign directly: `facts.count = 5` |
| Reducers | Automatic | Facts *are* the store; no translation layer |
| `createSelector` | `derive` | Auto-tracked; no manual dependency arrays |
| `createAsyncThunk` | Resolvers | Built-in retry, backoff, deduplication |
| Middleware | Plugins | Lifecycle hooks: `onInit`, `onStop`, `onError` |
| Conditional dispatch | Constraints | Declarative: `when` condition + `require` action |
| `configureStore` | `createSystem` | Modules compose into a single system |

The deepest shift is from *event-driven* to *constraint-driven*. In Redux, you think in terms of events: "the user clicked login, so dispatch LOGIN_PENDING." In Directive, you think in terms of requirements: "when the session hasn't been checked, a session check is required." The runtime decides when and how to fulfill the requirement.

---

## Incremental adoption

You don't have to rewrite your app in a weekend. Directive can run alongside Redux in the same application. Wrap a Directive system around a specific feature while the rest of the app stays on Redux.

```typescript
import { configureStore } from "@reduxjs/toolkit";
import { createSystem } from "@directive-run/core";
import { useFact, useDerived } from "@directive-run/react";
import { useSelector } from "react-redux";
import { authModule } from "./authModule"; // The Directive module from above

// Your existing Redux store – unchanged
const reduxStore = configureStore({
  reducer: {
    cart: cartSlice.reducer,
    ui: uiSlice.reducer,
    // auth removed – now managed by Directive
  },
});

// New: Directive handles auth
const authSystem = createSystem({ module: authModule });
authSystem.start();

// Components use both stores in the same render tree
function Header() {
  const cartCount = useSelector((s: RootState) => s.cart.items.length);
  const user = useFact(authSystem, 'user');
  const isAuthenticated = useDerived(authSystem, 'isAuthenticated');

  return (
    <header>
      <span>Cart: {cartCount}</span>
      {isAuthenticated ? (
        <span>{user?.email}</span>
      ) : (
        <LoginButton />
      )}
    </header>
  );
}
```

Migrate one slice at a time. Start with the slice that has the most async thunks or the most complex conditional logic – that's where the ceremony-to-value ratio is worst and where Directive's constraints will simplify the most.

---

## What you lose and what you gain

Honesty matters in migration guides. Here's the real tradeoff.

**What you lose:**

- **Redux DevTools ecosystem.** Redux DevTools is mature, widely installed, and deeply integrated into the React ecosystem. Directive has its own devtools plugin, but the ecosystem is younger and smaller.
- **Community size.** Redux has millions of weekly downloads and a decade of Stack Overflow answers. When you hit a wall, there are more people who've hit it before you.
- **Middleware ecosystem.** Redux middleware for logging, crash reporting, analytics, and persistence is battle-tested. Directive's plugin system covers the same ground, but with fewer off-the-shelf options today.
- **Familiarity.** Your team knows Redux. Switching to a new mental model has a real onboarding cost, even if the new model is simpler.

**What you gain:**

- **Less code.** The auth example went from ~110 lines to ~80 lines, and the difference grows with complexity. No `pending/fulfilled/rejected` tripling. No manual selector wiring.
- **Auto-tracked derivations.** Derivations recompute when their dependencies change, with zero manual dependency arrays. Add a new fact to a derivation and it just works – no updating `createSelector` inputs.
- **Built-in retry and backoff.** Every resolver supports `retry: { attempts: 3, backoff: "exponential" }` out of the box. No installing `redux-retry` or writing your own thunk wrapper.
- **Constraint-driven logic.** Business rules are declarative and independent. "When the session hasn't been checked, check it" is a constraint, not a `useEffect` with a dependency array.
- **Self-healing state.** If the system drifts into an invalid state, the reconciliation loop detects unsatisfied constraints and corrects. Redux doesn't re-evaluate your selectors or re-dispatch your thunks when state becomes inconsistent.

The honest summary: you trade ecosystem breadth for a simpler, more powerful model. If your Redux code is mostly CRUD with simple selectors, the migration may not be worth the disruption. If your codebase is full of async thunks coordinating with each other, loading states that drift out of sync, and conditional dispatches scattered across components, the constraint model will eliminate entire categories of bugs.

---

## Testing: dispatch vs. direct mutation

Redux testing involves creating a store, dispatching actions, and asserting on the resulting state shape. You configure the store, mock `fetch`, `dispatch(login(...))`, then inspect `store.getState().auth.status`. Every test exercises the full dispatch pipeline.

Directive testing is more direct. Set facts, assert on derivations, or test constraints and resolvers in isolation:

```typescript
import { createTestSystem } from "@directive-run/core/testing";
import { auth } from "./authModule";

test("isAuthenticated derives from user and token", () => {
  const { system } = createTestSystem({ module: auth });
  system.start();

  expect(system.derive.isAuthenticated).toBe(false);

  system.facts.user = { id: "1", email: "a@b.com", role: "user" };
  system.facts.token = "abc";

  expect(system.derive.isAuthenticated).toBe(true);
});

test("session constraint fires when unchecked", () => {
  const { system, requirements } = createTestSystem({ module: auth });
  system.start();

  // Constraint emits CHECK_SESSION because sessionChecked is false
  expect(requirements()).toContainEqual(
    expect.objectContaining({ type: "CHECK_SESSION" })
  );
});

test("resolver updates facts on successful session", async () => {
  const { system, resolveAll } = createTestSystem({
    module: auth,
    mocks: {
      fetch: vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          user: { id: "1", email: "a@b.com", role: "user" },
          token: "abc",
        }),
      }),
    },
  });
  system.start();
  await resolveAll();

  expect(system.facts.sessionChecked).toBe(true);
  expect(system.derive.isAuthenticated).toBe(true);
});
```

Redux tests exercise the dispatch pipeline – action creator, reducer, state shape. Directive tests exercise domain logic directly – set a fact, read a derivation, trigger a resolver. There's less machinery between the test and the behavior it's verifying. Constraints are independently testable too: "given these facts, does this constraint emit a requirement?" is a pure function test with no store setup.

---

## Getting started

Install Directive:

```bash
npm install @directive-run/core
```

For the full migration walkthrough with before/after examples for every Redux pattern – slices, thunks, selectors, middleware, RTK Query – see the **[Redux Migration Guide](/docs/migration/from-redux)**.

If you want to understand the paradigm behind the migration, **[Constraint-Driven Architecture](/blog/constraint-driven-architecture)** explains why declaring what must be true beats writing imperative handlers.

Redux gave us predictable state. Directive gives us predictable *behavior* – state that knows its own rules and enforces them automatically. The migration is incremental, the testing is simpler, and the code that disappears is the code you were maintaining but never wanted to write.
