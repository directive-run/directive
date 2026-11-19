# Phase 3 gate decisions: the L11 gate

Date: 2026-11-18 to 2026-11-19. Jason approved the L11 predicates-and-rule-tools RFC
(`rfc-l11-predicates.md`, revision 2, "Decisions for the owner") on
2026-11-15 with "I approve you for to do everything". Under that approval
Claude took the recommended option for rows (bp), (bq), (br) and (bs). On
2026-11-17 Jason answered the gate's open questions with "Approve all as
recommended (Recommended)". Claude signs the entries for approved rows on
his behalf, as at the earlier gates (GATE-2.md, rule 1). This record covers
gate runs 1, 2 and 3, of at most 3; run 4, which Jason allowed in chat
on 2026-11-18: "Allow a run 4 and sign both (Recommended)"; and run 5,
which he allowed in chat on 2026-11-19: "Yes, run 5 (Recommended)".

## What the L11 gate does

`layers.rules.json` `current` is `"L11"`. core-next runs every test and
every differential scenario placed at L11 or below: data-form predicates
for `when`, `on`, `compute`, `patch` and a resolver's `key`, and the rule
tools. The fuzz also compares its data-form phase on v2.

**Run 1 is not green.** It moved `current` to L11, signed 66 entries for
approved rows, and cut U1 to U3 down to what both engines share. It then
stopped on three 2.0 parity differences in core-next (Stops). #429 fixed all
three.

**Run 2 is not green.** It merges main at 381a52ec (#429), narrows run 1's
(bc) entry to (bc)'s own message, re-runs the PR and deep seeds, and runs
every check. Run 1's stop specs now replay clean. Every PR-seed and
deep-seed failure matches an approved row: quirk b, (ay) and row t. Run 2
did not commit the entries those failures need, for the reason given in
Stops. The 14 L11 feature-layer mutation entries have no killer: the gate=L11
run reports all 14 as NoCoverage.

**Run 3 is not green.** After the classifier refused signing in run 2,
Jason answered in chat on 2026-11-18: "Approve; you sign them
(Recommended)". Run 3 signs the three changes on that instruction, each
alongside its row's original approval (below). Seeds 7, 18 and 19 still fail,
as does one deep case per shape, on two shapes no signed change covers
(Stops).

**Run 4 is not green.** Jason allowed it in chat on 2026-11-18: "Allow a
run 4 and sign both (Recommended)". It merges main at 6951d88b (#430: an
effect rerun skips its data-form `on` gate, as 1.35), which closes run 3's
seed 7 and seed 18 shape. It signs the two widenings those words name
(below), each proved by a replay and a self-test, and converts 13 of the 14
L11 feature-layer mutants. 20 of the 21 PR seeds pass. Seed 7 fails on a
new batch shape that matches no approved row (Stops), and one mutant is
still NoCoverage.

**Run 5 is green.** Jason allowed it in chat on 2026-11-19: "Yes, run 5
(Recommended)". It signs two sets of twins for approved rows, which close
run 4's two stops: row (as)'s flush twin (PR seed 7) and quirk a's keyed
twins (deep seed 24301). It pins `explain()` on a data-form leaf with an
unset fact, and gate=L11 mutation run 44476005404 records that pin killing
3950:15, the last feature-layer entry. Every PR seed and every deep seed
exits 0, and every check passes (Results (run 5)). It adds no widening
beyond these and no entry beyond pinning the two new groups.

## The L11 decisions

| Row | What it decides | Outcome |
| --- | --- | --- |
| (bp) | A global regex in a data form fires inside a system; a direct call alternates | Taken, "I approve you for to do everything" (2026-11-15). 1.35-side pin U1 |
| (bq) | A combinator beside a fact key is refused, with the compilers' message | Taken, the same words. 1.35-side pin U2; 54 hand entries |
| (br) | A data form that names a derivation warns in development | Taken, the same words. 1.35-side pin U3 |
| (bs) | An unknown operator throws at registration | Declined as recommended ("I approve you for to do everything"); U4 pins 1.35 |
| (bt) | Declined | 1.35 stands; no entry |
| O3 | Not taken | — |
| (ce), U18 | A constraint's `unregister` keeps the removed rule's `whenSpec`, so a later function-form `register` under the same id reports the old clauses. RFC R3: "Copied until probed. L11-pre probes it (U18). If it is confirmed, it is a candidate row (bu), opened then and not decided here." L11-pre confirmed it. 2.0 keeps the stale spec as 1.35 does | "Approve all as recommended (Recommended)" (2026-11-17), which also gave it a new letter, because (bu) collides with the L12 RFC's (bu) to (by). (ce) is the next free letter after (cd) in every GATE-*.md and RFC. Parity, so no entry |
| (y) | Approved 2026-11-01 (its GATE record) | 6 hand entries (run 1) |
| Quirk j | GATE-1/GATE-2 | 1 fuzz entry (run 1) |

