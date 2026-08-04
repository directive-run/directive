---
"@directive-run/core": patch
---

**An effect's explicit `deps` stop being re-resolved once the system holds every name in them.**

A `deps` name is resolved against what the system holds when the effect is *considered*, not when it was registered — the piecemeal API lets `system.effects.register("watch", { deps: ["doubled"] })` come before `system.derive.register("doubled", …)`, and resolving once at registration made that order silently significant. Keeping the question open is right. Keeping it open for names that have already been answered is not.

What was carried between reconciles was every name that had not landed on a derivation, which is every ordinary fact key. A fact key cannot come to mean a derivation — a name that is both resolves toward the fact — so those names were re-asked on every reconcile, for the life of the system, with no reachable answer. The list the code described as "empty once every name has resolved" never emptied, and the refresh it described as "a no-op once every name has resolved" never became one.

Only names the system holds nothing under are carried forward now. For a `deps` array written against facts the module declares — which is nearly all of them — the list is empty from the first resolution and the refresh really is the no-op it was meant to be. A name that means nothing yet is still re-asked, and still picked up when a later module or a `register` call gives it a meaning, in either direction.

The saving is the whole of the bookkeeping, and it scales with how much of a system is effects. Measured on repeated single-fact reconciles against effects declaring explicit `deps`: 1.10x at ten effects of five deps, 1.18x at a hundred of ten, 1.29x at four hundred of twenty. That last figure is the same reconcile doing 29% less work, none of which had a way to change an outcome.

No behavior changes. Which effects wake, on what, and in what order are all unaffected.
