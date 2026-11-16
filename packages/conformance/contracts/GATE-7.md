# Phase 3 gate decisions: the L8 gate

Date: 2026-11-16. Jason approved the L8 history RFC (`rfc-l8-history.md`,
revision 2, "Decisions for the owner") on 2026-11-10, and asked Claude to
sign the entries for the rows he approved, on his behalf, as at the earlier
gates (GATE-2.md, rule 1). On 2026-11-15 he wrote "I approve you for to do
everything". This gate is run 1 of at most 3 (A3).

## What the L8 gate does

`layers.rules.json` `current` is `"L8"`: core-next runs every test and every
differential scenario placed at L8 or below (history: snapshots, navigation,
changesets, export and import, `onHistoryChange`), and the fuzz generates v2
cases up to L8 with the history ops in the model. The ratchet
(`v2-passing.json`) gained 115 tests and lost none, tested by name against
the file on main; it holds 1,879.

Each difference the diff harness shows at L8 is recorded in
`diff/divergences.json`: 52 new entries, every one signed. 44 hand entries
are exact, each with `excuses` and counts (44 records). 8 fuzz entries keep
the `when`, bound and group they were drafted with. No entry on main changed
or was removed. Five conformance pins (U3, U6, U8 (a) and (b), U9) keep only
what both engines share, each naming its row (#339's mechanism). The history
export is unchanged byte for byte, and its golden file round-trips both ways.

**One stop is open: `conformance:checks` fails** (below, "Stops"). Two 1.35
`/internals` names, `createHistoryManager` and `createDisabledHistory`, are
listed in `contracts/next-unshipped.json` at L8, and core-next does not ship
them. At `current` L8 the surface gate fails until core-next exports them or
Jason signs their removal; an agent never signs an `api-changes.json` entry.

## The L8 decisions

The middle column says what each row decides, in plain words. The quotes in
the right column are Jason's own words.

| Row | What it decides | Outcome |
| --- | --- | --- |
| A1, size | History lives in a `withHistory` part wired by `createSystem`; `minimal`, `two-module`, `aperture` and the full entry may grow by up to 2.0 KB, `floor` by 0.9 KB | "Approve up to +2.0 KB (Recommended)", 2026-11-10; raised by "Approve +2.4 KB (Recommended)", 2026-11-14 |
| A2 and A3, how L8 is checked | Deep runs report while the 21 short seeds gate; a real 2.0 bug still blocks; the gate is capped at 3 runs | "Approve both (Recommended)", 2026-11-10 |
| (ay) | A navigation puts back the pause it found | "Approve all as recommended (Recommended)", 2026-11-10. Built in L8a (#385) |
| (az) | `replay()` and `import()` tell `onHistoryNavigate` and the listeners | "Approve all as recommended (Recommended)", 2026-11-10. Built in L8a (#385) |
| (ba) | Snapshot ids continue after an import | "Approve all as recommended (Recommended)", 2026-11-10. Built in L8a (#385) |
| (bb) | Changesets follow the buffer, the redo cut and import | "Approve all as recommended (Recommended)", 2026-11-10. Built in L8b (#387) |
| (bc) | An import with a bad index fails | "Approve all as recommended (Recommended)", 2026-11-10. Built in L8a (#385) |
| (bd) | Stored snapshots are not shared with live facts or the `snapshots` list | "Approve all as recommended (Recommended)", 2026-11-10. Built in L8b (#387) |
| (be) | A changeset counts as one of the steps; the start rule stays | "Approve all as recommended (Recommended)", 2026-11-10. Built in L8a (#385) |
| (aw), (ax) | Export, import and the JSON tier keep Date, Map and Set | Deferred to the beta's versioned export, by "Approve all as recommended (Recommended)", 2026-11-10 |
| (bf) | Going back clears facts the snapshot lacked | Declined, by "Approve all as recommended (Recommended)", 2026-11-10 |
| B1 to B3 | The fuzz additions and harness rules; the `history-undo-100` workload; Claude signs for the approved rows | "Approve all as recommended (Recommended)", 2026-11-10 |
| L7's deep case 2/352 | After `destroy()`, an aborted batch's late write reports nothing on 2.0 | "Approve 2.0's (Recommended)", 2026-11-10 |
| Fuzz handlers and aborts | A fuzz handler obeys its abort only where both engines abort | "Obey only where aborts agree (Recommended)", 2026-11-14 (#384) |
| The gate | Claude runs the gate | "I approve you for to do everything", 2026-11-15 |

(aw) and (ax) are deferred and (bf) declined, so none has an entry, and
1.35's export stands.

## The signed entries

Every entry carries `approvedBy: "Jason Comes"`, and each reason names its
row and ends with the signing sentence quoting that row's approval, "Approve
all as recommended (Recommended)" (2026-11-10). The three (av) twins quote
(av)'s own approval, "Approve: once (Recommended)" (2026-11-07), and the L8
signing instruction (B3, "Approve all as recommended (Recommended)",
2026-11-10).

| Row | Hand entries (records) | Fuzz entries |
| --- | --- | --- |
| (ay) | 5 (5): U4 | 3 (`row-ay`: the paused record, the next snapshot with `requires` and `ends`, and the snapshot with no history record between, below) |
| (az) | 10 (10): U5 6, "goTo a snapshot id, then replay" 1, U7's import 1, "export, import and changesets" 2 | 2 (`row-az`: `onHistoryNavigate`, the listener count) |
| (bb) | 29 (29): U7's buffer drop 11, redo cut 9, import 9 | 0 |
| (av), navigation-made | 0 | 3 (`av-moved-nav`: missing, moved, changed items) |
| **Total** | **44** (44 records) | **8** |

(bd), (ba), (bc) and (be) have no entry: no hand scenario shows them, and no
fuzz case of any seed did (L8b dropped (bd)'s 16 drafted fuzz entries, which
covered nothing).

**The (ay) entry added at the gate,
`l8-fuzz-ay-hook-onSnapshot-missing-unannounced`.** PR seeds 14 (up to L8,
case 48) and 20 (all, case 53) failed at forced L8 on an `onSnapshot` 1.35
makes and 2.0 does not: the history was paused, a navigation ran, and the next
write took a snapshot on 1.35 only. The model records a history record only at
a history step, so where the steps after the navigation are writes and
settles, the paused record the other (ay) entry `requires` never appears. The
entry covers a missing `onSnapshot` of fuzz facts with 1.35's pass label
(`$like` snapshot) in a case with `navigatedPaused`, and no `ends`. Checked
with `explain()` on the seven triaged cases: it covers exactly 14:up to L8#48
(2 records), 20:all#53 (4), 1:all#1817, 24301:all#4845 and 24301:up to L8#450
(1 each), and nothing in the other two.

**Width read.** Every entry was read against its row. Two are as narrow as
the harness allows, not as narrow as the row: the new (ay) entry would also
cover a missing snapshot before the case's first pause, and
`l8-fuzz-az-hook-onHistoryNavigate-extra` an extra call at a navigation that
is not the replay or import. The gate tried `afterOp` "pause" and `during`
"replay" or "roundtrip", but a history op is a `run` step in the trace, so
`stepOps` cannot name it, and the census rejects both (follow-ups).

## The pins

The six conformance cases an approved L8 row changes keep only the assertions
both engines share, with a comment naming the row, edited in `packages/core`'s
originals and re-ported. Titles say what is still pinned.

| Pin | Row | What still runs on both | 2.0's side pinned by |
| --- | --- | --- | --- |
| U3, two cases (development and production) | (bd) | the stored snapshot holds its pass's value and `goTo` restores it; an in-place edit of a restored fact changes the live fact | core-next `l8b-history-rows`: "(bd) a stored snapshot is not shared" > "each stored snapshot and its facts are frozen, taken or imported; the list hands them out", and "a restore writes copies: a restored value changed in place leaves the snapshot alone" |
| U6 (a) | (ba) | the imported ids stay, a write adds a fifth, and `goTo(2)` finds the imported snapshot | none in core-next (follow-up) |
| U7 | (bb) | a diff scenario, unchanged: the 29 (bb) entries record 2.0's side | core-next `l8b-history-rows`: "(bb) the changesets follow the snapshots" (10 cases) |
| U8 (a) and (b) | (be) | one `goBack` from inside lands on the start; one from outside moves onto the end | none in core-next (follow-up) |
| U9 | (bc) | the import changes no fact and leaves three snapshots | none in core-next (follow-up) |

U8 (c), the start rule, passes unchanged on both, as (be) requires. (ay) and
(az) have no conformance pin to trim: their pins are the diff scenarios U4
and U5, and the signed entries record 2.0's side.

## The golden file (E1)

`contracts/golden.test.ts` runs the history part at L8: "[L8] v2: the history
golden round-trips with 1.35.0" and its `v2:dist` twin pass. 2.0 reads
1.35's `history-export.golden` as 1.35 does (`read-1.35`), and 1.35 reads
what 2.0 exports, alone and over 1.35's history (`1.35-reads`), as the
persistence golden does. No `goldenChanges` entry was added. The export is
unchanged byte for byte: 1.35.0, core-next's source and core-next's build
each write the golden's 441 bytes exactly.

## The mutation conversion

`current` is L8, so the 44 `feature-layer` L8 entries in
`mutation-triage/engine.json` become `later-layer` (the RFC's count of 67 was
before #381 killed 51 and re-triaged 24 of them). The gate=L8 run 43549853523
(0c6aa657, ceiling L8) records 43 Killed, each by an
`l8-history-gate-debt-oracle` test, and one Timeout (1803:9, the pass after a
restore), for which Stryker names no killer. 19 notes already named the run's
killer; the other 24 now name it too. No other entry changed.

## Results

**Fuzz, pull-request count** (287 cases a seed, 205 across every layer and
82 up to L8; seeds 1 to 20 and 24301): all 21 exit 0. Over the 21 seeds,
6,027 cases ran and 5,997 were compared, 3,874 of them on 2.0 too (174 to
190 a seed), and 892 ended early at an `ends` stop. Eight runaways were
discarded, one of them after a stop (seed 8).

| Census line | Total | Per seed | Cap |
| --- | --- | --- | --- |
| Never settles (discarded) | 22 | 0 to 4 | 5 a seed (max(1% of 287, 5)) |
| of them, both engines live | 4 | seeds 3, 7, 17 and 18 | |
| Discarded after a stop | 1 | seed 8 | |
| Failed as 2.0-only live | 0 | | |

**The ratchet.** `v2-passing.json` holds 1,879 tests, 115 more than on main
(1,764), compared by name, with none removed.

**The census** (its own run: seed 24301 at the pull-request count) exits 1
with 34 problems: the 9 `conformance:checks` failures of the `/internals`
stop, the harness lock before GATE-7.md was added to it, and 24 stale fuzz
entries in two groups (Stops).

## Deep runs: report mode (A2)

Run as the nightly runs them (`DIFF_FUZZ_SEED=<seed> DIFF_FUZZ_RUNS=5000
DIFF_FUZZ_BATCH_REPORT=1`, an 8 GB heap), the three seeds in parallel with
the nightly's `--testTimeout=1200000`; seed 24301 again alone with a 1 h
timeout.

| Seed | Exit | Compared | On 2.0 too | Ended early | Runaways (after a stop) | Never settles | Reported batched cases | 2.0-only live |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 0 | 6,951 | 4,426 | 882 | 10 (0) | 39 of at most 70 | 3 | 0 |
| 2 | 0 | 6,957 | 4,458 | 922 | 10 (2) | 33 of at most 70 | 8 | 0 |
| 24301 | 1: timed out, at 20 min and again at 1 h alone | | | | | | 4, then 3 | |

Every reported case has a batched resolver, and each is one L8b's deep run
listed (`deep-report.md`). None is new, and none is a history shape: the five
(ay) cases are covered by the new entry and no longer fail.

| Case | First difference | Triage |
| --- | --- | --- |
| 1:all#2195 | external `start`, an item changed on v2 | batched unknown (L7 batch shape), report-mode follow-up |
| 1:all#4271 | external `start` extra on v2 | batched unknown (L7 batch shape), report-mode follow-up |
| 1:up to L8#428 | external `start` missing on v2 | batched unknown (L7 batch shape), report-mode follow-up |
| 2:all#2247 | external `start`, the tag changed on v2 | batched unknown (L7 batch shape), report-mode follow-up |
| 2:all#2625 | external `start` missing on v2 | batched unknown (L7 batch shape), report-mode follow-up |
| 2:all#2890 | `onResolverComplete` extra on v2 | L7 batch-ordering follow-up |
| 2:up to L8#1078 | `onReconcileStart` missing on v2 | batched unknown (L7 batch shape), report-mode follow-up |
| 2:up to L8#1272 | `onResolverComplete` extra on v2 | batched unknown (L7 batch shape), report-mode follow-up |
| 2:up to L8#1420 | external `start` missing on v2 | batched unknown (L7 batch shape), report-mode follow-up |
| 2:up to L8#1442 | external `start` missing on v2 | batched unknown (L7 batch shape), report-mode follow-up |
| 2:up to L8#1475 | `onResolverComplete` extra on v2 | batched unknown (L7 batch shape), report-mode follow-up |
| 24301:all#422 | `onResolverComplete` extra on v2 | batched unknown (L7 batch shape), report-mode follow-up |
| 24301:all#2659 | external `start` missing on v2 | batched unknown (L7 batch shape), report-mode follow-up |
| 24301:all#3397 | `onResolverCancel` names `a::rb` on v2, `a::r0` on 1.35 | batched unknown (L7 batch shape), report-mode follow-up |
| 24301:up to L8#159 | external `start` missing on v2 | batched unknown (L7 batch shape), report-mode follow-up (first run only) |

Seed 24301 did not reach the end, so its up-to-L8 cases after #159 were not
seen here. They include #1097 (hooks lost after `destroy()`, to be fixed by
p8/hooks-after-destroy), #591, #628, #946 and #1915. L8b's classifying run
(`deep-report.md`) ran the seed to the end.

## Stops

- **Two `/internals` names (`conformance:checks`, 9 failures, one cause).**
  `contracts/next-unshipped.json` lists `./internals createHistoryManager`
  and `./internals createDisabledHistory` at L8. With `current` L8 the core-next
  surface gate fails: "contracts/next-unshipped.json lists it at L8, but layer
  L8 is built (current L8)". The RFC did not name them. Either core-next's
  `/internals` exports them (an engine PR), or Jason signs two `removed`
  `next` entries in `api-changes.json`, as he signed the 13 `/internals`
  removals at L6; an agent never fills in that `approvedBy`. Until then the
  census and `conformance:checks` fail.
- **Two stale fuzz groups in the census's own run.** Seed 24301 at the
  pull-request count uses no entry of `quirk-g` (L7, 21 entries) or
  `av-moved-nav` (L8, 3 entries): at L8 its up-to-L8 phase draws other cases.
  The GATE-6 precedent is a pinned case in `diff/fuzz/pinned.json` for each
  group: a passing case that uses one of its entries. For `av-moved-nav` that
  is PR seed 13 case all#119; for `quirk-g` it is still to find. Gate run 2.
- **Deep seed 24301 does not finish in report mode.** It timed out at the
  nightly's 20 minutes, and again after 1 hour alone, still in its phase
  across every layer. The nightly would fail on it. Either the nightly
  timeout goes up, or the slow case is found (gate run 2).

## Follow-ups

- core-next pins for (ba), (bc) and (be): L8a added no test file, so no test
  states 2.0's side of U6, U9 and U8 (a) and (b). A core-next test PR (this
  gate may not touch `packages/core-next/src`).
- `during` and `afterOp` cannot name a history op: the fuzz trace records it
  as a `run` step with the op in its label. Reading the label's op would let
  the new (ay) entry take `afterOp` "pause" and the (az) entries `during`
  "replay" or "roundtrip".
- The 15 batched deep cases above, which stay report-mode follow-ups.
