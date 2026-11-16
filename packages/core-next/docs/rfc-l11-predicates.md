# RFC: L11 predicates and rule tools

Status: draft for review, revision 1. No engine or oracle code merges from this document.
Tree: branch `p11/l11-rfc`, cut from `main` at `1ffe8cad` (L0 to L7 gated; L8 built, its gate waiting on one owner signature; L9a and L9b merged, the L9 gate after L8's; L10's RFC is PR #396, revision 2; `layers.rules.json` `current` is `"L7"`). Nothing in `packages/conformance` or `packages/core-next/src` is changed by this PR.

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

**In plain terms:** today a constraint written as `{ phase: "red" }` never fires on 2.0, and every predicate tool is missing. L11a builds the evaluator into the engine; L11b ports the tools. The probes found four 1.35 behaviours a user could notice and might want changed: a global regex in `$matches` makes its rule never fire; a combinator beside a fact key ignores the fact key at run time while the SQL, Mongo and PostgREST compilers refuse the same predicate; a data form that names a derivation silently never matches; and a misspelled operator warns on every evaluation and never matches. They are the candidate rows (bp) to (bs). A fifth row, (bt), evaluates a predicate once per pass instead of twice. The size is an owner decision (A1).

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

**Placements that are not on `main` yet.** L9-pre-a's U14 (branch `origin/p9/l9-pre-a`, commit `bee00383`, not merged) gives `data-forms.test.ts` `instruments: ["import flushMicrotasks"]` and adds the signal `option resolver key data form` to `lib/layers.ts`. On that branch L11 holds 224 tests: the 215 and 9 `data-forms.test.ts` tests moved from L13 (the data-form `when`, `on`, list `key`, `patch` and `compute`, the three introspection tests, and the handler-and-patch warning). On `main` those 9 sit at L13 with the single reason `import flushMicrotasks`. **`data-forms-namespaced.test.ts` has the same problem and no fix on any branch:** all 15 of its tests sit at L13 for `import flushMicrotasks` alone, and they exercise namespaced data forms, a registered data-form constraint and `abortOn` prefixing (U15).

**1.35's own tests for the evaluator are not ported.** `WHITE-BOX.md:30–32` lists `core/__tests__/predicate.test.ts` (149 tests), `predicate-describe.test.ts` (55) and `sweep-under.test.ts` (20) as "split" at L11: the black-box cases port, the internals stay unit tests. None is ported. So the operators themselves have no oracle file: they are reached only through the engine's data-form tests and the diff scenario (U14).

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
| O3. Data forms only through an import (`predicates()`) | No: a 1.35 constraint with `when: { phase: "red" }` stops firing | Only apps that import it. This is the beta |

**Reading the table:** O2 buys nothing in the alpha, because a tool an app does not import already costs it nothing (verified: bundling 1.35 for a one-module app, importing `predicateToSQL` added 1,371 B gzip, so the plain app did not carry it). O1 keeps the alpha rule.

**The seam.** The core needs one small hook. A data-form `compute` reaches the core, not a part: `core.ts:404–418` builds the derivation functions and already refuses a non-object form. Under O1 the core asks the predicates part, through one hook slot, to turn a predicate or a template into a function, and throws 1.35's message when no part is wired. `floor` (`createSystemCore` with no parts) then pays the slot only. Constraints, effects, events and resolvers are parts already, so their data forms are wired in the part, with no core change. Reasoned, not sketched: +30 to 60 B on `floor`.

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
| E10 | **`$matches` with a global or sticky regex never passes inside a system.** The regex is frozen with the spec (E2), and `RegExp.prototype.test` on a `g` or `y` regex writes `lastIndex`, so it throws "Cannot assign to read only property 'lastIndex'"; the constraint error is skipped silently by default (development warns). Called directly on an unfrozen regex, `evaluatePredicate` alternates true, false, true, false. Verified, Q4 to Q4c. | Without (bp): copied. With (bp): `$matches` tests a stateless copy of the regex, made once at registration. | U1; shows (bp) |
| E11 | **The breakdown.** When any plugin is installed, each data-form evaluation runs the predicate a second time, through `evaluatePredicateExplained`, to hand plugins and observers `whenExplain` (`engine.ts:1248–1256`, `constraints.ts:1809–1818`). With no plugin, once. | Without (bt): copied. With (bt): one walk that records the clauses only when something listens. | U17; shows (bt) |

**Reading the table:** E1 and E2 are why a data form behaves like a function in the reconcile loop: tracking sees the facts it reads, so the loop, `explain()` and the trace need no new path. E5, E6, E9 and E10 are the silent failures: each is a rule that looks right and never, or always, fires.

### The other data forms

| # | 1.35 rule | 2.0 mechanism | Pinned by |
|---|---|---|---|
| D1 | An effect's `on`: its facts become the effect's dependencies (`extractDeps`), the spec is frozen, and the effect runs only when the predicate holds, after the dependency pre-filter, against a facts snapshot; `$changed` compares with the previous snapshot, and on the first run a present value counts as a change. A gate forces the `prevFacts` snapshot even when the body never reads it (`effects.ts:730, 857–888, 960–971`). Verified, Q10: `$changed` ran on start and on the write. | The gate, in the effects part (which already checks the shape). | `blackbox-effects` "data-form on" (7); diff "an `on` predicate gates an effect"; U10 |
| D2 | A derivation's `compute` as a predicate gives a boolean; as `{ $template: "Hi ${name}" }` gives a string, with `$${` for a literal `${`, and a development warning for an unknown key or an unterminated placeholder (`derivations.ts:255–280`, `predicate.ts:1467–1530`). Verified, Q22: `true` and "Hi Ann (5)". | Through the core's hook (the seam), filled by the part. | `mutants-derivations` (2); `data-forms` "derivation compute" (on L9-pre-a's branch) |
| D3 | An event's `patch`: literals, `$ref` copies from the payload, `$template` strings; the spec frozen at registration; a `handler` beside a `patch` wins with a development warning (`engine.ts:151–171`, `applyPatch`). | In the part that wires events. | `data-forms` "event patch", "handler + patch conflict" (L9-pre-a's branch) |
| D4 | A resolver's `key` as a list of field names dedups requirements by those fields (`normalizeResolverKey`, `engine.ts:1215–1229`; `evaluateKeySelector`). | In the resolvers part. | `data-forms` "resolver key" (L9-pre-a's branch) |
| D5 | In a multi-module system every data form is prefixed with its module's namespace; `self` and dependency-namespace pivots are rewritten; keys already prefixed pass through (`system-module-transform.ts:164–230, 336–470`). | In core-next's flattening, which already prefixes function forms. | `l3-proxies-oracle-transform` (3); `data-forms-namespaced` (15, U15) |

