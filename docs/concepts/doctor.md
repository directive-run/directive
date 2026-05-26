# `doctor` – "does this rule contradict an existing rule?"

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
//     warnings: [
//       { constraintId: "applyDiscount",
//         type: "subset",
//         reason: "Candidate's lower bound on cartTotal (100) is stricter than the existing rule's (50) – candidate is a subset." }
//     ]
//   }
```

Three finding types, two buckets:

| Type | Bucket | When |
| --- | --- | --- |
| `direct` | `contradictions` | The two rules cannot both fire. `$gte 100` vs `$lt 50`, `$eq "a"` vs `$ne "a"`, two disjoint `$in` sets. |
| `subset` | `warnings` | The candidate's range is strictly within the existing rule's range. The candidate is **redundant**, not in conflict – surfaced as a warning. |
| `overlap` | `warnings` | The two rules touch the same fact with non-trivial intersection. Surfaced as a warning – they *can* coexist. |

> **M17 – subset is a warning, not a contradiction.** A subset rule co-fires with its parent; it's noise (the existing rule already covers it), not a conflict. Prior versions bucketed `subset` under `contradictions` – if you're upgrading, move your assertions accordingly.

## `doctor.checkOwns` – owns:/bind: collision check

`checkAgainst` only inspects predicate **logic**. To flag a candidate that would *write* to a field already owned by another constraint's resolver, use `doctor.checkOwns`:

```ts
doctor.checkOwns(candidate, system.inspect());
// → {
//     warnings: [
//       { constraintId: "applyDiscount",
//         candidatePath: "cartTotal",
//         source: "owns",
//         severity: "warning",
//         reason: "Constraint applyDiscount already owns cartTotal – candidate would race or shadow its writes." }
//     ]
//   }
```

> **F-3 – `checkOwns` returns `{ warnings }` only.** Earlier R-cycles shipped `{ contradictions, warnings }` (where `contradictions` was always `[]` in v1). The empty slot encouraged callers to write dead branches, so it's gone – owns-collisions are *warnings* by default and each finding carries a `severity: "warning"` discriminator. Callers running stricter pre-deploy lints can promote findings to `severity: "error"` themselves and route on the discriminator. v2 may surface a structured `errors` field; the discriminator is the migration shim.

> **M5 – engine still enforces the runtime binding gate.** A doctor pass is advisory rather than fatal – the system already refuses double-owners at runtime. Use `checkOwns` to fail fast in pre-deploy lints / CI.

> **F1 – `system.inspect().constraints[].owns` is now populated automatically** from the constraint definition's `owns:` field. `checkOwns(candidate, system.inspect())` works against any system without manual annotation. `bind:` is reserved as a v2 promise – the type slot is in place but the runtime does not yet emit a `bind` field on inspect snapshots.

> **v1 LIMITATION (M4):** `checkOwns` returns `{ warnings: [] }` when constraints expose neither `owns:` nor `bind:` metadata. No false positives.

## Use cases

- **LLM-emit gate:** Before assigning an LLM-proposed predicate to a constraint, doctor-check it. Feed contradictions back to the model.
- **Reviewer assist:** On a rule-change PR, list contradictions for the reviewer to read instead of inferring them mentally.
- **Migration check:** Before rolling out a new rule, prove it doesn't conflict with anything live.

## What this does NOT do (yet)

This is a structural v1. It does **NOT** check:

- **Semantic contradictions that need an SMT solver** – e.g. *"`a + b > 10` vs `a < 3 AND b < 3`"*. (Out of scope; ships separately as full `doctor` with Z3.wasm.)
- **Indirect contradictions through derivations** – a rule on a derived value vs a rule on its inputs.
- **Operator-set asymmetry** – *"`$matches /^x/` vs `$startsWith 'y'`"*. The structural checker doesn't know that `/^x/` and `'y'` are disjoint patterns; it falls back to `overlap` warning.

**False negatives are acceptable.** A missed contradiction means "doctor says it's fine when it's actually not" – caller still has runtime safety from the engine itself. **False positives are NOT acceptable** – every reported contradiction is defensible from the structure alone.

## Reference

- API: `doctor.checkAgainst`, `doctor.checkOwns`, `CheckAgainstResult`, `CheckOwnsResult`, `CheckOwnsFinding`, `Contradiction`, `ContradictionType`
- Underlying: [`diffRules`](./rules-diff.md) (used to flatten predicates for comparison)
- Pairs with: [`predicateFromIntent`](./predicate-from-intent.md), [`predict`](./predict.md)
