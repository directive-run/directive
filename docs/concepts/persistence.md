---
title: persistencePlugin
description: Save and restore selected facts to a Storage backend — localStorage, sessionStorage, or custom — with include/exclude filtering, debounced writes, and prototype-pollution defense on restore.
---

# `persistencePlugin` — facts in, facts out, across reloads

> Persists a chosen slice of your facts to any `Storage`-shaped backend
> on every change, restores them on `onInit`, debounces writes so a
> burst of fact mutations becomes one `setItem`, and rejects
> prototype-polluted payloads before they touch the store.

## What it does

On system init, reads the configured storage key, JSON-parses it,
validates that the result is a plain object with no prototype pollution,
and batch-writes the matching facts back into the store. On every
`onFactSet` / `onFactDelete` / `onFactsBatch`, schedules a debounced
save that serializes the currently tracked facts. On `onDestroy`,
flushes any pending debounced save synchronously so a tab close doesn't
lose state.

Tracking is opportunistic — the plugin only learns about a fact's
existence after it's been set once (either restored or written
post-init). Use `include` to enumerate the keys you want to persist if
you need deterministic behaviour.

## When to use

- Form / wizard state that should survive a page refresh.
- User preferences (theme, locale, sidebar collapsed state) where you
  don't want a backend round-trip.
- Draft messages, unsaved-document protection.
- Local-first apps using `IndexedDB` via a `Storage`-shaped adapter.
- SSR-hydrated apps where you want the client to take over from
  `localStorage` after first paint.

## Quick start

```ts
import { createSystem } from "@directive-run/core";
import { persistencePlugin } from "@directive-run/core/plugins";

const system = createSystem({
  module: preferences,
  plugins: [
    persistencePlugin({
      storage: localStorage,
      key: "myapp:prefs:v1",
      include: ["theme", "locale", "sidebarCollapsed"],
      debounce: 250,
      onRestore: (data) => console.log("restored", data),
      onSave: (data) => console.log("saved", data),
      onError: (err) => console.error("persistence error", err),
    }),
  ],
});

system.start();
```

## Options

| Field        | Default       | Description |
| ------------ | ------------- | ----------- |
| `storage`    | *required*    | A `Storage`-compatible backend (`getItem`, `setItem`). `localStorage`, `sessionStorage`, or any custom adapter. |
| `key`        | *required*    | The storage key used for both reads and writes. Version it (`myapp:state:v1`) so a schema change doesn't try to load incompatible payloads. |
| `include`    | *all keys*    | Whitelist of fact keys to persist. When set, only these keys flow into storage; everything else is ignored. |
| `exclude`    | `[]`          | Blacklist of fact keys to skip. Combines with `include` (`exclude` wins). |
| `debounce`   | `100`         | Milliseconds to debounce saves. A burst of fact mutations within the window collapses into one `setItem`. |
| `onRestore`  | —             | Callback fired after state is restored from storage on `onInit`, with the parsed `Record<string, unknown>`. |
| `onSave`     | —             | Callback fired after each successful `setItem`, with the serialised `Record<string, unknown>`. |
| `onError`    | —             | Callback fired when load or save throws. Receives an `Error` — JSON parse failures, quota errors, and prototype-pollution detections all funnel here. |

## How it works

```
onInit ─→ load() ─→ JSON.parse ─→ isPrototypeSafe ─→ batch-set facts ─→ onRestore
                                  └─ unsafe ─→ onError(Error("…prototype pollution…")) ─→ skip
onFactSet / onFactDelete / onFactsBatch
       ─→ trackedKeys.add / delete
       ─→ if (shouldPersist) scheduleSave()
scheduleSave() ─→ clearTimeout(prev) ─→ setTimeout(save, debounce)
save() ─→ build data from trackedKeys ∩ shouldPersist ─→ storage.setItem ─→ onSave
onDestroy ─→ clearTimeout ─→ save() (synchronous final flush)
```

Restoration uses `facts.$store.batch()` so the constraints/derivations
don't fan out a notification per restored key — one reconcile after the
whole restore.

`shouldPersist(key)` returns `false` if `key` is in `exclude`,
otherwise `true` if `include` is undefined or `include.includes(key)`.

## Footguns

- **Versions your `key`.** If you change a fact's shape, an old payload
  in `localStorage` will load garbage. Use a versioned key
  (`myapp:state:v2`) and let the old one rot, or write a one-off
  migration in `onRestore`.
- **Storage quota errors funnel to `onError`.** `setItem` throws when
  the user's quota is full; without an `onError` handler, the throw is
  caught and dropped. Wire `onError` to surface this — quota issues are
  user-visible bugs.
- **The plugin only persists keys it's seen.** A fact that was set in
  `init` *before* `onInit` runs (i.e., outside a plugin lifecycle)
  won't be tracked until the next mutation. Use `include` to force the
  desired key set.
- **PII lands in storage verbatim.** `Storage` is host-readable.
  Anything you persist is recoverable by any script running on the
  origin. Exclude PII from the `include` list or encrypt before write.
- **`onDestroy` runs a synchronous save.** A pending debounce timer is
  cleared and `save()` runs once more — so a `system.destroy()` from
  `onbeforeunload` captures the latest state. The trade-off is a
  blocking `setItem` on shutdown.
- **Prototype-pollution defense is restore-side only.** Anything *your
  app* writes via `setItem` directly is on you. The plugin only owns
  the values it puts there.
- **Storage adapters must be synchronous.** The `Storage` interface is
  sync. Wrapping `IndexedDB` requires a sync-on-top-of-async shim;
  prefer a custom plugin if you need true async durability.

## See also

- [Time-travel & snapshots](https://github.com/directive-run/directive/blob/main/docs/PLAN.md)
  — in-memory state history vs durable persistence.
- [`createAuditLedger`](./audit-ledger.md) — durable, queryable,
  tamper-evident *event* persistence (not a state-restore layer).
- [`loggingPlugin`](./logging.md) — pair with `onError` to capture
  persistence failures in your structured logs.
