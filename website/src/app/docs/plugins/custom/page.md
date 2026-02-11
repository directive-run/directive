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
  // Every plugin needs a unique name for deduplication and debugging
  name: 'my-plugin',

  // Lifecycle hooks receive the system instance
  onStart: (system) => {
    console.log('System started');
  },

  // Fact hooks fire on every state change – useful for logging or syncing
  onFactSet: (key, value, prev) => {
    console.log(`${key}: ${prev} → ${value}`);
  },

  // Resolver hooks help you measure async work performance
  onResolverComplete: (resolver, req, duration) => {
    console.log(`${resolver} resolved ${req.type} in ${duration}ms`);
  },
};
```

Register plugins when creating a system:

```typescript
// Pass your plugin in the plugins array – it starts receiving hooks immediately
const system = createSystem({
  module: myModule,
  plugins: [myPlugin],
});

system.start();
```

---

## Factory Pattern

Wrap your plugin in a function to accept configuration:

```typescript
interface AnalyticsOptions {
  trackFacts?: boolean;
  sampleRate?: number;
}

// Factory functions let callers configure the plugin at creation time
function analyticsPlugin(options: AnalyticsOptions = {}): Plugin {
  // Destructure with sensible defaults so zero-config works out of the box
  const { trackFacts = true, sampleRate = 1.0 } = options;

  return {
    name: 'analytics',

    // Sample fact changes to avoid flooding the analytics pipeline
    onFactSet: (key, value, prev) => {
      if (trackFacts && Math.random() < sampleRate) {
        analytics.track('fact_change', { key, value, prev });
      }
    },

    // Track every resolver completion to measure async work duration
    onResolverComplete: (resolver, req, duration) => {
      analytics.track('resolver_complete', {
        resolver,
        type: req.type,
        duration,
      });
    },
  };
}

// Usage – disable fact tracking and sample only 50% of events
const system = createSystem({
  module: myModule,
  plugins: [
    analyticsPlugin({ trackFacts: false, sampleRate: 0.5 }),
  ],
});

system.start();
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

    // Record every fact mutation with its before/after values
    onFactSet: (key, value, prev) => {
      tracker.track('fact_changed', { key, from: prev, to: value });
    },

    // Measure how long each resolver takes to fulfill its requirement
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

    // Capture resolver failures with enough context to reproduce the issue
    onResolverError: (resolver, req, error) => {
      reporter.capture(error, {
        context: 'resolver',
        resolver,
        requirementId: req.id,
        requirementType: req.type,
      });
    },

    // Catch any system-level error (constraint failures, effect crashes, etc.)
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

    // duration is provided automatically – no need to track start times
    onResolverComplete: (resolver, req, duration) => {
      metrics.histogram(`resolver.${resolver}.duration`, duration);
      metrics.increment(`resolver.${resolver}.success`);
    },

    // Track failure rates to detect degraded resolvers
    onResolverError: (resolver, req, error) => {
      metrics.increment(`resolver.${resolver}.error`);
    },

    // Monitor retry frequency to spot flaky dependencies
    onResolverRetry: (resolver, req, attempt) => {
      metrics.increment(`resolver.${resolver}.retry`);
    },

    // Gauge the system's health after each reconciliation pass
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

    // Record when a constraint raises a new requirement
    onRequirementCreated: (req) => {
      log.append({
        event: 'requirement_created',
        id: req.id,
        type: req.type,
        timestamp: Date.now(),
      });
    },

    // Record which resolver fulfilled the requirement
    onRequirementMet: (req, byResolver) => {
      log.append({
        event: 'requirement_met',
        id: req.id,
        type: req.type,
        resolver: byResolver,
        timestamp: Date.now(),
      });
    },

    // Record when a requirement is dropped because its constraint deactivated
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

  // safeCall wraps every hook – a throw here won't break the system
  onFactSet: (key, value) => {
    throw new Error('Plugin crash');
    // Caught internally – system continues, other plugins still fire
  },
};
```

This means plugins can never break your application. However, you should still handle errors gracefully within your plugin logic when possible, since `safeCall` is a safety net, not a control flow mechanism.

---

## Async Initialization

`onInit` is the only hook that can be async. Use it for setup that requires I/O, like connecting to external services:

```typescript
function remoteConfigPlugin(endpoint: string): Plugin {
  // Closed-over state persists across hooks for the lifetime of the plugin
  let config: Record<string, unknown> = {};

  return {
    name: 'remote-config',

    // onInit is the only async hook – the system waits for it before calling onStart
    onInit: async (system) => {
      const res = await fetch(endpoint);
      config = await res.json();
    },

    // By the time onStart fires, onInit has resolved and config is populated
    onStart: (system) => {
      console.log('Loaded remote config:', config);
    },
  };
}
```

All other hooks are synchronous. If you need to perform async work inside a non-lifecycle hook, fire it off without awaiting – the return value is ignored:

```typescript
const asyncSafe: Plugin = {
  name: 'async-safe',

  // Non-lifecycle hooks are synchronous, but you can fire off async work safely
  onFactSet: (key, value) => {
    // Fire-and-forget – the system doesn't await this and ignores the return value
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

- [Plugin Overview](/docs/plugins/overview) – all built-in plugins
- [Logging Plugin](/docs/plugins/logging) – logging configuration
- [DevTools Plugin](/docs/plugins/devtools) – browser integration
- [Persistence Plugin](/docs/plugins/persistence) – save and restore state
