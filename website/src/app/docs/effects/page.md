---
title: Effects
description: Effects are fire-and-forget side effects that run when facts change, perfect for analytics, logging, and external integrations.
---

Effects run side effects without blocking the reconciliation loop. {% .lead %}

---

## Basic Effects

Define effects in your module to react to fact changes:

```typescript
import { createModule, t } from 'directive';

const analyticsModule = createModule("analytics", {
  schema: {
    facts: {
      page: t.string(),
      userId: t.string().nullable(),
    },
  },

  effects: {
    trackPageView: {
      // Fires whenever page or userId changes
      run: (facts) => {
        analytics.track("page_view", {
          page: facts.page,
          userId: facts.userId,
        });
      },
    },
  },
});
```

---

## Effect Anatomy

| Property | Type | Description |
|----------|------|-------------|
| `run` | `(facts, prev) => void \| Promise<void> \| (() => void)` | The side effect to execute. May return a cleanup function. |
| `deps` | `string[]` | Optional explicit dependencies for optimization |

The `run` function receives:
- `facts` – the current facts (read-only access recommended)
- `prev` – a snapshot of all facts from before the last change, or `null` on first run

---

## Auto-Tracking

By default, effects auto-track which facts are read during `run()`. On subsequent changes, the effect only re-runs if one of its tracked facts changed:

```typescript
effects: {
  logUser: {
    // Auto-tracks facts.userId and facts.userName
    // Only re-runs when those specific facts change
    run: (facts) => {
      console.log(`User: ${facts.userId} - ${facts.userName}`);
    },
  },
}
```

---

## Previous Values

Access the previous facts snapshot to detect transitions:

```typescript
effects: {
  onStatusChange: {
    run: (facts, prev) => {
      // Detect specific transitions using previous values
      if (prev && prev.status === "pending" && facts.status === "complete") {
        confetti.launch();
        notifyUser("Order complete!");
      }

      if (prev && prev.status === "processing" && facts.status === "failed") {
        errorReporter.capture("Order failed");
      }
    },
  },
}
```

`prev` is `null` on the first run (no previous state exists yet).

---

## Explicit Dependencies

Use `deps` to declare which facts an effect depends on. This is required for async effects where fact reads after `await` won't be auto-tracked:

```typescript
effects: {
  // Sync effects use auto-tracking (no deps needed)
  syncEffect: {
    run: (facts) => {
      console.log(facts.userId);  // Tracked automatically
    },
  },

  // Async effects need explicit deps – reads after await aren't tracked
  asyncEffect: {
    deps: ["userId", "userName"],
    run: async (facts) => {
      await someAsyncOp();
      console.log(facts.userId);  // Safe – dep is declared explicitly
    },
  },
}
```

**Why?** Auto-tracking only captures synchronous fact reads. Any reads that happen after an `await` are invisible to the tracker. Explicit `deps` guarantee the effect runs when those facts change.

---

## DOM Effects

Effects are perfect for DOM manipulation:

```typescript
effects: {
  // Update the browser tab title when page changes
  updateTitle: {
    deps: ["pageTitle"],
    run: (facts) => {
      document.title = facts.pageTitle
        ? `${facts.pageTitle} | MyApp`
        : "MyApp";
    },
  },

  // Show a badge favicon when there are unread items
  updateFavicon: {
    deps: ["unreadCount"],
    run: (facts) => {
      const favicon = document.querySelector("link[rel='icon']");
      if (favicon) {
        favicon.href = facts.unreadCount > 0
          ? "/favicon-badge.ico"
          : "/favicon.ico";
      }
    },
  },

  // Scroll to top on route changes
  scrollToTop: {
    run: (facts, prev) => {
      if (prev && facts.currentRoute !== prev.currentRoute) {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
  },
}
```

---

## External Service Integration

Connect to external services reactively:

```typescript
effects: {
  // Sync user profile changes to Firebase in real time
  syncToFirebase: {
    deps: ["userProfile"],
    run: (facts) => {
      if (facts.userProfile) {
        firebase.database()
          .ref(`users/${facts.userProfile.id}`)
          .set(facts.userProfile);
      }
    },
  },

  // Keep Intercom in sync with user data
  sendToIntercom: {
    deps: ["user"],
    run: (facts) => {
      if (facts.user) {
        Intercom("update", {
          user_id: facts.user.id,
          email: facts.user.email,
          name: facts.user.name,
        });
      }
    },
  },
}
```

---

## Cleanup

