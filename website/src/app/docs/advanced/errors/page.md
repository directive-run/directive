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
        context.facts.loading = true;
        context.facts.user = await api.getUser(req.userId);
        context.facts.error = null;
      } catch (error) {
        context.facts.error = error.message;
        context.facts.user = null;
      } finally {
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
    retry: {
      attempts: 3,
      backoff: "exponential",  // "none" | "linear" | "exponential"
      initialDelay: 100,       // ms before first retry
      maxDelay: 5000,          // maximum delay between retries
    },
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
  shouldRetry: (error, attempt) => {
    // Don't retry 404s or auth errors
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
    timeout: 5000, // ms
    resolve: async (req, context) => {
      context.facts.data = await slowApi.getData(req.id);
    },
  },
}
```

When a resolver exceeds its timeout, it is aborted via the `context.signal` (an `AbortSignal`). Use it to cancel in-flight requests:

```typescript
resolve: async (req, context) => {
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
  errorBoundary: {
    onConstraintError: "skip",     // RecoveryStrategy or callback
    onResolverError: "retry",
    onEffectError: "skip",
    onDerivationError: "skip",
    onError: (error) => {
      // Called for any error
      console.error(`[${error.source}] ${error.sourceId}:`, error.message);
      errorReporter.capture(error);
    },
  },
});
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
  onResolverError: (error, resolver) => {
    console.error(`Resolver ${resolver} failed:`, error);
    // Custom recovery logic
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
      const original = context.facts.user;

      // Optimistic update
      context.facts.user = { ...original, ...req.updates };

      try {
        context.facts.user = await api.updateUser(req.userId, req.updates);
      } catch (error) {
        // Rollback on failure
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
        context.facts.data = await api.getData(req.id);
      } catch (error) {
        // Try cache as fallback
        try {
          context.facts.data = await cache.getData(req.id);
          context.facts.isStale = true;
        } catch (cacheError) {
          context.facts.error = "Data unavailable";
        }
      }
    },
  },
}
```

---

## React Error Boundaries

Combine Directive's error handling with React error boundaries. Pass the system directly -- no provider needed:

```typescript
import { ErrorBoundary } from 'react-error-boundary';

function ErrorFallback({ error, resetErrorBoundary, system }) {
  const handleRetry = () => {
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
  hasError: (facts) => facts.error !== null,
  canRetry: (facts) => facts.error !== null && facts.retryCount < 3,
}
```

---

## Monitoring with Plugins

Use the plugin system to report errors to monitoring services:

```typescript
const errorMonitor: Plugin = {
  name: 'error-monitor',

  onResolverError: (resolver, req, error) => {
    Sentry.captureException(error, {
      extra: { resolver, requirement: req },
    });
  },

  onError: (error) => {
    Sentry.captureException(error, {
      extra: { source: error.source, sourceId: error.sourceId },
    });
  },
};

const system = createSystem({
  module: myModule,
  plugins: [errorMonitor],
});
```

---

## Next Steps

- See [Resolvers](/docs/resolvers) for retry configuration
- See [Custom Plugins](/docs/plugins/custom) for monitoring hooks
- See [Testing](/docs/testing/overview) for testing error scenarios
