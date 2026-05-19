---
"@directive-run/core": minor
---

feat: resolver constraint-binding (`owns`)

Adds opt-in resolver constraint-binding (RFC-0003). A constraint can declare
the facts its resolver *owns*; a write from that resolver to an owned fact is
dropped — and the resolver aborted — if the fact was changed by anything else
since the resolver last wrote it. Eliminates the executor-tail-clobber footgun
(an in-flight resolver's tail overwriting a terminal status an event just set)
without touching the resolver's other ("data") writes.

```ts
constraints: {
  mutate: {
    when: (f) => f.status === "mutating",
    require: { type: "EXECUTE_ACTION" },
    owns: ["status"], // NEW — omit for no binding (default)
  },
}
```

Semantics:

- Per owned fact, the binding remembers the value the resolver last wrote or
  started with. A write to an owned fact lands only if the fact still holds
  that value; otherwise it is dropped, `ctx.signal` is aborted, and that
  fact's ownership is lost (one-shot).
- Writes to facts not listed in `owns` always land.
- The constraint's `when()` predicate is never consulted by the binding.
  Sync constraints only — `owns` on an async constraint is ignored (the
  owned-fact snapshot would race the predicate await; dev-mode warning).
- A bound resolver is **detached, not cancelled**, when its requirement is
  removed — it runs to completion so its data writes land (the binding drops
  only the owned-fact clobber), and the requirement can re-dispatch cleanly.
- No-op for `callOne()` and mixed-source batch resolvers.

This supersedes the `bind: 'auto'` constraint-binding from the reverted
v1.4.0 release, which re-evaluated `when()` on every write — that was
all-or-nothing (dropped legitimate data writes) and coupled to predicate
shape (could freeze a resolver). Migrate `bind: 'auto'` →
`owns: [<phase fact>]`. See `docs/upgrade-guides/constraint-binding.md`.
