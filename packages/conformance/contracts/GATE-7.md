# Phase 3 gate decisions: the L8 gate

Date: 2026-11-16. Jason approved the L8 history RFC (`rfc-l8-history.md`,
revision 2, "Decisions for the owner") on 2026-11-10, and asked Claude to
sign the entries for the rows he approved, on his behalf, as at the earlier
gates (GATE-2.md, rule 1). On 2026-11-15 he wrote "I approve you for to do
everything". This record is of gate run 2 of at most 3 (A3); run 1's
results are kept where run 2 did not redo them, and "Gate run 2" says what
changed.

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
It is the only thing that fails: every other check passes (Results).

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
82 up to L8, the pinned cases among them; seeds 1 to 20 and 24301): all 21
exit 0 in run 2. Over the 21 seeds, 6,027 cases ran and 5,998 were
compared, 3,875 of them on 2.0 too, and 925 ended early at an `ends` stop.
Eight runaways were discarded, one of them after a stop.

| Census line | Total | Per seed | Cap |
| --- | --- | --- | --- |
| Never settles (discarded) | 21 | 0 to 4 | 5 a seed (max(1% of 287, 5)) |
| of them, both engines live | 4 | | |
| Discarded after a stop | 1 | | |
| Failed as 2.0-only live | 0 | | |

**The ratchet.** `v2-passing.json` holds 1,879 tests, 115 more than on main
(1,764), compared by name, with none removed.

**The checks, run 2.** Each exit code, and what fails:

| Check | Exit | Result |
| --- | --- | --- |
| `pnpm census` | 1 | 10 problems, all the `/internals` stop's: the 9 `conformance:checks` failures and "vitest exited 1". No stale entry or group, and the harness lock passes |
| `npx vitest run --project conformance:checks` | 1 | the same 9 failures, all in `contracts/api-surface-next.test.ts`, one cause (Stops) |
| `check:expects` | 0 | 188 files, 7,175 assertions, identical to a fresh port |
| `oracle:update` | 0 | |
| `conformance:diff` | 0 | 51 files, 436 tests |
| `v2`, `v2:dist`, `v2:prod` | 0 | 359 files: 3,493 tests passed, 3,109 skipped by the layer gate |
| The 21 PR seeds | 0 each | above |
| Root biome, error level | 0 | 1,450 files |

## Deep runs: report mode (A2)

Run 2 ran them as the nightly does (`DIFF_FUZZ_SEED=<seed> DIFF_FUZZ_RUNS=5000
DIFF_FUZZ_BATCH_REPORT=1`, an 8 GB heap), the three seeds in parallel with
the PR seeds and the census, under a 1 h cap so a slow seed would still
report its time. All three ran to the end.

| Seed | Exit | Time | Compared | On 2.0 too | Ended early | Runaways (after a stop) | Never settles | 2.0-only live |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 0 | 18 min | 6,951 | 4,426 | 884 | 10 (0) | 39 of at most 70 | 0 |
| 2 | 0 | 18 min | 6,957 | 4,458 | 924 | 10 (2) | 33 of at most 70 | 0 |
| 24301 | 0 | 24 min | 6,957 | 4,452 | 914 | 12 (1) | 31 of at most 70 | 0 |

19 cases were reported, each with a batched resolver, and each is one L8b's
deep run listed (`deep-report.md`). The up-to-L8 phase now opens with two
more pinned cases, so its case numbers are two higher than L8b's and run
1's (#430 here is #428 there). None is new, and none is a history shape.

| Case | First difference | Triage |
| --- | --- | --- |
| 1:all#2195 | external `start`, an item changed on v2 | batched unknown (L7 batch shape), report-mode follow-up |
| 1:all#4271 | external `start` extra on v2 | batched unknown (L7 batch shape), report-mode follow-up |
| 1:up to L8#430 | external `start` missing on v2 | batched unknown (L7 batch shape), report-mode follow-up |
| 2:all#2247 | external `start`, the tag changed on v2 | batched unknown (L7 batch shape), report-mode follow-up |
| 2:all#2625 | external `start` missing on v2 | batched unknown (L7 batch shape), report-mode follow-up |
| 2:all#2890 | `onResolverComplete` extra on v2 | L7 batch-ordering follow-up |
| 2:up to L8#1080, #1274, #1422, #1444, #1477 | `onReconcileStart` missing; `onResolverComplete` extra; external `start` missing (two); `onResolverComplete` extra | batched unknowns (L7 batch shape), report-mode follow-ups |
| 24301:all#422, #2659, #3397 | `onResolverComplete` extra; external `start` missing; `onResolverCancel` names `a::rb`, not `a::r0` | batched unknowns (L7 batch shape), report-mode follow-ups |
| 24301:up to L8#161, #593, #630, #948, #1917 | external `start` missing; `onError` context; `onError` context; external `wrote` missing; external `start` missing | batched unknowns (L7 batch shape), report-mode follow-ups |

Three of L8b's cases no longer fail:

- 24301:up to L8#1099 (L8b's #1097, hooks lost after `destroy()`): fixed by
  #388 (p8/hooks-after-destroy), merged into this branch.
- 24301:all#4845 and up to L8#452 (L8b's #450): covered by the new (ay)
  entry.
- 24301:up to L8#510 (L8b's #501, which L8b triaged as the harness): now
  discarded after its stop, one of seed 24301's 12 runaways. See "Gate run 2".

## Gate run 2

