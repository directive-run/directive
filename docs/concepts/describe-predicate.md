# `describePredicate` – render a `FactPredicate` as English or algebra

> A pure tree walker that turns any `FactPredicate` AST into a precise
> human-readable sentence. Closes the LLM-emit round-trip
> (intent → predicate → describe → reprompt), powers rules-diff prose,
> and turns audit-ledger entries into one-line decisions.

## The shape

```ts
import { describePredicate } from "@directive-run/core";

describePredicate({ cartTotal: { $gte: 50 } });
// → "cartTotal is at least 50"

describePredicate(
  { $any: [{ region: "US" }, { region: "EU" }] },
);
// → "(region is US) OR (region is EU)"

describePredicate({ cartTotal: { $gte: 50 } }, { style: "formal" });
// → "cartTotal ≥ 50"
```

Pure. No side effects. No throws on a valid predicate – on cyclic /
non-object input it returns a sentinel string so it's safe to call on
LLM output, third-party data, or whatever else flows into the audit
trail.

## Options

| Option | Type | Default | What |
| --- | --- | --- | --- |
| `style` | `"natural" \| "formal"` | `"natural"` | English prose vs algebra (`≥`, `∈`, `∧`, `¬`). |
| `locale` | `string` | `"en-US"` | Forwarded to `Intl.NumberFormat`. Invalid locales fall back to `en-US`. |
| `parenthesize` | `boolean` | `true` | Wrap each clause of a combinator in parens when there's > 1 child. |
| `factName` | `(path: string) => string` | identity | Map fact paths to friendly labels (`cartTotal` → `"cart total"`). Only consulted in `"natural"` style – the formal style preserves raw dotted paths so the output stays algebraic. |

## Operators rendered

| Operator | Natural | Formal |
| --- | --- | --- |
| `$eq` | `x is V` (`x is null` for null) | `x = V` |
| `$ne` | `x is not V` | `x ≠ V` |
| `$gt` | `x is more than V` | `x > V` |
| `$gte` | `x is at least V` | `x ≥ V` |
| `$lt` | `x is less than V` | `x < V` |
| `$lte` | `x is at most V` | `x ≤ V` |
| `$in` | `x is one of V1, V2, …` | `x ∈ {V1, V2, …}` |
| `$nin` | `x is not one of V1, V2, …` | `x ∉ {V1, V2, …}` |
| `$exists` | `x is set` / `x is not set` | `∃ x` / `∄ x` |
| `$between` | `x is between A and B` | `A ≤ x ≤ B` |
| `$startsWith` | `x starts with "foo"` | `x ^= "foo"` |
| `$endsWith` | `x ends with "foo"` | `x $= "foo"` |
| `$contains` | `x contains "foo"` | `x ⊇ "foo"` |
| `$matches` | `x matches /re/` | `x ~ /re/` |
| `$changed` | `x changed` | `Δx` |
| `$all` | `(A) AND (B)` | `A ∧ B` |
| `$any` | `(A) OR (B)` | `A ∨ B` |
| `$not` | `NOT (A)` | `¬(A)` |

Empty combinators degrade gracefully: `{ $all: [] }` → `"always true"` (`⊤`),
`{ $any: [] }` and `{ $not: {} }` → `"never"` (`⊥`).

## Examples

### Friendly fact names

```ts
describePredicate(
  { cartTotal: { $gte: 50 }, shippingRegion: { $in: ["US", "EU"] } },
  { factName: (p) => p.replace(/([A-Z])/g, " $1").toLowerCase() },
);
// → "(cart total is at least 50) AND (shipping region is one of US, EU)"
```

### Formal style with locale formatting

```ts
describePredicate(
  { revenue: { $gte: 1_000_000 } },
  { style: "formal", locale: "de-DE" },
);
// → "revenue ≥ 1.000.000"
```

### Cross-module pivot (nested object)

