---
"@directive-run/query": patch
---

**A subscription with a constant key no longer dies the first time anything else in the system changes.**

`createSubscription` closed its stream from an effect cleanup. Directive fires an effect's cleanup before every re-run as well as at teardown, and the two are indistinguishable from inside it — so the cleanup was aborting a stream that was about to carry on.

That alone would have been survivable if subscriptions re-ran rarely. They do not. An auto-tracked effect whose `key()` reads no facts records no dependencies, and no dependencies is read as "unknown", which means it re-runs on every reconcile. A subscription keyed on a constant is exactly that shape, and it is the ordinary shape — `key: () => "notifications"` is what most subscriptions look like.

The failure was silent and total. The controller aborted, the body's same-key early return declined to establish a replacement because as far as it could tell one was already live, and every callback afterwards was a no-op. No error surfaced. The resource state simply froze on whatever had arrived before the first unrelated fact changed anywhere in the system, and kept reporting itself as connected.

The cleanup now marks rather than tears down, and the two things that genuinely end a stream do it themselves: a re-key, handled by the body that is already building the replacement, and system stop, which arrives on the module's `onStop` after every effect cleanup has fired. A re-run marks and then clears the mark, and the stream never notices.

**Stopping the system is now what closes the stream, so a system you discard must be stopped.** Previously the effect cleanup closed it, and cleanup runs on teardown too, so a system dropped without `stop()` still had its stream torn down on the way out. The only teardown path now is `onStop`. If you build a system per request, per test, or per tenant, stop it when you are done — otherwise its stream stays open for the life of the process:

```typescript
const system = createSystem({ module: withQueries([liveOrders], config) });
system.start();
try {
  await handle(system);
} finally {
  system.stop(); // closes the subscription's stream
}
```

The registry holding established streams is keyed per system, so stopping one closes that system's stream and leaves every other system built from the same definition alone. The identity used is the facts store, because it is the one thing both sides of a teardown can name: an effect sees a module-scoped facts view, `onStop` sees the store-wide one, and in a namespaced system those are two different objects over a single store that Directive creates exactly once per system.

A teardown that throws no longer strands the streams behind it. These close independent streams, and one failing used to end the loop that runs them — leaving every stream registered after it open, still reporting its last value rather than going quiet. Each now runs regardless, and a throw is reported rather than propagated.

`SubscriptionDefinition.onStop` is optional, so a hand-built definition — a test double, a wrapper typed as that interface — does not have to supply one. `createSubscription` always does.
