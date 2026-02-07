---
title: Error Handling
description: Handle errors gracefully with Directive's error boundaries, retry policies, and recovery strategies.
---

Directive provides robust error handling for resolvers, constraints, and effects. {% .lead %}

---

## Resolver Error Handling

### Try-Catch in Resolvers

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

### Error Handler Callback

```typescript
resolvers: {
  fetchUser: {
    requirement: "FETCH_USER",
    onError: (error, req, context) => {
      context.facts.error = error.message;
      context.dispatch("ERROR_OCCURRED", {
        type: "FETCH_FAILED",
        message: error.message,
        requirement: req,
      });
    },
    resolve: async (req, context) => {
      context.facts.user = await api.getUser(req.userId);
    },
  },
}
```

---

## Retry Policies

### Automatic Retries

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

### Conditional Retry

```typescript
retry: {
  attempts: 3,
  shouldRetry: (error, attempt) => {
    // Don't retry client errors (4xx)
    if (error.status >= 400 && error.status < 500) {
      return false;
    }
    // Don't retry after 3 attempts
    return attempt < 3;
  },
}
```

---

## Timeout Handling

```typescript
resolvers: {
  fetchData: {
    requirement: "FETCH_DATA",
    timeout: 5000,
    onTimeout: (req, context) => {
      context.facts.error = "Request timed out after 5 seconds";
      context.facts.loading = false;
    },
    resolve: async (req, context) => {
      context.facts.data = await slowApi.getData(req.id);
    },
  },
}
```

---

## Global Error Handling

### System-Level Error Handler

```typescript
const system = createSystem({
  module: myModule,
  onError: (error, context) => {
    console.error("System error:", error);
    errorReporter.capture(error, context);
  },
});
```

### Error Events

```typescript
schema: {
  events: {
    ERROR_OCCURRED: t.object<{
      code: string;
      message: string;
      context?: unknown;
    }>(),
  },
}

// Listen for errors
system.on("ERROR_OCCURRED", (payload) => {
  showErrorToast(payload.message);
  analytics.track("error", payload);
});
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
        // Try fallback source
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

```typescript
import { DirectiveProvider, useSystem } from 'directive/react';
import { ErrorBoundary } from 'react-error-boundary';

function ErrorFallback({ error, resetErrorBoundary }) {
  const system = useSystem();

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

function App() {
  return (
    <DirectiveProvider system={system}>
      <ErrorBoundary FallbackComponent={ErrorFallback}>
        <MyComponent />
      </ErrorBoundary>
    </DirectiveProvider>
  );
}
```

---

## Best Practices

### Always Handle Errors

```typescript
// Good - comprehensive error handling
resolvers: {
  fetchUser: {
    requirement: "FETCH_USER",
    retry: { attempts: 2, backoff: "exponential" },
    timeout: 10000,
    onError: (error, req, context) => {
      context.facts.error = error.message;
      context.dispatch("ERROR", { type: "FETCH_FAILED" });
    },
    resolve: async (req, context) => {
      context.facts.user = await api.getUser(req.userId);
    },
  },
}
```

### Use Error States in UI

```typescript
derive: {
  hasError: (facts) => facts.error !== null,
  canRetry: (facts) => facts.error && facts.retryCount < 3,
}
```

### Log and Monitor

```typescript
onError: (error, req, context) => {
  // Log to monitoring service
  Sentry.captureException(error, {
    extra: { requirement: req, facts: context.facts },
  });
}
```

---

## Next Steps

- See Resolvers for retry configuration
- See Testing for testing error scenarios
- See Effects for error side effects
