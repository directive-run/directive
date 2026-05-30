---
"@directive-run/query": patch
---

`serializeKey` filters `__proto__`, `constructor`, and `prototype` out of
input keys. The internal accumulator was already null-prototype but the
input itself wasn't sanitised, which left a prototype-pollution surface
the next time the serialized JSON was parsed and merged upstream. With
the filter, a cache key shape that includes one of those names produces
the same serialised string as one that does not.
