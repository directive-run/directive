---
"@directive-run/core": minor
---

feat: data-form definitions (`FactPredicate`, `FactTemplate`)

Every Directive definition can now express its trigger or matcher as a
plain data object in addition to the function form. The function form
is unchanged; the data form is purely additive.

```ts
constraints: {
  transition: {
    when: { phase: "red", elapsed: { $gte: 30 } },   // NEW — was: (f) => …
    require: { type: "TRANSITION", to: "green" },
  },
},
effects: {
  ledOn: {
    on: { phase: "red" },                            // NEW — was: deps: [...]
    run: () => turnLedOn(),
  },
},
resolvers: {
  fetcher: {
    requirement: "FETCH",
    key: ["id"],                                     // NEW — was: (req) => req.id
    resolve: doFetch,
  },
},
events: {
  setStatus: {
    patch: {                                         // NEW — alongside handler
      $set: {
        status: { $ref: "value" },
        label:  { $template: "user ${name}" },
      },
    },
  },
},
derive: {
  isAdult:  { compute: { age: { $gte: 18 } } },                          // boolean
  fullName: { compute: { $template: "${firstName} ${lastName}" } },      // string
},
```

Operators: `$eq`, `$ne`, `$in`, `$nin`, `$exists`, `$gt`, `$gte`, `$lt`,
`$lte`, `$between`, `$matches`, `$contains`, `$changed` (effects only).
Combinators: `$all`, `$any`, `$not`. Nested predicates handle
cross-module namespaced facts.

The data form unlocks introspection that a function form cannot:

- `system.inspect().constraints[]` exposes `whenSpec` — the original
  predicate object — for any consumer (devtools, custom inspectors).
- The `constraint.evaluate` observation event carries `whenExplain` —
  a per-clause breakdown showing which clauses passed and which failed.
- `system.explain(requirementId)` renders the clause tree:
  ```
  ├─ Predicate clauses:
  │  ├─ ✓ phase $eq red (actual: red)
  │  └─ ✗ elapsed $gte 30 (actual: 20)
  ```

A data `when` is always sync, so the auto-tracking deps capture
correctly without an explicit `deps` array. The function escape hatch
remains on every surface.

See `docs/rfcs/0004-data-configuration-triggers.md` and
`docs/concepts/data-triggers.md` for the full reference.