### Introspection, the reconcile loop and the trace

**In plain terms:** L9 built the slots; L11 fills them. Nothing else in the loop changes.

| # | 1.35 rule | 2.0 mechanism | Pinned by |
|---|---|---|---|
| I1 | `inspect().constraints[].whenSpec` is the data form, only when there is one. | Built at L9 (`reconcile.ts:691–692`). | L9's U15 |
| I2 | The observer's `constraint.evaluate` event and the `onConstraintEvaluate` hook carry `whenExplain`, a list of `{ path, op, expected, actual, pass }` rows with `children` under a combinator, and only when there is one (`engine.ts:1254–1255, 3042–3051`). Verified at L9 (P21) and here (Q14's rows). | The record gains its `explain` field from the evaluator; `withObserve`'s pass-through is built. | `data-forms` "observe() emits whenExplain" (L9-pre-a's branch) |
| I3 | `explain(requirementId)` prints "Predicate clauses:" with a tick or a cross per clause, combinators indented, values as JSON (`engine.ts:3913–3963`). | The printer, in the predicates part, called from `explain()`. | `data-forms` "explain(requirementId) renders the clause tree"; the 14 `engine.json` triage entries |
| I4 | The reconcile loop, dependency tracking and the trace see a data-form `when` as a function (E1). The trace's constraint `deps` are what it read. `whenExplain` is not in the trace. | Nothing to add. | L9's trace tests |

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
| The evaluator | `src/api/predicate.ts` (new) | `evaluatePredicate` with an optional clause recorder (E11, (bt)), `memoizePredicate`, `isPredicate`, `extractDeps`, `walkPredicate`, templates, `applyPatch`, `evaluateKeySelector`, `validatePredicate`. Reuses the operator list in `schema-introspection.ts:23–57` and the `$changed` walker in `constraints.ts:680–735` |
| `withPredicates` | `src/api/predicate.ts` | Fills the hooks below, and the clause printer for `explain()` (I3) |
| Constraints | `src/api/constraints.ts:117–128, 281–293` | The data-form `when` replaced at registration (E1, E2); `explainWhen` |
| Effects | `src/api/effects.ts:199–206` and the run filter | The `on` gate and its snapshot (D1) |
| Events, resolvers | the parts that wire them | `patch` (D3) and the list `key` (D4) |
| Namespacing | core-next's flattening | Prefix data forms (D5) |
| The record | `src/api/reconcile.ts:126` | An `explain` field on `constraint.evaluate`, only when something listens (I2) |
| **The seam** | `src/api/core.ts:404–418` | One hook slot for a data-form `compute` (D2); 1.35's throw when no part fills it |
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
| Namespaced data forms (D5) | No | The drawn forms in two-module cases |
| The tools (T1 to T10) | No | A `tools` op: at a checkpoint, run `describePredicate`, `predicateHash`, `predict` and `doctor.checkAgainst` over the case's own data forms and facts, on both engines, and record the answers |
| `explain()` and `whenExplain` (I2, I3) | Partly: the recorder keeps every observer event and hook (`diff/hooks.ts`) | Nothing more: once data forms are drawn, they are compared |
| E5, E6, E10 | No | Not drawn: they are the candidate rows, pinned by hand (U1, U2, U4) |

