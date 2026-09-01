---
"@directive-run/core": patch
---

A `Map`, `Set`, `Date` or class instance stored in a fact stays usable in
development mode. The nested mutation warning proxy wrapped every nested object,
and a method called on a wrapped `Set` throws "called on incompatible receiver"
because its contents live in an internal slot rather than in properties — so the
wrapper bought no warning and cost the object's own API. Only plain objects and
arrays are wrapped now; the warning is unchanged for them.
