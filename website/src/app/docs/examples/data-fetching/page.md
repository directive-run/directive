---
title: Data Fetching Example
description: Automatic data fetching with constraints, loading states, and error handling.
---

Fetch data automatically when conditions are met. {% .lead %}

---

## The Module

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
    requirements: {
      FETCH_USER: t.object<{ userId: number }>(),
    },
  },

  init: (facts) => {
    facts.userId = 0;
    facts.user = null;
    facts.loading = false;
    facts.error = null;
  },

  constraints: {
    needsUser: {
      when: (facts) =>
        facts.userId > 0 &&
        facts.user === null &&
        !facts.loading &&
        facts.error === null,
      require: (facts) => ({
        type: "FETCH_USER",
        userId: facts.userId,
      }),
    },
  },

  resolvers: {
    fetchUser: {
      requirement: "FETCH_USER",
      retry: { attempts: 3, backoff: "exponential" },
      timeout: 10000,
      resolve: async (req, context) => {
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

const system = createSystem({ module: userModule });
```

---

## React Component

```typescript
import { useFact, useSystem } from 'directive/react';

function UserProfile() {
  const userId = useFact('userId');
  const user = useFact('user');
  const loading = useFact('loading');
  const error = useFact('error');
  const { facts } = useSystem();

  if (loading) {
    return <div>Loading...</div>;
  }

  if (error) {
    return (
      <div>
        <p>Error: {error}</p>
        <button onClick={() => { facts.error = null }}>
          Retry
        </button>
      </div>
    );
  }

  if (!user) {
    return (
      <div>
        <input
          type="number"
          placeholder="Enter user ID"
          onChange={(e) => { facts.userId = Number(e.target.value) }}
        />
      </div>
    );
  }

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

- See Form Validation for input handling
- See Constraints for more patterns
- See Resolvers for retry configuration
