---
title: Resolvers
description: Resolvers fulfill requirements raised by constraints. They handle async operations, retries, timeouts, cancellation, and batching.
---

Resolvers do the actual work – they fulfill requirements raised by constraints. {% .lead %}

---

## Basic Resolvers

Define resolvers in your module to handle requirements:

```typescript
const userModule = createModule("user", {
  schema: {
    facts: {
      userId: t.number(),
      user: t.object<User>().nullable(),
      loading: t.boolean(),
      error: t.string().nullable(),
    },
    requirements: {
      // Define the shape of requirements this module can raise
      FETCH_USER: { userId: t.number() },
    },
  },

  resolvers: {
    fetchUser: {
      requirement: "FETCH_USER",
      resolve: async (req, context) => {
        // Signal loading state
        context.facts.loading = true;

        try {
          // Fetch the user using the requirement payload
          context.facts.user = await api.getUser(req.userId);
          context.facts.error = null;
        } catch (error) {
          context.facts.error = error.message;
        } finally {
          context.facts.loading = false;
        }
      },
    },
  },
});
```

---

## Resolver Anatomy

| Property | Type | Description |
|----------|------|-------------|
| `requirement` | `string \| (req) => req is R` | Which requirements this resolver handles |
| `resolve` | `(req, context) => Promise<void>` | Handler for single requirements |
| `key` | `(req) => string` | Custom deduplication key |
| `retry` | `RetryPolicy` | Retry configuration |
| `timeout` | `number` | Timeout in ms for resolver execution |
| `batch` | `BatchConfig` | Batching configuration |
| `resolveBatch` | `(reqs, context) => Promise<void>` | All-or-nothing batch handler |
| `resolveBatchWithResults` | `(reqs, context) => Promise<BatchItemResult[]>` | Per-item batch handler |

The `req` parameter (short for **requirement**) is the object emitted by a constraint's `require()`. It always has a `type` string and any additional payload fields:

```typescript
// Constraint emits:
require: (facts) => ({ type: "FETCH_USER", userId: facts.selectedId })

// Resolver receives the same object as `req`:
resolve: async (req, context) => {
  const user = await api.getUser(req.userId);
  context.facts.user = user;
},
```

---

## Requirement Matching

The `requirement` field accepts a string or a function:

```typescript
resolvers: {
  // String match – handles exactly "FETCH_USER" requirements
  fetchUser: {
    requirement: "FETCH_USER",
    resolve: async (req, context) => { /* ... */ },
  },

  // Prefix match – handles any requirement starting with "API_"
  apiHandler: {
    requirement: (req): req is Requirement => req.type.startsWith("API_"),
    resolve: async (req, context) => { /* ... */ },
  },

  // Payload match – only handles high-priority FETCH requirements
  highPriorityFetch: {
    requirement: (req): req is Requirement =>
      req.type === "FETCH" && req.priority === "high",
    resolve: async (req, context) => { /* ... */ },
  },

  // Catch-all – logs unhandled requirements (place last)
  fallback: {
    requirement: (req): req is Requirement => true,
    resolve: async (req, context) => {
      console.warn(`Unhandled requirement: ${req.type}`);
    },
  },
},
```

Resolvers are checked in definition order. The first matching resolver wins, so place specific matchers before wildcards.

---

## Resolver Context

The context object provides:

```typescript
resolve: async (req, context) => {
  // Read and write facts (mutations are auto-batched)
  context.facts;

  // Pass to fetch() or check for cancellation
  context.signal;

  // Get a read-only snapshot of current facts
  context.snapshot();
}
```

Fact mutations inside `resolve` are automatically batched – all synchronous writes are coalesced into a single notification.

---

## Retry Policies

Configure automatic retries for transient failures:

```typescript
resolvers: {
  fetchData: {
    requirement: "FETCH_DATA",

    // Retry up to 3 times with exponential backoff
    retry: {
      attempts: 3,
      backoff: "exponential",
      initialDelay: 100,
      maxDelay: 5000,
    },

    resolve: async (req, context) => {
      context.facts.data = await api.getData(req.id);
    },
  },
}
```

```
    Attempt 1    wait 100ms   Attempt 2    wait 200ms   Attempt 3
    ─────────── ─ ─ ─ ─ ─── ─────────── ─ ─ ─ ─ ─── ───────────
       ✗ fail                   ✗ fail                   ✓ success
```

### Retry Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `attempts` | `number` | `1` | Maximum number of attempts |
| `backoff` | `"none" \| "linear" \| "exponential"` | `"none"` | Delay growth strategy |
| `initialDelay` | `number` | `100` | First retry delay in ms |
| `maxDelay` | `number` | `30000` | Maximum delay between retries |
| `shouldRetry` | `(error, attempt) => boolean` | – | Predicate to control whether to retry |

