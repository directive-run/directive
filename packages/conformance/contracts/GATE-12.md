# Phase 3 gate decisions: the L12 gate

Date: 2026-11-21 to 2026-11-23. Jason approved the L12 plugins RFC
(`rfc-l12-plugins.md`) on 2026-11-15 with "I approve you for to do
everything"; each row was taken as its "Option taken" says, and (bw) is
declined. Row (az) is an L8 row: "Approve all as recommended
(Recommended)" (2026-11-10). On 2026-11-19 he accepted the plugin bench
miss: "No, accept the gap for now (Recommended)". On 2026-11-22, asked
whether the (bx) exception should cover its knock-on effects, he answered:
"Yes, widen (bx) to its knock-on effects (Recommended)". Later on
2026-11-22 he allowed a run 4: "Yes, run 4 (Recommended)", and for the
logging plugin's lines: "Project, don't sign copies (Recommended)". Asked,
also on 2026-11-22, whether to allow a 5th gate run to sign the six run-4
differences, check the planted-bug results in CI and open the gate PR, he
answered: "Yes, run 5 (Recommended)". On 2026-11-23, asked about run 5's
stop (after a history `goTo`, a finished batched requirement with two calls
in flight is cancelled once on both engines, and then 1.35 cancels it a
second time), he answered: "2.0's single cancel; sign it (Recommended)".
Asked next, also on 2026-11-23, whether to widen those second-cancel
entries from a finished run to any outcome, he answered: "Widen to any
outcome (Recommended)".
Claude signs the entries for approved rows on his behalf (GATE-2.md, rule
1). This record covers gate runs 1 to 5; any further run goes back to him.
**Run 5 is not green: PR seed 17 still exits 1. Its five cases so far
replay with 0 unexplained on the final tree; its sixth, `pr17f`, is a new
stop (below). The other 20 PR seeds passed on the commit before (d29001ab)
and were not rerun: the last change touches only the second-cancel entries
and their matcher.**

## What the L12 gate does

`layers.rules.json` `current` is `"L12"`. core-next runs every test and
differential scenario placed at L12 or below: plugins, the audit ledger,
the logging and performance plugins and distributable snapshots. The fuzz
compares its plugin phase on v2.

