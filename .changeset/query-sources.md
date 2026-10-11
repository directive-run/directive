---
"@directive-run/query": minor
---

Focus, reconnect, polling, cache expiry and subscription streams are sources.

Every one of these used to be an effect that wrote facts from a callback the
outside world fired. Effects can no longer write facts, so each is now a
source that publishes an event, and a handler turns the event into facts. A
query definition gains `sources`, `events` and `schema.events`, and
`withQueries` merges them into the module. `effects` is still present and
empty. Sources attach at `start()`, detach at `stop()`, and never re-attach on
a history rewind, so no undo re-subscribes a stream or re-arms a timer.

What you can see change:

- **Cache expiry is exact.** One timer is set for `dataUpdatedAt +
  expireAfter`. It used to be a check that polled every
  `min(expireAfter, 5s)`, so data could outlive its `expireAfter` by up to
  five seconds.
- **A static `refetchInterval` polls only while the query has a key.** It
  used to poll even when `key()` returned null (the refetch then did
  nothing).
- **A function `refetchInterval`** is asked on every reconcile; a new value
  re-arms the timer and a falsy one stops it. It used to restart its timer on
  every change to the query's state.
- **Subscriptions** are keyed sources. Re-keying closes the old stream before
  the new one opens, and data from a stream that has been replaced is
  ignored. `subscribe` still receives the key object `key()` returned. When
  `key()` goes to null the stream closes and the state resets to idle, now
  through a small constraint and resolver. When `enabled()` returns false the
  stream now closes; it used to stay open. At `stop()`, streams close in
  reverse order of registration, like every source.
- `SubscriptionDefinition.onStop` is no longer set by `createSubscription`;
  `withQueries` still honours it on hand-built definitions.
- New internal event names appear in `inspect()`, plugin hooks and the
  observation stream: `_q_<name>_FOCUSED`, `_ONLINE`, `_POLL_TICK`,
  `_EXPIRED`, and `_SUB_STARTED` / `_SUB_DATA` / `_SUB_ERROR` /
  `_SUB_COMPLETE`. Each is a dispatched event, so with history enabled each
  takes a snapshot unless `history.snapshotEvents` excludes it.
