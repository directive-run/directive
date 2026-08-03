---
"@directive-run/query": patch
---

**A subscription with a constant key no longer dies the first time anything else in the system changes.**

`createSubscription` closed its stream from an effect cleanup. Directive fires an effect's cleanup before every re-run as well as at teardown, and the two are indistinguishable from inside it — so the cleanup was aborting a stream that was about to carry on.

That alone would have been survivable if subscriptions re-ran rarely. They do not. An auto-tracked effect whose `key()` reads no facts records no dependencies, and no dependencies is read as "unknown", which means it re-runs on every reconcile. A subscription keyed on a constant is exactly that shape, and it is the ordinary shape — `key: () => "notifications"` is what most subscriptions look like.

The failure was silent and total. The controller aborted, the body's same-key early return declined to establish a replacement because as far as it could tell one was already live, and every callback afterwards was a no-op. No error surfaced. The resource state simply froze on whatever had arrived before the first unrelated fact changed anywhere in the system, and kept reporting itself as connected.

The cleanup now marks rather than tears down, and the two things that genuinely end a stream do it themselves: a re-key, handled by the body that is already building the replacement, and system stop, which arrives on the module's `onStop` after every effect cleanup has fired. A re-run marks and then clears the mark, and the stream never notices.
