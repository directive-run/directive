---
title: Error Handling
description: Handle errors gracefully with Directive's error boundaries, retry policies, and recovery strategies.
---

Directive provides robust error handling for resolvers, constraints, effects, and derivations. {% .lead %}

---

## How Resilience Works

Directive has a two-layer error handling system. Resolver retry handles transient failures fast. The error boundary handles persistent failures after retries are exhausted.

```
  Resolver executes
      │ fails
      ▼
  Resolver retry policy (attempts: 3, backoff: exponential)
      │ all attempts exhausted
      ▼
  Error boundary receives the error
      │
      ├─ "skip"        → swallow, move on
      ├─ "retry"       → immediate single re-attempt (same cycle)
      ├─ "retry-later" → schedule deferred retry (exponential backoff)
      ├─ "disable"     → disable the constraint that produced this requirement
      └─ "throw"       → re-throw, crash current reconciliation
```

**Configure fast retries on the resolver. Configure what happens after they fail on the error boundary.**

### When to Use What

| Layer | Purpose | Speed | Scope |
|-------|---------|-------|-------|
| `resolver.retry` | Transient failures (network blips, rate limits) | Fast — immediate retries with backoff | Per-resolver |
| `errorBoundary: "retry"` | One more attempt after all retries fail | Immediate — same reconciliation cycle | System-wide |
| `errorBoundary: "retry-later"` | Service degradation, longer outages | Slow — deferred with exponential backoff | System-wide |
| [Circuit Breaker](/docs/plugins/circuit-breaker) | Cascading failure prevention | Instant rejection when open | Per-service |

### Full Example

```typescript
const system = createSystem({
  module: myModule,

  errorBoundary: {
    onResolverError: (error, resolver) => {
      // At this point, the resolver's own retry policy is already exhausted.
      if (error.message.includes("rate limit")) {
        return "retry-later"; // Back off and try again later
      }
      if (error.message.includes("not found")) {
        return "disable"; // Stop trying — the resource doesn't exist
      }

      return "skip"; // Swallow and continue
    },

    retryLater: {
      delayMs: 2000,
      maxRetries: 5,
      backoffMultiplier: 2,
    },

    onError: (error) => {
      errorReporter.capture(error);
    },
  },
});
```

---

## Resolver Retry Policy

Configure automatic retries directly on the resolver for transient failures:

```typescript
resolvers: {
  fetchData: {
    requirement: "FETCH_DATA",

    // Automatically retry on transient failures
    retry: {
      attempts: 3,
      backoff: "exponential",  // "none" | "linear" | "exponential"
      initialDelay: 100,       // ms before first retry
      maxDelay: 5000,          // maximum delay between retries
    },

    // The resolver itself stays simple – retry logic is handled externally
    resolve: async (req, context) => {
      context.facts.data = await api.getData(req.id);
    },
  },
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `attempts` | `number` | `1` | Maximum retry attempts |
| `backoff` | `"none" \| "linear" \| "exponential"` | `"none"` | Backoff strategy |
| `initialDelay` | `number` | `100` | Delay before first retry (ms) |
| `maxDelay` | `number` | `30000` | Maximum delay between retries (ms) |
| `shouldRetry` | `(error, attempt) => boolean` | – | Predicate to control whether to retry |

Use `shouldRetry` to skip retries for non-transient errors:

```typescript
retry: {
  attempts: 5,
  backoff: "exponential",

  // Only retry errors that are likely transient
  shouldRetry: (error, attempt) => {
    // 404 (not found) and 401 (unauthorized) won't resolve with retries
    if (error.message.includes("404") || error.message.includes("401")) {
      return false;
    }
    return true;
  },
},
```

---

## Timeout

Set a timeout for resolver execution:

```typescript
resolvers: {
  fetchData: {
    requirement: "FETCH_DATA",
    timeout: 5000, // Abort the resolver if it takes longer than 5 seconds

    resolve: async (req, context) => {
      context.facts.data = await slowApi.getData(req.id);
    },
  },
}
```

When a resolver exceeds its timeout, it is aborted via the `context.signal` (an `AbortSignal`). Use it to cancel in-flight requests:

```typescript
resolve: async (req, context) => {
  // Pass the abort signal to fetch so the request cancels on timeout
  const res = await fetch(`/api/data/${req.id}`, {
    signal: context.signal,
  });

  context.facts.data = await res.json();
},
```

---

## Error Boundary

The error boundary catches errors **after** resolver retries are exhausted. Configure system-level error handling with `errorBoundary`:

```typescript
const system = createSystem({
  module: myModule,

  // Define a recovery strategy for each error source
  errorBoundary: {
    onConstraintError: "skip",     // Ignore failing constraints
    onResolverError: "retry",      // Retry failed resolvers immediately
    onEffectError: "skip",         // Don't let side-effect errors crash the system
    onDerivationError: "skip",     // Keep the previous derived value on error

    // Global handler – called for every error regardless of source
    onError: (error) => {
      console.error(`[${error.source}] ${error.sourceId}:`, error.message);
      errorReporter.capture(error);
    },
  },
});
```

```
                    ┌──────────────┐
                    │ Error Occurs │
                    └──────┬───────┘
               ┌───────────┼───────────┐
               ▼           ▼           ▼
          ┌────────┐  ┌────────┐  ┌──────────┐
          │  retry │  │  skip  │  │ escalate │
          └───┬────┘  └───┬────┘  └────┬─────┘
              ▼           ▼            ▼
         Re-execute   Mark Skipped   System Error