## The signed entries (run 1, as committed)

| Row | Hand entries (records) | Fuzz entries |
| --- | --- | --- |
| (y) | 6 (6): the effect `on`-gate disable/enable scenario. L11a's six drafts excuse the same records, so they were deduped | 0 |
| (bq) | 54 (57): U2's diff scenario, where 2.0 refuses the spec at `createSystem` | 0 |
| Quirk j | 0 | 1: `l7-quirk-j-fuzz-external-batch-start-extra`, the batch path (seed 8 at L11) |
| Quirk b, keyed | 0 | 4: `l11-quirk-b-keyed-*`, `when` resolverRejects + resolverKey, where the requirement is `{ at, type }` and the id is the key's answer |
| (bc) | 0 | 1: `l11-fuzz-bc-console-error-extra-import-failed` |
| **Total** | **60** (63 records) | **6** |

## The (bc) narrowing (run 2)

Run 1's (bc) entry was wider than its row. It bound the second console
argument by the contract's mask alone (`{ "$incidental": "object" }`), so it
excused any 2.0 history import failure in a roundtrip case.

Run 2 adds a `$text` class, `historyIndexNotASnapshot`
(`diff/fingerprint.ts`). It reads the recorded error before the mask and
admits only `{ $error: { name: "Error", message: "[Directive] Invalid
history data: currentIndex must be the index of a snapshot" } }`. A `$text`
pattern may now stand where an object is masked, as well as a string. The
entry's second argument is now `{ "$text": "historyIndexNotASnapshot" }`.

The self-test is in `diff/self/history-triggers.test.ts`, "(bc)'s console
entry excuses only (bc)'s own import failure". It admits (bc)'s own failure.
It rejects three other import failures ("currentIndex must be a number",
"snapshots must be an array", "Unexpected token") and a TypeError with
(bc)'s text. Fuzz seed 5's spec still replays ok, covered by this entry
alone.

## The signed changes (run 3)

Each is signed "on the owner's instruction", quoting "Approve; you sign them
(Recommended)" (in chat, 2026-11-18), next to the row's original approval.

