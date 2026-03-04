---
name: writing-directive-constraints
description: "Write Directive constraints, resolvers, and error boundaries: when/require patterns, static vs dynamic requirements, async constraints with explicit deps, priority and ordering, resolver retry policies, deduplication keys, batch resolution, and system error boundaries. Use when asked to add constraint-resolver pairs, handle errors/retries in resolvers, or configure recovery strategies."
---

# Writing Directive Constraints

## When Claude Should Use This Skill

**Auto-invoke when the user:**
- Says "add a constraint", "write a resolver", "handle errors in the resolver", or "add retry"
- Asks "when X happens, do Y" where Y is async work
- Shows existing constraints/resolvers and asks to extend or fix them
- Asks about error handling, recovery strategies, circuit breakers, or retry policies
- Asks about requirement deduplication, batching, or ordering

**Do NOT invoke when:**
- Scaffolding an entire module from scratch (start with `writing-directive-modules.md`)
- Composing multiple modules (see `building-directive-systems.md`)
- Writing tests (see `testing-directive-code.md`)

---

## The Core Mental Model

```
Constraint declares WHEN something is needed  →  emits a requirement
Resolver fulfills WHAT to do about it          →  mutates facts
```

Never put condition checks in a resolver. Never do async work in a constraint's `when()`.

---

## Decision Tree: Constraint or Something Else?

```
Is this "when X is true, the system needs Y"?
├── Yes, and Y is async/side-effectful  → Constraint + Resolver
├── Yes, but Y is just a derived value  → Use derive instead
├── No, it reacts to a change that happened → Use effect
└── No, it's user-initiated             → Use event handler
```

---

## Constraint Anatomy

### Static vs dynamic requirements

```typescript
constraints: {
  // Static — same object every time
  loadConfig: {
    when: (facts) => facts.config === null,
    require: { type: "LOAD_CONFIG" },
  },

  // Dynamic — function reads facts
  fetchUser: {
    when: (facts) => facts.isAuthenticated && !facts.profile,
    require: (facts) => ({ type: "FETCH_USER", userId: facts.userId }),
  },

  // Multiple requirements at once
  loadAll: {
    when: (facts) => facts.phase === "init",
    require: [
      { type: "LOAD_CONFIG" },
      { type: "LOAD_USER" },
    ],
  },

  // Suppress conditionally — return null from require
  conditionalFetch: {
    when: (facts) => facts.needsUpdate,
    require: (facts) => {
      if (!facts.userId) {
        return null;
      }

      return { type: "FETCH_USER", userId: facts.userId };
    },
  },
},
```

### Priority — conflict resolution

```typescript
constraints: {
  normalTransition: {
    priority: 50,          // Default is 0; higher runs first
    when: (facts) => facts.phase === "red" && facts.elapsed > 30,
    require: { type: "TRANSITION", to: "green" },
  },

  emergencyOverride: {
    priority: 100,         // Evaluated before normalTransition
    when: (facts) => facts.emergencyActive,
    require: { type: "TRANSITION", to: "red" },
  },
},
```

### Ordering with `after` — sequencing constraints

```typescript
constraints: {
  authenticate: {
    when: (facts) => !facts.token,
    require: { type: "AUTHENTICATE" },
  },

  // Only evaluates after authenticate's resolver completes
  loadProfile: {
    after: ["authenticate"],
    when: (facts) => facts.token && !facts.profile,
    require: { type: "LOAD_PROFILE" },
  },
},
```

`after` blocks evaluation entirely until the named constraint's resolver finishes. If the dependency's `when()` returns false, the blocked constraint proceeds normally.

### Async constraints — MUST declare `deps`

Synchronous constraints auto-track deps via proxy. Async constraints cannot (suspended across await), so you must declare `deps` explicitly.

```typescript
constraints: {
  validateToken: {
    async: true,
    deps: ["token"],          // Re-evaluate when token changes
    when: async (facts) => {
      const valid = await validateTokenRemotely(facts.token);

      return valid;
    },
    require: { type: "REFRESH_TOKEN" },
    timeout: 5000,            // Optional: abort if check takes too long
  },
},
```

