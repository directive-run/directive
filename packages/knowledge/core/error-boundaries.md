# Error Boundaries

How to handle errors in Directive: recovery strategies, error boundaries, lifecycle hooks, and the circuit breaker pattern.

## Decision Tree: "How should errors be handled?"

```
Where did the error occur?
├── Resolver (API call, async work)
│   ├── Transient failure (network, timeout) → retry / retry-later
│   ├── Permanent failure (404, auth) → skip or throw
│   └── Unknown → retry-later with maxRetries
│
├── Constraint (evaluation error)
│   ├── Bug in when() logic → throw (fix the code)
│   └── Unexpected data shape → skip (disable constraint)
│
├── Effect (side effect failed)
│   ├── Non-critical (logging, analytics) → skip
│   └── Critical (sync to external system) → retry-later
│
├── Derivation (computation error)
│   └── Usually a bug → throw (fix the code)
│
└── External service (repeated failures)
    └── Circuit breaker pattern
```

## Recovery Strategies

Directive supports five recovery strategies:

| Strategy | Behavior |
|---|---|
| `"skip"` | Swallow the error, continue processing |
| `"retry"` | Retry immediately (respects resolver retry policy) |
| `"retry-later"` | Retry after a delay with exponential backoff |
| `"disable"` | Disable the failing constraint/effect permanently |
| `"throw"` | Re-throw the error, halting the system |

## System-Level Error Boundary

Configure error handling for the entire system:

```typescript
const system = createSystem({
  module: myModule,

  errorBoundary: {
    // Per-subsystem strategies (string or function)
    onConstraintError: "skip",
    onResolverError: "retry-later",
    onEffectError: "skip",
    onDerivationError: "throw",

    // Global error callback — fires for all errors
    onError: (error) => {
      // error is a DirectiveError with source tracking
      console.error(`[${error.source}] ${error.sourceId}: ${error.message}`);
      console.error("Recoverable:", error.recoverable);
      console.error("Context:", error.context);
    },

    // Configuration for retry-later strategy
    retryLater: {
      delayMs: 1000,       // Initial delay (default: 1000)
      maxRetries: 3,        // Max retry attempts (default: 3)
      backoffMultiplier: 2, // Multiply delay each retry (default: 2)
      maxDelayMs: 30000,    // Cap on delay growth (default: 30000)
    },
  },
});
```

## Dynamic Error Handling with Functions

Use functions instead of strings for conditional recovery:

```typescript
errorBoundary: {
  onResolverError: (error, resolverId) => {
    // Network errors — retry later
    if (error.message.includes("NetworkError")) {
      return "retry-later";
    }

    // Auth errors — skip, don't retry
    if (error.message.includes("401")) {
      return "skip";
    }

    // Everything else — throw
    return "throw";
  },

  onConstraintError: (error, constraintId) => {
    // Disable constraints that repeatedly fail
    if (constraintId === "experimentalFeature") {
      return "disable";
    }

    return "skip";
  },

  onEffectError: (error, effectId) => {
    // Analytics can fail silently
    if (effectId.startsWith("analytics")) {
      return "skip";
    }

    return "throw";
  },
},
```

## DirectiveError

All errors passed to error boundary callbacks are `DirectiveError` instances with source tracking:

```typescript
import { DirectiveError } from "@directive-run/core";

try {
  await system.settle();
} catch (err) {
  if (err instanceof DirectiveError) {
    err.source;      // "constraint" | "resolver" | "effect" | "derivation" | "system"
    err.sourceId;    // e.g., "fetchUser" — the specific item that failed
    err.recoverable; // boolean — whether recovery strategies apply
    err.context;     // arbitrary debug data (e.g., the requirement object)
    err.message;     // human-readable description
  }
}
```

## Resolver-Level Error Handling

Resolvers have their own retry policy independent of the error boundary:

