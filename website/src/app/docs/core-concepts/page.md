---
title: Core Concepts
description: Understand the fundamental concepts and mental model of Directive.
---

Directive uses a constraint-driven model where you declare what must be true, and the runtime figures out how to make it happen. {% .lead %}

{% constraint-flow-diagram /%}

---

## The Mental Model Shift

Traditional state management is **imperative**: you tell the system exactly what to do and when.

```typescript
// Imperative: "When the button is clicked, fetch the user, then update state"
async function handleClick() {
  // Developer manually orchestrates every step
  setLoading(true);

  try {
    const user = await fetchUser(userId);
    setUser(user);
  } catch (e) {
    setError(e.message);
  } finally {
    // Must remember to reset loading in every code path
    setLoading(false);
  }
}
```

Directive is **declarative**: you describe what should be true, and the system figures out how to get there.

```typescript
// Declarative: "When we have a userId but no user, we need to fetch"
constraints: {
  needsUser: {
    // The system evaluates this rule continuously
    when: (facts) => facts.userId > 0 && !facts.user && !facts.loading,

    // When the condition is true, generate this requirement
    require: { type: "FETCH_USER" },
  },
},
```

This shift has profound implications:

| Imperative | Declarative |
|------------|-------------|
| You manage timing | System manages timing |
| You track dependencies | System tracks dependencies |
| You handle race conditions | System handles race conditions |
| You coordinate async | System coordinates async |
| Changes require rewiring | Changes require updating rules |

```
        Facts change ──────────► Constraints evaluate
             ▲                            │
             │                            ▼
        Facts updated ◄──────── Resolvers execute
```

---

## The Four Pillars

Directive is built on four fundamental concepts:

### 1. Facts (State)

Facts are your observable state. They're reactive values that the system tracks automatically.

```typescript
schema: {
  facts: {
    userId: t.number(),
    user: t.object<User>().nullable(),   // null until loaded
    loading: t.boolean(),
    error: t.string().nullable(),         // null when no error
  },
},
```

Facts are:
- **Typed** - Full TypeScript inference from schema
- **Observable** - Changes trigger reactions
- **Mutable** - Update directly via assignment
- **Tracked** - Dependencies are automatic

```typescript
// Reading facts – simple property access
const id = system.facts.userId;

// Writing facts – assignment triggers the reconciliation loop
system.facts.userId = 123;

// Inside resolvers, read and write through context.facts
resolve: async (req, context) => {
  context.facts.loading = true;
  context.facts.user = await api.getUser(context.facts.userId);
  context.facts.loading = false;
}
```

```
    Effects                          Resolvers
    ───────                          ─────────
    Fact Change                      Requirement
        │                                │
        ▼                                ▼
    Fire & Forget                    Async Fulfill
    (logging, analytics)             (API calls, state)
```

{% callout type="warning" title="Nested Object Mutations" %}
Mutations to nested objects are not tracked. Always replace the entire object:
```typescript
// Bad: mutation not tracked
context.facts.user.name = "John";

// Good: replace the object
context.facts.user = { ...context.facts.user, name: "John" };
```
{% /callout %}

---

### 2. Constraints (Rules)

Constraints declare what must be true. They're the rules that drive your application.

```typescript
constraints: {
  needsUser: {
    // Activates when we have an ID but haven't loaded the user yet
    when: (facts) => facts.userId > 0 && !facts.user && !facts.loading,

    // Tell the system what we need – a resolver will handle the rest
    require: { type: "FETCH_USER" },
  },
},
```

A constraint has:
- **when** - A function that returns true when the constraint is active
- **require** - The requirement to generate when active

When `when` returns true, the constraint generates a requirement. The system then finds a resolver to fulfill it.

#### Constraint Composition

Constraints can be composed for complex logic:

```typescript
constraints: {
  // Step 1: Validate the user ID first
  hasUserId: {
    when: (facts) => facts.userId > 0,
    require: { type: "VALIDATE_USER_ID" },
  },

  // Step 2: Only fetch after validation succeeds
  needsUserData: {
    when: (facts) => facts.userId > 0 && facts.userIdValid && !facts.user,
    after: ["hasUserId"],  // Ensures validation runs before fetching
    require: { type: "FETCH_USER" },
  },
},
```