### Conditional Retries

Use `shouldRetry` to only retry specific errors. Return `true` to retry, `false` to stop immediately:

```typescript
resolvers: {
  fetchData: {
    requirement: "FETCH_DATA",
    retry: {
      attempts: 5,
      backoff: "exponential",
      initialDelay: 200,

      // Only retry server errors, not client errors
      shouldRetry: (error, attempt) => {
        if (error.message.includes("404") || error.message.includes("403")) {
          return false;  // Don't retry – client error
        }
        return true;  // Retry server errors and network failures
      },
    },

    resolve: async (req, context) => {
      context.facts.data = await api.getData(req.id);
    },
  },
}
```

If `shouldRetry` is omitted, all errors are retried up to `attempts`.

### Backoff Calculation

- `"none"` – constant delay (`initialDelay` every time)
- `"linear"` – `initialDelay * attempt` (100ms, 200ms, 300ms...)
- `"exponential"` – `initialDelay * 2^(attempt-1)` (100ms, 200ms, 400ms...)

For autocomplete-friendly configuration, use the `Backoff` constant:

```typescript
import { Backoff } from '@directive-run/core';

retry: {
  attempts: 3,
  backoff: Backoff.Exponential, // "none" | "linear" | "exponential"
  initialDelay: 200,
},
```

Retries are AbortSignal-aware – cancelling a resolver immediately interrupts retry sleep.

---

## Timeout Handling

Set timeouts to prevent hanging operations:

```typescript
resolvers: {
  fetchData: {
    requirement: "FETCH_DATA",
    timeout: 10000, // Abort after 10 seconds

    resolve: async (req, context) => {
      context.facts.data = await api.getData(req.id);
    },
  },
}
```

When a resolver times out, it throws an error. If retry is configured, the next attempt begins after the backoff delay.

---

## Custom Identity Keys

Control requirement deduplication with custom keys:

```typescript
resolvers: {
  fetchUser: {
    requirement: "FETCH_USER",

    // Deduplicate by userId – prevents parallel requests for the same user
    key: (req) => `fetch-user-${req.userId}`,

    resolve: async (req, context) => {
      context.facts.user = await api.getUser(req.userId);
    },
  },
}
```

### Key Strategies

```typescript
// Default – uses constraintName:type
key: undefined

// Entity-based – one active request per entity
key: (req) => `user-${req.userId}`

// Time-based – allows refresh every minute
key: (req) => `data-${req.id}-${Math.floor(Date.now() / 60000)}`

// Session-based – one request per session
key: (req) => `${req.type}-${sessionId}`
```

---

## Cancellation

Resolvers receive an `AbortSignal` via `context.signal`. Pass it to fetch calls or check it in long-running operations:

```typescript
resolvers: {
  search: {
    requirement: "SEARCH",
    resolve: async (req, context) => {
      // Pass the AbortSignal to fetch for automatic cancellation
      const results = await fetch(`/api/search?q=${req.query}`, {
        signal: context.signal,
      });

      // Guard against processing stale results
      if (context.signal.aborted) {
        return;
      }

      context.facts.searchResults = await results.json();
    },
  },
}
```

When a constraint's `when()` becomes false while its resolver is running, the resolver is cancelled via the AbortSignal.

---

## Batched Resolution

```
    Without Batching               With Batching
    ────────────────               ─────────────
    fetch(1) ──► response          id:1 ─┐
    fetch(2) ──► response          id:2 ─┼──► fetchBatch([1,2,3])
    fetch(3) ──► response          id:3 ─┘
       3 requests                     1 request
```

Prevent N+1 problems by collecting requirements that match the same resolver over a time window, then resolving them in a single call:

```typescript
resolvers: {
  fetchUsers: {
    requirement: "FETCH_USER",
    batch: {
      enabled: true,
      windowMs: 50,       // Collect requirements for 50ms
      maxSize: 100,       // Process up to 100 at a time
      timeoutMs: 10000,   // Per-batch timeout
    },

    // All-or-nothing: if this throws, all requirements in the batch fail
    resolveBatch: async (reqs, context) => {
      // Collect all userIds and fetch in one API call
      const ids = reqs.map(r => r.userId);
      const users = await api.getUsersBatch(ids);
      users.forEach(user => { context.facts[`user_${user.id}`] = user; });
    },
  },
}
```

### Batch Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Enable batching for this resolver |
| `windowMs` | `number` | `50` | Time window to collect requirements (ms) |
| `maxSize` | `number` | unlimited | Maximum batch size. Flushes immediately when reached. |
| `timeoutMs` | `number` | – | Per-batch timeout (overrides resolver `timeout`) |

### Partial Failure Handling

For cases where some items in a batch may fail while others succeed, use `resolveBatchWithResults`:

