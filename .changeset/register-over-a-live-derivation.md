---
"@directive-run/core": patch
---

**Registering a module whose `derive` names a derivation the system already has now replaces it properly.** It used to leave the graph in a state the invalidation walk assumes cannot happen, and it did so permanently.

`system.registerModule()` checks fact-name collisions and, in development, warns when a fact and a derivation end up sharing a name. It has never checked one derivation name against another, so a module that names an existing derivation registers without complaint and the definition is replaced. What was missing is everything that has to happen *around* the replacement:

```typescript
// A system whose `downstream` reads `total`.
derive: {
  total: (facts) => facts.n + 1,
  downstream: (_facts, derived) => derived.total + 1,
}

// A second module names `total` and means something else by it.
system.registerModule(second); // derive: { total: (facts) => facts.n * 10 }
```

Reading `total` gave the new value. Reading `downstream` gave the old one, and went on giving it — through every later write to `n`, for the life of the system.

The key was handed a brand new state object: stale, with an empty dependency set, and with nothing downstream told. Both halves of that hurt. The old dependency set went with the old state, so the diff that removes stale links on the next recompute compared the new dependencies against nothing and left every link the replaced definition had tracked in place — a fact the replacement never reads goes on invalidating it. And a node reset to stale with its dependents left valid is a valid derivation sitting under a stale one, which is the one shape the invalidation walk assumes cannot happen: it stops at the stale frontier on the grounds that everything past it is already stale. So the walk stopped at that node, every time, and the dependents were never woken again.

This is the same defect as the one fixed in `system.derive.assign()` — described elsewhere in these notes, and shipping in the same release — on the other route to the same act. Both now go through one path, because they are the same thing happening and diverging on either obligation is how one of them acquired the defect while the other did not.

Registering a derivation name that is genuinely new is unchanged.
