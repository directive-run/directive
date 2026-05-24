# Structural rules diff – `diffRules` / `directive rules-diff`

`diffRules` answers a question `git diff` literally cannot: **"what changed
in our business rules?"** Not "lines changed" – clauses added, clauses
removed, thresholds relaxed (matches more), thresholds tightened (matches
fewer).

It works because Directive's runtime form of a rule is a structured
predicate tree, not a function. The same property that lets `replayUnder`
re-evaluate a rule against history lets `diffRules` walk two versions of a
rule and report what moved.

## The shape of the problem

Every regulated team hand-rolls a "what changed in our business rules"
spreadsheet and lies about keeping it current. Auditors ask *"show me the
diff between Q2 and Q3 checkout rules"* and engineers screenshot `if/else`
statements. This is the first tool that answers the question with the
authority of the runtime: rules are AST nodes, the diff is on the AST.

## `diffRules()`

```ts
import { diffRules } from "@directive-run/core";

const report = diffRules({
  before: {
    blockCheckout: { cartTotal: { $gte: 100 } },
    oldRule: { phase: "deprecated" },
  },
  after: {
    blockCheckout: { cartTotal: { $gte: 50 } },
    newRule: { country: { $in: ["US", "CA", "UK"] } },
  },
});

report.summary;
// {
//   added: 1, removed: 1, changed: 1, unchanged: 0,
//   totalClauseChanges: 3,
// }

report.constraints[0];
// {
//   id: "blockCheckout", status: "changed",
//   changes: [{ path: "cartTotal", kind: "relaxed",
//               before: { op: "$gte", value: 100 },
//               after:  { op: "$gte", value: 50  } }],
// }
```

## API

```ts
function diffRules(options: DiffRulesOptions): RulesDiffReport;

interface DiffRulesOptions {
  before: RulesMapInput;   // one of the three shapes below
  after:  RulesMapInput;
}

// Accepted input shapes:
type RulesMapInput =
  | Record<string, FactPredicate>                      // flat map
  | Array<{ id: string; whenSpec?: FactPredicate }>     // inspect() array form
  | { constraints: ... };                               // wrapped

interface RulesDiffReport {
  constraints: ConstraintDiff[];
  summary: {
    added: number;
    removed: number;
    changed: number;
    unchanged: number;
    totalClauseChanges: number;
  };
}

interface ConstraintDiff {
  id: string;
  status: "added" | "removed" | "changed" | "unchanged";
  changes: Change[];
}

interface Change {
  path: string;                                         // dotted leaf path
  kind: "added" | "removed" | "changed" | "relaxed" | "tightened";
  before?: { op: string; value: unknown };
  after?:  { op: string; value: unknown };
}
```

The output is **sorted deterministically** – constraints alphabetically by
id, changes alphabetically by path. Two runs on the same input produce
byte-identical reports (useful for git-tracked snapshots).

## Direction analysis

For numeric-threshold operators the diff classifies *direction*:

| Operator | "relaxed" means | "tightened" means |
| --- | --- | --- |
| `$gte`, `$gt` | threshold **lower** (matches more values) | threshold **higher** |
| `$lte`, `$lt` | threshold **higher** | threshold **lower** |
| `$between [a, b]` | range **wider** | range **narrower** |
| `$in` | candidate set **larger** | candidate set **smaller** |
| `$nin` | candidate set **smaller** | candidate set **larger** |
| `$contains` (array) | candidate set **larger** | candidate set **smaller** |

For everything else – string equality flips, `$matches` RegExp swaps,
`$contains` on strings (substring direction is ambiguous), `$startsWith` /
`$endsWith`, combinator shape changes – the change is reported as
`"changed"` without direction. The CLI renders relaxed with `▲` (green)
and tightened with `▽` (red).

## Combinators

`diffRules` walks into `$all` / `$any` / `$not` and reports per-branch
changes with the combinator path included:

```ts
diffRules({
  before: { c: { $all: [{ phase: "red" }, { elapsed: { $gte: 30 } }] } },
  after:  { c: { $all: [{ phase: "red" }, { elapsed: { $gte: 60 } }] } },
});
// → changes[0]: { path: "$all[1].elapsed", kind: "tightened",
//                 before: { op: "$gte", value: 30 }, after: { op: "$gte", value: 60 } }
```

## CLI

```
directive rules-diff --before <a.json> --after <b.json> [options]
```

| Option | Meaning |
| --- | --- |
| `--before <path>` | Baseline whenSpec snapshot JSON (required) |
| `--after <path>` | New whenSpec snapshot JSON (required) |
| `--json` | Emit the full `RulesDiffReport` as JSON |
| `--markdown`, `--md` | Emit GitHub PR comment friendly Markdown |

Each snapshot is accepted in any of three shapes – flat `{ id: whenSpec }`
map, the `system.inspect().constraints` array form, or either wrapped
under `{ constraints: ... }`.

Example output:

```
rules-diff – structural predicate diff

  +1 added   -1 removed   ~2 changed   ·0 unchanged
  4 clause-level changes

  blockCheckout  CHANGED
    ▲ cartTotal  $gte 100 → $gte 50  [relaxed]

  newRule  ADDED
    + country  $in ["US","CA","UK"]

  oldRule  REMOVED
    - phase  "deprecated"

  rateLimit  CHANGED
    ▲ $all[1].rps  $lte 100 → $lte 500  [relaxed]
```

## Producing snapshots

Two patterns work today:

```bash
# 1. Capture from a live system (any branch / version):
node -e "import('./system.js').then(m => \
  console.log(JSON.stringify(m.system.inspect().constraints)))" > snapshot.json

# 2. Pull from a git ref:
git show HEAD~1:path/to/snapshot.json > before.json
git show HEAD:path/to/snapshot.json   > after.json
directive rules-diff --before before.json --after after.json
```

A planned `--git-ref-a / --git-ref-b` shortcut will fold both into one
command (loads each ref's module under a sandboxed `createSystem`,
extracts whenSpecs, diffs).

## What's not in v1

- **Reachability counting.** No "this rule is reachable in 8× more fact
  configurations." SAT-counting over predicate trees is a deep problem and
  the integer it returns is hard to communicate – deferred.
- **Combinator flattening.** `{ $all: [a, { $all: [b, c] }] }` is treated
  as different from `{ $all: [a, b, c] }`. Normalize before snapshotting
  if that matters for you.
- **Order sensitivity inside combinators.** Reordering children of
  `$all` / `$any` (e.g. `$any: [a, b]` → `$any: [b, a]`) is reported as
  two paired changes at indices `[0]` and `[1]` – semantically a no-op,
  but the path-keyed diff sees them as different. Sort children before
  snapshotting if you care.
- **Direct git-ref input.** v1 takes JSON files. Pair with `git show` for
  ref-based diffs; the planned `--git-ref` flag is tracked.

## Compound with `replayUnder`

Pair the diff with a backtest for **before-you-merge causal impact**:

```bash
# 1. What rules changed?
directive rules-diff --before before.json --after after.json

# 2. Extract the single constraint's whenSpec from each snapshot with jq:
jq '.blockCheckout' before.json > before-blockCheckout.json
jq '.blockCheckout' after.json  > after-blockCheckout.json

# 3. For that rule, how many recorded frames does the change touch?
directive replay-under --history sessions.json \
  --original before-blockCheckout.json --proposed after-blockCheckout.json
```

The two tools are designed to feed each other: `rules-diff` tells you
*what changed*, `replay-under` tells you *what would have happened*.
Together they make a structural code review tool that understands what a
business rule is.