**What the harness compares at L11, and the shapes that are new.** Once a case draws a data form, its `whenExplain` rows reach every `onConstraintEvaluate` and observer event, and `explain()` reaches the recorded text. Compared for the first time: the order of the breakdown's rows (1.35 walks the spec's keys in insertion order); the `actual` values in them; how many times a development warning prints (E6, E7: 1.35 prints once per evaluation, and twice per pass when a plugin is installed, E11); and the namespaced spelling of prefixed keys inside `whenSpec`. Expect the new shapes at the gate as differences of order and of warning counts. With (bt) approved, every warning count differs by design; rule 1 below covers it. This is a prediction from L7 to L9, not a measurement.

**L11-pre's bar.** The 21 PR seeds at forced L11 leave at most 10 unexplained cases. A case is explained if its shrunk form is "data forms not built", "tools not built", or one of L8's, L9's or L10's items.

**Harness rules, decided now.** L8's ten rules and L9's three carry over unchanged. Three are new:

1. **Development warnings from the evaluator are compared as a set per step**, not as a count, when (bt) is approved; otherwise exactly.
2. **The data-form draw and the `tools` op each ship with a self-test**: one where a predicate is flipped on one engine, and one where a tool answer is changed.
3. **The L11-pre exit bar** is L8's (A3).

Whether the deep runs gate L11 is decision A2.

## Untested behaviours, and what will pin each

