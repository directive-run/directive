---
"@directive-run/core": patch
"@directive-run/ai": patch
---

Four fixes to the metadata-query change, found by reviewing the implementation
rather than the plan.

**A Zod fact stopped working.** Fact tags decide what gets redacted, so the
schema type holding them was frozen — unconditionally. A Zod schema is a
supported fact type and mutates itself while validating: v3 caches its shape
onto the instance on first parse, v4 re-defines properties on it. Either throws
on a frozen object, so the first validated write to a `z.object()` fact threw
instead of validating. The freeze now covers only the types this package builds;
the tag immutability it exists for is unaffected.

**A fact key containing a dot was redacted against the wrong fact.** The audit
ledger and the loop detector resolve a clause path like `user.email` to the fact
that carries the tag, which meant taking the first segment. A key *literally*
named `user.email` was then looked up as `user` — so a tagged key could be
answered for by an untagged one, and its value went into the hash chain in the
clear. Both now try the exact key first and fall back to the root only when the
exact key is unknown.

**The coverage signal read maximum when it was blind.** `guardrail.coverage`
counted a key as covered whenever the guardrail would screen it — and it screens
when it cannot tell. A guardrail whose tag lookup was completely broken
therefore reported full coverage. It now counts only keys it has a definite
answer for, and reports `reason: "unanswerable"` when any key could not be
answered. That value was declared and never emitted, while two doc comments told
operators to watch for it.

**Metadata queries are fenced off the tracking stack.** Walking the tag graph
forces derivations to compute, and forcing goes through the same accessor a
derivation body uses. Defensive rather than demonstrated: the mechanism is plain
in the code and two reviews flagged it, but six attempts to observe the symptom
measured no dependency growth. The fence is inert if the path is unreachable.

**A fact could be tagged everywhere except where it counted.** `carriesTag`
answered `false` for a key present in the schema but absent from the recorded
tag map, which made "carries nothing" and "not recorded yet" the same answer.
Three ways to reach it: a module's schema became visible one statement before
its tags were recorded, and a source registered by that same module attaches
synchronously in between; a key registered through `facts.$store.registerKeys`
was never recorded at all; and a validation throw part-way through registration
left earlier keys live and unrecorded. Every fact key is recorded now, tags are
recorded immediately after the schema merge, and the store tells the engine
about keys it registers.

**A caller-frozen schema type skipped the validation the freeze exists for.**
`Object.isFrozen` cannot tell "we prepared this" from "the author froze it
first", so a pre-frozen type bypassed the `tags` check. Tracked in a `WeakSet`
instead.

**One bad value could disable the guardrail's startup sweep and its coverage
channel for the process.** The sweep, the coverage report and the metadata
subscription were one unguarded block, so a throwing detector or a value with
hostile property traps ended all three. The sweep now guards per key, and the
report and subscription are armed before it runs. The subscription is also
idempotent across `stop()`/`start()`, which previously leaked a listener and
duplicated every report.

**Cross-realm arrays are accepted.** `tags` was rejected unless its prototype
was exactly `Array.prototype`, which fails for an array from a `vm` context, a
worker or an iframe. The runtime copies `tags` into its own array, and that copy
— not the prototype check — is what defeats a subclass overriding `includes`.

**The coverage digest is delimited.** Hashing the bare concatenation gave
`{"a","bc"}` and `{"ab","c"}` the same digest and the same count, so a coverage
swap was invisible to the signal meant to catch it.
