---
"@directive-run/mutator": minor
---

Add `cancellable()` HOC — auto-cancel-on-supersede for mutator handlers (R1.C v0.1)

The third BUILD CANDIDATE from the AE-review-loop innovation pass. Wrap a mutator handler with `cancellable()` to get auto-cancellation: a fresh dispatch of the same wrapped handler aborts the prior in-flight invocation, OR an optional timeout fires the abort after N ms.

```ts
import { defineMutator, cancellable } from '@directive-run/mutator';

const formMutator = defineMutator<MyMutations, MyFacts>({
  search: cancellable(
    { supersedeOn: 'self', timeoutMs: 3_000 },
    async ({ payload, facts, signal }) => {
      const res = await fetch(`/q?${payload.q}`, { signal });
      facts.results = await res.json();
    },
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
  | { kind: 'superseded' }
  | { kind: 'timeout'; afterMs: number };
```

**Composition.** Drops in directly to `defineMutator`'s handler map slot. Two separate `cancellable()` HOCs around different handlers do NOT cancel each other — the supersession registry is closure-scoped per call.

**v0.1 scope:** `cancellable()` is a value-layer HOC; engine-side never sees a difference between a wrapped handler and a plain async one. v0.2 will explore the timeline integration so `expect(timeline).toCancel('search')` matchers can assert against the abort stream.

9 new tests covering basic invocation, supersession (both modes), timeout (using virtualClock for determinism), supersession+timeout composition, HOC independence.
