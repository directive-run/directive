---
title: Introducing Directive
description: Declare what must be true. Let the runtime resolve it. Directive is a constraint-driven runtime for TypeScript that replaces imperative state management with declarative rules.
layout: blog
date: 2026-02-15
dateModified: 2026-02-15
slug: introducing-directive
author: jason-comes
categories: [Architecture, State Management]
---

State management libraries handle the simple cases well. A counter. A toggle. A form with a few fields. But the moment your application needs to coordinate async operations, enforce business rules across multiple data sources, and recover from failures mid-flow, you're writing the orchestration layer yourself &ndash; and it's the hardest code in your codebase.

I've been building that layer for years. Custom retry logic in every API call. Loading states that drift out of sync. Race conditions between parallel fetches. Error handling scattered across a dozen files. Each project reinvents the same patterns, and each implementation has the same subtle bugs.

Directive is my answer to this problem. It's a TypeScript runtime built on a single idea: **declare what must be true, and let the runtime make it true**. Instead of writing procedures that handle every state transition, you declare constraints &ndash; rules your system must satisfy &ndash; and resolvers &ndash; the actions that fulfill them. The runtime evaluates constraints, dispatches resolvers, and loops until everything is settled.

This post walks through what Directive is, how it works, and when to use it.

---

## The problem Directive solves

Here's a function you've probably written some version of:

```typescript
async function loadUserProfile(userId: string) {
  setLoading(true);
  setError(null);

  try {
    // Check session first
    const session = await verifySession();
    if (!session.valid) {
      // Session expired – try to refresh
      try {
        await refreshSession();
      } catch {
        redirectToLogin();

        return;
      }
    }

    // Fetch user data
    const user = await fetchUser(userId);
    setUser(user);

    // Fetch preferences (depends on user)
    const prefs = await fetchPreferences(user.id);
    setPreferences(prefs);

    setLoading(false);
  } catch (err) {
    setLoading(false);
    setError(err.message);

    // Retry once on network failure
    if (err instanceof NetworkError && !hasRetried) {
      hasRetried = true;
      setTimeout(() => loadUserProfile(userId), 2000);
    }
  }
}
```

This works for a demo. But it has problems that compound as the system grows:

**Race conditions.** If the user navigates away and back while this function is running, two instances race. The first might set stale data after the second has already loaded fresh data.

**Manual retry.** The retry logic is hand-built. It retries once with a fixed delay. There's no exponential backoff, no max attempts, no cancellation if the user navigates away.

**Scattered error handling.** Session expiry is handled inline. Network errors are caught at the bottom. If `fetchPreferences` fails, the user data was already set &ndash; you're in a half-loaded state with no recovery path.

**Loading state drift.** If the retry path throws, `setLoading(false)` never runs. The UI shows a spinner forever.

**Sequential by necessity.** Preferences depend on user data, but the session check doesn't depend on either. You can't express "run these in parallel but that one first" without restructuring the entire function.

Every one of these is a real bug that makes it to production. They're not hard to fix individually. They're hard to fix simultaneously, consistently, across every async flow in your application.

---

## Declare requirements. Let the runtime resolve them.

Directive inverts the model. Instead of writing a procedure that handles every path, you declare what must be true and let the runtime figure out how to get there.

The engine runs a **reconciliation loop** after every fact mutation:

```
Facts change
  → Constraints evaluate (which rules are unsatisfied?)
    → Requirements emitted (what needs to happen?)
      → Resolvers execute (make it happen)
        → Facts update
          → Loop repeats until settled
```

This is the same idea as React's reconciliation &ndash; you declare what the UI should look like, React figures out the DOM updates. Directive does the same thing for application state. For a deeper look at the paradigm, see [Constraint-Driven Architecture](/blog/constraint-driven-architecture).

---

## Core concepts

Directive modules are built from six concepts: facts, derivations, constraints, resolvers, effects, and events. Here's each one, using a user profile system as the running example.

### Facts

Facts are your module's mutable state. Define them with a typed schema and initialize them in `init`:

```typescript
import { createModule, t } from '@directive-run/core';

const userProfile = createModule("user-profile", {
  schema: {
    userId: t.string().optional(),
    user: t.object<{
      id: string; name: string; email: string; role: string;
    }>().optional(),
    preferences: t.object<{ theme: string; locale: string }>().optional(),
    sessionValid: t.boolean(),
    error: t.string().optional(),
  },

  init: (facts) => {
    facts.sessionValid = false;
  },
});
```

