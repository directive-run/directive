---
title: loggingPlugin
description: Console logging for every Directive lifecycle event – debug, info, warn, error, with configurable level, filter, logger backend, and prefix.
---

# `loggingPlugin` – every lifecycle event, one log line

> A drop-in plugin that maps every Directive engine hook to a
> log call at an appropriate severity. Tail your terminal and
> see exactly what the runtime did, in the order it did it,
> with the same prefix and structured payload your other
> observability lives on.

## What it does

Subscribes to every plugin hook the engine exposes – facts changed,
derivations recomputed, constraints evaluated, requirements created/met,
resolvers started/completed/errored, effects run, history navigated,
definitions registered – and emits a single log line per event at a
severity that matches the event class.

Production builds opt out by setting the `level` above the events you
don't care about, or by passing a `filter` predicate that returns
`false` for noisy event names.

## When to use

- Local development – you want to see the system breathe without opening
  the devtools panel.
- CI / integration tests where the test runner already captures stdout.
- Shipping to a structured log aggregator (Datadog, Loki, CloudWatch) by
  passing a `logger` that batches and forwards by severity.
- Debugging a misbehaving resolver in staging where attaching a panel
  isn't an option.
- Tracking definition lifecycle (`register` / `assign` / `unregister`)
  during hot-reload or dynamic module migrations.

## Quick start

```ts
import { createSystem } from "@directive-run/core";
import { loggingPlugin } from "@directive-run/core/plugins";

const system = createSystem({
  module: trafficLight,
  plugins: [
    loggingPlugin({
      level: "debug",
      filter: (event) => !event.startsWith("derivation."),
      prefix: "[traffic]",
    }),
  ],
});

system.start();
// [traffic] init
// [traffic] start
// [traffic] fact.set { key: "phase", value: "red", prev: undefined }
// [traffic] constraint.evaluate { id: "transition", active: false, clauses: { total: 2, passed: 1 } }
```

## Options

| Field    | Default         | Description |
| -------- | --------------- | ----------- |
| `level`  | `"info"`        | Minimum severity. Anything below this is silenced. One of `"debug" \| "info" \| "warn" \| "error"`. |
| `filter` | `() => true`    | Predicate that receives the event name (e.g., `"fact.set"`) and returns whether to log it. Use this to silence noisy event classes without raising `level`. |
| `logger` | `console`       | Any object implementing `debug`, `info`, `warn`, `error`, `group`, and `groupEnd`. Pass a custom logger to forward to your aggregator. |
| `prefix` | `"[Directive]"` | String prepended to every log line. Pair with the system name when running multiple systems in one process. |

## How it works

The plugin wires one handler per engine hook. Each handler calls an
internal `log(eventLevel, event, payload)` helper that:

1. Returns early if `LOG_LEVELS[eventLevel] < minLevel`.
2. Returns early if `filter(event)` is `false`.
3. Otherwise calls `logger[eventLevel](`${prefix} ${event}`, payload)`.

Severity assignments map to event semantics, not event count:

- **`debug`** – fact changes, derivation compute/invalidate, reconcile
  start/end, constraint evaluate, resolver start/cancel, effect run,
  snapshot capture, definition call, trace complete, init/destroy.
- **`info`** – start/stop, requirement met, resolver complete,
  time-travel jump, definition register/assign/unregister.
- **`warn`** – resolver retry, error recovery, resolver write rejected.
- **`error`** – constraint error, resolver error, effect error, system
  error.

The plugin holds no state beyond the resolved options – no buffers, no
timers, no subscriptions outside the hooks. Cheap enough to leave on in
production at `level: "warn"`.

`constraint.evaluate` payloads carry a compact clauses summary
(`{ total, passed }`) for data-form `when:` constraints so a tailed log
shows which clauses tripped without flipping on a separate devtools
session. Function-form `when:` omits the summary.

## Footguns

- **`level: "debug"` is loud.** Every fact set, every derivation
  recompute, every reconcile boundary lands a line. Use `filter` to mute
  event classes (e.g., `event.startsWith("derivation.")`) or stay at
  `info` for everyday work.
- **Custom `logger` must implement all six methods.** If you pass an
  object missing `group` / `groupEnd`, TypeScript will catch it, but a
  runtime hot-swap won't. Stick to `Pick<Console, ...>`.
- **`filter` runs before severity gating.** A `filter` that's expensive
  costs you on every hook, regardless of `level`. Keep it cheap – a
  `startsWith` check or a `Set.has` lookup.
- **No structured fields beyond the payload object.** If your aggregator
  needs `service`, `env`, `traceId` etc., wrap the logger:
  ```ts
  logger: {
    debug: (msg, data) => console.debug(msg, { service: "checkout", ...data }),
    // ...
  }
  ```
- **`onTraceComplete` payloads can be large.** Each trace entry includes
  arrays for fact changes, derivations recomputed, constraints hit,
  resolvers started, effects run. At `debug` level this floods structured
  log backends – filter `"trace.complete"` if you don't need it.

## See also

- [`devtoolsPlugin`](./devtools.md) – same events, rendered as a
  floating panel with live tables and a timeline.
- [`performancePlugin`](./performance.md) – the same hooks, aggregated
  into metrics instead of logged line-by-line.
- [`createAuditLedger`](./audit-ledger.md) – tamper-evident persistence
  of the same events for compliance use.
- [`whenExplain` panel](./when-explain-panel.md) – the per-clause
  breakdown the `constraint.evaluate` summary refers to.
