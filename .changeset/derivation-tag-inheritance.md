---
"@directive-run/core": minor
---

**Tags now travel down the derivation graph, so `byTag("pii")` finds the computed values too.**

A tag on a fact is a claim about the value. A derivation carries that value forward — often unchanged — but the claim stopped at the fact. Tag `email` as `pii`, add `domain: (facts) => facts.email`, and `system.meta.byTag("pii")` answered with `["fact:email"]` alone. Every tag-driven consumer — the audit ledger, the clobber alerts, any redactor written against the tag — treated a verbatim copy of PII as non-sensitive, by construction. The dependency graph that could answer the question was already being maintained for invalidation; nothing was asking it.

```ts
system.meta.byTag("pii");
// [ { type: "fact",       id: "email"  },
//   { type: "derivation", id: "domain", via: "inherited" } ]

system.meta.derivation("domain")?.inheritedTags; // ["pii"]
```

`via: "inherited"` separates a claim someone wrote from one the graph inferred, so a consumer can act on both and still tell them apart. Authored tags stay reported as authored — `inheritedTags` is the difference, not the union. Inheritance is transitive through composition.

**Saying where the claim stops.** Some derivations are the point at which it no longer holds — a hash, a bucket, a count, a redaction. `meta: { inheritsTags: false }` says so, and because that is a statement about the value it holds downstream too: a derivation reading a sanitized one is not walked through to its inputs. A separate key rather than an empty `tags: []`, so a derivation can be sanitized *and* tagged something unrelated at once.

**What it can and cannot tell you.** Inheritance follows what a derivation actually read on its last computation — the same tracking that makes derivations work without a `deps` array. So `(facts) => facts.consented ? facts.email : ""` inherits `pii` while `consented` is true and stops when it flips. That is accurate about the value now and silent about the value in a state the program has not reached. Read `byTag("pii")` as "every value carrying PII in the state the system is in", not "every value that ever could".

Nothing that read `byTag` before changes meaning; the results grow. `meta.derivation(id)` still returns `undefined` for a derivation with no meta and no inherited tags.
