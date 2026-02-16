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
      if (i === attempts - 1) {
        throw e;
      }

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

## Design Principles

### Constraints Over Actions

Most state management is built around actions – named events that trigger state transitions. Directive starts from a different premise: **model the rules, not the steps.**

A constraint says "when this condition holds, this requirement must be fulfilled." It doesn't care *when* or *how* the condition became true. Adding a new rule doesn't require tracing every code path that might trigger it. You add the constraint, and it activates whenever its condition is met.

### The Runtime Knows More Than You

When you declare a constraint and a resolver, you're expressing intent: "this must be true" and "here's how to make it true." The runtime handles the rest – when to execute, how to deduplicate concurrent requests, when to retry, and how to sequence dependent operations. This puts orchestration logic where it belongs: in a system designed to handle it consistently.

### State as Ground Truth

In Directive, facts are the single source of truth. Derivations recompute when dependencies change. Constraints evaluate against facts. Requirements are transient – they exist only as long as a constraint is active and unfulfilled. There's no separate "action log" to reconcile with actual state.

### Separation of Detection and Execution

Constraints detect what's needed. Resolvers handle how to fulfill it. You can swap a resolver's implementation without touching constraints, add new constraints that reuse existing resolvers, and test detection logic independently from execution logic.

### Resilience by Default

Retry policies are declared on resolvers, not implemented ad-hoc. Timeouts prevent resolvers from hanging indefinitely. Error boundaries catch failures and provide configurable recovery. When resilience is declarative and built into the resolution layer, every resolver gets the same quality of error handling.

### Inspectability Over Magic

Every decision the runtime makes is observable. `inspect()` shows current facts, active constraints, pending requirements, and running resolvers. `explain()` traces why a particular requirement was generated. Time-travel lets you step through state changes. Automatic doesn't mean opaque.

---

## Next Steps

- **[Quick Start](/docs/quick-start)** - Build your first module
- **[Core Concepts](/docs/core-concepts)** - Understand the mental model
- **[Comparison](/docs/comparison)** - See how Directive compares to alternatives
