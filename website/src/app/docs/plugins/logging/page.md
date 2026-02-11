---
title: Logging Plugin
description: Console logging for every Directive lifecycle event, with level filtering, event filtering, and custom loggers.
---

The logging plugin hooks into every lifecycle event in a Directive system and logs it to the console (or a custom logger) with a configurable level and prefix. {% .lead %}

---

## Basic Usage

```typescript
import { loggingPlugin } from 'directive/plugins';

// Zero-config: logs info-level events and above with the [Directive] prefix
const system = createSystem({
  module: myModule,
  plugins: [loggingPlugin()],
});

system.start();
```

With defaults, this logs `info`-level events and above using `console`, prefixed with `[Directive]`.

---

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `level` | `"debug" \| "info" \| "warn" \| "error"` | `"info"` | Minimum log level. Events below this level are silenced. |
| `filter` | `(event: string) => boolean` | `() => true` | Return `false` to suppress a specific event. Receives the event name (e.g. `"fact.set"`). |
| `logger` | `Pick<Console, "debug" \| "info" \| "warn" \| "error" \| "group" \| "groupEnd">` | `console` | Custom logger implementation. |
| `prefix` | `string` | `"[Directive]"` | Prefix prepended to every log message. |

---

## Log Levels

Each event is assigned a fixed level. Setting `level` filters out everything below it.

### `debug`

The most verbose level. Includes all internal lifecycle activity:

`init`, `destroy`, `fact.set`, `fact.delete`, `facts.batch`, `derivation.compute`, `derivation.invalidate`, `reconcile.start`, `reconcile.end`, `constraint.evaluate`, `requirement.created`, `requirement.canceled`, `resolver.start`, `resolver.cancel`, `effect.run`, `timetravel.snapshot`

### `info`

High-level system activity:

`start`, `stop`, `requirement.met`, `resolver.complete`, `timetravel.jump`

### `warn`

Recoverable problems:

`resolver.retry`, `error.recovery`

### `error`

Failures:

`constraint.error`, `resolver.error`, `effect.error`, `error`

---

## Event Filtering

The `filter` function receives the event name string and returns a boolean. It runs after the level check, so you only need to filter within your configured level.

Log only fact-related events:

```typescript
loggingPlugin({
  // Show all events, then narrow down to just fact mutations
  level: 'debug',
  filter: (event) => event.startsWith('fact.'),
})
```

Log everything except derivation noise:

```typescript
loggingPlugin({
  // Derivations recompute frequently –filter them out to reduce clutter
  level: 'debug',
  filter: (event) => !event.startsWith('derivation.'),
})
```

Log only resolver lifecycle:

```typescript
loggingPlugin({
  // Focus on async work: starts, completions, retries, errors
  level: 'debug',
  filter: (event) => event.startsWith('resolver.'),
})
```

---

## Custom Logger

Replace `console` with any object that implements `debug`, `info`, `warn`, `error`, `group`, and `groupEnd`:

```typescript
import pino from 'pino';

const log = pino();

// Redirect Directive logs through pino instead of the browser console
loggingPlugin({
  logger: {
    debug: (...args) => log.debug(args),
    info: (...args) => log.info(args),
    warn: (...args) => log.warn(args),
    error: (...args) => log.error(args),

    // pino doesn't support console grouping, so these are no-ops
    group: () => {},
    groupEnd: () => {},
  },
})
```

---

## Production

The logging plugin has no side effects beyond console output, but you should exclude it from production builds to avoid noise and minor overhead:

```typescript
const plugins = [];

// Only add logging in dev –avoids console noise and minor overhead in prod
if (process.env.NODE_ENV !== 'production') {
  plugins.push(loggingPlugin({ level: 'debug' }));
}

const system = createSystem({
  module: myModule,
  plugins,
});

system.start();
```

---

## Example Output

Every log line follows the format `${prefix} ${event}` followed by a data object:

```text
[Directive] start
[Directive] fact.set { key: "count", value: 1, prev: 0 }
[Directive] derivation.compute { id: "doubled", value: 2, deps: ["count"] }
[Directive] constraint.evaluate { id: "fetchWhenReady", active: true }
[Directive] requirement.created { id: "req_1", type: "FETCH_USER" }
[Directive] resolver.start { resolver: "fetchUser", requirementId: "req_1" }
[Directive] resolver.complete { resolver: "fetchUser", requirementId: "req_1", duration: 45 }
[Directive] requirement.met { id: "req_1", byResolver: "fetchUser" }
[Directive] fact.set { key: "user", value: { name: "Alice" }, prev: undefined }
```

Events with no associated data log just the prefix and event name (e.g. `[Directive] start`).

---

## Next Steps

- [DevTools Plugin](/docs/plugins/devtools) –browser integration
- [Persistence Plugin](/docs/plugins/persistence) –save and restore state
- [Plugin Overview](/docs/plugins/overview) –all built-in plugins
