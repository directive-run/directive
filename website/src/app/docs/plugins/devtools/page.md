---
title: DevTools Plugin
description: Debug Directive systems from the browser console with state inspection and event tracing.
---

The devtools plugin exposes your system to the browser console via `window.__DIRECTIVE__`, giving you direct access to inspect state, read derivations, and trace every event flowing through the system. {% .lead %}

---

## Basic Usage

```typescript
import { devtoolsPlugin } from 'directive/plugins';

// Attaches your system to window.__DIRECTIVE__ for browser console access
const system = createSystem({
  module: myModule,
  plugins: [devtoolsPlugin()],
});

system.start();
```

When the system initializes, you'll see a styled console message:

```text
[Directive Devtools] System "default" initialized. Access via window.__DIRECTIVE__
```

---

## Options

The plugin accepts two options:

```typescript
devtoolsPlugin({
  // Identify this system when multiple systems share the same page
  name: 'my-app',

  // Record timestamped events for every lifecycle hook (off by default for performance)
  trace: true,
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | `"default"` | Identifier for this system in the devtools registry |
| `trace` | `boolean` | `false` | When enabled, records timestamped events for every lifecycle hook |

---

## Console API

The plugin creates a `window.__DIRECTIVE__` global with these methods:

### `__DIRECTIVE__.systems`

The underlying `Map` of all registered systems. Each entry contains the system instance, recorded events, and configuration.

### `__DIRECTIVE__.getSystem(name?)`

Returns the system instance by name. If no name is provided, returns the first registered system.

```javascript
// Browser console
const system = __DIRECTIVE__.getSystem('my-app');

// You get back the real system instance –full API access
system.read('count');        // Read a fact
system.start();              // Start the engine
```

### `__DIRECTIVE__.getSystems()`

Returns an array of all registered system names.

```javascript
// List all systems registered on this page
__DIRECTIVE__.getSystems();
// ["my-app", "auth-module"]
```

### `__DIRECTIVE__.inspect(name?)`

Returns the full inspection data for a system –facts, derivations, constraints, requirements, and resolver status. If no name is provided, inspects the first registered system.

```javascript
// Get a full snapshot of facts, derivations, constraints, and resolver status
__DIRECTIVE__.inspect('my-app');
// { facts: { count: 0 }, derivations: { doubled: 0 }, constraints: [...], ... }
```

### `__DIRECTIVE__.getEvents(name?)`

Returns the recorded event array for a system. Requires `trace: true` to have data.

```javascript
// Retrieve the recorded event timeline (only populated when trace: true)
__DIRECTIVE__.getEvents('my-app');
// [{ timestamp: 1707300000000, type: "fact.set", data: { key: "count", value: 1, prev: 0 } }, ...]
```

---

## Event Tracing

When `trace: true`, the plugin records a timestamped event for every lifecycle hook. Events are stored in an array capped at 1000 entries (oldest are dropped when the limit is reached).

Each event has the shape:

```typescript
{ timestamp: number; type: string; data: unknown }
```

### Recorded Event Types

| Event Type | When | Data |
|-----------|------|------|
| `init` | System initializes | `{}` |
| `start` | Engine starts | `{}` |
| `stop` | Engine stops | `{}` |
| `destroy` | System is destroyed | `{}` |
| `fact.set` | A fact value changes | `{ key, value, prev }` |
| `facts.batch` | A batch of fact changes commits | `{ changes }` |
| `reconcile.start` | Reconciliation loop begins | `{}` |
| `reconcile.end` | Reconciliation loop completes | Result object |
| `constraint.evaluate` | A constraint is evaluated | `{ id, active }` |
| `requirement.created` | A new requirement is raised | `{ id, type }` |
| `requirement.met` | A requirement is fulfilled | `{ id, byResolver }` |
| `resolver.start` | A resolver begins executing | `{ resolver, requirementId }` |
| `resolver.complete` | A resolver finishes | `{ resolver, requirementId, duration }` |
| `resolver.error` | A resolver throws | `{ resolver, requirementId, error }` |
| `timetravel.snapshot` | A time-travel snapshot is taken | `{ id, trigger }` |
| `timetravel.jump` | Time-travel jumps to a snapshot | `{ from, to }` |
| `error` | An error boundary catches an error | `{ source, sourceId, message }` |

---

## Multiple Systems

Use the `name` option to distinguish systems when running more than one:

```typescript
// Give each system a unique name so they don't collide in the devtools registry
const auth = createSystem({
  module: authModule,
  plugins: [devtoolsPlugin({ name: 'auth' })],
});
auth.start();

// Enable tracing only on the system you're actively debugging
const dashboard = createSystem({
  module: dashboardModule,
  plugins: [devtoolsPlugin({ name: 'dashboard', trace: true })],
});
dashboard.start();
```

```javascript
// Browser console –both systems are accessible by name
__DIRECTIVE__.getSystems();
// ["auth", "dashboard"]

__DIRECTIVE__.inspect('auth');
__DIRECTIVE__.getEvents('dashboard');
```

When a system is destroyed, it is automatically removed from the devtools registry.

---

## Production

### Conditional Inclusion

Strip devtools from production builds:

```typescript
const plugins = [];

// Devtools add a global object and event recording –exclude from production
if (process.env.NODE_ENV === 'development') {
  plugins.push(devtoolsPlugin({ name: 'my-app', trace: true }));
}

const system = createSystem({
  module: myModule,
  plugins,
});

system.start();
```

### SSR Safety

The plugin is safe to use in server-side rendering. When `typeof window === "undefined"`, all devtools methods return no-op values –no errors, no global mutations. You don't need to conditionally import it for SSR.

---

## Next Steps

- [Logging](/docs/plugins/logging) – Console output
- [Time-Travel](/docs/advanced/time-travel) – Snapshot debugging
- [Plugin Overview](/docs/plugins/overview) – All plugins
