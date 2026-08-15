# Sources

> Covers `@directive-run/core` — `source` primitive: typed external event sources, the inbound dual of effects. Use for Supabase realtime channels, WebSocket message streams, polling timers, browser event listeners — any inbound external event that maps into the module's own event dispatch surface.

Sources sit on the same lifecycle plane as effects but mount once per system instance instead of on every fact change. `attach(publish)` runs at `system.start()`; the returned unsubscribe runs at `system.stop()`.

## When to use `source` vs `effect`

| Use a **source** when... | Use an **effect** when... |
|---|---|
| You're subscribing to an external event stream (WebSocket, Supabase realtime, browser `addEventListener`, polling timer) | You're updating an external system based on fact changes (logging, DOM mutation, analytics ping) |
| The subscription is **mount-once** for the system's lifetime | You need to re-run when a fact changes (`deps` or `on` predicate) |
| You want to publish events INTO the system | You only need to react to fact changes |
| You don't read facts inside the handler | You read facts (`facts.someValue`) inside `run` |

If you're hand-rolling `useEffect(() => { const ch = supabase.channel(...).subscribe(); return () => ch.unsubscribe(); }, [])` in React and dispatching `sys.events.X(payload)` from the callback — that's the signature pattern sources replace. Move the subscription into the module declaration; the React hook collapses to `useFact` reads.

## Decision Tree: "How should this subscription work?"

```
Do I need to subscribe to an external event stream?
├── Yes
│   │
│   ├─ Does the subscription depend on a fact (e.g. "subscribe when status = active")?
│   │  ├── Yes → Use `effect` with `deps` or `on` predicate. Effects re-run when facts change.
│   │  └── No  → Use `source`. Mount once at system.start(); tear down at system.stop().
│   │
│   ├─ Does the subscription need to read facts inside the callback?
│   │  ├── Yes → Consider hoisting the fact read up + using `effect`. Sources never read facts.
│   │  └── No  → Use `source`. Pass any static config via closure.
│   │
│   └─ Do I need to publish events INTO the system from external input?
│      └── Yes → Use `source`. The `publish` callback dispatches into the same queue as `system.events.X()`.
│
└── No → You probably want an effect, resolver, or event handler instead.
```

**If you take the `effect` branch, guard on the value.** An effect that owns a connection tears it down before every re-run, so what re-runs the effect decides how often the connection is dropped and rebuilt. A `deps` entry naming a *fact* wakes on a change — writing a fact its current value is not one, so nothing happens. A `deps` entry naming a *derivation* wakes whenever the facts underneath it move, whether or not the derived value moved with them: a derivation is lazy and has no value to compare at the moment its inputs change, and producing one would mean running it.

So `deps: ["shouldConnect"]` on a derivation reading `userId` and `beats` reconnects on every heartbeat, while `shouldConnect` stays `true` throughout. Keep the last value and return early when it has not moved:

```typescript
let connected: WebSocket | null = null;

effects: {
  socket: {
    deps: ["shouldConnect"],
    // `derived` is the third argument to run(), after facts and prevFacts. Read it
    // rather than reaching back through `system.derive` — that is the
    // single-module accessor and resolves a module NAME once composed.
    run: (_facts, _prevFacts, derived) => {
      const shouldConnect = derived.shouldConnect;
      if (shouldConnect === (connected !== null)) {
        return; // The value did not move — leave the socket alone.
      }
      if (!shouldConnect) {
        connected?.close();
        connected = null;
        return;
      }
      connected = new WebSocket("/ws");
    },
  },
}
```

The guard replaces the cleanup return rather than sitting beside it — a returned cleanup runs before every re-run, including the ones the guard exists to make into no-ops. The cost is that the socket is yours to close at `system.stop()`, since nothing holds a cleanup for it. The full note is on `EffectDef`.

A `source` does not have this shape at all — it mounts once at `system.start()` and tears down at `system.stop()` — which is a reason to prefer it whenever the subscription does not genuinely depend on a fact.

## Basic Source

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
        // Subscribe to the external source. The `publish` callback dispatches
        // into the system's event queue (same path as system.events.X()).
        const id = setInterval(() => publish('TICK', { delta: 1 }), 1000);
        // ALWAYS return a cleanup function. The engine calls it at system.stop().
        return () => clearInterval(id);
      },
    },
  },
});
```

## Supabase realtime channel

```typescript
import { createModule, t } from '@directive-run/core';
import { createClient } from '@supabase/supabase-js';

