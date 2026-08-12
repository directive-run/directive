---
"@directive-run/core": patch
---

**An effect's write now reaches a constraint gated on a derivation, and `settle()` no longer reports quiescence while holding an announcement it has not made.**

The invalidation drain ran once per reconcile, before the effects phase. An effect that writes a fact invalidates whatever derivations read that fact, and those landed *after* the only pass that read them — so the announcement missed the constraint evaluation immediately following, the pass ended with its changed-key set cleared, and nothing was scheduled to carry it. The derivation still returned the right value on every read; only the wake-up was lost, which is why this survived snapshot assertions and presented as "it works when I check it by hand."

`settle()` then resolved. A request handler that settles before responding returned pre-resolution state; a durable object that settles before persisting and hibernates dropped the requirement entirely.

Two changes. The drain now also runs after the effects phase, so constraints see what effects moved — it early-returns on an empty set, so a reconcile in which no effect wrote pays one size check. And settlement accounts for undelivered announcements, so a system cannot report itself finished while it still has something to say.

`system.inspect()` gains `pendingInvalidations`. Zero on a system that has finished; non-zero on one that has merely stopped. No other field distinguished those two states, and the difference is exactly what separates a correct settle from a premature one.

### One case deliberately left open

An **effect** gated on a derivation that another effect's write invalidates is still not woken in that reconcile. Constraints are; effects are not.

Reaching effects means carrying the keys into the following pass, and that is the shape of a fix that was written and withdrawn once already: an effect that writes a fact inside its own dependency set then has no damping — a repeated value is suppressed by identity, but a changing one is not — and the reconcile loop runs away. Re-measured while preparing this change: 2,001 effect runs in 41 ms, bounded only by the probe's own counter.

Closing it needs a bound on that feedback path, which is its own change. The boundary is now pinned by tests on both sides, so the next attempt starts from a description of the behavior rather than from silence.

### If you construct a `SystemInspection`

`pendingInvalidations` is required, not optional — it is always present in real engine output, and making it optional would force every reader to handle an `undefined` that never occurs. Test doubles and mocks that build the shape by hand need the field added.
