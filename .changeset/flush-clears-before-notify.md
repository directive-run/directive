---
"@directive-run/core": patch
---

A listener that opens a batch during a flush no longer causes the batch it is
reacting to be reported twice.

`flush()` cleared its buffer after the notify phase rather than before, so a
listener that opened a nested batch saw the outer batch's changes still sitting
there and reported them again. Anything reconstructing state from `onFactsBatch`
— a replica, a persistence layer, an audit trail — received duplicates carrying
pre-write values.

Nothing is lost by clearing early: a write made during the notify phase lands in
the now-empty buffer and is reported by its own flush.
