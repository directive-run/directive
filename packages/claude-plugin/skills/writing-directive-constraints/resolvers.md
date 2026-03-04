# Resolvers

Resolvers fulfill requirements emitted by constraints. They are the supply side of the constraint-resolver pattern. Resolvers handle async work and mutate state through `context.facts`.

## Decision Tree: "How should this resolver work?"

```
Is the work async (API calls, timers)?
├── Yes → Use resolve: async (req, context) => { ... }
│
│   Does it fail often?
│   ├── Yes → Add retry: { attempts: 3, backoff: "exponential" }
│   └── No  → No retry needed
│
│   Are there many similar requirements at once?
│   ├── Yes → Add batch config to group them
│   └── No  → Single resolve is fine
│
└── No → Reconsider — maybe this is an event handler or derivation
```

## Basic Resolver

```typescript
resolvers: {
  fetchUser: {
    // Which requirement type this resolver handles
    requirement: "FETCH_USER",

    // Async function — req is the requirement, context has facts + signal
    resolve: async (req, context) => {
      const res = await fetch(`/api/users/${req.userId}`);
      const user = await res.json();

      // Mutate facts to store results — resolvers return void
      context.facts.user = user;
      context.facts.phase = "loaded";
    },
  },
},
```

## Resolver Context

The `context` object provides:

```typescript
resolve: async (req, context) => {
  // context.facts — mutable proxy to the module's facts
  context.facts.status = "loading";

  // context.signal — AbortSignal, cancelled when system stops or requirement removed
  const res = await fetch("/api/data", { signal: context.signal });

  // context.snapshot() — read-only snapshot for before/after comparisons
  const before = context.snapshot();
  context.facts.count += 1;
  const after = context.snapshot();
  console.log(`Count: ${before.count} -> ${after.count}`);
},
```

## Custom Deduplication Keys

By default, requirements are deduped by their full content. Use `key` for custom deduplication:

```typescript
resolvers: {
  fetchUser: {
    requirement: "FETCH_USER",

    // Custom key — only one inflight resolver per userId
    key: (req) => `fetch-user-${req.userId}`,

    resolve: async (req, context) => {
      const user = await fetchUser(req.userId);
      context.facts.user = user;
    },
  },
},
```

Without `key`, two requirements `{ type: "FETCH_USER", userId: "1" }` are deduped because they are structurally identical. With `key`, you control exactly what counts as a duplicate.

## Retry Policies

```typescript
resolvers: {
  fetchData: {
    requirement: "FETCH_DATA",

    retry: {
      // Maximum number of attempts (including the first)
      attempts: 3,

      // Backoff strategy between retries
      backoff: "exponential", // "none" | "linear" | "exponential"

      // Initial delay in ms (default: 100)
      initialDelay: 200,

      // Maximum delay in ms (caps exponential growth)
      maxDelay: 5000,

      // Optional: only retry certain errors
      shouldRetry: (error, attempt) => {
        // Don't retry 4xx client errors
        if (error.message.includes("404")) {
          return false;
        }

        return true;
      },
    },

    resolve: async (req, context) => {
      const res = await fetch("/api/data");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      context.facts.data = await res.json();
    },
  },
},
```

### Backoff Strategies

| Strategy | Delay Pattern |
|---|---|
| `"none"` | No delay between retries |
| `"linear"` | initialDelay, 2x, 3x, ... |
| `"exponential"` | initialDelay, 2x, 4x, 8x, ... (capped by maxDelay) |

## Batch Resolution

Group similar requirements and resolve them together. Prevents N+1 problems.

### All-or-Nothing Batch

```typescript
resolvers: {
  fetchUsers: {
    requirement: "FETCH_USER",

    batch: {
      enabled: true,
      windowMs: 50,   // Collect requirements for 50ms
      maxSize: 20,    // Flush immediately at 20 items
    },

    // resolveBatch receives all collected requirements
    resolveBatch: async (reqs, context) => {
      const ids = reqs.map((req) => req.userId);
      const users = await fetchUsersBatch(ids);

      // Store results
      context.facts.users = users;
    },
  },
},
```

