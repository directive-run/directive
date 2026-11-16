# RFC: L11 predicates and rule tools

Status: draft for review, revision 2 (after the design review). No engine or oracle code merges from this document.
Tree: branch `p11/l11-rfc`, cut from `main` at `1ffe8cad` (L0 to L7 gated; L8 built, its gate waiting on one owner signature; L9a and L9b merged, the L9 gate after L8's; L10's RFC is PR #396, revision 2; `layers.rules.json` `current` is `"L7"`). Nothing in `packages/conformance` or `packages/core-next/src` is changed by this PR.

## Changes since revision 1

Revision 1 went through a design review. It found a seam built too early, a floor cap below the review's own sketch, a single-walk row (bt) that cannot keep both of 1.35's behaviours, a row (bp) that promised more than its design, and an oracle with one placement wrong. This revision fixes each. In order:

1. **The seam is lazy, and the floor cap rises to +150 B.** `defsOf(module.derive, "compute")` runs at `core.ts:502`; the parts run at `core.ts:1935`. The slot is empty at registration, so it is read at the first compute. The review's sketch measured +78 B on `floor` and +61 B on `minimal` (`size-sketch.log`, in the review's evidence files); L9's seam landed 35% over its sketch, so about 105 B, and the cap is +150 B ("The seam").
2. **(bt) is rewritten and declined.** 1.35 evaluates a data form twice, one tracked and short-circuiting, one untracked and complete. One walk cannot keep both. 1.35's two evaluations stay; E11 and I4 say so, harness rule 1 goes, and the size target returns to 4.2 KB.
3. **(bp) is scoped to registration**, which is all the design fixes. A direct `evaluatePredicate` keeps 1.35's alternation. The wider option and its cost are in the row.
4. **The beta line.** L11a's "done means" adds `withPredicates` to `size.mjs`'s beta list: `BETA_OMITTED`, or `BETA_CALLED` (added by PR #399 for the trace) if it is wired as a call. The review found L9's `withTrace` missing from the list; PR #399 fixes that.
5. **Register, assign and unregister of data forms are defined against 1.35** (R1 to R5), with L10's interaction. Reading them found one more 1.35 quirk, an unregistered constraint's `whenSpec` that stays behind (U18).
6. **The fuzz draws `patch` and list `key`, and a `$changed`-plus-restore case.** L10-pre edits the same model and goes first.
7. **The oracle.** The 224 white-box cases are the only operator oracle and are ported, split as `meta.test.ts` was at L9 (U14). `data-forms-namespaced` is a false placement and is re-placed in L11-pre (U15).
8. **`full-entry` is split per tool**, so the owner sees what each tool costs an app that imports it (Size).
9. **The size story, in A1**: a projection table, the alpha crossover stated plainly, and the check of the plan's +6.5 KB for L12 against how 1.35 ships plugins.
10. **O3 is added as an owner question, not taken.**
11. **Decisions** carry the owner-instruction line, and each row says the option taken.
12. This list.

## What we are building

L11 lets a program write a rule as data instead of as a function, and gives it tools that read those rules.

Terms, used throughout:

- **A predicate** is a yes-or-no question about facts, written as a plain object: `{ phase: "red", elapsed: { $gte: 30 } }` means "phase is red and elapsed is at least 30". 1.35 calls its type `FactPredicate`.
- **A clause** is one test inside a predicate: `elapsed $gte 30`. **An operator** is the test's name (`$eq`, `$gte`, `$in`, `$matches` and eleven more). **A combinator** joins predicates: `$all` (and), `$any` (or), `$not`.
- **A data form** is a definition that takes a predicate, or a template, where it would otherwise take a function. 1.35 has six: a constraint's `when`, an effect's `on`, a derivation's `compute` (a predicate, or a `$template` string such as `"Hi ${name}"`), an event's `patch`, and a resolver's `key` given as a list of field names. The sixth is the namespacing of all of these in a multi-module system.
- **The engine side** is what `createSystem` needs to run a data form: the evaluator, and the places in the engine that call it. Every app that builds a system carries it in 1.35.
- **A tool** is a function a program imports to work on predicates outside the engine: describe a predicate in English, hash it, compile it to SQL, Mongo or PostgREST, check it against existing rules (`doctor`), diff two rule sets, say what would make it fire (`predict`), and test it against recorded history (`replayUnder`, `sweepUnder`).
- **A root export** is a name imported from `@directive-run/core` itself. **A subpath** is a separate entry such as `@directive-run/core/internals`. Both packages say `"sideEffects": false`, so a bundler drops every root export an app does not import (**tree-shaking**).

The plan's row reads "Predicates DSL + SQL/Mongo/PostgREST compilers, describe/hash/rules-diff/doctor/predict/replay/sweep | predicate*, predict, doctor, rules-diff, replay-under, sweep-under | +3.5 KB | opt-in". Jason's Phase 4 answer, "Keep the order (Recommended)" (2026-11-05), settles the shape, as at L8 to L10: the alphas keep 1.35's API, so the data forms work with no import, and the tools are the same root exports 1.35 has; at the beta they can become imports. His "Full checks everywhere" gives L11 this document, the oracle first, the mutation gate, the random tests and two reviewers. When this document and 1.35 disagree, 1.35 wins; a difference is built only if the owner approves it as a lettered row.

**Almost none of the row is built.** core-next has the types, the refusal of `$changed` in a constraint, and the slots L9 left.

| Plan item | State in core-next | Where |
|---|---|---|
| The predicate types (`FactPredicate`, the tool option and result types) | Copied; no runtime | `src/types/predicate.ts`, `predicate-*.ts`, `doctor.ts`, `rules-diff.ts`, `predict.ts`, `replay-under.ts`, `sweep-under.ts` |
| `$changed` refused in a constraint `when` | Built, as 1.35 | `src/api/constraints.ts:117–128, 680–735` |
| An effect `on` that is no predicate throws | Built; the gate itself is not | `src/api/effects.ts:91–103, 199–206` |
| A data-form derivation `compute` that is no object throws | Built; the form itself is not | `src/api/core.ts:404–418` |
| The operator list, `listAllPredicateOperators`, `getOperatorsForKind` | Built at L6 | `src/api/schema-introspection.ts:23–57, 359–421` |
| `inspect().constraints[].whenSpec` | Built at L9 (S6) | `src/api/reconcile.ts:691–692` |
| The observer's `whenExplain` | The pass-through is built (`src/api/observe.ts:77–83`); the record has no `explain` field yet (the only `explain` in `reconcile.ts` is `system.explain`, 743–744) | |
| The clause tree in `explain()` | **Not built** | none |
| A data-form `when` evaluated | **Not built.** `when()` calls `def.when(facts, derived)` as a function (`constraints.ts:262, 281–293`); an object throws, and a throw reads as false | |
| A data-form `on` gate, `compute`, `patch`, list `key`, namespaced prefixing | **Not built** | none |
| The 31 root tools and helpers, and `hashObject` and `dangerousRegex` in `/internals` | **Not built**; absent from the exports, with no `missing.ts` stub | none |

**Reading the table:** L11 is two pieces of work. The engine side makes the six data forms run, and fills the L9 slots. The tools are 31 pure functions with no engine state, plus two helpers.

**In plain terms:** today a constraint written as `{ phase: "red" }` never fires on 2.0, and every predicate tool is missing. L11a builds the evaluator into the engine; L11b ports the tools. The probes found four 1.35 behaviours a user could notice and might want changed: a global regex in `$matches` makes its rule never fire; a combinator beside a fact key ignores the fact key at run time while the SQL, Mongo and PostgREST compilers refuse the same predicate; a data form that names a derivation silently never matches; and a misspelled operator warns on every evaluation and never matches. They are the candidate rows (bp) to (bs). A fifth, (bt), one walk instead of two, cannot keep both of 1.35's behaviours and is declined (E11). The size is an owner decision (A1).

## Gap analysis, measured

**In plain terms:** at a forced L11 on v2, 201 of the 215 tests placed at L11 fail. 187 fail because a tool is not exported, 14 because the engine does not run data forms (5 of those also need L10). The other failures belong to L8, L9 and L10.

What I ran: `layers.rules.json` `current` set to `"L11"` in the working copy only. Then, from `packages/conformance`, `npx vitest run --project conformance:v2 --project conformance:v2:prod`, then `--project conformance:v2:dist`, then `--project conformance:diff`, each with the JSON reporter (each exited 1, as expected). Then `git checkout -- layers.rules.json`; `current` read `"L7"` again and `git status` was clean. core and core-next were built first (`pnpm install --frozen-lockfile --prefer-offline --ignore-scripts`, then `pnpm --filter … build` for each; exit 0).

| Run | Tests | Pass | Fail | Skipped |
|---|---|---|---|---|
| `conformance:v2` and `conformance:v2:prod`, together, at forced L11 | 3,342 | 1,906 | 320 | 1,116 |
| `conformance:v2:dist` at forced L11 | 3,260 | 1,828 | 316 | 1,116 |
| `conformance:diff` at forced L11 | 434 | 419 | 15 | 0 |

**Reading the table:** of the 320, 201 are L11's. The rest are L10's (109: 103 placed at L10, and 6 `mutants-derivations` "a body whose reads change shape" cases whose generated titles my join did not match, each failing on `d.register`), L8's (8, the history pins the L8 gate signs) and L9's (2: the `registerKeys` tests, which L9-pre-a's B3 moves to L10). The `dist` run fails the same 201 L11 tests.

**What `layers.json` places at L11.** 215 tests in 13 files (`main`): 209 black-box and 6 internals, which v2 skips by category. The reasons: `option predicate data form` (155), `import predicateToSQL` (34), `import doctor` (22), `import replayUnder` (22), `import predicateToMongo` (21), `import predicateToPostgrest` (21), `import diffRules` (19), `import predict` (18), `import predicateHash` (10), `import toReplayFrames` (7), and 12 smaller ones.

| File | Rule | At L11 | Fail at forced L11 | Why |
|---|---|---|---|---|
| `predicate-codegen` | L11 | 73 | 73 | `predicateToSQL`, `predicateToMongo`, `predicateToPostgrest`, `predicateToWhere` are not functions |
| `replay-under` | L11 | 36 | 36 | `replayUnder`, `toReplayFrames`, `framesFromHistory`, `framesFromSnapshots` missing; 2 fail as `RangeError: Invalid array length`, because `MAX_REPLAY_FRAMES` is undefined |
| `rules-diff` | L11 | 26 | 26 | `diffRules`, `toRulesMap` missing |
| `doctor` | L11 | 24 | 24 | `doctor` is undefined; 2 for `flattenPredicate` |
| `predict` | L11 | 18 | 18 | `predict` missing |
| `predicate-hash` | L11 | 10 | 10 | `predicateHash` missing |
| `blackbox-effects` | L0 | 11 | 9 | data-form `on`: the gate is ignored (`expected [ 3 ] to deeply equal []`), the spec is not frozen, a gate takes no `prevFacts` snapshot, `$changed` fires on an unrelated write; 4 also need `effects.register` or `assign` (L10) |
| `l3-proxies-oracle-transform` | L3 | 3 | 3 | a data-form `when` in a composed system never fires (`expected [ 'fn-31' ] to deeply equal [ 'array', … ]`) |
| `mutants-derivations` | L0 | 4 | 2 | a data-form `compute` (`deriveDefs[d.id_] is not a function`); 1 also needs `derive.register` (L10) |
| `data-forms` | L1 | 3 | 0 | the three `$changed` refusals pass: core-next built them |
| `l1-derivations-effects` | L0 | 1 | 0 | a non-object `compute` is refused: built |
| `constraints` | L2 | 1 | skipped | internals |
| `mutants-effects` | L0 | 5 | skipped | internals |
| **Total** | | **215** | **201** | 8 pass, 6 skipped |

**Reading the table:** the six tool files are 187 of the 201, and every one fails at its import. The engine side is 14 tests in three files, and 5 of them cannot pass before L10.

**Placements that are not on `main` yet.** L9-pre-a's U14 (branch `origin/p9/l9-pre-a`, commit `bee00383`, not merged) gives `data-forms.test.ts` `instruments: ["import flushMicrotasks"]` and adds the signal `option resolver key data form` to `lib/layers.ts`. On that branch L11 holds 224 tests: the 215 and 9 `data-forms.test.ts` tests moved from L13 (the data-form `when`, `on`, list `key`, `patch` and `compute`, the three introspection tests, and the handler-and-patch warning). On `main` those 9 sit at L13 with the single reason `import flushMicrotasks`. **`data-forms-namespaced.test.ts` has the same problem and no fix on any branch.** Its rule is `L1` with no `instruments` (`layers.rules.json:352–354`, on `main` and on `origin/p9/l9-pre-a`), so all 15 of its tests sit at L13 for `import flushMicrotasks` alone, though they exercise namespaced data forms, a registered data-form constraint and `abortOn` prefixing. It is a false placement, like L9's U14 and L10's U12, and L11-pre re-places it (U15).

**1.35's own tests for the evaluator are not ported.** `WHITE-BOX.md:30–32` lists `core/__tests__/predicate.test.ts` (149 tests), `predicate-describe.test.ts` (55) and `sweep-under.test.ts` (20) as "split" at L11: the black-box cases port, the internals stay unit tests. None is ported. The 224 cases (149 + 55 + 20) are the only oracle the operators have: the 14 engine tests that run a data form and the diff scenarios reach them through a handful of predicates, and nothing else does (U14).

| Failing diff test | Why |
|---|---|
| "data-form when, on and comparison operators" (L11; in `l1-prev-dataforms`) | 113 differences: v2's data-form `when` throws (`onConstraintError`), so no constraint evaluates, and every `on` gate runs ungated |
| "predicate tools over a light's recorded history" (L11) | 118 differences: the light's data-form `when` never evaluates on v2, and every tool call throws "is not a function" |
| "predicate validation against a schema's field kinds" (L11) | 6 differences: `validatePredicateAgainstSchema` is missing |
| "an `on` predicate gates an effect; derived values read inside run" (L11; in `l4-effects-gates`) | the effect runs ungated on v2 |
| "disable then enable: an effect with an on gate and a write to an unrelated fact" (L11; in `l4-effects-disabled`) | 9 differences: the effect runs ungated |
| The fuzz, "random systems trace identically on every engine" | Seed 24301, shrunk to one module with `history: true` and `trace: true` and no data form: an L8 case, as at forced L9 |
| 2 L10 scenarios and 7 L8 scenarios | L10's and L8's |

**Reading the table:** all five L11 scenarios fail, and three of them for the engine side alone. The fuzz failure is not L11's: the fuzz model draws no data form (see "The fuzz").

**The census.** `pnpm census` (exit 0) reports "1.35 names missing at unbuilt layers: 47 (L8 2, L11 33, L12 11, L13 1)". The 33 at L11, read from `gateBuiltNext` (`contracts/lib/next-surface.ts:329`):

- **31 root exports.** Tools: `predicateToSQL`, `predicateToWhere`, `predicateToMongo`, `predicateToPostgrest`, `describePredicate`, `predicateHash`, `doctor`, `diffRules`, `diffClauses`, `flattenPredicate`, `toRulesMap`, `predict`, `replayUnder`, `toReplayFrames`, `framesFromHistory`, `framesFromSnapshots`, `MAX_REPLAY_FRAMES`, `sweepUnder`, `MAX_SWEEP_POINTS`, `validatePredicate`, `validatePredicateAgainstSchema`. The evaluator's public helpers: `evaluatePredicate`, `evaluatePredicateExplained`, `memoizePredicate`, `isPredicate`, `extractDeps`, `evaluateTemplate`, `extractTemplateKeys`, `isTemplate`, `applyPatch`, `evaluateKeySelector`.
- **2 in `/internals`:** `hashObject` (behind `predicateHash`, and L12's distributable snapshots) and `dangerousRegex`.

**No L11 feature is a subpath in 1.35.** I listed every export of the published 1.35 in production (`node exports.mjs`, exit 0): the root has 76 names, 26 of them L11's; `/internals` has `hashObject`; `/plugins`, `/testing`, `/migration`, `/adapter-utils` and `/worker` have none. So the honest split is not "root against subpath" but "every app against apps that import a tool": the engine side reaches every `createSystem` build, and each tool reaches only an app that imports it (Size).

**The mutation gate.** No `gate: L11` run exists. The latest dispatched runs of `mutation-nightly.yml` are `gate: L9`: run 43815165003 (2026-11-16) printed "Layer gate L9: FAIL. 170 deferred entries at or below L9 are not killed", and run 43878385238 was still running when I looked (`gh run list`, `gh run view --log`). **Result for L11: not started.** It is Precondition 3. The triage files hold 53 entries with `layer: "L11"`: 35 `later-layer` in `system-module-transform.json` (the namespaced prefixing of data forms, killed only by `l3-proxies-oracle-transform`'s L11 tests), 14 `feature-layer` in `engine.json` (the clause tree in `explain()`, `engine.ts:3920–3950`), 2 `later-layer` in `engine.json` (`inspect()`'s `abortOn`, killed by `doctor`), and 2 `later-layer` in `effects.json` (the `on` gate, `effects.ts:730, 966`). 33 more entries mention L11 only in a note. Stryker mutates `packages/core/src/core/*.ts` (`stryker.config.mjs:17–21`), so the predicate files are in scope; no triage file exists for any of them, so their survivors, if any, are untriaged.

## The design: each 1.35 rule, the mechanism that keeps it, and its pin

Where a row says "verified", the probe ran it against the published 1.35 (`packages/conformance/node_modules/directive-v1`, `1.35.0`), in development and production, with real timers. The output is under "Evidence". The rest is read from the code; 1.35 line numbers are in `packages/core/src/`, which is 1.36.0 (`package.json`). The L11 files changed between the two only in comments and a parameter name (`git log` for the eight files: the newest change is "An effect's second parameter is named prevFacts", #144); every behaviour below that matters was probed on 1.35 itself.

### Where it lives, and the seam it needs

**In plain terms:** the evaluator is a part that `createSystem` wires, because 1.35's data forms work with no import. The tools are plain root exports, as in 1.35, so an app pays for a tool only if it imports it.

| Option | Keeps 1.35's API? | Who pays the bytes |
|---|---|---|
| **O1. The evaluator in a part wired by `createSystem`; the tools as root exports** | Yes | Every `createSystem` build pays the engine side. Each tool is paid only by an app that imports it, and by the `full-entry` fixture, which imports everything |
| O2. The tools in a new subpath (`@directive-run/core/predicates`) | No: a 1.35 program's `import { predicateToSQL } from "@directive-run/core"` breaks | Nobody more than under O1: tree-shaking already keeps unused tools out of an app. This is a beta question |
| O3. Data forms only through an import (`predicates()`) | No: a 1.35 constraint with `when: { phase: "red" }` stops firing | Only apps that import it. This is the beta. **Not taken in the alphas: an owner question, O3 in Decisions** |

**Reading the table:** O2 buys nothing in the alpha, because a tool an app does not import already costs it nothing (verified: bundling 1.35 for a one-module app, importing `predicateToSQL` added 1,371 B gzip, so the plain app did not carry it). O1 keeps the alpha rule.

**The seam.** The core needs one small hook, and it must be read lazily. A data-form `compute` reaches the core, not a part: `core.ts:404–418` builds the derivation functions through `defsOf(module.derive, "compute")`, called at `core.ts:502`, and already refuses a non-object form. The parts run later, at `core.ts:1935`, so at registration the slot is still empty. The core therefore keeps the object form and wraps it in a function that reads the slot on its first call, the first compute, when every part has run; with no part wired, that first compute throws 1.35's message. The non-object refusal stays eager (built). Under O1 the part fills the slot with the function that turns a predicate or a template into a derivation. Constraints, effects, events and resolvers are parts already, so their data forms are wired in the part, with no core change. **Measured by the review's sketch (`size-sketch.log`, read against this RFC's post-L9 base):** +78 B on `floor`, +61 B on `minimal`, +57 B on `two-module`, +69 B on `aperture`, +70 B on `full-entry`, +77 B on the minimal beta line. L9's seam landed 35% over its sketch, so the number to plan on is about 105 B on `floor` (78 × 1.35), and the cap is +150 B.

### The evaluator

**In plain terms:** 1.35 interprets the predicate object on every evaluation. It does not compile it. A data-form `when` becomes a small function at registration, read through the same facts proxy, so dependency tracking, the reconcile loop and the trace see an ordinary `when`.

| # | 1.35 rule | 2.0 mechanism | Pinned by |
|---|---|---|---|
| E1 | A data-form `when` is replaced at registration by a function that calls `memoizePredicate(spec)` on the facts proxy; the spec is kept for `whenSpec` and `explainWhen`; `async` is cleared, explicit `deps` are dropped (with two development warnings), and a `$changed` anywhere throws (`core/constraints.ts:408–470`). Verified, Q9: `typeof def.when` is `"function"` afterwards and `def.async` is `false`. | The same, in the constraints part. The `$changed` refusal is already built. | `l3-proxies-oracle-transform` (3); diff "data-form when, on …"; U9 |
| E2 | The spec, and every object inside it, is frozen at registration; `whenSpec` is the caller's own object (`freezeSpec`, `utils/utils.ts`). Verified, Q5 and Q19: the outer object, an operator object and a nested array were all frozen; `whenSpec === spec`. | The same. | `blackbox-effects` "freezes the spec it was given"; U5 |
| E3 | The operators (`predicate.ts:918–1056`). Equality is deep (`deepEqual`). `$gt`, `$gte`, `$lt`, `$lte` and `$between` compare only two numbers, two strings, two bigints or two `Date`s (a `Date` counts as its time), never a mix. `$exists: true` passes for `null`. `$in` and `$nin` with a non-array never pass. `$startsWith`, `$endsWith` and `$contains` turn the operand into a string. `$matches` needs a `RegExp` and throws otherwise. Verified, Q6 and Q18: `"5"` against `10` false, `1n` against `2` false, `Date` against `0` true; `null` exists; `$startsWith: undefined` matches `"undefined!"`. | A port of `applyOperator`. | U6, U11; the ported `predicate.test.ts` cases (U14) |
| E4 | A predicate object: `$all`, `$any`, `$not` first; otherwise each key is a fact, and every one must pass. An operator key beside fact keys makes the predicate false, with a development warning. A plain object under a fact key is a nested predicate over that value (`evaluatePredicate`, `predicate.ts:1115–1195`). An array is a list of `{ fact, op, value }` clauses. | A port. | U2, U14 |
| E5 | **A combinator wins over its siblings.** In `{ $any: [{ n: 1 }], phase: "green" }`, `phase` is never read: the runtime returns the `$any` result. `describePredicate` drops `phase` too ("n is 1"). The SQL and PostgREST compilers refuse the same predicate ("$any cannot coexist with sibling keys (phase) — wrap them in $all together"), and so does Mongo. `validatePredicate` accepts it. Verified, Q3 and Q23, both modes: the constraint was active with `phase` "red". | Without (bq): copied. With (bq): refused at registration with the compilers' message. | U2; shows (bq) |
| E6 | **An unknown operator** (`$gtee`) never passes. Development warns "unknown operator "$gtee" — looks like a typo" on every evaluation (at least 4 warnings in Q2, which ran three passes with a plugin installed); production is silent; `validatePredicate` warns and does not throw; `isPredicate` says true. Verified, Q2 and Q17. | Without (bs): copied. | U4; shows (bs) if approved |
| E7 | **An operator object with two operators**, `{ $gte: 1, $lte: 5 }`, ANDs them and warns in development on every evaluation. Verified, Q7. | The same. | U7 |
| E8 | **Depth.** Past 64 levels the evaluator returns false for the part it cut, with a development warning. A `$not` above the cut turns that false into true. Verified, Q8: 140 `$not`s over `{ n: 1 }` gave true in both modes. | The same. | U8 |
| E9 | **A data form reads facts only.** A data-form `when` is called with the facts proxy, so a key that names a derivation reads `undefined`: `{ dbl: { $gte: 4 } }` never passes, with no warning in either mode. An effect's `on` is evaluated against the facts snapshot, which has no derivations either (`effects.ts:857–865`, the code says so). Verified, Q1 and Q10: `dbl` read 4, the constraint stayed inactive with 0 hits, and the `on` gate never ran. | Without (br): copied. | U3; shows (br) if approved |
| E10 | **`$matches` with a global or sticky regex never passes inside a system.** The regex is frozen with the spec (E2), and `RegExp.prototype.test` on a `g` or `y` regex writes `lastIndex`, so it throws "Cannot assign to read only property 'lastIndex'"; the constraint error is skipped silently by default (development warns). Called directly on an unfrozen regex, `evaluatePredicate` alternates true, false, true, false. Verified, Q4 to Q4c. | Without (bp): copied. With (bp), at registration only: `$matches` tests a stateless copy of the regex, made once. A direct `evaluatePredicate`, `memoizePredicate` and the tools that call them keep the alternation. | U1 (both halves); shows (bp) |
| E11 | **The breakdown is a second evaluation.** 1.35 evaluates a data form twice when any plugin is installed. First `evaluatePredicate` runs inside `withTracking` (`constraints.ts:831`); it short-circuits (`predicate.ts:1153–1176`: `$all` and `$any` use `every` and `some`, the object form returns at its first failing key), so only the facts it read before it stopped become dependencies. Then, at `onEvaluate` (`constraints.ts:861`, reached from `engine.ts:1248–1256`), `evaluatePredicateExplained` runs untracked (`constraints.ts:1809–1818`) and visits every clause to build `whenExplain` (Q14: two failing rows). With no plugin, once. **One walk cannot keep both.** If it short-circuits, `whenExplain` is partial. If it visits and tracks every clause, there are more dependencies, so more re-evaluations and more `constraint.evaluate` records, and different `deps` in L9's trace. So (bt) is not "same", and it is declined. | The same: two evaluations, the second untracked and complete, run only when a plugin or observer listens. | U17 |

**Reading the table:** E1 and E2 are why a data form behaves like a function in the reconcile loop: tracking sees the facts it reads, so the loop, `explain()` and the trace need no new path. E5, E6, E9 and E10 are the silent failures: each is a rule that looks right and never, or always, fires.

### The other data forms

| # | 1.35 rule | 2.0 mechanism | Pinned by |
|---|---|---|---|
| D1 | An effect's `on`: its facts become the effect's dependencies (`extractDeps`), the spec is frozen, and the effect runs only when the predicate holds, after the dependency pre-filter, against a facts snapshot; `$changed` compares with the previous snapshot, and on the first run a present value counts as a change. A gate forces the `prevFacts` snapshot even when the body never reads it (`effects.ts:730, 857–888, 960–971`). Verified, Q10: `$changed` ran on start and on the write. | The gate, in the effects part (which already checks the shape). | `blackbox-effects` "data-form on" (7); diff "an `on` predicate gates an effect"; U10 |
| D2 | A derivation's `compute` as a predicate gives a boolean; as `{ $template: "Hi ${name}" }` gives a string, with `$${` for a literal `${`, and a development warning for an unknown key or an unterminated placeholder (`derivations.ts:255–280`, `predicate.ts:1467–1530`). Verified, Q22: `true` and "Hi Ann (5)". | Through the core's hook (the seam), filled by the part. | `mutants-derivations` (2); `data-forms` "derivation compute" (on L9-pre-a's branch) |
| D3 | An event's `patch`: literals, `$ref` copies from the payload, `$template` strings; the spec frozen at registration; a `handler` beside a `patch` wins with a development warning (`engine.ts:151–171`, `applyPatch`). | In the part that wires events. | `data-forms` "event patch", "handler + patch conflict" (L9-pre-a's branch) |
| D4 | A resolver's `key` as a list of field names dedups requirements by those fields (`normalizeResolverKey`, `engine.ts:1215–1229`; `evaluateKeySelector`). | In the resolvers part. | `data-forms` "resolver key" (L9-pre-a's branch) |
| D5 | In a multi-module system every data form is prefixed with its module's namespace; `self` and dependency-namespace pivots are rewritten; keys already prefixed pass through (`system-module-transform.ts:164–230, 336–470`). | In core-next's flattening, which already prefixes function forms. | `l3-proxies-oracle-transform` (3); `data-forms-namespaced` (15, U15) |

### Register, assign and unregister of data forms

**In plain terms:** 1.35 runs the same data-form step when a definition is created, registered later or assigned over another. 2.0 must run one step in all three places, and L10 builds the registry that calls them. L10's registry (the L10 RFC, revision 2, change 4) routes `register`, `assign` and `unregister` through four manager hooks, `{ add, replace, remove, callOne }`; L11a puts each data-form step inside `add`, `replace` and `remove`, so creation, `register` and `assign` share it.

| # | 1.35 rule (read, as marked) | 2.0 mechanism | Pinned by |
|---|---|---|---|
| R1 | **A constraint's `register`** calls `normalizeWhenSpec` for each new key (`constraints.ts:1678`), the function `createSystem` uses: the spec is frozen and stored, `when` becomes a function, `deps` and `async` are dropped with their warnings, a `$changed` throws. The constraint is marked dirty. | The normalizer of E1, called by creation and by `add`. (bq) and (br) run in it, so they bite at `register` too. | U19; the L10-gated tests in `blackbox-effects` |
| R2 | **A constraint's `assign`** replaces the definition, drops the old `whenSpec` (`whenSpecs.delete`, `constraints.ts:1707`), then normalizes the new one (1709). Data over function sets `whenSpec`; function over data removes it. | `replace` does the same two steps in the same order. | U19 |
| R3 | **A constraint's `unregister`** (`constraints.ts:1721–1748`) removes the definition, state, dependencies and sort order, and never touches `whenSpecs`. `normalizeWhenSpec` returns at once for a function form (412), so a later function-form `register` under the same id keeps the removed rule's spec: `getWhenSpec` and `explainWhen` would report clauses the new rule does not have. **Read, not probed.** | Copied until probed. L11-pre probes it (U18). If it is confirmed, it is a candidate row (bu), opened then and not decided here. | U18 |
| R4 | **An effect's `register`, `assign` and `unregister`** each end in `recomputePrevFactsObserved()` (`effects.ts:1489–1531`): a data-form `on` gate forces the `prevFacts` snapshot (D1), so registering one turns it on and unregistering the last one turns it off. `assign` runs the old effect's cleanup first; `unregister` runs it and deletes the gate. | The gate's setup in `add` and `replace`; its teardown and the recompute in `remove`. | U19; `blackbox-effects`, the L10-gated tests |
| R5 | **A derivation's `register` and `assign`** unwrap an object `compute` (a predicate or a template) the way creation does; `assign` clears the old meta first (`derivations.ts:1197, 1242–1255`). `unregister` purges the maps; there is no spec to keep. | The lazy seam: the wrapper is made by the same `defsOf` path, so a registered or assigned data form reads the slot at its first compute. | U19; `mutants-derivations` (the L10-gated one) |

**Reading the table:** five tests need L10 and L11 together (an effect's `on` gate, or a data-form derivation, registered, assigned or unregistered at run time). They stay skipped until both are built, and L11a's done-means lists them.

### Introspection, the reconcile loop and the trace

**In plain terms:** L9 built the slots; L11 fills them. Nothing else in the loop changes.

| # | 1.35 rule | 2.0 mechanism | Pinned by |
|---|---|---|---|
| I1 | `inspect().constraints[].whenSpec` is the data form, only when there is one. | Built at L9 (`reconcile.ts:691–692`). | L9's U15 |
| I2 | The observer's `constraint.evaluate` event and the `onConstraintEvaluate` hook carry `whenExplain`, a list of `{ path, op, expected, actual, pass }` rows with `children` under a combinator, and only when there is one (`engine.ts:1254–1255, 3042–3051`). Verified at L9 (P21) and here (Q14's rows). | The record gains its `explain` field from the evaluator; `withObserve`'s pass-through is built. | `data-forms` "observe() emits whenExplain" (L9-pre-a's branch) |
| I3 | `explain(requirementId)` prints "Predicate clauses:" with a tick or a cross per clause, combinators indented, values as JSON (`engine.ts:3913–3963`). | The printer, in the predicates part, called from `explain()`. | `data-forms` "explain(requirementId) renders the clause tree"; the 14 `engine.json` triage entries |
| I4 | The reconcile loop, dependency tracking and the trace see a data-form `when` as a function (E1). The trace's constraint `deps` are what the tracked, short-circuiting evaluation read. `whenExplain` comes from the second, untracked evaluation (E11), so it adds no dependency and no `constraint.evaluate` record, and it is not in the trace. | Nothing to add. | L9's trace tests; U17 |

### The tools

**In plain terms:** the tools are pure functions over predicate objects. They read no engine state, so they port as code, and their own tests pin them. Three of them take engine output: `doctor` and `diffRules` accept `inspect().constraints`, and the replay tools accept a history export or a list of snapshots.

| # | Tool | 1.35 rule (verified unless marked read) | Pinned by |
|---|---|---|---|
| T1 | `predicateToSQL`, `predicateToWhere` | Parameterized: values go in `params`, never in the text; identifiers must match `/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/` or it throws; `$startsWith` escapes `%` and `_` (`LIKE $3 \|\| '%' ESCAPE '\'`); `$matches` becomes `~` with the source; `$changed` throws. Q11 | `predicate-codegen` (73) |
| T2 | `predicateToMongo`, `predicateToPostgrest` | Field names starting with `$` or containing `.` are refused; combinators with siblings refused (E5). Q11, Q23 | `predicate-codegen` |
| T3 | `describePredicate` | "phase is red AND elapsed is at least 30"; "(n is 1) OR (n is one of 2, 3)". Q13 | the ported `predicate-describe.test.ts` (U14); the diff scenario |
| T4 | `predicateHash` | `hashObject` of the spec: key order does not matter, an `undefined` key differs from a missing one, regexes and dates hash by value; 7 or 8 hex characters. Q12 | `predicate-hash` (10) |
| T5 | `doctor.checkAgainst`, `doctor.checkAbortOn` | A direct contradiction, a subset (a warning) or an overlap (a warning), each with a reason citing both sides; constraints without `whenSpec` skipped. Q15 | `doctor` (24) |
| T6 | `diffRules`, `diffClauses`, `flattenPredicate`, `toRulesMap` | Per constraint: added, removed, changed, with each clause `tightened`, `loosened` or `added`, and a summary. Q20 | `rules-diff` (26) |
| T7 | `predict` | `wouldFire`, the breakdown, and for each failing clause a suggestion ("set elapsed to at least 30 (currently 10)"). Q14 | `predict` (18) |
| T8 | `replayUnder`, `toReplayFrames`, `framesFromHistory`, `framesFromSnapshots`, `MAX_REPLAY_FRAMES` (1,000,000) | Counts and samples the frames each predicate matches, with both breakdowns per sample; the cap is checked before any frame is built. Q21 | `replay-under` (36) |
| T9 | `sweepUnder`, `MAX_SWEEP_POINTS` (10,000) | A grid over a template predicate's parameters, replayed per point (read: `sweep-under.ts:97–106, 270`). | the diff scenario only; U13 |
| T10 | `validatePredicate`, `validatePredicateAgainstSchema` | The second takes the kind map `getSchemaFieldKinds` returns, and refuses an operator a kind does not allow, or an unknown fact. Given a schema instead, it throws "kindMap.get is not a function" in development and "n.get is not a function" in production (a minified name). Q16, Q24 | diff "predicate validation …"; U12 |

## Where it lives

**In plain terms:** one new part for the engine side, ten new tool files, and one hook slot in the core.

| Piece | File | Change |
|---|---|---|
| The evaluator | `src/api/predicate.ts` (new) | `evaluatePredicate`, `evaluatePredicateExplained` (the second, untracked walk of E11), `memoizePredicate`, `isPredicate`, `extractDeps`, `walkPredicate`, templates, `applyPatch`, `evaluateKeySelector`, `validatePredicate`. Reuses the operator list in `schema-introspection.ts:23–57` and the `$changed` walker in `constraints.ts:680–735` |
| `withPredicates` | `src/api/predicate.ts` | Fills the hooks below, and the clause printer for `explain()` (I3) |
| Constraints | `src/api/constraints.ts:117–128, 281–293` | The data-form `when` replaced at registration (E1, E2); `explainWhen` |
| Effects | `src/api/effects.ts:199–206` and the run filter | The `on` gate and its snapshot (D1) |
| Events, resolvers | the parts that wire them | `patch` (D3) and the list `key` (D4) |
| Namespacing | core-next's flattening | Prefix data forms (D5) |
| Register, assign, unregister | the L10 registry's `add`, `replace` and `remove` | The data-form step of each kind, shared with creation (R1 to R5) |
| The record | `src/api/reconcile.ts:126` | An `explain` field on `constraint.evaluate`, only when something listens (I2) |
| **The seam** | `src/api/core.ts:404–418, 502` | One hook slot for a data-form `compute` (D2), read lazily at the first compute, not at registration; 1.35's throw when no part has filled it |
| The tools | `src/api/predicate-to-sql.ts`, `predicate-to-mongo.ts`, `predicate-to-pgrest.ts`, `predicate-describe.ts`, `predicate-hash.ts`, `doctor.ts`, `rules-diff.ts`, `predict.ts`, `replay-under.ts`, `sweep-under.ts` (new) | Ports of 1.35's files |
| Exports | `src/index.ts`, `src/internals.ts` | The 31 root names and the 2 internals; the census's L11 count goes to 0 |

## The fuzz, designed in up front

**In plain terms:** the random tests reach no data form today. L11-pre teaches them to write rules as data, so the two engines are compared on random predicates as well as random functions.

What the model does today, read from the code: `FEATURE_LAYERS` stops at `trace: 9` (`diff/fuzz/model.ts:255–278`); every constraint's `when` is a function (`model.ts:821, 1160`); there is no `on`, no data-form `compute`, `patch` or `key`. So no fuzz case is placed at L11, and none reaches the evaluator.

| L11 behaviour | The model reaches it today? | What L11-pre adds |
|---|---|---|
| A data-form `when` (E1 to E4) | No | A constraint drawn either as today's function or as the same test written as data, over the case's facts, with the operators and combinators drawn |
| An `on` gate, `$changed` (D1) | No | An effect drawn with an `on` predicate |
| `compute` as a predicate or template (D2) | No | A derivation drawn as either |
| An event `patch` (D3) | No: an event is `{ target, add }` and is written by a handler (`model.ts:84`) | An event drawn as a handler or as a `patch` that writes the same facts, with a literal, a `$ref` copy and a `$template` string |
| A resolver list `key` (D4) | No: the key is a function | A resolver key drawn as the function or as the same fields written as a list; requirements are deduplicated by them |
| `$changed` with a restore (D1) | Partly: the model has `snapshot` and `restore` steps (`model.ts:108–109`) and a restore case for effects (`model.ts:74`), but no `on` | An effect with `on: { f: { $changed: true } }` in a case that takes a snapshot and restores it, so the draw reaches what the gate sees after a restore. 1.35's answer is not probed here; the fuzz compares the engines, and a difference is pinned by hand |
| Namespaced data forms (D5) | No | The drawn forms in two-module cases |
| The tools (T1 to T10) | No | A `tools` op: at a checkpoint, run `describePredicate`, `predicateHash`, `predict` and `doctor.checkAgainst` over the case's own data forms and facts, on both engines, and record the answers |
| `explain()` and `whenExplain` (I2, I3) | Partly: the recorder keeps every observer event and hook (`diff/hooks.ts`) | Nothing more: once data forms are drawn, they are compared |
| E5, E6, E10 | No | Not drawn: they are the candidate rows, pinned by hand (U1, U2, U4) |

**The order with L10-pre.** L10-pre edits the same model: `FEATURE_LAYERS` stops at `trace: 9` today (`model.ts:255–278`), and L10-pre adds its layer-10 entry and the unregister-while-in-flight step. L10-pre goes first, because the L10 gate is Precondition 1. L11-pre branches from `main` after L10-pre has merged, adds its entries at layer 11 and does not renumber the layers L10-pre added. If the two overlap, L11-pre rebases onto L10-pre's model, and two open PRs never edit `FEATURE_LAYERS` at once.

**What the harness compares at L11, and the shapes that are new.** Once a case draws a data form, its `whenExplain` rows reach every `onConstraintEvaluate` and observer event, and `explain()` reaches the recorded text. Compared for the first time: the order of the breakdown's rows (1.35 walks the spec's keys in insertion order); the `actual` values in them; how many times a development warning prints (E6, E7: 1.35 prints once per evaluation, and twice per pass when a plugin is installed, E11); and the namespaced spelling of prefixed keys inside `whenSpec`. Expect the new shapes at the gate as differences of order and of warning counts. Warning counts are compared exactly: with (bt) declined, nothing halves them. This is a prediction from L7 to L9, not a measurement.

**L11-pre's bar.** The 21 PR seeds at forced L11 leave at most 10 unexplained cases. A case is explained if its shrunk form is "data forms not built", "tools not built", or one of L8's, L9's or L10's items.

**Harness rules, decided now.** L8's ten rules and L9's three carry over unchanged. Two are new:

1. **The data-form draw and the `tools` op each ship with a self-test**: one where a predicate is flipped on one engine, and one where a tool answer is changed.
2. **The L11-pre exit bar** is L8's (A3). Development warnings from the evaluator are compared exactly, as at L8 to L10; with (bt) declined, nothing halves their count.

Whether the deep runs gate L11 is decision A2.

## Untested behaviours, and what will pin each

**In plain terms:** 19 items have no pin at L11. Twelve came from the probes, seven from the forced run and from reading the code.

| # | Behaviour | Evidence | Pinned by | Slice |
|---|---|---|---|---|
| U1 | A global or sticky regex in `$matches` throws inside a system (frozen `lastIndex`) and the rule never fires; called directly it alternates | Q4, Q4b, Q4c | A conformance test in each mode; shows (bp) | L11-pre |
| U2 | A combinator beside a fact key ignores the fact key at run time and in `describePredicate`; the three compilers refuse it; `validatePredicate` accepts it | Q3, Q23 | A conformance test and a diff scenario; shows (bq) | L11-pre |
| U3 | A data-form `when` or `on` that names a derivation never matches, with no warning | Q1, Q10 | A conformance test in each mode; shows (br) | L11-pre |
| U4 | An unknown operator never matches; development warns on every evaluation; production is silent | Q2, Q17 | A conformance test in each mode | L11-pre |
| U5 | The caller's spec is deep-frozen at registration, and `whenSpec` is that object | Q5, Q19 | A conformance test | L11-pre |
| U6 | The relational operators never compare a number with a string or a bigint; a `Date` compares by its time | Q6 | Cases in the ported `predicate.test.ts` | L11-pre |
| U7 | Two operators in one object are ANDed, with a development warning per evaluation | Q7 | A conformance test | L11-pre |
| U8 | Past depth 64 the cut part reads false, and a `$not` above it reads true | Q8 | A conformance test | L11-pre |
| U9 | A data-form `when` with `deps` or `async`: two development warnings, `deps` dropped, `async` cleared | Q9 | A conformance test | L11-pre |
| U10 | `$changed` in an `on` fires on the first run | Q10 | A diff scenario | L11-pre |
| U11 | `$exists: true` passes for `null`; `$in` with a non-array never passes; `$startsWith: undefined` matches `"undefined…"` | Q18 | Cases in the ported `predicate.test.ts` | L11-pre |
| U12 | `validatePredicateAgainstSchema` given a schema throws, with a minified name in production | Q16 | The diff scenario pins development; a conformance test asserts only that it throws a `TypeError` in production | L11-pre |
| U13 | `sweepUnder` has no black-box test; only the diff scenario calls it | `grep -rl sweepUnder tests diff`: 1 file, `diff/scenarios/l11-predicates.test.ts` | The 19 portable cases of `sweep-under.test.ts` (U14) | L11-pre |
| U14 | 1.35's `predicate.test.ts` (149), `predicate-describe.test.ts` (55) and `sweep-under.test.ts` (20) are the only operator oracle (224 cases) and are not ported; only 14 engine tests reach the evaluator | `WHITE-BOX.md:30–32`; the forced run | Port them, split the way `meta.test.ts` was at L9 (`WHITE-BOX.md:28`: the `createSystem` cases port, the helper groups stay unit): evaluation cases through the public predicate API; the walker, freeze and number-format-cache cases stay unit tests; the one `sweep-under` case that needs `MAX_SWEEP_EVALUATIONS` moves to a core-only file, and the constant is not exported | L11-pre |
| U15 | `data-forms-namespaced.test.ts` (15 tests) is a false placement, like L9's U14 and L10's U12: rule `L1`, no `instruments`, so all 15 sit at L13 for `import flushMicrotasks` alone | `layers.rules.json:352–354`; `layers.json`, read with `node` | Re-place it in L11-pre: `instruments: ["import flushMicrotasks"]` on its rule, as L9-pre-a gave `data-forms.test.ts`; check where each lands (expected L11, two at L10 or L11 for `register`) | L11-pre |
| U16 | A template's `$${` escape and its unknown-key warning | read: `predicate.ts:1467–1530` | Cases in the ported `predicate.test.ts` | L11-pre |
| U17 | With a plugin installed, a data form is evaluated twice per pass, the second time untracked and over every clause; with none, once and with no breakdown. This pins 1.35 and is what declining (bt) rests on | read: `constraints.ts:831, 861, 1809–1818`, `engine.ts:1248–1256` | A conformance test that counts a development warning per pass with and without a plugin, and one that reads a short-circuited predicate's `deps` against its full `whenExplain` | L11-pre |
| U18 | An unregistered constraint's `whenSpec` stays behind, and a function-form `register` under the same id reports it (R3) | read: `constraints.ts:412, 1721–1748` | A probe on 1.35 in each mode first, then a conformance test of whatever it shows; a candidate row (bu) only if it confirms the stale spec | L11-pre |
| U19 | A data form registered or assigned at run time is normalized as at creation: data over function and function over data swap `whenSpec` (R2); an effect gate's registration and removal turn the `prevFacts` snapshot on and off (R4); a derivation's data form is unwrapped (R5) | read: `constraints.ts:1678, 1707–1709`, `effects.ts:1489–1531`, `derivations.ts:1197, 1242–1255` | Conformance tests at L11 that use `register` and `assign`; they skip on v2 until L10 and L11a are both built | L11-pre |

**Reading the table:** U1 to U3 are where the candidates live; each pins 1.35 now and shows the difference only with an approved, signed entry. U4 pins 1.35 whether or not (bs) is approved. U17 pins 1.35's two evaluations, the ground for declining (bt). U18 may add one candidate, (bu), after its probe. U14 is the largest item: 224 of 1.35's own tests, the operator cases that nothing in the oracle runs today.

## Performance

**In plain terms:** a data form costs a walk of the predicate per evaluation, as in 1.35, which walks it a second time when a plugin is installed. 2.0 keeps that (E11).

I did not run the bench for this RFC: no L11 code exists. What L11 must keep:

- A system with no data form is not slower than `main` by more than 5% after any L11 slice: the parts add nothing to a pass that has no data form.
- A data-form `when` costs one tracked, short-circuiting walk per evaluation and, with any plugin installed, one untracked walk of every clause (E11), as in 1.35. (bt), one walk, is declined.
- `memoizePredicate` caches by the spec object (a `WeakMap`), as 1.35; registration freezes the spec, so the cache cannot go stale.
- L11a adds a `data-form-100` workload (B3): 100 constraints with data-form `when`, a write that re-evaluates all, with and without a plugin. Time, judged at 1.0 or better against 1.35.

## Slice plan

**In plain terms:** an oracle slice, the engine side, the tools, and the gate.

| Slice | Builds | Done means (checkable) | Tier |
|---|---|---|---|
| Precondition 1 | The L10 gate, after the L8 and L9 gates. | `current` is L10. | coordinator |
| Precondition 2 | L9-pre-a merged (its U14 placement). | `data-forms.test.ts`'s nine tests sit at L11 on `main`. | coordinator |
| Precondition 3 | A `gate: L11` run of `mutation-nightly.yml`. | The L11 layer gate reports PASS, or its debt entries are listed as L11-pre work. | test oracle; coordinator |
| L11-pre (oracle), after L10-pre has merged | U1 to U19: the probe pins, the ported splits of the three white-box files (U14), the `data-forms-namespaced` placement (U15). The fuzz additions (`when`, `on`, `compute`, `patch`, list `key`, `$changed` with a restore) and rules 1 and 2 (B1), each with a self-test, on L10-pre's model. Any mutation debt. | The 21 PR seeds at forced L11 leave at most 10 unexplained cases. The new tests pass on `conformance:v1` and `v1:prod`, and on v2 fail only as this document predicts. `pnpm census`, `check:expects` and `oracle:update` exit 0. `oracle-change` label. | test oracle; Sonnet implementer, Fable correctness reviewer |
| L11a (engine side) | **The lazy seam first**, measured against its 78 B sketch and reported. Then `withPredicates`: the evaluator (E1 to E11), the six data forms (D1 to D5), their register, assign and unregister steps (R1 to R5), the `explain` record field and the clause printer (I2, I3). (bp) at registration, (bq) and (br). | At forced L11 on v2, v2:prod and v2:dist, the 9 engine-only failures pass, and the 5 that need L10 pass with it. The 9 re-placed `data-forms` tests and the 15 namespaced ones pass. The diff's three engine scenarios ("data-form when, on …", the two `on` gates) match 1.35 or differ only by signed entries. core-next `test`, `typecheck`, `build`, `size:check` with the exact development-string count. Sizes within A1; the PR reports the seam's bytes and the part's separately, before L11b starts. **The beta line:** `withPredicates` is added to `size.mjs`'s beta list, as `BETA_OMITTED` if it is wired as a bare `parts` entry (as `withMeta` is), or as `BETA_CALLED` (added by PR #399 for `withTrace(options.trace)`) if it is wired as a call; the PR reports the minimal beta line with it. | core; Opus implementer, Sonnet diff reviewer plus Fable correctness reviewer |
| L11b (tools) | The ten tool files and the 33 exports. | The 187 tool failures pass. The two tool scenarios match 1.35. The census reports 0 L11 names missing. Each tool's production bytes reported against its 1.35 bytes and as marginal bytes over the engine's share (Size). Plus L11a's checks. | core; Sonnet implementer, one reviewer (pure functions, ported with their tests) |
| L11-gate | `current` to L11, `ratchet --update`, diff and fuzz at L11, the 14 feature-layer triage entries converted, `GATE-11.md`, `/principal` on L11. | 0 L11 failures on v2, v2:dist and v2:prod. The census exits 0. PR fuzz passes at L11. The nightly follows A2. At most 3 gate runs, then Jason. | test oracle; Sonnet plus the coordinator's read of each entry |

**Reading the table:** L11a is the code every app carries; L11b is code an app carries only if it imports it. Splitting them keeps the size evidence for each separate, and L11b is low-risk: 10 files of pure functions with 187 tests waiting.

## Size

**In plain terms:** the engine side of 1.35's L11 is about 5.1 KB, and core-next already has about 0.3 KB of it. Ported at the rate L9 landed, every app grows by about 4.2 KB, which is L11a's target. The tools are another 11.0 KB, paid only by apps that import them; the per-tool costs are below. The recommended cap is +4.8 KB on the app fixtures, +150 B on `floor` (the seam alone is about 105 B), and +16.0 KB on `full-entry`, which imports every export.

**The post-L9 base.** Measured with `node scripts/size.mjs --check` in `packages/core-next` on this branch (production, minified, gzip 9; exit 0):

| Fixture | `main` now (post-L9) |
|---|---|
| `minimal` | 35,282 B |
| `two-module` | 35,373 B |
| `floor` | 11,022 B |
| `aperture` | 40,150 B |
| `full-entry` | 37,551 B |
| `minimal`, beta wiring | 27,956 B |

`floor` is 5 B above the 11,017 B the L10 RFC read from L9b's branch. L10 is not built. Its cap is +5.0 KB with a 4.1 KB target over L9b's 35,282 B (the L10 RFC, revision 2, A1), so the post-L10 `minimal` is expected between 39,382 B (at L10's target) and 40,282 B (at its cap). L11's caps are differences over the size L10 merges at.

**1.35's L11 code, measured.** The method is the L9 RFC's, with esbuild 0.27.7 (tsup's own copy, as `scripts/size.mjs` uses), production (`#is-development` resolved to `dev-false.ts`, so development text drops out), minified, gzip 9. Whole functions are bundled from `packages/core/src/core` with tree-shaking, so each line counts only what it needs. Call sites are lifted from the engine files by line range, wrapped in one function, and minified; the wrapper's own cost is subtracted.

| Piece | Regions | Minified | Gzip |
|---|---|---|---|
| The evaluator's core: `memoizePredicate`, `evaluatePredicate`, `isPredicate` | `predicate.ts` | 4,692 B | 1,915 B |
| **The engine's share of `predicate.ts`**: the ten functions the engine imports (the core above, `evaluatePredicateExplained`, `extractDeps`, `walkPredicate`, `evaluateTemplate`, `isTemplate`, `applyPatch`, `evaluateKeySelector`) | `predicate.ts` | 9,404 B | **3,610 B** |
| The same, without `evaluatePredicateExplained` | | 8,500 B | 3,296 B |
| `predicate.ts`, every export | | 14,769 B | 5,136 B |
| Call sites: constraints | `constraints.ts:399, 408–470, 482–…, 1805, 1809` (96 lines) | 985 B | 494 B |
| Call sites: effects | `effects.ts:750–756, 866–887, 965–971` (36 lines) | 608 B | 306 B |
| Call sites: derivations | `derivations.ts:261–…` (18 lines) | 344 B | 213 B |
| Call sites: engine (patch, list key, `whenExplain`, the clause printer) | `engine.ts:151–164, 1215–1229, 1254–1255, 3913–3963` (82 lines) | 1,126 B | 532 B |
| Call sites: namespacing | `system-module-transform.ts:164–…` (118 lines) | 1,005 B | 418 B |
| **Every call site, in one bundle** | | 3,988 B | **1,487 B** |

**Reading the table:** the engine side is the engine's share (3,610 B) plus the call sites (1,487 B): about 5.1 KB, gzipped as two streams. Of it, core-next already carries about 0.3 KB (reasoned, from the rows in "What we are building": `isPredicate`, the `$changed` walker, the operator list, `whenSpec` and the observer's pass-through).

| Tool, bundled alone with what it needs | Minified | Gzip |
|---|---|---|
| `predicateToSQL`, `predicateToWhere` | 5,476 B | 1,931 B |
| `predicateToMongo` | 4,614 B | 1,677 B |
| `predicateToPostgrest` | 5,394 B | 1,854 B |
| The three compilers together | 15,150 B | 3,766 B |
| `describePredicate` | 6,019 B | 1,953 B |
| `predicateHash` (with `hashObject`) | 1,189 B | 604 B |
| `doctor` | 6,093 B | 1,923 B |
| `diffRules`, `diffClauses`, `flattenPredicate`, `toRulesMap` | 5,577 B | 2,012 B |
| `predict` (959 B over the engine's share) | 7,453 B | 2,837 B |
| The replay tools (1,528 B over the engine's share) | 12,248 B | 4,082 B |
| `sweepUnder`, `MAX_SWEEP_POINTS` (1,960 B over the engine's share) | 12,797 B | 4,474 B |
| `validatePredicate`, `validatePredicateAgainstSchema` | 6,651 B | 2,368 B |
| **Every tool, in one bundle** | 51,740 B | **14,164 B** |
| **All of L11 (every tool, the engine's share and `hashObject`), in one bundle** | 53,986 B | **14,879 B** |

**Reading the table:** an app that imports one compiler pays about 1.7 to 1.9 KB for it; one that imports `replayUnder` pays about 1.5 KB beyond the engine's share it already has. All of the tools beyond the engine's share are 10,946 B, measured directly as one bundle with `predicate.ts` left external (the review's `all-tools-overEngine`); the difference of two bundles, 11.3 KB, overstated it by about 0.3 KB.

**How much of 1.35's size a port pays.** Three layers are measured. L7 landed at 0.61 of 1.35's isolated bytes, 12% over its first cap. L8 landed at 0.88, 26% above its high estimate. L9 landed at 0.87 (+2,943 B against 3.4 KB), 9% above its middle estimate, at 98% of its cap, and its seam 35% over its sketch. **L7, L8 and L9 each landed above an estimate made for it.** L10 is not built.

| Estimate | Basis | `minimal` grows by |
|---|---|---|
| What core-next lacks of the engine side | 5.1 KB less the 0.3 KB it has | about 4.8 KB of 1.35's bytes |
| Low | 4.8 KB at L7's 0.61 | about 2.9 KB |
| Middle | 4.8 KB at L9's 0.87 | about 4.2 KB |
| **The target (the middle)** | 4.8 KB at L9's 0.87. (bt) is declined, so no walker is folded in (revision 1 took 0.3 KB off for it); the operator list and `$changed` walker are reused, and already counted in the 0.3 KB | **about 4.2 KB** |
| High | 4.8 KB at 1.0: a straight copy, no gain from sharing one gzip stream | about 4.8 KB |
| The earlier misses repeated | The target at L9's +9%, L7's +12%, L8's +26% | 4.6, 4.7 and 5.3 KB |
| The seam on `floor` | Sketched by the review (`size-sketch.log`): +78 B on `floor`, +61 B on `minimal`; at L9's 35% overshoot | about +105 B on `floor` |
| (bp) stateless regex | Reasoned: one copy at registration | +20 to 40 B |
| (bq) refuse a combinator with siblings | Reasoned: the check and a production message | +40 to 80 B |
| (br) warn on a derivation name | Development only | 0 B in production |
| (bs) throw on an unknown operator | Reasoned: a production message. Recommended decline, so not in the estimate | +60 to 100 B |
| (bt) one walk, declined | The second walker stays; no saving | 0 B |
| The tools, on `full-entry` only | 10,946 B measured directly (one bundle, `predicate.ts` external): pure functions, ported as code | about 10.5 to 11.0 KB |

**Reading the table:** the plan's +3.5 KB is between the low and the middle. The tools are not in it: they cost more than twice the engine side, and only `full-entry` and apps that import them pay it.

**The basis for +4.8 KB.** It is the high estimate: a straight copy of the 4.8 KB core-next lacks, with no saving from sharing a gzip stream with the engine. With the target at 4.2 KB, it covers a repeat of L9's and L7's misses (4.6 and 4.7 KB) and not of L8's (5.3 KB). I would not raise it on a guess: a larger cap is a larger allowance to spend. **L11a's target is 4.2 KB**, and its PR reports the seam's bytes and the part's against the target and the cap before L11b starts.

| Fixture | Cap (post-L10 plus) | At most, if L10 lands at its target | At most, if L10 lands at its cap |
|---|---|---|---|
| `minimal` | +4.8 KB | 44,182 B | 45,082 B |
| `two-module` | +4.8 KB | 44,273 B | 45,173 B |
| `aperture` | +4.8 KB | 49,050 B | 49,950 B |
| `full-entry` | +16.0 KB: the engine cap, the seam and the tools' 11.0 KB, rounded up | 57,651 B | 58,551 B |
| `floor` | +150 B | 11,422 B (L10's cap, +250 B, included) | |

The cap is a difference over the size L10 merges at; the L11-gate re-reads that base. `floor`'s cap is the review's sketch (78 B) at L9's 35% overshoot (about 105 B), plus a margin; the seam is sketched and not built, and L11a's first commit measures it and comes back if it is over +150 B. The `full-entry` cap is `+4.8 KB + 11.0 KB`, rounded up.

**What each tool costs, the `full-entry` lump split.** An app that imports one tool already carries the engine's share, so the cost to it is the tool over that share. Measured by the review's `measure.mjs` (esbuild 0.27.7, production, minified, gzip 9 by node zlib; each tool bundled with `predicate.ts` left external; `$S/size/size.log`):

| Tool | Over the engine's share (gzip) |
|---|---|
| `predicateToSQL`, `predicateToWhere` | 1,964 B |
| `predicateToMongo` | 1,713 B |
| `predicateToPostgrest` | 1,888 B |
| (the three compilers together) | 3,817 B |
| `describePredicate` | 1,992 B |
| `predicateHash` (with `hashObject`) | 604 B |
| `doctor` | 1,923 B |
| `diffRules`, `diffClauses`, `flattenPredicate`, `toRulesMap` | 2,012 B |
| `predict` | 959 B |
| `replayUnder` and the replay helpers | 1,528 B |
| `sweepUnder`, `MAX_SWEEP_POINTS` | 1,960 B |
| `validatePredicate`, `validatePredicateAgainstSchema` | 105 B |
| **Every tool, in one bundle** | **10,946 B** |

**Reading the table:** the rows sum to 16,648 B, more than the 10,946 B of the whole set, because each tool carries its own copy of the helpers it shares with the others. So a row is the most a single tool costs, and an app that imports two pays less than the sum. `full-entry` pays the 10,946 B. The review quoted 10,990 B for the same bundle (the `gzip -9` command, which counts a little differently from node zlib); this RFC uses node zlib throughout.

**Under "Keep the order".** Every `createSystem` build carries the evaluator until the beta, whether or not it uses a data form. At the beta, data forms can become an import (`predicates()`), and an app that skips it drops all but the seam: about 4.2 KB at the target, the seam's roughly 105 B staying. The tools cost an app nothing until it imports one, now and at the beta. Whether the alphas should make that import now is O3, which is the owner's.

## What the plan got wrong, or left out

- **The tools are not in "+3.5 KB".** They are 11.0 KB of 1.35's bytes, more than twice the engine side, and they are paid only by apps that import them. The row's budget fits the engine side's middle estimate, not the layer.
- **"Opt-in" holds for the tools and not for the data forms.** A 1.35 constraint written as data must fire with no import, so the evaluator is in every `createSystem` build until the beta.
- **Nothing is a subpath.** In 1.35 every L11 tool is a root export, and two helpers are in `/internals`. Tree-shaking already keeps an unused tool out of an app.
- **"Compilers" is three of six data forms short.** The engine side is six data forms (`when`, `on`, `compute`, `patch`, list `key`, namespacing), not only `when`. 1.35 interprets predicates; it compiles nothing but the SQL, Mongo and PostgREST text.
- **1.35's own evaluator tests are not in the oracle** (U14), and 15 namespaced data-form tests sit at L13 for a flush helper (U15).
- **Four silent rule failures** in 1.35's evaluator (E5, E6, E9, E10) were not on any list; each is a candidate row.
- **The data forms depend on L10 in five tests** (register, assign, unregister a gated effect or a data-form derivation), so L11 cannot gate before L10.
- **The plan's +6.5 KB for L12 mostly does not reach the minimal app.** The plugins are a separate import (A1 gives the check). The part of L12 that every build carries is the distributable-snapshot methods, and the L12 RFC should split the 6.5 KB the way this one splits L11.
- **The alpha minimal app reaches 1.35's size by L11 or L12 if nothing is trimmed.** The alphas keep 1.35's API, so `createSystem` wires every built feature; the beta line is the size story (A1).

## Decisions for the owner

**Questions for Jason.** Ten answers settle L11. Nine are taken under the owner's instruction, and O3 is left for him. The table after them gives each a product verdict, so Jason can bulk-approve.

1. **A1, the L11 size.** O1: the evaluator in a part wired by `createSystem`, the tools as root exports; up to +4.8 KB (target 4.2 KB) on `minimal`, `two-module` and `aperture` over their post-L10 size, +16.0 KB on `full-entry`, +150 B on `floor`, with a lazy seam. **Recommend: approve.**
2. **A2, do deep fuzz runs gate L11, or report?** **Recommend: "Gate on short seeds; deep runs report"**, as at L8 to L10.
3. **A3, fuzz-ready before the gate.** **Recommend: approve L8's brakes unchanged**, with the L10 gate as the precondition.
4. **(bp), a global or sticky regex in `$matches` works inside a system.** **Recommend: approve**, at registration only; a direct call keeps 1.35's answer.
5. **(bq), a combinator beside a fact key is refused at registration.** **Recommend: approve.**
6. **(br), a data form that names a derivation warns in development.** **Recommend: approve.**
7. **(bs), an unknown operator throws at registration.** **Recommend: decline.**
8. **(bt), a data form is walked once per pass.** **Recommend: decline.** One walk cannot keep both of 1.35's behaviours (E11).
9. **B1 to B5.** **Recommend: approve.**
10. **O3, `predicates()` as an import in the alphas.** **Recommend: keep the order.** Not taken; for the owner.

A "no", or no answer yet, means the slice keeps 1.35's behaviour, pins it with a core-next test, and writes no entry.

| Decision | Product verdict | Recommendation | Option taken |
|---|---|---|---|
| **A1** the evaluator in a part, the tools as root exports, and the L11 budgets | Same behaviour; every `createSystem` build grows by an estimated 2.9 to 4.8 KB, most likely 4.2 KB, until the beta; an app pays for a tool only if it imports it; the alpha minimal app ends within 4.2 KB of 1.35's | Approve: +4.8 KB (target 4.2 KB) on three fixtures, +16.0 KB on `full-entry`, +150 B on `floor`; come back above that | **Approved** under the owner's instruction: O1, the caps as recommended |
| **A2** deep runs report, short seeds gate | No behaviour change; decides when L11 can merge | "Gate on short seeds; deep runs report" | **Taken**: gate on short seeds; deep runs report |
| **A3** fuzz-ready before the gate | No behaviour change; bounds the gate's cost | Approve | **Taken**: approve |
| **O3** `predicates()` as an import in the alphas | A 1.35 constraint written as data stops firing without the import; apps without data forms are about 5 KB smaller; the alpha stops matching 1.35's API | Keep the order | **Not taken** under the owner's blanket instruction: it reverses his own decision "Keep the order (Recommended)" (2026-11-05). For the owner |
| **(bp)** `$matches` tests a stateless copy of its regex, at registration | Better, rare but silent: a rule written with `/…/g` fires inside a system when it should; in 1.35 it never fires, and the error is skipped silently in production. A direct `evaluatePredicate`, `memoizePredicate` and the tools still alternate, as in 1.35, and a test pins it | Approve, in L11a, at registration only | **Taken**: approve, in L11a, at registration only |
| **(bq)** `{ $any: […], phase: "green" }` is refused at `createSystem`, with the compilers' message | Better, visible: a rule that silently ignored half its conditions now fails at start-up with the fix in the message, and means the same thing on the client and in SQL. A program that relied on the ignored key, knowingly or not, now throws | Approve, in L11a; the exported `evaluatePredicate` keeps 1.35's answer | **Taken**: approve, in L11a, at registration only |
| **(br)** a data-form `when` or `on` that names a derivation warns in development | Better, development only: the author learns why the rule never fires. No production bytes, no change in production | Approve, in L11a | **Taken**: approve, in L11a |
| **(bs)** an unknown operator throws at `createSystem` | Better, visible: a typo fails at start-up in production too. Costs a production string, and turns a silent never-firing rule into a crash for a deployed app | Decline; development already warns, as at (bj); pin 1.35 (U4) | **Taken**: decline; pin 1.35 (U4); no entry |
| **(bt)** one walk per evaluation, recording clauses only while something listens | Worse for users if built: one walk either short-circuits, so `whenExplain` is partial, or tracks every clause, so the dependency set, the `constraint.evaluate` records and L9's trace `deps` change. 1.35's two evaluations keep both | Decline: keep 1.35's two evaluations; pin them (U17) | **Taken**: decline; pin 1.35 (U17); no entry |
| **B1** the fuzz additions and harness rules 1 and 2 | No behaviour change | Approve | **Taken**: approve |
| **B2** the oracle's L11 tests: the white-box splits (U14) and the namespaced placement (U15) | No behaviour change | Approve | **Taken**: approve |
| **B3** a `data-form-100` workload | No behaviour change | Approve | **Taken**: approve |
| **B4** signing for approved rows | No behaviour change; the census needs signed entries | Approve | **Taken**: approve |
| **B5** L9-pre-a merges before L11-pre | No behaviour change; a placement | Approve | **Taken**: approve |

*"Owner instruction 2026-11-15: 'I approve you for to do everything'. Under it, Claude takes each recommended option below, except O3. The owner may overrule any of them."*

### A. Decisions

#### A1 where L11 lives, and the L11 budgets

- **What 1.35 does.** The data forms work with no import, so the evaluator is in every `createSystem` build. The tools are root exports; tree-shaking keeps an unused one out of an app.
- **What 2.0 would do.** `withPredicates`, a part wired by `createSystem`, fills hooks in the constraints, effects, events and resolvers parts and one slot in the core (the seam, read lazily at the first compute). The ten tool files are root exports, as 1.35's.
- **The measured basis.** The engine side is about 5.1 KB of 1.35's bytes, 0.3 KB of it already in core-next; the tools are 11.0 KB more (Size). L7, L8 and L9 each landed above an estimate made for it.
- **Product verdict.** Same behaviour. `minimal` grows from its post-L10 size by about 4.2 KB, at most 4.8 KB.
- **Recommendation.** Approve O1 and a raise with a written reason in each slice: +4.8 KB over the post-L10 size on `minimal`, `two-module` and `aperture` (target 4.2 KB), +16.0 KB on `full-entry`, +150 B on `floor`. Do the attribution step first: find the bytes, move cold code, fold duplicates. Come back if a slice lands above a cap, and before L11b if L11a is on course to.
- **The size story.** The review's projection, in bytes after each layer (the L10 row is the L10 RFC's target and cap):

  | After | `minimal`, target / cap | `aperture`, target / cap | `minimal` beta line |
  |---|---|---|---|
  | L9b (now) | 35,282 | 40,150 | 27,956, or 26,505 with #399 |
  | L10 | 39,382 / 40,282 | 44,250 / 45,150 | about 28.2 KB |
  | L11 | 43,382 / 45,082 | 48,250 / 49,950 | about 28.3 KB |

  The target column is the review's, at 4.0 KB for L11. With (bt) declined, the target to report against is 4.2 KB: 43,582 B on `minimal` and 48,450 B on `aperture`. The caps do not move. The beta figures are the review's, from 27,956 B; PR #399's correction takes about 1.45 KB off each (27,956 less 26,505).
- **Said plainly.** The alphas keep 1.35's API, so `createSystem` wires every built feature, and the alpha minimal app approaches 1.35's 49,313 B by L11 or L12: at L11's cap it is 45,082 B, 4,231 B (about 9%) under, and `aperture`'s cap is 49,950 B against 1.35's 53,871 B. The beta line, which leaves out the opt-in parts, stays about 43% under 1.35 (about 28.3 KB against 49,313 B), provided each layer's part joins the beta list. L11a's done-means adds `withPredicates` to it; the review found L9's `withTrace` missing, which PR #399 fixes.
- **L12's +6.5 KB, checked against how 1.35 ships plugins. Read, not measured.** The plugins are a separate import. `packages/core/package.json` exports `./plugins` (`dist/<mode>/plugins/index.js`) beside the root, and `sideEffects` is `false`. Nothing in `src/core/` or the root `index.ts` imports a plugin to run it (`grep 'from "../plugins"'` over `src/core/*.ts` and `src/index.ts`: no matches); the root only re-exports L12's names (`index.ts:217–220, 299, 356–372`). core-next has `./plugins` too, with `persistence.ts` and an index; `full-entry` bundles `./plugins/index.ts` (`size.mjs:396`), and `aperture` imports only persistence. So the plugin code (logging, devtools, performance, circuit breaker, the audit ledger and the rest) reaches `full-entry` and an app that imports one, and reaches `minimal`, `two-module`, `floor` and `aperture` not at all. What L12 does put in every build is engine side: `getDistributableSnapshot` and `watchDistributableSnapshot` (in 1.35's `engine.ts`, stubbed at L12 in core-next's `missing.ts:68`). I did not measure that part; the L12 RFC should split the 6.5 KB the way this one splits L11, into the engine side and the plugins.
- **Option taken.** The recommended one.

#### A2 do deep fuzz runs gate L11, or report?

- **What L8 to L10 chose.** "Gate on short seeds; deep runs report".
- **Why L11 is no different.** Once drawn, a data form is the same constraint the fuzz already compares, written another way, so the deep runs will mostly find new shapes of approved rows.
- **Recommendation.** The L8 answer: the gate merges when the 21 PR seeds pass at L11; nightly deep runs report; a case triaged as a real 2.0 bug blocks at once.
- **Option taken.** "Gate on short seeds; deep runs report".

#### A3 fuzz-ready before the gate

- **What L8 chose.** L8-pre leaves at most 10 unexplained cases; the gate is capped at 3 runs, then goes to Jason; case files store v2's trace; earlier follow-ups land first.
- **What L11 adds.** Nothing. With (bt) declined, development warnings are compared exactly, as at L8 to L10.
- **Recommendation.** Approve L8's brakes unchanged, with the L10 gate as the precondition.
- **Option taken.** Approved, as L8's brakes.

#### O3 `predicates()` as an import in the alphas

*Not taken under the owner's blanket instruction: it reverses his own decision "Keep the order (Recommended)" (2026-11-05). For the owner.*

- **What 1.35 does.** A constraint written as `when: { phase: "red" }` works with no import.
- **What 2.0 would do.** `createSystem` would wire no evaluator in the alphas. An app that writes a data form would import `predicates()` and pass it, as it will at the beta.
- **What it buys.** Apps without data forms pay about 5 KB less (the engine side is 5.1 KB of 1.35's bytes, 4.2 KB at the target; the seam stays).
- **What it costs.** The alpha stops matching 1.35's API, and the oracle harness must wire `predicates()` per engine, on v2 only. The tests and scenarios that would need that change: the review counts 14 engine tests, 9 `data-forms` tests and 15 namespaced tests, and 3 diff scenarios ("data-form when, on and comparison operators" and the two `on` gates).
- **Recommendation.** Keep the order. The beta line is the shipped size story, and it already leaves the evaluator out; the alpha crossover is stated in A1.
- **Option taken.** None. Not taken; for the owner.

### Candidate divergences

#### (bp) a global or sticky regex in `$matches` works

- **What 1.35 does.** Registration deep-freezes the spec, the regex included. `test()` on a `g` or `y` regex writes `lastIndex`, which a frozen regex refuses, so every evaluation throws "Cannot assign to read only property 'lastIndex'" and the rule never fires. By default the error is skipped silently; development warns. Called directly on an unfrozen regex, `evaluatePredicate` alternates true and false (E10, Q4 to Q4c).
- **What 2.0 would do.** At registration, keep a copy of each `$matches` regex without the `g` and `y` flags and test with it; `whenSpec` still returns the caller's object. **The row is scoped to registration, because that is all the design fixes.** A direct `evaluatePredicate`, `memoizePredicate`, and the tools that call them (`predict`, `replayUnder`, `sweepUnder`) keep 1.35's alternating answer for a `g` regex, and U1 pins that half too.
- **The wider option, not recommended.** Make the evaluator itself stateless: the operator tests a copy of the regex kept per regex in a `WeakMap`, so a direct call is stable as well. Cost, reasoned: about +40 to 80 B, against +20 to 40 B for registration only, because the map sits on the shared path; and it changes what three exported functions and the tools return from 1.35's, so the diff's tool scenarios see it and the row would need a tool-side test rule. Against it: the silent never-fires rule inside a system is the failure that matters, and a direct caller holds the regex and can drop the flag.
- **Product verdict.** Better, rare but silent: a rule written with `/…/g` fires inside a system when it should. A direct call still alternates, as in 1.35.
- **Recommendation.** Approve, in L11a, at registration only.
- **Option taken.** Approved, at registration only.

#### (bq) a combinator beside a fact key is refused at registration

- **What 1.35 does.** In `{ $any: [{ n: 1 }], phase: "green" }`, the runtime returns the `$any` result and never reads `phase`; `describePredicate` says "n is 1"; `predicateToSQL`, `predicateToMongo` and `predicateToPostgrest` throw "$any cannot coexist with sibling keys (phase) — wrap them in $all together, or move them inside the $any children"; `validatePredicate` accepts it (E5, Q3, Q23).
- **What 2.0 would do.** A data form given to `createSystem` (or to `register`, at L10) with a combinator beside other keys throws the compilers' message, in both modes. The exported `evaluatePredicate` and `describePredicate` keep 1.35's answers, so only the engine changes.
- **The alternative, rejected.** AND the siblings with the combinator. It reads more naturally, but the compilers would still refuse the predicate, so the client and the server would still disagree.
- **Product verdict.** Better, visible: the rule means one thing everywhere. A program with such a rule fails at start-up, where 1.35 ran it on half its conditions.
- **Recommendation.** Approve, in L11a.
- **Option taken.** Approved, at registration only.

#### (br) a data form that names a derivation warns in development

- **What 1.35 does.** A data-form `when` reads the facts proxy and an `on` reads the facts snapshot; neither sees derivations, so `{ dbl: { $gte: 4 } }` compares `undefined` and never passes, with no warning in either mode (E9, Q1, Q10).
- **What 2.0 would do.** At registration, in development, warn once for each key that is a derivation and not a fact, and name the fix: a function-form `when`, or a derivation over the facts.
- **The alternative, rejected.** Let data forms read derivations. It changes what every existing data form means, and the compilers have no derivations to read.
- **Product verdict.** Better, development only; production is unchanged.
- **Recommendation.** Approve, in L11a.
- **Option taken.** Approved.

#### (bs) an unknown operator throws at registration

- **What 1.35 does.** `{ n: { $gtee: 1 } }` never passes; development warns on every evaluation; production is silent; `validatePredicate` and `isPredicate` accept it (E6, Q2, Q17).
- **What 2.0 would do.** Throw at `createSystem` in both modes.
- **Product verdict.** Better, visible, but a deployed app with a typo crashes at start-up where it ran with one dead rule.
- **Recommendation.** Decline. Development already says it on every pass, and the throw costs a production string. Pin 1.35 (U4); revisit at the beta with `validatePredicate`.
- **Option taken.** Declined: keep 1.35's behaviour and pin it (U4). No entry.

#### (bt) a data form is walked once per pass

- **What 1.35 does.** With any plugin installed, each evaluation of a data form is run twice. `evaluatePredicate` short-circuits inside `withTracking` (`predicate.ts:1153–1176`, `constraints.ts:831`). Then `evaluatePredicateExplained` runs at `onEvaluate` (`constraints.ts:861`), untracked and over every clause, for `whenExplain` (E11). With no plugin, once. A development warning inside the predicate prints twice.
- **What revision 1 proposed.** One walk that records the clauses only while a plugin or observer listens.
- **Why it cannot be built as written.** A single walk must choose. If it short-circuits, `whenExplain` is partial. If it visits and tracks every clause, the constraint has more dependencies, so it re-evaluates more often and emits more `constraint.evaluate` records, and L9's trace carries different `deps`. Neither keeps both of 1.35's behaviours, so (bt) is not "same for users".
- **Product verdict.** Worse for users if built: a partial breakdown, or a wider dependency set and a different trace. No gain a user can see; the saving is about 0.3 KB and half a walk.
- **Recommendation.** Decline. Keep 1.35's two evaluations and pin them (U17). The size target returns to 4.2 KB; harness rule 1 (warnings as a set) is dropped, and I4 and E11 say what the trace sees.
- **Option taken.** Declined: keep 1.35's behaviour and pin it (U17). No entry.

### B. Recommendations the owner may overrule

#### B1 the fuzz additions and harness rules

- **Recommendation.** In L11-pre, on L10-pre's model: draw data-form `when`, `on`, `compute`, an event `patch` and a resolver list `key` (and their namespaced forms), a `$changed` gate with a restore, add the `tools` op, and rules 1 and 2, each with a self-test. They run on 1.35 from L11-pre, and on v2 only once `current` is L11.

#### B2 the oracle's L11 tests

- **Recommendation.** In L11-pre: port the black-box cases of `predicate.test.ts`, `predicate-describe.test.ts` and `sweep-under.test.ts` as `WHITE-BOX.md:28, 30–32` say, the way `meta.test.ts` was split at L9 (U14), and give `data-forms-namespaced.test.ts` `instruments: ["import flushMicrotasks"]` (U15).

#### B3 the `data-form-100` workload

- **Recommendation.** 100 data-form constraints and one write that re-evaluates all, with and without a plugin; time, judged at 1.0 or better against 1.35. Approve the shape before L11a.

#### B4 signing

- **Recommendation.** L11a signs the entries for approved rows "on the owner's instruction", as at L2, L3 and L7 to L10 (GATE-2 rule 1). Declined rows get no entry.

#### B5 L9-pre-a first

- **Recommendation.** L9-pre-a's placement of `data-forms.test.ts` merges before L11-pre, so the nine tests it moves are in L11's count when L11-pre writes its predictions.

### C. Engineering defaults that keep parity (no decision needed)

- **Predicates are interpreted, not compiled**, and cached per spec object, as 1.35.
- **A data-form `when` drops explicit `deps` and `async`**, with 1.35's two development warnings (U9).
- **The spec is deep-frozen at registration**, and `whenSpec` is the caller's object (U5).
- **The operators keep 1.35's edges**: no type mixing in comparisons, `$exists` true for `null`, string coercion in `$startsWith` (U6, U11).
- **Past depth 64 the cut part is false**, with 1.35's development warning (U8).
- **`$changed` in an `on` fires on the first run** (U10); in a constraint it throws at registration (built).
- **Unknown operators and two-operator objects warn per evaluation in development**, as 1.35, and the count is compared exactly.
- **`validatePredicateAgainstSchema` takes the kind map**, and throws as 1.35 does when given a schema (U12).
- **The tools keep 1.35's messages, limits (`MAX_REPLAY_FRAMES` 1,000,000, `MAX_SWEEP_POINTS` 10,000) and output shapes.**

## Evidence: probes

**What I ran.** Each command's output went to a file, and I read the files back, not a pipe. `$S` below is `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l11`.

- Forced-L11 runs (commands in "Gap analysis"): `$S/v2.json`, `$S/v2dist.json`, `$S/diff.json`; summaries from `node summ.mjs` and `node diffsumm.mjs` (exit 0) in `$S/v2-summ.txt`, `$S/v2dist-summ.txt`, `$S/diff-summ.txt`; the L11 failures in `$S/v2-l11fails.txt`; the pass and fail count of each L11-placed test in `$S/l11pass.txt`; the diff details in `$S/diff-l11-detail.txt`. `$S/runs.txt` holds the three exit codes (1, 1, 1).
- Placements: `node l11tests.mjs layers.json` (exit 0) in `$S/l11tests.txt`; the same on `git show origin/p9/l9-pre-a:packages/conformance/layers.json` in `$S/l11tests-prea.txt`; the data-forms placements in `$S/dataforms-place.txt`.
- Census: `pnpm census` (exit 0) in `$S/census.log`, line 2529; the 47 names from `npx tsx $S/tsx/unbuilt.ts` (exit 0) in `$S/unbuilt.txt`.
- Exports of the published 1.35: `node exports.mjs` (exit 0) in `$S/exports-v1.txt` and `$S/v1-root.txt`; core-next's root in `$S/v2-root.txt`.
- Mutation: `gh run list --workflow mutation-nightly.yml` in `$S/mut-runs.json`; `gh run view 43815165003 --log` in `$S/mut-43815165003.txt`; the triage counts by `node -e` in `$S/triage.txt` and `$S/triage2.txt`.
- Size: `node measure.mjs ~/dev/directive2-l11rfc` and `node measure2.mjs …` (exit 0) in `$S/size/size.log` and `$S/size/size2.log`; the call sites by `node lift.mjs …` (exit 0) in `$S/size/sites.log`, each bundle beside it as `*.min.js`; tree-shaking by `node shake.mjs …` (exit 0) in `$S/size/shake.log`; core-next's fixtures by `node scripts/size.mjs --check` (exit 0) in `$S/next-size.log`.
- Probes: `node probe.mjs <dist> <out.json>` in `$S/probe/`, against `packages/conformance/node_modules/directive-v1/dist/development` and `dist/production` (`1.35.0`), exit 0 in both. Output: `$S/probe/out-dev.json` and `$S/probe/out-prod.json`, compared key by key in `$S/probe/summary.txt` and `$S/probe/summary2.txt`. The first run's system had a fact the schema check rejected in development; the second run (the files named) dropped it, and the results below are the second run's.

**What I ran for revision 2.** `sed -n` and `grep -n` on `packages/core-next/src/api/core.ts` (`defsOf` at 502, the parts loop at 1935, the seam site 400–420), on `packages/core/src/core/constraints.ts`, `predicate.ts`, `effects.ts`, `derivations.ts` and `engine.ts` (the ranges cited in E11 and R1 to R5), and on `packages/core-next/scripts/size.mjs` (the beta list at 544; the fixtures at 396 and 636–656), each exit 0. A `python3` read of `packages/core/package.json` and `packages/core-next/package.json` `exports` (exit 0), and `grep -n 'from "../plugins"' src/core/*.ts src/index.ts` in `packages/core` (no matches). `gzip -9 -c` over `$S/size/*.min.js`, and `grep overEngine` over `$S/size/size.log` and `size2.log`, for the per-tool bytes. `$S/review/size-sketch.log`, the review's `node scripts/size.mjs --check` with the lazy seam sketched in (exit 1, because each fixture was 47 to 73 B over its budget, which is the finding): `floor` 11,100 B, `minimal` 35,343 B, `two-module` 35,430 B, `aperture` 40,219 B, `full-entry` 37,621 B, minimal beta line 28,033 B. `layers.rules.json` lines 349–354 on this tree and on `origin/p9/l9-pre-a`.

**What I read, not ran.** The 1.35 line citations in "The design" (`packages/core/src/core/`); core-next's citations (`packages/core-next/src/api/`); the template rules (U16); the double walk (E11, `engine.ts:1248–1256`); the 0.3 KB core-next already carries; and, for revision 2: R1 to R5, which are read from the cited lines and not probed (U18 is the probe to run); the L12 plugin entry (the `exports` read above is run, the conclusion from it is reasoned); and the lazy seam's cost, taken from the review's sketch and not from a built seam.

Every probe's system is one module, `m`: facts `n` (number, 0), `phase` (string, "red") and `s` (string, "a"); a derivation `dbl` (`n * 2`); a requirement `GO` and an async resolver; a plugin that records `onError`. Development and production gave the same results except where a row says so.

| Probe | Steps | 1.35 |
|---|---|---|
| Q1 | `when: { dbl: { $gte: 4 } }`; `n = 2` | `dbl` reads 4; the constraint inactive, 0 hits; no warning in either mode |
| Q2 | `when: { n: { $gtee: 1 } }`; `n = 5` | Inactive. Development: "unknown operator "$gtee" — looks like a typo", once per evaluation; production silent |
| Q3 | `when: { $any: [{ n: 1 }], phase: "green" }`; `n = 1`, `phase` "red" | Active. `evaluatePredicate` of the same, and of the `$all` form, gives true |
| Q4 | `evaluatePredicate({ s: { $matches: /a/g } }, { s: "a" })` four times; `memoizePredicate` three times | `true, false, true, false`; `true, false, true` |
| Q4b, Q4c | `when: { s: { $matches: /a/g } }`; three passes | Inactive every pass; `onError` "Cannot assign to read only property 'lastIndex' of object '[object RegExp]'"; development also warns "The default error strategy skips it silently" |
| Q5 | A spec with an operator object and a nested array; `createSystem` | All three frozen |
| Q6 | `$gte` with `"5"` against 10, `5` against `"10"`, `Date(0)` against `Date(5)`, `0` against `Date(5)`, `1n` against 2; `$lte: NaN` | `false, false, true, true, false, false` |
| Q7 | `{ n: { $gte: 1, $lte: 5 } }` at 3 and 9 | `true`, `false`; development warns "operator object has 2 operators" per evaluation |
| Q8 | 140 `$not`s over `{ n: 1 }`; 2 `$not`s | `true` and `true`; development warns "predicate depth limit (64) exceeded" |
| Q9 | `when: { n: 1 }` with `deps: ["phase"]`, `async: true` | Fires; `async` false, `when` a function. Development warns "data `when` is always sync" and "cannot be combined with explicit `deps`" |
| Q10 | Effects `on: { dbl: { $gte: 4 } }` and `on: { n: { $changed: true } }`; start; `n = 2` | `byDerived` never ran; `changed` ran on start and after the write |
| Q11 | `predicateToSQL` of `{ phase: "red", elapsed: { $gte: 30 }, name: { $startsWith: "o'b%" } }`; a column `a;drop`; `$matches`; `$changed`. `predicateToMongo` of a predicate with `$any` beside fields | `(phase = $1 AND elapsed >= $2 AND name LIKE $3 \|\| '%' ESCAPE '\')`, params `["red", 30, "o'b\\%"]`; "invalid column identifier"; `s ~ $1`; "$changed is an effects-only operator". Mongo: "$any cannot coexist with sibling keys (phase, elapsed)" |
| Q12 | `predicateHash` | Order-independent; `{ a: undefined }` differs from `{}`; `/a/` and `/b/` differ; dates differ; `{ phase: "red" }` gives `943c285` |
| Q13 | `describePredicate` | "phase is red AND elapsed is at least 30"; "(n is 1) OR (n is one of 2, 3)" |
| Q14 | `predict({ phase: "red", elapsed: { $gte: 30 } }, { phase: "green", elapsed: 10 })` | `wouldFire` false; two failing rows; suggestions "set phase to "red" (currently "green")" and "set elapsed to at least 30 (currently 10)" |
| Q15 | `doctor.checkAgainst({ n: { $lt: 5 } }, …)` against `$gte 10` and `$gte 1` | A direct contradiction, "Candidate caps n at < 5 but an existing rule requires it ≥ 10."; an overlap warning |
| Q16 | `validatePredicateAgainstSchema(spec, { facts })`; then with `getSchemaFieldKinds` | Development "kindMap.get is not a function", production "n.get is not a function"; with the kind map (a `Map`), `{ ok: true }` |
| Q17 | `validatePredicate({ n: { $gtee: 1 } })`; `isPredicate` of it | No throw (development warns); `true` |
| Q18 | `$exists: true` on `null` and `undefined`; `$in: 1`; `$startsWith: undefined` on "undefined!" | `true, false, false, true` |
| Q19 | `inspect().constraints[0].whenSpec === spec` | `true` |
| Q20 | `diffRules` of `c: $gte 10` to `c: $gte 20` plus a new `d` | `c` changed, `n` tightened; `d` added; summary 1 added, 1 changed, 2 clause changes |
| Q21 | `replayUnder` over `n` 1, 5, 12, original `$gte 10`, proposed `$gte 4` | 3 frames; 1 and 2 matched; one new match (`n` 5) with both breakdowns |
| Q22 | `compute: { n: { $gte: 3 } }` and `compute: { $template: "Hi ${name} (${n})" }` | `true`; "Hi Ann (5)" |
| Q23 | The Q3 predicate through `predicateToSQL`, `predicateToPostgrest`, `describePredicate`, `validatePredicate`, `evaluatePredicateExplained` | Both compilers throw "$any cannot coexist with sibling keys (phase)"; describe "n is 1"; validate no throw; the breakdown has only the `$any` row |
| Q24 | `validatePredicateAgainstSchema` with `{ n: { $startsWith: "a" } }` and `{ zz: 1 }` | "Operator "$startsWith" is not allowed on fact "n" of kind "number"", with the allowed list; "Unknown fact "zz" — not in schema." |

**Reading the table:** Q4 to Q4c are (bp), Q3 and Q23 are (bq), Q1 and Q10 are (br), Q2 and Q17 are (bs). The output files key each probe by these names.
