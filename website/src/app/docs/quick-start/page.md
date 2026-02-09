---
title: Quick Start
description: Build your first Directive module in 5 minutes. Learn constraints, resolvers, and facts by building a user profile feature.
---

Build a complete user profile feature with automatic data fetching in 5 minutes. {% .lead %}

---

## Prerequisites

- Node.js 18+
- TypeScript 5.0+
- Basic familiarity with async/await

---

## Installation

```shell
npm install directive
```

---

## Step 1: Define Your Module

A module contains facts (state), constraints (rules), and resolvers (how to fulfill requirements).

```typescript
// user.module.ts
import { createModule, t } from 'directive';

interface User {
  id: number;
  name: string;
  email: string;
}

export const userModule = createModule("user", {
  schema: {
    facts: {
      userId: t.number(),
      user: t.object<User>().nullable(),
      loading: t.boolean(),
      error: t.string().nullable(),
    },
    derivations: {},
    events: {},
    requirements: {},
  },

  init: (facts) => {
    facts.userId = 0;
    facts.user = null;
    facts.loading = false;
    facts.error = null;
  },
});
```

This creates a module with typed facts. The `init` function sets initial values. The schema sections for `derivations`, `events`, and `requirements` start empty — we'll fill them in as we go.

---

## Step 2: Add Constraints

Constraints declare what must be true. When a constraint's `when` condition is true, it generates a requirement.

```typescript
export const userModule = createModule("user", {
  schema: {
    // ... facts from above, plus:
    requirements: {
      FETCH_USER: {},
    },
  },
  // ... init from above

  constraints: {
    needsUser: {
      when: (facts) => facts.userId > 0 && !facts.user && !facts.loading,
      require: { type: "FETCH_USER" },
    },
  },
});
```

This constraint says: "When we have a userId but no user (and we're not already loading), we need to fetch the user." The `FETCH_USER` requirement type is declared in the schema so resolvers can reference it.

---

## Step 3: Add Resolvers

Resolvers fulfill requirements. They run when their requirement is active.

```typescript
export const userModule = createModule("user", {
  // ... schema, init, constraints from above

  resolvers: {
    fetchUser: {
      requirement: "FETCH_USER",
      retry: { attempts: 3, backoff: "exponential" },
      resolve: async (req, context) => {
        context.facts.loading = true;
        context.facts.error = null;

        try {
          const response = await fetch(`/api/users/${context.facts.userId}`);
          if (!response.ok) throw new Error('Failed to fetch user');
          context.facts.user = await response.json();
        } catch (error) {
          context.facts.error = error instanceof Error ? error.message : 'Unknown error';
        } finally {
          context.facts.loading = false;
        }
      },
    },
  },
});
```

The resolver:
1. Sets loading state
2. Fetches the user
3. Updates facts with the result or error
4. Has built-in retry with exponential backoff

---

## Step 4: Create a System

A system runs your module. It provides the API to interact with facts.

```typescript
// app.ts
import { createSystem } from 'directive';
import { userModule } from './user.module';

const system = createSystem({ module: userModule });
system.start();

// Set the userId - the constraint will trigger automatically
system.facts.userId = 123;

// Wait for all resolvers to complete
await system.settle();

// User is now loaded
console.log(system.facts.user?.name);
```

That's it! When you set `userId`, the constraint fires, the resolver runs, and `user` is populated.

---

## Step 5: Add Derivations (Optional)

Derivations are computed values that automatically track dependencies.

```typescript
export const userModule = createModule("user", {
  schema: {
    // ... facts, events, requirements from above, plus:
    derivations: {
      displayName: t.string(),
      isLoggedIn: t.boolean(),
      status: t.string<"idle" | "loading" | "error" | "ready">(),
    },
  },
  // ... init, constraints, resolvers from above

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
});
```

Access derivations just like facts:

```typescript
console.log(system.derive.displayName); // "John" or "Guest"
console.log(system.derive.isLoggedIn);  // true or false
console.log(system.derive.status);      // "idle" | "loading" | "error" | "ready"
```

---

## Complete Example

Here's the full module:

```typescript
import { createModule, createSystem, t } from 'directive';

interface User {
  id: number;
  name: string;
  email: string;
}

const userModule = createModule("user", {
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
    },
    events: {},
    requirements: {
      FETCH_USER: {},
    },
  },

  init: (facts) => {
    facts.userId = 0;
    facts.user = null;
    facts.loading = false;
    facts.error = null;
  },

  derive: {
    displayName: (facts) => facts.user?.name ?? "Guest",
    isLoggedIn: (facts) => facts.user !== null,
  },

  constraints: {
    needsUser: {
      when: (facts) => facts.userId > 0 && !facts.user && !facts.loading,
      require: { type: "FETCH_USER" },
    },
  },

  resolvers: {
    fetchUser: {
      requirement: "FETCH_USER",
      retry: { attempts: 3, backoff: "exponential" },
      resolve: async (req, context) => {
        context.facts.loading = true;
        context.facts.error = null;
        try {
          const response = await fetch(`/api/users/${context.facts.userId}`);
          if (!response.ok) throw new Error('Failed to fetch');
          context.facts.user = await response.json();
        } catch (error) {
          context.facts.error = error instanceof Error ? error.message : 'Unknown';
        } finally {
          context.facts.loading = false;
        }
      },
    },
  },
});

// Usage
const system = createSystem({ module: userModule });
system.start();
system.facts.userId = 123;
await system.settle();
console.log(system.derive.displayName); // "John"
```

---

## Using with React

Directive has first-class React support:

```tsx
import { useFact, useDerived } from 'directive/react';
import { createSystem } from 'directive';
import { userModule } from './user.module';

const system = createSystem({ module: userModule });
system.start();

function App() {
  return <UserProfile />;
}

function UserProfile() {
  const userId = useFact(system, "userId");
  const displayName = useDerived(system, "displayName");
  const isLoggedIn = useDerived(system, "isLoggedIn");

  return (
    <div>
      <input
        type="number"
        value={userId ?? 0}
        onChange={(e) => { system.facts.userId = parseInt(e.target.value); }}
      />
      <p>Welcome, {displayName}!</p>
      <p>Logged in: {isLoggedIn ? 'Yes' : 'No'}</p>
    </div>
  );
}
```

---

## Try It Yourself

{% playground /%}

---

## Next Steps

- **[Core Concepts](/docs/core-concepts)** - Deep dive into the mental model
- **[Facts](/docs/facts)** - Learn about the state layer
- **[Constraints](/docs/constraints)** - Advanced constraint patterns
- **[React Adapter](/docs/adapters/react)** - Full React integration guide
