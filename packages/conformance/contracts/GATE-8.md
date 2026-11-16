# Phase 3 gate decisions: the L9 gate

Date: 2026-11-16. Jason approved the L9 trace RFC (`rfc-l9-trace.md`,
revision 2, "Decisions for the owner") on 2026-11-15 with "I approve you for
to do everything", under which Claude took each recommended option, and
asked Claude to sign the entries for the approved rows on his behalf, as at
the earlier gates (GATE-2.md, rule 1). This record is of gate run 1 of at
most 3 (A3).

## What the L9 gate does

`layers.rules.json` `current` is `"L9"`: core-next runs every test and every
differential scenario placed at L9 or below (the trace, meta and tags, the
counters, observe, explain and notify), and the fuzz compares its trace
cases on v2, the ring (`maxRuns` 1, 3 and 100) and meta included. The ratchet
(`v2-passing.json`) gained 99 tests and lost none, tested by name; it holds
1,977.

**Five stops are open** (below, "Stops"). Five tests of
`l9-meta-trace-gate-debt-oracle`, which L9-pre-b wrote to kill 1.35 mutants
after L9a and L9b were built, pin 1.35 behaviour 2.0 does not share, and no
approved row covers any of them. None is a 2.0 bug a user would call worse,
so each needs Jason: a row to sign, or an engine fix. The L8 gate's stop (the
two `./internals` names) carries into this branch unchanged.

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

- The (bi) `ends` entry is wider than the extra report: 8:all#181 and
  12:all#149 have as many reports on each engine in the step, 2.0's report of
  the dropped run where 1.35 reports a later run, so no pairing leaves the
  extra on its own and each later pair is one run off. It stops at the first
  pair whose 2.0 run started a resolver and whose 1.35 run started none
  (`resolversStarted[0]` absent on 1.35), only with `traceRing`.
- The (bb) entry covers a changed derivation id in any `back` step of a
  `changesetMoved` case. It cannot name the snapshot the undo lands on, so a
  2.0 restore bug in such a step would also end there. `during` reads the
  history op from the run label now (below).
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

**The checks, run 1.**

| Check | Exit | Result |
| --- | --- | --- |
| `v2`, `v2:dist`, `v2:prod` | 1 | 364 files: 3,796 passed, 2,874 skipped by the layer gate; 10 failed, the five stops on v2 and v2:dist. The (bh) pins pass |
| `conformance:diff`, without the fuzz | 0 | 53 files, 477 tests (after the batch-trigger self-test's fix; run 1 found it) |
| `check:expects` | 0 | 191 files, 7,324 assertions, identical to a fresh port |
| `oracle:update` | 0 | rerun after the last entry change |
| The 21 PR seeds | 0 on 15; 6 timed out | seeds 1-4, 6, 8, 10, 12-17, 19, 20 exit 0 in 37 s or so each. Seeds 5, 7, 9, 11, 18 and 24301 hit the 120 s test timeout while three deep seeds and the census ran beside them; rerun with a longer timeout, 5 and 18 exit 0 (111 s, 137 s); 7, 9, 11 and 24301 were still running at handoff. No seed reported a difference |
| `pnpm census` | 1 | run 1: 102 problems, from the five stops, the L8 stop, three entry-shape faults since fixed (an `ends` changed entry with no `path`, three row t entries in the `quirk-t` group with another `when`) and 71 stale groups, all because its own fuzz run timed out under load and reported no runs. Not rerun yet |
| `conformance:checks` | pending | run 1's census saw the L8 stop's failures and two oracle.test.ts failures from the entry-shape faults above |
| Root biome, error level | pending | the changed files pass `biome check` |

## Deep runs: report mode (A2)

Run as the nightly does (`DIFF_FUZZ_RUNS=5000 DIFF_FUZZ_BATCH_REPORT=1`, an
8 GB heap), the three seeds in parallel with the PR seeds.

| Seed | Exit | Time | Runaways (after a stop) | Never settles | Reported cases |
| --- | --- | --- | --- | --- | --- |
| 1 | running at handoff | | | | so far all:857, all:1028, all:1395, all:2195 |
| 2 | 0 | 22 min | 10 (3) | 28 of at most 70 | all:2247, all:2890, all:3992 |
| 24301 | 0 | 22 min | 13 (2) | 32 of at most 70 | all:175, all:422, all:687, all:2654, all:3053 |

Every reported case is batched and is one L9b's deep triage listed
(`deep-report.md`): L7 batch shapes, (ap) with no clobbering single
resolver (2:all#2890, 24301:all#422), and 24301:all#175, 2.0's runaway after
an `ends` stop. None is new, and the up-to-L9 phase reported none on seeds 2
and 24301.

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

- **Five L9-pre-b pins differ on 2.0 and match no approved row**
  (`l9-meta-trace-gate-debt-oracle`, v2 and v2:dist, 10 failures):
  1. "destroy() forgets module and event meta" and 2. "destroyAsync() forgets
     module and event meta, and empties the trace": 1.35 clears its module and
     event meta maps at destroy (engine.ts:3504-3506, 3552-3554); 2.0's meta
     part keeps them (meta.ts:152-154; no dispose hook). 1.35 keeps the other
     definitions' meta, so this is a 1.35 quirk, not a leak.
  3. "freezes t's own types, leaves a Zod-like schema and a function type as
     given": 2.0 freezes a function that carries `_typeName` (meta.ts:76 has
     no `typeof` check); 1.35 freezes objects only (engine.ts:253-259). 2.0
     freezes the caller's object, reachable only through a hand-made branded
     function.
  4. "with no plugin configured, an observer hears no reconcile.end; with one
     it does": 1.35 emits `reconcile.end` only with configured plugins
     (engine.ts:2180) though `reconcile.start` goes to any observer; 2.0
     emits both to any listener (core.ts:1425). 2.0 is the symmetric one.
  5. "explain() of a requirement whose constraint has no dependency record":
     1.35's `disable()` deletes the dependency record (constraints.ts:777),
     so explain lists every fact; 2.0 stores an empty set (constraints.ts:648),
     so explain lists none. Its comment says "As 1.35".

  Each needs Jason: approve a row (then the pin keeps what both share and a
  core-next test pins 2.0's side), or an engine PR that matches 1.35 (5 and 3
  look like parity slips; 1, 2 and 4 like 1.35 quirks). The gate may not touch
  `packages/core-next/src`.
- **The L8 gate's stop, carried:** `./internals` `createHistoryManager` and
  `createDisabledHistory` (`conformance:checks`, 9 failures; the census's
  "vitest exited 1"). Unchanged.

## Follow-ups

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