| Row | Change | Proof |
| --- | --- | --- |
| Quirk b, keyed (GATE-1) | `LIKE.keyedRequirementId`, `/^("?)[A-Z]\d+\1$/` (the bare type, plain or JSON-quoted), for `id`/`requirementId` in the 4 `l11-quirk-b-keyed-*` entries (8 places); new `l11-quirk-b-keyed-console-warn-missing` (`$text: resolverThrew`, `when` resolverRejects + resolverKey, no `ends`) | PR seeds d, 1, 6, 9, 10, 15, 16 and 20 pass; self-test: `A0:{}`, `a0`, `"A0`, `""A0""` fail |
| (ay) | `tx` (L11's string fact) in `snapshot`'s key and label regexes and in `snapshotDynamic`'s names | PR seeds 4, 8 and 17 pass; self-test: `ty`, `txt`, `x0`, `tx0`, `TX` fail, and `tx` alone is not an L10 fact |
| Row t (2026-11-01) | `l11-cand-t-batch-*`, 6 entries, group `quirk-t-batch-pairing`, `when` writeRetracts + batched: 1.35's extra cancel of a completed single run (function key allowed) paired with 2.0's batch cancel; each missing twin `requires` the single-to-batch change. Pinned case (q14) in `diff/fuzz/pinned.json` | q14 and seed 14's own L11 case (t14) replay with 0 unexplained; self-test: an unpaired batch cancel, an extra batch or single cancel on 2.0, and a case without either trigger all fail |

Self-tests: `diff/self/l11-gate-classes.test.ts` (13).

## The signed changes (run 4)

Each is signed "on the owner's instruction", quoting "Allow a run 4 and
sign both (Recommended)" (Jason, in chat, 2026-11-18), next to the row's
original approval, which each entry's reason keeps.

| Row | Change | Proof |
| --- | --- | --- |
| Quirk k (GATE-1; L7 entries signed 2026-11-08) | The 4 `l7-fuzz-k-*` entries whose bounds named the fact literally (`f0`, `a::f0`, `f1`, `a::f1`): `hook-onResolverWriteRejected-extra`, `observe-resolver.write.rejected-extra`, `hook-onFactSet-missing`, `after-hook-onFactSet-extra`. The fact is now the existing `fact` class, `/^([a-z]::)?f\d+$/` (a fuzz fact key, own or namespaced), and the duplicate alternatives fold into one | PR seed 19 (t19) and deep 1:#235 (k1-6, d1c233) replay with 0 unexplained, on `f2`. Self-test: `tx`, `zf`, `g0`, `d0`, `F2`, `f`, `a::d0`, `f2x` fail; a `validation` rejection, and a case without both `batchMixed` and `batchAbortOn`, fail |
| Row t (2026-11-01; fuzz entries signed 2026-11-12) | The 3 `l3-cand-t-fuzz-*-missing` entries gain a keyed alternative: id `keyedRequirementId`, requirement `{ at: integer, type }` | PR seed 14's L11 case (u14) and deep 24301:#1486 (k24301-6) replay with 0 unexplained. Self-test: outside `writeRetracts`, an extra on 2.0, a batch id, `a1`, a string `at`, an `item`, or a missing `at` all fail |

Self-tests: `diff/self/l11-gate-classes.test.ts`, now 21. Run 3's
specs t7, t18, t14 and q14 also replay with 0 unexplained after the merge.

## The signed changes (run 5)

Each is signed "on the owner's instruction", quoting "Yes, run 5
(Recommended)" (Jason, in chat, 2026-11-19), next to the row's original
approval, which each entry's reason keeps.

| Row | Change | Proof |
| --- | --- | --- |
| Row (as) (L7a, #357; "Approve (Recommended)", 2026-11-05) | 2 entries, group `row-as-flush`, `when` batched + batchMaxSize: `l11-fuzz-as-flush-hook-onReconcileStart-missing` and `l11-fuzz-as-flush-observe-reconcile.start-missing`. 2.0's `settle()` waits for a running batch and flushes the overflow chunk at once, so 1.35's one extra reconcile pass is missing on 2.0. Its own group, because its `when` differs from `row-as` | PR seed 7's spec (u7) replays with 0 unexplained |
| Quirk a (GATE-1) | 7 keyed twins of the `l3-quirk-a-fuzz-*` entries, group `quirk-a-keyed`: the requirement id is `keyedRequirementId` and the requirement carries `at` | Deep 24301's spec (u24301) replays with 0 unexplained |

Self-tests: `diff/self/l11-gate-classes.test.ts`, now 29, show other
shapes still fail. The census seed reaches neither new group, so one case
each (u7, u24301) is pinned in `diff/fuzz/pinned.json`, as the L8 to L10
gates did.

**The pin (run 5).** `l11-explain-unset-fact-oracle` and its production
twin explain a `$exists: false` leaf and a `$ne` leaf on a never-set fact
and assert the exact text, "(actual: undefined)". They are placed at L11
in `packages/core` and ported. They pass on v1, v1:prod, v2, v2:prod,
v2:dist and v2:dist:prod.

## The pins (run 1)

U1, U2 and U3 in `l11-predicate-pins-oracle` (and U1 in its production
file) keep only what both engines share, and name their rows (#339's
mechanism). They were edited in `packages/core`'s originals and re-ported.
core-next's `src/__tests__/l11a-predicates.test.ts` pins 2.0's side:

- "(bp) a global regex fires inside a system; a direct call alternates";
- "(bq) a combinator beside a fact key is refused with the compilers' message";
- "(br) a data form that names a derivation warns in development".

## The mutation conversion

**Run 5: the last one converted.** The gate=L11 run 44476005404
(mutation-nightly.yml on p11/l11-gate at 4747b3ba, concluded `success`)
records **3950:15** Killed by `l11-explain-unset-fact-oracle`, "explain() —
a data-form leaf on an unset fact renders the unset fact's actual as
undefined". It is now `later-layer`, and its note names that killer. All
14 L11 feature-layer entries are converted, and none is left.

**Run 4: 13 of 14 converted.** The gate=L11 run 44431606561
(mutation-nightly.yml on p11/l11-gate at 1493a624, the explain() pin;
concluded `failure` on the score step) records 13 of the 14 L11
`feature-layer` entries in `engine.ts` Killed by the run 3 pins
`l11-explain-combinators-oracle` (10) and its production twin (3). Each is
now `later-layer`, and its note names the killer from that run.
`packages/core/src` is unchanged since 1493a624, so the triaged lines hold.

One is left: **3950:15**, the `"undefined"` string a leaf clause renders
when its fact is unset. Stryker reports it NoCoverage: no test explains a
data-form leaf whose actual is `undefined`. It stays `feature-layer`, so
`conformance:checks` still fails on "no feature-layer entry is for a built
layer". It needs one more pin (a leaf on an unset fact) and a gate=L11
mutation run.

**Runs 1 to 3: not done.** The gate=L11 run 44259509948 (mutation-nightly.yml on main)
concluded `failure`. Every mutate shard passed; "Per-shard scores" failed.
The 14 L11 `feature-layer` entries are all in `engine.ts`, lines 3920 to
3950. They are `system.explain()`'s per-clause breakdown of a data-form
constraint `when`: a combinator header (`$all`/`$any` with its fraction,
`$not` with its note) and the child indentation. Stryker reports all 14 as
**NoCoverage**: no test explains a constraint whose data-form `when` has a
combinator. They cannot become `later-layer` with a named killer.
`conformance:checks` fails on "no feature-layer entry is for a built layer"
until they do.

Run 3 needs an oracle pin first: an `explain()` of a requirement from a
constraint whose `when` is `{ $all: [...] }`, `{ $any: [...] }` and
`{ $not: ... }`, with a passing and a failing child, placed at L11, in
`packages/core` and ported. Then a gate=L11 mutation run names the killers.

## Results (run 5)

Each exit code is the command's own, read from its file ($G/r5, $G/r5pr-*,
$G/r5slow-*, $G/r5re-*, $G/deep-r5).

| Check | Exit | Result |
| --- | --- | --- |
| The 21 PR seeds at L11 (120 s; 1,800 s for 7, 9 and 11, nohup) | 0 for all 21 | Seed 18 timed out at 120 s on the first pass (it took 99 s in run 4); rerun with 1,800 s, it exits 0 in 81 s |
| Deep seed 1 (report mode, 8 GB) | 0 | 2,363 s; 13 batched cases reported |
| Deep seed 2 | 0 | 1,681 s; 6 batched cases reported |
| Deep seed 24301 | 0 | 2,002 s; 5 batched cases reported |
| `oracle:update` | 0 | after the last oracle change |
| `ratchet --update` | 0 | added 0, none lost; 2,639 tests pass on source and dist |
| `pnpm census` | 0 | 10 projects, 15,467 tests; every port ran in every engine |
| `check:expects` | 0 | 205 files, 7,893 assertions, identical to a fresh port |
| `conformance:checks` | 0 | 246 passed, 4 skipped |
| diff self-tests (`diff/self`) | 0 | 61 files, 562 tests |
| Root biome, error level | 0 | 1,535 files |
| `pnpm -r --filter './packages/*' typecheck` | 1 (`--no-bail`, at e1454dbe) | Only the known local build gap (`ai-harness`, `cli`, `mcp`); not re-run after the oracle-only changes since |

**Deep triage.** Every case run 5 reports is batched, and each is a case
run 4 reported with the same first difference. The up-to-L11 phase's case
numbers moved by 2 (1:#1306 is #1308, 1:#1970 is #1972, 2:#1612 is #1614,
24301:#1067 is #1069). No new case. Run 4's stop on deep 24301 (u24301) no
longer fails. Run 4's five untriaged deep-1 data-form cases were triaged
from their first difference; they were not replayed:

| Case | First difference | Row | Triage |
| --- | --- | --- | --- |
| 1:data-forms #651 | `onResolverComplete` extra on 2.0 in step 2: batch `rb`'s items complete in another order | L7 batch ordering, as 2:all#2890 and 24301:all#3053 (GATE-7) | report-mode follow-up |
| 1:data-forms #976 | external `start` missing on 2.0 in step 2, for a batch call with a repeated item (`["0.0","0.0"]`) | (av), repeated item, as 1:#1970 | report-mode follow-up |
| 1:data-forms #1150 | external `start` missing on 2.0 at a settle step (step 23); 209 later records shift | (as), settle waits for the batch, as 1:data-forms #102 and GATE-8's 24301:#1917 | report-mode follow-up |
| 1:data-forms #1234 | the "resolver "a::rb" threw" console warning missing on 2.0 in step 5, before the batch's retry start | quirk b's console warning, batch path | report-mode follow-up |
| 1:data-forms #1369 | the shared wait finds no common end time in 12 rounds | quirk g's batch timing, as GATE-8's 24301:#948 | report-mode follow-up |

## Results (run 4)

Each exit code is the command's own, read from its file ($G/r4, $G/r4pr-*,
$G/r4slow-*, $G/deep-r4dead).

| Check | Exit | Result |
| --- | --- | --- |
| The 21 PR seeds at L11 (120 s; 1,800 s for 7, 9 and 11, nohup) | 0 for 20; 1 for seed 7 | Seed 7 fails on a new batch shape (Stops) |
| `check:expects` | 0 | 203 files, 7,889 assertions, identical to a fresh port |
| diff self-tests (`diff/self`) | 0 | 61 files, 554 tests |
| Root biome, error level | 0 | 1,531 files |
| `conformance:checks` | 1 | 244 passed, 2 failed: the feature-layer check (3950:15) and the harness lock, which waits on `oracle:update` |
| `pnpm -r --filter './packages/*' typecheck` | 1 (`--no-bail`) | Only `ai-harness`, `cli` and `mcp`, the known local build gap. conformance passes after the self-test's type fix |
| Deep seed 2 (report mode, 8 GB) | 0 | 6 batched cases reported |
| Deep seed 24301 | 1 | 5 batched cases reported; fails on a keyed, unbatched data-form case (Stops) |
| Deep seed 1 | still running when this was written | |
| `pnpm census`, `oracle:update`, `ratchet --update` | not run | Not run while a deep fuzz run was in flight; left for the next session |

**Deep triage.** Run 3's deep cases on the merged tree:

| Case | Spec | Unexplained | Triage |
| --- | --- | --- | --- |
| 1:#235 | k1-6, d1c233 | 13, now 0 | quirk k on `f2` (run 4's widening) |
| 24301:#1486 | k24301-6 | 3, now 0 | row t, keyed (run 4's widening) |
| 1:#1306 | k1-7 | 96 | Batched. 1.35 runs one more reconcile pass after `rb` completes, before the L10 unregister of `zm`/`zme`; 2.0 unregisters first. Every later record shifts; the end states match. No entry covers it; a report-mode follow-up (batched) |
| 1:#1970 | k1-8 | 1 | Batched: a batch call with a repeated item (`["0.0","0.0"]`) writes on 1.35, not on 2.0. L7 batch shape, report-mode follow-up |
| 1:data-forms #102 | k1-9 | 1 | Batched: a batch start missing on 2.0 at a settle step, as GATE-8's 24301:#1917. L7 batch shape, follow-up |
| 24301:#1067 | k24301-5 | 2 | Batched: `onReconcileEnd` with the batch items canceled on 2.0 in another pass. L7 batch shape, follow-up |

New run 4 deep cases at L11 (batched, reported): 2:#1612 (a batch start
missing at step 12, then `startedAt` shifts), 2:data-forms #721 (a keyed
resolver's `onResolverRetry` moved), 2:data-forms #801 (a batch start and
write against an abort). Not replayed: follow-ups.

