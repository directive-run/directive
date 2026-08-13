---
"@directive-run/core": patch
---

**An effect now reads its own writes through `derived`, the same way it already did through `facts`.**

An effect's `run()` executes inside a batch. A write reaches the backing store immediately, so `facts.n` read back the value you just wrote — but derivation invalidation waited for the batch to flush, so `derived.doubled` returned the value from *before* that same write. A constraint's `when()` is not batched, so the identical two lines worked there. One parameter, two consistency models, decided by which manager the code happened to be inside.

```ts
run: (facts, prev, derived) => {
  facts.n = 5;
  facts.n;          // 5
  derived.doubled;  // was 2 — now 10
}
```

Invalidation is now eager per write; only the notification still waits for the end of the batch. That is the half that has to wait: marking a derivation stale is cheap and idempotent, while announcing it early is what would let a subscriber observe a batch half-applied. Listeners fire at exactly the moment they did before, having become able to read the right values before that moment arrives.

Both halves are pinned by tests — one that the write is visible, one that no listener ever sees a batch half-written.

The precedent genuinely cuts both ways here: Solid's `batch` also returns pre-batch values, while MobX computeds recompute inside actions. Either is defensible; what was not defensible was having both at once in one system and saying nothing. The choice is now the one that matches `facts` in the same function body, and it is written down in the `run()` docs and in `docs/derivations.md`.