```typescript
resolvers: {
  fetchData: {
    requirement: "FETCH_DATA",

    // Resolver-level retry policy
    retry: {
      attempts: 3,
      backoff: "exponential",
      initialDelay: 200,
      maxDelay: 5000,
      shouldRetry: (error, attempt) => {
        // Only retry server errors, not client errors
        if (error.message.includes("4")) {
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

When both resolver retry and error boundary are configured, the resolver retries first. If all retries fail, the error boundary strategy is applied.

## Lifecycle Hooks

Module-level hooks for lifecycle events:

```typescript
const myModule = createModule("app", {
  schema: { facts: { status: t.string() } },

  hooks: {
    onInit: (system) => {
      console.log("Module initialized");
    },
    onStart: (system) => {
      console.log("System started");
    },
    onStop: (system) => {
      console.log("System stopped");
    },
    onError: (error, hookContext) => {
      console.error("Module error:", error.message);
      // error is a DirectiveError
      // hookContext provides additional details
    },
  },

  init: (facts) => {
    facts.status = "ready";
  },
});
```

## Circuit Breaker

For protecting against cascading failures from external services. The circuit breaker tracks failure rates and short-circuits requests when a threshold is exceeded.

```typescript
import { createCircuitBreaker } from "@directive-run/core/plugins";

const apiBreaker = createCircuitBreaker({
  name: "external-api",
  failureThreshold: 5,       // Open after 5 failures (default: 5)
  recoveryTimeMs: 30000,     // Wait 30s before trying again (default: 30000)
  halfOpenMaxRequests: 3,    // Allow 3 trial requests in half-open (default: 3)
  failureWindowMs: 60000,    // Count failures within 60s window (default: 60000)

  // Optional: classify which errors count as failures
  isFailure: (error) => {
    // Don't count 404s as circuit-breaking failures
    if (error.message.includes("404")) {
      return false;
    }

    return true;
  },

  // Optional: react to state changes
  onStateChange: (from, to) => {
    console.log(`Circuit: ${from} -> ${to}`);
  },
});
```

### Using Circuit Breaker in Resolvers

```typescript
resolvers: {
  fetchData: {
    requirement: "FETCH_DATA",
    resolve: async (req, context) => {
      const data = await apiBreaker.execute(async () => {
        const res = await fetch("/api/data");

        return res.json();
      });

      context.facts.data = data;
    },
  },
},
```

### Circuit Breaker + Constraints

Wire the circuit breaker state into constraints for automatic fallback:

```typescript
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

### Circuit Breaker States

```
CLOSED → Normal operation, all requests pass through
  ↓ (failures >= threshold)
OPEN → All requests rejected immediately
  ↓ (after recoveryTimeMs)
HALF_OPEN → Limited trial requests allowed
  ↓ (trial succeeds) → CLOSED
  ↓ (trial fails)    → OPEN
```

### Circuit Breaker API

```typescript
apiBreaker.getState();     // "CLOSED" | "OPEN" | "HALF_OPEN"
apiBreaker.isAllowed();    // boolean — would a request be allowed?
apiBreaker.getStats();     // { totalRequests, totalFailures, recentFailures, ... }
apiBreaker.forceState("CLOSED"); // Force state (useful in tests)
apiBreaker.reset();        // Reset to CLOSED with cleared stats
```

### CircuitBreakerOpenError

When the circuit is open, `execute()` throws a `CircuitBreakerOpenError`:

```typescript
import { CircuitBreakerOpenError } from "@directive-run/core/plugins";

try {
  await apiBreaker.execute(() => fetch("/api"));
} catch (error) {
  if (error instanceof CircuitBreakerOpenError) {
    error.code;          // "CIRCUIT_OPEN"
    error.retryAfterMs;  // ms until circuit transitions to HALF_OPEN
    error.state;         // "OPEN" | "HALF_OPEN"
  }
}
```

## Error Handling Checklist

1. Set system-level `errorBoundary` with strategies for each subsystem
2. Add `retry` policy on resolvers that call external services
3. Use `shouldRetry` to avoid retrying permanent failures (4xx errors)
4. Use circuit breaker for services with known reliability issues
5. Wire circuit breaker state into constraints for automatic fallback
6. Add `onError` callback for logging/monitoring
7. Use `"throw"` for derivation errors (they indicate bugs)
8. Use `"skip"` for non-critical effects (logging, analytics)
