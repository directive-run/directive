# Plugins

Plugins extend Directive systems with cross-cutting functionality like logging, persistence, devtools, and resilience patterns.

## Decision Tree: "Which plugin do I need?"

```
What do you want?
├── See state changes in console → loggingPlugin()
├── Connect to browser DevTools → devtoolsPlugin()
├── Persist state across reloads → persistencePlugin(config)
├── Protect resolvers from cascading failures → createCircuitBreaker(config)
├── Track metrics, traces, alerts → createObservability(config)
└── Custom cross-cutting behavior → Write a custom plugin
```

## Using Built-In Plugins

```typescript
import { createSystem } from "@directive-run/core";
import {
  devtoolsPlugin,
  loggingPlugin,
  persistencePlugin,
} from "@directive-run/core/plugins";

const system = createSystem({
  module: myModule,
  plugins: [
    devtoolsPlugin(),
    loggingPlugin({ level: "debug" }),
    persistencePlugin({
      key: "my-app-state",
      storage: localStorage,
    }),
  ],
});
```

Plugins are applied in order. Place logging first to capture all events including those from other plugins.

## loggingPlugin

Logs state changes, requirements, and resolutions to the console.

```typescript
import { loggingPlugin } from "@directive-run/core/plugins";

// Default – logs facts changes and resolver start/complete at "info" level
loggingPlugin()

// Debug level – logs everything including derivation recomputation and constraint evaluation
loggingPlugin({ level: "debug" })

// Custom filter – only log specific events
loggingPlugin({
  filter: (event) => event.startsWith("resolver."),
})

// Custom logger and prefix
loggingPlugin({
  level: "warn",
  prefix: "[MyApp]",
  logger: customLogger,
})
```

Options: `level` ("debug" | "info" | "warn" | "error"), `filter` (predicate on event name string), `logger` (Console-compatible object), `prefix` (string, default "[Directive]").

## devtoolsPlugin

Connects to the Directive DevTools browser extension for visual state inspection.

```typescript
import { devtoolsPlugin } from "@directive-run/core/plugins";

// Default
devtoolsPlugin()

// With options
devtoolsPlugin({
  name: "My App",        // Name shown in DevTools
  maxEvents: 1000,       // Max trace events to retain (default: 1000)
  trace: true,           // Enable trace logging
  panel: true,           // Show floating debug panel (dev mode only)
})
```

Only enable in development. The plugin is a no-op if the DevTools extension is not installed.

## persistencePlugin

Persists fact state to storage. Restores on system creation.

```typescript
import { persistencePlugin } from "@directive-run/core/plugins";

// localStorage (default)
persistencePlugin({
  key: "my-app-state",
  storage: localStorage,
})

// sessionStorage – cleared when tab closes
persistencePlugin({
  key: "session-state",
  storage: sessionStorage,
})

// Custom storage adapter
persistencePlugin({
  key: "my-app",
  storage: {
    getItem: (key) => myCustomStore.get(key),
    setItem: (key, value) => myCustomStore.set(key, value),
    removeItem: (key) => myCustomStore.delete(key),
  },
})

// Selective persistence – only persist certain facts
persistencePlugin({
  key: "my-app",
  storage: localStorage,
  include: ["user", "preferences"],  // Only these facts
  // OR
  exclude: ["tempData", "sessionId"], // Everything except these
})

// With callbacks
persistencePlugin({
  key: "my-app",
  storage: localStorage,
  debounce: 200,                       // Debounce saves (default: 100ms)
  onRestore: (data) => console.log("Restored:", data),
  onSave: (data) => console.log("Saved:", data),
  onError: (err) => console.error("Persistence error:", err),
})
```

## createCircuitBreaker

Standalone utility (not a Plugin) that implements the circuit breaker pattern for resilience. Use it inside resolvers to protect against cascading failures from external services.

```typescript
import { createCircuitBreaker } from "@directive-run/core/plugins";

const breaker = createCircuitBreaker({
  failureThreshold: 5,         // Failures before opening (default: 5)
  recoveryTimeMs: 30000,       // Time before HALF_OPEN (default: 30000)
  halfOpenMaxRequests: 3,      // Requests allowed in HALF_OPEN (default: 3)
  failureWindowMs: 60000,      // Window for counting failures (default: 60000)
  name: "api-breaker",         // Name for metrics/errors
  onStateChange: (from, to) => console.log(`Circuit: ${from} -> ${to}`),
});

// Use inside a resolver
resolvers: {
  fetchData: {
    requirement: "FETCH_DATA",
    resolve: async (req, context) => {
      const result = await breaker.execute(async () => {
        return await callExternalAPI();
      });
      context.facts.data = result;
    },
  },
},

// Wire circuit state into constraints
constraints: {
  apiDown: {
    when: () => breaker.getState() === "OPEN",
    require: { type: "FALLBACK_RESPONSE" },
  },
},
```

