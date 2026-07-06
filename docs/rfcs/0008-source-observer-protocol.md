# RFC 0008 – Source publish: Observer-protocol posture (next / error / complete)

- **Status:** Accepted – shipped 2026-06-07 in `feat/source-primitive` (PR #52, merge `ab97b028`); pending v1.18.0 release
- **Author:** Jason Comes
- **Related:** the `source` primitive's public shape in
  `@directive-run/core`; the Observer / EventEmitter posture question
  for stream primitives.

## Summary

Today's `SourcePublishFn` exposes only the `next` arm of the RxJS
Observer protocol (`next/error/complete`). A source whose underlying
stream errors (WebSocket disconnect, Supabase channel goes stale,
polling fetch throws) has no canonical way to report it. Authors fall
back to publishing magic event names (`STREAM_ERROR`, `STREAM_ENDED`) –
fragmented per consumer, untyped.

This RFC takes an explicit posture: **adopt the EventEmitter shape, not
the RxJS Observer shape, but reserve the namespace so a future
additive minor can extend without breaking.**

## The two postures

### Option A – EventEmitter (recommended)

`SourcePublishFn` stays a bare function. Sources that need to surface a
runtime error route it through a dedicated `reportError` callback supplied
as a second argument to `attach`:

```ts
interface SourceDefinition {
  attach: (
    publish: SourcePublishFn,
    reportError: (err: Error) => void,    // NEW
    complete: () => void,                  // NEW
  ) => SourceUnsubscribeFn;
}
```

- `reportError(err)` lands as a `source.error` `ObservationEvent` with
  `phase: "runtime"` (new phase; existing `"attach"` and `"cleanup"`
  unchanged).
- `complete()` triggers the manager's per-source unsubscribe + fires
  `source.detach` with `reason: "completed"`. A one-shot OAuth callback
  source can self-detach without waiting for `system.stop()`.

### Option B – RxJS Observer

`SourcePublishFn` becomes an object with `next` / `error` / `complete`
methods. Maximally compatible with RxJS code; breaks every existing
source author's `publish('EVENT', payload)` call.

## Recommendation: Option A

- Today's API call shape (`publish('EVENT', payload)`) stays valid.
- The added `reportError` / `complete` arguments are positional, so
  authors who don't need them can keep using the one-arg `attach`
  signature (TS optional-parameter rules apply).
- The Observer-style users can wrap themselves: `const obs = { next:
  publish, error: reportError, complete }` inside their own attach.

## Type-wrap to reserve the namespace

In the meantime – without picking either posture yet – wrap
`SourcePublishFn` as an interface so future minors can add the
namespace:

```ts
// today (1.x)
export interface SourcePublishFn {
  (event: string, payload?: unknown): void;
}

// future minor (additive – interface gains optional methods)
export interface SourcePublishFn {
  (event: string, payload?: unknown): void;
  error?: (err: Error) => void;
  complete?: () => void;
}
```

The type-wrap is **the floor we can ship today** even if Option A's full
runtime story waits for a future minor. It guarantees Option A's
extension path is still available without a major bump.

## Acceptance criteria

- `SourcePublishFn` becomes an interface (was a bare callable type).
  Today's call shape is unchanged.
- A new variant `ObservationEvent.source.error.phase: "runtime"` is
  reserved in the discriminated union (additive – no consumer change).
- `SourcesManagerCallbacks.onError` gains a `"runtime"` phase value
  alongside `"attach"` and `"cleanup"`.
- Once Option A's runtime lands (separate PR), `attach` gains
  optional `reportError` + `complete` positional parameters.
- `packages/knowledge/core/sources.md` adds an "Error handling" section
  describing the Option A reportError pattern (today: publish a custom
  error event name; future: use `reportError`).
- The `EffectCleanup` vs `SourceUnsubscribe` asymmetry is addressed in
  the RFC 0006 naming sweep (`SourceUnsubscribe` →
  `SourceUnsubscribeFn`); this RFC does not duplicate that work.
