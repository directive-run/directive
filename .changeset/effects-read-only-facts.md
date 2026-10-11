---
"@directive-run/core": minor
"@directive-run/query": patch
"@directive-run/lint": patch
"@directive-run/knowledge": patch
"@directive-run/claude-plugin": patch
---

Effects can no longer write facts, effects re-run after a history rewind, and
writes made while a pass is running are no longer lost.

**Effects are read-only.** An effect is for talking to the outside world: a
log line, the DOM, a socket. A fact written from one used to be accepted and
then handled halfway. Constraints and derivations saw the write, but other
effects never did. Now:

- Each effect receives its own read-only view of the facts. It is a different
  object from `system.facts`, with no prototype, so identity checks against
  `system.facts` no longer match inside an effect.
- Assigning to it, deleting from it, or writing through `facts.$store` throws
  in development with a message naming the effect, the key, a one-line example
  and a docs link (`/docs/effects#effects-never-write-facts`). Production drops
  the write.
- In development, plain objects and arrays read through it are read-only too,
  so `facts.pos.x = 7` and `facts.list.push(item)` throw instead of mutating
  the stored value without a sound. Production does not wrap them.
- Every refused write is reported in every build through the new plugin hook
  `onEffectWriteBlocked(id, key)` and the `effect.write-blocked` observation
  event, which is how a production build sees the write it dropped.
- `EffectDef.run` types `facts` as `Readonly`, and a cross-module effect's
  `facts.self` and dependency namespaces are read-only one level down.

Where the write belongs instead: an event handler for a change caused by
input, a derivation for a computed value, a resolver for work a constraint
requires, and a source or resolver for data coming back from async work.
Dispatching an event from an effect is unchanged.

**Effects re-run after `goBack()`, `goForward()`, `goTo()`, `replay()` and
`import()`.** Effect-driven views (a canvas, the DOM, the document title) used
to stay on the state from before the rewind. Effects whose dependencies were
restored now run again. That pass takes no snapshot, attaches no gated
sources, and dispatches no resolvers. An effect that dispatches an event while
re-running for a rewind gets a development warning; set `onNavigate: "skip"`
on effects that record acts rather than mirror state. Writes such an effect
causes belong to the navigation, so they no longer destroy the redo stack.

**Fixed: requirements after a rewind.** The requirement set from before the
rewind stayed as the baseline, so a later write that satisfied a constraint
again did not dispatch its resolver. A rewind now rebuilds the baseline from a
full evaluation, without dispatching.

**Fixed: writes made while a pass is running.** A write that landed while
effects were running (an event an effect dispatched, a captured
`system.facts`, a caller writing while an async effect awaited) reached
constraints but never effects. The first write right after `start()` was lost
the same way. These writes now carry into the next pass. A chain of passes
started only by such writes is cut after 100 passes with a development
warning, so an effect that feeds its own dependency cannot spin. The `retry`
error strategy for effects now retries at most three times in a row.

`@directive-run/query` keeps its stream, polling, focus, reconnect and cache
expiry effects writing through an internal capability while they move to
sources, and marks them `onNavigate: "skip"` so a rewind does not re-subscribe
a stream or re-arm a timer. `@sizls/ai-harness` closes its composition from a
constraint and resolver instead of an effect.
