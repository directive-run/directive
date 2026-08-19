---
"@directive-run/core": minor
---

Batched fact writes now reach `system.observe()` — and therefore the audit ledger.

The observation bridge implemented the single-write plugin hook and not the batch
one. The store defers notifications inside a batch and reports the whole set at
the end, so every write made in a batch was absent from the observation stream:
a module's `init`, hydrated state, an effect's writes, anything a resolver wrote
before its first await — and event handler writes, which is how most
applications change state at all.

Measured on a system dispatching 100 events that wrote 200 facts between them:
0 `fact.change` events before, 203 after. An audit ledger on a normal
application was recording almost nothing.

This is a volume change for anyone with a ledger sink writing to durable
storage — a sink that appeared quiet was not quiet, it was blind. Redaction is
unaffected: a batched write of a fact tagged `pii` is redacted exactly as an
unbatched one always was.
