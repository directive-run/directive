# Data-form definitions

Most Directive definitions can be written two ways: as a function (the
original form) or as a plain data object (the "data form"). The data
form is purely additive — function definitions keep working unchanged,
and every surface accepts either.

## Why bother

Three things you cannot do with a function but can do with data:

- **See why a constraint fired.** `system.explain()` renders a
  per-clause `✓/✗` breakdown of the predicate against the live facts.
- **Carry the trigger across a wire.** A predicate is JSON-safe, so it
  survives the devtools transport, web-worker boundaries, and replay
  archives. A function does not.
- **Get free deps.** A data predicate is structural — the engine knows
  which facts it reads without running it. Async constraints lose their
  explicit-`deps` footgun because a data `when` is always sync, and the
  engine clears any `async: true` on the def at registration to make
  the runtime behavior match.

## Migrating from XState guards

XState's `cond` / `guards` express the same thing as a Directive data
`when` — a boolean precondition over facts. The shape is different but
the translation is mechanical:

| XState                                            | Directive                                  |
| ------------------------------------------------- | ------------------------------------------ |
| `cond: (ctx) => ctx.count > 5`                    | `when: { count: { $gt: 5 } }`              |
| `guards: { isReady: (ctx) => ctx.ready }`         | `when: { ready: true }`                    |
| `cond: (ctx) => ctx.phase === "red"`              | `when: { phase: "red" }`                   |
| guards + multiple conditions                      | `when: { $all: [ ... ] }`                  |
| async guards                                      | function `when` (data form is sync-only)   |

If your XState guard reads multiple contexts and computes — use the
function form. If it compares facts to values — use the data form.

## Quick reference

```ts
import { createModule, t } from "@directive-run/core";

createModule("traffic", {
  schema: {
    facts: {
      phase: t.string<"red" | "green">(),
      elapsed: t.number(),
      label: t.string(),
      age: t.number(),
      firstName: t.string(),
      lastName: t.string(),
    },
    derivations: { isAdult: t.boolean(), fullName: t.string() },
    events: { setStatus: { value: t.string(), name: t.string() } },
    requirements: { TRANSITION: { to: t.string() } },
  },

  // Constraint — declarative boolean trigger.
  constraints: {
    transition: {
      when: { phase: "red", elapsed: { $gte: 30 } },
      require: { type: "TRANSITION", to: "green" },
    },
  },

  // Effect — runs when a referenced fact changes AND the predicate holds.
  effects: {
    blink: {
      on: { phase: "red" },
      run: () => beep(),
    },
  },

  // Resolver — declarative dedup key.
  resolvers: {
    transition: {
      requirement: "TRANSITION",
      key: ["to"],
      resolve: async (req) => doTransition(req.to),
    },
  },

  // Event — declarative patch instead of a handler.
  events: {
    setStatus: {
      patch: {
        $set: {
          phase: { $ref: "value" },
          label: { $template: "user ${name}" },
        },
      },
    },
  },

  // Derivation — predicate (boolean) or template (string).
  derive: {
    isAdult:  { compute: { age: { $gte: 18 } } },
    fullName: { compute: { $template: "${firstName} ${lastName}" } },
  },
});
```

## `FactPredicate` — boolean predicates

A predicate is an object whose keys are **fact names** and whose values
are either a literal (equality) or an operator object.

> **Fact names only.** A predicate addresses facts, not derivations. To
> gate on a derivation, reference the underlying fact the derivation
> reads, or fall back to a function `when` / `on`. This keeps the
> deps walker structural and avoids derivation-result/predicate-tree
> races.

```ts
when: { phase: "red", elapsed: { $gte: 30 } }
//     ^^^^ equality          ^^^^^^^^^^^^^ operator object
```

Multiple keys are AND-ed. For OR / NOT, use combinators:

```ts
when: { $any: [{ phase: "red" }, { phase: "yellow" }] }
when: { $not: { paused: true } }
when: { $all: [
  { phase: "red" },
  { $any: [{ elapsed: { $gte: 30 } }, { manualOverride: true }] },
]}
```

