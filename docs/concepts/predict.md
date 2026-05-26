# `predict` – "what would this rule do, and what facts must change?"

> Run a `FactPredicate` against the current facts without firing it.
> Returns whether it would fire, the full clause-by-clause breakdown,
> and – if it wouldn't – a list of the smallest changes that would make
> it fire.

## The Sherlock moment

LLM emits a rule. `predict()` says:

> *"This rule needs `cartTotal ≥ 50` to fire; current value is 30. Set `cartTotal` to at least 50 to make it fire."*

…and the LLM rewrites accordingly. Closes the iteration loop with one tree walk.

```ts
import { predict } from "@directive-run/core";

const predicate = {
  cartTotal: { $gte: 50 },
  region: { $in: ["US", "EU"] },
};

const facts = { cartTotal: 30, region: "ASIA" };

predict(predicate, facts);
// → {
//     wouldFire: false,
//     whenExplain: [
//       { path: "cartTotal", op: "$gte", expected: 50, actual: 30, pass: false },
//       { path: "region",    op: "$in",  expected: ["US","EU"], actual: "ASIA", pass: false },
//     ],
//     missingChanges: [
//       { path: "cartTotal", op: "$gte", expected: 50, actual: 30,
//         suggestion: "set cartTotal to at least 50 (currently 30)" },
//       { path: "region", op: "$in", expected: ["US","EU"], actual: "ASIA",
//         suggestion: "set region to one of ['US','EU'] (currently 'ASIA')" },
//     ],
//   }
```

## Suggestions per operator

| Operator | Suggestion shape |
| --- | --- |
| `$eq` | `set X to V (currently A)` |
| `$ne` | `change X to anything other than V (currently A)` |
| `$gt` / `$gte` | `set X above/to at least V (currently A)` |
| `$lt` / `$lte` | `set X below/to at most V (currently A)` |
| `$in` / `$nin` | `set X to one of [...] / something other than [...]` |
| `$exists: true` | `set X to a non-null value` |
| `$exists: false` | `unset X` |
| `$between` | `set X between A and B (currently C)` |
| `$startsWith` / `$endsWith` / `$contains` | `set X to start/end/contain V` |
| `$matches` | `set X to match the pattern /re/ (currently A)` |
| `$changed` | `the previous-vs-current change of X is required to differ` |

For combinators (`$all`, `$any`, `$not`), `predict()` recurses into children and surfaces failed leaves with the leaf-level suggestions.

## Use cases

- **LLM iteration loop** – emit → predict → reprompt. The model converges to a firing rule in 1-2 turns.
- **"Preview this rule" UI** – show a user what their proposed rule would do against today's data, including the exact facts that would need to change.
- **Test-suite assertion** – `expect(predict(rule, facts).wouldFire).toBe(true)`.

## What this does NOT do

- **Not a SAT solver** – `predict()` reports failing leaves, not the *minimal* set of fact changes that satisfy the rule. For `$any: [A, B]` with both failed, it lists both – you pick which to change.
- **Doesn't mutate facts** – pure read.

## `$changed` and the `prev` snapshot (M10)

The `$changed` operator compares the current value against the previous one. Without a `prev` snapshot, the clause cannot be evaluated meaningfully.

**`predict()` makes this loud**: when the predicate contains a `$changed` clause AND you didn't pass `prev`, the result's `missingChanges` array includes a synthetic warning per `$changed` clause:

```ts
predict({ phase: { $changed: true } }, { phase: "green" });
// → {
//     wouldFire: false,
//     missingChanges: [
//       { path: "phase", op: "$changed", expected: true, actual: undefined,
//         suggestion: "$changed clause at \"phase\" cannot be evaluated without a `prev` snapshot – pass predict(predicate, facts, prev)." }
//     ],
//   }
```

Always pass `prev` (a snapshot of the prior facts) when your predicate uses `$changed`:

```ts
predict({ phase: { $changed: true } }, { phase: "green" }, { phase: "red" });
// → wouldFire: true
```

## Result shape

`PredictResult` carries `wouldFire`, `whenExplain`, and `missingChanges`. It does **not** include the input `predicate` (the caller already has it – keep the reference at the call site if you need to display "what we predicted" alongside the result).

Pure read; does not mutate facts.

## Reference

- API: `predict`, `PredictResult`, `PredictMissingChange`
- Pairs with: [`predicateFromIntent`](./predicate-from-intent.md), [`doctor`](./doctor.md), [`whenExplain` panel](./when-explain-panel.md)