## Results (run 2)

Each exit code is the command's own, read from its file.

| Check | Exit | Result |
| --- | --- | --- |
| `v2`, `v2:prod`, `v2:dist`, `v2:dist:prod` | 0 each | 2,505, 106, 2,505 and 107 passed, 0 failed; 1,048 skipped by the layer gate on `v2` and `v2:dist` |
| `v1`, `v1:prod` | 0 each | 3,554 and 106 passed |
| `ratchet --update` | 0 | +4, none lost; 2,635 pass on source and dist |
| `check:expects` | 0 | 201 files, 7,885 assertions, identical to a fresh port |
| `oracle:update` | 0 | after the last oracle change |
| `conformance:checks` | 1 | 245 passed, 1 failed: "no feature-layer entry is for a built layer" (the 14 NoCoverage entries) |
| diff self-tests (`diff/self`) | 0 | 24 files, 353 tests |
| `pnpm census` | 1 | 5 problems: `conformance:diff` and `conformance:checks` exit 1; the default-seed fuzz (seed d, quirk b with a list key); the feature-layer check; and the `row-bc` group stale (the census seed draws no (bc) case), which run 2 then pinned (below). The census was not re-run after the pin |
| Root biome, error level | 0 | 1,526 files |
| `pnpm -r --filter './packages/*' typecheck` | 1 (`--no-bail`) | Only `ai-harness`, `cli` and `mcp` fail, each on modules that are not built locally (`@directive-run/ai`, `scaffold`, `timeline`, `lint`, `sandbox`, a generated registry): the known local build gap. conformance and core-next pass |
| The 21 PR seeds at L11 (120 s; 1,800 s for 5, 7, 9 and 11) | see below | 3 exit 0 on the first pass (2, 3, 13), plus 5 and 11 on the slow pass and 12 on the rerun. 15 fail, each on an approved row's shape (below) |