### Operator reference

| Operator        | Usable on             | Example                                     |
| --------------- | --------------------- | ------------------------------------------- |
| `$eq`           | any                   | `{ phase: { $eq: "red" } }`                 |
| `$ne`           | any                   | `{ phase: { $ne: "green" } }`               |
| `$in` / `$nin`  | any                   | `{ phase: { $in: ["red", "yellow"] } }`     |
| `$gt`, `$gte`, `$lt`, `$lte` | `number`, `bigint`, `Date`, `string` | `{ elapsed: { $gte: 30 } }` |
| `$between`      | orderable             | `{ elapsed: { $between: [30, 120] } }`      |
| `$matches`      | `string` (RegExp only — use real `RegExp` instances for flag control) | `{ name: { $matches: /^J/i } }` |
| `$startsWith`   | `string`              | `{ name: { $startsWith: "Ada" } }`          |
| `$endsWith`     | `string`              | `{ email: { $endsWith: "@example.com" } }`  |
| `$contains`     | `string`, array, or `Set` | `{ tags: { $contains: "admin" } }` |
| `$exists`       | boolean operand       | `{ token: { $exists: true } }` (value is not `undefined`) |
| `$changed`      | effects only          | `{ phase: { $changed: true } }`             |

> **`$matches` requires a `RegExp`.** Pass `/pattern/flags` directly —
> string operands cannot express flags (case-insensitivity, dotall,
> multiline) and were never structurally safe against ReDoS, so a
> non-RegExp operand throws at evaluation.
>
> **`$contains` on `Set` / `Map`.** `$contains` walks a `string`
> (substring match), an array (element equality, structural), or a
> `Set` (native `.has()` — reference-equality for objects, value
> equality for primitives). `Map` is not yet supported; iterate to an
> array if you need to gate on `Map` membership.
>
> **`$exists` is a boolean.** `{ $exists: true }` requires the fact to
> be defined (not `undefined`); `{ $exists: false }` requires it to be
> `undefined`. `null` counts as defined.
>
> **`$exists` diverges from MongoDB.** MongoDB's `$exists` tests field
> *presence in the document*. Directive's `$exists` tests
> `value !== undefined` (so `null` counts as defined). If you need
> "fact-key missing entirely", wrap the fact in `t.optional(...)` and
> check for `undefined`.
>
> **`$eq` / `$ne` on `Set` / `Map` facts.** Equality is structural,
> not by reference: two `Set`s with the same members compare equal
> regardless of insertion order; two `Map`s compare equal when they
> have the same key+value pairs.

### Empty list semantics

Combinators and membership operators have well-defined behavior on
empty operands — chosen to match MongoDB's query algebra:

| Spec                  | Result  | Note                                  |
| --------------------- | ------- | ------------------------------------- |
| `{ $any: [] }`        | `false` | No member to satisfy                  |
| `{ $all: [] }`        | `true`  | Vacuous truth — match MongoDB         |
| `{ $not: {} }`        | `false` | Equivalent to `$not: true`            |
| `{ x: { $in: [] } }`  | `false` | No value in empty set                 |
| `{ x: { $nin: [] } }` | `true`  | Every value is not in empty set       |

One operator per object — for two operators on the same fact, use the
array form or `$all`:

```ts
// ❌ does not type-check
when: { elapsed: { $gte: 30, $lt: 120 } }

// ✓ array form
when: [
  { fact: "elapsed", op: "$gte", value: 30 },
  { fact: "elapsed", op: "$lt",  value: 120 },
]

// ✓ $all
when: { $all: [
  { elapsed: { $gte: 30 } },
  { elapsed: { $lt: 120 } },
]}
```

> **This is by design.** The TYPE is the source of truth: a multi-key
> operator object does not type-check. The runtime does AND multiple
> operator keys on a best-effort basis (so a `// @ts-expect-error`
> escape hatch is well-defined), but the supported and type-checkable
> form is one operator per object — combined via the array form or
> `$all`.

## `FactTemplate` — fact-interpolating strings