Run 2 merged main at 87c18ba7 (#388) into the branch, rebuilt core and
core-next (the lockfile did not move), and worked the three stops run 1
left.

**1. The two `/internals` names: open, the owner's.** Nothing was added or
built. A draft of the two `removed` `next` entries, in the form of the 13
`/internals` removals of 2026-11-03, waits for Jason with `approvedBy` and
`date` empty. They are the only failures: the census's 10 problems are the 9
`conformance:checks` failures and the "vitest exited 1" that sums them.

**2. The stale groups: pinned.** `quirk-g` has 19 entries (run 1 counted
21). Neither group is stale at L8; only the census seed's own draws miss
them. Run over the 21 PR seeds, `quirk-g` covered 16 passing cases on 11
seeds (2, 3, 5, 7, 8, 10, 12, 16, 17, 18 and 19). `av-moved-nav` covered
one, seed 13 all#119. One passing case of each is now in
`diff/fuzz/pinned.json`, as #372 pinned quirk g's aborted-extra entry:

- seed 10 up to L8#79, for `quirk-g` (`l7-fuzz-g-hook-onRequirementCanceled-missing`);
- seed 13 all#119, for `av-moved-nav` (the moved and changed-items twins).

On the census seed they are up-to-L8 cases 20 and 21. Both pass, and the
census finds no stale entry. No entry was widened or removed.

**3. Deep seed 24301: the harness.** The run stalled on up-to-L8 case 508
(510 now). It took 54 minutes and wrote a 536 MB report.

- **What the engines do.** The batch handler ignores its abort
  (`respectsAbort` false). At step 2, 2.0 makes an extra `onResolverStart`,
  and the approved (at) stop, `l7-fuzz-at-hook-onResolverStart-extra`, ends
  the comparison there. From then on the two systems differ.
  - 1.35 settles after 14 timer callbacks. Its c1 resolver fails once with
    no retry left, the handler's write leaves f0 at 2, and nothing fires
    again.
  - 2.0 livelocks at 35 ms. c0 writes 4, c1 writes -1, the aborted handler
    still writes 2, and c0 fires again, until the 20,000-callback budget cuts
    it off: 2,280,368 records.
- **Why it is not a 2.0 hang.** 2.0 runs away only after an `ends` stop, so
  by the owner's rule the case is discarded after the stop ("Discard after
  the stop", 2026-11-02). A standalone run says so: "runaway on v2 after the
  stop … discarded, not a hang".
- **What the harness did wrong.** Past the budget the harness clears every
  timer itself. At step 12 the shared wait then found a batched call live
  with no timer, and reported "the shared wait at step 12 stalled". The case
  failed on the harness's own doing, so report mode wrote it out with its
  whole trace. That pretty-printed file was 536,189,569 characters, within
  0.2% of the longest string V8 can build.
- **Where the time goes**, measured on this case alone:
  - 2.0's run takes 351 s. The fake clock scans every pending timer on each
    tick, so the cost grows with the square of the callbacks: 0.9 s at 1,000,
    3 s at 2,000 and 13 s at 4,000.
  - The comparison takes 23 s, and `explain` 51 s.
  - The whole `runScenario` takes 369 s.
- **The fix (harness only).**
  - The shared wait reports no stall once the run is past its budget, so
    the run is judged as a runaway.
  - A case file keeps at most 100,000 records of each trace, and `truncated`
    gives each cut trace's full length. A longer string would throw inside
    the property, and fast-check would shrink the case for hours.
  - Self-tests in `diff/self/stall-after-budget.test.ts`: the case at a
    budget of 100 is judged a runaway with no stall (and fails without the
    fix), and the cap.

**The nightly's limit.** Under load, seed 24301 took 24 minutes here, in
parallel for its first 18. The nightly runs one seed alone with
`--testTimeout=1200000`, which is 20 minutes, inside a 60-minute job. Run 2
did not time 24301 alone, and the case above still costs about 6 minutes of
2.0 runaway. Whether the seed fits in 20 minutes on CI is unproven: see the
follow-ups.

## Stops

- **Two `/internals` names (`conformance:checks`, 9 failures, one cause).**
  `contracts/next-unshipped.json` lists `./internals createHistoryManager`
  and `./internals createDisabledHistory` at L8. With `current` L8 the core-next
  surface gate fails: "contracts/next-unshipped.json lists it at L8, but layer
  L8 is built (current L8)". The RFC did not name them. Either core-next's
  `/internals` exports them (an engine PR), or Jason signs two `removed`
  `next` entries in `api-changes.json`, as he signed the 13 `/internals`
  removals at L6; an agent never fills in that `approvedBy`. Until then the
  census and `conformance:checks` fail. Nothing else does.

## Follow-ups

- core-next pins for (ba), (bc) and (be): L8a added no test file, so no test
  states 2.0's side of U6, U9 and U8 (a) and (b). A core-next test PR (this
  gate may not touch `packages/core-next/src`).
- `during` and `afterOp` cannot name a history op: the fuzz trace records it
  as a `run` step with the op in its label. Reading the label's op would let
  the new (ay) entry take `afterOp` "pause" and the (az) entries `during`
  "replay" or "roundtrip".
- The 19 batched deep cases above, which stay report-mode follow-ups.
- The nightly's 20-minute test timeout against seed 24301. Time it alone on
  CI, or raise `--testTimeout` in `.github/workflows/diff-fuzz-nightly.yml`
  (its job allows 60 minutes). A cheaper runaway would need a new budget
  rule, which is the owner's call. The pending timers grow with each cycle
  of the livelock (most likely 2.0's timeouts for calls it aborted, due at a
  time the stuck clock never reaches); that is what makes the fake clock
  quadratic.
