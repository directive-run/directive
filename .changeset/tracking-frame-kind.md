---
"@directive-run/core": patch
---

**A derivation read is now classified by who is doing the reading, from one place instead of two.**

A derivation body reading another derivation is an internal edge — the derivation graph invalidates along it already. A constraint or an effect reading one is an outside observer, and the engine has to record that or the reader is never woken when the value moves.

That distinction lived in a counter in the derivations module while the tracking stack lived in another module: two structures that had to be kept in agreement by hand, and were not. The composition proxy consulted the counter; the `system.derive` accessor did not. So a derivation that composed through the accessor rather than its `derived` parameter registered *itself* as an external watcher — a node nothing outside the graph was waiting on, added to the set that bounds the per-reconcile invalidation walk and announced on every pass.

The classification now rides on the tracking frame, which is the one structure that already knows whose body is running. This is also how the reactive literature does it: MobX hangs the current derivation off global state and separates computed from reaction by class, Solid's listener carries a `pure` flag, Adapton distinguishes edges by the articulation point that demanded them. None of them answer the question with a recursion depth.

`system.inspect()` gains `observedDerivations` — how many derivations something outside the graph is watching. That count is what the invalidation walk is bounded against, so it is the number that explains the walk's cost, and it is what makes over-registration visible instead of merely suspected. A count much larger than the derivations your constraints and effects actually read means something is registering watchers nobody is waiting on.

Also closed: the memoization fast path, taken once a derivation's dependency set has been stable for several runs, pushed no tracking frame at all — so the body's reads landed in whichever frame was above it on the stack. Nothing in the public surface reaches that today, because a derivation is already fresh by the time a constraint reads it, but it meant a derivation's private reads could be attributed to its consumer and the reported dependency shape could change the moment the threshold tripped.

### If you construct a `SystemInspection`

`observedDerivations` is required, for the same reason `pendingInvalidations` is: it is always present in real output. Hand-built test doubles need the field.