### Disabling constraints at runtime

```typescript
system.constraints.disable("fetchWhenReady");
system.constraints.isDisabled("fetchWhenReady"); // true
system.constraints.enable("fetchWhenReady");
```

---

## Resolver Anatomy

### Basic resolver

```typescript
resolvers: {
  fetchUser: {
    requirement: "FETCH_USER",
    resolve: async (req, context) => {
      // req — the requirement object emitted by the constraint
      // context.facts — mutable proxy to module facts
      // context.signal — AbortSignal (cancelled on stop or timeout)
      // context.snapshot() — read-only snapshot for before/after
      const user = await fetch(`/api/users/${req.userId}`, {
        signal: context.signal,
      }).then((r) => r.json());
      context.facts.user = user;
      context.facts.phase = "loaded";
    },
  },
},
```

### Custom deduplication key

Without `key`, requirements are deduped by structural equality. With `key`, you control dedup:

```typescript
resolvers: {
  fetchUser: {
    requirement: "FETCH_USER",
    key: (req) => `fetch-user-${req.userId}`, // One inflight per userId
    resolve: async (req, context) => {
      context.facts.user = await fetchUser(req.userId);
    },
  },
},
```

### Retry policy

```typescript
resolvers: {
  fetchData: {
    requirement: "FETCH_DATA",
    retry: {
      attempts: 3,
      backoff: "exponential",   // "none" | "linear" | "exponential"
      initialDelay: 200,
      maxDelay: 5000,
      shouldRetry: (error, attempt) => {
        if (error.message.includes("404")) {
          return false;          // Don't retry permanent failures
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

### Batch resolution — prevent N+1

```typescript
resolvers: {
  fetchUsers: {
    requirement: "FETCH_USER",
    batch: {
      enabled: true,
      windowMs: 50,     // Collect requirements for 50ms
      maxSize: 20,      // Flush immediately at 20 items
    },
    resolveBatch: async (reqs, context) => {
      const ids = reqs.map((req) => req.userId);
      context.facts.users = await fetchUsersBatch(ids);
    },
  },
},
```

For per-item success/failure, use `resolveBatchWithResults` and return a results array matching input order.

### Timeout

```typescript
resolvers: {
  fetchData: {
    requirement: "FETCH_DATA",
    timeout: 10000,   // context.signal aborted after 10s
    resolve: async (req, context) => {
      const res = await fetch("/api/data", { signal: context.signal });
      context.facts.data = await res.json();
    },
  },
},
```

---

## Error Boundaries

### System-level error boundary

```typescript
const system = createSystem({
  module: myModule,
  errorBoundary: {
    onConstraintError: "skip",
    onResolverError: "retry-later",
    onEffectError: "skip",
    onDerivationError: "throw",   // Derivation errors are bugs — throw always
    onError: (error) => {
      console.error(`[${error.source}] ${error.sourceId}: ${error.message}`);
    },
    retryLater: {
      delayMs: 1000,
      maxRetries: 3,
      backoffMultiplier: 2,
      maxDelayMs: 30000,
    },
  },
});
```

Recovery strategies:

| Strategy | Behavior |
|----------|----------|
| `"skip"` | Swallow the error, continue |
| `"retry"` | Retry immediately |
| `"retry-later"` | Retry after exponential backoff delay |
| `"disable"` | Disable the failing constraint/effect permanently |
| `"throw"` | Re-throw, halting the system |

### Dynamic recovery with functions

```typescript
errorBoundary: {
  onResolverError: (error, resolverId) => {
    if (error.message.includes("NetworkError")) {
      return "retry-later";
    }

    if (error.message.includes("401")) {
      return "skip";
    }

    return "throw";
  },
},
```

### DirectiveError properties

```typescript
import { DirectiveError } from "@directive-run/core";

