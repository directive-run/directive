---
"@directive-run/core": minor
"@directive-run/timeline": minor
---

**A write made inside `system.batch()` now reaches `system.observe()`.** It did
not before. The bridge behind `observe()` implemented the single-write hook and
not the batched one, so the audit ledger — and anything else observing — saw an
unwrapped write and missed the identical wrapped one.

That is not a corner of the API. Event handlers, effects, resolvers before their
first `await`, `initialFacts`, `hydrate` and every history navigation write
through a batch, so most of the writes a running system makes were arriving on
the path that recorded nothing. Suppressing an entry needed no privileged handle
and no forged label: wrapping the write was enough, while the plain write beside
it was recorded in full.

**Each key gets one entry per batch**, carrying the value it held before the
batch and the value it holds after. A batch is a single transition, and a body
that writes one key in a loop should not produce an entry per iteration — a
hundred thousand writes to a single key in one batch coalesce to one entry. A
key written and then written back keeps its entry with `prior` and `next` equal;
that reads as noise, but a batch that leaves no trace at all is worse.

**Replayed writes are filed, not dropped.** A write a history navigation
replayed — `restore`, `goBack`, `goForward`, `goTo`, `replay`, `import` — now
carries `origin: "restore"` on the `fact.change` event and on the ledger entry.
A write your program made carries no `origin` at all. Dropping replays instead
would put a label in charge of whether an entry exists, and a label worth that
much is worth forging; filing them puts it in charge of nothing more than which
rows an auditor reads together. The label is set from the history manager's own
state, so reaching it means actually replaying a snapshot. `@directive-run/timeline`
marks a restored write rather than rendering it as something the program just did.

**Expect more events.** On a workload of a hundred event dispatches touching
three facts each, the observation stream goes from 99 events to 399 — the
difference is the writes that were previously invisible. A system's starting
state now appears in the trail too, because `init` writes through a batch. If
you are on the default in-memory sink, it holds 10,000 entries and will rotate
sooner.