interface GameUpdateModuleDeps {
  readonly gameId: string;
  readonly subscribeToGameUpdates: (
    onUpdate: (snapshot: GameSnapshot) => void,
  ) => () => void;
}

export function createGameUpdateModule(deps: GameUpdateModuleDeps) {
  return createModule('gameUpdate', {
    schema: {
      facts: { snapshot: t.object<GameSnapshot>().nullable() },
      events: { REALTIME_UPDATE: { snapshot: t.object<GameSnapshot>() } },
    },
    init: (f) => { f.snapshot = null; },
    events: {
      REALTIME_UPDATE: (f, payload) => { f.snapshot = payload.snapshot; },
    },
    sources: {
      // apps/web supplies the Supabase channel via deps. The module
      // declaration stays pure — the source just calls deps and threads
      // the publish callback through.
      gameUpdates: {
        attach: (publish) =>
          deps.subscribeToGameUpdates((snapshot) =>
            publish('REALTIME_UPDATE', { snapshot }),
          ),
      },
    },
  });
}

// In your bootstrap (e.g. apps/web):
const supabase = createClient(/* ... */);
const module = createGameUpdateModule({
  gameId: 'g-123',
  subscribeToGameUpdates: (onUpdate) => {
    const channel = supabase
      .channel(`game:g-123`)
      .on('postgres_changes', { event: 'UPDATE', table: 'games', filter: 'id=eq.g-123' },
        (payload) => onUpdate(mapRow(payload.new)))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  },
});
```

## Browser event listener

```typescript
sources: {
  online: {
    attach: (publish) => {
      const onOnline = () => publish('CONNECTIVITY_CHANGED', { online: true });
      const onOffline = () => publish('CONNECTIVITY_CHANGED', { online: false });
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
      // Cleanup must remove BOTH listeners.
      return () => {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
      };
    },
  },
}
```

## Lifecycle

| Phase | What happens |
|---|---|
| `createSystem({ module })` | Sources are recorded in the manager but NOT attached yet |
| `system.start()` | Each source's `attach(publish)` runs in registration order. Errors are isolated — one failed source does not block others |
| `system.registerModule(newModule)` (system already running) | New module's sources attach IMMEDIATELY (no need to restart) |
| `system.stop()` | Each source's returned unsubscribe runs in **reverse** registration order |
| `system.destroy()` | Calls `stop()` first, so sources detach. After destroy, any stale publish callback the source closed over no-ops (the engine guards against post-destroy dispatch). |
| `system.start()` again (after stop) | Sources re-attach cleanly. The manager handles the start → stop → start lifecycle without leaking subscriptions. |

## Typed publish

The raw `publish: (event: string, payload?: unknown) => void` deliberately uses unchecked string event names — sources don't see the module schema and shouldn't be type-coupled to it. If you want compile-time event-name + payload safety, wrap `publish` once per source:

```typescript
import type { SourcePublish } from '@directive-run/core';

// Build a typed publisher up-front. Match the module's `events:` keys
// + payload shapes exactly. The TS compiler now catches typos.
function createPublisher(publish: SourcePublish) {
  return {
    TICK: (delta: number) => publish('TICK', { delta }),
    HEARTBEAT: () => publish('HEARTBEAT'),
  };
}