try {
  await system.settle();
} catch (err) {
  if (err instanceof DirectiveError) {
    err.source;      // "constraint" | "resolver" | "effect" | "derivation" | "system"
    err.sourceId;    // e.g., "fetchUser"
    err.recoverable; // boolean
    err.context;     // debug data (e.g., the requirement object)
  }
}
```

### Module-level lifecycle hooks

```typescript
hooks: {
  onInit: (system) => { ... },
  onStart: (system) => { ... },
  onStop: (system) => { ... },
  onError: (error, hookContext) => { ... },
},
```

### Circuit breaker

```typescript
import { createCircuitBreaker } from "@directive-run/core/plugins";

const apiBreaker = createCircuitBreaker({
  name: "external-api",
  failureThreshold: 5,
  recoveryTimeMs: 30000,
  halfOpenMaxRequests: 3,
  isFailure: (error) => !error.message.includes("404"),
  onStateChange: (from, to) => console.log(`Circuit: ${from} -> ${to}`),
});

// Use in resolvers
resolvers: {
  fetchData: {
    requirement: "FETCH_DATA",
    resolve: async (req, context) => {
      const data = await apiBreaker.execute(async () => {
        return fetch("/api/data").then((r) => r.json());
      });
      context.facts.data = data;
    },
  },
},

// Wire into constraints for automatic fallback
constraints: {
  apiDown: {
    when: () => apiBreaker.getState() === "OPEN",
    require: { type: "USE_FALLBACK" },
  },
  fetchNormally: {
    when: (facts) => apiBreaker.getState() !== "OPEN" && !facts.data,
    require: { type: "FETCH_DATA" },
  },
},
```

---

## Critical Anti-Patterns

### 1. Async logic in constraint when()

```typescript
// WRONG — when() must be synchronous (unless async: true + deps)
when: async (facts) => {
  return await validate(facts.token);
}

// CORRECT — either use async: true with deps, or put validation in resolver
when: (facts) => Boolean(facts.token),
```

### 2. Condition checking inside a resolver

```typescript
// WRONG — resolver should not check conditions (that's the constraint's job)
resolve: async (req, context) => {
  if (!context.facts.isAuthenticated) {
    return;
  }
  // ...
}

// CORRECT — let the constraint's when() gate this
```

### 3. Async constraint without deps

```typescript
// WRONG — engine cannot track dependencies
{ async: true, when: async (facts) => await validate(facts.token) }

// CORRECT
{ async: true, deps: ["token"], when: async (facts) => await validate(facts.token) }
```

### 4. String literal for require

```typescript
// WRONG
require: "FETCH_DATA"

// CORRECT
require: { type: "FETCH_DATA" }
```

### 5. Returning data from a resolver

```typescript
// WRONG — return value ignored
resolve: async (req, context) => { return await fetchUser(req.userId); }

// CORRECT
resolve: async (req, context) => { context.facts.user = await fetchUser(req.userId); }
```

### 6. Abbreviating context to ctx

```typescript
// WRONG
resolve: async (req, ctx) => { ctx.facts.status = "done"; }

// CORRECT
resolve: async (req, context) => { context.facts.status = "done"; }
```

### 7. No error handling on network resolvers

```typescript
// WRONG
resolve: async (req, context) => {
  context.facts.data = await fetch("/api").then((r) => r.json());
}

// CORRECT — add retry and check response status
resolve: async (req, context) => {
  const res = await fetch("/api");
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  context.facts.data = await res.json();
},
```

---

## Constraint vs Effect vs Derivation

| Feature | Purpose | When to use |
|---------|---------|-------------|
| Constraint | Declare a need (emit requirement) | "When X, the system needs Y" |
| Resolver | Fulfill a need (async work) | "Do Y" |
| Effect | React to changes (fire-and-forget) | "Whenever X changes, log it" |
| Derivation | Compute a value (sync, cached) | "X is always facts.a + facts.b" |

---

## Reference Files

- `constraints.md` — full constraint API, async constraints, disabling, common mistakes
- `resolvers.md` — full resolver API, context object, batch resolution, inspecting resolver status
- `error-boundaries.md` — all recovery strategies, DirectiveError API, circuit breaker patterns
