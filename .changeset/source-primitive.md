---
"@directive-run/core": minor
---

Add `source` primitive — typed external event sources, the inbound dual of effects.

A `source` declares an external event subscription (Supabase realtime channel, WebSocket message stream, polling timer, browser event listener) as a first-class module field. The engine owns the lifecycle:

- `attach(publish)` runs once at `system.start()`. The synchronous callback receives a typed `publish` that dispatches into the same event queue as `system.events.X(payload)`.
- The returned `Unsubscribe` runs at `system.stop()`, in reverse-registration order across all modules.
- The full **start → stop → start → stop** lifecycle is supported — each `attachAll` re-arms the manager and a fresh attach runs.
- Sources brought by `system.registerModule(...)` AFTER `start()` attach **immediately** using the captured publisher.
- Source attach + unsubscribe failures are isolated per source (logged via `console.error` AND forwarded to the new `onSourceError` plugin hook) — one bad source never blocks others.
- The publish callback **guards against post-destroy dispatch** — a source author who retains the callback past `destroy()` cannot dispatch into the torn-down store.

This formalises the "hook-as-bridge" pattern used in 7+ call sites across downstream consumers (Minglingo's `useActiveRoundSystem`, `useBattleRoyaleSystem`, `eventClaims.realtime.ts`, etc.) where a `useEffect` owned the realtime channel and manually dispatched events on each message. With `sources` declared on the module, the lifecycle is engine-owned and the React hook collapses to `useFact` reads.

Usage:

```typescript
import { createModule, t, type SourcePublish } from '@directive-run/core';

const counter = createModule('counter', {
  schema: {
    facts: { count: t.number() },
    events: { TICK: { delta: t.number() } },
  },
  init: (f) => { f.count = 0; },
  events: {
    TICK: (f, payload) => { f.count = f.count + payload.delta; },
  },
  sources: {
    heartbeat: {
      attach: (publish) => {
        const id = setInterval(() => publish('TICK', { delta: 1 }), 1000);
        return () => clearInterval(id);
      },
    },
  },
});
```

**Observability.** Source lifecycle is fully observable via `system.observe()`:

```typescript
system.observe((event) => {
  switch (event.type) {
    case 'source.attach':  /* { id, moduleId } */ break;
    case 'source.publish': /* { id, moduleId, eventName } */ break;
    case 'source.detach':  /* { id, moduleId } */ break;
    case 'source.error':   /* { id, moduleId, phase, error } */ break;
  }
});
```

Or via the plugin API (`onSourceAttach`, `onSourcePublish`, `onSourceDetach`, `onSourceError`).

`system.inspect().sources` lists declared sources with their owning `moduleId`, and `system.inspect().attachedSourceCount` reports the live count.

New exports:
- `SourceDef`, `SourcesDef`, `SourcePublish`, `SourceUnsubscribe` (types).
- `ModuleConfig.sources?` and `ModuleConfigWithDeps.sources?` (cross-module dependency variant accepts sources too; sources don't access facts so they're not affected by the `facts.self.*` / `facts.{dep}.*` split).
- `system.registerModule({ sources })` — dynamic sources attach immediately when the system is already running.
- `system.inspect().sources` + `system.inspect().attachedSourceCount`.
- Four new `ObservationEvent` variants: `source.attach`, `source.publish`, `source.detach`, `source.error`.
- Four new Plugin hooks: `onSourceAttach`, `onSourcePublish`, `onSourceDetach`, `onSourceError`.

Documentation:
- New knowledge file `packages/knowledge/core/sources.md` with decision tree, recipes (Supabase, browser events), lifecycle table, observation snippet, common patterns + anti-patterns.
- `packages/knowledge/core/anti-patterns.md` gains a "hand-rolled subscription instead of `source`" entry.
- `packages/knowledge/sitemap.md` indexes sources under Core API.
- `packages/knowledge/api-skeleton.md` lists the four new exported types.

Non-breaking: modules without a `sources` field continue to work identically.