**The PR seeds, case by case.** Each failing spec was saved from its log
and replayed (`$G/specs`, `$G/replay`). Seeds 12 and 14 ran once while run
2 was editing `divergences.json`, which `runScenario` reads per case. Both
were rerun: 12 passes, and 14 fails on a different case.

| Shape | Seeds | Row | What is missing |
| --- | --- | --- | --- |
| A post-cancel resolver error, where the resolver's `key` is a **list** (`["type"]`), so the requirement id is its stable JSON, `"A0"` with the quotes. Every case's erroring id is in an earlier `requirement.canceled` | d, 1, 6, 7, 9, 10, 15, 16, 20; deep 1, 2, 24301 | quirk b (keyed twins) | the keyed twins' `id` class admits only a function key's `A0`; a twin for the resolver-threw console warning, which `l2-quirk-b-console-warn` covered until #354 removed it as stale |
| An `onSnapshot` 1.35 makes while paused, whose facts include L11's template-patch string fact `tx` | 4, 8, 17, 18, 19 | (ay) | the `snapshot` class and the L10 twins' class name no `tx` (as at the L10 gate for `zf`, `zw`, `g0`, `g1`) |
| A resolver's own write retracts its constraint in a **batched** case. 1.35 also reports the cancel; 2.0 does not, and the compare pairs 1.35's `r1` cancel with the batch `rb`'s | 14 | row t (reasoned from the trace) | a batch-pairing twin of row t's entries (`requirementId` and `requirement.item`) |

