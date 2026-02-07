---
title: Custom Plugins
description: Build custom plugins to extend Directive functionality.
---

Create plugins for cross-cutting concerns. {% .lead %}

---

## Plugin Structure

```typescript
import { Plugin } from 'directive';

const myPlugin: Plugin = {
  name: 'my-plugin',

  // Lifecycle hooks
  onInit: (system) => {},
  onStart: (system) => {},
  onStop: (system) => {},
  onDispose: (system) => {},

  // State hooks
  onFactChange: (key, value, prev, system) => {},
  onDerivationChange: (key, value, prev, system) => {},

  // Event hooks
  onEvent: (name, payload, system) => {},
  onRequirement: (requirement, system) => {},
  onResolverStart: (resolver, requirement, system) => {},
  onResolverComplete: (resolver, requirement, result, system) => {},
  onResolverError: (resolver, requirement, error, system) => {},
};
```

---

## Factory Pattern

Create configurable plugins:

```typescript
function analyticsPlugin(config: AnalyticsConfig): Plugin {
  return {
    name: 'analytics',

    onEvent: (name, payload, system) => {
      if (config.events.includes(name)) {
        analytics.track(name, payload);
      }
    },

    onFactChange: (key, value, prev, system) => {
      if (config.trackFacts) {
        analytics.track('fact_change', { key, value, prev });
      }
    },
  };
}

// Usage
const system = createSystem({
  module: myModule,
  plugins: [
    analyticsPlugin({
      events: ['USER_LOGGED_IN', 'PURCHASE_COMPLETE'],
      trackFacts: false,
    }),
  ],
});
```

---

## Async Hooks

Hooks can be async:

```typescript
const syncPlugin: Plugin = {
  name: 'sync',

  onFactChange: async (key, value, prev, system) => {
    await api.sync(key, value);
  },
};
```

---

## Error Monitoring

```typescript
function errorMonitorPlugin(reporter: ErrorReporter): Plugin {
  return {
    name: 'error-monitor',

    onResolverError: (resolver, requirement, error, system) => {
      reporter.capture(error, {
        resolver: resolver.name,
        requirement,
        facts: system.snapshot(),
      });
    },
  };
}
```

---

## Metrics Collection

```typescript
function metricsPlugin(metrics: Metrics): Plugin {
  return {
    name: 'metrics',

    onResolverStart: (resolver, req) => {
      metrics.startTimer(`resolver.${resolver.name}`);
    },

    onResolverComplete: (resolver, req) => {
      metrics.endTimer(`resolver.${resolver.name}`);
      metrics.increment(`resolver.${resolver.name}.success`);
    },

    onResolverError: (resolver, req, error) => {
      metrics.endTimer(`resolver.${resolver.name}`);
      metrics.increment(`resolver.${resolver.name}.error`);
    },
  };
}
```

---

## Next Steps

- See Plugin Overview for built-in plugins
- See Logging for logging patterns
- See DevTools for debugging
