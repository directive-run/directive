# RFC 0009 – Async-aware `system.stop()` + Durable Object eviction hook

- **Status:** Accepted — shipped 2026-06-07 in `feat/source-primitive` (PR #52, merge `ab97b028`); pending v1.18.0 release
- **Author:** Jason Comes
- **Related:** R5 distributed-systems reviewer findings (R5-CR1:
  `system.stop()` doesn't await async unsubscribes; R5-CR4: DO eviction
  has no recovery hook); `docs/IDEAS.md` Tier 1 architectural follow-up.

## Summary

Two related lifecycle gaps from the R5 distributed-systems audit:

1. **`system.stop()` fires-and-forgets async unsubscribes.** Supabase
   realtime's `channel.unsubscribe()` returns a Promise. The manager
   today discards the Promise (the type is `() => void`); external
   subscriptions can outlive `system.stop()`'s resolution by indefinite
   time. Cascades into double-subscription bugs when an outer harness
   calls `system.start()` again expecting clean teardown.

2. **Cloudflare DO eviction has no recovery hook.** When a DO is evicted
   mid-attach (or after attach, before stop), external subscriptions
   become ghosts on the broker. At 1000+ DO scale, the broker's
   subscription-count gauge climbs and never clears until TTL
   driven cleanup. Visible as "phantom presence" bugs.

This RFC widens `SourceUnsubscribeFn` to `() => void | Promise<void>`,
makes the manager + `system.stop()` async-aware, and adds an optional
`onEvict` hook on `SourceDef` for fleet runtimes that can deliver an
eviction signal.

## Proposed API

### Async unsubscribe

```ts
// types/sources.ts
export type SourceUnsubscribeFn = () => void | Promise<void>;

// SourcesManager
interface SourcesManager {
  cleanupAll(): Promise<void>;       // was: void
  // attachAll, registerDefinitions, listDefinitions unchanged
}

// System
interface System<...> {
  stop(): Promise<void>;             // was: void
  destroy(): Promise<void>;          // was: void
  // start, settle unchanged
}
```

**Breaking-change posture:** `system.stop()` and `system.destroy()`
return types change from `void` to `Promise<void>`. Most callers already
`await system.settle()` after start; calling `system.stop()` without
await is the existing pattern that silently breaks. The migration is:

```ts
// before (1.x)
system.stop();

// after (2.0 — semver major bump required)
await system.stop();
```

To avoid the major bump, we could ship a parallel `stopAsync` /
`destroyAsync` method and leave the sync ones as fire-and-forget. Less
clean but no semver pain. **Recommendation:** ship `stopAsync` /
`destroyAsync` in 1.x; deprecate the sync variants; collect the rename
into the 2.0 cut.

### DO eviction hook

```ts
interface SourceDefinition {
  attach: (publish: SourcePublishFn) => SourceUnsubscribeFn;
  meta?: DefinitionMeta;
  coalesce?: "none" | "lastWriteWins" | "all";  // see RFC 0007
  /**
   * Called when the host runtime signals that the isolate is about to be
   * evicted (Cloudflare DO `webSocketAcceptWithTags` storm, Workers
   * memory pressure, etc.). Use this to actively close external
   * subscriptions BEFORE the isolate dies, so the broker / remote
   * service doesn't accumulate ghost subscriptions.
   *
   * Distinct from `unsubscribe()`: eviction can fire WITHOUT a
   * `system.stop()` having been called. The host runtime invokes this
   * via a new `system.evict()` method (also additive).
   */
  onEvict?: () => void | Promise<void>;
}
```

```ts
// System
interface System<...> {
  /**
   * Signal that the host runtime is about to evict the isolate.
   * Fires every source's `onEvict()` in registration order, then calls
   * `destroy()`. The whole call is awaitable up to a runtime-supplied
   * deadline.
   */
  evict(deadline?: number): Promise<void>;
}
```

The DO consumer wires it in their `alarm()` or
`webSocketClose()` handler before letting Cloudflare evict the isolate.

## Acceptance criteria

- `SourceUnsubscribeFn` widens to `() => void | Promise<void>` (purely
  additive — existing sync unsubscribes continue to satisfy the type).
- `SourcesManager.cleanupAll` becomes async.
- New `System.stopAsync()` + `System.destroyAsync()` methods land
  additively in 1.x. The sync `stop` / `destroy` are deprecated but
  preserved.
- New `SourceDef.onEvict` optional hook lands additively.
- New `System.evict(deadline?)` method lands additively.
- The R5 DO ghost-subscription scenario passes a regression test (mock
  DO evict + assert external subscriptions terminate).
- `packages/knowledge/core/sources.md` adds a "Runtime compatibility"
  section covering DO/Workers/Bun/Deno (closing R5-M1, R5-M3, R5-M4 from
  the cross-runtime review).
- 2.0 changeset (separate) notes the `stop` / `destroy` async-only cut.
