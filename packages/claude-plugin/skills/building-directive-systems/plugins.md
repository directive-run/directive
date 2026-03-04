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
    loggingPlugin({ verbose: true }),
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

// Default — logs facts changes and resolver start/complete
loggingPlugin()

// Verbose — logs everything including derivation recomputation and constraint evaluation
loggingPlugin({ verbose: true })

// Custom filter — only log specific events
loggingPlugin({
  filter: (event) => {
    // Only log resolver events
    if (event.type === "resolution:start" || event.type === "resolution:complete") {
      return true;
    }

    return false;
  },
})
```

## devtoolsPlugin

Connects to the Directive DevTools browser extension for visual state inspection.

```typescript
import { devtoolsPlugin } from "@directive-run/core/plugins";

// Default
devtoolsPlugin()

// With options
devtoolsPlugin({
  name: "My App",        // Name shown in DevTools
  maxAge: 50,            // Max actions to keep in history
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

// sessionStorage — cleared when tab closes
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

// Selective persistence — only persist certain facts
persistencePlugin({
  key: "my-app",
  storage: localStorage,
  include: ["user", "preferences"],  // Only these facts
  // OR
  exclude: ["tempData", "sessionId"], // Everything except these
})

// Versioning — handle schema changes
persistencePlugin({
  key: "my-app",
  storage: localStorage,
  version: 2,
  migrate: (oldState, oldVersion) => {
    if (oldVersion === 1) {
      return {
        ...oldState,
        newField: "default",
      };
    }

    return oldState;
  },
})
```

## createCircuitBreaker

Wraps resolvers with circuit breaker pattern for resilience.

```typescript
import { createCircuitBreaker } from "@directive-run/core/plugins";

const system = createSystem({
  module: myModule,
  plugins: [
    createCircuitBreaker({
      // How many failures before opening the circuit
      failureThreshold: 5,

      // How long to wait before trying again (ms)
      resetTimeout: 30000,

      // Optional: only apply to specific resolver types
      include: ["FETCH_DATA", "SYNC_REMOTE"],

      // Optional: callback when circuit opens
      onOpen: (resolverType) => {
        console.warn(`Circuit opened for ${resolverType}`);
      },

      // Optional: callback when circuit closes
      onClose: (resolverType) => {
        console.log(`Circuit closed for ${resolverType}`);
      },
    }),
  ],
});
```

Circuit breaker states: **Closed** (normal) -> **Open** (failing, rejects immediately) -> **Half-Open** (testing one request).

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
import type { DirectivePlugin } from "@directive-run/core";

const myPlugin: DirectivePlugin = {
  name: "my-custom-plugin",

  // System lifecycle
  onInit: (system) => {
    // Called when system is created
  },
  onStart: (system) => {
    // Called when system.start() is invoked
  },
  onStop: (system) => {
    // Called when system.stop() is invoked
  },

  // State tracking
  onSnapshot: (snapshot) => {
    // Called after every fact mutation
    // snapshot.facts contains current state
    // snapshot.changedKeys lists what changed
  },

  // Requirement pipeline
  onRequirementEmitted: (requirement) => {
    // Called when a constraint emits a requirement
    // requirement.type, requirement.id, payload
  },
  onResolutionStart: (resolution) => {
    // Called when a resolver begins executing
    // resolution.resolverId, resolution.requirement
  },
  onResolutionComplete: (resolution) => {
    // Called when a resolver finishes (success or failure)
    // resolution.resolverId, resolution.duration, resolution.error?
  },

  // Error handling
  onError: (error, context) => {
    // Called on any error in the system
    // context.source: "resolver" | "constraint" | "effect" | "derivation"
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
// WRONG — devtools overhead in production
const system = createSystem({
  module: myModule,
  plugins: [devtoolsPlugin()],
});

// CORRECT — conditional on environment
const plugins = [];
if (process.env.NODE_ENV === "development") {
  plugins.push(devtoolsPlugin());
  plugins.push(loggingPlugin({ verbose: true }));
}

const system = createSystem({
  module: myModule,
  plugins,
});
```

### Persistence without versioning

```typescript
// WRONG — schema changes break existing users
persistencePlugin({
  key: "app-state",
  storage: localStorage,
})

// CORRECT — version and migrate
persistencePlugin({
  key: "app-state",
  storage: localStorage,
  version: 1,
  migrate: (old, version) => old,
})
```

### Plugin order matters

```typescript
// WRONG — logging misses events from persistence restore
const system = createSystem({
  module: myModule,
  plugins: [
    persistencePlugin({ key: "app", storage: localStorage }),
    loggingPlugin(), // Misses restore events
  ],
});

// CORRECT — logging first to capture everything
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
// WRONG — persists auth tokens and loading state
persistencePlugin({
  key: "app",
  storage: localStorage,
})

// CORRECT — exclude sensitive and transient facts
persistencePlugin({
  key: "app",
  storage: localStorage,
  exclude: ["authToken", "isLoading", "error"],
})
```
