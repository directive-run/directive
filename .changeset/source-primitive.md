---
"@directive-run/core": minor
---

Add `source` primitive — typed external event sources, the inbound dual of effects.

A `source` declares an external event subscription (Supabase realtime channel, WebSocket message stream, polling timer, browser event listener) as a first-class module field. The engine owns the lifecycle:

- `attach(publish)` runs once at `system.start()`. The synchronous callback receives a typed `publish` that dispatches into the same event queue as `system.events.X(payload)`.
- The returned `Unsubscribe` runs at `system.stop()` (and at `system.destroy()` via `stop`), in reverse-registration order across modules.
- Attach failures, missing-unsubscribe author mistakes, and unsubscribe throws are each isolated + logged via `console.error` — one bad source never blocks others (matches the effect + resolver isolation discipline).

This formalises the "hook-as-bridge" pattern used in 7+ call sites across downstream consumers (the Sizls workspace's `useActiveRoundSystem`, `useBattleRoyaleSystem`, `eventClaims.realtime.ts`, etc.) where a `useEffect` owned the Supabase channel and manually dispatched events on each message. With `sources` declared on the module, the lifecycle is engine-owned and the React hook collapses to `useFact` reads.

Usage:

```typescript
import { createModule, t } from '@directive-run/core';

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

New exports:
- `SourceDef`, `SourcesDef`, `SourcePublish`, `SourceUnsubscribe` (types).
- `ModuleConfig.sources?` and `ModuleConfigWithDeps.sources?` (cross-module dependency variant accepts sources too; sources don't access facts so they're not affected by the `facts.self.*` / `facts.{dep}.*` split).

Non-breaking: modules without a `sources` field continue to work identically.
