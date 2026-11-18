# Phase 3 gate decisions: the L9 gate

Date: 2026-11-16. Jason approved the L9 trace RFC (`rfc-l9-trace.md`,
revision 2, "Decisions for the owner") on 2026-11-15 with "I approve you for
to do everything", under which Claude took each recommended option, and
asked Claude to sign the entries for the approved rows on his behalf, as at
the earlier gates (GATE-2.md, rule 1). This record is of gate run 1 of at
most 3 (A3), of run 2, and of the owner's ruling on 24301:all#175
(2026-11-17, "Seed d", below).

## What the L9 gate does

`layers.rules.json` `current` is `"L9"`: core-next runs every test and every
differential scenario placed at L9 or below (the trace, meta and tags, the
counters, observe, explain and notify), and the fuzz compares its trace
cases on v2, the ring (`maxRuns` 1, 3 and 100) and meta included. The ratchet
(`v2-passing.json`) gained 99 tests and lost none, tested by name; it holds
1,977.

**Run 2: the five stops are fixed, and the gate is not yet green.** #403
(main 23a79c73) matched 1.35 on all five stops of run 1, and this branch
merged it: the five `l9-meta-trace-gate-debt-oracle` pins pass on v2 and
v2:dist. Two problems are open (below, "Stops"). The PR seed CI runs (24301)
fails at L9 on a 2.0 hang in a batched case, and three other PR seeds pass
only past CI's 120 s test timeout. The L8 gate's stop (the two `./internals`
names) carries into this branch unchanged.

## Seed d: the owner's ruling, and the rule change (2026-11-17)

The question: "may a missing-record stop count at the 2.0 index of the last
paired record before it, under 'Discard after the stop'?". Jason's answer,
verbatim: "Approve the wider wording (Recommended)".

- **The rule change** (diff/scenario.ts `stopsBefore`, README "fuzz"
  section). A missing-record stop now also counts as first when the
  engine's index of the last paired record before it (the stop's shared
  match point, `Difference.shared.candidate`) is strictly below the point
  the engine outworked the reference. The segment test stays as it was. A
  missing stop with no paired record before it (the start, index -1), or
  whose last paired record is at or past that point, is still a hang. Extra
  and changed stops still count at their own record's index. Nothing else
  changed.