```

### Recovery Strategies

| Strategy | Behavior |
|----------|----------|
| `"skip"` | Ignore the error and continue. The system proceeds as if nothing happened. |
| `"retry"` | Retry the operation immediately. For effects, forces a re-run on the next reconcile. For derivations, marks them stale so they recompute on the next read. |
| `"retry-later"` | Schedule a retry with exponential backoff. Requires `retryLater` configuration. The engine polls for due retries and triggers reconciliation. |
| `"disable"` | Permanently disable the failing source. Disables the constraint (for constraint/resolver errors) or effect (for effect errors). The source stays disabled until manually re-enabled. |
| `"throw"` | Re-throw the error. This stops the current reconciliation cycle. |

---

## Retry-Later Configuration

When using `"retry-later"`, configure the backoff behavior. This is **separate** from resolver retry — it fires after all resolver-level retries are exhausted:

```typescript
errorBoundary: {
  onResolverError: "retry-later",
  retryLater: {
    delayMs: 1000,        // Initial delay before first retry (default: 1000)
    maxRetries: 3,        // Give up after this many attempts (default: 3)
    backoffMultiplier: 2, // Multiply delay by this on each retry (default: 2)
    maxDelayMs: 30000,    // Cap the delay at this value (default: 30000)
  },
},
```

The engine starts a polling timer when `retryLater` is configured. When a due retry fires, it triggers a reconciliation cycle so constraints re-evaluate and resolvers re-execute. Retry attempts are cleared automatically when a resolver succeeds.

### Disable Strategy

Use `"disable"` to permanently turn off failing constraints or effects:

```typescript
errorBoundary: {
  onConstraintError: "disable", // Permanently disable failing constraints
  onEffectError: "disable",     // Permanently disable failing effects
},
```

For resolver errors, `"disable"` disables the constraint that produced the requirement. You can re-enable disabled constraints/effects programmatically:

```typescript
system.constraints.enable("myConstraint");
system.effects.enable("myEffect");
```

### Callback with Strategy Return

Pass a callback that returns a strategy string for dynamic error handling:

```typescript
errorBoundary: {
  onResolverError: (error, resolver) => {
    if (error.message.includes("rate limit")) {
      return "retry-later";
    }
    if (error.message.includes("not found")) {
      return "disable";
    }

    return "skip";
  },
},
```

If the callback returns `void` (no return value), the strategy defaults to `"skip"`.

### See Also

- [Error Boundaries Example](/docs/examples/error-boundaries) — Interactive demo of all 5 strategies

---

## Circuit Breaker

For operations that call external services, use a [circuit breaker](/docs/plugins/circuit-breaker) to automatically stop sending requests to a failing service and recover gracefully.

The circuit breaker is a **standalone utility** — wrap calls inside your resolver's `resolve()` function. It complements retry policies: retries handle transient failures within a single operation, while the circuit breaker prevents repeated attempts against a service that is consistently failing.

```typescript
import { createCircuitBreaker } from '@directive-run/core/plugins';

const apiBreaker = createCircuitBreaker({
  name: 'external-api',
  failureThreshold: 5,
  recoveryTimeMs: 30000,
});

