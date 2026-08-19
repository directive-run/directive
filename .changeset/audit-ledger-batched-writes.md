---
"@directive-run/core": minor
---

Batched fact writes now reach `system.observe()`, and three defects underneath
it are fixed.

The observation bridge implemented the single-write plugin hook and not the
batch one. The store defers notifications inside a batch and reports the whole
set at the end, so every write made in a batch was absent from the observation
stream: a module's `init`, hydrated state, an effect's writes, anything a
resolver wrote before its first await — and event handler writes, which is how
most applications change state at all. Measured on a system dispatching 100
events that wrote 200 facts: 0 `fact.change` events before, 203 after.

Widening that stream exposed three problems that were dormant only because the
stream was empty:

- **A plugin's `onInit` no longer waits on a microtask when it is synchronous.**
  Every plugin's `onInit` was wrapped in a resolved promise and awaited, so a
  plugin that subscribed there missed everything a synchronous `start()` did
  before its turn. Whether an audit trail held the system's opening state — a
  fact tagged `pii` among it — depended on the plugin's position in the array.
  An async `onInit` still suspends, and plugins after it still wait.
- **A listener that writes during a flush no longer duplicates the batch it is
  reacting to.** The batch buffer was cleared after the notify phase rather than
  before, so a nested batch re-reported the outer batch's changes. Three writes
  produced five records in an append-only, hash-chained log.
- **Replaying history is marked rather than recorded as a write.** A rewind
  moves state through a batch; `fact.change` now carries `origin: "restore"` so
  an observer still sees it and a durable sink can drop it.

Errors are isolated per change, so one failing observer loses its own event
rather than the rest of the batch.

Volume is now real where it was none, and there is no sampling or retention
control between the emitter and a sink — worth checking before pointing one at
durable storage.