**In plain terms:** 17 items have no pin at L11. Twelve came from the probes, five from the forced run and from reading the code.

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
| U14 | 1.35's `predicate.test.ts` (149), `predicate-describe.test.ts` (55) and `sweep-under.test.ts` (20) are not ported | `WHITE-BOX.md:30–32` | Split as `WHITE-BOX.md` says: the black-box cases port, the rest stay unit tests | L11-pre |
| U15 | `data-forms-namespaced.test.ts` (15 tests) sits at L13 for `import flushMicrotasks` alone | `layers.json`, read with `node` | `instruments: ["import flushMicrotasks"]` on its rule, as L9-pre-a gave `data-forms.test.ts`; check where each lands (expected L11, two at L10 or L11 for `register`) | L11-pre |
| U16 | A template's `$${` escape and its unknown-key warning | read: `predicate.ts:1467–1530` | Cases in the ported `predicate.test.ts` | L11-pre |
| U17 | With a plugin installed, a data form is evaluated twice per pass; with none, once and with no breakdown | read: `engine.ts:1248–1256` | A conformance test that counts a warning per pass with and without a plugin; shows (bt) | L11-pre |

**Reading the table:** U1 to U3 and U17 are where the candidates live; each pins 1.35 now and shows the difference only with an approved, signed entry. U4 pins 1.35 whether or not (bs) is approved. U14 is the largest item: 224 of 1.35's own tests, most of them the operator cases that nothing in the oracle runs today.

## Performance

**In plain terms:** a data form costs a walk of the predicate per evaluation, as in 1.35. 2.0 should not walk it twice.

I did not run the bench for this RFC: no L11 code exists. What L11 must keep:

- A system with no data form is not slower than `main` by more than 5% after any L11 slice: the parts add nothing to a pass that has no data form.
- A data-form `when` costs one walk per evaluation. 1.35 walks twice when any plugin is installed (E11). With (bt), 2.0 walks once and records the clauses only while something listens.
- `memoizePredicate` caches by the spec object (a `WeakMap`), as 1.35; registration freezes the spec, so the cache cannot go stale.
- L11a adds a `data-form-100` workload (B3): 100 constraints with data-form `when`, a write that re-evaluates all, with and without a plugin. Time, judged at 1.0 or better against 1.35.

## Slice plan

**In plain terms:** an oracle slice, the engine side, the tools, and the gate.

| Slice | Builds | Done means (checkable) | Tier |
|---|---|---|---|
| Precondition 1 | The L10 gate, after the L8 and L9 gates. | `current` is L10. | coordinator |
| Precondition 2 | L9-pre-a merged (its U14 placement). | `data-forms.test.ts`'s nine tests sit at L11 on `main`. | coordinator |
| Precondition 3 | A `gate: L11` run of `mutation-nightly.yml`. | The L11 layer gate reports PASS, or its debt entries are listed as L11-pre work. | test oracle; coordinator |
| L11-pre (oracle) | U1 to U17: the probe pins, the ported splits of the three white-box files (U14), the `data-forms-namespaced` placement (U15). The fuzz additions and rules 1 to 3 (B1), each with a self-test. Any mutation debt. | The 21 PR seeds at forced L11 leave at most 10 unexplained cases. The new tests pass on `conformance:v1` and `v1:prod`, and on v2 fail only as this document predicts. `pnpm census`, `check:expects` and `oracle:update` exit 0. `oracle-change` label. | test oracle; Sonnet implementer, Fable correctness reviewer |
| L11a (engine side) | **The seam first**, measured and reported. Then `withPredicates`: the evaluator (E1 to E11), the six data forms (D1 to D5), the `explain` record field and the clause printer (I2, I3). (bp), (bq), (br), (bt) if approved. | At forced L11 on v2, v2:prod and v2:dist, the 9 engine-only failures pass, and the 5 that need L10 pass with it. The 9 re-placed `data-forms` tests and the 15 namespaced ones pass. The diff's three engine scenarios ("data-form when, on …", the two `on` gates) match 1.35 or differ only by signed entries. core-next `test`, `typecheck`, `build`, `size:check` with the exact development-string count. Sizes within A1; the PR reports the seam's bytes and the part's separately, before L11b starts. | core; Opus implementer, Sonnet diff reviewer plus Fable correctness reviewer |
| L11b (tools) | The ten tool files and the 33 exports. | The 187 tool failures pass. The two tool scenarios match 1.35. The census reports 0 L11 names missing. Each tool's production bytes reported against its 1.35 bytes (Size). Plus L11a's checks. | core; Sonnet implementer, one reviewer (pure functions, ported with their tests) |
| L11-gate | `current` to L11, `ratchet --update`, diff and fuzz at L11, the 14 feature-layer triage entries converted, `GATE-11.md`, `/principal` on L11. | 0 L11 failures on v2, v2:dist and v2:prod. The census exits 0. PR fuzz passes at L11. The nightly follows A2. At most 3 gate runs, then Jason. | test oracle; Sonnet plus the coordinator's read of each entry |

