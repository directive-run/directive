---
"@directive-run/mutator": minor
---

`MutatorFragments.facts.pendingMutation` now preserves the `PendingMutation<M>` generic when spread into a module schema.

The fragment type previously surfaced as `ReturnType<typeof t.object>` — a fully-erased object schema with no narrowing. Spreading `...mut.facts` into `schema.facts` collapsed the typed `{kind, payload, status, error}` shape to `unknown`, killing autocomplete on the very fact the package exists to type.

The interface is now `pendingMutation: SchemaType<PendingMutation<M> | null>`. Consumers reading `facts.pendingMutation` after the spread get the typed discriminated union narrowed by `kind` — exactly the shape `defineMutator<M, F>` was designed to produce. Pure type-layer change; runtime behaviour is unchanged.
