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

**Read that as "may go from never to often", not "may go from once to twice".** An effect whose `deps` name only a derivation did not run at all before — not at startup, not on any later change. Measured against 1.24.1 on a module with `doubled: (facts) => facts.n * 2` and two writes to `n`: the effect body observed `[]`, and it observes `[1, 2]` now. Nothing in that effect was ever reached, so nothing in it was ever exercised — a first run that has never happened is a first run whose error handling, its network call, its write, have never happened either.

How often it runs from here is how often a fact the derivation reads changes — not every reconcile. Measured: five writes to a fact outside the derivation wake it zero times, three writes to a fact inside it wake it three times, and five writes of the same value wake it once, because only the first of those is a change. That is a rate the author can reason about; it is the dependency chain they named.

What they did not choose is that it starts at all. Before upgrading, find the effects and constraints that read a derivation and satisfy yourself they are safe to run — repeatedly, starting immediately.

Gating on facts alone is unaffected, and there is a test pinning that. The invalidation set is tracked separately from changed fact keys, so history snapshot labels still describe facts, and a derivation going stale without any fact changing cannot make a settled system look dirty.

**Facts and derivations no longer share a keyspace.** A module may declare `facts.ready` alongside `derivations.ready`, and nothing rejects it. Dependency sets and the invalidation set carry both kinds of name, so while they were one flat string keyspace the lookup for either returned the union of both: a constraint gated on the *fact* re-evaluated when the *derivation* went stale, and an effect gated on the fact re-ran. Derivations are namespaced inside those sets now, so the two names are two keys.

The same namespace fixes a second, older collision in the opposite direction. Which map a derivation's dependency was filed in was decided by asking whether the *name* was also a derivation — so a derivation reading `facts.ready`, in a module with a `ready` derivation beside it, had its fact dependency filed under derivations and was never invalidated when the fact changed.

Introspection is unaffected in shape and clearer in content: the devtools trace and `explain()` render a dependency on a derivation as `derive.total` rather than a bare `total`, and `explain()` now shows the derivation's value where it previously showed `undefined`. The same rendering applies to `getDependencies()`, which is reached through `@directive-run/core/internals` and carries no semver guarantee. The dev-mode warning for a shadowed name stays, but says what it now costs — legibility, not correctness.

**An async effect that reads nothing it can be woken by now says so.** Auto-tracking is a synchronous stack and closes when the body returns its promise, so an `async` effect whose reads are all past its first `await` records no dependencies at all — and an effect with no dependencies runs on every reconcile. It fires, so it looks like it works; what it has lost is any relationship between when it fires and what it reads. Development-mode warning, once per effect. Declare `deps`, or move the reads above the first `await`.

This deliberately does not warn on every async auto-tracked effect the way core warns on every async constraint without `deps`. There is a correct shape — hoist the reads — and nothing tells it from the broken one at runtime, so a broad warning would fire on correct code with no way to say so. The empty dependency set is the unambiguous case.

**An explicit `deps` entry may name a derivation.** It could not before, in either direction: `deps: ["someDerivation"]` was matched only against fact keys, so it silently matched nothing and the effect never woke; and `EffectDef["deps"]` was typed `Array<keyof InferSchema<S>>`, so writing it did not compile in the first place. Both are fixed, and they had to be fixed together — the type refused the correct code, and the runtime ignored it if you cast past the refusal.

This closes the gap the async-effect warning above points at. That warning tells you to declare `deps`, and for an async effect whose reads are all derivations, `deps` was exactly the thing that did not work. An async constraint was in the same position: auto-tracking cannot see past its first `await`, and `deps` was its only way to name a dependency, so a derivation dependency could not be expressed at all.

A fact and a derivation of the same name resolve to the fact. `deps` has meant fact keys for as long as it has existed, so the older meaning wins; the name collision itself still warns, as it did before.