**Reading the table:** L11a is the code every app carries; L11b is code an app carries only if it imports it. Splitting them keeps the size evidence for each separate, and L11b is low-risk: 10 files of pure functions with 187 tests waiting.

## Size

**In plain terms:** the engine side of 1.35's L11 is about 5.1 KB, and core-next already has about 0.3 KB of it. Ported at the rate L9 landed, every app grows by about 4.2 KB; a thinner evaluator aims at 4.0 KB. The tools are another 11 KB, paid only by apps that import them. The recommended cap is +4.8 KB on the app fixtures, +100 B on `floor`, and +16.0 KB on `full-entry`, which imports every export.

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

**Reading the table:** an app that imports one compiler pays about 1.7 to 1.9 KB for it; one that imports `replayUnder` pays about 1.5 KB beyond the engine's share it already has. All of the tools beyond the engine's share are about 11.3 KB (14,879 B less 3,610 B; two bundles, so the difference is approximate).

**How much of 1.35's size a port pays.** Three layers are measured. L7 landed at 0.61 of 1.35's isolated bytes, 12% over its first cap. L8 landed at 0.88, 26% above its high estimate. L9 landed at 0.87 (+2,943 B against 3.4 KB), 9% above its middle estimate, at 98% of its cap, and its seam 35% over its sketch. **L7, L8 and L9 each landed above an estimate made for it.** L10 is not built.

| Estimate | Basis | `minimal` grows by |
|---|---|---|
| What core-next lacks of the engine side | 5.1 KB less the 0.3 KB it has | about 4.8 KB of 1.35's bytes |
| Low | 4.8 KB at L7's 0.61 | about 2.9 KB |
| Middle | 4.8 KB at L9's 0.87 | about 4.2 KB |
| **The thinner evaluator (the target)** | The middle, less one walker: (bt) folds `evaluatePredicateExplained` into the evaluator (its 314 B, measured as the difference of two bundles above), and the operator list and `$changed` walker are reused | **about 4.0 KB** |
| High | 4.8 KB at 1.0: a straight copy, no gain from sharing one gzip stream | about 4.8 KB |
| The earlier misses repeated | The target at L9's +9%, L7's +12%, L8's +26% | 4.4, 4.5 and 5.0 KB |
| The seam on `floor` | Reasoned: one hook slot and 1.35's throw | +30 to 60 B |
| (bp) stateless regex | Reasoned: one copy at registration | +20 to 40 B |
| (bq) refuse a combinator with siblings | Reasoned: the check and a production message | +40 to 80 B |
| (br) warn on a derivation name | Development only | 0 B in production |
| (bs) throw on an unknown operator | Reasoned: a production message. Recommended decline, so not in the estimate | +60 to 100 B |
| (bt) one walk | Inside the target: it removes a walker | about −300 B |
| The tools, on `full-entry` only | 11.3 KB at about 1.0: pure functions, ported as code | about 10.5 to 11.3 KB |

**Reading the table:** the plan's +3.5 KB is between the low and the middle. The tools are not in it: they cost three times the engine side, and only `full-entry` and apps that import them pay it.