A string with `${ident}` placeholders. Escape `${` with `$${`. Unknown
keys yield an empty string and dev-warn.

```ts
derive: { greeting: { compute: { $template: "Hi ${firstName}!" } } }

events: {
  setLabel: {
    patch: { $set: { label: { $template: "User ${name} (#${id})" } } },
  },
},

constraints: {
  notifyLow: {
    when: { inventory: { $lt: 5 } },
    require: { type: "ALERT", message: { $template: "Inventory low: ${inventory}" } },
  },
},
```

Placeholder keys must match `[A-Za-z_][A-Za-z0-9_]*`.

## `KeySelector` — declarative resolver dedup

`key: ["id"]` is equivalent to `key: (req) => stableStringify(req.id)`.
The order is the declared order; values are stable-stringified (object
keys sorted recursively) so two requirements with the same fields in
different orders dedupe to the same key.

```ts
resolvers: {
  fetcher: {
    requirement: "FETCH",
    key: ["url", "method"],
    resolve: doFetch,
  },
},
```

## `PatchSpec` — declarative event handlers

`patch` replaces the `handler` arm of an event for the common case of
"set facts from the dispatched payload":

```ts
events: {
  setStatus: {
    patch: {
      $set: {
        // Literal value
        active: true,
        // Typed copy from a payload field
        userId: { $ref: "id" },
        // Interpolated string over the payload
        label: { $template: "user ${name}" },
      },
    },
  },
},
```

Use the function `handler` arm for anything more involved (conditional
writes, derived values, side calls).

## Cross-module / namespaced predicates

In a constraint that uses `crossModuleDeps`, facts arrive as
`facts.self.*` and `facts.{dep}.*`. The data form mirrors that shape:

```ts
when: {
  self: { phase: "red" },
  auth: { token: { $exists: true } },
}
```

## Inspecting what fired

The introspection payoff:

```ts
system.observe((event) => {
  if (event.type === "constraint.evaluate" && event.whenExplain) {
    console.log(event.whenExplain);
    // [
    //   { path: "phase",   op: "$eq",  expected: "red", actual: "red", pass: true  },
    //   { path: "elapsed", op: "$gte", expected: 30,    actual: 20,    pass: false },
    // ]
  }
});

console.log(system.explain(requirementId));
// Requirement "TRANSITION" (…)
// ├─ Predicate clauses:
// │  ├─ ✓ phase $eq red (actual: red)
// │  └─ ✗ elapsed $gte 30 (actual: 20)
// └─ …
```

`whenSpec` is also surfaced on every entry of `system.inspect().constraints[]`
when the constraint's `when` is a data form — so devtools and any
custom inspector can render the predicate tree natively.

## Static analysis

Two pure utilities walk a predicate without running it — useful for
devtools, codegen, lint rules, and any "which facts does this read"
check:

```ts
import { extractDeps, extractTemplateKeys } from "@directive-run/core";

extractDeps({ phase: "red", elapsed: { $gte: 30 } });
// → Set { "phase", "elapsed" }

extractDeps({ self: { phase: "red" }, auth: { token: { $exists: true } } });
// → Set { "self.phase", "auth.token" }

extractTemplateKeys({ $template: "${firstName} ${lastName}" });
// → Set { "firstName", "lastName" }
```

For a stable function reference per predicate (custom devtools, batched
analyses), wrap it once with `memoizePredicate`:

```ts
import { memoizePredicate } from "@directive-run/core";

const check = memoizePredicate({ phase: "red", elapsed: { $gte: 30 } });
check({ phase: "red", elapsed: 45 }); // → true
```

`memoizePredicate` caches the returned closure in a `WeakMap` keyed by
predicate identity — the same predicate object always gets the same
closure back. No actual compilation happens (the closure re-walks the
predicate on every call via `evaluatePredicate`); the name reflects the
identity-keyed memoization, not a bytecode/AST compile step.

### Validating a predicate loaded from JSON