Facts are proxied &ndash; mutations trigger the reconciliation loop. TypeScript infers the types from `t.*` builders, so `facts.userId` is `string | undefined` and `facts.sessionValid` is `boolean`. No manual type annotations needed.

### Derivations

Derivations are auto-tracked computed values. They recompute when their dependencies change &ndash; no dependency arrays, no manual subscriptions:

```typescript
derive: {
  isAuthenticated: (facts) =>
    facts.sessionValid && facts.user !== undefined,

  displayName: (facts) =>
    facts.user?.name ?? 'Guest',

  // Composition: derivations can reference other derivations
  profileReady: (facts, derive) =>
    derive.isAuthenticated && facts.preferences !== undefined,
},
```

`profileReady` depends on `isAuthenticated`, which depends on `sessionValid` and `user`. Change any upstream fact and the entire chain recomputes. Directive tracks this automatically by observing which facts each derivation reads during execution.

### Constraints

Constraints declare what must be true. When a `when` condition is satisfied, a requirement is emitted. The runtime collects all unsatisfied constraints and resolves them:

```typescript
constraints: {
  needsSession: {
    when: (facts) => !facts.sessionValid && facts.userId !== undefined,
    require: { type: 'VERIFY_SESSION' },
  },
  needsUser: {
    when: (facts) =>
      facts.sessionValid &&
      facts.user === undefined &&
      facts.userId !== undefined,
    require: (facts) => ({ type: 'FETCH_USER', userId: facts.userId! }),
  },
  needsPreferences: {
    when: (facts) =>
      facts.user !== undefined && facts.preferences === undefined,
    require: (facts) => ({
      type: 'FETCH_PREFERENCES',
      userId: facts.user!.id,
    }),
    priority: 30,
  },
},
```

Each constraint is independent. `needsUser` doesn't know about `needsSession` &ndash; it only checks its own preconditions. The ordering emerges from the constraint dependencies: `needsUser` can't fire until `sessionValid` is true, which means the session resolver must run first. Priority controls evaluation order when multiple constraints fire simultaneously &ndash; higher numbers evaluate first.

### Resolvers

Resolvers are the "how" to a constraint's "what." Each resolver handles one requirement type and updates facts when done:

```typescript
resolvers: {
  verifySession: {
    requirement: 'VERIFY_SESSION',
    resolve: async (_req, context) => {
      try {
        const session = await verifySession();
        context.facts.sessionValid = session.valid;
      } catch {
        context.facts.sessionValid = false;
      }
    },
  },
  fetchUser: {
    requirement: 'FETCH_USER',
    timeout: 10000,
    retry: { attempts: 3, backoff: 'exponential', initialDelay: 500 },
    resolve: async (req, context) => {
      const user = await fetch(`/api/users/${req.userId}`)
        .then((r) => r.json());
      context.facts.user = user;
    },
  },
  fetchPreferences: {
    requirement: 'FETCH_PREFERENCES',
    resolve: async (req, context) => {
      const prefs = await fetch(`/api/users/${req.userId}/preferences`)
        .then((r) => r.json());
      context.facts.preferences = prefs;
    },
  },
},
```

Retry logic is declarative. `fetchUser` will retry three times with exponential backoff starting at 500ms. If all attempts fail, the error boundary handles it. No `while` loops, no `setTimeout` chains, no manual attempt counters.

The resolver receives `req` (the requirement payload) and `context` (a context with `context.facts`, `context.signal` for cancellation, and `context.snapshot()` for reading point-in-time state).

### Effects

Effects are fire-and-forget side effects that run when facts change. They don't emit requirements or return values &ndash; they just react:

```typescript
effects: {
  onLogin: {
    run: (facts, prev) => {
      if (!prev?.user && facts.user) {
        analytics.track('user_logged_in', { userId: facts.user.id });
      }
    },
  },
  syncTheme: {
    run: (facts) => {
      if (facts.preferences?.theme) {
        document.documentElement.dataset.theme = facts.preferences.theme;
      }
    },
  },
},
```

Effects receive the current facts and the previous facts. Use them for analytics, DOM updates, logging, or any side effect that doesn't need to feed back into the system.

### Events

Events are type-safe mutation handlers. Define the payload shape in the schema, write the handler, and dispatch from anywhere:

