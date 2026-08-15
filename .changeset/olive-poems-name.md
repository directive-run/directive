---
"@directive-run/core": patch
---

An effect's second parameter is now called `prevFacts` rather than `prev`.

It always held the previous facts — the same shape as the first parameter — but
only one of the two said so:

```ts
run: (facts, prev, derived) => { ... }        // prev what? value? state? result?
run: (facts, prevFacts, derived) => { ... }
```

Nothing to change on your side. Parameter names are positional in TypeScript, so
callers name their own; this changes hover text, the emitted types, and every
example.

There is deliberately no `prevDerived`. The runtime keeps a snapshot of the
previous *facts* and nothing else, because derivations are computed from facts —
a previous derived value would have to be recomputed from `prevFacts`, which the
callback already has. The asymmetry in `(facts, prevFacts, derived)` is real, and
naming it is better than hiding it behind a word that means nothing in
particular.
