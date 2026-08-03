---
"@directive-run/core": minor
---

**A constraint or effect that reads a derivation now re-evaluates when that derivation changes.** It did not before, so one gated purely on a derivation ran once, at startup, and never again.

Constraints and effects auto-track what their bodies read, and that tracking was incomplete in two places that compounded:

- Reading a derivation through `system.derive.total` did not register a dependency. Reading the same value as `derived.total` from inside another derivation's body did. Two doors onto one value, and only one of them recorded that the read happened.
- Even where a dependency on a derivation was recorded, incremental evaluation compared dependencies against the set of changed **fact** keys. A derivation ID never appears in that set, so the derivation half of every tracked dependency matched nothing.

The visible symptom is a constraint that will not fire. The derivation flips, every direct reader sees the new value, `system.derive.total` returns it correctly — and the constraint keeps answering with whatever it computed at startup, because nothing knew it cared.

```typescript
derive: {
  overBudget: (facts) => facts.spent > facts.limit,
},
constraints: {
  halt: {
    // Evaluated once. `spent` changing did not bring it back, because the
    // dependency recorded here was `overBudget`, and only fact keys were
    // ever matched against.
    when: (facts, derived) => derived.overBudget,
    require: { type: "HALT" },
  },
},
```

**What changes for you.** A constraint or effect in this shape starts re-evaluating, which means requirements that never fired may begin firing and effects that ran once may begin running again. That is the documented behavior of auto-tracking, and code written against the documentation is what starts working. But a system built around the old behavior — even unknowingly — will see new activity, which is why this is a minor rather than a patch.

Gating on facts alone is unaffected, and there is a test pinning that. The invalidation set is tracked separately from changed fact keys, so history snapshot labels still describe facts, and a derivation going stale without any fact changing cannot make a settled system look dirty.

**Facts and derivations no longer share a keyspace.** A module may declare `facts.ready` alongside `derivations.ready`, and nothing rejects it. Dependency sets and the invalidation set carry both kinds of name, so while they were one flat string keyspace the lookup for either returned the union of both: a constraint gated on the *fact* re-evaluated when the *derivation* went stale, and an effect gated on the fact re-ran. Derivations are namespaced inside those sets now, so the two names are two keys.

The same namespace fixes a second, older collision in the opposite direction. Which map a derivation's dependency was filed in was decided by asking whether the *name* was also a derivation — so a derivation reading `facts.ready`, in a module with a `ready` derivation beside it, had its fact dependency filed under derivations and was never invalidated when the fact changed.

Introspection is unaffected in shape and clearer in content: `getDependencies()`, the devtools trace, and `explain()` render a dependency on a derivation as `derive.total` rather than a bare `total`, and `explain()` now shows the derivation's value where it previously showed `undefined`. The dev-mode warning for a shadowed name stays, but says what it now costs — legibility, not correctness.

**An async effect that reads nothing it can be woken by now says so.** Auto-tracking is a synchronous stack and closes when the body returns its promise, so an `async` effect whose reads are all past its first `await` records no dependencies at all — and an effect with no dependencies runs on every reconcile. It fires, so it looks like it works; what it has lost is any relationship between when it fires and what it reads. Development-mode warning, once per effect. Declare `deps`, or move the reads above the first `await`.

This deliberately does not warn on every async auto-tracked effect the way core warns on every async constraint without `deps`. There is a correct shape — hoist the reads — and nothing tells it from the broken one at runtime, so a broad warning would fire on correct code with no way to say so. The empty dependency set is the unambiguous case.

**An explicit `deps` entry may name a derivation.** It could not before, in either direction: `deps: ["someDerivation"]` was matched only against fact keys, so it silently matched nothing and the effect never woke; and `EffectDef["deps"]` was typed `Array<keyof InferSchema<S>>`, so writing it did not compile in the first place. Both are fixed, and they had to be fixed together — the type refused the correct code, and the runtime ignored it if you cast past the refusal.

This closes the gap the async-effect warning above points at. That warning tells you to declare `deps`, and for an async effect whose reads are all derivations, `deps` was exactly the thing that did not work. An async constraint was in the same position: auto-tracking cannot see past its first `await`, and `deps` was its only way to name a dependency, so a derivation dependency could not be expressed at all.

A fact and a derivation of the same name resolve to the fact. `deps` has meant fact keys for as long as it has existed, so the older meaning wins; the name collision itself still warns, as it did before.

**An effect no longer misses a fact written while the effects phase is open.** The changed-key set was cleared after the effects phase awaited, which threw away every key that arrived while it was open — a resolver resuming across an `await`, or an effect writing a fact. The constraints saw those keys; the effects never did, and an effect declared on that exact key simply did not run.

It presented as a scheduling wobble rather than a miss, because whether a key survived depended on which microtask a resolver's writes happened to land in — the same code could work and then stop working after an unrelated `await` moved upstream. Keys arriving during the effects phase are now held for the pass that the tail of reconcile already schedules, which is the treatment keys arriving during constraint evaluation always got.
