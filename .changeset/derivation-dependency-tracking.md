---
"@directive-run/core": minor
---

**A constraint or effect that reads a derivation now re-evaluates when that derivation changes.** It did not before, so one gated purely on a derivation ran once, at startup, and never again.

Constraints and effects auto-track what their bodies read, and that tracking was incomplete in two places that compounded:

- Reading a derivation through `system.derive.total` did not register a dependency. Reading the same value as `derived.total` from inside another derivation's body did. Two doors onto one value, and only one of them recorded that the read happened.
- Even where a dependency on a derivation was recorded, incremental evaluation compared dependencies against the set of changed **fact** keys. A derivation ID never appears in that set, so the derivation half of every tracked dependency matched nothing.

The visible symptom is a constraint that will not fire. The derivation flips, every direct reader sees the new value, `system.derive.total` returns it correctly — and the constraint keeps answering with whatever it computed at startup, because nothing knew it cared.

```typescript
derive: {
  overBudget: (facts) => facts.spent > facts.limit,
},
constraints: {
  halt: {
    // Evaluated once. `spent` changing did not bring it back, because the
    // dependency recorded here was `overBudget`, and only fact keys were
    // ever matched against.
    when: (facts, derived) => derived.overBudget,
    require: { type: "HALT" },
  },
},
```

**What changes for you.** A constraint or effect in this shape starts re-evaluating, which means requirements that never fired may begin firing and effects that ran once may begin running again. That is the documented behavior of auto-tracking, and code written against the documentation is what starts working. But a system built around the old behavior — even unknowingly — will see new activity, which is why this is a minor rather than a patch.

Gating on facts alone is unaffected, and there is a test pinning that. The invalidation set is tracked separately from changed fact keys, so history snapshot labels still describe facts, and a derivation going stale without any fact changing cannot make a settled system look dirty.
