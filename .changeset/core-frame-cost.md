---
"@directive-run/core": minor
---

Each reconcile pass allocates about half as much and runs about 45% faster.

Measured on a loop of four fact writes, one derivation read, one effect and `settle()` per frame, production build: 12.7 KB to 6.3 KB allocated per frame, 2.86 µs to 1.57 µs.

- A pass whose effects are all synchronous no longer yields between phases, so `settle()` usually finds the system settled on its first check instead of setting up a timer and a subscription.
- When no constraint reads a changed fact, the constraint phase answers synchronously. When nothing is required before or after, it builds no requirement set and no diff.
- The plugin snapshot, the in-flight list, the effect trigger list and the history label are built only when a plugin, the trace or history will read them.
- The changed-key set is double-buffered, and per-write derivation holds no longer allocate a closure.

Three behaviors are now defined by rule instead of by how many microtasks a pass happened to take:

- **A resolver that satisfied its own requirement completes.** Each run's writes through its own `ctx.facts` are counted per pass. If a requirement disappears while its run is going, and in that pass the only changes to what the constraint reads (directly or through derivations) are that run's own writes, the run satisfied it: it is not canceled and reports completion only, however long it takes to return. It stays in flight, so `stop()` and `destroy()` abort it and `settle()` waits for it; it is not retried if it throws afterwards; and if the requirement comes back while it runs, the new dispatch aborts it and drops its later writes. Anything else that touched what the constraint reads in the same pass (another run, a keyed sibling, the user) makes it an ordinary retraction, canceled as before. Before, the outcome depended on timing: a run that waited three or more microtasks after its write was canceled every time.
- **Coalescing.** A pass starts on the microtask after the first write and takes every write made before it starts; writes made while a pass awaits go to the next one. A pass that awaits nothing finishes inside its microtask, so writes separated by an `await` now each get their own pass, effect run and, with `history`, their own snapshot (10 awaited writes: 10 of each, where it used to be about 3). Writes in one synchronous run still share one. Whether some resolver is running no longer changes the count.
- **`ctx.requeue()` waits for its resolver.** The requeue is applied once the requeuing resolver has finished. Before, a resolver still running at the end of the next pass had its re-dispatch dropped as a duplicate.

Plugin events at startup may arrive in a different order: plugin `onInit` runs asynchronously and is not awaited, so a plugin can see the first `constraint.evaluate` before its own `system.init`. Nothing guaranteed either order.
