# DevTools — whenExplain clause panel

> The devtools panel renders the per-clause ✓/✗ breakdown for every
> data-form `when` constraint, live, color-coded, updating in place.
> Look at one panel section and immediately know which clause is the
> blocker — and what value would unblock it.

## The problem

A constraint's `when:` clause is a black box in most state libraries.
Your XState guard is a function — when the transition doesn't fire, you
get to print-debug your way to "ah, `elapsed` was 20, not ≥30." Redux
selectors are worse: a chain of memoized boolean ANDs, none of which
explain *which* AND failed.

Directive's data-form `when` is a *structural predicate*: not opaque
code, but a JSON tree of operators and values. The runtime already walks
that tree to compute the boolean — the only thing missing was a way to
see the walk.

## The panel

Enable the devtools plugin with `panel: true` and a new **Constraints**
section appears:

```ts
import { devtoolsPlugin } from "@directive-run/core/plugins";

const trafficLight = createModule("traffic", {
  schema: { phase: t.string<"red" | "green">(), elapsed: t.number() },
  constraints: {
    transition: {
      when: { phase: { $eq: "red" }, elapsed: { $gte: 30 } },
      require: { type: "TRANSITION" },
    },
  },
});

createSystem({
  module: trafficLight,
  plugins: [devtoolsPlugin({ panel: true, defaultOpen: true })],
});
```

The Constraints section shows:

```
▼ Constraints (1)
  ✗ transition
    ✗ phase = "red"
    ✗ elapsed ≥ 30  (actual: 20)
```

- **Header mark** (`✓`/`✗`): is the constraint currently active?
- **Per-clause mark**: is each clause passing?
- **Failed clause adds `(actual: X)`**: see the real value beside the
  expected one — no need to cross-reference Facts.

The tree updates in place on every re-evaluation. Mutate the watched
fact and the colors flip live.

## Operator symbols

The panel uses concise mathematical symbols so a many-clause predicate
stays readable:

| Predicate                   | Rendered                         |
| --------------------------- | -------------------------------- |
| `{ x: { $eq: 5 } }`         | `x = 5`                          |
| `{ x: { $ne: 5 } }`         | `x ≠ 5`                          |
| `{ x: { $gt: 5 } }`         | `x > 5`                          |
| `{ x: { $gte: 5 } }`        | `x ≥ 5`                          |
| `{ x: { $lt: 5 } }`         | `x < 5`                          |
| `{ x: { $lte: 5 } }`        | `x ≤ 5`                          |
| `{ x: { $in: [a, b] } }`    | `x ∈ [a, b]`                     |
| `{ x: { $nin: [a, b] } }`   | `x ∉ [a, b]`                     |
| `{ x: { $exists: true } }`  | `x exists true`                  |
| `{ x: { $between: [a, b]}}` | `x in [a, b]`                    |
| `{ x: { $startsWith: "p"}}` | `x starts with p`                |
| `{ x: { $matches: /re/ } }` | `x matches /re/`                 |

Combinators (`$all`, `$any`, `$not`) render their own header and indent
their children:

```
▼ Constraints (1)
  ✗ accessGuard
    ✓ $any
      ✓ role = "admin"
      ✗ tier ≥ 3  (actual: 1)
    ✗ tenant_id = "abc"  (actual: "xyz")
```

## Function-form `when`

A `when:` that's a function — not a predicate — still appears in the
panel, but without a clause tree:

```
▼ Constraints (1)
  ✓ legacyGuard
    function-form when (no clause tree)
```

The clause tree is a *property of the data form*. Migrate to a data
`when` to get the breakdown.

## Hot-path cost

The panel's clause walk only runs when at least one plugin is attached
(`hasPlugins()` gate in the engine). Production builds with no plugins
pay zero cost — the `whenExplain` payload is never computed.

When the devtools plugin *is* attached, the cost is one
`evaluatePredicateExplained` call per constraint evaluation, which is
~the same cost as the regular `evaluatePredicate` call the constraint
already does (one tree walk, no proxy traps).

## Programmatic access

The same data the panel renders is available on the
`constraint.evaluate` observation event:

```ts
system.subscribe("constraint.evaluate", ({ id, active, whenExplain }) => {
  if (whenExplain) {
    for (const clause of whenExplain) {
      if (!clause.pass) {
        console.log(`${id}: ${clause.path} ${clause.op} ${clause.expected} (actual: ${clause.actual})`);
      }
    }
  }
});
```

`whenExplain` is `undefined` for function-form `when:` and present for
every data-form `when:`. Same data feeds the panel, `engine.explain()`
text output, and any custom listener you register.

## Time-travel

Snapshot jumps clear the clause tree (it'd be stale until the next
reconcile re-evaluates). Fresh clause trees populate as constraints
re-fire against the loaded snapshot.

## Reference

- API: `evaluatePredicateExplained(spec, facts, prev?, pathPrefix?)`, `system.inspect().constraints[].whenSpec`, observation event `constraint.evaluate.whenExplain`
- Plugin: `devtoolsPlugin({ panel: true })`
- Source: `packages/core/src/plugins/devtools-panel.ts` (`renderConstraintRow`)
- Related: [Data-form definitions](./data-triggers.md), [Rules diff](./rules-diff.md), [Predicate codegen](./predicate-codegen.md)
