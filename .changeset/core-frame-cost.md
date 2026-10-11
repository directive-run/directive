---
"@directive-run/core": minor
---

Each reconcile pass allocates about half as much and runs about 45% faster.

Measured on a loop of four fact writes, one derivation read, one effect and `settle()` per frame, production build: 12.7 KB to 6.3 KB allocated per frame, 2.86 µs to 1.57 µs.

- A pass whose effects are all synchronous no longer yields between phases, so `settle()` usually finds the system settled on its first check instead of setting up a timer and a subscription.
- When no constraint reads a changed fact, the constraint phase answers synchronously. When nothing is required before or after, it builds no requirement set and no diff.
- The plugin snapshot, the in-flight list, the effect trigger list and the history label are built only when a plugin, the trace or history will read them.
- The changed-key set is double-buffered, and per-write derivation holds no longer allocate a closure.

Two behaviors are now independent of timing:

- **`ctx.requeue()` waits for its resolver.** The requeue is applied once the requeuing resolver has finished. Before, it was applied at the end of the next pass whether or not the resolver was done, and a resolver still running then had its re-dispatch dropped as a duplicate. That only worked when the pass happened to take long enough.
- **Plugin events at startup may arrive in a different order.** Plugin `onInit` runs asynchronously and is not awaited, so with a faster first pass a plugin can see the first `constraint.evaluate` before its own `system.init`. Nothing guarantees either order.
