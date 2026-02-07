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
  setLoading(true);
  try {
    const user = await fetchUser(userId);
    setUser(user);
  } catch (e) {
    setError(e.message);
  } finally {
    setLoading(false);
  }
}
```

Directive is **declarative**: you describe what should be true, and the system figures out how to get there.

```typescript
// Declarative: "When we have a userId but no user, we need to fetch"
constraints: {
  needsUser: {
    when: (facts) => facts.userId > 0 && !facts.user && !facts.loading,
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

---

## The Four Pillars

Directive is built on four fundamental concepts:

### 1. Facts (State)

Facts are your observable state. They're reactive values that the system tracks automatically.

```typescript
schema: {
  facts: {
    userId: t.number(),
    user: t.object<User>().nullable(),
    loading: t.boolean(),
    error: t.string().nullable(),
  },
},
```

Facts are:
- **Typed** - Full TypeScript inference from schema
- **Observable** - Changes trigger reactions
- **Mutable** - Update directly via assignment
- **Tracked** - Dependencies are automatic

```typescript
// Reading facts
const id = system.facts.userId;

// Writing facts
system.facts.userId = 123;

// In resolvers, use context.facts
resolve: async (req, context) => {
  context.facts.loading = true;
  context.facts.user = await api.getUser(context.facts.userId);
  context.facts.loading = false;
}
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
    when: (facts) => facts.userId > 0 && !facts.user && !facts.loading,
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
  // Base constraints
  hasUserId: {
    when: (facts) => facts.userId > 0,
    require: { type: "VALIDATE_USER_ID" },
  },

  // Dependent constraint
  needsUserData: {
    when: (facts) => facts.userId > 0 && facts.userIdValid && !facts.user,
    after: ["hasUserId"],  // Wait for validation
    require: { type: "FETCH_USER" },
  },
},
```

#### Priority

When multiple constraints are active, priority determines order:

```typescript
constraints: {
  critical: {
    priority: 100,  // Runs first
    when: (facts) => facts.emergency,
    require: { type: "HANDLE_EMERGENCY" },
  },
  normal: {
    priority: 50,
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
    requirement: "FETCH_USER",
    retry: { attempts: 3, backoff: "exponential" },
    timeout: 5000,
    resolve: async (req, context) => {
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
  attempts: 3,
  backoff: "exponential",  // or "linear" or custom function
  delay: 1000,  // Base delay in ms
}
```

#### Timeout

```typescript
timeout: 5000,  // Fail after 5 seconds
```

#### Deduplication

```typescript
key: (req) => `fetch-user-${req.payload.id}`,
// Same key = same resolution, won't run twice simultaneously
```

#### Custom Matching

```typescript
handles: (req) => req.type.startsWith("FETCH_"),
// Handle multiple requirement types
```

---

### 4. Derivations (Computed Values)

Derivations are computed values that automatically track dependencies.

```typescript
derive: {
  displayName: (facts) => facts.user?.name ?? "Guest",
  isLoggedIn: (facts) => facts.user !== null,
  status: (facts) => {
    if (facts.loading) return "loading";
    if (facts.error) return "error";
    if (facts.user) return "ready";
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
  isAdmin: (facts) => facts.user?.role === "admin",
  canEdit: (facts, derive) => derive.isLoggedIn && derive.isAdmin,
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
system.facts.userId = 123;  // Triggers constraint
await system.settle();       // Wait for resolver to complete
console.log(system.facts.user);  // User is now loaded
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
    run: (facts, prev) => {
      if (prev?.page !== facts.page) {
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
import { createModule, createSystem, t } from 'directive';

interface User {
  id: number;
  name: string;
  role: 'user' | 'admin';
}

const userModule = createModule("user", {
  schema: {
    facts: {
      userId: t.number(),
      user: t.object<User>().nullable(),
      loading: t.boolean(),
      error: t.string().nullable(),
    },
  },

  init: (facts) => {
    facts.userId = 0;
    facts.user = null;
    facts.loading = false;
    facts.error = null;
  },

  // Computed values
  derive: {
    displayName: (facts) => facts.user?.name ?? "Guest",
    isLoggedIn: (facts) => facts.user !== null,
    isAdmin: (facts) => facts.user?.role === 'admin',
  },

  // Rules
  constraints: {
    needsUser: {
      when: (facts) => facts.userId > 0 && !facts.user && !facts.loading,
      require: { type: "FETCH_USER" },
    },
  },

  // Fulfillment
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

  // Side effects
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

// Create and use the system
const system = createSystem({ module: userModule });

// Just set userId - everything else happens automatically
system.facts.userId = 123;
await system.settle();

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
