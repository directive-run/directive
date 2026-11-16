# Phase 3 gate decisions: the L9 gate

Date: 2026-11-16. Jason approved the L9 trace RFC (`rfc-l9-trace.md`,
revision 2, "Decisions for the owner") on 2026-11-15 with "I approve you for
to do everything", under which Claude took each recommended option, and
asked Claude to sign the entries for the approved rows on his behalf, as at
the earlier gates (GATE-2.md, rule 1). This record is of gate run 1 of at
most 3 (A3), and of run 2.

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
  - It needs Jason: is a 2.0-only livelock after a batch-retry stop a 2.0
    bug, or should the discard rule cover a missing stop in the runaway's
    own step? The gate may not touch `packages/core-next/src`.
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
- 24301:all#175: Jason's ruling (Stops), then rerun seed 24301 and the census.
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