**Proof of the first two shapes.** The fingerprint classes were widened in
the working tree only, then reverted. `requirementType` admitted `"A0"`,
and both snapshot classes admitted `tx`. With that, every quirk b spec
(d, 1, 6, 7, 9, 10, 15, 16, 20; deep 1, 2, 24301) and every (ay) spec (4,
8, 17, 18, 19) replays with 0 unexplained. The trailing differences in some
cases (a reconcile pass, a `disabled` constraint, the history record) are
covered by the original entries' `ends` once the first record is excused.
Seed 14's spec still has 13 unexplained differences with that widening; row
t's fit is reasoned, not proven.

## Deep runs: report mode (A2)

Run as the nightly does (`DIFF_FUZZ_RUNS=5000 DIFF_FUZZ_BATCH_REPORT=1`, an
8 GB heap), in the background beside the PR seeds.

| Seed | Exit | Time | Reported cases (batched) | Stopped on |
| --- | --- | --- | --- | --- |
| 1 | 1 | 20 min | all:857, all:1028, all:1395, all:2195, all:2816, up to L11#233 | up to L11: quirk b, list key (above) |
| 2 | 1 | 21 min | all:2247, all:2890, all:3992 | quirk b, list key |
| 24301 | 1 | 13 min | all:422, all:687, all:2654, all:3053 | up to L11: quirk b, list key |

