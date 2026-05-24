# `doctor` — "does this rule contradict an existing rule?"

> Structural contradiction detection between a candidate `FactPredicate`
> and a system's existing constraint set. The "doctor says no" gate
> *before* an LLM-emitted rule reaches production.

## What it catches

```ts
import { doctor } from "@directive-run/core";

const candidate = { cartTotal: { $gte: 100 } };

doctor.checkAgainst(candidate, system.inspect().constraints);
// → {
//     contradictions: [
//       { constraintId: "blockCheckout",
//         type: "direct",
//         reason: "Candidate requires cartTotal ≥ 100 but an existing rule caps it at < 50.",
//         candidatePath: "cartTotal",
//         candidate: { op: "$gte", value: 100 },
//         existing: { op: "$lt", value: 50 } }
//     ],
//     warnings: []
//   }
```

Three contradiction types:

| Type | When |
| --- | --- |
| `direct` | The two rules cannot both fire. `$gte 100` vs `$lt 50`, `$eq "a"` vs `$ne "a"`, two disjoint `$in` sets. |
| `subset` | The candidate's range is strictly within the existing rule's range. Candidate is redundant; the existing rule already covers it. |
| `overlap` | The two rules touch the same fact with non-trivial intersection. Surfaced as a **warning**, not a hard error — they *can* coexist. |

## Use cases

- **LLM-emit gate:** Before assigning an LLM-proposed predicate to a constraint, doctor-check it. Feed contradictions back to the model.
- **Reviewer assist:** On a rule-change PR, list contradictions for the reviewer to read instead of inferring them mentally.
- **Migration check:** Before rolling out a new rule, prove it doesn't conflict with anything live.

## What this does NOT do (yet)

This is a structural v1. It does **NOT** check:

- **Semantic contradictions that need an SMT solver** — e.g. *"`a + b > 10` vs `a < 3 AND b < 3`"*. (Out of scope; ships separately as full `doctor` with Z3.wasm.)
- **Indirect contradictions through derivations** — a rule on a derived value vs a rule on its inputs.
- **Operator-set asymmetry** — *"`$matches /^x/` vs `$startsWith 'y'`"*. The structural checker doesn't know that `/^x/` and `'y'` are disjoint patterns; it falls back to `overlap` warning.

**False negatives are acceptable.** A missed contradiction means "doctor says it's fine when it's actually not" — caller still has runtime safety from the engine itself. **False positives are NOT acceptable** — every reported contradiction is defensible from the structure alone.

## Reference

- API: `doctor`, `CheckAgainstResult`, `Contradiction`, `ContradictionType`
- Underlying: [`diffRules`](./rules-diff.md) (used to flatten predicates for comparison)
- Pairs with: [`predicateFromIntent`](./predicate-from-intent.md), [`predict`](./predict.md)
