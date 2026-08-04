---
"@directive-run/query": patch
---

**Destroying one system no longer closes a live subscription belonging to a different system.**

`createSubscription` returns a definition, and a definition is an ordinary value — nothing stops two systems being built from it, and request-scoped systems, isolated tests, and a worker serving more than one tenant all do exactly that. The registry of established streams lived in the definition's closure and held every system's stream together, so teardown was handed a list it could not tell apart. Stopping one system closed all of them.

The failure reports nothing. Closing a stream aborts its controller and calls its unsubscribe, and the subscription's resource state is left exactly as it was: `status` stays `"success"`, the system stays running, and the last value that arrived stays readable. Every value after that point is dropped by the aborted controller. A dashboard keeps rendering the price it had when some unrelated system somewhere else in the process shut down.

The registry is keyed per system now, and the module's `onStop` is handed the facts of the system that is stopping so the teardown closes that system's stream and nothing else. The identity used is the facts store, because it is the one thing both sides of a teardown can name: an effect sees a module-scoped facts view, `onStop` sees the store-wide one, and in a namespaced system those are two different objects over a single store that Directive creates exactly once per system.