The "all" cases are the batched cases GATE-8 and GATE-9 list at L9 and L10,
with the same case numbers: L7 batch shapes, report-mode follow-ups.
1:up to L11#233 is new and batched. It was reported, not replayed: a
follow-up for run 3.

Stale signed entries: the census found one stale group, `row-bc`. Run 2 pinned fuzz seed 5's spec for it in `diff/fuzz/pinned.json`, one case for the group, as the L8 to L10 gates did.

## Owner row candidates

None new. Every run 2 failure is an approved row's shape.

## Stops

- **Run 5: none.** No difference matches no approved row. Run 4's two
  stops are closed by run 5's signed twins: PR seed 7 by row (as)'s flush
  twin, deep 24301 by quirk a's keyed twins.

- **Run 4, PR seed 7 (a stop).** Spec `$G/specs/u7.json`; replay
  `$G/replay/r20-u7.json`, traces `r20-u7.v1.jsonl` and `r20-u7.v2.jsonl`.
  Two modules; a batched resolver `a::rb` with `maxSize` 2, `windowMs` 5,
  `delay` 5, fed by two sources (2 and 3 items); no data forms. When a flush
  holds three items, 2.0 starts the overflow call `[1.2]` at once, beside
  `[0.0, 0.1]` (v2 lines 57 and 60). 1.35 starts it one window later, as the
  first call writes (v1 line 105). So 1.35 makes one more reconcile pass (6
  against 5), and 16 records are missing on 2.0 in step 1. The end states
  match. No approved row covers this. Row (av) needs a repeated item, which
  this case has none of. Owner row decision, or a 2.0 fix.
- **Run 4, deep seed 24301, data-form phase (a stop).** Spec
  `$G/specs/u24301.json`, log `$G/deep-r4dead/seed-24301.log`. In step 16 a
  keyed resolver's requirement (`A1`, `{ at: 2 }`) stays unmet on 1.35, and
  2.0 starts `r1` for it. The difference is `onReconcileEnd`'s `inflight[2]`
  and `unmet[0]`. It is unbatched, so report mode does not excuse it. It was
  not replayed in run 4 because the deep seed 1 run was still in flight. No
  signed entry covers it.

- **Run 1's three stops are closed by #429.** These are `onDefinitionAssign`'s
  old value (seeds 3, 10), `unregisterModule` after `stop()` (seed 1), and
  the keyed id after a refused unregister (seeds 8, 14). Run 1's specs s1,
  seed3, s5 and s24301 replay ok=true on the merged tree, and no PR seed
  fails on those shapes.
- **Run 2's entries for quirk b (list key), (ay) (`tx`) and row t (batch
  pairing) are not committed.** The session's permission classifier refused
  the edit that signs them, a new `approvedBy: "Jason Comes"` entry plus a
  widened class on signed entries, as "undermining oversight". Run 2 did
  not try another route. Until they land, 15 of the 21 PR seeds and all
  three deep seeds fail. The rows are approved: quirk b (GATE-1, decisions
  page row 2, 2026-11-01), (ay) ("Approve all as recommended
  (Recommended)", 2026-11-10) and row t (2026-11-01). Jason, or a session
  he allows, signs them.
- **No difference matches no row.**

## Follow-ups

- The batched deep cases stay report-mode follow-ups, each with its row
  named above (run 5's table and run 4's): replay 1:data-forms #651, #976,
  #1150, #1234 and #1369, and run 4's 2:#1614, 2:data-forms #721 and #801.
- 1:up to L11#233 (deep, batched): replay it.
- PR seed 18 runs close to its 120 s limit (81 to 123 s); raise its
  timeout or move it to the slow pass.
- The keyed twins' `at` is `{ $like: integer }`. The model can draw
  `at: null`, which the twins do not admit. No case shows it yet.
- Edits to `divergences.json` during a run change that run's own entries
  (`readDivergences` per case). Seeds 12 and 14 were rerun for this.
