---
title: Plugin Overview
description: Extend Directive with plugins for logging, persistence, devtools, and custom functionality.
---

Plugins extend Directive systems with cross-cutting functionality like logging, persistence, and debugging. They hook into every stage of the system lifecycle without modifying core behavior. {% .lead %}

---

## Using Plugins

Add plugins when creating a system:

```typescript
import { createSystem } from '@directive-run/core';
import { loggingPlugin, devtoolsPlugin } from '@directive-run/core/plugins';

// Pass plugins as an array –they hook into the system's lifecycle automatically
const system = createSystem({
  module: myModule,
  plugins: [
    loggingPlugin(),
    devtoolsPlugin(),
  ],
});

// Plugins are active as soon as the system starts
system.start();
```

---

## Built-in Plugins

| Plugin | Import | Purpose |
|--------|--------|---------|
| `loggingPlugin(options?)` | `@directive-run/core/plugins` | Console logging for state changes, resolvers, and events |
| `devtoolsPlugin(options?)` | `@directive-run/core/plugins` | Browser devtools integration via `window.__DIRECTIVE__` |
| `persistencePlugin(options)` | `@directive-run/core/plugins` | Save and restore facts to storage |
| `performancePlugin(options?)` | `@directive-run/core/plugins` | Track constraint, resolver, effect, and reconciliation metrics |

## Standalone Utilities

These are standalone utilities imported from `@directive-run/core/plugins`. They integrate with the system but are **not** passed to the `plugins` array.

| Utility | Import | Purpose |
|---------|--------|---------|
| `createCircuitBreaker(config?)` | `@directive-run/core/plugins` | Fault isolation with automatic recovery for failing operations |
| `createObservability(config?)` | `@directive-run/core/plugins` | Metrics collection, dashboards, and alert thresholds |

---

## Plugin Order

Plugins execute in registration order. Put logging first to capture all events:

```typescript
plugins: [
  // Logging first so it captures events from every plugin that follows
  loggingPlugin(),

  // Persistence restores saved state during init, before the engine runs
  persistencePlugin({ storage: localStorage, key: 'my-app' }),

  // DevTools last –it can inspect the fully initialized system
  devtoolsPlugin(),
]
```

If two plugins with the same `name` are registered, the second replaces the first with a warning.

{% plugin-lifecycle-diagram /%}

---

## Conditional Plugins

Enable plugins based on environment:

```typescript
// Start with the plugins you always want
const plugins = [
  persistencePlugin({ key: 'my-app' }),
];

// Add dev-only plugins conditionally so they're tree-shaken from production
if (process.env.NODE_ENV === 'development') {
  // unshift puts logging first so it captures everything
  plugins.unshift(loggingPlugin());
  plugins.push(devtoolsPlugin());
}

const system = createSystem({
  module: myModule,
  plugins,
});

system.start();
```

---

## Complete Hook Reference

Every hook is optional. Implement only the ones you need.

### Lifecycle Hooks

| Hook | Parameters | When it fires |
|------|------------|---------------|
| `onInit` | `(system)` | Once on creation, before `start()`. **Only async hook.** |
| `onStart` | `(system)` | When `system.start()` is called |
| `onStop` | `(system)` | When `system.stop()` is called |
| `onDestroy` | `(system)` | When `system.destroy()` is called (final cleanup) |

### Fact Hooks

| Hook | Parameters | When it fires |
|------|------------|---------------|
| `onFactSet` | `(key, value, prev)` | A single fact is set (outside of a batch) |
| `onFactDelete` | `(key, prev)` | A fact is deleted |
| `onFactsBatch` | `(changes: FactChange[])` | A batch of fact changes completes |

### Derivation Hooks

| Hook | Parameters | When it fires |
|------|------------|---------------|
| `onDerivationCompute` | `(id, value, deps)` | A derivation is computed or recomputed |
| `onDerivationInvalidate` | `(id)` | A derivation is marked stale |

### Reconciliation Hooks

| Hook | Parameters | When it fires |
|------|------------|---------------|
| `onReconcileStart` | `(snapshot)` | Reconciliation loop begins |
| `onReconcileEnd` | `(result: { unmet, inflight, completed, canceled })` | Reconciliation loop ends |

### Constraint Hooks

| Hook | Parameters | When it fires |
|------|------------|---------------|
| `onConstraintEvaluate` | `(id, active)` | A constraint's `when` function is evaluated |
| `onConstraintError` | `(id, error)` | A constraint's `when` function throws |

### Requirement Hooks

| Hook | Parameters | When it fires |
|------|------------|---------------|
| `onRequirementCreated` | `(req: RequirementWithId)` | A new requirement is created by a constraint |
| `onRequirementMet` | `(req, byResolver)` | A requirement is fulfilled by a resolver |
| `onRequirementCanceled` | `(req)` | A requirement is canceled (constraint no longer active) |

### Resolver Hooks

| Hook | Parameters | When it fires |
|------|------------|---------------|
| `onResolverStart` | `(resolver, req)` | A resolver begins processing a requirement |
| `onResolverComplete` | `(resolver, req, duration)` | A resolver succeeds (`duration` in ms) |
| `onResolverError` | `(resolver, req, error)` | A resolver fails after all retries exhausted |
| `onResolverRetry` | `(resolver, req, attempt)` | A resolver retries after failure |
| `onResolverCancel` | `(resolver, req)` | A resolver is canceled (requirement no longer needed) |

### Effect Hooks

| Hook | Parameters | When it fires |
|------|------------|---------------|
| `onEffectRun` | `(id)` | An effect executes |
| `onEffectError` | `(id, error)` | An effect throws an error |

### Time-Travel Hooks

| Hook | Parameters | When it fires |
|------|------------|---------------|
| `onSnapshot` | `(snapshot: { id, timestamp, facts, trigger })` | A time-travel snapshot is captured |
| `onTimeTravel` | `(from, to)` | Time-travel navigation occurs |

### Run History Hooks

| Hook | Parameters | When it fires |
|------|------------|---------------|
| `onRunComplete` | `(run: RunChangelogEntry)` | A run finalizes (all resolvers settled). Requires `debug.runHistory` to be enabled. |

### Error Boundary Hooks

| Hook | Parameters | When it fires |
|------|------------|---------------|
| `onError` | `(error: DirectiveError)` | Any error occurs in the system |
| `onErrorRecovery` | `(error, strategy: RecoveryStrategy)` | Error recovery is attempted |

---

## Error Handling

Errors thrown inside plugin hooks are caught and logged. A failing plugin never breaks the system or blocks other plugins from running:

```typescript
const flakyPlugin: Plugin = {
  name: 'flaky',

  // Even if a hook throws, the system catches it and keeps running
  onFactSet: (key, value) => {
    throw new Error('Plugin crash');
    // Caught internally –other plugins and the system continue normally
  },
};
```

---

## Next Steps

- [Logging](/docs/plugins/logging) – Logging configuration
- [DevTools](/docs/plugins/devtools) – Browser integration
- [Persistence](/docs/plugins/persistence) – State storage
- [Performance](/docs/plugins/performance) – Runtime metrics
- [Circuit Breaker](/docs/plugins/circuit-breaker) – Fault isolation and recovery
- [Observability](/docs/plugins/observability) – Metrics, tracing, and alerts
- [Custom Plugins](/docs/plugins/custom) – Building your own
