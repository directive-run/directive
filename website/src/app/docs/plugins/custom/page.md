---
title: Custom Plugins
description: Build custom plugins to extend Directive with logging, analytics, monitoring, and any cross-cutting concern.
---

Plugins hook into every stage of a Directive system without modifying core behavior. Implement the hooks you need, ignore the rest. {% .lead %}

---

## Plugin Structure

A plugin is a plain object with a `name` and any combination of hooks:

```typescript
import type { Plugin } from 'directive';

const myPlugin: Plugin = {
  name: 'my-plugin',

  onStart: (system) => {
    console.log('System started');
  },

  onFactSet: (key, value, prev) => {
    console.log(`${key}: ${prev} → ${value}`);
  },

  onResolverComplete: (resolver, req, duration) => {
    console.log(`${resolver} resolved ${req.type} in ${duration}ms`);
  },
};
```

Register plugins when creating a system:

```typescript
const system = createSystem({
  module: myModule,
  plugins: [myPlugin],
});
```

---

## Factory Pattern

Wrap your plugin in a function to accept configuration:

```typescript
interface AnalyticsOptions {
  trackFacts?: boolean;
  sampleRate?: number;
}

function analyticsPlugin(options: AnalyticsOptions = {}): Plugin {
  const { trackFacts = true, sampleRate = 1.0 } = options;

  return {
    name: 'analytics',

    onFactSet: (key, value, prev) => {
      if (trackFacts && Math.random() < sampleRate) {
        analytics.track('fact_change', { key, value, prev });
      }
    },

    onResolverComplete: (resolver, req, duration) => {
      analytics.track('resolver_complete', {
        resolver,
        type: req.type,
        duration,
      });
    },
  };
}

// Usage
const system = createSystem({
  module: myModule,
  plugins: [
    analyticsPlugin({ trackFacts: false, sampleRate: 0.5 }),
  ],
});
```

---

## Complete Hook Reference

Every hook is optional. Only lifecycle hooks (`onInit`, `onStart`, `onStop`, `onDestroy`) receive the `system` argument. All other hooks receive event-specific parameters only.

### Lifecycle

| Hook | Parameters | When it fires |
|------|------------|---------------|
| `onInit` | `(system)` | Once on creation, before `start()`. **Only async hook.** |
| `onStart` | `(system)` | When `system.start()` is called |
| `onStop` | `(system)` | When `system.stop()` is called |
| `onDestroy` | `(system)` | When `system.destroy()` is called (final cleanup) |

### Facts

| Hook | Parameters | When it fires |
|------|------------|---------------|
| `onFactSet` | `(key, value, prev)` | A single fact is set |
| `onFactDelete` | `(key, prev)` | A fact is deleted |
| `onFactsBatch` | `(changes: FactChange[])` | A batch of fact changes completes |

### Derivations

| Hook | Parameters | When it fires |
|------|------------|---------------|
| `onDerivationCompute` | `(id, value, deps)` | A derivation is computed or recomputed |
| `onDerivationInvalidate` | `(id)` | A derivation is marked stale |

### Reconciliation

| Hook | Parameters | When it fires |
|------|------------|---------------|
| `onReconcileStart` | `(snapshot: FactsSnapshot)` | Reconciliation loop begins |
| `onReconcileEnd` | `(result: ReconcileResult)` | Reconciliation loop ends |

### Constraints

| Hook | Parameters | When it fires |
|------|------------|---------------|
| `onConstraintEvaluate` | `(id, active)` | A constraint's `when` function is evaluated |
| `onConstraintError` | `(id, error)` | A constraint's `when` function throws |

### Requirements

| Hook | Parameters | When it fires |
|------|------------|---------------|
| `onRequirementCreated` | `(req: RequirementWithId)` | A new requirement is created by a constraint |
| `onRequirementMet` | `(req, byResolver)` | A requirement is fulfilled by a resolver |
| `onRequirementCanceled` | `(req)` | A requirement is canceled (constraint no longer active) |

### Resolvers

| Hook | Parameters | When it fires |
|------|------------|---------------|
| `onResolverStart` | `(resolver, req)` | A resolver begins processing a requirement. `resolver` is the string ID. |
| `onResolverComplete` | `(resolver, req, duration)` | A resolver succeeds. `duration` is milliseconds. |
| `onResolverError` | `(resolver, req, error)` | A resolver fails after all retries exhausted |
| `onResolverRetry` | `(resolver, req, attempt)` | A resolver retries after failure |
| `onResolverCancel` | `(resolver, req)` | A resolver is canceled (requirement no longer needed) |

### Effects

| Hook | Parameters | When it fires |
|------|------------|---------------|
| `onEffectRun` | `(id)` | An effect executes |
| `onEffectError` | `(id, error)` | An effect throws an error |

### Time-Travel

| Hook | Parameters | When it fires |
|------|------------|---------------|
| `onSnapshot` | `(snapshot: { id, timestamp, facts, trigger })` | A time-travel snapshot is captured |
| `onTimeTravel` | `(from, to)` | Time-travel navigation occurs |

