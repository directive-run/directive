# Phase 3 gate decisions: the L10 gate

Date: 2026-11-16. Jason approved the L10 dynamic-definitions RFC
(`rfc-l10-dynamic.md`, revision 2, "Decisions for the owner") on 2026-11-15
with "I approve you for to do everything", under which Claude took each
recommended option, and asked Claude to sign the entries for the approved
rows on his behalf, as at the earlier gates (GATE-2.md, rule 1). This record
is of gate run 1 of at most 3 (A3).

## What the L10 gate does

`layers.rules.json` `current` is `"L10"`: core-next runs every test and
every differential scenario placed at L10 or below (`derive`, `effects`,
`constraints` and `resolvers` registered, assigned, unregistered and called
at runtime; `registerModule` and `unregisterModule`), and the fuzz compares
its dynamic and module cases on v2. The ratchet (`v2-passing.json`) gained
66 tests and lost none, tested by name; it holds 2,200.

**Run 1 is not green.** v2, v2:prod and v2:dist have no L10 failure, and
every numbered PR seed passes (7, 9 and 11 only past CI's 120 s, as at L9).
The deep runs found one difference that matches no row (Stops): a deferred
`derive.call` of a stale derivation, whose trace entry carries `oldValue`
`undefined` on 2.0 and the last value on 1.35. Every other difference
matches an approved row: (ay) needed two twin entries for the L10 fuzz's
facts, (bl) and (bm)'s L10b entries needed a `when`, and (bm) a third entry
for a name a module takes away. Also open: the two carried stops (L8's
`./internals`, L9's seed d) and B5, the module-churn bench, at 1.04 times
1.35's time, which is the owner's call.

**Run 2 is not green either, but only on owner stops.** #414 fixed run 1's
`call` trace stop. Run 2 found one more approved-row shape, (be), and
signed one entry for it; every other difference it showed matches an
approved row. What remains is the owner's: B5 at 1.04, the two carried
stops (L8's `./internals`, L9's seed d), and three owner row candidates
(below).

**Run 3 is green.** It merges main at 5ec3388e (the L8 gate #390, the L9
gate #404, L10-pre-a #405, L10-pre-b #409, and #420, #422 and #424) and
takes Jason's rulings of 2026-11-17 (below). Every check exits 0 but one
local typecheck that needs a package CI builds and this machine could not
(Run 3). B5 is met at steady state, row (cd) is signed, and the two carried
stops are gone: seed d passes in 37 s, and `./internals` ships
`createHistoryManager` and `createDisabledHistory` (#402).

## The L10 decisions

| Row | What it decides | Outcome |
| --- | --- | --- |
| A1, size | Dynamic definitions live in `withDynamic` plus a seam in the core; a 4.1 KB target under a +5.0 KB ceiling, `floor` at most +250 B | Taken under "I approve you for to do everything", 2026-11-15 |
| A2 and A3 | Deep runs report while the 21 short seeds gate; a real 2.0 bug still blocks; 3 gate runs at most | Taken, as at L7 to L9 |
| (bl) | `derive.assign(id, { compute, meta })` replaces the derivation and keeps it readable | Taken; built in L10a |
| (bm) | A derivation or constraint that asked for a name before it existed recomputes when the name is registered or unregistered | Taken; built in L10a |
| (bn) | A subscriber to a name registered later is told | Declined; 1.35's pin U4 stands; no entry |
| (bo) | `getOriginal` and `restoreOriginal` are removed | Moot: a 1.35 system has neither member (U22), so there is nothing to remove; no entry |
| B1 to B5 | The fuzz steps and harness rules; re-placing `dynamic-definitions`; `registerKeys` at L10; Claude signs; the `module-churn` workload | Taken |

| B5, the bar | `module-churn` is measured at steady state | "Measure at steady state (Recommended)", 2026-11-17. Met: 0.92 times 1.35's time (B5, below) |
| (cd) | A retired module's resolver write never lands in a replacement module's fact | "Approve all as recommended (Recommended)", 2026-11-17. Built in #424; one signed pin change (The pins) |
| (bk) | No new resolver run after `destroy()` | 2.0's behaviour approved, "Approve all as recommended (Recommended)", 2026-11-17. No oracle test reaches the difference (Run 3) |
| engine.ts 2261:9 | 1.35's error-boundary retry invalidates the readers of a same-named fact; 2.0 does not | 2.0's behaviour approved, the same words, 2026-11-17. No oracle test reaches it (Run 3) |
| `onStop` twice | A `destroy()` during a pending unregister drain fires `onStop` twice | Kept as 1.35, which is parity, the same words, 2026-11-17 |
| U18's letter | A new letter for L11's U18 candidate | Not this gate's concern |

The rest stand as GATE-8.md records them: (ay) to (be), "Approve all as
recommended (Recommended)" (2026-11-10), and the rows before them.

## The signed entries

Every entry carries `approvedBy: "Jason Comes"`, and each reason names its
row and ends with the signing sentence "on the owner's instruction" (GATE-2
rule 1), quoting that row's approval: (bl) and (bm) "I approve you for to do
everything" (2026-11-15); (ay) "Approve all as recommended (Recommended)"
(2026-11-10).

| Row | Hand entries (records) | Fuzz entries |
| --- | --- | --- |
| (bm) | 76 (76): U2, a derivation that asked for a name before it was registered, 27; U3, a constraint gated on a later-registered name, 49 | 2: the first extra `onDerivationInvalidate("zin")`, `ends`, `when` dynamicReaders (L10b; `when` added here); and `l10-fuzz-bm-hook-onDerivationInvalidate-extra-name-returns`, the first extra invalidation of a static derivation once a `d0` a module took away is registered again, `ends`, `when` readerNameReturns (deep seed 24301) |
| (bl) | 0 | 1: the first missing `onError` "def is not a function", source "derivation", `ends`, `when` assignObject (L10b; `when` and the `sourceId` class changed here) |
| (ay), L10 twins | 0 | 2: `l10-fuzz-ay-hook-onSnapshot-missing` and `l10-fuzz-ay-hook-onSnapshot-missing-unannounced` (below, "The (ay) widening") |
| **Total** | **76** (76 records) | **5** |

**Width read.** Every entry was read against its row.

- The 76 hand entries are exact: each names its scenario, step, stream,
  kind and record, with counts, and none uses a `$like` class.
- **The two L10b `ends` entries had no `when`**, which the census rejects
  (an `ends` entry for every fuzz case would stop cases that cannot show
  the quirk; `checkDivergences`, and `oracle.test`'s "accepts the committed
  scenario layers, divergences and hook list"). Two new triggers name each
  row's spec feature, each with a self-test against the nearest spec that
  lacks it (`diff/self/l10-triggers.test.ts`):
  - `dynamicReaders` (row (bm)): the case has `dynamic.readers`, so module
    a has `zin` and `zgate`. (bm)'s entry bounds one record, an
    invalidation of `zin`, which asks only `"z0" in derived` and has no
    dependency at all on 1.35, so an extra invalidation of it can only be
    (bm)'s. The define pool (`d0`, `d1`, `z0`, `z1`) never names `zin`.
  - `assignObject` (row (bl)): a `define` step assigns a derivation in the
    object form (`variant` 3). `register` with the same object works on
    both engines, so it is outside.
  - `readerNameReturns` (row (bm), through modules): in a one-module case,
    an odd module z variant replaces `d0` (M2), an unregister takes it away,
    and a later step registers `d0` again. A static reader of `d0` then
    asked for a name that was not there, which is (bm)'s shape.
- (bl)'s entry bounds 1.35's TypeError text, "def is not a function", which
  only the object form of `assign` produces (K2). Its `sourceId` named only
  static derivations (`$like` derivation, `d\d+`); deep seed 2 assigned the
  pool's `z1`. The new class `dynamicDerivation` names a static id, `z0`,
  `z1` and `zin` (which reads `z0`), and only this entry uses it.
- The (ay) twins are (ay)'s two L8 entries with the class swapped; each is
  as wide as its L8 entry, no wider, and the unannounced one leaves out a
  registered module's facts (below).

## The (ay) widening

**The finding.** Fifteen PR seeds (1, 2, 4, 5, 7, 9, 10 to 14, 17 to 20)
failed at L10 only on an `onSnapshot` 1.35 makes and 2.0 does not. The
`snapshot` class (`diff/fingerprint.ts`) accepts only the seed's fact names,
`([a-z]::)?(f\d+|when)`. The L10 fuzz adds four, read from the generator
(`diff/fuzz/model.ts`): `zf` and `zw`, which a dynamic case gives module a,
and `g0` and `g1`, the facts of module `z`, which a `module` step registers
(`extraModule`). No other fact name is added: the `define` steps register
derivations, effects, constraints and resolvers, not facts.

**The change.** Two classes of their own, each named by one entry. The L8
entries keep `snapshot`, so `l8-fuzz-ay-hook-onSnapshot-missing-unannounced`,
which has no `requires`, still covers only a snapshot of the seed's facts.

| Class | Names | Its one entry |
| --- | --- | --- |
| `snapshotDynamic` | `snapshot`'s shape with `zf`, `zw`, `g0` and `g1` added, at least one of them present | `l10-fuzz-ay-hook-onSnapshot-missing`: the twin of `l8-fuzz-ay-hook-onSnapshot-missing`, with its `ends`, its `when` (navigatedPaused) and its `requires` (a history record whose `data[1].paused` is false on 1.35 and true on 2.0, (ay)'s own mark) |
| `snapshotDynamicWrite` | `snapshotDynamic` whose label names neither `g0` nor `g1`: the facts may hold module z's, but registerModule's own snapshot (`facts-changed:z::g0,z::g1`, its init) and a write of module z are outside | `l10-fuzz-ay-hook-onSnapshot-missing-unannounced`: the twin of the L8 unannounced entry, `when` navigatedPaused and no `requires`, for a case with no history record between the navigation and the write. Deep seed 1 found it twice (below) |

So a missing registerModule snapshot (the RFC's H1) is covered only with the
paused record in the same case, never without. A first draft of the second
class left out every snapshot whose facts held `g0` or `g1`; deep seed 1's
rerun then stopped on a case where module z was registered before the
pause, and the missing snapshot was a later write of `b::when`. The label,
not the facts, is what tells registerModule's snapshot apart.

**Self-test** (`diff/self/l10-snapshot-class.test.ts`):

- a seed's value in a name's place, in the facts or in the label, fails the
  class, and so does every other name (`z::g2`, `z::h0`, `a::zin`, `a::zq`,
  a stranger, two namespaces);
- a snapshot of the seed's facts only fails the new class and passes
  `snapshot`, and an L10 name still fails `snapshot`;
- `snapshotDynamicWrite` takes a write's snapshot with module z's facts in
  it (deep seed 1's), and rejects registerModule's own snapshot and a write
  of module z;
- each class is named by one entry, which equals its L8 entry but for its
  id, reason, date and bound;
- a missing registerModule snapshot (module z's facts) after a paused
  navigation is covered by the requires twin; with no paused record, in a
  navigatedPaused case, it is covered by no entry. A later write's
  snapshot without the paused record is the L10 unannounced twin's, with or
  without module z's facts, and a seed-facts-only one is still the L8
  unannounced twin's.

**Seed by seed.** Each case was replayed from the seed's shrunk
counterexample (the baseline run, before the twin) and both traces were
read. In every case the comparison now ends at the case's first missing
snapshot, by the twin, and the paused mark is in an earlier step of the
same trace.

| Seed | Missing snapshot | Paused mark (1.35 false, 2.0 true) | L10 facts in the snapshot | registerModule's own snapshot |
| --- | --- | --- | --- | --- |
| 1 | step 16 | step 12 | `a::zf`, `a::zw` | no module step |
| 2 | step 8 | step 7 (and 9) | `zf`, `zw` | no module step |
| 4 | step 7 | step 5 (and 6) | `zf`, `zw` | no module step |
| 5 | step 11 | step 10 (and 14) | `a::zf`, `a::zw`, `z::g0`, `z::g1` | step 3 on both engines |
| 7 | step 7 | step 6 | `a::zf`, `a::zw` | no module step |
| 9 | step 11 | step 6 | `zf`, `zw` | no module step |
| 10 | step 11 | step 10 | `a::zf`, `a::zw` | no module step |
| 11 | step 7 | step 6 | `zf`, `zw` | no module step |
| 12 | step 12 | step 11 | `zf`, `zw` | no module step |
| 13 | step 7 | step 6 | `a::zf`, `a::zw`, `z::g0`, `z::g1` | step 3 on both engines |
| 14 | step 10 | step 8 | `zf`, `zw` | no module step |
| 17 | step 10 | step 8 | `a::zf`, `a::zw` | no module step |
| 18 | step 8 | step 6 | `a::zf`, `a::zw`, `z::g0`, `z::g1` | step 3 on both engines |
| 19 | step 10 | step 8 (and 9, 12) | `a::zf`, `a::zw`, `z::g0`, `z::g1` | step 3 on both engines |
| 20 | step 12 | step 7 (and 11) | `a::zf`, `a::zw`, `z::g0`, `z::g1` | step 3 on both engines |

In the five cases with module z (5, 13, 18, 19, 20), 2.0 took
`registerModule`'s own snapshot (`facts-changed:z::g0,z::g1`) in the same
step as 1.35, before the pause. The missing snapshot is a later write's,
after a navigation that put the pause back: (ay)'s shape, present in the
trace. None is a missing registerModule snapshot (the RFC's H1 holds on
2.0 in all five).

## The pins

**(bl), U1.** Row (bl) changes U1's two `derive.assign` cases, so they keep
only what both engines share, with a comment naming the row (#339's
mechanism, as at L6 to L9): the assign returns, and a function assigned
after it is read. 1.35's side (every read, `call` and `meta.derivation`
throws "is not a function" until a function is assigned) is 1.35's only.
Edited in `packages/core`'s original and re-ported. "register with the same
object form works" passes unchanged on both.

| Pin | Row | What still runs on both | 2.0's side pinned by |
| --- | --- | --- | --- |
| U1, "on a registered derivation: the assign returns, and a function assigned after it is read" | (bl) | the assign returns; `facts.a = 2`, then a function assigned reads 12, by `read` and `call` | core-next `l10a-dynamic` "(bl): assign with { compute, meta } keeps the derivation readable, with the new meta" (`l10a-dynamic.test.ts:184`) |
| U1, "on a static derivation: the same" | (bl) | the same on `double` | the same test |

**(bm).** Its pins are the diff scenarios U2 and U3; the 76 signed entries
record 2.0's side. A reader that never sees the name arrive equals 1.35, so
on the 2.0 side only core-next's pins catch a (bm) that stops working:

- `l10a-dynamic.test.ts:226` "(bm): a derivation that asked about a name
  before it existed sees it arrive";
- `l10a-dynamic.test.ts:240` "(bm): a constraint gated on a later
  registration fires once it arrives";
- `l10a-dynamic.test.ts:670` "D7: registering a name that only a reader
  outside the graph asked about starts no pass; the reader sees it at its
  next read (bm)".

**New pins** (`l10-gate-pins-oracle` and `l10-gate-pins-oracle-production`,
at L10, 5 cases each). The principal review found these paths unguarded.
Each passes on 1.35 and on 2.0, in development and production, on source
and dist.

| Pin | What it holds | Why |
| --- | --- | --- |
| restore() after unregisterModule, single and namespaced | a snapshot taken before the unregister restores the live keys and drops the retired one, with no throw and no log | 1.35's `facts.ts:521`: a write to a retired key is dropped before validation. 2.0 threw in development until #411 |
| a retired resolver's write after the 10 s drain | with fake timers: `unregisterModule` gives up at 10 s and a same-key replacement is registered with `written` 0. Both engines share that much | 1.35 lands it on the replacement (1.35's side only: the case keeps what both share and names the row, as U1 does for (bl); 2.0's side is pinned in core-next's `l10-m7-late-write` and `l10-m7-late-write-production`); 2.0 drops it, inside and after the drain, warning once in development (row cd, signed on the owner's instruction, "Approve all as recommended (Recommended)", 2026-11-17). Only a 30 ms write was covered (`unregister-module`) |
| a snapshot taken after registerModule | `registerModule`'s init takes one snapshot, `{ "m::n": 1, "x::c": 10 }`, a write another with `x::c` 11, and `goTo` the first puts `x.c` back to 10 | The RFC's H1. A planted bug here failed no v2 test; only the fuzz caught it |

## The mutation conversion

`current` is L10, so the 41 `feature-layer` L10 entries (all in
`engine.json`; the RFC estimated 46) become `later-layer`. The gate=L10
mutation run 43995979367 (mutation-nightly.yml on p10/l10-pre-b at
3f1d9c2a, concluded success) names their killers: 40 are Killed, and each
note now names its killing test from that run; 1, 2479:20 (recordFactTags'
`?.`), is a Timeout, for which Stryker records no killedBy, so its note says
the layer is the feature's. `packages/core/src` is unchanged since 3f1d9c2a,
so the triaged lines hold. For 1679:27 the run names a different killer
than the note's L10-pre-b one (U8 in `l10-dynamic-pins-oracle`); the note
keeps both.

## B5, the module-churn bench

`node bench/system/run.mjs --only module-churn --rounds 6`, three runs
alternating which engine goes first, CPU median, before any fuzz run. No
header said NOISY (load average 4.1 to 5.2 on 14 cores).

| Run | 1.35 (ns per op) | 2.0 (ns per op) | 2.0 against 1.35 | Bytes per step, 1.35 | Bytes per step, 2.0 |
| --- | --- | --- | --- | --- | --- |
| 1 (1.35 first) | 723,556 | 741,962 | 1.02 times (1.00 to 1.06) | 3,306,669 | 3,203,968 |
| 2 (2.0 first) | 721,696 | 753,962 | 1.04 times (1.00 to 1.13) | 3,285,060 | 3,214,076 |
| 3 (1.35 first) | 842,639 | 984,293 | 1.13 times (0.85 to 1.27) | 3,307,548 | 3,208,712 |

**The median run: 2.0 is 4% slower than 1.35 (1.04 times its time), and
allocates 2.2 to 3.1% fewer bytes.** #408 measured 1.03 times on a noisy
machine, with 2.6% fewer bytes. B5 asks for 1.0 or better, so this was an
owner stop.

**Run 3, at steady state: B5 is met.** Jason's ruling on 2026-11-17 was
"Measure at steady state (Recommended)". Since #420 the bench's
`module-churn` runs at steady state with no forced gc (the forced-gc run is
kept, report-only, as `module-churn-leak`), and #422 made `registerModule`
and `unregisterModule` cheaper. The same command (`node
bench/system/run.mjs --only module-churn --rounds 6`, from
packages/core-next, after merging main at 5ec3388e and building both
engines), three runs, `--first` v1, v2, v1, CPU median:

| Run | 1.35 (ns per op) | 2.0 (ns per op) | 2.0 against 1.35 | Bytes per step, 1.35 | Bytes per step, 2.0 |
| --- | --- | --- | --- | --- | --- |
| 1 (1.35 first) | 7,822 | 7,247 | 0.94 times (0.92 to 0.96) | 3,266,618 | 2,984,374 |
| 2 (2.0 first) | 7,580 | 7,008 | 0.91 times (0.89 to 0.96) | 3,286,292 | 2,971,863 |
| 3 (1.35 first) | 10,447 | 9,766 | 0.92 times (0.88 to 0.98) | 3,260,854 | 2,961,851 |

**The median run: 2.0 takes 0.92 times 1.35's time (8% faster) and
allocates 8.6 to 9.6% fewer bytes.** Every round of every run is under
1.0. The machine was not quiet: each header said NOISY (load average 10 to
15 on 14 cores, from other work on the machine). CPU time ignores the time
a process sits descheduled, and all three runs agree, so the result stands;
a quiet re-run is a follow-up. B5's owner stop is closed. Retained heap
after a full gc is 62 to 72 bytes per step on 2.0 against 117 to 239 on
1.35.

## Results

**The checks** (after merging main at 7ef4abc7 and building core and
core-next). Each exit code is the command's own, read from its file, and
what fails:

| Check | Exit | Result |
| --- | --- | --- |
| `v2`, `v2:prod`, `v2:dist`, `v2:dist:prod` | 0 each | 2,060, 101, 2,060 and 101 passed, 0 failed; 1,282 skipped by the layer gate on `v2` and `v2:dist`. No L10 test fails, U1's trimmed cases and the new pins included |
| `v1`, `v1:prod` | 0 each | 3,343 and 102 passed |
| `ratchet --update` | 0 | +66, none lost by name; 2,200 pass on source and dist |
| `check:expects` | 0 | 196 files, 7,485 assertions, identical to a fresh port |
| `oracle:update` | 0 | the harness lock and the oracle baseline, after the last oracle change |
| `npx vitest run --project conformance:checks` | 1 | 9 failures, all the L8 stop's (`contracts/api-surface-next.test.ts`). The harness lock and the divergence checks pass |
| `npx vitest run --project conformance:diff` | 1 | 510 passed, 1 failed: the default-seed fuzz, seed d (Stops) |
| `pnpm census` | 1 | 87 problems, all from the two known stops. 10 are the L8 stop's: the 9 `api-surface-next` failures and "conformance:checks: vitest exited 1". 3 are seed d's: it times out at 120 s, so `conformance:diff` exits 1, the fuzz test fails, and "the fuzzer reported no runs". 74 stale entries follow from that: with no fuzz runs reported, no fuzz entry covers anything |
| Root biome, error level | 0 | 1,487 files |
| The 21 PR seeds at CI's 120 s | 1 on 4 | 17 exit 0 (20 to 75 s each). Seed d times out (Stops). Seeds 7, 9 and 11 time out with no failing case, as at L9 (below) |
| Seeds 7, 9 and 11, longer timeouts | 0 each | 7 in 320 s and 9 in 406 s at 900 s; 11 in 720 s at 1,800 s (it timed out at 900 s while the census and three deep runs shared the machine) |

**The PR seeds, case by case.** On this branch's first run (before the
(ay) twins), fifteen seeds failed on (ay)'s snapshot (above). On the final
harness every numbered seed passes but for time: 7, 9 and 11 take longer
than CI's 120 s, as at the L9 gate (GATE-8.md, "Three PR seeds need longer
than CI's 120 s"). The 21 seeds ran 4 at a time with nothing else heavy
beside them.

**`conformance:typecheck`** (`pnpm typecheck` in packages/conformance) exits
2 on three errors in `tests/core/l10-dynamic-gate-debt-oracle.test.ts`
(L10-pre-b's file, ported as it is; implicit `any` and an index on `{}`). No
file this gate adds or edits has a type error. A follow-up.

## Deep runs: report mode (A2)

Run as the nightly does (`DIFF_FUZZ_RUNS=5000 DIFF_FUZZ_BATCH_REPORT=1`, an
8 GB heap), each seed to the end of its run or to its first unreported
failure. Each stop on an L10 shape was triaged, given an entry for its row,
replayed clean, and the seed run again on the new harness. Batched cases
are reported, not failed (A2).

**What the deep runs found, in order** (each fixed in an oracle commit,
except the last):

| Run | Case | What it was | Row | Done |
| --- | --- | --- | --- | --- |
| seed 2, first | all, `assign("z1", { compute, meta })` | (bl) on a dynamic derivation; the entry named only `d\d+` | (bl) | `dynamicDerivation` |
| seed 1, first | all, a pause, a replay, a write | (ay) unannounced, in a dynamic case | (ay) | the unannounced L10 twin |
| seed 24301, first | all, `assign("d0", { compute, meta })`, then `call` | (bl), and an artifact of this gate: the run read the entries from the working tree per case, so it saw the new `when` assignObject but not the new trigger, which its process had not loaded. Seed 9's 900 s run failed the same way | (bl) | replays clean on the final harness |
| seed 1, second | all, module z registered, a pause, a replay, a write of `b::when` | (ay) unannounced, with module z's facts | (ay) | the twin's class reads the label |
| seed 24301, second | up to L10, odd module z replaces `d0`, unregister, then `define` registers `d0` | (bm): `d1` and `d2` asked for `d0` while it was gone | (bm) | `readerNameReturns` and its entry |
| seed 2, final | up to L10, a deferred `derive.call("d0")` of a stale `d0` | **no row** (Stops) | none | open |

**The final runs.**

| Seed | Exit | Time | Reported cases (batched) | Stopped on |
| --- | --- | --- | --- | --- |
| 1 | 0 | 32 min, 7,000 cases; 17 runaways, 33 never settle | all:857, all:1028, all:1395, all:2195, all:2816, up to L10#224, up to L10#1295, up to L10#1959 | ran to the end |
| 2 | 1 | 24 min, 6,369 cases; 9 runaways, 25 never settle | all:2247, all:2890, all:3992 | up to L10: the `call` trace case (Stops) |
| 24301 | 0 | 16 min, 7,000 cases; 13 runaways, 31 never settle | all:175, all:422, all:687, all:2654, all:3053, up to L10#1056 | ran to the end |

**Triage of every reported case.** Each is batched.

- all:857, all:1028, all:1395, all:2195 (seed 1), all:2247, all:2890,
  all:3992 (seed 2), all:175, all:422, all:687, all:2654, all:3053 (seed
  24301): the cases GATE-8 lists at L9, with the same first differences: L7
  batch shapes, (ap) with no clobbering single resolver (2:all#2890,
  24301:all#422), and 24301:all#175, the L9 stop. Report-mode follow-ups, as
  at L9.
- 1:all#2816: an `onReconcileStart` 1.35 makes and 2.0 does not, in step
  15 of a batched case: an L7 batch shape (pass timing), not proven either
  way; a follow-up.
- 1:up to L10#224: an `onFactSet` missing on 2.0 in step 10; the same case
  number as GATE-8's 1:up to L9#224 (row t's batch path), now in the up to
  L10 phase. Not replayed; a follow-up.
- 1:up to L10#1295: in step 17, 2.0 runs module z's teardown
  (`onDefinitionUnregister` for `zm` and `zme`) before a batch's
  requirements are created, where 1.35 creates them first: a teardown met
  by a batch in flight. Batched, so reported; not replayed, and not proven
  either way. A follow-up for the next gate run.
- 1:up to L10#1959: a batch write missing on 2.0 in step 8, GATE-8's
  1:up to L9#1959 (an L7 batch shape), now in the up to L10 phase.
- 24301:up to L10#1056: an `onReconcileEnd` 2.0 makes and 1.35 does not, in
  step 7 of a batched case: pass timing with a batch, an L7 batch shape as
  far as the first difference shows; a follow-up.

Seed 1's final run started before the `readerNameReturns` entry landed and
read the entries per case, so its later cases saw it; the entry only adds
coverage for its trigger, and the run ended with no failure. Seed 2 stopped
on the `call` case, so the rest of its up to L10 phase did not run.

## Run 2: run 1's five batched follow-ups, replayed

Each was replayed from its deep case's spec on this branch after the merge
of #414, with both traces read at the first difference. All five are
batched (A2), so they are reported, not failed.

| Case | Unexplained | First difference, from the traces | Row or cause |
| --- | --- | --- | --- |
| 1:all#2816 | 12 | Step 15: a single resolver `r0` writes `f0`; the nested pass retracts both constraints and cancels `A0` and three queued batch items; then `r0`, which ignores its abort, completes. 1.35 then runs one more empty pass (`onReconcileStart`, and `onReconcileEnd` with nothing in it); 2.0 does not. Quirk g's entry ends the case at step 18 | Cause: the pass that 1.35's completion of a retracted run asks for, in row t's third path (`writeRetracts`: the run's own write retracted its constraint), with a batch beside it. No fact, requirement or resolver outcome differs. Which row is not proven; a follow-up |
| 1:up to L10#224 | 13 | Step 10: 2.0 rejects the batch resolver's write to `f2` as clobbered (`onResolverWriteRejected` per item), where 1.35 writes it | Row t, its batch path (`disable`, `batchWriteRetracts`): GATE-8's 1:up to L9#224, unchanged |
| 1:up to L10#1295 | 96 | Step 17, a `settle` while `unregisterModule("z")` waits on its drain. Both engines time out `r2` (row n's `timeout` record, covered), complete batch `rb`'s three items, and tear module z down in the same order (M6). They differ in where the pass that `rb`'s completion asks for runs: on 1.35 before the teardown resumes, so that pass still raises module z's `ZW`; on 2.0 after it. The 95 later differences follow from that one pass | Cause: pass timing between a batch's completion and an awaited unregister drain. No row names it. Both engines end with module z gone and the same requirements. Probed (below): it needs the batch. The batch path of row (as), as far as the traces show |
| 1:up to L10#1959 | 1 | Step 8: 1.35 starts and writes a batch call and reports two attempt errors; 2.0 lacks the external `wrote`, and (av)'s `onError` entry ends the case in the same step | An L7 batch shape: GATE-8's 1:up to L9#1959, unchanged |
| 24301:up to L10#1056 | 2 | Step 7: 2.0 times batch `rb` out (row n's `timeout` record, covered) and reports its `onReconcileEnd` before the batch's retry, where 1.35 starts the retry first. Quirk a's entry ends the case in the same step (`resolverRetry`) | Row n's batch path, with quirk a: the pass's end moves with row n's earlier abort |

As far as the first differences show, none is a 2.0 bug a user would see
as worse. 1:up to L10#1295 is the only one with an L10 operation in it, and
the one that needs a probe.

**1:up to L10#1295, probed.** Its spec was recovered by running deep seed
1 again (report mode, the same harness) and replayed twice. With the batch
(`spec.batch`, resolver `rb`), 96 unexplained differences, as reported.
With only the batch taken out, the same steps still unregister module z
while single runs are in its drain (step 17 on 1.35: three
`onResolverComplete`, an `onResolverError`, an `onResolverRetry`, module
z's four `onDefinitionUnregister`), and the engines match: no unexplained
difference. So the pass timing shows only with a running batch in the
drain, and it is not a 2.0 bug in the drain itself. The approved row it
fits is (as) (L7: `settle()`, the settled notification and `inspect()`
count a running batch, so 2.0 waits for a batch's end where 1.35 goes on):
the drain is a wait of the same kind. That fit is reasoned from the traces,
not proven by a pin; a follow-up, with no entry, since the case is batched
and reported (A2).

## Run 2: the slow seeds and CI

No CI workflow runs the numbered seeds 1 to 20. CI's `conformance` job
(`.github/workflows/ci.yml:127`, with a 30-minute job limit at line 129)
runs `pnpm census` (line 157). The census runs `conformance:diff` once, at
the default seed `0x5eed`, which is 24301 (`diff/fuzz/fuzz.test.ts:117`),
with `testTimeout: 120_000` (`vitest.config.ts:243`, and the census's own
config at `lib/census.ts:411`). The nightly (`diff-fuzz-nightly.yml:83`)
runs one random seed at 5,000 runs with `--testTimeout=1200000`. So seeds 7,
9 and 11 would not pass in CI's 120 s, but CI never runs them. Only seed d's
time counts in CI, and seed d is the carried L9 stop. The harness was not
changed for speed in this run. A follow-up: either CI runs the numbered
seeds at a limit they pass in, or the record stops calling them CI's.

## Run 2: the results

Run 2 is this branch after the merge of #414, which fixed run 1's stop
(the `call` trace case): core-next keeps a derivation's last returned
value for the trace's old value.

| Check | Exit | Result |
| --- | --- | --- |
| `v2`, `v2:prod`, `v2:dist`, `v2:dist:prod` | 0 each | no failure |
| `v1`, `v1:prod` | 0 each | no failure |
| `check:expects` | 0 | |
| Root biome, error level | 0 | |
| `ratchet --update` | 0 | added 0, lost none: `v2-passing.json` is byte for byte as it was, 2,200 tests passing on source and dist |
| `npx vitest run --project conformance:checks` | 1 | the L8 stop's 9 `api-surface-next` failures only |
| `npx vitest run --project conformance:diff` | 1 | the default-seed fuzz only: seed d times out at 120 s |
| `pnpm census` | 1 | 89 problems, all from the two known stops: 10 the L8 stop's, 3 seed d's (the fuzz times out, `conformance:diff` exits 1, "the fuzzer reported no runs") and 76 stale entries that follow from no fuzz run being reported. Run 1 had 74; the two more are this run's (be) entry and its group's |
| PR seeds 1 to 20 at 120 s | 0 on 17, 1 on 3 | 7, 9 and 11 time out with no failing case, twice each (the PR pass and the final pass) |
| Seeds 7, 9 and 11 at 1,800 s | 0 each | 413 s, 509 s and 697 s |
| Seed d (24301) at 120 s | 1 | times out, the carried L9 stop |
| Deep seed 2, first | 1 | stopped on the (be) case below; it also reported up to L10#1551 |
| Deep seed 2, with the (be) entry | 0 | 7,000 cases to the end; reported all:2247, all:2890, all:3992 and up to L10#1601, all batched |

**Row (be), one new entry.** Deep seed 2's first run stopped in the up to
L10 phase on a case that closes a changeset over indexes 1 to 2 and then
goes `back 3` from 2: 1.35 lands on 1 and 2.0 on 0 (`onHistoryNavigate`
`[2, 1]` against `[2, 0]`). That is (be) as GATE-7 corrects it: 2.0 takes
the changeset as one step and then the steps left, where 1.35 drops them.
The restore's batch then writes other facts (1.35 `b::when`, 2.0 `a::zf`).
`l10-fuzz-be-hook-onFactsBatch-changed-back` covers that changed key in a
`back` step and ends the case there, in the shape of (bb)'s L9 entry: the
`changesetSteps` trigger, `during` "back", and a required changed
`onHistoryNavigate`. Its key class, `historyFactKey`, takes only fact names
(a seed's `f\d+`, `when`, `zf`, `zw`, module z's `g\d+`, bare or under one
namespace), and `diff/self/l10-be-class.test.ts` pins it and its one user.
As first drafted, the requirement took any changed navigation, which is
wider than (be): a `back` that landed later on 2.0 would have passed. It
now requires 2.0's index below 1.35's (`args[1]`, `$lt` "from"), the only
way (be) moves a `back`. The case replays with no unexplained difference
with the narrowed entry, and 28 without it.

**Up to L10#1551 (deep seed 2, first run), triaged.** Batched (`throw`
boundary, a failing batch `rb`). Replayed: both engines run the same
steps, make the same `onError` and `onErrorRecovery` for `a.rb attempt 1`
in step 4's settle, and leave the same single unobserved rejection. Node
reports it inside step 4 on 2.0 and after the teardown in step 6 on 1.35;
the two differences are that one `unhandled` record, extra in step 4 and
missing in step 6. That is row (as) (2.0's settle() waits for the batch's
end, 1.35's does not), two steps apart instead of one, so its entry
(`moved`, `by` -1) does not pair it. No L10 operation is in the case. Not a
2.0 bug; a follow-up, since widening (as)'s entry is outside this gate.

## Run 3: after main at 5ec3388e and the owner's rulings

**The merge.** `git merge origin/main` conflicted in 18 files, because
this branch carried the L8 gate, the L9 gate and L10-pre-a and pre-b as
their branches, and main has them squashed. The merge takes main and
re-applies this gate's own commits (32a5ff3c to 9e01ab5c, the run 2 merge
left out) on top: they applied with no conflict but `v2-passing.json`,
unioned by name (13 names main lacked), and `harness.lock.json`,
regenerated. GATE-7.md and GATE-8.md are main's. `divergences.json` has
all 1,046 of main's entries and all 1,128 of the branch's, each byte for
byte, with no duplicate id. No conflict marker remains (`git diff
--check`, and a grep for `<<<<<<<`).

**Row (cd).** #424 built it in core-next. The pin of the late write in
`l10-gate-pins-oracle` and its production twin now keeps what both engines
share (the drain gives up at 10 s, and the replacement starts from its own
init, `written` 0) and names the row. The final `written` 1 is 1.35's side
only; 2.0's is core-next's `l10-m7-late-write` and
`l10-m7-late-write-production`. Edited in `packages/core`'s originals and
re-ported. The two retitled cases have `removed` entries in
`v2-passing.json` giving the reason, and the ratchet adds their new names.
A host-key write from a retired resolver is unchanged on both engines (#424
pins 2.0's side). The drafted entries (m7/entries.json) said "skipped on
2.0"; the gate's mechanism is the trim, which is no wider than the row.

**(bk) and engine.ts 2261:9: no oracle test reaches either.** Both
approvals are 2.0's behaviour. No conformance test, diff scenario or
divergences entry names (bk), and none exercises the 2261:9 retry (GATE-9
already notes that a public test of it fails on 2.0). Every v2 project
passes with no entry for either, so no test reaches the difference today.
No pin or 2.0-side note is added; each is a follow-up.

**Stale entries, pinned.** With seed d now finishing, the census found
four signed L10 fuzz entries that its seed no longer reaches, since main's
L11 and L13 draws moved seed 24301's later cases. As the L8 and L9 gates
did, one real case for each is added to `diff/fuzz/pinned.json`, found by
logging the cases that use the entry and replayed alone with no
unexplained difference:

| Entry | Case pinned |
| --- | --- |
| `l10b-fuzz-bl-hook-onError-missing-def-is-not-a-function` | seed 10, case 75, up to L10 |
| `l10b-fuzz-bm-hook-onDerivationInvalidate-extra-zin` | seed 14, case 44, up to L10 |
| `l10-fuzz-bm-hook-onDerivationInvalidate-extra-name-returns` | deep seed 24301, case 483, up to L10 (5,000 runs, report mode, exit 0) |
| `l10-fuzz-be-hook-onFactsBatch-changed-back` (group row-be) | deep seed 2's run 2 case (the (be) case above) |

No entry was deleted, loosened or re-signed.

**A type fix.** `diff/self/l10-be-class.test.ts` (run 2's) failed
`conformance:typecheck` on `LIKE.historyFactKey` being possibly undefined;
it now casts as `l9-triggers.test.ts` does.

| Check | Exit | Result |
| --- | --- | --- |
| `pnpm census` | 0 | no problems: 10 projects, 14,544 tests, every port in every engine; the fuzz compared 286 cases of seed 24301, all on v2 |
| `check:expects` | 0 | 196 files, 7,483 assertions, identical to a fresh port |
| `oracle:update` | 0 | after the last oracle change |
| `npx vitest run --project conformance:checks` | 0 | 246 passed, 4 skipped; the harness lock and `api-surface-next` included |
| Diff self-tests (`conformance:diff diff/self`) | 0 | 22 files, 341 tests |
| `ratchet --update` | 0 | added 2 (the retitled (cd) cases), none lost but the three renames with `removed` entries (the two (cd) cases, and U1's "register with the same object form works", retitled by run 1 under "(U1; row bl)"); 2,232 pass on source and dist |
| core-next `test` | 0 | 74 files, 685 passed, 2 todo |
| core-next `typecheck` | 0 | |
| `pnpm -r --filter './packages/*' typecheck` | 2 | only `packages/cli`, which cannot find `@directive-run/knowledge`: its build needs the website's generated `api-reference.json`, absent on this machine. Conformance, core and core-next pass. CI's build-and-test builds it first |
| Root biome, error level | 0 | |
| The 21 PR seeds at 120 s | 0 on 18 | seed d in 37 s; 1 to 20 in 20 to 92 s |
| Seeds 7, 9 and 11 at 1,800 s | 0 each | 398 s, 500 s and 668 s |

## Corrections to the L10 RFC

- **M7 says a retired resolver's write "cannot reach a replacement".** On
  1.35 it lands on a same-key replacement once the 10 s drain has given
  up (#408's correctness review). M7 held only for a write made inside the
  drain; since #424 (row cd) 2.0 drops the write inside and after the
  drain, so M7's text now holds for 2.0.
- **A `destroy()` during a pending unregister drain fires `onStop` twice,
  on both engines.** This is parity and needs no row.
- **M1's `$`-prefixed key check is a text error:** both engines accept a
  schema key `$a`.
- **M5's "joins a second concurrent call for the same module" is a text
  error:** on a namespaced system the second call rejects on both engines.

## Owner row candidates

All decided on 2026-11-17 by "Approve all as recommended (Recommended)"
(the run 3 section has the detail):

- **engine.ts 2261:9 (L10-pre-b, #409).** 2.0's behaviour is approved.
  Below.
- "M7's late write past the 10 s drain" is decided: row (cd).
- **`onStop` twice.** A `destroy()` during a pending unregister drain
  fires it twice, on both engines (Corrections). Kept as 1.35, which is
  parity.

engine.ts 2261:9 is triaged `v1-bug` in L10-pre-b (#409). 1.35's error
boundary derivation retry hands the failing derivation's id to
`derivationsManager.invalidate` (engine.ts:1107), whose argument is a fact
key (derivations.ts:932), so it invalidates the readers of a fact with the
derivation's name, not the derivation that threw. 2.0 does not. No row
covers it yet, and no test pins it: a public test of it kills the mutant on
1.35 and fails on 2.0. It needs a row, (bp) or later, before a test can pin
either side.

## Stops

None remain after run 3. Run 1's `call` trace stop is fixed (#414); B5
is met at steady state; seed d passes and the L8 `./internals` names ship
(#402). The record of each:

- **Fixed in #414, run 1's stop: a deferred `derive.call` of a stale
  derivation, in the trace.** Deep seed 2, up to L10 (spec in the gate's
  scratch, `specs/deep2c.json`). `d0` was invalidated and not read again,
  so its last value, 11, is stale. Inside a pass, the queued
  `derive.call("d0")` (D5, D8) recomputes it to 6. The trace run that
  follows lists `d0` in `derivationsRecomputed` with `oldValue` 11 on 1.35
  and `undefined` on 2.0 (`onTraceComplete`, and `inspect().trace` after
  it). Everything else in the case matches. This is a 2.0 parity
  difference in the trace's old value for a recompute through `call`, and
  no approved row covers it. It needs either a core-next fix that keeps the
  last value of a stale derivation for the trace, as 1.35 does, or a row
  from Jason. The gate may not touch `packages/core-next/src`.
- **Closed in run 3: B5.** Run 2 measured 1.04 times 1.35's time with a
  forced gc. At steady state ("Measure at steady state (Recommended)",
  2026-11-17), after #420 and #422, it is 0.92 times, with 8.6 to 9.6% fewer
  bytes (B5, above).
- **Closed in run 3: seed d.** It passes in 37 s. Before: It times out at 120 s,
  in the PR run and in `conformance:diff` and the census. Its deep run
  reports case all#175 (batched, the L9 stop's case) with the others GATE-8
  lists. It waits on Jason's ruling on the "Discard after the stop"
  wording (GATE-8.md, Stops).
- **Closed in run 3, the L8 stop** (#402 ships them): `createHistoryManager` and
  `createDisabledHistory` (`conformance:checks`, 9 failures; the census's
  "vitest exited 1"). Unchanged.
- **CI's 120 s, carried from L9:** seeds 7, 9 and 11 pass only past it
  (above). Not a difference; the L9 follow-up to profile 7:all#187 stands.

Apart from the `call` trace case, every difference the fuzz showed matches
an approved row.

## Follow-ups

- **The slow seeds (run 2).** CI never runs seeds 1 to 20: ci.yml:157 runs
  only seed 24301 at 120 s. Seeds 7, 9 and 11 need 413 to 697 s.
- **1:up to L10#1295 (run 2).** The (as) fit is reasoned; a pin of a
  running batch in an unregister drain would prove it.
- **2:up to L10#1551 (run 2).** Row (as)'s unhandled rejection two steps
  apart; its entry pairs only one step (`by` -1).
- **Run 1's batched follow-ups (run 2's table).** 1:all#2816's pass is
  unproven against row t.

- **The fuzz's reach.** No generated module has `sources`
  (`extraModule`, `diff/fuzz/model.ts:2815–2866`), so a module's source
  teardown (M6, a pending linger timer) is never fuzzed; and no case draws
  colliding joined keys (#407's namespaced key collisions).
- **(bk) and engine.ts 2261:9 (run 3):** no oracle test reaches either
  difference; a 1.35-only pin and a 2.0-side note wait for one.
- **B5 (run 3):** re-run on a quiet machine; run 3's headers said NOISY.
- **`packages/cli` typecheck (run 3):** a local run needs
  `@directive-run/knowledge` built, which needs the website's generated
  API reference.
- `conformance:typecheck`'s three errors in L10-pre-b's
  `l10-dynamic-gate-debt-oracle` (above).
- `ends` entries are read per case from the working tree
  (`readDivergences` in `runScenario`), so an edit during a run changes
  the run's own entries. This gate killed and reran each run that an edit
  overlapped.
- GATE-8's follow-ups that this gate did not touch stand: profile
  7:all#187, the payload tie-break, 24301:up to L8#948's replay, (ap)'s two
  deep cases.