#### Priority

When multiple constraints are active, priority determines order:

```typescript
constraints: {
  critical: {
    priority: 100,  // Higher priority – resolved first
    when: (facts) => facts.emergency,
    require: { type: "HANDLE_EMERGENCY" },
  },

  normal: {
    priority: 50,   // Lower priority – waits for critical constraints
    when: (facts) => facts.needsUpdate,
    require: { type: "UPDATE_DATA" },
  },
},
```

---

### 3. Resolvers (Fulfillment)

Resolvers fulfill requirements. They're async functions that make constraints true.

```typescript
resolvers: {
  fetchUser: {
    // This resolver handles FETCH_USER requirements
    requirement: "FETCH_USER",

    // Built-in resilience – no manual retry loops
    retry: { attempts: 3, backoff: "exponential" },
    timeout: 5000,

    resolve: async (req, context) => {
      // Signal loading state
      context.facts.loading = true;
      context.facts.error = null;

      try {
        context.facts.user = await api.getUser(context.facts.userId);
      } catch (error) {
        context.facts.error = error.message;
      } finally {
        context.facts.loading = false;
      }
    },
  },
},
```

Resolvers have powerful built-in features:

#### Retry & Backoff

```typescript
retry: {
  attempts: 3,                // Try up to 3 times before failing
  backoff: "exponential",     // or "linear" or "none"
  initialDelay: 1000,         // First retry waits 1s, then 2s, then 4s...
}
```

#### Timeout

```typescript
// Automatically fail if the resolver takes too long
timeout: 5000,  // 5 second deadline
```

#### Deduplication

```typescript
// Prevent duplicate work – same key means same resolution
key: (req) => `fetch-user-${req.userId}`,
// Two constraints requesting the same user won't trigger two API calls
```

#### Predicate Matching

```typescript
// Match multiple requirement types with a type guard
requirement: (req): req is FetchRequirement => req.type.startsWith("FETCH_"),
// One resolver can handle FETCH_USER, FETCH_POSTS, FETCH_SETTINGS, etc.
```

---

### 4. Derivations (Computed Values)

Derivations are computed values that automatically track dependencies.

```typescript
derive: {
  // Show user's name, or "Guest" if not logged in
  displayName: (facts) => facts.user?.name ?? "Guest",

  // Simple boolean derived from whether user data exists
  isLoggedIn: (facts) => facts.user !== null,

  // Combine multiple facts into a single status value
  status: (facts) => {
    if (facts.loading) {
      return "loading";
    }

    if (facts.error) {
      return "error";
    }

    if (facts.user) {
      return "ready";
    }

    return "idle";
  },
},
```

Derivations are:
- **Auto-tracked** - No dependency arrays needed
- **Memoized** - Only recompute when dependencies change
- **Composable** - Can depend on other derivations

```typescript
derive: {
  // Base derivation – checks a single fact
  isAdmin: (facts) => facts.user?.role === "admin",

  // Composed – builds on other derivations via the second argument
  canEdit: (facts, derive) => derive.isLoggedIn && derive.isAdmin,

  // Deeper composition – mixes derivations with facts
  canDelete: (facts, derive) => derive.canEdit && facts.user?.permissions.delete,
},
```

---

## The Reconciliation Loop

When facts change, Directive runs the reconciliation loop:

```text
Facts change --> Constraints evaluate --> Requirements generated
     ^                                           |
     |                                           v
Facts updated <------------------------ Resolvers execute
```

1. **Facts change** - Via direct assignment or resolver updates
2. **Constraints evaluate** - Each constraint's `when` function runs
3. **Requirements generated** - Active constraints produce requirements
4. **Resolvers execute** - Matching resolvers handle requirements
5. **Facts updated** - Resolvers modify facts
6. **Repeat** - Until no new requirements (settled)

### Settling

The system "settles" when all requirements are fulfilled:

```typescript
// Set a fact – this triggers the reconciliation loop
system.facts.userId = 123;

// Wait until all constraints are satisfied and resolvers finish
await system.settle();

// The system is now "settled" – all requirements fulfilled
console.log(system.facts.user);  // User is loaded
```

---

## Effects vs Resolvers

Directive has two ways to run side effects:

