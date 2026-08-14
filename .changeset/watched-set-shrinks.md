---
"@directive-run/core": patch
---

Let the watched set shrink. A derivation joined the set of values being watched from outside the graph the moment a constraint or an effect read it, and left only when the derivation itself was destroyed — so a constraint that read a value once, behind a flag that was briefly true, kept that value watched for the life of the system.

That set is the bound the per-reconcile invalidation walk is measured against, so every stale entry made the walk both broader and less able to stop early. The set is now rebuilt at the end of each reconcile from the dependency sets the constraints and effects already keep, which they already replace wholesale each time they run. No reference count, no delta to track, and nothing to drift.

Measured on a graph of forty gated constraints over a thirty-deep chain, with every gate opened once and then closed: the watched count settles at zero instead of forty, and a reconcile takes about 18 microseconds instead of about 29.