```typescript
const userProfile = createModule("user-profile", {
  schema: {
    facts: {
      userId: t.string().optional(),
      user: t.object<{
        id: string; name: string; email: string; role: string;
      }>().optional(),
      sessionValid: t.boolean(),
    },
    events: {
      login: { userId: t.string() },
      logout: {},
    },
  },

  init: (facts) => {
    facts.sessionValid = false;
  },

  events: {
    login: (facts, { userId }) => {
      facts.userId = userId;
    },
    logout: (facts) => {
      facts.userId = undefined;
      facts.user = undefined;
      facts.sessionValid = false;
    },
  },
});
```

Dispatch events with full type safety:

```typescript
system.dispatch('login', { userId: 'user-123' });
system.dispatch('logout');
```

Events trigger fact mutations, which trigger the reconciliation loop. Dispatching `login` sets `userId`, which satisfies the `needsSession` constraint, which triggers the session verifier, and the cascade begins.

---

## Putting it all together

Here's the complete user profile module with all six concepts working together:

```typescript
import { createModule, createSystem, t } from '@directive-run/core';

const userProfile = createModule("user-profile", {
  schema: {
    facts: {
      userId: t.string().optional(),
      user: t.object<{
        id: string; name: string; email: string; role: string;
      }>().optional(),
      preferences: t.object<{
        theme: string; locale: string;
      }>().optional(),
      sessionValid: t.boolean(),
      error: t.string().optional(),
    },
    events: {
      login: { userId: t.string() },
      logout: {},
    },
  },

  init: (facts) => {
    facts.sessionValid = false;
  },

  derive: {
    isAuthenticated: (facts) =>
      facts.sessionValid && facts.user !== undefined,
    displayName: (facts) =>
      facts.user?.name ?? 'Guest',
    profileReady: (facts, derive) =>
      derive.isAuthenticated && facts.preferences !== undefined,
  },

  events: {
    login: (facts, { userId }) => {
      facts.userId = userId;
    },
    logout: (facts) => {
      facts.userId = undefined;
      facts.user = undefined;
      facts.preferences = undefined;
      facts.sessionValid = false;
    },
  },

  effects: {
    onLogin: {
      run: (facts, prev) => {
        if (!prev?.user && facts.user) {
          analytics.track('user_logged_in', { userId: facts.user.id });
        }
      },
    },
  },

  constraints: {
    needsSession: {
      when: (facts) => !facts.sessionValid && facts.userId !== undefined,
      require: { type: 'VERIFY_SESSION' },
    },
    needsUser: {
      when: (facts) =>
        facts.sessionValid &&
        facts.user === undefined &&
        facts.userId !== undefined,
      require: (facts) => ({ type: 'FETCH_USER', userId: facts.userId! }),
    },
    needsPreferences: {
      when: (facts) =>
        facts.user !== undefined && facts.preferences === undefined,
      require: (facts) => ({
        type: 'FETCH_PREFERENCES',
        userId: facts.user!.id,
      }),
      priority: 30,
    },
  },

  resolvers: {
    verifySession: {
      requirement: 'VERIFY_SESSION',
      resolve: async (_req, context) => {
        const session = await verifySession();
        context.facts.sessionValid = session.valid;
      },
    },
    fetchUser: {
      requirement: 'FETCH_USER',
      retry: { attempts: 3, backoff: 'exponential', initialDelay: 500 },
      resolve: async (req, context) => {
        const user = await fetch(`/api/users/${req.userId}`)
          .then((r) => r.json());
        context.facts.user = user;
      },
    },
    fetchPreferences: {
      requirement: 'FETCH_PREFERENCES',
      resolve: async (req, context) => {
        const prefs = await fetch(`/api/users/${req.userId}/preferences`)
          .then((r) => r.json());
        context.facts.preferences = prefs;
      },
    },
  },
});

const system = createSystem({ module: userProfile });
system.start();
```

When `system.start()` runs, here's what happens:

1. `init` sets `sessionValid` to `false`. All other facts are `undefined`.
2. No constraints fire yet &ndash; `userId` is `undefined`, so `needsSession` is not satisfied.
3. User dispatches `system.dispatch('login', { userId: 'user-123' })`.
4. The `login` event sets `facts.userId`. The `needsSession` constraint fires because `sessionValid` is `false` and `userId` is defined.
5. The `VERIFY_SESSION` resolver runs, verifies the session, and sets `sessionValid = true`.
6. Now `needsUser` fires &ndash; session is valid, user is `undefined`, userId is set.
7. The `FETCH_USER` resolver runs (with 3 retries and exponential backoff), fetches the user, and sets `facts.user`.
8. The `onLogin` effect fires &ndash; `prev.user` was `undefined`, `facts.user` is now set. Analytics event tracked.
9. `needsPreferences` fires &ndash; user exists, preferences are `undefined`.
10. The `FETCH_PREFERENCES` resolver runs and sets `facts.preferences`.
11. All constraints are satisfied. `profileReady` derives to `true`. The system is settled.