sources: {
  ticker: {
    attach: (publish) => {
      const p = createPublisher(publish);
      const id = setInterval(() => p.TICK(1), 1000); // ← typed
      return () => clearInterval(id);
    },
  },
}
```

The wrapper is purely a DX convention; the runtime path is unchanged. Recommended for any non-trivial source.

## Observation

Source lifecycle is fully observable. Subscribe via `system.observe()`:

```typescript
const unsub = system.observe((event) => {
  switch (event.type) {
    case 'source.attach': console.log(`${event.moduleId}::${event.id} attached`); break;
    case 'source.publish': console.log(`${event.id} → ${event.eventName}`); break;
    case 'source.detach': console.log(`${event.moduleId}::${event.id} detached`); break;
    case 'source.error':
      console.error(`${event.moduleId}::${event.id} ${event.phase} threw:`, event.error);
      break;
  }
});
```

`system.inspect().sources` lists the declared sources + `system.inspect().attachedSourceCount` reports how many are currently bound.

### Pipe `source.*` to OpenTelemetry

For production observability, `@directive-run/ai` ships
`attachSourcesToOtel(system, { tracer, serviceName })` which bridges
the lifecycle into OTel spans (one long-lived span per
`(sourceId, moduleId)`; publishes as span events; errors as
`directive.source.error` spans tagged with `phase`). See
[`../ai/ai-sources.md` § Observability](../ai/ai-sources.md#observability--pipe-source-events-to-opentelemetry)
for the full recipe; nothing in core depends on OTel so the bridge
lives next to the AI orchestrator's own span integration.

## Error handling — runtime errors via `reportError`

Per RFC 0008, `attach` receives an optional second argument: a
`reportError` callback. Authors route mid-flight errors from the
underlying stream (WebSocket disconnect, Supabase channel goes stale,
polling fetch throws) through this callback instead of inventing
magic event names like `STREAM_ERROR`. The manager fires
`onSourceError` with `phase: "runtime"` — distinct from `"attach"`
(setup failed) and `"cleanup"` (unsubscribe threw) — so the audit
ledger, logging plugin, and `inspect().sources[i].lastError`
attribute mid-flight failures correctly.

```typescript
sources: {
  socket: {
    attach: (publish, reportError) => {
      const sock = new WebSocket(url);
      sock.addEventListener("message", (e) =>
        publish("MSG", JSON.parse(e.data)),
      );
      sock.addEventListener("error", () =>
        reportError?.(new Error("WebSocket lost connection")),
      );
      return () => sock.close();
    },
  },
}
```

`reportError` is optional — short-lived transports that don't surface
mid-flight errors can ignore it. The callback type is exported as
`SourceReportError` from `@directive-run/core`. Error messages are
truncated at 256 chars at the manager boundary so authors who embed
payloads in error messages get a bounded leak surface.

## Backpressure — `coalesce: "lastWriteWins"`

Per RFC 0007, high-frequency sources (cursor moves, sensor telemetry,
price ticks, Supabase channel storms) declare `coalesce:
"lastWriteWins"` so the manager debounces same-event-name publishes
within one microtask. Per-event-name keying means a `priceTick` storm
coalesces while a one-shot `connected` event in the same tick still
dispatches.

```typescript
sources: {
  ticker: {
    attach: (publish) => {
      const id = setInterval(() => publish("TICK", { v: liveValue() }), 4);
      return () => clearInterval(id);
    },
    coalesce: "lastWriteWins",  // 250 publishes/sec → 1 dispatch/microtask
  },
}
```

Coalesce-dropped publishes bump `dropCount` + record
`lastDropReason: "coalesced"` on `inspect().sources` so operators
verify the debouncing is firing on the right sources. The strategy
is per-source (uniform across event names from that source) —
splitting strategies per event name requires two source declarations.

## Async-aware teardown — `system.stopAsync()` + DO `onEvict`

Per RFC 0009, sources with async unsubscribes (Supabase realtime's
`channel.unsubscribe()` returns a Promise; Cloudflare DO storage
flushes return Promises) work with both sync and async teardown:

- `system.stop()` (sync) — fires unsubscribes; awaits each one's
  return synchronously (Promise returns are fire-and-forget).
- `system.stopAsync()` (RFC 0009) — awaits each Promise-returning
  unsubscribe. Use when the caller needs teardown to actually
  complete (e.g. the external broker must drop the subscription
  before the next call).
- `system.evict(deadline?)` — Cloudflare DO eviction: fires each
  source's optional `onEvict()` in registration order, then
  `destroyAsync()`. Optional deadline races teardown against a
  wall-clock cutoff so the runtime can evict the isolate even if
  some sources hang.

Use the **holder + closure** bridge pattern (the same shape the MCP
recipe in `ai-sources.md` documents) so the `attach` and `onEvict`
sibling closures share the channel handle:

```typescript
// Holder shared between `attach` and `onEvict`. Both closures live
// inside the same `sources` object; declaring the channel above them
// keeps the handle reachable from both.
let channel: RealtimeChannel | null = null;

