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

- **A resolver run that satisfied its own requirement completes.** Rule: a run whose requirement disappears was satisfied by it when every change in that pass to what the constraint reads (directly or through derivations) came from the runs whose requirements disappeared in that pass; otherwise it is canceled as before. Guarantees: writes are attributed per run (keyed siblings and separate batches never shield one another, and runs that each write their own entry of a shared fact are satisfied together); a satisfied run reports completion only, stays in flight so `stop()` and `destroy()` abort it and `settle()` waits for it, is not retried, and if it fails or times out afterwards it is treated like a cancel under RFC 0003: its signal aborts, it reports one error (without "stays unmet"), and its writes still land, so a `finally` that clears a loading flag takes effect. A run's late writes are dropped only when it is superseded: if its requirement (same id) is dispatched again while its body is still running, even one that already timed out, failed or was canceled, the old body's later writes are dropped and the new run owns the facts. Runs for different requirement ids are never superseded by each other: when a requirement's key changes, guarding against the old run's late write is the resolver's job, through `context.signal` or `abortOn`. Every run now reports exactly one of complete, cancel or error: a canceled run that returns normally no longer also reports completion. Before, the outcome depended on timing.
- **Coalescing.** A pass starts on the microtask after the first write and takes every write made before it starts; writes made while a pass awaits go to the next one. A pass that awaits nothing finishes inside its microtask, so writes separated by an `await` now each get their own pass, effect run and, with `history`, their own snapshot (10 awaited writes: 10 of each, where it used to be about 3). Writes in one synchronous run still share one. Whether some resolver is running no longer changes the count.
- **`ctx.requeue()` waits for its resolver.** The requeue is applied once the requeuing resolver has finished. Before, a resolver still running at the end of the next pass had its re-dispatch dropped as a duplicate.

Plugin events at startup may arrive in a different order: plugin `onInit` runs asynchronously and is not awaited, so a plugin can see the first `constraint.evaluate` before its own `system.init`. Nothing guaranteed either order.

**Constraint re-evaluation is now defined, not incidental.** A pass that changed nothing a constraint reads carries its last answer forward instead of re-evaluating every constraint. A constraint is re-evaluated when a fact or derivation it read changes, when it is registered, enabled or assigned, on `start()`, and when `retry-later` retries it. `retry-later` now retries even without a `retryLater` config (default delay 1000 ms, polled at most every 500 ms); the poller stops when nothing is left to retry and never keeps a Node process alive on its own. A `when` or `require()` that throws keeps the dependencies it read before throwing; an async `when` without `deps` is re-evaluated every pass. Under the default `skip` error strategy, a `when` that throws before reading any fact has nothing to wake it, so it is not asked again until `start()`. A `when` must be a pure function of facts and derivations: one that read the clock or an outside variable used to be re-asked by unrelated passes (a resolver finishing, for example) and no longer is. Put time and outside input in a fact or a source.

**Errors after a run satisfied its requirement** are passed on as the original error; only the development warning changes (it no longer says the requirement stays unmet).

