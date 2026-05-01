---
"@directive-run/mutator": minor
---

R2.B: `recordReplayable()` HOC — structured cancellation events for replay-aware mutations

Wraps a mutator handler with the same supersession + timeout semantics as `cancellable()`, plus a synchronous `onCancel` callback that fires the moment the AbortController calls `abort()`. The callback receives a `CancelEvent<F, P>` carrying:

- `kind: 'superseded' | 'timeout'`
- `afterMs?: number` (timeout only)
- `payload: P` — the dispatch that did NOT complete
- `dispatchSeq: number` — per-handler monotonic counter
- `facts: F` — live facts reference

Use `onCancel` to pin cancellations into a place that survives in the timeline (typically a facts array). Without that, a replay re-dispatches the same MUTATE events but has no record of which were superseded vs which completed — so timeline diff/bisect tools cannot reason about cancellations without parsing free-form error strings.

```ts
import { defineMutator, recordReplayable } from "@directive-run/mutator";

const search = recordReplayable<MyFacts, { q: string }>(
  {
    supersedeOn: "self",
    timeoutMs: 3_000,
    onCancel: ({ facts, kind, payload, dispatchSeq }) => {
      facts.cancellations.push({ kind, queryAtCancel: payload.q, seq: dispatchSeq });
    },
  },
  async ({ payload, facts, signal }) => {
    const res = await fetch(`/q?${payload.q}`, { signal });
    facts.results = await res.json();
  },
);
```

Implementation note: `recordReplayable()` is `cancellable(opts, innerHandler)` where `innerHandler` adds a `signal.addEventListener('abort')` around the user's handler. Timeout / supersession semantics are EXACTLY those of `cancellable()` — the HOC is purely additive. The abort listener fires synchronously, BEFORE the handler's pending await rejects with AbortError, so the callback sees the freshest possible state.

`onCancel` errors are caught and swallowed — the abort path stays clean.

9 new tests covering: clean run no-op, supersession callback delivery, dispatchSeq monotonic per HOC, two HOCs maintain independent counters, timeout callback delivery with afterMs preserved, onCancel-throw robustness, non-CancelError abort filter, CancelError class hierarchy.
