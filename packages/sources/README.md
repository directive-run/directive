# @directive-run/sources

Source adapters for [Directive](https://directive.run) — wrap external
event streams (Supabase realtime, Cloudflare DO alarms, WebSocket,
Sentry, etc.) as typed `source` primitives.

**One package, one install, subpath exports per vendor.** Vendor
peerDependencies are optional — only the vendors you import need their
peer-dependency installed.

## Install

```bash
pnpm add @directive-run/sources
# Plus whichever vendor SDKs you actually use:
pnpm add @supabase/supabase-js   # if importing /supabase
pnpm add @cloudflare/workers-types  # if importing /cloudflare (dev-time only)
```

## Subpath inventory

| Subpath | Factory | Wraps |
|---|---|---|
| `@directive-run/sources/supabase` | `sourceFromSupabaseChannel()` | Supabase realtime channel + per-row event mapping |
| `@directive-run/sources/cloudflare` | `sourceFromDOAlarm()` | Durable Object alarm as a periodic source |
| `@directive-run/sources/cloudflare` | `sourceFromWebSocketMessage()` | DO WebSocket message stream |

Future subpaths land additively (`/websocket` for raw browser WebSocket,
`/sentry` for production error stream, `/eventsource` for SSE, …).

## Quick examples

### Supabase realtime

```ts
import { createClient } from '@supabase/supabase-js';
import { createModule, createSystem, t } from '@directive-run/core';
import { sourceFromSupabaseChannel } from '@directive-run/sources/supabase';

const supabase = createClient(url, key);

const gameUpdates = createModule('gameUpdates', {
  schema: {
    facts: { snapshot: t.object<GameSnapshot>().nullable() },
    events: { GAME_UPDATED: { snapshot: t.object<GameSnapshot>() } },
  },
  init: (f) => { f.snapshot = null; },
  events: { GAME_UPDATED: (f, p) => { f.snapshot = p.snapshot; } },
  sources: {
    gameChannel: sourceFromSupabaseChannel({
      client: supabase,
      channel: `game:${gameId}`,
      events: [{
        table: 'games',
        filter: `id=eq.${gameId}`,
        event: 'UPDATE',
        map: (row) => ({ name: 'GAME_UPDATED', payload: { snapshot: mapRow(row.new) } }),
      }],
    }),
  },
});

const system = createSystem({ module: gameUpdates });
system.start();
// `system.facts.snapshot` updates automatically on every postgres UPDATE
```

### Cloudflare DO alarm

```ts
import { sourceFromDOAlarm } from '@directive-run/sources/cloudflare';

const ticker = createModule('ticker', {
  schema: {
    facts: { lastTick: t.number() },
    events: { TICK: { at: t.number() } },
  },
  init: (f) => { f.lastTick = 0; },
  events: { TICK: (f, p) => { f.lastTick = p.at; } },
  sources: {
    alarm: sourceFromDOAlarm({
      storage: this.state.storage,
      intervalMs: 30_000,
      eventName: 'TICK',
      payload: () => ({ at: Date.now() }),
    }),
  },
});
```

### Cloudflare DO WebSocket

```ts
import { sourceFromWebSocketMessage } from '@directive-run/sources/cloudflare';

const liveFeed = createModule('liveFeed', {
  schema: {
    facts: { lastMessage: t.string() },
    events: {
      MESSAGE: { content: t.string() },
      WEBSOCKET_CLOSED: { code: t.number(), reason: t.string() },
    },
  },
  init: (f) => { f.lastMessage = ''; },
  events: { MESSAGE: (f, p) => { f.lastMessage = p.content; } },
  sources: {
    socket: sourceFromWebSocketMessage({
      socket: server,                 // from webSocketAccept pair
      decode: (data) => {
        if (typeof data !== 'string') return null;
        return { name: 'MESSAGE', payload: { content: data } };
      },
    }),
  },
});
```

## Why an umbrella package

- **One install, one version, one changeset cadence.** No version skew
  between adapters.
- **Optional peer-dependencies.** Only consumers that import a vendor
  subpath need that vendor's peerDep installed.
- **One discovery surface.** "If I want a source adapter, I look in
  `@directive-run/sources`."
- **Cheap to add new vendors.** Each new adapter is a single subpath
  addition, not a whole new package + GitHub release + npm publish +
  README boilerplate.

This matches how `@directive-run/core` already uses subpath exports for
`/internals`, `/plugins`, `/testing`, `/migration`, `/worker`,
`/adapter-utils`.

## Related

- [`@directive-run/core` source primitive](https://github.com/directive-run/directive/blob/main/packages/knowledge/core/sources.md) — the underlying primitive these adapters wrap.
- [`@directive-run/ai` AI × Sources recipes](https://github.com/directive-run/directive/blob/main/packages/knowledge/ai/ai-sources.md) — `runStream({ liveContext })`, MCP lifecycle as a source.
- [Tier 0 PII guardrail](https://github.com/directive-run/directive/blob/main/packages/knowledge/ai/ai-security.md#sources-pii--closing-the-fact-injection-bypass) — `createFactPIIGuardrail` (wire whenever sources feed facts the agent reads).

## License

MIT or Apache-2.0