Effects can return a cleanup function, similar to React's `useEffect`. The cleanup runs before the effect re-runs (when deps change) and when the system stops or is destroyed:

```typescript
effects: {
  // Return a cleanup function to tear down resources
  websocket: {
    deps: ["roomId"],
    run: (facts) => {
      const ws = new WebSocket(`wss://chat.example.com/${facts.roomId}`);
      ws.onmessage = (e) => handleMessage(e.data);

      // Cleanup: close the connection when roomId changes or system stops
      return () => ws.close();
    },
  },

  // Works with intervals, event listeners, etc.
  polling: {
    deps: ["endpoint"],
    run: (facts) => {
      const id = setInterval(() => fetch(facts.endpoint), 5000);

      return () => clearInterval(id);
    },
  },
}
```

Cleanup functions are called safely – errors in cleanup are caught and logged without breaking the system. If an async effect returns a cleanup function after the system has already been stopped, the cleanup is invoked immediately so resources are never leaked.

---

## Error Isolation

Effects are fire-and-forget – errors are logged but never break the reconciliation loop:

```typescript
effects: {
  riskyEffect: {
    run: (facts) => {
      // If this throws, the reconciliation loop continues normally
      // Errors are logged and reported via the onError callback
      externalService.send(facts.data);
    },
  },
}
```

For async effects, handle errors explicitly to avoid unhandled promise rejections:

```typescript
effects: {
  saveData: {
    deps: ["data"],
    run: async (facts) => {
      try {
        await api.save(facts.data);
      } catch (error) {
        // Handle errors explicitly to avoid unhandled promise rejections
        errorReporter.capture(error);
      }
    },
  },
}
```

---

## Parallel Execution

Effects run in parallel, not sequentially. They are independent side effects and don't wait for each other:

```typescript
effects: {
  // All three effects run in parallel – they don't wait for each other
  logEvent: {
    run: (facts) => console.log("Action:", facts.action),
  },
  trackAnalytics: {
    run: (facts) => analytics.track(facts.action),
  },
  notifyUser: {
    run: (facts) => showNotification(facts.action),
  },
}
```

---

## Best Practices

### Don't Mutate Facts

Effects should be read-only side effects, not state mutations:

```typescript
// Good - only side effects
effects: {
  log: {
    run: (facts) => console.log(facts.status),
  },
}

// Bad - mutating facts
effects: {
  compute: {
    run: (facts) => {
      facts.computed = facts.a + facts.b;  // Don't do this!
    },
  },
}
```

Use derivations for computed values, events for state mutations.

### Use Explicit Deps for Async Effects

```typescript
// Bad - fact reads after await won't be tracked
effects: {
  bad: {
    run: async (facts) => {
      await delay(100);
      console.log(facts.userId);  // NOT tracked!
    },
  },
}

// Good - explicit deps for async
effects: {
  good: {
    deps: ["userId"],
    run: async (facts) => {
      await delay(100);
      console.log(facts.userId);  // Works because dep is declared
    },
  },
}
```

### Handle Async Errors

```typescript
effects: {
  save: {
    deps: ["data"],
    run: async (facts) => {
      try {
        await api.save(facts.data);
      } catch (error) {
        errorReporter.capture(error);
      }
    },
  },
}
```

---

## Runtime Control

Disable or enable effects at runtime:

```typescript
// Disable an effect – it won't run during reconciliation
system.effects.disable("expensiveAnalytics");

// Re-enable it later
system.effects.enable("expensiveAnalytics");

// Check whether an effect is currently enabled
system.effects.isEnabled("expensiveAnalytics"); // false
```

This is useful for suppressing noisy effects during tests, pausing analytics, or toggling behavior based on user preferences.

---

## Effects vs Resolvers

| Aspect | Effects | Resolvers |
|--------|---------|-----------|
| Purpose | Side effects (logging, DOM, analytics) | Fulfill requirements (API calls, data) |
| Trigger | Fact changes | Constraint activation |
| Can modify facts | No (read-only recommended) | Yes |
| Cleanup support | Yes (return function from `run`) | Yes (via `AbortController`) |
| Fire-and-forget | Yes | No (tracked, retried, cancelled) |
| Error handling | Isolated (logged, never breaks engine) | Full lifecycle (retry, timeout, abort) |
| Execution | Parallel | Parallel (sequential via `after`) |

---

## Next Steps

- [Constraints](/docs/constraints) – Declarative rules
- [Resolvers](/docs/resolvers) – Handling requirements
- [Events](/docs/events) – State mutations
