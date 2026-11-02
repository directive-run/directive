# Phase 3 gate decisions: the L5 gate

Date: 2026-11-01. Jason approved the L5 rows of the Directive 2.0 decisions
page (https://claude.ai/artifact/Ex2LGyfVqFNztHCZrj9UkR): "Approve all" for
(aa), (ab) and (ac), and "Approve both" for (ad) and (ae). He asked Claude to
sign the divergence entries for the rows he approved, on his behalf, as at the
L3 and L4 gates (GATE-2.md, rule 1).

## What the L5 gate does

`layers.rules.json` `current` is `"L5"`: core-next runs every test and every
differential scenario placed at L5 or below, and the fuzz generates v2 cases
up to L5 (sources, with gates, on top of everything up to L4). The ratchet
(`v2-passing.json`) gained 82 tests and lost none, tested by name against the
file on main; it holds 1,593. Each difference the diff harness shows at L5 is
recorded in `diff/divergences.json`, one entry per difference, each naming its
scenario, stream, kind, operation and step. One fuzz entry was added (row t,
below); every other entry is for a hand scenario.

## The L5 decisions

| Row | Decision (quoted from the decisions page) | Outcome |
| --- | --- | --- |
| A1 | "Sources inside createSystem in the alpha": "Approved: a raise up to 2.5 KB. L5b came in 282 bytes over, and on 2026-11-01 you approved up to 28.4 KB ("Approve up to 28.4 KB")." | Approved 2026-11-01. Sources are a part wired into `createSystem`, kept out of `floor`. Built in L5a (#322) and L5b (#323); sizes below |
| aa | "A failed re-key": "A failed re-key leaves the source detached until its next key change, and a return to the old key attaches straight away." | Approved 2026-11-01: "Approve all". Built in L5b (#323) |
| ab | "Coalesced payloads at a gate close": "They count as gate-closed drops, reported after onSourceDetach." | Approved 2026-11-01: "Approve all". Built in L5b (#323) |
| ac | "A failed gated attach": "The attach retries on the clock. The timer is cleared at stop and destroy, and skipped after a history navigation." | Approved 2026-11-01: "Approve all". Built in L5b (#323) |
| ad | "stop() called inside a source's attach": "a stop() during start's attach loop ends the loop, and stop's own detach covers every source attached so far." | Approved in chat 2026-11-01: "Approve both". Found reviewing L5a; built in L5c (#324) |
| ae | "A linger timer that fires during stopAsync()": "stop clears pending linger timers before it awaits, so nothing attaches during the stop." | Approved in chat 2026-11-01: "Approve both". Found reviewing L5b; built with (ad) in L5c (#324) |
| A2 | "The aperture fixture": "Keep the plan: a copy of the real Aperture lab at layer six. Nothing synthetic at layer five, since the minimal app already measures layer five's size." | Approved 2026-11-01 with the L5 rows ("Approve all"). Nothing built at L5 |
| B1 | "evict, and the source frame-loop bench": "B1: move evict to layer five with onEvict." | Approved 2026-11-01 with the L5 rows ("Approve all"). Placed by L5-pre (#320): 7 evict-only tests and the scenario "async stop, evict and destroy" moved from L10 to L5 |
| B2 | "B2: add a frame-loop-source benchmark." | Approved 2026-11-01. Built in #319; the L5 gate judges it against 0.8 times 1.35's time |
| B3 | "B3: keep evict on the system for now, and decide its beta home before beta." | Approved 2026-11-01. Nothing to do at L5 |
| crossing | "Where the fuzz stop starts when records cross": "When the engines reorder records just before an approved quirk, the stop starts before that crossing. On seed 2 it drops 12 records that a literal reading would keep." | Confirmed 2026-11-01: "Confirm crossing reading". A test-harness rule (#315); no entry |

Row j ("async stop, evict and destroy") is GATE-1's quirk j, approved with the
rest of the L3 rows ("If all are better or non user facing they are all
approved"). The scenario moved to L5 under B1 because it calls `evict()`, so
its entries come at this gate.

### The size approval

A1's approval was "a raise up to 2.5 KB", and "a raise past that comes back to
Jason". L5a took `minimal` from 25,489 B to 27,597 B (+2,108 B). L5b first measured
28,160 B, 160 B over the 28,000 B ceiling (the 25,500 B budget plus A1's
2.5 KB), and the budgets stayed unraised until Jason answered. With the
namespaced gate-write refusal (below, +122 B) it came to 28,282 B, 282 B over.
On 2026-11-01 he wrote "Approve up to 28.4 KB" (A1's 2.5 KB plus the L5b
overage), and `size-budgets.next.json` quotes it. L5c then added 32 B, to
28,314 B. Anything above 28,400 B comes back to him.

## The signed entries

All 118 carry `approvedBy: "Jason Comes"` and `date: "2026-11-01"`. 117 are
for hand scenarios (`engine: "v2"`, one `step` each). The 118th is a fuzz entry
(group `quirk-t`).

| Row | Scenario | Entries | What only one engine records |
| --- | --- | --- | --- |
| ac | U1: "a failed gated attach on a quiet system waits for an unrelated write to retry" | 12 | 2.0's retry at the end of the backoff, 250 ms (step 2: the attempt, `onSourceAttach`, `source.attach`); 1.35's retry only after the unrelated write (step 4); the attach count, the source's `attached` and `attachedAt` in between (steps 3, 5, 6) |
| aa + ac | U2: "a failed re-key with gateLingerMs retries only after another linger window" | 26 | 2.0's retry at the end of the backoff (step 6: the attach, the error record, `onSourceError`, `source.error`); 1.35's attach one linger window later (step 11); the source's state while they differ (steps 9, 10, 12) |
| ab | U3: "coalesced publishes queued after the closing write are dropped uncounted" | 8 | 2.0's `gate-closed` drop after `onSourceDetach` (step 2: `onSourceDrop`, `source.drop`) and the drop count and last drop reason that follow (steps 3, 5) |
| aa + ac | U9: "a return to the old key inside a retry's linger window leaves the source dark" | 41 | 2.0's retry and its attach at once on the return to the old key (steps 5, 9); 1.35's attach only after an unrelated write (step 14); the source's state through steps 7 to 16 |
| ad | "a stop inside a source's attach at start ends the attach loop" | 16 | 2.0's detach of the source whose attach ran the stop (step 1: `onSourceDetach`, `source.detach`, the unsubscribe); the attach of the next source, which only 1.35 makes (`subscribe`, `onSourceAttach`, `source.attach`); the attached count and the later sources' state at steps 2 and 3 |
| ae | "a linger pending at stopAsync attaches nothing during the stop" | 5 | 1.35's attach during `stopAsync()` (step 5: `subscribe`, `onSourceAttach`, `source.attach`); the source's `attachedAt` and `detachedAt` after it (step 6) |
| j | "async stop, evict and destroy" | 9 | the same nine records as the L3 sister scenario "async stop and destroy wait for in-flight runs": 2.0's resolver restart after `stopAsync()` then `start()` (step 4), the cancel of that run at `evict()` (step 5), and the timer it holds at teardown (step 6) |
| t | fuzz | 1 | 1.35's extra `requirement.canceled` observe event where the comparison pairs it with another run's cancel on 2.0 (changed in `event.id`) |

The ids are `l5-quirk-<rows>-<scenario slug>-<stream>-<kind>-<op>-step<N>`:
`l5-quirk-ac-u1-quiet-retry-*`, `l5-quirk-aa-ac-u2-rekey-retry-*`,
`l5-quirk-ab-u3-coalesce-close-*`, `l5-quirk-aa-ac-u9-return-old-key-*`,
`l5-quirk-ad-stop-in-attach-*`, `l5-quirk-ae-linger-stopasync-*` and
`l5-quirk-j-async-stop-evict-*`. The fuzz entry is
`l3-cand-t-fuzz-observe-requirement-canceled-changed`, named like the other
five `quirk-t` fuzz entries it joins (GATE-2.md). Every reason names its row
and ends with the signing sentence; the (aa) to (ac) entries quote "Approve
all", the (ad) and (ae) entries "Approve both", and the j and t entries the
approval of their rows.

U3 has a second order that matches 1.35. Payloads queued before the closing
write are flushed and dispatched first, so only the order where the closing
write comes first differs, and only that order is entered.

### Row t, the fuzz entry

Deep seed 24301 found one more path of row t at L5, latent at L4 (see "Found
while raising the gate"). It is row t's third path again (GATE-2.md): a run
reported complete is retracted before it leaves flight, and 1.35 reports a
`requirement.canceled` event for it that 2.0 does not. When the other run
canceled in the same pass is 2.0's, the comparison pairs the two events and
reports a change in `event.id`. The two hook entries for the same pairing
(`l3-cand-t-fuzz-hook-onResolverCancel-changed`,
`l3-cand-t-fuzz-hook-onRequirementCanceled-changed`) already existed. The
observe event had no entry, because L3's fuzz never drew a case that pairs
them. The new entry has no `when`, as the other five: the shape needs only a
resolver whose write retracts its own constraint.

## What (ad) reaches, as built

(ad) as approved is "stop() during start's attach loop". #324 built it as an
attach-level detach, so its reach is wider than the row's example. It also
closes the same leak for:

- `destroy()` inside an attach (destroy calls stop);
- `stopAsync()` inside an attach;
- a stop inside a gated attach, in a later gate pass.

One side effect comes with it. Once a stop ends a gate pass, the later gates
in that pass are not evaluated. So a gate that would throw while the system is
stopped reports nothing: 1.35 reports `onSourceError` for it, 2.0 does not.
The decisions page names both the wider reach and this side effect, and asks
the owner to say if he wants either narrowed. The row stands as approved.

No diff scenario covers any of these widened cases, so they get no entry. The
two scenarios that exist ((ad) at start, (ae) at `stopAsync()`) show only the
approved leak fixes. A stop followed by a start, both inside one attach, still
behaves as 1.35 does (a duplicate attach); it is logged as a follow-up.

## Parity fixes found in review

- **#323, the namespaced gate-write refusal.** In production, in a namespaced
  system without `crossModuleDeps`, a gate that writes a top-level fact is
  refused by 1.35, and the gate fails closed. L5b's first build let the write
  through, and development refused it with another message. The review found
  it; no test covered it. The fix refuses the write in both modes with 1.35's
  text and costs 122 B (64 B of it the message), inside the size the owner
  approved. It is a parity fix, so it has no entry.
- **#322 and #323, carried from the L5a review.** `start_` evaluates the
  gates; L5a's attach-order pins now include the gated source, in 1.35's order
  (review probe R1); core-next pins the module-scoped publish, the drop
  reasons and the cross-module warning.

## The static-mutant triage (#321)

The mutation run at the L5 ceiling (41362202220) failed on one entry,
`engine.ts:81:36`, the `SOURCE_NAMESPACE_SEPARATOR` constant mutated from
`"::"` to `""`. It is a module-load constant, a Stryker static mutant: the
per-test run never re-evaluates the module, so it reports Survived at every
ceiling. #321 moved it to `not-observable` (a harness limit), as
`NO_REQUIREMENT_CHANGES` already is, and it stays in the score's denominator.
The tests do catch it: applied by hand, the mutant fails 18 tests of
`l5-sources-oracle*`, all placed at L5, because every publish is dropped as
cross-module.

## Found while raising the gate

- At L5 the diff harness shows differences in seven hand scenarios, which the
  117 hand entries cover, and the fuzz found two failing cases (below).
  Everything else matches:
  "a key gate re-keys", "gateLingerMs", "coalesce lastWriteWins", "sources:
  attach, publish, active gate and detach" and "onEvict runs on evict" show no
  difference on any engine.
- **Fuzz seed 12 at the PR count was quirk a plus a harness spread (#327).**
  The spec sits at L3 and fails at L4 too. 2.0 re-runs r0 under the `"retry"`
  boundary (row a), r0's write retracts c1, and r1, which ignores its signal,
  raises both constraints again. 2.0 then ping-pongs through the 1,500 ms
  advance: 3,001 timer callbacks and 126,089 differences. `runScenario` spread
  every difference into `push(...)`, and that many arguments threw `RangeError:
  Maximum call stack size exceeded` before the comparison could explain
  anything. With a loop in its place, the first `ends` entry of quirk a stops
  the case, as intended, and it passes. The same spec with `fails: 0` gives
  identical traces on 1.35, the workspace engine and 2.0, so the oscillation
  belongs to the spec, not to either engine. #327 fixed the loop and pinned the
  shrunk case (group `quirk-a`). It needed no entry and no engine change.
- **Fuzz seed 24301 at 5,000 cases was row t's observe event, one more
  quirk-t shape.** It is the entry above. Its shrunk case is the sixth pinned
  fuzz case (`diff/fuzz/pinned.json`, group `quirk-t`): three constraints on
  one fact, one event that raises it, and two writes. r1's own write retracts
  c1 while r0 is canceled in the same pass; 1.35's extra
  `requirement.canceled` for r1 pairs with 2.0's cancel of r0. Removing the
  new entry makes the pinned case fail on seed 1, which draws nothing like it
  (`observe "requirement.canceled" in step 3: event.id differs`), so the pin
  carries the group on every seed.
- Both findings were latent at L4: each case sits at L2 or L3 and each fails
  with `current` at `"L4"`. No seed run at the L4 gate drew them.
- Nothing else differs, so nothing went to the owner unsigned.

## Two fuzz harness changes, and the owner decisions behind them

The deep runs at this gate found two cases the comparison could not judge. Both
were fixed in the harness (`diff/scenario.ts`), not in an engine, and neither
adds a divergence entry.

- **#327, no unbounded spread in `runScenario` (fuzz seed 12, quirk a).** The
  harness pushed every difference into the report with one spread call; at
  126,089 differences that threw `RangeError: Maximum call stack size exceeded`
  before anything was compared. A loop replaced the spread, so the first `ends`
  entry of quirk a stops the case as intended. The shrunk case is pinned (group
  `quirk-a`). No owner decision was involved: the oscillation belongs to the
  spec, and the engines agree on the same spec with `fails: 0`.
- **#328, a runaway past an approved stop is discarded.** Deep seed 24301 hung
  under quirk p (the retry-later quirk): after an approved `ends` stop had
  ended the comparison, 2.0 kept running timer callbacks past the budget, and
  the harness called that a hang and failed. Jason decided on 2026-11-02, in
  chat: "Discard after the stop". The rule: once an `ends` divergence on an engine has ended the
  comparison, that engine's runaway past it is discarded like a 1.35 runaway.
  It counts toward the same limit (the larger of 1% of the cases and 2), and
  the census fuzz line reports it as "discarded after a stop". A 2.0 runaway
  with no stop rule before it still fails, as does one before the stop, one on
  an engine other than the stop's, and a hand scenario's. Differences before the
  stop are still checked. The self-tests are `diff/self/runaway-after-stop.test.ts`
  (real engines).

**Known limit (from #328's review).** The runaway is taken to start at the first timer callback past the number the
reference needed to settle, and the stop must come before that point. So a 2.0 loop that starts within those
first callbacks, and whose own record matches an `ends` entry there, is still discarded. The discard counts
toward the runaway limit and shows in the census line.

## Results

The fuzz ran at the L5 ceiling (`current` = `"L5"`, committed), on top of main
at 9e723ff6 (#327 and #328 included). A passing seed means every compared case showed
only differences an existing signed entry covers, and the fuzz floors held.

**Pull-request count** (287 cases a seed, the default; seeds 1 to 20 and
24301): all 21 seeds pass. Per seed, 117 to 134 cases also ran on 2.0, and 7
to 17 ended early at an `ends` stop (seed 24301: 287 compared, 132 on 2.0, 11
ended early). Seed 5 discarded one runaway case (the reference passed 20,000
timer callbacks); every other seed discarded none, and none discarded a case
after a stop. Seed 12, which crashed the
harness before #327, passes.

**Deep runs** (`DIFF_FUZZ_RUNS=5000 --testTimeout=1200000`: 5,000 cases across
every layer, plus the cases up to L5 where 2.0 takes part):

| Seed | Runs | Cases (on 2.0 too) | Result | Time | Ended early at an `ends` stop | Discarded after a stop |
| --- | --- | --- | --- | --- | --- | --- |
| 24301 | 5,000 | 7,000 (3,062) | passes, 6,999 compared | 367.1 s | 246 | 1 |
| 1 | 5,000 | 7,000 (3,060) | passes, 7,000 compared | 271.9 s | 260 | 0 |
| 2 | 5,000 | 7,000 (3,067) | passes, 7,000 compared | 275.1 s | 287 | 0 |

The three runs shared one machine, so the times are not a speed measure. No
case was discarded as a 1.35 runaway (the reference passing 20,000 timer
callbacks) in any of them. Seed 24301's one runaway is the quirk-p case that
hung the fuzz before #328: its 2.0 run alone takes about 90 s (1,031,108 trace
records) and is now discarded after the stop (see the next section). The
`--testTimeout=1200000` is for that case; the default 120 s timeout is not
enough for it.

The census (seed 24301, PR count) reads: ``[census] fuzz: 287 cases compared
(seed 24301), 132 of them on v2 too, 11 ended early by an `ends` divergence (at
step 3.7 on average; 0 at step 0)``. It has no "discarded after a stop" clause,
because that seed discards none at the PR count; at 5,000 runs seed 24301
discards one (above). The ratchet holds 1,593
tests; 82 are new and none was removed.

**Group removal.** Each entry group was removed in turn from
`diff/divergences.json` and its scenario run; exactly the group's differences
came back, in that one scenario, and the file was restored byte for byte.

| Group removed | Entries | Differences that reappeared |
| --- | --- | --- |
| U1 (ac) | 12 | 12, in U1 only |
| U2 (aa + ac) | 26 | 26, in U2 only |
| U3 (ab) | 8 | 8, in U3 only |
| U9 (aa + ac) | 41 | 41, in U9 only |
| (ad) | 16 | 16, in the (ad) scenario only |
| (ae) | 5 | 5, in the (ae) scenario only |
| j | 9 | 9, in "async stop, evict and destroy" only |
| t (fuzz) | 1 | the fuzz fails on `event.id` (observe `requirement.canceled`), on seed 24301 and on seed 1 |

## Sizes

Measured with `node packages/core-next/scripts/size.mjs --check` (esbuild,
gzip level 9) at this gate. Every fixture is under its budget in
`size-budgets.next.json`. L5a, L5b and L5c raised budgets within the owner's
size approvals above; the gate raises none.

| Fixture | 2.0 (bytes, min+gzip) | Budget | At the L4 gate | 1.35 |
| --- | --- | --- | --- | --- |
| minimal | 28,314 | 28,400 | 25,489 | 55,290 |
| two-module | 28,403 | 28,500 | 25,572 | 55,381 |
| floor | 10,417 | 10,450 | 10,367 | |
| graph.ts alone | 1,797 | 1,850 | 1,797 | |
| full entry (every export) | 30,448 | 30,550 | 27,596 | |

The minimal app on 2.0 is 51% of its size on 1.35 (26,976 bytes smaller), with
86 bytes left under its budget. Sources cost it 2,825 bytes in the alpha:
L5a +2,108 B (the lifecycle, publish, errors, timeouts, evict and hook names
+1,589 B; `inspect().sources`, the counters and the `source.*` observations
+469 B; the seams +50 B in `floor`), L5b +685 B (the gate registry, the gate
timers, commit and evaluate, coalesce, the `gate-closed` guard and the
namespaced gate-write refusal, less folds with L5a's code; the budget's reason
in `size-budgets.next.json` itemizes them) and L5c +32 B.
At the beta `source()` and the codemod move sources behind an import, and
`minimal` drops by their size (A1).