sources: {
  channel: {
    attach: (publish) => {
      channel = supabase.channel("game");
      channel.on("postgres_changes", { event: "UPDATE" }, (p) =>
        publish("ROW_UPDATED", p),
      );
      channel.subscribe();
      // Per RFC 0009, the unsubscribe MAY return a Promise; awaiting
      // it on `system.stopAsync()` ensures the broker has dropped the
      // subscription before the next start cycle re-attaches.
      return async () => {
        if (channel) await supabase.removeChannel(channel);
        channel = null;
      };
    },
    onEvict: async () => {
      // Cloudflare DO hibernate signal: close the channel actively
      // so the broker drops the subscription before the isolate dies.
      // The unsubscribe will also run, but onEvict fires first and
      // bounds the pre-hibernation work to a deadline.
      if (channel) await supabase.removeChannel(channel);
    },
  },
}
```

Inside a DO `alarm()` or `webSocketClose()` handler:
`await system.evict(/* deadline */ Date.now() + 5000)`.

## Runtime compatibility

The `source` primitive itself is runtime-agnostic — `attach`, `publish`,
`unsubscribe`, `onEvict`, and `coalesce` only depend on `Promise`,
`queueMicrotask`, and standard timers (all available in every modern
JS runtime). The matrix below covers the SHIPPED adapters in
`@directive-run/sources`; consumer-authored sources inherit each
runtime's standard guarantees.

| Runtime | Source primitive | `sourceFromSupabaseChannel` | `sourceFromDOAlarm` | `sourceFromWebSocketMessage` | Notes |
|---|---|---|---|---|---|
| **Cloudflare DO** | ✅ | ✅ (peerDep `@supabase/supabase-js` works in workerd) | ✅ default `onEvict` clears alarm | ✅ default `onEvict` closes socket 1001 | DO eviction recipe at top of this section; call `await system.evict(deadline)` from `alarm()` / `webSocketClose()`. |
| **Cloudflare Workers** | ✅ | ✅ | ✅ (needs DO `storage` handle) | ✅ (needs DO `WebSocket` handle) | Same recipes as DO; the 30s wall-clock budget applies to `cleanupAllAsync`. |
| **Bun** | ✅ | ✅ (Bun supports the `ws` transport supabase uses) | n/a (DO API) | n/a (DO API) | Sync `stop()` + async `stopAsync()` both work; Bun supports top-level `await`. |
| **Deno** | ✅ | ✅ via `npm:` specifier; needs `--allow-net` | n/a (DO API) | n/a (DO API) | Permissions: `--allow-net` for any transport; `--allow-env` for SUPABASE_URL / SUPABASE_KEY. |
| **Browser** | ✅ | ✅ | n/a (DO API) | partial — DOM `WebSocket` works with a thin adapter; the Cloudflare-typed helper is DO-specific | DOM `addEventListener` / `BroadcastChannel` / `visibilitychange` recipes inline above. |
| **Node** | ✅ | ✅ | n/a (DO API) | n/a (DO API) | Test target; vitest exercises every source path. |

The `@directive-run/sandbox` validator allowlists `@directive-run/sources`
and both subpaths, so the playground / `run_in_sandbox` MCP tool / docs
live runner all accept source-using snippets.

### Polling — when a transport is request/response only

When the upstream system has no push channel (REST endpoint, a polled
status URL, a `setInterval`-driven heartbeat), declare a polling source.
The runtime owns mount/unmount, the `onEvict` hook lets you cancel any
pending fetch before hibernation, and the engine's batching keeps the
per-tick fact mutations cheap:

```typescript
sources: {
  status: {
    attach: (publish, reportError) => {
      const controller = new AbortController();
      const tick = async () => {
        try {
          const res = await fetch(statusUrl, { signal: controller.signal });
          const body = await res.json();
          publish("STATUS_TICK", body);
        } catch (err) {
          // RFC 0008 — runtime errors go through reportError so they
          // route to source.error with phase: "runtime"; the source
          // stays attached.
          if ((err as { name?: string }).name !== "AbortError") {
            reportError?.(err);
          }
        }
      };
      const id = setInterval(tick, 5_000);
      void tick(); // first poll, immediate.
      return () => {
        clearInterval(id);
        controller.abort();
      };
    },
    coalesce: "lastWriteWins", // only the most recent tick survives a flush
  },
},
```

Choose the `coalesce` strategy that matches the consumer:
- `"lastWriteWins"` — gauge / dashboard updates where stale ticks
  don't matter.
- `"none"` — counters / time-series where every tick must land.
- `"all"` — currently an alias for `"none"`; reserved for future
  bounded-buffer semantics (do not depend on it).

## Common Patterns

### Pattern: Source supplies inbound; resolver supplies outbound

A Supabase realtime channel both INGESTS messages AND can SEND them back. The split is:

```typescript
// INGESTING — use a source. Mount once at system.start().
sources: {
  inbound: {
    attach: (publish) => channel.on('postgres_changes', ..., (p) => publish('UPDATE', p)).subscribe(),
  },
},
// SENDING — use a resolver. Fires on a constraint trigger.
resolvers: {
  sendMessage: {
    requirement: 'SEND_MESSAGE',
    resolve: async (req) => { await supabase.channel('chat').send(req); },
  },
}
```

### Pattern: Roster + reconnect

A source for the channel + an effect keyed on `isReconnecting` for refresh logic:

```typescript
sources: {
  channel: { attach: (publish) => connect(publish) },
},
effects: {
  refreshOnReconnect: {
    deps: ['isReconnecting'],
    run: (facts) => { if (facts.isReconnecting) refetch(); },
  },
}
```

### Anti-pattern: subscribe twice

Don't subscribe to the same channel inside BOTH an effect and a source. The effect re-runs on fact changes; the source mounts once. You'll get 2× messages with silent duplicates.

```typescript
// ❌ WRONG
sources: { channel: { attach: (p) => connect(p) } },
effects: {
  reconnect: {
    deps: ['userId'],
    run: (f) => { connect(p); },  // ← second subscription!
  },
},