```typescript
resolvers: {
  fetchUsers: {
    requirement: "FETCH_USER",
    batch: { enabled: true, windowMs: 50 },

    // Per-item results: some can succeed while others fail
    resolveBatchWithResults: async (reqs, context) => {
      return Promise.all(reqs.map(async (req) => {
        try {
          const user = await api.getUser(req.userId);
          context.facts[`user_${user.id}`] = user;

          return { success: true };
        } catch (error) {
          // Individual failures don't affect other items
          return { success: false, error };
        }
      }));
    },
  },
}
```

The returned results array **must** match the order of the input requirements.

### Batch with resolve() Fallback

You can enable batching with just `resolve()` (no `resolveBatch`). The system falls back to calling `resolve()` individually for each batched requirement. This gives you windowing and deduplication without writing a bulk handler:

```typescript
resolvers: {
  fetchUser: {
    requirement: "FETCH_USER",
    batch: {
      enabled: true,
      windowMs: 50,
    },

    // Individual resolve — called once per batched requirement
    resolve: async (req, context) => {
      context.facts.user = await api.getUser(req.userId);
    },
  },
}
```

When to upgrade to `resolveBatch`:
- You have a bulk API (e.g., `GET /users?ids=1,2,3`)
- You want a single SQL query with `WHERE id IN (...)`
- Network round-trips are the bottleneck

---

## Sequential vs Parallel

By default, resolvers run in parallel. Use `after` on constraints for ordering:

```typescript
constraints: {
  // Step 1: Authenticate (high priority)
  authenticate: {
    priority: 100,
    when: (facts) => !facts.token,
    require: { type: "AUTH" },
  },

  // Step 2: Fetch data after auth completes
  fetchData: {
    priority: 50,
    after: ["authenticate"],
    when: (facts) => facts.token && !facts.data,
    require: { type: "FETCH_DATA" },
  },
}

resolvers: {
  auth: {
    requirement: "AUTH",
    resolve: async (req, context) => {
      context.facts.token = await getToken();
    },
  },

  fetchData: {
    requirement: "FETCH_DATA",
    resolve: async (req, context) => {
      // Runs after auth – token is guaranteed to exist
      context.facts.data = await api.getData(context.facts.token);
    },
  },
}
```

---

## Optimistic Updates

Update facts optimistically, rollback on failure:

```typescript
resolvers: {
  updateTodo: {
    requirement: "UPDATE_TODO",
    resolve: async (req, context) => {
      // Save a snapshot for rollback
      const snapshot = context.snapshot();
      const original = snapshot.todos.find((t) => t.id === req.id);

      // Apply the update optimistically (UI reflects immediately)
      context.facts.todos = context.facts.todos.map((t) =>
        t.id === req.id ? { ...t, ...req.updates } : t
      );

      try {
        // Persist to the server
        await api.updateTodo(req.id, req.updates);
      } catch (error) {
        // Rollback to the original value on failure
        context.facts.todos = context.facts.todos.map((t) =>
          t.id === req.id ? original : t
        );
        context.facts.error = "Failed to update todo";
      }
    },
  },
}
```

---

## Testing Resolvers

Mock resolvers in tests:

```typescript
import { createTestSystem, flushMicrotasks } from "@directive-run/core/testing";

test("fetches user data", async () => {
  // Create a test system with a mocked resolver
  const system = createTestSystem({
    modules: { user: userModule },
    mocks: {
      resolvers: {
        FETCH_USER: {
          resolve: (req, ctx) => {
            ctx.facts.user = { id: req.userId, name: "Test User" };
          },
        },
      },
    },
  });

  system.start();

  // Trigger the constraint by setting userId
  system.facts.user.userId = 123;
  await system.settle();

  // Verify the resolver populated the fact
  expect(system.facts.user.user?.name).toBe("Test User");
});
```

---

## Best Practices

### Always Set Loading States

```typescript
resolve: async (req, context) => {
  context.facts.loading = true;
  try {
    context.facts.data = await api.getData(req.id);
  } finally {
    context.facts.loading = false;
  }
}
```

### Handle All Error Cases

```typescript
resolve: async (req, context) => {
  try {
    context.facts.data = await api.getData(req.id);
    context.facts.error = null;
  } catch (error) {
    context.facts.error = error.message;
    context.facts.data = null;
  }
}
```

### Use Clear Requirement Names

```typescript
// Good - clear intent
"FETCH_USER"
"CREATE_ORDER"
"VALIDATE_PAYMENT"

// Avoid - vague
"DO_THING"
"PROCESS"
"HANDLE"
```

---

## Next Steps

- [Constraints](/docs/constraints) – Raising requirements
- [Effects](/docs/effects) – Side effects
- [Error Handling](/docs/advanced/errors) – Comprehensive error strategies