```ts
describePredicate({
  user: { age: { $gte: 18 }, region: "US" },
});
// → "(user.age is at least 18) AND (user.region is US)"
```

### Combinator nesting

```ts
describePredicate({
  $all: [
    { $any: [{ tier: "pro" }, { tier: "enterprise" }] },
    { $not: { suspended: true } },
  ],
});
// → "((tier is pro) OR (tier is enterprise)) AND (NOT (suspended is true))"
```

## Cycle handling, depth limits, edge cases

`describePredicate` defends against three classes of pathological input
so it's safe to call from a UI render path:

- **Cycles.** Walked once via a `WeakSet`. A cycle returns the sentinel
  `"<invalid predicate: cycle>"` rather than recursing forever.
- **Depth limit.** Inherits `MAX_PREDICATE_DEPTH` from the predicate
  validator. Exceeding it logs a dev warning and bails to `"always true"`
  (`⊤`) – the predicate validator would have rejected this shape upstream.
- **Non-object input.** Strings, numbers, `null`, and `undefined` at the
  root return `"<invalid predicate>"` – no throw.
- **Unknown operators.** A `{ x: { $weird: 1 } }` predicate logs a dev
  warning and falls through to a generic `"x $weird 1"` rendering. The
  validator would reject this at registration; the renderer simply
  doesn't crash on it.

## Why `describePredicate` (not `describe`)

The export is `describePredicate` to avoid colliding with vitest's global
`describe()` – `describe` is the canonical block name for every test
file in the monorepo, and `import { describe } from "@directive-run/core"`
would shadow it. `describePredicate` is the one-token-longer trade we
make so test files don't need a rename alias.

## Integration patterns

### Audit ledger → human prose

Pair with [`createAuditLedger`](./audit-ledger.md) to turn JSON entries
into one-line decisions for a compliance dashboard:

```ts
const entries = ledger.forConstraint("canCheckout");
for (const e of entries) {
  if (e.kind === "constraint.evaluate" && e.whenSpec) {
    console.log(
      `${e.active ? "✓" : "✗"} ${describePredicate(e.whenSpec)}`,
    );
  }
}
// ✓ (cartTotal is at least 50) AND (region is one of US, EU)
// ✗ (cartTotal is at least 50) AND (region is one of US, EU)
```

### Rules-diff prose

[`diffRules`](./rules-diff.md) emits structural diffs as data;
`describePredicate` turns the before/after halves into prose for PR
comments:

```ts
const diff = diffRules(before, after);
for (const change of diff.changes) {
  console.log(`${change.constraintId}:`);
  console.log(`  before: ${describePredicate(change.before)}`);
  console.log(`  after:  ${describePredicate(change.after)}`);
}
```

### LLM round-trip

Close the [`predicateFromIntent`](./predicate-from-intent.md) loop by
showing the human the predicate the model emitted *in plain English*:

```ts
const predicate = await predicateFromIntent({ intent, schema, runner });
const description = describePredicate(predicate, {
  factName: humanizeFactPath,
});
// "Is this the rule you meant? – cart total is at least 50 AND region
// is one of US, EU"
```

If the user says no, feed the description back in the next prompt
turn – the model gets the same plain-English target it was asked to
emit.

### `whenExplain` tooltips

In a devtools panel, render the predicate AS PROSE next to the per-clause
pass/fail breakdown – keeps the tooltip readable when the JSON is deep:

```tsx
<Tooltip content={describePredicate(constraint.whenSpec, { factName })}>
  <ConstraintBadge active={constraint.active} />
</Tooltip>
```

## Reference

- API: `describePredicate`, `DescribeOptions`
- Pairs with: [`createAuditLedger`](./audit-ledger.md), [`diffRules`](./rules-diff.md), [`predicateFromIntent`](./predicate-from-intent.md), [`predict`](./predict.md)
- Related: [`predicateToSQL` / `predicateToMongo`](./predicate-codegen.md) (same AST, different target)
