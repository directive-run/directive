---
"@directive-run/core": minor
---

**A constraint or effect that reads a derivation now re-evaluates when that derivation changes.** It did not before, so one gated purely on a derivation ran once, at startup, and never again.

Constraints and effects auto-track what their bodies read, and that tracking was incomplete in two places that compounded:

- Reading a derivation through `system.derive.total` did not register a dependency. Reading the same value as `derived.total` from inside another derivation's body did. Two doors onto one value, and only one of them recorded that the read happened.
- Even where a dependency on a derivation was recorded, incremental evaluation compared dependencies against the set of changed **fact** keys. A derivation ID never appears in that set, so the derivation half of every tracked dependency matched nothing.

The visible symptom is a constraint that will not fire. The derivation flips, every direct reader sees the new value, `system.derive.total` returns it correctly — and the constraint keeps answering with whatever it computed at startup, because nothing knew it cared.

A constraint's `when()` receives facts. It reads a derivation through the system's `derive` proxy, which means a reader bound once the system exists:

```typescript
let overBudget: () => boolean = () => false;

const module = createModule("spend", {
  schema: {
    facts: { spent: t.number(), limit: t.number() },
    derivations: { overBudget: t.boolean() },
    requirements: { HALT: {} },
  },
  derive: {
    overBudget: (facts) => facts.spent > facts.limit,
  },
  constraints: {
    halt: {
      // Evaluated once. `spent` changing did not bring it back: the read
      // through `system.derive` registered no dependency, and even where one
      // was recorded, only fact keys were ever matched against it.
      when: () => overBudget(),
      require: { type: "HALT" },
    },
  },
});

const system = createSystem({ module });
overBudget = () => system.derive.overBudget;
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

A `deps` name is resolved against the derivations the system holds when the effect is *considered*, not the ones it held when the effect was registered. With the piecemeal API the order is a caller's to choose — `system.effects.register("watch", { deps: ["doubled"] })` before `system.derive.register("doubled", …)` is an ordinary thing to write — and resolving once at registration made that order significant and silently so: the effect kept the bare name, nothing ever announces a bare derivation name, and the effect never ran again. Constraints already re-resolved per evaluation; effects now match them.

The types moved with it. `DynamicEffectDef["deps"]` accepted fact keys only, so the correct code did not compile on the one API where the problem was reachable.

**A dependent gated on a derivation is woken every time the derivation changes, not once.** A derivation is lazy: it is marked stale and recomputed on the next read. Marking was the point at which its dependents were told, and marking happens only on the transition from valid to stale — so if nothing read the derivation back, it stayed stale and every later fact change was a no-op for anything depending on it.

The effect of that is an effect or constraint that fires exactly once and then goes quiet while the facts underneath keep moving:

```typescript
derive: { doubled: (facts) => facts.count * 2 },
effects: {
  watch: {
    deps: ["doubled"],
    // Reads the fact, never the derivation. Nothing here brings `doubled`
    // back to a valid state, so nothing re-arms the announcement.
    run: (facts) => log(facts.count),
  },
},
```

Three changes to `count` ran this once. It was also non-deterministic in a real application, because any unrelated reader recomputing the derivation silently re-armed it — so the same code worked or did not depending on what else happened to be watching.

Staleness is still latched and still marked on the edge; what repeats is the announcement, which is the only thing anything outside the derivation graph ever sees. Listeners are unaffected — they read the value back, so they see every edge, and notifying them about a value already known stale would be the same news twice. The visible change beyond the fix is that the devtools and logging plugins emit `derivation.invalidate` once per invalidation rather than once per staleness transition.

**Known limitation, unchanged in this release.** A fact written while the effects phase is open — by a resolver resuming across an `await`, or by another effect — reaches the constraints but not the effects. The changed-key set is cleared after the phase completes, so an effect declared on that exact key does not run for that write. Whether it bites depends on which microtask the write lands in, which makes it look like a scheduling wobble rather than a miss.

Hold the write until after the phase, or declare the effect on a key that changes outside it. A fix is in progress and is not in this release: delivering those keys on a later pass, without also bounding the feedback path, turns an effect that writes a fact it depends on into an unbounded reconcile loop.