// ✓ RIGHT — single source, key the resubscribe by re-registering the module
sources: { channel: { attach: (p) => connect(p) } },
// to change the channel, use system.registerModule() with a fresh module
// whose source attaches with new parameters.
```

### Anti-pattern: async `attach`

```typescript
// ❌ WRONG — attach is sync. A returned Promise is discarded; the engine
// has no cleanup function and any await result is unreachable.
sources: {
  bad: {
    attach: async (publish) => {
      const token = await getAuthToken();
      const ch = subscribe(token, publish);
      return () => ch.unsubscribe(); // ← never registered as cleanup
    },
  },
},

// ✓ RIGHT — do async work inside the subscription's own internals.
sources: {
  good: {
    attach: (publish) => {
      const ch = subscribe(publish); // sync subscribe stub
      // The subscribe impl can await internally and start publishing once ready.
      // The cleanup function is registered immediately.
      return () => ch.unsubscribe();
    },
  },
},
```

### Anti-pattern: forget the cleanup function

```typescript
// ❌ WRONG — returns undefined. The engine logs an error + skips the source.
sources: {
  bad: {
    attach: (publish) => {
      setInterval(() => publish('TICK'), 1000);
      // ← missing return!
    },
  },
},

// ✓ RIGHT — always return a function, even if there's nothing to clean up.
sources: {
  good: {
    attach: (publish) => {
      const id = setInterval(() => publish('TICK'), 1000);
      return () => clearInterval(id);
    },
  },
  // Or if the source genuinely has no teardown:
  fireAndForget: {
    attach: (publish) => {
      publish('READY');
      return () => undefined;
    },
  },
}
```

## Related

- `core-patterns.md` — where sources sit in the constraint-driven module model (decision tree).
- `multi-module.md` — declaring sources on multiple modules; collision rules.
- `system-api.md` — `system.start()` / `system.stop()` / `system.inspect()` / `system.observe()`.
- `anti-patterns.md` (#20) — "subscribe inside an effect / useEffect" anti-pattern; prefer sources.
- `naming.md` — canonical-term entry for `sources` + cross-paradigm aliases (RxJS Observable, DOM EventTarget, XState callback actor, Supabase realtime).
- [`../ai/ai-sources.md`](../ai/ai-sources.md) — AI integration: `runStream({ liveContext })`, MCP lifecycle as a source, the `@directive-run/sources/*` adapter subpaths.
- [`../ai/ai-security.md`](../ai/ai-security.md#sources--pii--closing-the-fact-injection-bypass) — `createFactPIIGuardrail`: closes the source → fact → agent-prompt PII bypass. Wire whenever sources publish into facts the agent reads.