If the session expires mid-flow, `sessionValid` flips to `false`, and `needsSession` re-fires. The system self-corrects without any manual recovery code.

---

## What you get for free

Every module built with Directive inherits runtime behaviors that you'd otherwise implement yourself:

- **Retry with backoff.** Exponential, linear, or fixed-delay retry on any resolver. Configurable attempts, delays, and max duration. See [Resolvers](/docs/resolvers).
- **Requirement deduplication.** Two constraints requiring `FETCH_USER` for the same userId produce one resolver execution, not two. Custom `key` functions control deduplication granularity.
- **Automatic cancellation.** When a requirement is no longer needed (the constraint that emitted it is now satisfied), in-flight resolvers receive an abort signal via `context.signal`.
- **Error boundaries.** Resolver failures are caught and routed through configurable recovery strategies &ndash; retry, skip, or escalate. See [Error Boundaries](/docs/advanced/errors).
- **Time-travel debugging.** Record snapshots of every fact mutation and replay them forward and backward. Export and import state for bug reproduction. See [Time Travel](/docs/advanced/time-travel).
- **Plugin system.** Lifecycle hooks for logging, persistence, devtools, and custom integrations. Ship with built-in logging and devtools plugins. See [Plugins](/docs/plugins/overview).
- **Testing utilities.** Mock resolvers, fake timers, constraint assertions, and isolated test systems. See [Testing](/docs/testing/overview).
- **Framework adapters.** First-class bindings for React, Vue, Svelte, Solid, and Lit. See [React](/docs/api/react).

---

## When to use Directive

**Directive shines when:**

- You have **complex async coordination** &ndash; multiple API calls that depend on each other, with retry, timeout, and cancellation requirements.
- Your domain has **interacting business rules** &ndash; five or more constraints that reference overlapping state and change independently.
- You're building **AI agent orchestration** &ndash; budget enforcement, guardrails, approval workflows, and multi-agent coordination. See [AI Overview](/ai/overview).
- You need **multi-module systems** &ndash; independent modules that compose into a single runtime with cross-module constraints. See [Multi-Module](/docs/advanced/multi-module).

**Directive is overkill when:**

- Your state is a **single boolean toggle** or a simple form. A `useState` or Zustand store is the right tool.
- You're building a **static site** with no async operations or business rules.
- Your application is **basic CRUD** &ndash; fetch, display, submit. A data-fetching library like TanStack Query covers this well.

The threshold is roughly this: when you have five or more interacting rules that touch the same state, when those rules change independently, and when failures need structured recovery &ndash; that's when Directive pays for itself.

---

## Get started

Install Directive:

```bash
npm install @directive-run/core
```

Define your first module:

```typescript
import { createModule, createSystem, t } from '@directive-run/core';

const app = createModule("app", {
  schema: {
    count: t.number(),
  },
  init: (facts) => {
    facts.count = 0;
  },
  derive: {
    doubled: (facts) => facts.count * 2,
  },
  constraints: {
    tooHigh: {
      when: (facts) => facts.count > 100,
      require: { type: 'RESET' },
    },
  },
  resolvers: {
    reset: {
      requirement: 'RESET',
      resolve: async (_req, context) => {
        context.facts.count = 0;
      },
    },
  },
});

const system = createSystem({ module: app });
system.start();
```

Explore the documentation:

- **[Schema Overview](/docs/schema-overview)** &ndash; defining facts with typed schemas
- **[Constraints](/docs/constraints)** &ndash; declaring rules with `when` and `require`
- **[Resolvers](/docs/resolvers)** &ndash; resolution logic with retry and batching
- **[Effects](/docs/effects)** &ndash; fire-and-forget side effects
- **[Events](/docs/events)** &ndash; type-safe state mutations
- **[Why Directive?](/docs/why-directive)** &ndash; the full case for constraint-driven state

If you want to understand the paradigm behind Directive, [Constraint-Driven Architecture](/blog/constraint-driven-architecture) explains why declaring "what must be true" beats writing imperative handlers.

Directive is open source and MIT licensed. I built it because I kept solving the same problems &ndash; retry, coordination, recovery, business rules &ndash; in every project, with the same subtle bugs. Declare the rules. Let the runtime handle the rest.