**The basis for +4.8 KB.** It is the high estimate: a straight copy of the 4.8 KB core-next lacks, with no saving from sharing a gzip stream with the engine. It covers a repeat of L9's and L7's misses from the target (4.4 and 4.5 KB), and not of L8's (5.0 KB). I would not raise it on a guess: a larger cap is a larger allowance to spend. **L11a's target is 4.0 KB**, and its PR reports the seam's bytes and the part's against the target and the cap before L11b starts.

| Fixture | Cap (post-L10 plus) | At most, if L10 lands at its target | At most, if L10 lands at its cap |
|---|---|---|---|
| `minimal` | +4.8 KB | 44,182 B | 45,082 B |
| `two-module` | +4.8 KB | 44,273 B | 45,173 B |
| `aperture` | +4.8 KB | 49,050 B | 49,950 B |
| `full-entry` | +16.0 KB: the engine cap and the tools' 11.3 KB, rounded up | 57,651 B | 58,551 B |
| `floor` | +100 B | 11,372 B (L10's cap, +250 B, included) | |

The cap is a difference over the size L10 merges at; the L11-gate re-reads that base. `floor`'s cap is the seam's reasoned 60 B plus a margin, because the seam is not sketched. L11a's first commit measures it and comes back if it is over +100 B.

**Under "Keep the order".** Every `createSystem` build carries the evaluator until the beta, whether or not it uses a data form. At the beta, data forms can become an import (`predicates()`), and an app that skips it drops all but the seam: about 4.0 KB at the target. The tools cost an app nothing until it imports one, now and at the beta.

## What the plan got wrong, or left out

- **The tools are not in "+3.5 KB".** They are 11.3 KB of 1.35's bytes, three times the engine side, and they are paid only by apps that import them. The row's budget fits the engine side's middle estimate, not the layer.
- **"Opt-in" holds for the tools and not for the data forms.** A 1.35 constraint written as data must fire with no import, so the evaluator is in every `createSystem` build until the beta.
- **Nothing is a subpath.** In 1.35 every L11 tool is a root export, and two helpers are in `/internals`. Tree-shaking already keeps an unused tool out of an app.
- **"Compilers" is three of six data forms short.** The engine side is six data forms (`when`, `on`, `compute`, `patch`, list `key`, namespacing), not only `when`. 1.35 interprets predicates; it compiles nothing but the SQL, Mongo and PostgREST text.
- **1.35's own evaluator tests are not in the oracle** (U14), and 15 namespaced data-form tests sit at L13 for a flush helper (U15).
- **Four silent rule failures** in 1.35's evaluator (E5, E6, E9, E10) were not on any list; each is a candidate row.
- **The data forms depend on L10 in five tests** (register, assign, unregister a gated effect or a data-form derivation), so L11 cannot gate before L10.

## Decisions for the owner

**Questions for Jason.** Nine answers settle L11. The table after them gives each a product verdict, so Jason can bulk-approve.

1. **A1, the L11 size.** O1: the evaluator in a part wired by `createSystem`, the tools as root exports; up to +4.8 KB (target 4.0 KB) on `minimal`, `two-module` and `aperture` over their post-L10 size, +16.0 KB on `full-entry`, +100 B on `floor`. **Recommend: approve.**
2. **A2, do deep fuzz runs gate L11, or report?** **Recommend: "Gate on short seeds; deep runs report"**, as at L8 to L10.
3. **A3, fuzz-ready before the gate.** **Recommend: approve L8's brakes unchanged**, with the L10 gate as the precondition.
4. **(bp), a global or sticky regex in `$matches` works.** **Recommend: approve.**
5. **(bq), a combinator beside a fact key is refused at registration.** **Recommend: approve.**
6. **(br), a data form that names a derivation warns in development.** **Recommend: approve.**
7. **(bs), an unknown operator throws at registration.** **Recommend: decline.**
8. **(bt), a data form is walked once per pass.** **Recommend: approve.**
9. **B1 to B5.** **Recommend: approve.**

A "no", or no answer yet, means the slice keeps 1.35's behaviour, pins it with a core-next test, and writes no entry.

| Decision | Product verdict | Recommendation | Option taken |
|---|---|---|---|
| **A1** the evaluator in a part, the tools as root exports, and the L11 budgets | Same behaviour; every `createSystem` build grows by an estimated 2.9 to 4.8 KB, most likely 4.0 to 4.2 KB, until the beta; an app pays for a tool only if it imports it | Approve: +4.8 KB (target 4.0 KB) on three fixtures, +16.0 KB on `full-entry`, +100 B on `floor`; come back above that | **Approved** under the owner's instruction: O1, the caps as recommended |
| **A2** deep runs report, short seeds gate | No behaviour change; decides when L11 can merge | "Gate on short seeds; deep runs report" | **Taken**: gate on short seeds; deep runs report |
| **A3** fuzz-ready before the gate | No behaviour change; bounds the gate's cost | Approve | **Taken**: approve |
| **(bp)** `$matches` tests a stateless copy of its regex | Better, rare but silent: a rule written with `/…/g` fires when it should; in 1.35 it never fires inside a system, and the error is skipped silently in production. Called directly, `evaluatePredicate` gives the same answer every time | Approve, in L11a | **Taken**: approve, in L11a |
| **(bq)** `{ $any: […], phase: "green" }` is refused at `createSystem`, with the compilers' message | Better, visible: a rule that silently ignored half its conditions now fails at start-up with the fix in the message, and means the same thing on the client and in SQL. A program that relied on the ignored key, knowingly or not, now throws | Approve, in L11a; the exported `evaluatePredicate` keeps 1.35's answer | **Taken**: approve, in L11a, at registration only |
| **(br)** a data-form `when` or `on` that names a derivation warns in development | Better, development only: the author learns why the rule never fires. No production bytes, no change in production | Approve, in L11a | **Taken**: approve, in L11a |
| **(bs)** an unknown operator throws at `createSystem` | Better, visible: a typo fails at start-up in production too. Costs a production string, and turns a silent never-firing rule into a crash for a deployed app | Decline; development already warns, as at (bj); pin 1.35 (U4) | **Taken**: decline; pin 1.35 (U4); no entry |
| **(bt)** one walk per evaluation, recording clauses only while something listens | Same for users: the same answers and the same breakdown, at half the predicate work in a system with plugins. Test-rule for the diff: a development warning inside a predicate prints once per pass instead of twice | Approve, in L11a, with harness rule 1 | **Taken**: approve, in L11a |
| **B1** the fuzz additions and harness rules 1 to 3 | No behaviour change | Approve | **Taken**: approve |
| **B2** the oracle's L11 tests: the white-box splits (U14) and the namespaced placement (U15) | No behaviour change | Approve | **Taken**: approve |
| **B3** a `data-form-100` workload | No behaviour change | Approve | **Taken**: approve |
| **B4** signing for approved rows | No behaviour change; the census needs signed entries | Approve | **Taken**: approve |
| **B5** L9-pre-a merges before L11-pre | No behaviour change; a placement | Approve | **Taken**: approve |

*"Owner instruction 2026-11-15: 'I approve you for to do everything'. Under it, Claude takes each recommended option below. The owner may overrule any of them."*

### A. Decisions

#### A1 where L11 lives, and the L11 budgets

- **What 1.35 does.** The data forms work with no import, so the evaluator is in every `createSystem` build. The tools are root exports; tree-shaking keeps an unused one out of an app.
- **What 2.0 would do.** `withPredicates`, a part wired by `createSystem`, fills hooks in the constraints, effects, events and resolvers parts and one slot in the core (the seam). The ten tool files are root exports, as 1.35's.
- **The measured basis.** The engine side is about 5.1 KB of 1.35's bytes, 0.3 KB of it already in core-next; the tools are about 11.3 KB more (Size). L7, L8 and L9 each landed above an estimate made for it.
- **Product verdict.** Same behaviour. `minimal` grows from its post-L10 size by about 4.0 to 4.2 KB, at most 4.8 KB.
- **Recommendation.** Approve O1 and a raise with a written reason in each slice: +4.8 KB over the post-L10 size on `minimal`, `two-module` and `aperture` (target 4.0 KB), +16.0 KB on `full-entry`, +100 B on `floor`. Do the attribution step first: find the bytes, move cold code, fold duplicates. Come back if a slice lands above a cap, and before L11b if L11a is on course to.
- **Option taken.** The recommended one.

#### A2 do deep fuzz runs gate L11, or report?

- **What L8 to L10 chose.** "Gate on short seeds; deep runs report".
- **Why L11 is no different.** Once drawn, a data form is the same constraint the fuzz already compares, written another way, so the deep runs will mostly find new shapes of approved rows.
- **Recommendation.** The L8 answer: the gate merges when the 21 PR seeds pass at L11; nightly deep runs report; a case triaged as a real 2.0 bug blocks at once.
- **Option taken.** "Gate on short seeds; deep runs report".

#### A3 fuzz-ready before the gate

- **What L8 chose.** L8-pre leaves at most 10 unexplained cases; the gate is capped at 3 runs, then goes to Jason; case files store v2's trace; earlier follow-ups land first.
- **What L11 adds.** Harness rule 1 (warnings as a set) if (bt) is approved; it is B1.
- **Recommendation.** Approve L8's brakes unchanged, with the L10 gate as the precondition.
- **Option taken.** Approved, as L8's brakes.

### Candidate divergences

#### (bp) a global or sticky regex in `$matches` works

- **What 1.35 does.** Registration deep-freezes the spec, the regex included. `test()` on a `g` or `y` regex writes `lastIndex`, which a frozen regex refuses, so every evaluation throws "Cannot assign to read only property 'lastIndex'" and the rule never fires. By default the error is skipped silently; development warns. Called directly on an unfrozen regex, `evaluatePredicate` alternates true and false (E10, Q4 to Q4c).
- **What 2.0 would do.** At registration, keep a copy of each `$matches` regex without the `g` and `y` flags and test with it; `whenSpec` still returns the caller's object.
- **Product verdict.** Better, rare but silent.
- **Recommendation.** Approve, in L11a.
- **Option taken.** Approved.

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

- **What 1.35 does.** With any plugin installed, each evaluation of a data form walks it twice: once for the answer, once for `whenExplain` (E11). A development warning inside the predicate prints twice.
- **What 2.0 would do.** One walk that records the clauses only while a plugin or observer listens.
- **Product verdict.** Same for users; test-rule for the diff (harness rule 1), because development warning counts halve.
- **Recommendation.** Approve, in L11a. It is inside the size target.
- **Option taken.** Approved.

### B. Recommendations the owner may overrule

#### B1 the fuzz additions and harness rules

- **Recommendation.** In L11-pre: draw data-form `when`, `on` and `compute` (and their namespaced forms), add the `tools` op, and rules 1 to 3, each with a self-test. They run on 1.35 from L11-pre, and on v2 only once `current` is L11.

#### B2 the oracle's L11 tests

- **Recommendation.** In L11-pre: port the black-box cases of `predicate.test.ts`, `predicate-describe.test.ts` and `sweep-under.test.ts` as `WHITE-BOX.md:30–32` says (U14), and give `data-forms-namespaced.test.ts` `instruments: ["import flushMicrotasks"]` (U15).

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
- **Unknown operators and two-operator objects warn per evaluation in development**, as 1.35, unless (bt) halves the count.
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

**What I read, not ran.** The 1.35 line citations in "The design" (`packages/core/src/core/`); core-next's citations (`packages/core-next/src/api/`); the template rules (U16); the double walk (E11, `engine.ts:1248–1256`); the 0.3 KB core-next already carries; and the seam's reasoned +30 to 60 B.

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
