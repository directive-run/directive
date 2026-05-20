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
  explicit-`deps` footgun because a data `when` is always sync.

## Quick reference

```ts
import { createModule, t } from "@directive-run/core";

createModule("traffic", {
  schema: {
    facts: { phase: t.string<"red" | "green">(), elapsed: t.number() },
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

## `FactPredicate` — boolean specs

A predicate is an object whose keys are fact (or derivation) names and
whose values are either a literal (equality) or an operator object.

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
| `$matches`      | `string`              | `{ name: { $matches: /^J/ } }`              |
| `$contains`     | `string` or array     | `{ tags: { $contains: "admin" } }`          |
| `$exists`       | any                   | `{ token: { $exists: true } }`              |
| `$changed`      | effects only          | `{ phase: { $changed: true } }`             |

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
The order is the declared order; values are JSON-encoded so distinct
typed values never collide.

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

## When to use the function form

The data form covers the common cases of comparison, membership, and
"set from payload". The function form is the right pick when you need:

- Cross-fact comparisons (`facts.a > facts.b`).
- Computed values (`url.startsWith(scheme)`).
- Any string method, regex group, or side computation beyond
  `$matches`.
- An async `when` (data `when` is always sync by design).
- A derivation that composes other derivations (`(facts, derived) => …`).

The two forms compose cleanly — mix them freely in the same module.

## See also

- [RFC 0004 — Data-configuration triggers](../rfcs/0004-data-configuration-triggers.md)
