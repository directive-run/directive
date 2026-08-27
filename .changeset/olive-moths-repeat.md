---
"@directive-run/core": patch
---

Effects no longer copy every fact on every pass when nothing reads `prevFacts`

An effect's second parameter, `prevFacts`, was built by copying the entire fact
store once per reconciliation pass — whether or not a single effect took a second
parameter. Most effects only read `facts`, and they paid for the copy anyway.

The cost scaled with the size of the whole system rather than with the effects in
it, which made it the dominant per-pass cost at scale and put a ceiling on how
many facts a system could hold before reconciliation stopped fitting in a frame.

Measured, per pass, comparing an effect declared `(facts)` against the same effect
declared `(facts, prevFacts)`:

| facts | reads prevFacts | does not | saved per pass |
|---|---|---|---|
| 500 | 0.045 ms | 0.014 ms | 0.03 ms |
| 5,000 | 0.311 ms | 0.009 ms | 0.30 ms |
| 20,000 | 1.502 ms | 0.015 ms | 1.49 ms |
| 50,000 | 5.344 ms | 0.007 ms | 5.34 ms |

The saving is quoted rather than a ratio on purpose: the second column is small
enough that a ratio would be reporting measurement noise as precision. What
matters is its shape, not its size — it is flat. Effects that do not read
`prevFacts` now cost the same per pass whether the system holds five hundred
facts or fifty thousand, so the per-pass cost stops scaling with the size of the
system and starts scaling with the effects in it.

This applies to composed systems as well as single-module ones. The namespace
transform wraps every effect in a three-parameter function, so the wrapper now
records whether the effect inside it reads `prevFacts` — otherwise every
namespaced effect would look like a reader, and systems built from several
modules, which hold the most facts, would have been the ones to get nothing.

Nothing changes for effects that do read it. Detection is deliberately pessimistic
because arity alone cannot answer the question — `Function.length` stops counting
at the first default or rest parameter, so it reports one for
`(facts, prevFacts = null) => …` and zero for `(...args) => …`, and both read
`prevFacts`. When arity is inconclusive the parameter list is read from the
function source, and any answer that cannot be reached confidently is "yes". A
snapshot nobody reads costs time; a skipped snapshot somebody reads is a wrong
value in a place that looks like a comparison against history, and those are not
symmetric.

An effect using a data `on` gate always gets a real snapshot, since the runtime
hands the gate `prevFacts` itself. An effect registered after the system is
running also gets one immediately rather than on its second pass — for a gate
that matters more than a wrong value, because the predicate runtime reads an
absent previous state as "everything changed", which would fire a `$changed`
gate on a fact that had not changed.
