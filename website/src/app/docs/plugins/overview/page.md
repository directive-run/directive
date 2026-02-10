---
title: Plugin Overview
description: Extend Directive with plugins for logging, persistence, devtools, and custom functionality.
---

Plugins extend Directive systems with cross-cutting functionality like logging, persistence, and debugging. They hook into every stage of the system lifecycle without modifying core behavior. {% .lead %}

---

## Using Plugins

Add plugins when creating a system:

```typescript
import { createSystem } from 'directive';
import { loggingPlugin, devtoolsPlugin } from 'directive/plugins';

const system = createSystem({
  module: myModule,
  plugins: [
    loggingPlugin(),
    devtoolsPlugin(),
  ],
});
```

---

## Built-in Plugins

| Plugin | Import | Purpose |
|--------|--------|---------|
| `loggingPlugin(options?)` | `directive/plugins` | Console logging for state changes, resolvers, and events |
| `devtoolsPlugin(options?)` | `directive/plugins` | Browser devtools integration via `window.__DIRECTIVE__` |
| `persistencePlugin(options)` | `directive/plugins` | Save and restore facts to storage |

---

## Plugin Order

Plugins execute in registration order. Put logging first to capture all events:

```typescript
plugins: [
  loggingPlugin(),                                    // Logs everything
  persistencePlugin({ storage: localStorage, key: 'my-app' }),  // Restores state
  devtoolsPlugin(),                                   // DevTools last
]
```

If two plugins with the same `name` are registered, the second replaces the first with a warning.

---

## Conditional Plugins

Enable plugins based on environment:

```typescript
const plugins = [
  persistencePlugin({ key: 'my-app' }),
];

if (process.env.NODE_ENV === 'development') {
  plugins.unshift(loggingPlugin());
  plugins.push(devtoolsPlugin());
}

const system = createSystem({
  module: myModule,
  plugins,
});
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
  onFactSet: (key, value) => {
    throw new Error('Plugin crash');
    // Caught internally -- other plugins and the system continue normally
  },
};
```

---

## Next Steps

- See [Logging](/docs/plugins/logging) for logging configuration
- See [DevTools](/docs/plugins/devtools) for browser integration
- See [Persistence](/docs/plugins/persistence) for state storage
- See [Custom Plugins](/docs/plugins/custom) for building your own
