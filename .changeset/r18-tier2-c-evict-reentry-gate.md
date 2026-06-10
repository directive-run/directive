---
"@directive-run/core": patch
---

`system.evict()` reentry gate (R18 Tier 2-C / RFC 0009 follow-up):

The engine now sets `state.isEvicting` BEFORE awaiting any async eviction
work. Concurrent or repeat `system.evict()` calls observe the flag and
become no-ops past the first. Without the gate, Cloudflare DO hibernation
paths that signal eviction twice would re-run every source's `onEvict`
handler — sources with non-idempotent eviction (e.g. one that posts a
"going away" message to a broker) would double-fire.

The gate is set-once / never-cleared (eviction is terminal); a subsequent
`system.evict()` after the first completes is a no-op, matching the
contract of `system.destroyAsync()`.

`coalesce: "all"` is left as-is — the JSDoc already documents that `"all"`
is a no-op equivalent to `"none"` ("names the intent for readers"), so
the previous R18 finding of "type-system lie" is closed by the existing
docs. The RFC index's open follow-up entry for `coalesce: "all"` is
withdrawn.