An effect whose `deps` name only derivations does not run at startup, where one naming a fact does. Startup announces the fact keys `init` wrote, and a derivation is not among them, so there is nothing for a derivation-only `deps` to match until the first fact change afterwards. Measured on a module with `n` and `doubled: (facts) => facts.n * 2`, then two writes to `n`: `deps: ["n"]` sees `[0, 1, 2]` and `deps: ["doubled"]` sees `[1, 2]`. If the effect is establishing something that has to exist from the start — a connection, a subscription, a registration — name a fact it reads as well, or do the initial setup in `init`.

A `deps` name is resolved against the derivations the system holds when the effect is *considered*, not the ones it held when the effect was registered. With the piecemeal API the order is a caller's to choose — `system.effects.register("watch", { deps: ["doubled"] })` before `system.derive.register("doubled", …)` is an ordinary thing to write — and resolving once at registration made that order significant and silently so: the effect kept the bare name, nothing ever announces a bare derivation name, and the effect never ran again. Constraints already re-resolved per evaluation; effects now match them.

One thing to know if you register a derivation at runtime: it is lazy, and it records what it reads the first time it computes, so until something reads it back it has no dependencies and there is nothing for a fact change to travel along. Read it once after registering it, and the effect wakes from then on:

```typescript
system.effects.register("watch", { deps: ["doubled"], run: (facts) => … });
system.derive.register("doubled", (facts) => facts.count * 2);

system.derive.doubled; // gives it its dependency on `count`
```

Without that read the effect stays quiet through every later write, which looks exactly like the bug above and is not it. A derivation declared in the module's `derive` block is computed as part of startup and needs nothing extra.

The types moved with it. `DynamicEffectDef["deps"]` accepted fact keys only, so the correct code did not compile on the one API where the problem was reachable.

**A dependent gated on a derivation is woken every time the derivation may have moved, not once.** A derivation is lazy: it is marked stale and recomputed on the next read. Marking was also how its dependents were told, and marking happens only on the transition from valid to stale — so if nothing read the derivation back, it stayed stale and every later fact change was a no-op for anything depending on it.

The effect of that is an effect or constraint that fires exactly once and then goes quiet while the facts underneath keep moving:

```typescript
derive: { doubled: (facts) => facts.count * 2 },
effects: {
  watch: {
    deps: ["doubled"],
    // Reads the fact, never the derivation. Nothing here brings `doubled`
    // back to a valid state, so nothing re-armed the announcement.
    run: (facts) => console.log(facts.count),
  },
},
```

Three changes to `count` ran this once; they now run it three times. It was also non-deterministic in a real application, because any unrelated reader recomputing the derivation silently re-armed it — so the same code worked or did not depending on what else happened to be watching.

Two questions ride on one fact change, and they are now answered separately. *Which derivations are stale* is a state change: staleness latches, and everything downstream of a stale derivation is already stale, so marking stops at the stale frontier as it always did. *Which watched derivations may have moved* keeps being true for as long as a derivation stays stale, so it is asked once per reconcile — from the derivations whose own dependency changed, over the graph, and only for derivations something outside the graph actually watches.

Listeners are unaffected: they read the value back, so they see every edge. `derivation.invalidate` on the devtools and logging plugins still fires once per valid-to-stale transition, which is what it has always meant.

**A derivation dependency wakes on possible movement; a fact dependency wakes on a change.** Writing a fact its current value is not a change, and an effect declared on that fact does not run. A derivation has no value to compare at the moment its inputs move — producing one means running it, which is the one thing a lazy value cannot be made to do on its own — so a derivation dependency wakes its dependent whenever the facts underneath the derivation move, whether or not the derived value moved with them. This applies equally to a derivation named in `deps` and one picked up by auto-tracking from a `system.derive.x` read.

It is invisible until the effect has a teardown, and then it is a socket closing and reopening on every heartbeat:

```typescript
derive: { shouldConnect: (facts) => facts.userId !== "" && facts.beats >= 0 },
effects: {
  socket: {
    deps: ["shouldConnect"],
    // Ten writes to `beats`: ten opens and nine teardowns between them.
    // `shouldConnect` was `true` throughout.
    run: () => {
      const ws = new WebSocket("/ws");
      return () => ws.close();
    },
  },
},
```

