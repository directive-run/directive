# RFC 0004 — Data-configuration triggers (`FactPredicate` / `FactTemplate`)

- **Status:** Draft (2026-05-19)
- **Author:** Jason Comes
- **Related:** [RFC 0003 — Resolver constraint-binding (`owns`)](./0003-resolver-constraint-binding.md)

## Summary

Every Directive definition expresses its *trigger* or *matcher* as an opaque
function: a constraint's `when`, a resolver's `key`, an effect's deps, a
derivation's `compute`. A function is a black box — it cannot be serialized,
statically analyzed, or explained clause-by-clause.

This RFC adds an optional **declarative data form** alongside each function
form. Two primitives:

- **`FactPredicate`** — a boolean spec over a fact namespace
  (`{ phase: "red", elapsed: { $gte: 30 } }`). Drop-in replacement for a
  constraint `when`, effect `on`, or boolean derivation `compute`.
- **`FactTemplate`** — a fact-interpolating string expression
  (`{ $template: "Phase ${phase}" }`). The value-producing counterpart —
  usable as a string derivation, in `require` field values, and in event
  `patch` values.

Plus two narrow selectors that round out the data forms:

- **`KeySelector`** — `["type", "to"]` builds a stable resolver dedup key
  from requirement-payload fields.
- **`PatchSpec`** — `{ $set: { status: { $ref: "value" }, label: { $template: "user ${name}" } } }`
  is a declarative event handler.

The function escape hatch remains on every surface. The data form is purely
additive; nothing existing breaks.

```ts
constraints: {
  transition: {
    when: { phase: "red", elapsed: { $gte: 30 } },
    require: { type: "TRANSITION", to: "green" },
  },
},
effects: {
  ledOn: {
    on: { phase: "red" },
    run: () => turnLedOn(),
  },
},
resolvers: {
  fetcher: {
    requirement: "FETCH",
    key: ["id"],
    resolve: doFetch,
  },
},
events: {
  setStatus: {
    patch: {
      $set: {
        status: { $ref: "value" },
        label: { $template: "user ${name}" },
      },
    },
  },
},
derive: {
  isAdult:  { compute: { age: { $gte: 18 } } },         // boolean
  fullName: { compute: { $template: "${firstName} ${lastName}" } },  // string
},
```

## Motivation

Four properties only a data form can deliver:

1. **Serializable.** A predicate is a plain object — it survives the
   devtools wire, web-worker transfer, SSR hydration, and replay archives.
   A function does not.
