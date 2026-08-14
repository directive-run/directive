---
"@directive-run/core": minor
"@directive-run/ai": patch
---

Three fixes for changes that took effect but were never announced, plus a new
`system.meta.revision()` counter that makes the third fixable at all.

**`derive.assign` could leave `settle()` waiting forever.** Replacing a
derivation definition records an invalidation, but the reconcile tail only
scheduled a pass when a *fact* had changed — and replacing a derivation changes
no fact key. The invalidation sat undelivered with no pass in which to deliver
it, and `await system.settle()` never returned. Definition changes now schedule
a pass when one is owed.

**The runaway-reconcile guard could never fire.** `MAX_RECONCILE_DEPTH` warns
when reconcile passes chain without settling, but the counter was reset at the
end of every pass and re-entry is refused at the top, so it reached one and went
back to zero, forever. A resolver feeding its own constraint could spin
indefinitely with nothing printed. The counter now resets when the system
actually reaches quiet, which is the state that distinguishes a circular chain
from a busy system — a chain never reaches it, a busy system reaches it between
changes.

**`factPIIGuardrail` stopped screening facts that arrived after it started.** It
built its set of pii-tagged fact keys once, on init. A module registered later
brought its own tagged facts, and a write to one of them took the same early
return an untagged key takes: no scan, no redaction, nothing reported. The set
now rebuilds when the system's metadata changes.

**New: `system.meta.revision()`.** An integer that moves whenever the set
`meta.byTag()` and `meta.byCategory()` search can have changed. Both walk every
definition in the system, so anything consulting them on a hot path caches the
answer — and had no way to learn the answer had gone stale short of re-walking.
Compare this number against the one held with your cache and rebuild only when
it has moved. Only equality is meaningful: a spurious rebuild is correct, a
skipped one is not.
