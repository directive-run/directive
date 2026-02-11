---
title: Why Directive
description: Learn why Directive's constraint-driven approach solves the problems that traditional state management libraries struggle with.
---

Traditional state management makes you orchestrate every transition manually. Directive takes a different approach. {% .lead %}

---

## The Problem with Imperative State

Most state management follows an imperative pattern: when X happens, do Y, then Z. This creates several problems:

### Race Conditions Everywhere

```typescript
// Traditional approach - race condition prone
async function loadUser(userId: number) {
  setLoading(true);

  try {
    const user = await fetchUser(userId);

    // What if userId changed while this request was in flight?
    setUser(user);
    setLoading(false);
  } catch (error) {
    // Every caller must remember to handle errors consistently
    setError(error);
    setLoading(false);
  }
}
```

What happens if the user changes `userId` while a request is in flight? You need to track request IDs, cancel previous requests, or add complex debouncing logic.

### Scattered Logic

State transitions end up spread across event handlers, effects, and middleware. Understanding "when does user data get fetched?" requires tracing through multiple files.

### Manual Retry Logic

Every async operation needs its own retry handling:

```typescript
// This same boilerplate gets copy-pasted into every async operation
async function fetchWithRetry(fn, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      // Give up on the last attempt
      if (i === attempts - 1) throw e;

      // Exponential backoff: 1s, 2s, 4s...
      await sleep(Math.pow(2, i) * 1000);
    }
  }
}
```

---

## The Directive Approach

Directive inverts the model. Instead of "when X happens, do Y", you declare "Y must be true when X" and let the runtime handle orchestration.

### Constraints Replace Event Handlers

```typescript
// Directive approach - declare the rule, not the steps
constraints: {
  needsUser: {
    // "When we have a userId but no user data, we need to fetch one"
    when: (facts) => facts.userId > 0 && !facts.user,
    require: { type: "FETCH_USER" },
  },
}
```

The constraint says: "When we have a userId but no user, we need to fetch one." Directive ensures this is always true.

### Resolvers Handle Fulfillment

```typescript
resolvers: {
  fetchUser: {
    // Match this resolver to FETCH_USER requirements
    requirement: "FETCH_USER",

    // Retry logic is declarative – no boilerplate needed
    retry: { attempts: 3, backoff: "exponential" },

    // The resolver only runs when its requirement is active
    resolve: async (req, context) => {
      context.facts.user = await api.getUser(context.facts.userId);
    },
  },
}
```

Retry logic is declarative. The resolver only runs when its requirement is active. No race conditions.

### Derivations Are Automatic

```typescript
derive: {
  // No dependency arrays needed – Directive tracks access automatically
  displayName: (facts) => facts.user?.name ?? "Guest",

  // Recomputes only when facts.user changes
  isLoggedIn: (facts) => facts.user !== null,
}
```

Derivations automatically track which facts they depend on. No stale closures, no missed updates.

---

## What Directive Solves

| Problem | Traditional | Directive |
|---------|-------------|-----------|
| Race conditions | Manual cancellation | Automatic deduplication |
| Retry logic | Copy-paste boilerplate | Declarative config |
| Dependency tracking | Manual arrays | Automatic |
| State consistency | Hope and prayer | Constraint enforcement |
| Debugging | Console.log | Time-travel + snapshots |
| Testing | Mock everything | Declarative assertions |

---

## When to Use Directive

Directive excels when:

- **Complex async flows** - Multiple dependent API calls, loading states, error handling
- **Business rules** - "User must have profile before they can post"
- **AI agents** - Orchestrating LLM calls with guardrails and approval flows
- **Multi-module apps** - Features that need to coordinate state

Directive might be overkill for:

- Simple forms with no async
- Static content sites
- Apps where React Query/SWR already solves your problems

---

## Next Steps

- **[Quick Start](/docs/quick-start)** - Build your first module
- **[Core Concepts](/docs/core-concepts)** - Understand the mental model
- **[Comparison](/docs/comparison)** - See how Directive compares to alternatives