Guard on the value when an effect owns a resource — read the derivation, keep what it was, return early when it has not moved. The full pattern is on `EffectDef`. An effect that only reads needs nothing.

**Invalidation no longer costs the size of the derivation graph.** Marking stops at the stale frontier again, so a graph nothing reads back settles after the first write and every write after it is flat. The `Derivation Invalidation – graph nothing reads back` group in `packages/core/src/__benchmarks__/core.bench.ts` is where that is measured, and it measures cost per fact write: a chain of 20, a chain of 500, and a 500-node graph with roughly 15,000 edges stay within a small constant factor of one another rather than climbing with the graph — around 15-20% spread across runs, against the 25x-and-rising the old walk produced. Whichever machine you run it on, the number to look at is whether the three rows agree — any figure that climbs with the graph means the walk went back to re-deciding staleness that was already decided.

The other half is per reconcile pass rather than per write, since answering "which watched derivations may have moved" now happens once a pass, and is skipped outright when nothing outside the graph is watching. That skip has no observable consequence other than its cost — the same values are read afterwards either way — so it is pinned by a timing comparison rather than an assertion, in `derivation-deps.test.ts`: the same number of passes over a 1,000-derivation graph and over a 2-derivation graph, with nothing watching either. They come out within a small factor of each other; without the skip the larger one is an order of magnitude slower. Systems that read every derivation each pass were never affected either way, and are not affected now.

The log volume goes with it. `loggingPlugin` at `debug` over 200 derivations and ten fact writes emitted 2,032 lines, 2,000 of them `derivation.invalidate`; it emits 232, of which 200 are the one-time transition of each derivation to stale. `devtoolsPlugin` keeps one ring-buffer entry per announcement, so at the old volume five fact writes filled the default 1,000-entry buffer and everything else in it was gone — which made devtools least usable on exactly the systems worth opening it for. Same buffer, same default, and it now holds a session.

**`system.derive.assign()` now invalidates the derivations composed on top of the one it replaced.** A new function means a new value, and every derivation that read the old one was still holding what it computed from it:

```typescript
derive: {
  doubled: (facts) => facts.count * 2,
  quadrupled: (_facts, derived) => derived.doubled * 2,
},
```

With `count` at 2, `quadrupled` reads 8. After `system.derive.assign("doubled", (facts) => facts.count * 10)` it kept reading 8; it reads 40.

**Known limitation, unchanged in this release.** A fact written while the effects phase is open reaches the constraints but not the effects. The changed-key set is cleared after the phase completes, so an effect declared on that exact key does not run for that write. Whether it bites depends on which microtask the write lands in, which makes it look like a scheduling wobble rather than a miss.

It takes less to reach than it sounds, and less than this note used to say. It needs neither an `await` nor a resolver: one effect writing a fact another effect is declared on drops it synchronously, in the same pass. A write arriving from *outside* the system while the phase happens to be open is dropped the same way, which is what makes it read as a wobble — the same line of caller code works or does not depending on what the system was doing at the time. And it is not confined to fact keys: an effect gated on a derivation the write invalidates misses it too. A resolver resuming across an `await` is the narrowest of the four rather than the representative one, because a resolver dispatched by the pass whose effects phase is open does not enter its body until that phase has completed — it takes a resolver from an earlier pass resuming while a *later* pass's phase is being held open by some other async effect.

Hold the write until after the phase, or declare the effect on a key that changes outside it. All four shapes are pinned in `engine.test.ts` under `effects and the reconcile boundary`, which asserts the current behaviour rather than the wanted one, so the fix has something to fail against. A fix is not in this release: delivering those keys on a later pass, without also bounding the feedback path, turns an effect that writes a fact it depends on into an unbounded reconcile loop — and since a derivation ID is a dependency in the same way a fact key is, an effect that reaches its own dependency through a derivation is in that loop too.
