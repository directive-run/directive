# Phase 3 gate decisions: the L7 gate

Date: 2026-11-08. Jason approved the L7 rows of the batch-resolver RFC
(`packages/core-next/docs/rfc-l7-batch.md` on `p7/l7-rfc`, "Decisions for the
owner") on 2026-11-05: "Approve up to +1.1 KB (Recommended)" for the size,
"Approve (Recommended)" for (as), "Same as single runs (Recommended)" for (au),
and "Approve all (Recommended)" for the rest, signing included. He asked
Claude to sign the entries for the rows he approved, on his behalf, as at the
earlier gates (GATE-2.md, rule 1).

## What the L7 gate does

`layers.rules.json` `current` is `"L7"`: core-next runs every test and every
differential scenario placed at L7 or below (batched resolvers: `batch`,
`resolveBatch`, `resolveBatchWithResults`, the fallback to `resolve()`), and
the fuzz generates v2 cases up to L7 with a batched resolver in the model.
The ratchet (`v2-passing.json`) gained 74 tests and lost none, tested by name
against the file on main; it holds 1,766.

Each difference the diff harness shows at L7 is recorded in
`diff/divergences.json`. The hand scenarios have 298 exact entries, each with
`excuses` and counts (528 records). The fuzz has 99 new entries, each with a
`bound`, the narrowest `when` and a `group` per row (below). The bounds of the
84 that had none were derived by `scripts/fingerprint-divergences.ts --seeds
1-20` (the PR run covers seed 24301); 55 of them covered no record themselves
on those seeds and are bounded by their class's records. Six drafted entries
that never covered a record, and that the census rejected (four quirk-b
timeout twins whose `when` split their group, two `ends` entries for a changed
record with no path), were removed. Four conformance pins,
U3, U7, U10 and U14, are 1.35-only by #339's mechanism, each naming its row,
with 2.0's side pinned in core-next.

## The L7 decisions

The middle column says what each row decides, in plain words. The quotes in
the right column are Jason's own words.

| Row | What it decides | Outcome |
| --- | --- | --- |
| A1, size | L7 may add up to 1.1 KB to `minimal`, `two-module`, `aperture` and the full entry | "Approve up to +1.1 KB (Recommended)", 2026-11-05; raised for L7b's quirk fixes by "Approve +1,175 B (Recommended)", for #362 by "Approve +1,210 B (Recommended)", 2026-11-07, for #363 by "Approve +1,216 B (Recommended)", 2026-11-07, and for every parity fix found at this gate by "Allow up to +1,250 B (Recommended)", 2026-11-08 (`minimal` ≤ 29,933 B; each fix still reviewed, anything past it goes back to him) |
| All-in target | Each layer has its own budget, with 2.0 aiming at half of 1.35's size or less | "Budget per layer; aim ≤ half of 1.35 (Recommended)" |
| (ap) | A batch window starts at the first add to an empty queue and is not moved, so a batch runs at most `windowMs` after its first requirement | "Approve all (Recommended)", 2026-11-05. Built in L7a (#357) |
| (aq) | The cancel hooks for a running batch's requirement get the whole requirement, as for a queued one | "Approve all (Recommended)", 2026-11-05. Built in L7b (#359) |
| (ar) | An all-failed with-results batch retries under the batch's retry policy like a thrown batch, and each item reports its own error once, after its last attempt | "Approve all (Recommended)", 2026-11-05. Built in L7b (#359) |
| (as) | `settle()`, the settled notification and `inspect()` count a running batch | "Approve (Recommended)", 2026-11-05. Built in L7a (#357) |
| (at) | With only `resolve()`, each requirement becomes an ordinary single run once the window closes: in flight, cancelable, stopped by `stop()` and waited for by `settle()` | "Approve all (Recommended)", 2026-11-05. Built in L7a (#357) |
| (au) | A superseded batch member reports a cancel from the old batch, and the new run completes it | "Same as single runs (Recommended)", 2026-11-05. Found by review (below) |
| (av) | A queue holds a requirement once, so a call holds it once | "Approve: once (Recommended)", 2026-11-07. Built in #362 |
| Quirks g, h, i, k | Batch retraction, retry, partial failure and mixed-constraint rules (GATE-1 Decision 2) | "Approved gates and go with your recommendation: but needs to be correct not a patch or monkey fix", 2026-10-30. Built in L7b (#359) |
| Row t, batch path (B-4) | A batch's outcome after a clobber or a stop is reported once | "If all are better or non user facing they are all approved.", 2026-11-01 |

## The fuzz harness decisions

The fuzz compares both engines at each `settle` step. 1.35's `settle()`
resolves while a batch still runs, and 2.0's waits for it ((as)), so a plain
comparison there would show (as) in every later record. Jason chose how the
harness meets that, and how it judges a case that never ends, in six steps:

| Date | Decision | Jason's words |
| --- | --- | --- |
| 2026-11-06 | At a settle step, advance 1.35's clock until its batches finish | "Wait out 1.35's batches (Recommended)" |
| 2026-11-07 | Advance 2.0's clock until its detached batch runs finish too | "Wait out 2.0's detached batches too (Recommended)" |
| 2026-11-07 | Replace both with one wait: both clocks advance together until neither has a batch still running, capped at 5 s | "One shared wait (Recommended)" |
| 2026-11-07 | A case whose 1.35 batches never finish (1.35 re-dispatches a "retry" batch forever) is discarded on its own count | "Discard, own count (Recommended)" |
| 2026-11-07 | That count may reach 1% of a seed's cases, at least 3 | "Cap at 1% of cases, min 3 (Recommended)" |
| 2026-11-08 | Where only 2.0 is still running at the cap, it fails as a 2.0 bug only if no fuzz handler wrote while its signal was aborted during the wait; otherwise it is a test-handler loop, discarded under the never-settles cap on its own sub-line, naming the approved row that let 2.0 in | "Refine: write-after-cancel = discard (Recommended)" |

Why the last one: in seed 8, a canceled fuzz handler ignores its aborted
signal and still writes, which raises the batch again, and the two writes
chase each other. Only 2.0 enters the chase, through approved quirk a's
re-dispatch; given the same first write, 1.35 runs the identical chase
(6,005 calls in 5 s), and with a handler that respects its signal 2.0 stops
after 6 calls. So the loop is the test handler's, not the engine's
(seed 10 is the same pattern with both engines live). A 2.0 that stays live
with no write after an abort still fails (diff/self/settle-drain.test.ts).

Three readings are the coordinator's, not separate owner
decisions (README, "one shared wait"):

- a call reads as live up to and including its timeout's due time, and a
  retry's backoff up to and including its end, so the wait never stops at the
  very timer it waits for (seed 12);
- an aborted call is live while its timeout timer is pending: 1.35's
  `withTimeout` clears that timer only when the call settles or the timer
  fires (seed 19);
- a test-handler loop names "the first entry in the case's `used` list that
  names a quirk". `used` is in the order the comparison explained the
  differences, not the loop's cause, so seed 8 names quirk o's console entry
  first; the report also lists every used quirk entry (quirk a's among
  them), and a loop with no used quirk entry still fails.

## Fixes found in review and at the gate

- **(au), found by review (L7a).** The first L7a build reported nothing from
  the old batch when a member was superseded; 1.35 completes it from both
  runs. Sent to Jason, who chose "Same as single runs (Recommended)": the old
  batch reports a cancel at the supersede, and the new run completes it.
- **The batch-resolver alignment bug, found while fixing (au).** The handler's
  list now stays as it was called, so a with-results batch's results stay
  aligned with its requirements; a member superseded meanwhile is skipped when
  outcomes are told.
- **Bytes per flush (L7a).** The heap probe now measures bytes per
  `batch-fanout-100` flush (below).
- **#361.** A batch that ended by a rethrow (throw boundary) never told
  `settle()`, which hung until its 5 s rejection.
- **#362.** A batch queue could hold one requirement twice (the "retry" pass
  and quirk a's requeue both added it), and `settle()` could resolve with
  requirements still queued.
- **#363.** Under "throw", 2.0 asked for a reconcile pass after a batch
  rethrow; 1.35's batch skips it. Hook-only.
- **#364.** A with-results success asked for its pass one tick after 1.35's
  (seed 11). Hook-only. As a side effect, an all-or-nothing error that landed
  one tick early now matches 1.35.

#361 and #362 were 2.0 bugs an app could see (a hung `settle()`, a handler
given a requirement twice); #363 and #364 were hook-only parity. Each was its
own engine pull request, reviewed, and each fits the size allowance above.

## The RFC corrections

- **B-4, by L7-pre's probe.** The RFC's B-4 text described 2.0, not 1.35. On
  1.35 (U10) the order is `complete a, cancel a, cancel b, cancel c, complete
  b, complete c`. The coordinator's call: this is row t's batch-shaped path,
  signed under row t like its third path, with the path named in the reason.
- **Quirk g's reading.** 1.35 aborts the whole batch when one requirement is
  retracted and cancels every requirement in it; the still-wanted ones never
  run again (RFC C2; probe B2 and the design review's rerun). 2.0 cancels the
  retracted requirement alone and aborts the batch's signal only when every
  requirement has left. Quirk g's entries carry this account.

## The signed entries

Every entry carries `approvedBy: "Jason Comes"`, and each reason names its row
and ends with the signing sentence quoting that row's approval. The g, h, i
and k entries quote GATE-1 Decision 2 and the L7 signing instruction ("Approve
all (Recommended)", 2026-11-05).

| Row | Hand entries | Fuzz entries |
| --- | --- | --- |
| (ap) | 53 | 0 |
| (aq) | 4 | 2 (`row-aq`) |
| (as) | 61 | 1 (`row-as`) |
| (at) | 45 | 4 (`row-at`) |
| (au) | 7 | 0 |
| (av) | 0 | 7 (`av`) |
| Quirk g | 12 | 19 (`quirk-g` 18, `quirk-g-fails` 1) |
| Quirk h, with (ar) (53 hand) and (as) (8 hand) | 61 | 11 (`quirk-h`) |
| Quirk i | 24 | 11 (`quirk-i` 7, `quirk-i-passes` 4) |
| Quirk k | 19 | 18 (`quirk-k`) |
| Row p, per requirement (U11) | 12 | 4 (`quirk-p`) |
| Row t's batch path (B-4) | 0 | 4 (`quirk-t-batch`) |
| Quirk b (GATE-1), batch shape | 0 | 6 (`quirk-b` 2, `quirk-b-batch` 4) |
| Row n, batch shape | 0 | 12 (`quirk-n-batch`) |
| **Total** | **298** (528 records) | **99** |

A fuzz `group` is one signed decision with one `when`. Where a row's batch
shape needs a different trigger, its entries form their own group:
`quirk-g-fails` (a call can fail), `quirk-i-passes` (one attempt too),
`quirk-n-batch`, `quirk-b-batch`, `quirk-t-batch` and `row-as`.

## Results

**Fuzz, pull-request count** (287 cases a seed; seeds 1 to 20 and 24301):
all 21 exit 0. Over the 21 seeds, 6,000 cases were compared, 2,736 of them on
2.0 too (117 to 140 a seed), and 564 ended early at an `ends` stop. Three
1.35 runaways were discarded (seeds 5, 18 and 20), none after a stop. The
shared wait advanced 1.35's clock in 684 compared cases and 2.0's in 101, and
102 needed more than one round.

| Census line | Total | Per seed | Cap |
| --- | --- | --- | --- |
| Never settles (discarded) | 24 | 0 to 3 | 3 a seed (max(1% of 287, 3)) |
| of them, both engines live | 2 | seeds 10 and 18 | |
| of them, test-handler loops | 1 | seed 8 | |
| Failed as 2.0-only live | 0 | | |

Seeds 1, 3, 7 and 10 sit at the cap of 3.

**Trigger rates** among the 1,722 cases generated up to L7 over these seeds
(each case can set several): `batched` 33%, `batchSiblings` 27%,
`batchTimeout` 22%, `batchFails` 22%, `batchRetry` 22%, `batchAbortOn` 20%,
`batchMixed` 15%, `batchFallback` 11%, `batchWithResults` 11%,
`batchAllFail` 3.7%, `batchSomeFail` 3.2%.

**Deep runs** (`DIFF_FUZZ_RUNS=5000 --testTimeout=1200000`): not yet passing.
Each failing seed stops at its first failing case, which fast-check then
shrinks, so a seed shows one case at a time.

- **Seed 1** (failed at case 2,175 of 7,000, 11 never-settles discards so
  far): approved row (av) in a new shape. A bound batched requirement is
  retracted and raised again; 1.35's queue holds it twice, which fills
  `maxSize` 2 and flushes the call at once, with the item twice; 2.0's queue
  holds it once, so its call waits for the window timer and runs one step
  later. Not yet entered: the narrowest `when` available
  (`batched`, `batchAbortOn`) would let an `ends` entry for a missing batch
  start stop any abortOn case, which would also excuse a 2.0 that never
  starts a batch. It needs a narrower trigger (a set `maxSize`) first.
- **Seed 24301** (failed at case 1,311): not a 2.0 bug, but a shape no rule
  covers yet. Both engines' `settle()` resolve at 1 ms with the system
  settled and nothing in flight. In that same millisecond a canceled run's
  handler writes after its abort (the write-after-cancel pattern) and raises
  a new run. The shared wait then waits out 1.35, which is not settled, but
  leaves 2.0 out as "settle() resolved with attached work left", so the two
  checkpoints differ. Open for a decision.
- **Seed 2** (failed at case 3,294; the tallies include fast-check's
  shrink runs, so its 22 "2.0-only live" and 50 runaways are one case and
  its shrinks): "2.0-only live" with no handler write after an abort, which
  the rule fails as a 2.0 bug. The shrunk case: under "retry", r0 (f0 ≥ 1
  → write 0) fails its first attempt; quirk a re-dispatches it on 2.0 only,
  and its write of 0 starts a chase with the fallback batch (f0 ≥ 0 →
  write 1, `abortOn`), whose requirement is raised anew at each change. In
  5 s, 2.0 makes 2,007 batch calls and 2,005 r0 runs; 1.35 makes 4 calls,
  and r0 never writes. It looks like seed 8's mechanism with ordinary writes
  in place of writes after an abort. It is not entered or discarded: it
  goes back to the coordinator.

**Open at this commit (the gate has not passed yet).**

- The two deep seeds above.
- `pnpm census` fails on staleness. Its own run (seed 24301 at the PR count)
  uses no entry of seven L7 fuzz groups: `av`, `quirk-t-batch`,
  `quirk-g-fails`, `row-as`, `quirk-h`, `quirk-i` and `quirk-i-passes`
  (30 entries). Each group covers records on other PR seeds. The fix
  proposed is a pinned fuzz example for each group (diff/fuzz/pinned.json),
  so that every census run exercises them.

## Sizes

Measured with `pnpm size:check` in `packages/core-next` (esbuild, gzip level
9) at this gate, after #364. Both engines are built the same way since #333:
production, with development text stripped. Every fixture is under its budget
in `size-budgets.next.json`.

| Fixture | 2.0 (bytes, min+gzip) | Budget | Before L7 | 1.35 |
| --- | --- | --- | --- | --- |
| minimal | 29,912 | 29,914 | 28,683 | 49,313 |
| two-module | 30,003 | 30,005 | 28,771 | 49,414 |
| aperture | 34,805 | 34,807 | 33,577 | 53,871 |
| floor | 10,446 | 10,450 | 10,439 | |
| graph.ts alone | 1,797 | 1,850 | 1,797 | |
| full entry (every export) | 32,154 | 32,161 | 30,945 | |

L7 cost `minimal` 1,229 bytes, inside "Allow up to +1,250 B (Recommended)"
(`minimal` ≤ 29,933 B). The minimal app on 2.0 is 61% of its size on 1.35
(19,401 bytes smaller), and the Aperture lab 65% (19,066 bytes smaller).

**The ratchet.** `v2-passing.json` holds 1,766 tests, 74 more than on main
(1,692), compared by name, with none removed. This run added none: `pnpm
ratchet` passes with nothing new to add.

**Bench (B4).** `batch-fanout-100` (one pass raises 100 requirements for one
batched resolver, the window flushes full, the handler writes 100 facts): 2.0
takes about 0.55 of 1.35's time, and allocates about 266 KB a flush against
about 290 KB.

## Follow-ups (logged)

- Deep seed 1, case 1,967: an (av) pairing problem (run 9; reported by the
  nightly, to triage).
- Deep seed 24301, case 3,397: 1.35 cancels A0, while 2.0 cancels batch item
  0.2. Untraced (run 9; reported by the nightly, to triage).
- Deep seed 2, case 3,718: external aborted missing on v2. Untraced (run 9;
  reported by the nightly, to triage).

- Quirk i's per-run `satisfied_` flag: a failed item loses its retry when a
  satisfied sibling was superseded first, and a failed item the batch's own
  write satisfied still retries and errors (L7b).
- A test for `host.leave_(run, done)`: re-raise or retract a succeeded item
  during the retry (L7b).
- U6's pin binds both sources to one key, so the diff cannot see the union;
  bind different keys (L7b).
- Note P5 (a pass-1-only bound key changing before pass 2 is a clobber) in
  quirk k's reason, and word the size reason so the +83 B reads as `minimal`
  only (L7b).
- The fuzz's quirk-i reach (L7a).
- The B-4 entries' `batchTimeout` trigger still fires on fallback specs and
  when the timeout is longer than the delay; a narrower trigger is needed.
- `l7-fuzz-av-hook-onError-missing` sits before the `l7-fuzz-t-b4-*`
  entries, so it ends cases that are row t's B-4 path (seed 5's
  "retry" case: 1.35 reports a batch timeout after a clobber, 2.0 does
  not); both rows are approved, but the attribution should follow the row.
- 2.0 could report a with-results item's error inline when no attempt is
  left (quirk i, fourth triage).
- `fingerprint-divergences.ts --rebound` cannot run at L7. With every bound
  stripped, seed 16 fails: an earlier wildcard takes the record that quirk
  k's `ends` entry stops at. This gate derived only the missing bounds.
- 55 of the 84 new bounds come from their class's records, because those
  entries covered nothing themselves on the 21 seeds. They are worth a review
  for width, starting with `l7-fuzz-k-external-aborted-extra`, whose bound
  also takes single-resolver `aborted` records.
- A test-handler loop names the first used entry that names a quirk. `used`
  is in the order the comparison explained the differences, so seed 8 names
  quirk o's console entry; quirk a is in the listed set. A causal choice
  would need the loop's first post-abort write traced to its row.
