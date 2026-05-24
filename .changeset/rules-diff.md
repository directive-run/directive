---
"@directive-run/core": minor
"@directive-run/cli": minor
---

feat: structural rules diff (`diffRules` + `directive rules-diff`)

Structural diff between two snapshots of a system's constraint
whenSpec map – the "git diff for business rules" that operates on the
predicate AST instead of source-text lines. Pairs with `replayUnder`
for before-you-merge causal-impact review.

```ts
import { diffRules } from "@directive-run/core";

const report = diffRules({
  before: { blockCheckout: { cartTotal: { $gte: 100 } } },
  after:  { blockCheckout: { cartTotal: { $gte: 50  } } },
});

report.constraints[0].changes[0];
// { path: "cartTotal", kind: "relaxed",
//   before: { op: "$gte", value: 100 },
//   after:  { op: "$gte", value: 50 } }
```

Walks both predicate trees in parallel, reports added/removed clauses
with dotted paths, and classifies numeric-threshold changes as
**relaxed** (matches more) or **tightened** (matches fewer) for
`$gte`/`$gt`/`$lte`/`$lt`/`$between`/`$in`/`$nin`. Combinator-aware –
`$all` / `$any` / `$not` children get indexed paths. Output is
deterministically sorted for git-tracked snapshots.

CLI: three output modes.

```
directive rules-diff --before snapshot-old.json --after snapshot-new.json
directive rules-diff --before ... --after ... --markdown   # GitHub PR comment
directive rules-diff --before ... --after ... --json
```

Either flat `{ id: whenSpec }` map or the `system.inspect().constraints`
array form is accepted – the `toRulesMap` adapter normalizes both.

What's not in v1 (deferred): reachability counting, combinator
flattening, direct git-ref input (use `git show ref:path > file.json`
in the meantime). See `docs/concepts/rules-diff.md`.
