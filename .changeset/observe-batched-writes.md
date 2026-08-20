---
"@directive-run/core": minor
---

Batched fact writes now reach `system.observe()`, and therefore anything built
on it.

The observation bridge implemented the single-write plugin hook and not the
batch one. The store defers notification for the duration of a batch and hands
over the whole set at the end, so every write made in a batch was absent from
the observation stream: a module's `init`, hydrated state, an effect's writes,
whatever a resolver writes before its first await — and every write an event
handler makes, which is how most applications change state at all. Measured on a
system dispatching 100 events that wrote 200 facts: 0 `fact.change` events
before, 203 after. An audit ledger on a running application recorded almost
nothing.

`FactChange` and the `fact.change` event gained an optional `origin`, set to
`"restore"` for writes made by replaying history. It is recorded on the change
at the moment it is made rather than inferred later, so a rewind nested inside
another batch still carries it and an ordinary write made while a rewind settles
still does not. `system.observe()` reports both; the audit ledger keeps the
second and drops the first, because a rewind is not something the application
did.

`store.batch()` takes an optional `{ origin }` for the same reason.

Volume is now real where it was none, and there is no sampling or retention
control between the emitter and a sink — worth checking before pointing one at
durable storage.