- **Self-tests** (diff/self/runaway-after-stop.test.ts, block (f)): 24301:all#175's
  shape (a missing stop in the runaway's own step, after a paired record)
  is now discarded; a missing record with no stop before it (no entry, or
  an ordinary entry) is still a hang; an extra record after the stop is
  dropped by the existing shared-point rule, so the case is still
  discarded; an extra-record stop past the point is still a hang; and a
  real difference before the missing stop still fails the discarded case.
  With the widening switched off, the first, third and fifth fail, so the
  block tests the change. The older (c) case (a missing stop in the
  runaway's segment, with no record paired before the runaway) is still a
  hang.
- **Seed d's result.** PR seed 24301 at L9 exits 0 in 35 s: 287 cases, 2
  runaways discarded, 1 of them after a stop, stopped by
  `l7-fuzz-b-hook-onError-missing-batchFails` ×1. That is 24301:all#175,
  inside the runaway limit. It no longer fails, shrinks or times out.

## The L9 decisions

| Row | What it decides | Outcome |
| --- | --- | --- |
| A1, size | The trace and meta live in parts wired by `createSystem`; +3.0 KB on four fixtures, +60 B on `floor` | Taken under "I approve you for to do everything", 2026-11-15 |
| A2 and A3 | Deep runs report while the 21 short seeds gate; a real 2.0 bug still blocks; 3 gate runs at most | Taken, as at L7 and L8 |
| (bh) | The trace cannot be edited through a read: the array and each settled entry are frozen | Taken; built in L9b (#395) |
| (bi) | Every run reports `onTraceComplete` once, a run pushed out of the ring too | Taken; built in L9b (#395) |
| (bj) | The observer cap warns in production | Declined; 1.35's pin U7 stands; no entry |
| B1 to B4 | The fuzz additions and harness rules; `trace-100`; `registerKeys` at L10; Claude signs | Taken |

## The signed entries

Every entry carries `approvedBy: "Jason Comes"`, and each reason names its
row and ends with the signing sentence quoting that row's approval: (bi)
"I approve you for to do everything" (2026-11-15); (bb) "Approve all as
recommended (Recommended)" (2026-11-10); row t "If all are better or non user
facing they are all approved." (2026-11-01); (ap) and (at) "Approve all
(Recommended)" (2026-11-05); (av) "Approve: once (Recommended)"
(2026-11-07).

| Row | Hand entries (records) | Fuzz entries |
| --- | --- | --- |
| (bi) | 2 (2): U2's dropped run and its `maxRuns` 0 run | 2: the extra report (`traceRing`, `traceRunWithResolvers`), and an `ends` entry for a report paired one run off (below) |
| (bb) | 0 | 1: the first changed invalidation of a `back` step (`changesetMoved`, `during` "back", `ends`; 11:all#175) |
| Row t, under `disable` | 0 | 3: the cancel hook, the requirement hook and the observe event, missing on 2.0 (`disableRetracts`; 1:all#4038) |
| Row t, batch path | 0 | 1: r0's cancel paired with the queued item's (`batchWriteRetracts`, `ends`; 24301:all#3397) |
| (av)+(at) | 0 | 1: the fallback run's start, missing on 2.0 (`batchFallback`, `batchAbortOn`, `batchMaxSize`, `ends`; 7:all#187, 2:all#2625, 24301:all#2659) |
| (ap) | 0 | 1: the early start (`batched`, `batchAbortOn`, `batchClobbered`, `ends`; 18:all#156) |
| **Total** | **2** (2 records) | **9** |

**Width read.** Every entry was read against its row.

- **Why the two `ends` entries need `ends`.** After the first record each
  covers, every later record of the case is paired wrongly or reads other
  state, so no list of plain entries could name them without being wider
  than the row. In the (bi) case, 2.0 reports a run that 1.35 dropped, so
  every later report is paired one run off (8:all#181: 153 later
  differences; 12:all#149: 151). In the (bb) case, the undo lands on another
  snapshot, so every later record reads other facts (11:all#175: 116).
- **Run 2 narrowed both with `requires` (order any).** Each now also needs
  its row's own mark elsewhere in the case.
  - The (bi) entry needs an `onTraceComplete` call 2.0 makes and 1.35 does
    not. 2.0 reports the dropped run, so over the case it reports one more
    time than 1.35 (8:all#181: extras in steps 8 and 12; 12:all#149: in step 1).
    A `traceRing` case in which no run was pushed out has as many reports on
    each engine, so it is outside the entry.
  - The (bb) entry needs a changed `onHistoryNavigate`: the undo lands on
    another index (11:all#175, step 8, `args[1]`). A `back` that lands on
    the same snapshot on both engines is outside it, whatever it
    invalidates.
  - All three cases still pass. Seeds 12 and 13 ran after the change and
    pass. What is left: each entry still covers its first record in any
    case of its trigger that also has the mark. `traceRing` and
    `changesetMoved` are the rows' own preconditions, and the spec cannot
    say more before the run.
- The (bb) entry cannot name the snapshot the undo lands on. `during`
  reads the history op from the run label now (below).
- The (ap) draft used `when` [batched, batchAbortOn] and was wider than the
  row. It is narrowed by `batchClobbered`: a single resolver of module a
  writes the fact the bound requirement's `abortOn` names, the row's own
  mechanism. Two deep cases of the draft's three (2:all#2890, 24301:all#422)
  have no single resolver and stay report-mode follow-ups.
- The (av)+(at) start entry ends the case, so its drafted twins (the write,
  the completion and the met records after it) were not needed and were not
  added. The same holds for row t's batch twins.

## The harness changes

Each ships with a self-test that fails without it.

| Change | Why | Self-test |
| --- | --- | --- |
| Trace ids by order: `traceIdProblems` checks every engine, the reference too; `inspect().trace` ids strictly increase, and no run is reported twice | #392's review: the id was compared by type only | `diff/self/trace-contract.test.ts`: a repeated, a non-monotonic and a non-integer id fail |
| An empty `anomalies` list is not an absent one | 1.35 writes the field only when it has one (core `engine-trace.ts:345`) | the same file: `[]` differs from absent; a duration-only list is still left out |
| `onTraceComplete` records pair by their projected run among the longest pairings (`traceRunText`) | (bi)'s extra report shifted every later report by one | a lone extra is one extra; a changed run is still changed; a missing run is still missing |
| An `ends` stop drops a missing record whose equal twin it drops (`shiftedTwins`) | quirk a's extra pass left `onResolverComplete` unpaired on both engines, and only 2.0's copy was dropped (19:all#25, 2:all#93) | the twin passes; a different payload, a record 2.0 lacks and a true extra before the stop still fail; no `ends`, nothing dropped |
| `stepOps` reads a history op from its run label | the L8 gate's follow-up: `during` could not name `back` | `diff/self/l9-triggers.test.ts` |
| Triggers `traceRing`, `disableRetracts`, `batchWriteRetracts`, `batchClobbered`; classes `traceRunWithResolvers`, `derivation`, `batchItems` | the entries above | `diff/self/l9-triggers.test.ts`, each with the nearest spec that lacks it |
| U2/U8's `look` step projects `anomalies` | #392's review: it recorded a duration anomaly raw | `diff/scenarios/l9-trace-pins.test.ts` passes |

`disableRetracts` was checked against 1:all#4038 with r1's timeout removed:
the case then passes with no entry, as the trigger's comment says.

## The pins

| Pin | Row | What still runs on both | 2.0's side pinned by |
| --- | --- | --- | --- |
| U1 (a), "two reads are one array" | (bh) | the same array on a repeat read | core-next `l9b-trace` "(bh) a read cannot edit the trace" > "the array is frozen and is the same array until the next change" |
| U1 (b), "inspect().trace holds what system.trace holds" | (bh) | the copy's chain and id match the live entry | the same block > "a settled entry is frozen one level into its lists and rows, not into values or meta" |
| U12, "the entry it is handed is the run system.trace ends with" | (bh) | the plugin is handed the trace's own last entry | the same block > "a plugin that edits the entry it is handed throws, and the error is logged" |

Edited in `packages/core`'s original and re-ported (#339's mechanism).

## The mutation conversion

`current` is L9, so the 135 `feature-layer` L9 entries (engine.json 132,
schema-builders.json 3) become `later-layer`. The RFC's 160 was counted
before L9-pre-b killed or moved some. **The gate=L9 run 43815165003 cannot
name their killers**: it ran on main at ea25c6ff, before L9-pre's tests were
written, and records 110 of them NoCoverage, 23 Survived and 2 both. Each
note keeps the killer L9-pre-b's local run at ceiling L9 named, and says a
gate=L9 run of this branch confirms the kill before merge (follow-ups).

## Results

**The checks, run 2** (after merging main at 23a79c73 and rebuilding core
and core-next). Each exit code, and what fails:

| Check | Exit | Result |
| --- | --- | --- |
| `v2`, `v2:dist`, `v2:prod`, `v2:dist:prod` | 0 | 384 file runs: 3,888 passed, 2,876 skipped by the layer gate, 0 failed. The five pins and the (bh) pins pass |
| `npx vitest run --project conformance:checks` | 1 | 10 failures: the L8 stop's 9 in `contracts/api-surface-next.test.ts`, and `oracle.test.ts` "accepts the committed harness", because the lock was stale after the entry change. `oracle:update` then refreshed the lock (35641eb9) |
| `oracle:update` | 0 | after the entry change |
| `pnpm census` | 1 | 86 problems, run on a quiet machine. 10 are the L8 stop's: the 9 `api-surface-next` failures and "conformance:checks: vitest exited 1". 3 are the fuzz stop's: seed 24301 times out (Stops), so `conformance:diff` exits 1 and "the fuzzer reported no runs". 72 stale entries follow from that: with no fuzz runs reported, no fuzz entry covers anything. 1 is the harness lock, staled by this file's edit while the census ran; `oracle:update` refreshed it, and `oracle.test.ts` passes after that |
| Root biome, error level | 0 | 1,467 files |
| The 21 PR seeds, at CI's 120 s | 1 on 4 | 17 exit 0 (17 to 89 s each). 24301, 7, 9 and 11 time out (below, "Stops") |

**Run 3** (2026-11-17, after merging main at 386f23bf: the L8 gate, L9-pre-a
and L9-pre-b, and the seed d rule change):

| Check | Exit | Result |
| --- | --- | --- |
| The 21 PR seeds at L9 (7, 9 and 11 with a 1,800 s limit) | 0 each | 24301 35 s; 7 410 s, 9 490 s, 11 481 s; the other 17 19 to 83 s. Run 3 at a time |
| diff self-tests (`diff/self`) | 0 | 19 files, 317 tests |
| `check:expects` | 0 | |
| `ratchet --update` | 0 | added 0, lost 0; holds 2,171 (the union of both sides) |
| core-next `test`, `typecheck` | 0, 0 | 71 files, 678 passed |
| Root biome, error level | 0 | 1,481 files |
| `oracle:update`, then `conformance:checks` | 0, 0 | 12 files, 246 passed. The L8 stop's 9 `api-surface-next` failures are gone (#402 on main) |
| `pnpm census` | 1 | 7 problems, all stale fuzz entries (Stops) |

**Run 3, after the pins** (2026-11-17, five cases added to
`diff/fuzz/pinned.json`, Stops):

| Check | Exit | Result |
| --- | --- | --- |
| `oracle:update` (no `node_modules` or `.vite` under contracts, helpers, self, lib or diff) | 0 | |
| `check:expects` | 0 | |
| `conformance:checks` | 0 | 12 files, 246 passed |
| diff self-tests (`diff/self`) | 0 | 19 files, 317 tests |
| Root biome, error level | 0 | 1,481 files |
| `pnpm census` | 0 | seed 24301, 287 cases (205 + 82 up to L9); no stale entry. Run again after this table's edit, with `oracle:update` and `conformance:checks` first |

**CI's timeout.** CI runs one fuzz seed, the fixed 24301, inside `pnpm
census`. The census runs the `conformance:diff` project with no override, so
it gets that project's `testTimeout: 120_000` (vitest.config.ts). The other
20 seeds are the gate's own, under the same timeout. Run 2 ran them 3 at a
time with nothing else heavy beside them.

**Run 1** (for the record): v2 failed only on the five stops, since fixed.
`conformance:diff` and `check:expects` exited 0. The census failed with 102
problems, under load.

## Deep runs: report mode (A2)

Run as the nightly does (`DIFF_FUZZ_RUNS=5000 DIFF_FUZZ_BATCH_REPORT=1`, an
8 GB heap), the three seeds in parallel with the PR seeds.

| Seed | Exit | Time | Runaways (after a stop) | Never settles | Reported cases |
| --- | --- | --- | --- | --- | --- |
| 1 | 0 | 33 min | (in the log) | 34 of at most 70 | all:857, all:1028, all:1395, all:2195, up to L9#224, up to L9#1959 |
| 2 | 0 | 22 min | 10 (3) | 28 of at most 70 | all:2247, all:2890, all:3992 |
| 24301 | 0 | 22 min | 13 (2) | 32 of at most 70 | all:175, all:422, all:687, all:2654, all:3053 |

Every reported case is batched and is one L9b's deep triage listed
(`deep-report.md`): L7 batch shapes, (ap) with no clobbering single
resolver (2:all#2890, 24301:all#422), and 24301:all#175, 2.0's runaway after
an `ends` stop. Seed 1 finished after run 1's handoff, on the engine before #403.
Its two up-to-L9 cases were replayed on this branch, and both still fail
the same way. Neither has a trace trigger.

- **1:up to L9#224** (`disable`, `batchWriteRetracts`): in step 10, 2.0
  rejects a batch resolver's write to f2, where 1.35 writes it. This is row
  t's batch path, which is approved. L9b's triage listed it already.
- **1:up to L9#1959** (`batchWriteRetracts`): in step 8, 2.0 lacks a batch
  write that 1.35 makes, and then (av)'s `onError` entry ends the case. This
  is an L7 batch shape: a report-mode follow-up, not a 2.0 bug.

None is L9's, and the up-to-L9 phase reported none on seeds 2 and 24301.

**The four unverified L8 batch cases**, regenerated by index from seed
24301's up-to-L8 phase (the generator was checked against deep case 1:all#857
first, and matches it):

| Case (L8 gate numbering) | Now | Triage |
| --- | --- | --- |
| 24301:up to L8#161 | passes | the (av)+(at) start entry ends it at step 11 |
| 24301:up to L8#593 | 21 unexplained | an `onError` of a batch member paired with another error in step 7, where (av)'s `l7-fuzz-av-hook-onError-missing` ends the case: the pairing fallout of an approved row, not a 2.0 bug |
| 24301:up to L8#630 | 6 unexplained | the same shape in step 2, ended by quirk h's `onErrorRecovery` entry: pairing fallout |
| 24301:up to L8#948 | 17 unexplained | a batch write and completion in step 12 on 1.35 that 2.0 makes at step 14 (quirk g's stop): batch timing; not proven either way, a follow-up |
| 24301:up to L8#1917 | 1 unexplained | a batch start missing in step 5, ended in the same step by quirk k: an L7 batch shape |

None is a 2.0 bug a user would see as worse, as far as the first differences
show. #948 needs a replay with both traces to say which row it is.

## Stops

- **Run 1's five stops are fixed by #403** ("core-next: five L9 gate parity
  fixes, as in 1.35"). 2.0 now matches 1.35 on all five: meta is forgotten
  at destroy and at destroyAsync; only t's own types are frozen;
  `reconcile.end` is sent only with a plugin; and explain works after
  `disable`. The pins pass on v2 and v2:dist, with no entry and no row.
- **PR seed 24301 fails at L9, and this is the seed CI runs.** Case
  24301:all#175 is batched, with `batchFails`, `batchRetry` and
  `ignoresAbort`. 1.35 settles after 11 timer callbacks. 2.0 makes more than
  20,000, after `l7-fuzz-b-hook-onError-missing-batchFails` ends the
  comparison at step 7.
  - In that step, 2.0 retries the failing batch where 1.35 reports
    `onError`. Then resolvers r0 and r1, which ignore their aborts, keep
    rewriting f0 and re-raising each other's constraints: 3,337 writes by r0
    and 3,319 by r1.
  - The stop is a record 2.0 lacks, in the same step as the runaway's start.
    `stopsBefore`'s rule (Jason, 2026-11-02: "Discard after the stop") keeps
    that a hang. The case fails as `ok: false` with no `runaway` flag. In PR
    mode it throws, and fast-check shrinks it. Each shrink step replays a
    trace of about 395,000 records, so the seed runs into the 120 s timeout.
  - Replayed alone, the case takes 11 s and is the seed's only failure.
  - L9b's triage put it under "harness". Under the committed rule it is a
    hang, and it is new at L9 only because trace cases first run on 2.0 now.
  - It needed Jason: is a 2.0-only livelock after a batch-retry stop a 2.0
    bug, or should the discard rule cover a missing stop in the runaway's
    own step? The gate may not touch `packages/core-next/src`.
  - **Resolved (2026-11-17)**: Jason approved the wider wording ("Seed d",
    above). The case is discarded after the stop, and seed 24301 exits 0.
- **Run 3: the census finds seven signed L9 fuzz entries stale.** With
  seed 24301 now passing, the census sees which entries its 287 cases use.
  Five groups' entries cover nothing on that seed: `row-bb`
  (`l9-fuzz-bb-hook-onDerivationInvalidate-changed-back`), `quirk-t-disable`
  (three entries), `quirk-t-batch`
  (`l9-fuzz-t-batch-write-retracts-hook-onResolverCancel-changed`), `row-av`
  (`l9-fuzz-av-at-fallback-external-start-missing`) and `row-ap`
  (`l9-fuzz-ap-external-start-early-flush`). Their evidence is on other
  seeds or deep runs (11:all#175, 7:all#187, 2:all#2625, 24301:all#2659,
  24301:all#3397). Run 2 could not see this, as 24301 timed out. This is
  not a merge leftover, and signed entries are not removed: the L8 gate's
  fix for the same shape is a pinned case per group in
  `diff/fuzz/pinned.json`, regenerated by index from its seed.
  - **Closed (2026-11-17): one pinned case per group.** Each case was
    rebuilt by index from its seed's across-every-layer phase (fast-check
    `sample` with the seed; the rebuilt cases cover the entries their notes
    name, which checks the generator) and replayed alone on 1.35 and 2.0:
    every one is compared on v2, uses its group's entries and has 0
    unexplained differences.

    | Group | Pinned case | Entries it uses | Differences | Time |
    | --- | --- | --- | --- | --- |
    | `row-bb` | 11:all#175 | the (bb) `back` entry | 117 | 0.7 s |
    | `quirk-t-disable` | 1:all#4038 (deep) | all three `l9-fuzz-t-disable` entries | 4 | 0.1 s |
    | `quirk-t-batch` | 24301:all#3397 (deep) | `l9-fuzz-t-batch-write-retracts-hook-onResolverCancel-changed` | 37 | 0.1 s |
    | `row-av` | 24301:all#2659 (deep) | `l9-fuzz-av-at-fallback-external-start-missing` | 14 | 0.1 s |
    | `row-ap` | 18:all#156 | `l9-fuzz-ap-external-start-early-flush` | 22 | 0.1 s |

    For `row-av`, 7:all#187 and 2:all#2625 also pass with the entry, but
    7:all#187 takes 292 s alone, so the fast deep case is pinned. The pins
    run first in the up-to-L9 phase, so that phase's later case numbers move
    up by five. No entry was widened, removed or re-signed. The census then
    finds no stale entry and exits 0 (below, "Run 3, after the pins").
- **Three PR seeds need longer than CI's 120 s, though no case fails:**
  - Seed 7 takes 354 s. Case 7:all#187 (`traceRing`, `batchFallback`,
    `batchClobbered`) passes, but takes 340 s alone: 81,296 differences, with
    the (av)+(at) start entry ending the case.
  - Seed 9 takes 414 s and seed 11 times out at 120 s. In run 1 they passed
    with a 900 s timeout (601 s and 606 s).
  - At L8 every seed took about 37 s. The slow cases are trace cases that
    now run on 2.0. Where the time goes (the comparison of a large trace,
    or the explain over its differences) is not profiled yet.
- **The L8 gate's stop, carried:** `./internals` `createHistoryManager` and
  `createDisabledHistory` (`conformance:checks`, 9 failures; the census's
  "vitest exited 1"). Unchanged.

## Follow-ups

- Run 3: profile 7:all#187, then fix whatever in the harness grows with a
  trace that large. Rerun seeds 7, 9 and 11 at 120 s.
- 24301:all#175: done (2026-11-17, "Seed d").
- Pinned cases for `row-bb`, `quirk-t-disable`, `quirk-t-batch`, `row-av`
  and `row-ap`: done (2026-11-17, Stops, run 3).
- A gate=L9 mutation run of this branch, to confirm the 135 conversions.
- A payload tie-break for every record kind, as `traceRunText` does for
  `onTraceComplete`: 24301:up to L8#593 and #630 and L8's 1:all#4271 and
  2:all#2247 are the same pairing fallout.
- 24301:up to L8#948's replay.
- (ap)'s two deep cases with no clobbering single resolver (2:all#2890,
  24301:all#422).
- (bb)'s entry names only the restore's first record when a derivation
  reads a restored fact; a restore whose first record is `onFactsBatch` has
  no entry yet.