### Error Boundary

| Hook | Parameters | When it fires |
|------|------------|---------------|
| `onError` | `(error: DirectiveError)` | Any error occurs in the system |
| `onErrorRecovery` | `(error, strategy: RecoveryStrategy)` | Error recovery is attempted |

---

## Practical Examples

### Analytics Plugin

Track fact changes and resolver completions:

```typescript
function analyticsPlugin(tracker: AnalyticsTracker): Plugin {
  return {
    name: 'analytics',

    onFactSet: (key, value, prev) => {
      tracker.track('fact_changed', { key, from: prev, to: value });
    },

    onResolverComplete: (resolver, req, duration) => {
      tracker.track('resolver_completed', {
        resolver,
        requirementType: req.type,
        duration,
      });
    },
  };
}
```

### Error Monitoring

Report resolver failures and system errors to an external service:

```typescript
function errorMonitorPlugin(reporter: ErrorReporter): Plugin {
  return {
    name: 'error-monitor',

    onResolverError: (resolver, req, error) => {
      reporter.capture(error, {
        context: 'resolver',
        resolver,
        requirementId: req.id,
        requirementType: req.type,
      });
    },

    onError: (error) => {
      reporter.capture(error, {
        context: 'system',
        code: error.code,
      });
    },
  };
}
```

### Metrics and Timing

The `onResolverComplete` hook receives `duration` in milliseconds, so you don't need to track start times yourself:

```typescript
function metricsPlugin(metrics: MetricsClient): Plugin {
  return {
    name: 'metrics',

    onResolverComplete: (resolver, req, duration) => {
      metrics.histogram(`resolver.${resolver}.duration`, duration);
      metrics.increment(`resolver.${resolver}.success`);
    },

    onResolverError: (resolver, req, error) => {
      metrics.increment(`resolver.${resolver}.error`);
    },

    onResolverRetry: (resolver, req, attempt) => {
      metrics.increment(`resolver.${resolver}.retry`);
    },

    onReconcileEnd: (result) => {
      metrics.gauge('requirements.unmet', result.unmet);
      metrics.gauge('requirements.inflight', result.inflight);
    },
  };
}
```

### Audit Trail

Log every requirement from creation through resolution:

```typescript
function auditPlugin(log: AuditLog): Plugin {
  return {
    name: 'audit',

    onRequirementCreated: (req) => {
      log.append({
        event: 'requirement_created',
        id: req.id,
        type: req.type,
        timestamp: Date.now(),
      });
    },

    onRequirementMet: (req, byResolver) => {
      log.append({
        event: 'requirement_met',
        id: req.id,
        type: req.type,
        resolver: byResolver,
        timestamp: Date.now(),
      });
    },

    onRequirementCanceled: (req) => {
      log.append({
        event: 'requirement_canceled',
        id: req.id,
        type: req.type,
        timestamp: Date.now(),
      });
    },
  };
}
```

---

## Error Safety

Plugin hooks are wrapped in a `safeCall` function internally. If your plugin throws, the error is caught and logged to the console. The system and all other plugins continue running normally:

```typescript
const flakyPlugin: Plugin = {
  name: 'flaky',
  onFactSet: (key, value) => {
    throw new Error('Plugin crash');
    // Caught internally -- system continues, other plugins still fire
  },
};
```

This means plugins can never break your application. However, you should still handle errors gracefully within your plugin logic when possible, since `safeCall` is a safety net, not a control flow mechanism.

---

## Async Initialization

`onInit` is the only hook that can be async. Use it for setup that requires I/O, like connecting to external services:

```typescript
function remoteConfigPlugin(endpoint: string): Plugin {
  let config: Record<string, unknown> = {};

  return {
    name: 'remote-config',

    onInit: async (system) => {
      const res = await fetch(endpoint);
      config = await res.json();
    },

    onStart: (system) => {
      // config is guaranteed to be loaded by the time onStart fires
      console.log('Loaded remote config:', config);
    },
  };
}
```

All other hooks are synchronous. If you need to perform async work inside a non-lifecycle hook, fire it off without awaiting -- the return value is ignored:

```typescript
const asyncSafe: Plugin = {
  name: 'async-safe',

  onFactSet: (key, value) => {
    // Fire-and-forget -- the system doesn't await this
    fetch('/api/track', {
      method: 'POST',
      body: JSON.stringify({ key, value }),
    });
  },
};
```

---

## Duplicate Plugin Names

If two plugins share the same `name`, the second replaces the first and a warning is logged to the console. Use unique names to avoid unintentional replacement.

---

## Next Steps

- [Plugin Overview](/docs/plugins/overview) -- all built-in plugins
- [Logging Plugin](/docs/plugins/logging) -- logging configuration
- [DevTools Plugin](/docs/plugins/devtools) -- browser integration
- [Persistence Plugin](/docs/plugins/persistence) -- save and restore state