Circuit breaker states: **Closed** (normal) -> **Open** (failing, rejects immediately) -> **Half-Open** (testing limited requests).

## createObservability

Metrics, tracing, and alerting for production systems.

```typescript
import { createObservability } from "@directive-run/core/plugins";

const system = createSystem({
  module: myModule,
  plugins: [
    createObservability({
      metrics: {
        enabled: true,
        // Track resolver duration, constraint evaluation count, etc.
      },
      tracing: {
        enabled: true,
        // Trace resolver execution with spans
      },
      alerts: {
        enabled: true,
        onAlert: (alert) => {
          // Send to monitoring service
          sendToDatadog(alert);
        },
      },
    }),
  ],
});
```

## Plugin Lifecycle Hooks

Plugins hook into the system lifecycle. Use these to build custom plugins.

```typescript
import type { Plugin, ModuleSchema } from "@directive-run/core";

const myPlugin: Plugin<ModuleSchema> = {
  name: "my-custom-plugin",

  // System lifecycle
  onInit: (system) => {
    // Called when system is created (only async hook)
  },
  onStart: (system) => {
    // Called when system.start() is invoked
  },
  onStop: (system) => {
    // Called when system.stop() is invoked
  },
  onDestroy: (system) => {
    // Called when system.destroy() is invoked
  },

  // Fact tracking
  onFactSet: (key, value, prev) => {
    // Called when a single fact is set
  },
  onFactsBatch: (changes) => {
    // Called after a batch of fact changes completes
  },

  // Requirement pipeline
  onRequirementCreated: (requirement) => {
    // Called when a constraint emits a requirement
    // requirement.type, requirement.id
  },
  onRequirementMet: (requirement, byResolver) => {
    // Called when a requirement is fulfilled
  },

  // Resolver pipeline
  onResolverStart: (resolverId, requirement) => {
    // Called when a resolver begins executing
  },
  onResolverComplete: (resolverId, requirement, duration) => {
    // Called when a resolver finishes successfully
  },
  onResolverError: (resolverId, requirement, error) => {
    // Called when a resolver fails (after all retries)
  },

  // Error handling
  onError: (error) => {
    // Called on any DirectiveError in the system
    // error.source, error.message, error.context
  },
};

const system = createSystem({
  module: myModule,
  plugins: [myPlugin],
});
```

## Common Mistakes

### Enabling devtools in production

```typescript
// WRONG – devtools overhead in production
const system = createSystem({
  module: myModule,
  plugins: [devtoolsPlugin()],
});

// CORRECT – conditional on environment
const plugins = [];
if (process.env.NODE_ENV === "development") {
  plugins.push(devtoolsPlugin());
  plugins.push(loggingPlugin({ level: "debug" }));
}

const system = createSystem({
  module: myModule,
  plugins,
});
```

### Persistence without filtering

```typescript
// WRONG – persists everything including transient state
persistencePlugin({
  key: "app-state",
  storage: localStorage,
})

// CORRECT – use include/exclude to control what's persisted
persistencePlugin({
  key: "app-state",
  storage: localStorage,
  include: ["user", "preferences", "settings"],
})
```

### Plugin order matters

```typescript
// WRONG – logging misses events from persistence restore
const system = createSystem({
  module: myModule,
  plugins: [
    persistencePlugin({ key: "app", storage: localStorage }),
    loggingPlugin(), // Misses restore events
  ],
});

// CORRECT – logging first to capture everything
const system = createSystem({
  module: myModule,
  plugins: [
    loggingPlugin(),
    persistencePlugin({ key: "app", storage: localStorage }),
  ],
});
```

### Persisting sensitive or transient data

```typescript
// WRONG – persists auth tokens and loading state
persistencePlugin({
  key: "app",
  storage: localStorage,
})

// CORRECT – exclude sensitive and transient facts
persistencePlugin({
  key: "app",
  storage: localStorage,
  exclude: ["authToken", "isLoading", "error"],
})
```