2. **Introspectable.** `system.explain()` can render the per-clause
   `✓/✗` breakdown of *why* a constraint fired (or didn't):
   `phase ✓ red · elapsed ✗ 20, needs ≥ 30`. With a function, the
   evaluator returns one bit (`true`/`false`); the *structure* is hidden.
3. **Statically analyzable.** Dep extraction is structural — walk the
   tree, collect fact keys — which eliminates the explicit-`deps`
   footgun on async constraints (a data `when` is always sync, so
   auto-tracking always captures the deps correctly).
4. **Less typing.** The common cases (`phase === "red"`,
   `elapsed >= 30`, "did this fact change") become declarations, not
   closures. The function form stays available for everything else.

The data form is also where future analysis-oriented features become
tractable — contradictory-constraint detection, unreachable-constraint
warnings, time-travel-friendly definitions, devtools panels that render
predicate trees natively rather than function source strings.

## The two primitives

### `FactPredicate`

A boolean spec over a fact namespace `F`. Three forms (a value of any
form satisfies `FactPredicate<F>`):

```ts
// Object form — the common case. Keys ⊆ fact/derivation names.
// Bare value → equality. Operator object → comparison. Multiple keys → AND.
{ phase: "red", elapsed: { $gte: 30 } }

// Array form — explicit clauses, AND-ed. Useful for codegen and devtools.
[{ fact: "phase", op: "$eq", value: "red" },
 { fact: "elapsed", op: "$gte", value: 30 }]

// Combinator node — one of $all / $any / $not, nestable.
{ $any: [{ phase: "red" }, { phase: "yellow" }] }
{ $not: { paused: true } }
```

Operators (the `$`-prefixed keys inside an operator object):

| Operator                          | Use                                  |
| --------------------------------- | ------------------------------------ |
| `$eq`, `$ne`                      | Equality / non-equality              |
| `$in`, `$nin`                     | Membership in an array of literals   |
| `$gt`, `$gte`, `$lt`, `$lte`      | Relational (number / bigint / Date / string) |
| `$between`                        | Inclusive range, sugar over `$gte`+`$lte` |
| `$matches`                        | Regex test against a string fact     |
| `$contains`                       | Substring / array-element membership |
| `$exists`                         | Key present and not `undefined`      |
| `$changed`                        | Effects only — fact value differs from `prev` |

Combinators: `$all`, `$any`, `$not`.

A plain (non-operator) object value inside a predicate is a **nested
predicate** — used for cross-module namespaced facts:

```ts
when: {
  self:  { phase: "red" },
  auth:  { token: { $exists: true } },
}
```

### `FactTemplate`

A fact-interpolating string. `${ident}` placeholders are replaced with
`String(scope[ident])`; `$${` emits a literal `${`.

```ts
fullName: { compute: { $template: "${firstName} ${lastName}" } }

require: { type: "ALERT", message: { $template: "Inventory: ${count}" } }

events: { setLabel: { patch: { $set: { label: { $template: "User ${name}" } } } } }
```

Placeholder keys are restricted to the identifier grammar
`[A-Za-z_][A-Za-z0-9_]*`. Unknown keys dev-warn and emit an empty
string in production.

## Per-surface design

Every surface accepts `function | data`. Discrimination happens **once at
registration** (or at engine wiring time for `system.constraints.register()`):
a function passes through, a data spec is wrapped into the same function
shape the eval-time code already expects. The hot path never branches on
form.

| Surface              | Type widening                                                | Runtime                                                        |
| -------------------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| Constraint `when`    | `Fn \| FactPredicate<F>`                                     | Wrapped into a sync `Fn`; reads through the tracked proxy so deps are captured automatically. Data `when` is always sync — `async: true` and explicit `deps` on a data `when` dev-warn and are ignored. |
| Effect `on`          | `EffectDef.on?: FactPredicate<F>` (mutually exclusive with `deps`) | `extractDeps(on)` populates `state.dependencies`; `shouldRun` evaluates the predicate after the dep-overlap pre-filter. `$changed` reads the previous snapshot (treated as "changed" on first run). |
| Resolver `key`       | `RequirementKeyFn<R> \| KeySelector<R>`                      | Array form is wrapped into a `RequirementKeyFn` that JSON-encodes the selected fields in declared order. |
| Event `patch`        | New sigil-free `{ patch: PatchSpec, meta? }` arm             | Synthesized into a handler that calls `applyPatch` over the dispatched event. `$ref` copies a payload field; `$template` interpolates over the event. |
| Derivation `compute` | `Fn \| FactPredicate<F> \| FactTemplate`                     | Predicate → boolean wrapper; template → string wrapper. Existing auto-tracking still captures dependencies because the synthesized wrapper reads through the same facts proxy. |

`require` and `patch` `$set` values may also contain `{ $template }` and
`{ $ref }` nodes. Discrimination is conservative: a value is treated as
a template / ref only when it is an object whose **sole own key** is
`$template` / `$ref` — so user data shaped like `{ $template: 0 }`
(unusual but possible) is unambiguous from a template node.

## Introspection (the "why did it fire" view)

A data-form `when` is structured, so the engine can render *why* a
constraint did or did not fire — at runtime, without instrumentation.

```ts
system.inspect().constraints
// → [{ id: "transition", active: true, whenSpec: { phase: "red", elapsed: { $gte: 30 } }, … }]

system.observe((event) => {
  if (event.type === "constraint.evaluate" && event.whenExplain) {
    console.log(event.whenExplain);
    // [{ path: "phase", op: "$eq", expected: "red", actual: "red", pass: true },
    //  { path: "elapsed", op: "$gte", expected: 30, actual: 20, pass: false }]
  }
});

system.explain(requirementId);
// Requirement "TRANSITION" (id: …)
// ├─ Produced by constraint: transition
// ├─ Predicate clauses:
// │  ├─ ✓ phase $eq red (actual: red)
// │  └─ ✗ elapsed $gte 30 (actual: 20)
// └─ …
```

`whenExplain` is only emitted for constraints whose `when` is a data
form; function-form constraints continue to emit just `{ active }`.

## Cross-module / namespaced predicates

In a cross-module constraint, facts arrive as `facts.self.*` and
`facts.{dep}.*`. The data form mirrors that access shape:

```ts
when: {
  self: { phase: "red" },
  auth: { token: { $exists: true } },
}
```

`extractDeps` emits namespaced keys (`self.phase`, `auth.token`) that
the cross-module dependency tracker already understands.

## Operator constraints (the per-operator union)

`OperatorObject<V>` is a **per-operator union**, not an intersection.
Each `OperatorObject<V>` member carries exactly one operator key.
Consequences:

1. A typo'd operator (`$eqq: 30`) matches no member of the union → compile
   error.
2. A relational operator on a non-orderable fact (`$gt: 1` against a
   `boolean` fact) resolves to `never` → compile error.
3. Multiple operators on the same fact (`{ $gte: 30, $lt: 120 }`) are
   intentionally **not** expressible in one operator object — write
   them as the array form or `$all`:
   ```ts
   when: { elapsed: { $gte: 30 } }     // ✓
   when: { $all: [{ elapsed: { $gte: 30 } }, { elapsed: { $lt: 120 } }] }
   ```

`[V]` tuple-wrapping in `IsOrderable<V>` suppresses distribution over
union-typed facts, so `t.enum` literals and nullable facts type-check
correctly.

## Limitations and deferred work

- **`$changed` in constraints.** Constraints have no `prev` snapshot;
  `$changed` is effects-only. To gate a constraint on "fact changed",
  use a boolean derivation that itself watches the change source.
- **Codemod.** A function `when` → data `when` codemod is deferred —
  function bodies are arbitrary and only a narrow subset is mechanically
  convertible. A best-effort transformer is on the roadmap.
- **Definition snapshotting.** The data form is *inherently* serializable
  (a plain object), and the devtools wire carries `whenSpec` /
  `whenExplain` end-to-end. SSR / time-travel of definitions (not just
  facts) is future work.
- **Devtools-panel + CLI rendering.** The engine surfaces the
  `whenSpec` and `whenExplain` data on `inspect()` and the observation
  event; the `devtools-panel` widget and `directive explain` CLI
  consume the same data. Their visual layer follows in a separate change.

## Lab-soak decision

`Predicate` / `Template` are brand-new primitives with a ~12-operator
DSL surface. The convention in `docs/ARCHITECTURE.md` ("Feature
Lifecycle") would normally soak a primitive of this size as
`.lab.ts` for one minor before promoting to core. This RFC
intentionally skips the soak, with the following rationale recorded:

- The feature is **purely additive** — every existing function form
  keeps working unchanged. There is no migration burden.
- The function escape hatch is always available, so any rough edge
  in the operator set has a zero-cost workaround.
- The operator set follows MongoDB's well-known conventions; users
  arriving from query DSLs find it familiar.
- The introspection payoff (`whenExplain`) is core-grade — gating it
  behind a lab import would significantly diminish the user-facing
  value of the RFC at landing.

If the operator surface needs revision after real-world use, that
becomes a deprecation of specific operators rather than a wholesale
promotion-from-lab event.

## Naming conventions

- Sigil-prefixed (`$eq`, `$gte`, `$all`, `$any`, `$not`, `$template`,
  `$set`, `$ref`) marks an *expression/operator node inside a predicate
  or template body*.
- Sigil-free (`compute`, `handler`, `patch`) marks a *definition arm* —
  consistent with the existing `{ compute, meta }` and
  `{ handler, meta }` object forms.
- `$`-prefixed schema keys are rejected at registration, so no fact
  name can ever shadow an operator.

## Alternatives considered

- **One-operator-per-key object** (`{ elapsed: { $gte: 30, $lt: 120 } }`).
  Rejected: TypeScript cannot soundly type "object with at least one
  operator key from a constrained set" via mapped types; the per-operator
  union is the only form that produces the compile-time errors the data
  form needs (typo'd operator, non-orderable comparison).
- **JSON-schema matchers.** Rejected as too generic — schema-matching
  semantics differ from predicate semantics in subtle ways (e.g. shape
  vs. value, present vs. equal), and the operator surface needed for
  constraint `when` is narrower than JSON Schema's.
- **String DSL** (`"phase == 'red' && elapsed >= 30"`). Rejected:
  parsing reintroduces a black box, type safety is hard to thread,
  and the static-analysis story (extractDeps, devtools rendering) is
  no better than from a function.

## Open questions

- Should the placeholder-extracted template type be enforced at the
  type level (`${"firstName"} ${"lastName"}` against the schema)? A
  best-effort version is feasible via template-literal types but hits
  the instantiation-depth ceiling on long strings; deferred to v2.
- Should the `$changed` operator be available on string-template
  derivations (recompute only when a referenced fact changes)?
  Currently the auto-tracked derivation invalidator already covers
  this — the operator is unnecessary at the derivation level.