### Batch with Per-Item Results

For partial success/failure handling:

```typescript
resolvers: {
  fetchUsers: {
    requirement: "FETCH_USER",

    batch: {
      enabled: true,
      windowMs: 50,
      maxSize: 20,
      timeoutMs: 10000, // Per-batch timeout
    },

    // Return results array matching input order
    resolveBatchWithResults: async (reqs, context) => {
      const results = await Promise.all(
        reqs.map(async (req) => {
          try {
            const user = await fetchUser(req.userId);
            context.facts.users = {
              ...context.facts.users,
              [req.userId]: user,
            };

            return { success: true };
          } catch (error) {
            return { success: false, error: error as Error };
          }
        }),
      );

      return results;
    },
  },
},
```

Failed items from `resolveBatchWithResults` can be individually retried if a retry policy is configured.

## Timeout

```typescript
resolvers: {
  fetchData: {
    requirement: "FETCH_DATA",
    timeout: 10000, // Abort after 10 seconds

    resolve: async (req, context) => {
      // context.signal is automatically aborted on timeout
      const res = await fetch("/api/data", { signal: context.signal });
      context.facts.data = await res.json();
    },
  },
},
```

## Waiting for Resolution

```typescript
const system = createSystem({ module: myModule });
system.start();

// Wait for all resolvers to complete
await system.settle();

// Wait with timeout
await system.settle(5000); // Throws if not settled in 5s

// Check settlement state
system.isSettled; // boolean

// Subscribe to settlement changes
const unsub = system.onSettledChange(() => {
  console.log("Settlement state:", system.isSettled);
});
```

## Inspecting Resolver Status

```typescript
const inspection = system.inspect();

// All resolver definitions
inspection.resolverDefs;
// [{ id: "fetchUser", requirement: "FETCH_USER" }, ...]

// Current resolver statuses
inspection.resolvers;
// { fetchUser: { state: "success", completedAt: ..., duration: 150 } }

// Inflight resolvers
inspection.inflight;
// [{ id: "req-1", resolverId: "fetchData", startedAt: 1709000000 }]

// Unmet requirements (no resolver matched)
inspection.unmet;

// Explain why a specific requirement exists
const explanation = system.explain("req-123");
```

## Common Mistakes

### Returning data from resolve

```typescript
// WRONG — return value is ignored
resolve: async (req, context) => {
  const user = await fetchUser(req.userId);

  return user; // Ignored!
},

// CORRECT — mutate context.facts
resolve: async (req, context) => {
  const user = await fetchUser(req.userId);
  context.facts.user = user;
},
```

### Abbreviating context to ctx

```typescript
// WRONG
resolve: async (req, ctx) => { /* ... */ },

// CORRECT
resolve: async (req, context) => { /* ... */ },
```

### Checking conditions in resolve (constraint's job)

```typescript
// WRONG — condition checking belongs in constraint's when()
resolve: async (req, context) => {
  if (!context.facts.isAuthenticated) {
    return;
  }
  // ...
},

// CORRECT — let constraints handle conditions
// The resolver only runs when a requirement is emitted
resolve: async (req, context) => {
  const data = await fetch("/api/data");
  context.facts.data = await data.json();
},
```

### Forgetting error handling

```typescript
// WRONG — unhandled errors with no recovery
resolvers: {
  fetch: {
    requirement: "FETCH",
    resolve: async (req, context) => {
      const res = await fetch("/api");
      context.facts.data = await res.json();
    },
  },
},

// CORRECT — retry policy + error handling
resolvers: {
  fetch: {
    requirement: "FETCH",
    retry: { attempts: 3, backoff: "exponential" },
    resolve: async (req, context) => {
      const res = await fetch("/api");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      context.facts.data = await res.json();
    },
  },
},
```

### Missing settle() after start()

```typescript
// WRONG — reading facts before resolvers finish
system.start();
console.log(system.facts.data); // Likely null

// CORRECT
system.start();
await system.settle();
console.log(system.facts.data); // Resolved value
```
