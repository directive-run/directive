---
"@directive-run/core": patch
---

History snapshots no longer alias live state, and no longer drop facts they can capture

Snapshot serialization degraded through three tiers in silence — `structuredClone`,
then `JSON.parse(JSON.stringify(…))`, then a shallow spread — with both fallbacks
behind bare `catch` blocks.

The last tier was the problem. A shallow copy aliases every nested object, so
mutating a fact after a snapshot had been taken rewrote the snapshot too. Time
travel then showed a past that never happened, which is worse than refusing to
record one: an operator comparing two points in history was handed a difference
manufactured by the act of reading it.

Reaching that tier needed two hostile values at once — something `structuredClone`
rejects, such as a function, and something `JSON.stringify` rejects, such as a
bigint — which is why it went unnoticed.

The snapshot is now built one fact at a time, so a value that refuses to clone
costs only itself, and there is no shallow-copy tier at all.

**A development-only defect surfaced while fixing it, and mattered more.** In dev
every object-valued fact is read through a Proxy that warns about nested mutation.
The immutable update the docs recommend — `facts.doc = { ...facts.doc, title }` —
reads each nested value through that Proxy and spreads the results, so the wrappers
end up *stored*. `structuredClone` refuses a Proxy, so an ordinary fact holding a
string and a `Date` became uncapturable, was omitted from every snapshot, and was
never restored: `goBack` rewound some facts and not others. Snapshots now unwrap
those wrappers before cloning, on the fallback path only, so it costs nothing when
cloning already works.

A fact that genuinely cannot be cloned is left out and reported once, naming it:

```
[Directive] These facts cannot be captured in history and are omitted from
snapshots: connection. Restoring leaves them at their current values.
```

Two limits worth stating plainly. The report covers a value that fails to clone
whole; loss *inside* a value — a nested function dropped by the JSON tier, a
nested `Map` flattened to `{}` — is still silent. And class instances are not
affected by any of this: they clone successfully into prototype-stripped plain
objects, so they never reach this path. The engine already warns about
class-instance facts where they are written, which is the right place for it.
