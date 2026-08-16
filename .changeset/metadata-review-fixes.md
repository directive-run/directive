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