| Effects | Resolvers |
|---------|-----------|
| Fire-and-forget | Fulfill requirements |
| Run on fact changes | Run when constraints activate |
| No retry/timeout | Built-in retry/timeout |
| For observations | For actions |

**Use Effects for**: logging, analytics, DOM updates, notifications

```typescript
effects: {
  trackPageView: {
    // Fires whenever facts change – compare with previous values
    run: (facts, prev) => {
      if (prev?.page !== facts.page) {
        // Fire-and-forget: no retries, no requirements
        analytics.pageView(facts.page);
      }
    },
  },
},
```

**Use Resolvers for**: API calls, data loading, state transitions

```typescript
resolvers: {
  fetchData: {
    // Tied to a requirement – only runs when a constraint activates it
    requirement: "FETCH_DATA",

    resolve: async (req, context) => {
      context.facts.data = await api.getData();
    },
  },
},
```

---

## Putting It All Together

Here's a complete example showing all concepts working together:

```typescript
import { createModule, createSystem, t } from '@directive-run/core';

interface User {
  id: number;
  name: string;
  role: 'user' | 'admin';
}

const userModule = createModule("user", {
  // Define the shape of all state, computed values, and requirements
  schema: {
    facts: {
      userId: t.number(),
      user: t.object<User>().nullable(),
      loading: t.boolean(),
      error: t.string().nullable(),
    },
    derivations: {
      displayName: t.string(),
      isLoggedIn: t.boolean(),
      isAdmin: t.boolean(),
    },
    events: {},
    requirements: {
      FETCH_USER: {},
    },
  },

  // Set initial values when the system starts
  init: (facts) => {
    facts.userId = 0;
    facts.user = null;
    facts.loading = false;
    facts.error = null;
  },

  // Computed values – auto-tracked, no dependency arrays
  derive: {
    displayName: (facts) => facts.user?.name ?? "Guest",
    isLoggedIn: (facts) => facts.user !== null,
    isAdmin: (facts) => facts.user?.role === 'admin',
  },

  // Rules – declare what must be true
  constraints: {
    needsUser: {
      // When we have an ID but no user, we need to fetch
      when: (facts) => facts.userId > 0 && !facts.user && !facts.loading,
      require: { type: "FETCH_USER" },
    },
  },

  // Fulfillment – how to make constraints true
  resolvers: {
    fetchUser: {
      requirement: "FETCH_USER",
      retry: { attempts: 3, backoff: "exponential" },

      resolve: async (req, context) => {
        context.facts.loading = true;
        context.facts.error = null;

        try {
          const response = await fetch(`/api/users/${context.facts.userId}`);
          context.facts.user = await response.json();
        } catch (error) {
          context.facts.error = error instanceof Error ? error.message : 'Failed';
        } finally {
          context.facts.loading = false;
        }
      },
    },
  },

  // Side effects – observe changes without generating requirements
  effects: {
    logUserChange: {
      run: (facts, prev) => {
        if (prev?.user?.id !== facts.user?.id) {
          console.log(`User changed: ${facts.user?.name ?? 'logged out'}`);
        }
      },
    },
  },
});

// Create and start the system
const system = createSystem({ module: userModule });
system.start();

// Set userId – constraints, resolvers, and effects run automatically
system.facts.userId = 123;
await system.settle();

// After settling, all derived values reflect the loaded user
console.log(system.derive.displayName);  // "John"
console.log(system.derive.isLoggedIn);   // true
console.log(system.derive.isAdmin);      // false
```

---

## Key Takeaways

1. **Declare, don't orchestrate** - State what must be true, not how to get there
2. **Facts are observable** - Changes trigger the reconciliation loop
3. **Constraints generate requirements** - They're the rules of your system
4. **Resolvers fulfill requirements** - They handle async logic with built-in resilience
5. **Derivations compute values** - No manual dependency tracking needed
6. **Effects observe changes** - Fire-and-forget side effects

---

## Next Steps

- [Facts](/docs/facts) - Deep dive into state management
- [Constraints](/docs/constraints) - Advanced constraint patterns
- [Resolvers](/docs/resolvers) - Retry, timeout, batching
- [Derivations](/docs/derivations) - Computed values and composition
- [Glossary](/docs/glossary) - Key terms reference
