# @directive-run/mutator changelog

## 0.2.0

### Minor Changes

- [`dc4ac7b`](https://github.com/directive-run/directive/commit/dc4ac7b93007104ce4973d86fb3d6f6a5d1fcded) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add `cancellable()` HOC — auto-cancel-on-supersede for mutator handlers (R1.C v0.1)

  The third BUILD CANDIDATE from the AE-review-loop innovation pass. Wrap a mutator handler with `cancellable()` to get auto-cancellation: a fresh dispatch of the same wrapped handler aborts the prior in-flight invocation, OR an optional timeout fires the abort after N ms.

  ```ts
  import { defineMutator, cancellable } from "@directive-run/mutator";

  const formMutator = defineMutator<MyMutations, MyFacts>({
    search: cancellable(
      { supersedeOn: "self", timeoutMs: 3_000 },
      async ({ payload, facts, signal }) => {
        const res = await fetch(`/q?${payload.q}`, { signal });
        facts.results = await res.json();
      }
    ),
    submit: async ({ payload, facts }) => {
      facts.values = await deps.submit(payload.values);
    },
  });
  ```

  **Two cancellation triggers, both opt-in:**

  - `supersedeOn: 'self'` (default) — new dispatch supersedes prior
  - `supersedeOn: 'never'` — only timeout fires; parallel runs are fine
  - `timeoutMs: number` — abort after N ms from invocation start

  **Test ergonomics.** Pass `virtualClock.setTimeout` from `@directive-run/core` via the `setTimeout` option to make timeouts fire synchronously under `clock.advanceBy(ms)` — no real-time waits.

  The signal's `.reason` carries a typed `CancelReason`:

  ```ts
  type CancelReason =
    | { kind: "superseded" }
    | { kind: "timeout"; afterMs: number };
  ```

  **Composition.** Drops in directly to `defineMutator`'s handler map slot. Two separate `cancellable()` HOCs around different handlers do NOT cancel each other — the supersession registry is closure-scoped per call.

  **v0.1 scope:** `cancellable()` is a value-layer HOC; engine-side never sees a difference between a wrapped handler and a plain async one. v0.2 will explore the timeline integration so `expect(timeline).toCancel('search')` matchers can assert against the abort stream.

  9 new tests covering basic invocation, supersession (both modes), timeout (using virtualClock for determinism), supersession+timeout composition, HOC independence.

## 0.1.0 — 2026-04-29

Initial release.

### Added — v0.2 (R1.C cancellable)

- `cancellable(opts, handler)` — HOC that wraps a mutator handler with
  auto-cancellation. Receives a `signal: AbortSignal` in the handler
  context. Two cancellation triggers: `supersedeOn: 'self' | 'never'`
  (default `'self'`) and `timeoutMs?: number`. The signal's `reason`
  carries a typed `CancelReason` distinguishing `{kind:'superseded'}`
  from `{kind:'timeout', afterMs}`. Pass `setTimeout` from
  `virtualClock` for deterministic test timing.
- `CancellableOptions`, `CancellableHandlerContext<F, P>`,
  `CancelReason` type exports.

### Added — v0.1

- `defineMutator(handlers)` — typed builder that returns six fragments
  (facts / events / requirements / eventHandlers / constraints /
  resolvers) wiring a discriminated `pendingMutation` lifecycle into a
  Directive module.
- `mutate(kind, payload?)` — typed payload constructor for `MUTATE`
  dispatches.
- Single-flight concurrency model: new mutations overwrite in-flight ones
  via the `pendingMutation` fact.
- Error capture: thrown handlers surface on `pendingMutation.error`
  with `status: 'failed'` (a distinct status from `'running'` so the
  UI can disambiguate; the constraint stops firing).
- Built on `@directive-run/core@^1.2.0` (requires `ctx.requeue` for
  handler-cascade chains).

### Known gaps

- Parallel-of-same-shape mutations not supported — last-write-wins.
- No runtime payload validation — TypeScript only at dispatch site.
- Optimistic / snapshot-rollback support belongs to upcoming
  `@directive-run/optimistic`; do manual rollback inside handlers for
  now.

### Why the 0.x version

This package collapses a real-world boilerplate pattern but the API
shape (six-spread vs builder vs HOC) is still being validated against
production use. v1.0 ships once at least three external consumers have
worn the API end-to-end.