**Run 1 is not green.** It moved `current` to L12, ported, ran
`oracle:update` and `ratchet --update` (+402, none lost; 3,040), signed the
(bx) U1 entry, two (az) entries and one (bi) log line, and cut U5 and U6 to
what both engines share (#339's mechanism). v1, v1:prod, v2, v2:prod,
v2:dist and v2:dist:prod exit 0. The census-seed fuzz hung.

**Run 2 is not green.** It found the hang: the trace aligner's DP table
(5.3e9 cells) on a shrink of the census seed's plugin case 13. #439 bounds
it. The shrunk case is (bx)'s knock-on, unsigned: a stop for the owner.

**Run 3 is not green.** It merges main at bce72ad9 (#439), signs (bx)'s
knock-on on the owner's 2026-11-22 words, converts all 28 L12
feature-layer mutants and passes every check but the PR and deep seeds.
15 of the 21 PR seeds fail (Stops).

**Run 4 is not green.** Commits 13fa776c and the run-4 fixes commit.
The logging plugin's lines become a per-engine projection
(`diff/log-projection.ts`, "Project, don't sign copies (Recommended)"):
each engine's trace must hold every line immediately before the hook record
it reports (later plugins' clobber externals may sit between), every mapped
hook must have its line, and the one `init` line must precede the one
`onInit` record (1.35 calls onInit late in start(), so they are not
adjacent). The hook -> level/line table (`LOG_LINES`) is pinned against both
engines' `plugins/logging.ts` by a self-test. The lines are then dropped
from the cross-engine diff (`compare.ts` `kindOf`). Removed, so nothing
double-covers: the run-3 group `row-bx-logging` (3 entries) and the run-1
log twins `l12-fuzz-az-external-log-timetravel-jump-extra` and
`l12-fuzz-bi-external-log-trace-complete-extra`; the hook records stay
under (az)'s and (bi)'s own entries. PR seeds 4, 13, 16, 20 pass.

Run 4's (bx) entries ("Yes, run 4 (Recommended)" with "Yes, widen (bx) to
its knock-on effects (Recommended)"), group `row-bx`, each `when`
watchIncludesFacts: `l12-fuzz-bx-external-watch-missing` (requires an
earlier extra watch of the same `data[1].version`; seeds 6, 8, 17);
`...-derivation-compute-moved-same-step` (hook and observe, `by` 0, same
id; seed 15); `...-retracked-extra` for onDerivationCompute,
derivation.compute, onDerivationInvalidate and notify (kind "*"), and
`...-closing-missing` for the hook and observe compute (requires an earlier
same-id extra), all `stale`: 1.35's last compute of that derivation threw
or never ran (`markStale`; seeds 3, 10, 5, 14, 16, 17, 20).

Harness fixes (self-tests `diff/self/l12-gate-run4.test.ts`, 18):
`dependencyKeys` admits `derive.<id>` (seed 2) and the module step's
`(z::)g0/g1`; new class `snapshotDerivation` adds that module's `(z::)h0`
(seeds 8, 19); a signed move needs `same` (both records name the same
derivation), `fileMoves` tries up to 32 unpaired extras of the step for a
covered move, and computes pair by derivation id in the aligner (seed 19);
`requires.same`; census validates `by` 0, `same`, `stale`, kind "*".

**Run 5** signs the six differences run 4's rerun and triage 5 left, each
tightened from its draft, with the harness each needs (below: "Run 5: the
six entries"). Every check passes but one PR seed: seed 17's
next shrink is a shape the row-t entries, now stating "after met", do not
cover. Run 5 then closes that shape with row t's error-shape entries for a
batch run ("Run 5's last entry"), and seed 17's rerun finds a different
case, `pr17d`: 1.35 cancels a finished batch requirement twice after a
`goTo`, 2.0 once. On the owner's "2.0's single cancel; sign it
(Recommended)" (2026-11-23) run 5 signs that too, narrowly ("Run 5, the
owner's answer on `pr17d`"). All 21 PR seeds then run on that tree:
20 pass, and seed 17 finds the same shape for a batch run that errored
(`pr17e`). On the owner's "Widen to any outcome (Recommended)"
(2026-11-23) run 5 widens the second-cancel entries to either outcome
("Run 5, the owner's answer on `pr17e`"). Seed 17's rerun then stops on
`pr17f`: `pr17d`'s shape with the trace option on, where the streams'
pairings cross and one record of 1.35's second cancel stays unexplained
(Stops (run 5)).

## The L12 decisions

| Row | What it decides | Outcome |
| --- | --- | --- |
| (bu) | 2.0 signs data and metadata in their JSON form | Taken, "I approve you for to do everything" (2026-11-15). U5 keeps the shared part; 2.0 side in core-next l12a-distributable "(bu): undefined and a Date verify in place and after JSON" |
| (bv) | Data past 50 levels throws at signing; a function is dropped | Taken, the same words. U6 keeps the shared part; 2.0 side "(bv): data past 50 levels throws at signing and does not verify", "(bv): a function is dropped, ..." |
| (bw) | Declined | U10 pins 1.35 |
| (bx) | A watch also hears its included facts | Taken, the same words; widened to its knock-on effects, "Yes, widen (bx) to its knock-on effects (Recommended)" (2026-11-22) |
| (az) | replay() and import() call onHistoryNavigate (L8) | "Approve all as recommended (Recommended)" (2026-11-10); the ledger and logging twins |
| (bi) | Every run reports onTraceComplete once (L9) | "I approve you for to do everything" (2026-11-15); the logging twin |
| Bench | `plugins-100` at about 1.6 times 1.35 | Owner-accepted bench miss: "No, accept the gap for now (Recommended)" (2026-11-19). Not a stop |

## The signed entries

| Run | Row | Entries |
| --- | --- | --- |
| 1 | (bx) | `l12-bx-watch-hears-included-fact` (U1, step 3) |
| 1 | (az) | `l12-fuzz-az-external-ledger-navigate-entry` (`PAIR.ledgerNavigateInserted`), `l12-fuzz-az-external-log-timetravel-jump-extra` |
| 1 | (bi) | `l12-fuzz-bi-external-log-trace-complete-extra` |
| 3 | (bx) knock-on, group `row-bx`, `when` watchIncludesFacts | the getDistributableSnapshot skip warning, onError and onErrorRecovery "skip" extra (the hooks `requires` the warning), derivation.compute observe and onDerivationCompute moved one step earlier (`by` -1), the extra "watch" callback |
| 3 | (bx) knock-on, group `row-bx-logging`, `when` watchIncludesFacts + loggingPlugin | the logging plugin's "[Directive] error" and "[Directive] error.recovery" extra (each `requires` its hook's extra) and "[Directive] derivation.compute" moved |

| 4 | (bx) knock-on, group `row-bx` | the nine entries listed under run 4 above (earlier delivery of a watch callback, same-step compute moves, the re-tracked derivation's records) |
| 5 | quirk b, group `quirk-b-batch-pairing` | `l12-fuzz-b-batch-pair-*-changed` (onError, onErrorRecovery, onResolverError, resolver.error) |
| 5 | row t, group `quirk-t-batch-completed` | `l12-cand-t-batch-completed-*-missing` (onResolverCancel, onRequirementCanceled, requirement.canceled) |
| 5 | row t, its error shape, group `quirk-t-batch-error` | `l12-cand-t-batch-error-*-missing` (the same three records) |
| 5 | row t and row (av), the owner's 2026-11-23 answer, group `quirk-t-batch-second-cancel` | `l12-cand-t-batch-second-cancel-*-missing` (the same three records, 1.35's further copies; widened to any outcome on his second 2026-11-23 answer) |
| 5 | (bx) knock-on, group `row-bx`, `when` watchIncludesFacts | `l12-fuzz-bx-hook-onError-repaired-changed`, `...-onErrorRecovery-repaired-changed`; `l12-fuzz-bx-hook-onDerivationCompute-repaired-changed`, `...-observe-derivation-compute-repaired-changed`; `l12-fuzz-bx-hook-onTraceComplete-recompute-inserted`, `...-state-settle-trace-...`, `...-state-end-trace-...`; `l12-fuzz-bx-console-warn-distributable-unknown-keys-extra` |

The new trigger `watchIncludesFacts` is a watch with `includeFacts`
(diff/fuzz/model.ts). New hand-named classes: `distributableSkipped`,
`derivationThrown`, `derivationThrownMessage`, `derivedValue`,
`dependencyKeys`, `distributableSnapshot`. Self-test
`diff/self/l12-gate-bx-knockon.test.ts`: the same records with no watch,
or a watch without facts, still fail, as does any other kind, error
source, recovery, warning, a later move, or a log line without its hook.

**Proof (run 3).** Replays on the merged tree: `hang/shrunk-spec.json`,
plugin case 13 and the census seed's logging shrink (`specs/c3.json`)
replay ok with 0 unexplained; `shrunk-nofacts`, a1 and a2 stay ok.

## Run 5: the six entries

Each is signed "on the owner's instruction", quoting its row's own approval
and "Yes, run 5 (Recommended)" (2026-11-22); the (bx) entries also quote
"Yes, widen (bx) to its knock-on effects (Recommended)" (2026-11-22). Only
quirk b's end a case, as that row's other entries do. Self-tests: `diff/self/l12-gate-run5.test.ts` (37).

| Entries | Row | Narrowest form | Proof (replay, 0 unexplained) | Another shape that still fails (self-test) |
| --- | --- | --- | --- | --- |
| quirk-b batch pairing (4) | GATE-1 quirk b | A single run's error changed field by field into a batch run's, only where 1.35 also made a batch error of that kind that 2.0 lacks (`requires` op missing, the `l7-fuzz-b-*-batchFails` bound), in a case with a failing batch (`when` adds batchFails). It ends the case, as quirk b's other entries do: with two batch items the shift pairs each later batch error with the next item's | PR seed 15, both shrinks (`pr15`, `pr15b`) | No batch error unpaired on 1.35; only a single run's error unpaired; batch to single; no failing batch in the case |
| (bx) error pairing (2) | (bx) | A derivation error's message and id changed to another fuzz derivation's, in a recoverable derivation error record, only where 2.0 also made, unpaired, an extra record equal to 1.35's half (`requires` op extra, `same`) | PR seed 6's shrunk case (16 covered) | No fact-including watch; no extra error equal to 1.35's; an error of another source |
| row t, batch completed then cancel (3) | row t | The id-only cancel records of a batch requirement missing on 2.0, only **after met**: both engines' last lifecycle record of that requirement is its `onRequirementMet`, with no create or cancel since (`afterMet`) | PR seed 17 | Still in flight; met on 1.35 only; created again after met; a second cancel; no batch |
| (bx) compute pairing (2) | (bx) | A snapshot derivation's compute value changed, only where 2.0 also made, unpaired, an extra compute equal to 1.35's whole record: same derivation, 1.35's value and dependencies (`requires` op extra, `same`) | PR seed 11, deep seed 24301 | No fact-including watch; an extra compute of another derivation or value; none; not a snapshot derivation |
| (bx) trace run (3) | (bx) | 2.0's runs are 1.35's with compute entries of snapshot derivations inserted and one "<id> recomputed" chain link each, nothing else (`pair` traceRunRecomputeInserted), after an extra watch snapshot | Deep seed 1 | No fact-including watch; no extra watch; any other run field, a removed or changed entry, another derivation, another chain link |
| (bx) unknown derivation (1) | (bx) | getDistributableSnapshot's unknown-key warning, word for word, extra on 2.0 (`$text` distributableUnknownKeys). The re-registered derivation's compute needs no entry: `markStale` reads a derivation as never computed from its `onDefinitionRegister`, and the run-4 `retracked-extra` entries cover it | Deep seed 2 | No fact-including watch; any other warning text; a derivation not registered again, another derivation's or kind's register, or one that computed since |

Every (bx) case also replays with 0 differences with the watch's facts
empty and with no watch (`nf-*`, `nw-*`). Specs and replays:
`$G/r5/specs`, `$G/r5/replay/e1-*` (`$G` is diff-notes `l12gate/`).

Harness additions (run 5), each with its self-test in the same file:

- **`requires.same` reads a changed pair** (`diff/scenario.ts` `pairedHalf`):
  for a covered `changed` difference it reads 1.35's whole record, so the
  entry holds only where 2.0 made that record again, unpaired. No earlier
  entry had `same` on a changed difference, so none changes.
- **`afterMet`** (`markAfterMet`, `Difference.afterMet`; the census
  validates it: true, fuzz, op missing).
- **`PAIR.traceRunRecomputeInserted`** and **`TEXT.distributableUnknownKeys`**
  (`diff/fingerprint.ts`). The prototype patch was reviewed line by line and
  rewritten: typed, key-order independent, the warning's key lists checked
  id by id.
- **`markStale`'s register rule**: a derivation's `onDefinitionRegister`
  resets it to never computed.
- Two pinned cases (`diff/fuzz/pinned.json`): PR seed 15's and 17's shrunk
  specs, for the two new groups.

Two findings from the tightening. The quirk-b draft, which had no
`requires`, also hid deep case 2/3: a single run's error paired with a
batch timeout error before quirk p's stop, with no batch error unpaired on
1.35. It is not quirk b's shape and stays unexcused (a batched,
report-mode case; follow-ups). And the row-t draft, which did not say
"after met", hid a second shape of PR seed 17: the next section.

## Run 5's last entry: row t's error shape for a batch run

Run 5 first reported PR seed 17's second shrink (`$G/r5/specs/pr17b.json`)
as a stop: a batch run that errored, then is canceled. It is row t's error
shape, already signed for a single run (`l9-fuzz-t-disable-*`, quoting
GATE-2: "1.35 reports the error and then a cancel for the same run, 2.0 the
error only"; owner-approved 2026-11-01). The traces
(`$G/r5/replay/e2-pr17b.v1.jsonl`, `.v2.jsonl`) confirm the match: the
batch requirement's own run reports onError, onErrorRecovery "skip",
onResolverError and resolver.error on both engines; the same pass retracts
it; 1.35 then adds onResolverCancel, onRequirementCanceled and
requirement.canceled for that requirement, and nothing else differs but the
teardown timer count `l3-quirk-z-fuzz-timers-teardown-changed` already
covers.

| Entries | Row | Narrowest form | Proof (replay, 0 unexplained) | Another shape that still fails (self-test) |
| --- | --- | --- | --- | --- |
| row t, batch errored then cancel (3): `l12-cand-t-batch-error-*`, group `quirk-t-batch-error` | row t, its error shape (GATE-2) | The id-only cancel records of a batch requirement missing on 2.0, in a case with a failing batch (`when` writeRetracts, batched, batchFails), only **after the run's own error**: both engines' last lifecycle hook of that requirement is its `onResolverError` from the batch resolver, with no create, start, completion, met or cancel since (`afterError`) | PR seed 17's second and third shrinks (`pr17b`; `pr17c`, the same with the logging plugin on); its first shrink (`pr17`) stays at 0 | The same cancel without the preceding error on that run; an error of another batch run; the error on 1.35 only; created again after the error; a second cancel; an onResolverCancel naming another resolver; no failing batch in the case |

Signed "on the owner's instruction", quoting GATE-2's row-t error-shape
approval (2026-11-01) and "Yes, run 5 (Recommended)" (2026-11-22). Harness:

- **`afterError`** (`diff/scenario.ts` `markAfterError`,
  `Difference.afterError`; the census validates it: true, fuzz, op
  missing). Between a cancel's own three records only the logging plugin's
  lines may sit (`isLogLine`, the per-engine projection): any other record
  there leaves the later ones unmarked (self-tested).
- One more pinned case (`diff/fuzz/pinned.json`): `pr17b`, for the new
  group.
- Self-tests: 12 more in `diff/self/l12-gate-run5.test.ts` (49).

## Run 5, the owner's answer on `pr17d`: 1.35's second cancel of a finished batch run

Run 5's stop was PR seed 17's fourth case (`$G/r5/specs/pr17d.json`; traces
`$G/r5/replay/g3-pr17d.v1.jsonl`, `.v2.jsonl`). A `goTo` restores the batch
source's fact while a batch call is in flight, which retracts the batch
requirement without ending the call. The call's late write raises the
requirement again and a second call starts. The next pass reports the batch
run complete and the requirement met, aborts both calls' signals, and both
engines cancel the requirement once (1.35 with its id only, 2.0 in full:
`l7-fuzz-aq-*`). 1.35 then reports the cancel a second time; 2.0 does not:
3 differences.

Jason was asked about it in chat on 2026-11-23 and answered: **"2.0's
single cancel; sign it (Recommended)"**. The option he picked: treat it as
row t / (av); 1.35's second cancel of an already-cancelled finished run is
an extra report; sign a narrow entry that requires a goTo, a finished batch
run and a cancel already reported on both engines, with a self-test. It
sits next to row t (owner-approved 2026-11-01) and row (av)'s "Approve:
once (Recommended)" (2026-11-07).

| Entries | Row | Narrowest form | Proof (replay, 0 unexplained) | Another shape that still fails (self-test) |
| --- | --- | --- | --- | --- |
| 1.35's second cancel of a finished batch run (3): `l12-cand-t-batch-second-cancel-*`, group `quirk-t-batch-second-cancel` | row t and row (av), on the owner's 2026-11-23 answer | The id-only cancel records of a batch requirement missing on 2.0, in a case with a batched resolver and a navigation that can run while work is in flight (`when` batched, navigated, navigatedBusy), in a step **after a goTo step** (`afterOp` goTo), and only **after the finished run's one shared cancel**: on both engines the requirement's lifecycle hooks before the record end with exactly its `onResolverComplete`, its `onRequirementMet`, one `onResolverCancel` and one `onRequirementCanceled`, the first three naming the same batch resolver, with no create, start, error or further cancel since (`afterCancel`) | `pr17d` (5 covered: these three and row (aq)'s two changed pairs); `pr17`, `pr17b`, `pr17c` stay at 0 (`$G/r5/replay/k1-*`) | A second cancel with no cancel reported before it on 2.0 (all six records fail against these entries; the first cancel is row t's third path, the second stays unexplained); no navigation in the case, a navigation that never ran while work was in flight, a `back` instead of a goTo, a goTo only after the cancel's step; a run still in flight, a run that errored, a run completed by another resolver; created again after the first cancel; a third cancel; another requirement's cancel; an onResolverCancel naming another resolver |

Signed "on the owner's instruction", quoting his answer with its date,
row t's approval (2026-11-01) and row (av)'s "Approve: once (Recommended)"
(2026-11-07). Harness:

- **`afterCancel`** (`diff/scenario.ts` `markAfterCancel`,
  `Difference.afterCancel`; the census validates it: true, fuzz, op
  missing). `cancelStart`, the cancel's own earlier records, is now one
  helper read by `markAfterError` and `markAfterCancel`; `markAfterError`
  behaves as before (its self-tests pass unchanged).
- One more pinned case (`diff/fuzz/pinned.json`): `pr17d`, for the new
  group.
- Self-tests: 11 more in `diff/self/l12-gate-run5.test.ts` (60). The
  file's `left` helper now judges as `runScenario` does: every marker, and
  the steps' ops (which `afterOp` reads).

## Run 5, the owner's answer on `pr17e`: one rule for any outcome

The section above describes the second-cancel entries as first signed.
Seed 17's next case was `pr17e` (`$G/r5/specs/pr17e.json`; traces
`$G/r5/replay/k2-pr17e.v1.jsonl`, `.v2.jsonl`): `pr17d` with a failing
batch (handler "results", `fails` 1). The pass after the first call's
write reports the run's error on both engines instead of a completion.
Both engines cancel the requirement once, and 1.35 a second time: the same
3 differences, after an error instead of a completion and met.

Jason was asked in chat on 2026-11-23 whether to widen the second-cancel
entries from a finished run to any outcome, and answered: **"Widen to any
outcome (Recommended)"**. The option he picked: sign one rule. After a
goTo, once both engines have reported a batched request's outcome
(finished or failed) and one cancel, 1.35's further cancels of it are
extra reports. Self-tests: no prior cancel, no goTo, or a different
difference still fail.

| Entries | Row | Narrowest form | Proof (replay, 0 unexplained) | Another shape that still fails (self-test) |
| --- | --- | --- | --- | --- |
| The same three, `l12-cand-t-batch-second-cancel-*`, group `quirk-t-batch-second-cancel`; no new entry | row t and row (av), on the owner's two 2026-11-23 answers | Unchanged: the id-only cancel records of a batch requirement missing on 2.0, `when` batched, navigated, navigatedBusy, in a step **after a goTo step** (`afterOp` goTo), `afterCancel`. Widened, in `markAfterCancel` only: on both engines the requirement's lifecycle hooks before the record end with **its run's outcome, the same on both** (its `onResolverComplete` and its `onRequirementMet`, **or its `onResolverError`**), then its cancel (`onResolverCancel`, `onRequirementCanceled`): **exactly one cancel on 2.0, one or more on 1.35**, every hook naming the same batch resolver, with no create, start or other lifecycle hook since | `pr17e` (the three entries and row (aq)'s two changed pairs); `pr17`, `pr17b`, `pr17c`, `pr17d` stay at 0 (`$G/r5/replay/q1-*`) | After either outcome, a second cancel with no cancel reported before it on 2.0 (the first is row t's own path, the second stays unexplained); no navigation, a navigation that never ran while work was in flight, a `back`, a goTo only after the cancel's step; an extra cancel on 2.0 instead of 1.35 (2.0 twice and 1.35 once; 2.0 twice and 1.35 three times); another record that differs (1.35 creating the requirement again, 1.35's extra error records, 2.0 lacking the run's error, the second cancel in the whole-requirement shape); a run still in flight; different outcomes on the two engines; an outcome from another resolver; created again after the first cancel; another requirement's cancel; an `onResolverCancel` naming another resolver |

Two shapes that failed under the first answer are now excused, as the
option he picked says: a batch run that **failed** ("finished or failed"),
and 1.35's **third** cancel ("further cancels").

Signed "on the owner's instruction": each entry's reason now quotes both
2026-11-23 answers with their dates, next to row t's approval (2026-11-01)
and row (av)'s "Approve: once (Recommended)" (2026-11-07). Harness:

- **`markAfterCancel`** (`diff/scenario.ts`) only: `RUN_OUTCOMES` (finished
  or failed) and `CANCEL_HOOKS` replace the one fixed list of four hooks.
  The field's notes (`diff/compare.ts`, `diff/scenario.ts`) and the census
  rule's message say the same. No other matcher, marker or entry changed,
  and no case was pinned (`pr17d` keeps the group in use).
- Self-tests: `diff/self/l12-gate-run5.test.ts` has 66 (7 new; "a third
  cancel fails" and the errored half of "on a run that did not complete it
  fails" became controls).

## Deep batched cases (run 4's report, triaged in run 5)

Run 4's deep seeds each exited 1 on one hard failure and reported batched
cases (Jason, 2026-11-09: "Gate on short seeds; deep runs report
(Recommended)"). The three hard failures are the run-5 entries' cases
(deep 1: trace run; deep 2: unknown derivation; deep 24301: compute
pairing) and replay with 0 unexplained. The deep seeds were not rerun in
run 5. The two cases run 5 was asked to read:

- **24301/1 (24 differences): row (as), not a 2.0 bug.** In a `settle` step
  a batch call's write queues three more items while that call is still
  running. 2.0 starts their call at once, before the running call's
  completion is reported; 1.35 reports the completion, makes its pass, then
  starts it. Both engines make the same records, calls and passes: the 12
  completion and met records sit before a pass on 2.0 and after it on 1.35
  (12 extra, 12 missing). With the `settle` step replaced by an `advance`
  the case passes (`$G/r5/replay/var-c24301-1-adv`), so it is `settle()`
  waiting for a running batch and running the queues at each settled
  change. No signed entry has this shape (the flush twin needs `maxSize`).
- **2/6 (3 differences): row (at) with quirk g, not a 2.0 bug.** In a `twin`
  step with a fallback handler (resolve() only), one item's retry writes a
  fact that retracts the batch source. 2.0 aborts the other item's run and
  does not retry it; 1.35, whose fallback runs are private resolve() runs
  nothing cancels, starts the retry and writes again. The twins' final
  facts are equal. With a `resolveBatch` handler the case passes
  (`$G/r5/replay/var-c2-6-batch`).

Both are evidence from one variant each, not a public-API probe; each
needs its own narrow entry and probe in a follow-up slice. Traces:
`$G/r5/replay/deep-c24301-1.v{1,2}.jsonl`, `deep-c2-6.v{1,2}.jsonl`.

## The mutation conversion

28 L12 `feature-layer` entries in `engine.ts` (4135 to 4256) are now
`later-layer`. 10 are Killed in the gate=L12 run 44937079779 (main at
3e943a32) by l12-plugins-pins-oracle and its production twin. 18 were
Survived or NoCoverage there; run 3's six "L12 gate mutation pins" (the
full unknown-key warnings, "(none)", exclusions in a snapshot and a watch,
metadata) kill them in a local Stryker run at ceiling L12
(`mutate:file engine.ts:4135-4260`). None is left. **CI confirmation of
the 18 is pending**: a gate=L12 mutation run on this branch, which the
coordinator dispatches after pushing.

## Results (run 3)

| Check | Exit | Result |
| --- | --- | --- |
| `pnpm census` | 0 | 10 projects, 15,643 tests; the census-seed fuzz finishes |
| `check:expects` | 0 | |
| `oracle:update` | 0 | after the last harness edit |
| `conformance:checks` | 0 | 253 passed |
| diff self-tests | 0 | 595 tests |
| Root biome | 0 | |
| `ratchet --update` | 0 | +6 (the mutation pins), none lost; 3,046 |
| `pnpm -r --filter './packages/*' typecheck` | 1 | only the known gap (`ai-harness`, `cli`, `mcp`); core, core-next, conformance pass |
| The 21 PR seeds at L12 | 1 | d, 1, 12 exit 0; 2, 3, 4, 6, 8, 10, 13, 15, 16, 17, 19, 20 fail; 5 and 18 time out at 120 s; 14 died (IPC channel closed); 7, 9, 11 (1,800 s) not reached |
| Deep seeds 1, 2, 24301 | — | stopped early once the PR seeds failed; partial logs only |

## Results (run 4)

| Check | Exit | Result |
| --- | --- | --- |
| `pnpm census` | 0 | 10 projects, 15,656 tests; the census-seed fuzz finishes |
| `check:expects` | 0 | |
| `oracle:update` | 0 | after the last harness edit |
| `conformance:checks` | 0 | |
| diff self-tests | 0 | |
| Root biome | 0 | |
| `ratchet --update` | 0 | +0; 3,046 |
| typecheck | 1 | only the known gap (`ai-harness`, `cli`, `mcp`) |
| PR seeds, one at a time, 8 GB heap | 1 | on 13fa776c: d, 1, 2, 3, 4, 10, 12, 13, 18, 19 pass; 5, 8, 14, 16, 17, 20 failed on shapes the run-4 fixes then covered (replays 0 unexplained); 6 and 15 are stops. Not re-run on the fix commit; 7, 9, 11 and the deep seeds not run in run 4 |

## Results (run 5)

| Check | Exit | Result |
| --- | --- | --- |
| `pnpm census` | 0 | 10 projects, 15,722 tests; the census-seed fuzz compares 422 cases, all on v2 too |
| `check:expects` | 0 | |
| `oracle:update` | 0 | after the last harness edit |
| `conformance:checks` | 0 | 253 passed |
| diff self-tests | 0 | 674 tests (66 new in run 5, `l12-gate-run5.test.ts`) |
| Root biome | 0 | |
| `ratchet --update` | 0 | +0, none lost; 3,046 |
| `pnpm -r --filter './packages/*' typecheck` | 1 | only the known gap (`ai-harness`, `cli`, `mcp`); core, core-next, conformance pass. Not rerun after the last three groups of changes; conformance's own `tsc --noEmit` exits 0 on the final tree |
| PR seed 17 at L12 on the final tree (after the widening; nohup, 8 GB heap) | 1 | at the 120 s limit: timed out with no difference reported (`$G/r5/pr7-seed-17.log`); again at the 1,800 s limit: **exits 1** in 104 s on `pr17f`, 1 difference (Stops (run 5); `$G/r5/slow7-seed-17.log`). The other 20 seeds were not rerun: the widening changes only `markAfterCancel` and the three entries' reasons |
| All 21 PR seeds at L12, one at a time, 8 GB heap, on d29001ab (after the `pr17d` entries, before the widening; nohup) | 1 | d, 1, 2, 3, 4, 5, 6, 8, 10, 12, 13, 14, 15, 16, 18, 19, 20 exit 0 (120 s limit); **17 exits 1** on `pr17e` (closed by the widening, above); 7, 9, 11 exit 0 (1,800 s limit; 374, 496 and 604 s) |
| PR seed 17's reruns between the entries | 1 | after the error-shape entries: its third shrink `pr17c` (the logging plugin's lines between the cancel's records, a marker gap, fixed), then `pr17d` (signed on the owner's 2026-11-23 answer, above); after the `pr17d` entries: exits 1 on `pr17e` (widened on the owner's second 2026-11-23 answer, above); after the widening: exits 1 on `pr17f` (Stops (run 5)) |
| Replays of the hard failures | 0 | PR 6, 11, 15 (both shrinks), 17 (first shrink), deep 1, 2, 24301: 0 unexplained each; the no-facts and no-watch twins: 0 differences. On the final tree: `pr17d`, `pr17`, `pr17b`, `pr17c` 0 unexplained each (`$G/r5/replay/k1-*`); `pr17e` 3 unexplained (`k2-*`). On the final tree, after the widening: `pr17`, `pr17b`, `pr17c`, `pr17d`, `pr17e` 0 unexplained each (`$G/r5/replay/q1-*`); `pr17f` 1 unexplained (`q2-*`, the stop) |
| Deep seeds 1, 2, 24301 | — | not rerun (run 5's brief). Run 4's report: each exited 1 on one hard failure, now covered (above), and reported 5, 7 and 5 batched cases (triaged above and in the follow-ups) |

## Stops (run 5)

- **PR seed 17, its sixth case (plugin phase, no plugin on, the trace
  option on): `pr17d`'s shape, with one record of 1.35's second cancel left
  unexplained because the streams' pairings cross.** Found by seed 17's
  rerun on the final tree, after the widening. Shrunk case
  `$G/r5/specs/pr17f.json` (1 difference); traces
  `$G/r5/replay/q2-pr17f.v1.jsonl`, `.v2.jsonl`. After a `goTo`, both
  engines report the batch run complete, the requirement met and one cancel
  of it (v2 143 to 145); 1.35 reports the cancel twice (v1 142 to 144 and
  145 to 147). That is the shape the owner's two 2026-11-23 answers cover;
  the engines do nothing new here. The comparison aligns each stream on its
  own, and in this case the two cross. The hook stream pairs 2.0's cancel
  hooks with the hooks of 1.35's *second* cancel, so the first cancel's two
  hooks are missing and row t's `l12-cand-t-batch-completed-*` covers them
  (after met). The observe stream pairs 2.0's requirement.canceled with
  1.35's *first*, so 1.35's second requirement.canceled (v1 147) is
  missing. No shared match point is set inside a crossing, so that record's
  point is (141, 142), before 2.0's cancel. `markAfterCancel` reads 2.0's
  lifecycle through that point, finds no cancel on 2.0, and leaves the
  record unmarked: 1 unexplained. The 2.0-side bound is the same as before
  the widening, so the gap was there on d29001ab too (by reading; that
  commit was not rerun on this case). Closing it means reading 2.0's side
  past a crossing: harness code beyond this entry's matcher, with all 21
  PR seeds to rerun. Coordinator or owner call. No engine code was changed.

Closed in run 5, all from PR seed 17:

- its second shrink (a batch run that errored, then is canceled; `pr17b`),
  by the row-t error-shape entries;
- its fourth case (a finished batch run canceled twice on 1.35 after a
  `goTo`; `pr17d`), by the entries signed on the owner's "2.0's single
  cancel; sign it (Recommended)" (2026-11-23);
- its fifth case (the same after a batch run that errored; `pr17e`), by
  widening those entries on his "Widen to any outcome (Recommended)"
  (2026-11-23).

Run 4's two stops are closed: PR seed 6 by the (bx) error-pairing entries,
PR seed 15 by quirk b's batch-pairing entries.

## Stops (run 4)

- **PR seed 6 (plugin phase), with a fact-including watch:** 2.0 reports
  the onError/onErrorRecovery "skip" of `a.d1` and `a.d2` (both "throws at
  5") in the opposite order to 1.35 in step 9, four times; with the watch's
  facts empty the case passes, so it is (bx)'s read, but an order swap of
  two derivations' errors is not a shape any row names. Spec
  `$G/r4/specs/r4pr6.json`, traces `$G/triage/replay/r4c-r4pr6.v1.jsonl`,
  `.v2.jsonl`.
- **PR seed 15 (plugin phase), no watch:** in step 1 1.35 reports resolver
  errors for `a::r0` then `a::rb`; 2.0 reports `a::rb` first and cancels
  both requirements ("canceled" in onReconcileEnd), 21 differences. Not
  (bx); not matched by an approved row. Spec `$G/r4/specs/r4pr15.json`,
  traces `$G/triage/replay/r4c-r4pr15.v1.jsonl`, `.v2.jsonl`.

## Stops (run 3)

- **(bx)'s knock-on, shapes the run 3 entries do not cover** (PR seeds 2,
  3, 6, 8, 10, 15, 17, 19; all with a fact-including watch). A watch
  callback missing on 2.0 (6, 8, 17), derivation computes, invalidations
  and notifies extra on 2.0 that are not one-step moves (3, 10), a moved
  compute whose dependency list holds `derive.d0` (2, outside
  `dependencyKeys`), and a compute whose id differs (19). Specs
  `$G/specs/pr<seed>.json`, logs `$G/r3pr-seed-<seed>.log`. They look like
  (bx)'s consequence, but each needs its own narrow entry and proof.
- **The logging plugin's echo of approved rows, unsigned** (PR seeds 4, 13,
  16, 20; logging, no watch): e.g. seed 4, 2.0 logs "[Directive]
  resolver.write.rejected" at warn where 1.35 logs facts.batch (the batch
  clobber rows). Each needs a log twin under its row, as run 1 did for (az)
  and (bi).
- Seeds 5 and 18 time out at 120 s; seed 14's worker died.

## Follow-ups

- Decide run 5's stop: PR seed 17's `pr17f`, the approved second-cancel shape where the hook and observe pairings cross (a gap in `markAfterCancel`'s 2.0-side bound; harness only).
- All 21 PR seeds on the final tree: locally 20 ran on d29001ab and only seed 17 after the widening.
- A gate=L12 mutation run on this branch to confirm the 18 entries killed only locally (the coordinator dispatches it after pushing).
- Deep seeds 1, 2 and 24301 in full once seed 17 is decided.
- The reported batched cases of run 4's deep seeds, one line each (run-5 replays, `$G/r5/replay/cases-*`; none has an entry in this PR):
  - 1/1, 2/2, 24301/1, 24301/4: completion and met records on the other side of a reconcile pass in a `settle` step (the same records, extra and missing). Row (as), as 24301/1 above; needs its entry and probe.
  - 2/6: row (at) with quirk g in a `twin` step, as above; needs its entry and probe.
  - 24301/2: quirk b's batch pairing; the run-5 entries cover it (0 unexplained).
  - 2/3: a single run's error paired with a batch timeout error just before quirk p's stop (6 onError changes), no batch error unpaired on 1.35. Untriaged.
  - 1/2: one batch `start` changed after quirk g's stop (`l7-fuzz-g-after-*`). Untriaged.
  - 1/3: 9 changes in history steps after quirk h's stop. Untriaged.
  - 1/4: batch `start` and `wrote` changed in an `advance` step after quirk b's batch stop. Untriaged.
  - 1/5: three reconcile passes missing on 2.0 after quirk g's stop. Untriaged.
  - 2/1: two fallback `start` changes after quirk p's stop. Untriaged.
  - 2/4 (up to L12): one batch `start` missing and three `onReconcileEnd` changes in a `settle` step. Untriaged.
  - 2/5 (data forms): one `onResolverRetry` extra and one missing in a `settle` step. Untriaged.
  - 2/7 (plugins, with a fact-including watch): 11 changes in a `ledger` step's record. Untriaged; (az)'s or (bx)'s ledger echo is the first thing to check.
  - 24301/3: one batch `wrote` missing after quirk g's stop. Untriaged.
  - 24301/5 (up to L12): one `onReconcileEnd` extra and one missing after quirk a's stop. Untriaged.
- `/principal` on L12 (the RFC's gate row).