resolvers: {
  fetchData: {
    requirement: "FETCH_DATA",
    retry: { attempts: 3, backoff: "exponential" },
    resolve: async (req, context) => {
      // Circuit breaker wraps the call inside the resolver
      const data = await apiBreaker.execute(() => api.getData(req.id));
      context.facts.data = data;
    },
  },
}
```

See [Circuit Breaker](/docs/plugins/circuit-breaker) for full configuration and the 3-state pattern.

---

## Batch Error Handling

When using [batched resolvers](/docs/resolvers#batched-resolution), error handling depends on your failure strategy.

### All-or-Nothing (default)

With `resolveBatch`, if the handler throws, **all** requirements in the batch fail. Retry policies apply to the entire batch:

```typescript
resolvers: {
  fetchUsers: {
    requirement: "FETCH_USER",
    batch: { enabled: true, windowMs: 50 },
    retry: { attempts: 3, backoff: "exponential" },

    // If this throws, all 3 requirements fail together
    resolveBatch: async (reqs, context) => {
      const ids = reqs.map(r => r.userId);
      const users = await api.getUsersBatch(ids);
      users.forEach(user => { context.facts[`user_${user.id}`] = user; });
    },
  },
}
```

### Per-Item Results

With `resolveBatchWithResults`, each item reports success or failure independently:

```typescript
resolvers: {
  fetchUsers: {
    requirement: "FETCH_USER",
    batch: { enabled: true, windowMs: 50 },

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

### Batch with resolve() Fallback

You can enable batching with just `resolve()` (no `resolveBatch`). The system falls back to calling `resolve()` individually for each batched requirement. This gives you batching benefits (windowing, dedup) without writing a bulk handler:

```typescript
resolvers: {
  fetchUser: {
    requirement: "FETCH_USER",
    batch: { enabled: true, windowMs: 50 },

    // Individual resolve — called once per batched requirement
    resolve: async (req, context) => {
      context.facts.user = await api.getUser(req.userId);
    },
  },
}
```

Upgrade to `resolveBatch` when you need true bulk operations (e.g., a single SQL `WHERE id IN (...)` query).

---

## Error Recovery Patterns

### Rollback Pattern

```typescript
resolvers: {
  updateUser: {
    requirement: "UPDATE_USER",
    resolve: async (req, context) => {
      // Save original state before making changes
      const original = context.facts.user;

      // Apply the update optimistically so the UI feels instant
      context.facts.user = { ...original, ...req.updates };

      try {
        // Replace with the server-confirmed version
        context.facts.user = await api.updateUser(req.userId, req.updates);
      } catch (error) {
        // Rollback to the original state on failure
        context.facts.user = original;
        context.facts.error = error.message;
      }
    },
  },
}
```

### Fallback Pattern

```typescript
resolvers: {
  fetchData: {
    requirement: "FETCH_DATA",
    resolve: async (req, context) => {
      try {
        // Try the primary data source first
        context.facts.data = await api.getData(req.id);
      } catch (error) {
        // Primary failed – fall back to cached data
        try {
          context.facts.data = await cache.getData(req.id);
          context.facts.isStale = true; // Let the UI know this data may be outdated
        } catch (cacheError) {
          // Both sources failed – surface the error to the user
          context.facts.error = "Data unavailable";
        }
      }
    },
  },
}
```

---

## React Error Boundaries

Combine Directive's error handling with React error boundaries. Pass the system directly – no provider needed:

```typescript
import { ErrorBoundary } from 'react-error-boundary';

// A fallback UI shown when a React render error occurs
function ErrorFallback({ error, resetErrorBoundary, system }) {
  const handleRetry = () => {
    // Clear the Directive error state, then reset the React boundary
    system.facts.error = null;
    resetErrorBoundary();
  };

  return (
    <div role="alert">
      <p>Something went wrong:</p>
      <pre>{error.message}</pre>
      <button onClick={handleRetry}>Try again</button>
    </div>
  );
}

// Wrap your app so render errors show the fallback instead of a blank screen
function App({ system }) {
  return (
    <ErrorBoundary FallbackComponent={(props) => <ErrorFallback {...props} system={system} />}>
      <MyComponent system={system} />
    </ErrorBoundary>
  );
}
```

---

## Error States in Derivations

Use derivations to expose error state to the UI:

```typescript
derive: {
  // True when an error is present – use to toggle error UI
  hasError: (facts) => facts.error !== null,

  // True when the user can still retry (under the retry limit)
  canRetry: (facts) => facts.error !== null && facts.retryCount < 3,
}
```

---

## Monitoring with Plugins

Use the plugin system to report errors to monitoring services:

```typescript
// A plugin that forwards all errors to Sentry for monitoring
const errorMonitor: Plugin = {
  name: 'error-monitor',

  // Fired when a specific resolver fails
  onResolverError: (resolver, req, error) => {
    Sentry.captureException(error, {
      extra: { resolver, requirement: req },
    });
  },

  // Fired for any error across the system
  onError: (error) => {
    Sentry.captureException(error, {
      extra: { source: error.source, sourceId: error.sourceId },
    });
  },
};

// Register the plugin to start capturing errors
const system = createSystem({
  module: myModule,
  plugins: [errorMonitor],
});
```

---

## Next Steps

- [Circuit Breaker](/docs/plugins/circuit-breaker) – Fault isolation and automatic recovery
- [Resolvers](/docs/resolvers) – Retry configuration and batching
- [Custom Plugins](/docs/plugins/custom) – Monitoring hooks
- [Testing](/docs/testing/overview) – Testing error scenarios
