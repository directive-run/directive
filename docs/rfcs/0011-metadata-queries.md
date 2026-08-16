# RFC 0011 — Metadata queries: ask per definition, and be told when the answer moves

- **Status:** Accepted – implemented 2026-08-16
- **Supersedes:** the `MetaMatch` shape and `MetaAccessor.revision()` described in the 1.27.0 and
  1.28.0 changelogs
- **Related:** RFC 0006 (spelled-out type names), whose carve-out keeping `MetaAccessor` as-is is
  upheld here

## Summary

`system.meta.byTag("pii")` decides what gets redacted before a value reaches a model, a log, or a
hash-chained audit ledger. Answering it walks every definition in the system, so all three consumers
cached the answer — and every defect this area has had was a cache built once and never rebuilt.

This replaces the cache with a question: `carriesTag(kind, id, tag)`, O(1) for a fact. It replaces the
polled counter with a subscription. And it renames the parts of the shape that were teaching the
wrong thing.

## The four defects, measured

Three were reproduced against the built package before anything was changed.

**D1 — plugins were told about a write before the graph knew about it.** The store announced to
plugins and invalidated derivations second, so a plugin asking what a value carried during
`onFactSet` got an answer from before the write it was reacting to. The batched path already
invalidated first, so the two paths disagreed: the same write inside `system.batch()` and outside it
produced different answers.

**D2 — dynamic definition registration moved no counter.** `constraints.register(id, { meta: { tags:
["pii"] } })` changed what `byTag` answered while `revision()` stayed at `0`. Measured: `[] →
[constraint:c1] → []` with the counter unmoved throughout.

**D3 — not reproduced.** A review reported that calling `byTag` inside a constraint's `when()` put
every derivation into that constraint's dependency set, and measured the watched set going 0 → 6.
Four attempts to reproduce measured `0` every time, including a baseline where a constraint reads a
derivation directly. The mechanism is real in the code — `when` runs in an observer tracking frame,
and the derivations accessor records a watcher under exactly that condition — but something
downstream neutralises it. No fence was added; two tests were left as guards.

**D4 — `collectAllMeta` is O(D²).** Each root re-walks its own transitive closure with no memo across
roots. Measured on a deep chain: 50 → 0.32ms, 100 → 0.96ms, 200 → 3.57ms, 400 → 14.4ms.

Two exposures were also found, both unconditional and neither previously known: a metadata lookup
failing at `onInit` disabled the guardrail for the process, and plugin order decided whether
`hydrate` / `initialFacts` were screened at all.

## What changed

| Before | After |
|---|---|
| `revision(): number`, polled | `subscribe(tags?, listener, { immediate })`, pushed |
| `byTag(tag)` and then cache it | `carriesTag(kind, id, tag)` per lookup, O(1) for a fact |
| `byTag(tag)` | `byTag(tag, { kind })` so a fact-only consumer stops walking the rest |
| `MetaMatch.type` | `kind`, typed `DefinitionKind` |
| `via?: "inherited"` | `tagOrigin: "authored" \| "inherited"`, always present |
| `inheritsTags?: boolean` | `tagBoundary?: boolean` |
| `byCategory` | removed |

No aliases, no deprecation window, no codemod. The surface had no external consumers, so the old
names are gone in the same change that added the new ones.

## Why `subscribe` and not `watch`

`system.watch` promises `(newValue, previousValue)` and takes an `equalityFn`. Honouring that would
mean computing `byTag` on every change for every watcher and diffing arrays of objects — the cost the
whole surface exists to avoid. It also implies the value *did* change, which the engine cannot
promise: the signal is coarse on purpose.

`system.subscribe` already means "these keys moved, read again", takes no values and returns an
unsubscribe. That is exactly the counter's semantics minus the polling, so it costs no new
vocabulary. `observe` is one global stream with no per-consumer filter; `when` is one-shot and this
recurs for the life of the system.

`{ immediate: true }` exists because every defect in this cluster was a set built at init and never
rebuilt. Making the first build and every rebuild the same call site removes the shape rather than
this instance of it.

## Why `boolean | undefined`

`carriesTag` has three answers, and the third is the point. `undefined` means the runtime could not
answer — a derivation body threw, or the definition is unknown. A consumer that reads that as "no tag,
nothing to redact" reproduces the exact defect the 1.29.1 guardrail fix was written to prevent, where
a key missing from a set and a key that scanned clean left identical traces. Every consumer defaults
it to the safe side: the guardrail screens, the ledger redacts, the loop detector escalates.

## Why `tagBoundary` and not `sanitizes`

`sanitizes: true` reads better and was the first choice. It was rejected because "sanitize" already
means "strip dangerous content from a string" in roughly a hundred places across the sandbox, the
prompt-injection guardrail, the lint package and the DOM adapter. The mechanism here stops tag
propagation and nothing else — the runtime never inspects the value and cannot tell whether the claim
stopped holding. On a redaction boundary, a name that reads as a guarantee the runtime does not make
is the wrong risk. `tagBoundary` keeps the positive polarity that made `inheritsTags: false` awkward,
without the promise.

## Rejected alternatives

**`byTag` as a derivation.** The obvious shape for a reactive runtime: make the query itself tracked,
so anything reading it re-runs when its inputs change. It cannot work. Derivation bodies receive
`(facts, derived)` and nothing else, and tracking covers fact keys and derivation IDs — a body
physically cannot depend on the definition registry. Worse, a new module registration would not
invalidate such a derivation, which is the precise bug the counter was added to paper over.

**A refcounted inherited-tag index** maintained in `addDepLink` / `removeDepLink`, propagated over the
dependency graph. Designed, reviewed, and dropped. It keys on *edge* changes while the answer depends
on *meta*: `updateDependencies` returns early when the dep set is unchanged, so a `derive.assign` that
drops a boundary flag propagates nothing and the index answers "clean" for a node carrying PII —
fail-open on a redaction boundary. Its enabling flag was itself a built-once-never-rebuilt latch,
refcounts cannot collect the cycles the `has` trap can build without throwing, and
`updateDependencies` is remove-all-then-add-all so propagation was O(down-cone) twice per recompute.

Dropping it leaves D4 unfixed. That is accepted: once no consumer calls `byTag` per write, an O(D²)
inventory query is not a hot path.

## Verification

Every test was shown to fail before the change it guards. Notable ones:

- a probe plugin's `onFactSet` sees a tag flip **at that write** — red before D1's fix, and the
  batched half of the same test was green, which is what made the disagreement visible
- a throwing `system.watch` subscriber must not skip `emitFactSet` — red the moment invalidation moves
  ahead of the announcement
- `$store.registerKeys` cannot untag a live fact, and `_meta` cannot be reassigned
- a pii fact from a module registered after start is redacted in the ledger
- a guardrail registered *second* screens `initialFacts`, and leaves an untagged fact alone in the
  same window — over-screening is not the safe direction when redact mode rewrites the fact
