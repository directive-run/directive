---
title: Error Handling
description: Handle errors gracefully with Directive's error boundaries, retry policies, and recovery strategies.
---

Directive provides robust error handling for resolvers, constraints, effects, and derivations. {% .lead %}

---

## Resolver Error Handling

Handle errors directly in resolver logic with try-catch:

```typescript
resolvers: {
  fetchUser: {
    requirement: "FETCH_USER",
    resolve: async (req, context) => {
      try {
        // Signal the UI that a request is in flight
        context.facts.loading = true;

        // Fetch and store the user, clearing any previous error
        context.facts.user = await api.getUser(req.userId);
        context.facts.error = null;
      } catch (error) {
        // Store the error message and clear stale user data
        context.facts.error = error.message;
        context.facts.user = null;
      } finally {
        // Always reset loading state, even on failure
        context.facts.loading = false;
      }
    },
  },
}
```

---

## Retry Policies

Configure automatic retries with backoff:

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

| Option | Type | Description |
|--------|------|-------------|
| `attempts` | `number` | Maximum retry attempts |
| `backoff` | `"none" \| "linear" \| "exponential"` | Backoff strategy |
| `initialDelay` | `number` | Delay before first retry (ms) |
| `maxDelay` | `number` | Maximum delay between retries (ms) |
| `shouldRetry` | `(error, attempt) => boolean` | Predicate to control whether to retry |

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

Configure system-level error handling with `errorBoundary`:

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
| `"skip"` | Ignore the error and continue |
| `"retry"` | Retry the operation immediately |
| `"retry-later"` | Retry after a delay (configurable) |
| `"disable"` | Disable the failing constraint/effect/resolver |
| `"throw"` | Re-throw the error (stops the system) |

You can also pass a callback instead of a strategy string:

```typescript
errorBoundary: {
  // Use a callback for fine-grained control over error recovery
  onResolverError: (error, resolver) => {
    console.error(`Resolver ${resolver} failed:`, error);
    // Implement custom recovery logic here
  },
},
```

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

- [Resolvers](/docs/resolvers) – Retry configuration
- [Custom Plugins](/docs/plugins/custom) – Monitoring hooks
- [Testing](/docs/testing/overview) – Testing error scenarios
