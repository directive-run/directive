---
title: Resolvers
description: Resolvers fulfill requirements raised by constraints. They handle async operations, retries, timeouts, cancellation, and batching.
---

Resolvers do the actual work — they fulfill requirements raised by constraints. {% .lead %}

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
      FETCH_USER: { userId: t.number() },
    },
  },

  resolvers: {
    fetchUser: {
      requirement: "FETCH_USER",
      resolve: async (req, context) => {
        context.facts.loading = true;
        try {
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

---

## Requirement Matching

The `requirement` field accepts a string or a function:

```typescript
resolvers: {
  // String: exact match on req.type (most common)
  fetchUser: {
    requirement: "FETCH_USER",
    resolve: async (req, context) => { /* ... */ },
  },

  // Function: prefix match — handles any "API_*" requirement
  apiHandler: {
    requirement: (req): req is Requirement => req.type.startsWith("API_"),
    resolve: async (req, context) => { /* ... */ },
  },

  // Function: match on payload fields
  highPriorityFetch: {
    requirement: (req): req is Requirement =>
      req.type === "FETCH" && req.priority === "high",
    resolve: async (req, context) => { /* ... */ },
  },

  // Function: catch-all wildcard
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
  context.facts;        // Read/write facts (mutations are auto-batched)
  context.signal;       // AbortSignal — check context.signal.aborted or pass to fetch()
  context.snapshot();   // Get a read-only snapshot of current facts
}
```

Fact mutations inside `resolve` are automatically batched — all synchronous writes are coalesced into a single notification.

---

## Retry Policies

Configure automatic retries for transient failures:

```typescript
resolvers: {
  fetchData: {
    requirement: "FETCH_DATA",
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

### Retry Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `attempts` | `number` | `1` | Maximum number of attempts |
| `backoff` | `"none" \| "linear" \| "exponential"` | `"none"` | Delay growth strategy |
| `initialDelay` | `number` | `100` | First retry delay in ms |
| `maxDelay` | `number` | `30000` | Maximum delay between retries |
| `shouldRetry` | `(error, attempt) => boolean` | — | Predicate to control whether to retry |

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
      shouldRetry: (error, attempt) => {
        // Don't retry client errors (4xx)
        if (error.message.includes("404") || error.message.includes("403")) {
          return false;
        }
        // Retry server errors (5xx) and network failures
        return true;
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

- `"none"` — constant delay (`initialDelay` every time)
- `"linear"` — `initialDelay * attempt` (100ms, 200ms, 300ms...)
- `"exponential"` — `initialDelay * 2^(attempt-1)` (100ms, 200ms, 400ms...)

Retries are AbortSignal-aware — cancelling a resolver immediately interrupts retry sleep.

---

## Timeout Handling

Set timeouts to prevent hanging operations:

```typescript
resolvers: {
  fetchData: {
    requirement: "FETCH_DATA",
    timeout: 10000, // 10 seconds
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
    // Custom key prevents duplicate requests for same user
    key: (req) => `fetch-user-${req.userId}`,
    resolve: async (req, context) => {
      context.facts.user = await api.getUser(req.userId);
    },
  },
}
```

### Key Strategies

```typescript
// Default - uses constraintName:type
key: undefined

// Entity-based - one request per entity
key: (req) => `user-${req.userId}`

// Time-based - refresh every minute
key: (req) => `data-${req.id}-${Math.floor(Date.now() / 60000)}`

// Session-based - one per session
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
      const results = await fetch(`/api/search?q=${req.query}`, {
        signal: context.signal, // Automatically cancelled if requirement no longer needed
      });

      if (context.signal.aborted) return;

      context.facts.searchResults = await results.json();
    },
  },
}
```

When a constraint's `when()` becomes false while its resolver is running, the resolver is cancelled via the AbortSignal.

---

## Batched Resolution

Prevent N+1 problems by collecting requirements that match the same resolver over a time window, then resolving them in a single call:

```typescript
resolvers: {
  fetchUsers: {
    requirement: "FETCH_USER",
    batch: {
      enabled: true,
      windowMs: 50,       // Collect for 50ms before processing
      maxSize: 100,       // Max batch size (default: unlimited)
      timeoutMs: 10000,   // Per-batch timeout (overrides resolver timeout)
    },
    // All-or-nothing: if this throws, all requirements in the batch fail
    resolveBatch: async (reqs, context) => {
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
| `maxSize` | `number` | unlimited | Maximum batch size |
| `timeoutMs` | `number` | — | Per-batch timeout (overrides resolver `timeout`) |

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
          return { success: false, error };
        }
      }));
    },
  },
}
```

The returned results array **must** match the order of the input requirements.

---

## Sequential vs Parallel

By default, resolvers run in parallel. Use `after` on constraints for ordering:

```typescript
constraints: {
  authenticate: {
    priority: 100,
    when: (facts) => !facts.token,
    require: { type: "AUTH" },
  },
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
      // This runs after auth completes
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
      const snapshot = context.snapshot();
      const original = snapshot.todos.find((t) => t.id === req.id);

      // Optimistic update
      context.facts.todos = context.facts.todos.map((t) =>
        t.id === req.id ? { ...t, ...req.updates } : t
      );

      try {
        await api.updateTodo(req.id, req.updates);
      } catch (error) {
        // Rollback on failure
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
import { createTestSystem, mockResolver } from "directive/testing";

test("fetches user data", async () => {
  const system = createTestSystem({
    module: userModule,
    mocks: {
      fetchUser: mockResolver((req) => ({
        id: req.userId,
        name: "Test User",
      })),
    },
  });

  system.facts.userId = 123;
  await system.settle();

  expect(system.facts.user.name).toBe("Test User");
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

- See [Constraints](/docs/constraints) for raising requirements
- See [Effects](/docs/effects) for side effects
- See [Error Handling](/docs/advanced/errors) for comprehensive error strategies
