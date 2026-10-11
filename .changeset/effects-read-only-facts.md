---
"@directive-run/core": minor
"@directive-run/query": patch
"@directive-run/lint": patch
"@directive-run/knowledge": patch
"@directive-run/claude-plugin": patch
---

Effects can no longer write facts, and effects re-run after a history rewind.

**Effects are read-only.** An effect is for talking to the outside world: a
log line, the DOM, a socket. A fact written from one used to be accepted and
then handled halfway. Constraints and derivations saw the write, but other
effects never did, so a view effect stayed on the old value with nothing
reporting why. The `facts` an effect receives is now a read-only view.
Assigning to it, deleting from it, or writing through `facts.$store` throws in
development, with a message naming what to use instead, and is ignored in
production. This holds after an `await`, inside the cleanup the effect
returns, and in any callback the effect starts. `EffectDef.run` now types
`facts` as `Readonly`, so most of these writes are caught by the compiler too.

Where the write belongs instead:

- a change caused by input: an event handler
- a value computed from other facts: a derivation
- work a constraint requires: a resolver
- data coming back from async work: a source that publishes an event, or a
  resolver

If you relied on writing from an effect, move that line to one of the above.
Dispatching an event from an effect is unchanged.

**Effects re-run after `goBack()`, `goForward()`, `goTo()`, `replay()` and
`import()`.** A rewind restores facts without reconciling them, which is right
for constraints and resolvers but left effect-driven views (a canvas, the DOM,
the document title) showing the state from before the rewind. Effects whose
dependencies were restored now run again. No snapshot is taken and gated
sources are not re-attached in that pass, so redo and transports are
unaffected. Set `onNavigate: "skip"` on an effect that records acts rather than
mirroring state, such as analytics.

`@directive-run/query` keeps its stream, polling, focus, reconnect and cache
expiry effects working through an internal bridge while they move to sources.