A data predicate is a plain object, so it is tempting to load one from
JSON. Most operands survive `JSON.stringify` / `JSON.parse` — but
`RegExp`, `bigint`, `Set`, and `Map` operands do not (see
[RFC 0004 — Serialization](../rfcs/0004-data-configuration-triggers.md#serialization)).
`validatePredicate(spec)` throws on exactly those unrehydratable
operands — call it after `JSON.parse` to fail loud rather than silently
mis-evaluate:

```ts
import { validatePredicate } from "@directive-run/core";

const spec = JSON.parse(stored);
validatePredicate(spec); // throws if a RegExp/bigint/Set/Map operand is present
```

It is an opt-in helper — the engine does not call it automatically.
Users who never persist predicates do not need it.

## Gotchas

A few sharp edges worth knowing once:

- **`async: true` on a data `when` is ignored.** A data `when` is
  always sync — the predicate evaluator walks the predicate
  synchronously, so the runtime treats `async: true` paired with a
  data `when` as a no-op AND clears `def.async` at registration so the
  engine takes the sync evaluation path. Use a function `when` for
  async preconditions.
- **Explicit `deps` on a data `when` is ignored.** A data predicate
  carries its own deps (extracted structurally), so any `deps: [...]`
  you add is unused — auto-tracking is exact.
- **Typo'd `$`-operators dev-warn.** `{ elapsed: { $eqq: 30 } }`
  triggers a runtime dev warning naming the typo and the known
  operators; the malformed clause evaluates to `false`.
- **`$changed` is effects-only.** Constraints have no `prev` snapshot,
  so `$changed` only makes sense inside an effect `on`. Gate a
  constraint on "fact changed" with a boolean derivation that watches
  the change source.
- **One operator per object.** `{ $gte: 30, $lt: 120 }` does not
  type-check. Write the array form or `$all` for multi-operator
  predicates on the same fact.

## Future operators

These are not in v1, but are tracked for future addition:

- `$null`, `$nullish` — for now use `$eq: null` or the function
  escape hatch.
- `$elemMatch` — match an array element against a sub-predicate; for
  now use the function form or restructure the fact.
- `$size` — array-length check; for now use a derivation
  (`derive: { count: (f) => f.items.length }`) and a relational op
  on the derived count.

If you hit one of these in real code, file an issue — operator
coverage is driven by demand.

## Data vs function vs derivation — decision matrix

The data form covers the common cases of comparison, membership, and
"set from payload". Use this matrix to pick the right form:

| Need                                       | Use                                                         |
| ------------------------------------------ | ----------------------------------------------------------- |
| Single-fact equality/comparison            | data `when`                                                 |
| Cross-fact comparison (`a > b`)            | derivation + data `when` on the derived value               |
| String prefix/suffix/contains              | data `when` (`$startsWith` / `$endsWith` / `$contains`)     |
| Async precondition                         | function `when` (data is always sync)                       |
| Regex flag control                         | data `when` with a `RegExp` literal                         |
| Conditional branches / complex logic       | function `when`                                             |
| Effect runs on fact change                 | data `on` with `$changed: true`                             |
| Effect runs on derived value               | function `on` (data `on` is fact-keyed)                     |

The two forms compose cleanly — mix them freely in the same module.

## Observing rejected writes

When a bound resolver's owned-fact write is dropped because the fact was
changed by something else mid-flight, Directive emits a
`resolver.write.rejected` observation event with `reason: "clobbered"`:

```ts
system.observe((e) => {
  if (e.type === "resolver.write.rejected") {
    console.warn(
      `[${e.reason}] resolver ${e.resolver} dropped ${e.fact}: ` +
        `expected=${JSON.stringify(e.expected)} actual=${JSON.stringify(e.actual)}`,
    );
  }
});
```

The `reason` field keeps the event backend-neutral — clobber detection is the
in-memory implementation today; future write-rejecting backends can report
other reasons under the same event type. When `e.dropped` is set, the event is
the per-resolver suppression summary (emitted once after the per-instance cap).
Devtools and the logging plugin surface this event by default.

## See also

- [RFC 0004 — Data-configuration triggers](../rfcs/0004-data-configuration-triggers.md)
