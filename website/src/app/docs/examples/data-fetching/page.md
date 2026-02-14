---
title: Data Fetching Example
description: Automatic data fetching with constraints, loading states, and error handling.
---

Fetch data automatically when conditions are met. {% .lead %}

---

## The Module

```typescript
import { createModule, createSystem, t } from '@directive-run/core';

interface User {
  id: number;
  name: string;
  email: string;
}

const userModule = createModule("user", {
  schema: {
    // Facts hold the current state of the module
    facts: {
      userId: t.number(),
      user: t.object<User>().nullable(),
      loading: t.boolean(),
      error: t.string().nullable(),
    },
    // Typed requirement payloads –ensures resolvers receive the right shape
    requirements: {
      FETCH_USER: t.object<{ userId: number }>(),
    },
  },

  // Nothing loaded yet –userId of 0 means "no selection"
  init: (facts) => {
    facts.userId = 0;
    facts.user = null;
    facts.loading = false;
    facts.error = null;
  },

  constraints: {
    // Fires when we have a userId but no user data and nothing in-flight
    needsUser: {
      when: (facts) =>
        facts.userId > 0 &&
        facts.user === null &&
        !facts.loading &&
        facts.error === null,
      // Dynamic requirement –passes the current userId to the resolver
      require: (facts) => ({
        type: "FETCH_USER",
        userId: facts.userId,
      }),
    },
  },

  resolvers: {
    fetchUser: {
      requirement: "FETCH_USER",
      // Automatically retry failed requests with exponential backoff
      retry: { attempts: 3, backoff: "exponential" },
      // Abort if the request takes longer than 10 seconds
      timeout: 10000,
      resolve: async (req, context) => {
        // Signal loading state so the constraint won't re-fire
        context.facts.loading = true;
        context.facts.error = null;

        try {
          const response = await fetch(`/api/users/${req.userId}`);
          if (!response.ok) throw new Error("Failed to fetch user");
          context.facts.user = await response.json();
        } catch (error) {
          context.facts.error = error.message;
        } finally {
          context.facts.loading = false;
        }
      },
    },
  },
});

// Create and start –the constraint is now watching for userId changes
const system = createSystem({ module: userModule });
system.start();
```

---

## React Component

```typescript
import { useFact } from '@directive-run/react';

function UserProfile() {
  // Subscribe to each fact individually –only re-renders when that fact changes
  const userId = useFact(system, 'userId');
  const user = useFact(system, 'user');
  const loading = useFact(system, 'loading');
  const error = useFact(system, 'error');

  // --- Loading state ---
  if (loading) {
    return <div>Loading...</div>;
  }

  // --- Error state: clearing the error re-activates the constraint to retry ---
  if (error) {
    return (
      <div>
        <p>Error: {error}</p>
        <button onClick={() => { system.facts.error = null }}>
          Retry
        </button>
      </div>
    );
  }

  // --- Empty state: setting userId triggers the fetch automatically ---
  if (!user) {
    return (
      <div>
        <input
          type="number"
          placeholder="Enter user ID"
          onChange={(e) => { system.facts.userId = Number(e.target.value) }}
        />
      </div>
    );
  }

  // --- Success state: user data has been fetched and is available ---
  return (
    <div>
      <h1>{user.name}</h1>
      <p>{user.email}</p>
    </div>
  );
}
```

---

## How It Works

1. User enters ID in input
2. `facts.userId` is set
3. Constraint `needsUser` becomes active
4. Requirement `FETCH_USER` is raised
5. Resolver fetches data with retries
6. Component re-renders with user data

---

## Next Steps

- [Form Validation](/docs/examples/form-validation) – Input handling
- [Constraints](/docs/constraints) – More patterns
- [Resolvers](/docs/resolvers) – Retry configuration
