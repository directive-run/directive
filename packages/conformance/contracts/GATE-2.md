# Phase 2 gate decisions: the L3 gate

Date: 2026-11-01. Jason approved every row of the Directive 2.0 decisions page
(https://claude.ai/artifact/Ex2LGyfVqFNztHCZrj9UkR): "If all are better or non
user facing they are all approved." Every row there is Better, Test rule only
or Same as 1.35, so all fifteen recommendations stand. He asked Claude to sign
the divergence entries for the rows he approved, on his behalf.

## What the L3 gate does

`layers.rules.json` `current` is `"L3"`: core-next runs every test and every
differential scenario placed at L3 or below, and the fuzz generates v2 cases up
to L3. The ratchet (`v2-passing.json`) gained 164 tests and lost none, tested
by name against the file on main. Each difference the diff harness shows at L3
is recorded in `diff/divergences.json`, one entry per kind of difference, each
naming its scenario, stream, kind, operation and path.

Two scenarios were placed above the layer of what they use. Each was split,
keeping every step and every comparison:

| Was (L3) | Now |
| --- | --- |
| "notify: guardrail and clobber-loop channels reach plugins" | "notify: guardrail channels reach plugins" (L3) and "notify: clobber-loop channels reach plugins" (L12, which core-next has not built) |
| "async stop and destroy wait for in-flight runs; evict" | "async stop and destroy wait for in-flight runs" (L3) and "async stop, evict and destroy" (L10, which core-next has not built; it keeps the stop and restart before `evict`, so `evict` runs in the same state as before) |

One scenario was added for row t's third path (below): "a run retracted after it
reported complete: complete, then cancel", at L2 (it uses constraints and
resolvers, no `stop()`). The diff harness shows it at L3 because `current` is
now L3; at the L2 gate nothing ran it.

## The fifteen decisions

| Row | Decision | Outcome |
| --- | --- | --- |
| 1 | Sign the quirk-b divergence entries in the L2 gate | Approved |
| 2 | One console-warning entry covers both directions of quirk b | Approved (test rule only) |
| 3 | Jitter: the exact random draw is incidental; each delay is checked against its jitter bounds | Approved (test rule only), built in #288 |
| l | A run satisfied by its own write is listed as canceled and in flight, as in 1.35 | Same as 1.35 until beta |
| m | The development-only false clobber on an object-valued `abortOn` fact is fixed | Approved; 2.0 never had it, so no entry |
| n | A timeout aborts the timed-out attempt's signal | Approved; entries signed at the L2 gate |
| o | A non-JSON write through a module warns once | Approved |
| A1 | `"retry"` re-dispatches, up to 3 times in a row per requirement (quirk a) | Approved |
| p | `"retry-later"` re-dispatches, at most `maxRetries` times in a row per requirement | Approved |
| q | `startTimer` on a completed timer does nothing | Approved |
| r | `destroy()` clears the never-started warning | Approved |
| s | Only a `start()` that starts the system arms the tick; `stop()` and `destroy()` clear it | Approved |
| t | `stop()` from a completion hook reports the outcome only, with no cancel after it | Approved |
| v | Plugin hooks receive the system the app uses | Approved; checked again at L12 |
| A6 | The other items found later keep 1.35's behaviour in the alphas | Same as 1.35; each is decided at beta |

## The rules this gate sets

1. **Agents sign on his instruction, for approved rows only.** An entry's
   `approvedBy` is "Jason Comes" and its `reason` ends with "Signed 2026-11-01
   on the owner's instruction: he approved this row on the decisions page ...
   and asked Claude to sign for him." Only entries for rows he approved are
   signed (a, b, f, j, p, s, t at L3; the entries for b and n were signed at
   the L2 gate, and the n entries are still the L2 ones). A difference that matches no
   approved row stops the gate and goes to him unsigned.
2. **The oracle guard allows signed entries in an engine PR (#290).** A PR
   that touches core-next may change `diff/divergences.json` (with or without
   `harness.lock.json`, never the lock alone) and no other harness file. Every
   entry it adds or changes, by `id`, must have a non-empty `approvedBy`, and a
   changed entry must be signed afresh. Removing an entry needs no signature.
   The `oracle-change` label is still required, and the census still fails an
   entry that covers no difference.
3. **The (p) bound is per requirement.** `retry-later` re-dispatches a
   requirement at most `maxRetries` times in a row; the count is reset by a
   completed run, a retraction or `stop()`. The key, the delays and the 1,000
   cap stay as in 1.35.
4. **The jitter draw is incidental (#288).** The diff harness does not compare
   the exact random draw of a jittered delay. It checks that each delay falls
   within the bounds its jitter allows and that chains running at once keep
   their own order.

## Found while raising the gate

- Four L2 quirk-b entries (the "changed" ones, which pair 1.35's extra error
  with another run's) covered nothing at the L3 fixed seed, so the census
  failed them as stale and they were removed. Removing an entry needs no
  signature. These classes are rare at other seeds; they are not covered
  there (see the last item). The L2 console-warning entry
  (`l2-quirk-b-console-warn`) was removed the same way and is restored as it
  is on main: approved fix o (#294, one development warning for a non-JSON
  write through a module) shows at L3 as a missing or extra console warning,
  and that entry covers it.
- Quirk b also shows under the `"throw"` strategy (the extra error 1.35 adds
  after a cancel surfaces as an unhandled error) and under `"disable"`. Under
  `"disable"`, 1.35's extra error also disabled the constraint, while 2.0 keeps
  it enabled (a consequence of b), so the constraint's evaluations and its
  `inspect()` entry differ for the rest of the case. The `"throw"` records
  are ordinary entries (`l3-quirk-b-fuzz-error-unhandled-*`); the `"disable"`
  cascade is ended by the `observe` `resolver.error` entry below.
- The fuzz reaches the error-boundary strategies, so quirks a and p (and b
  under `"disable"`) cascade through whole traces. Entries written per
  record at one seed failed at every other seed, so the gate uses `ends`
  entries instead (the rule below).

## The `ends` rule (#296)

A signed fuzz entry with `ends: true` stops the comparison of a fuzz case at
the first difference it covers, on that engine. The owner's decision behind it:
"The fuzz compares a case exactly up to its first approved-quirk difference,
then stops comparing that case." The case is compared exactly up to that
difference: an uncovered difference before it, or beside it, still fails; a
difference after it is not compared; the case still counts toward the fuzz
floors; and other engines are compared in full. `ends` is valid only on a
signed entry for scenario `fuzz`, engine `v2`, with an `op` (and a `path` when
the op is `changed`). An `ends` entry that never stopped a case is stale like
any other, which is why an entry can exist only for a class the fixed seed
shows. The census prints how many cases ended early, at which step on average
and how many at step 0.

Every `ends` entry is for engine `v2`, signed, and carries `when` (see "How a
fuzz entry is narrowed" below). The four groups that have one (as of #301):

| Group | Entries that end a case | `when` | Ends a fuzz case at |
| --- | --- | --- | --- |
| `quirk-a` (row A1) | 12 of its 13: `onReconcileStart` or `onResolverStart` extra; `onResolverStart` and the `resolver.start` event changed (`args`, `event`); the external `start` record extra or changed (`data[1]` the resolver, `data[2]` the attempt); `wrote` changed (`data[2]`); `onResolverRetry` extra or changed (`args[2]`); `onReconcileEnd` changed (`args[0].inflight`, `args[0].unmet`) | `resolverRetry` | the first record only the re-dispatch makes, or the first that the comparison pairs with another run's because of it. `l3-quirk-a-fuzz-hook-onResolverRetry-missing` is in the group but does not end a case |
| `quirk-p` (row p) | all 5: `onReconcileStart` or `onResolverStart` extra; `start` changed (`data[2]`); an `effect` run or `cleanup` extra | `resolverRetryLater` | the first record of a `retry-later` re-dispatch 1.35 does not make, or of the effect runs its writes cause |
| `quirk-j` | all 5: `onResolverStart` or `onReconcileStart` extra; `onResolverStart` changed (`args`); `onReconcileEnd` changed (in flight, unmet) | `restart` | the first record of the run that `stop()` then `start()` re-dispatches on 2.0 |
| `quirk-b` | all 10: each error record 1.35 adds after the cancel (`onError`, `onErrorRecovery`, `onResolverError`, `resolver.error`, the unhandled error under `"throw"`), missing or changed | `resolverRejects` | the first of 1.35's extra error records: from it on the strategy (disable, throw, retry) runs on 1.35 only |

32 entries end a case in all (12, 5, 5 and 10). At the PR seed (24301, 287 cases, 90 on v2) 7 cases end early, at step 3.9 on average, none at step 0.

## How a fuzz entry is narrowed (#297)

Three pieces, each described in `README.md` under "Divergences":

- **Kinded records.** The fuzz model records a resolver's start and its write
  as `external` records of kind `start` and `wrote`, as aborts already were
  (`["start" | "wrote" | "aborted", "<m>.r<i>", attempt]`). Before, the kind
  was `<m>.r<i>`, one kind per resolver, and a start could pair with a write.
  An entry now names `start`, `wrote` or `aborted` and the path inside
  (`data[1]` the resolver, `data[2]` the attempt number).
- **`when`.** A fuzz entry covers a difference only in a case that has every
  trigger it lists; an `ends` entry must list at least one. Each case
  computes its triggers from the options it really passes
  (`diff/fuzz/model.ts` `specTriggers`; names in `lib/fuzz.ts`
  `FUZZ_TRIGGERS`):

  | Trigger | The case has it when |
  | --- | --- |
  | `resolverRetry` | `errorBoundary.onResolverError` is `"retry"` and the case has a resolver |
  | `resolverRetryLater` | `onResolverError` is `"retry-later"` and the case has a resolver |
  | `constraintRetryLater` | `onConstraintError` is `"retry-later"` and the case has a constraint (never set today: the model passes `"skip"`) |
  | `retryPolicy` | some resolver has a `retry` policy (more than one attempt) |
  | `timeout` | some resolver has a `timeout` |
  | `resolverRejects` | some resolver can reject: it fails at least once (`fails` > 0), or its `timeout` is no longer than its wait, so the timeout can fire before it writes (#301) |
  | `settleStop` | the case has a resolver: a settle step can leave its `settle()` waiting, and a stop, destroy or the teardown always follows a settle step (#301) |
  | `restart` | the steps have a `stop` with a `start` after it and no `destroy` before that `start` (1.35 ignores `start()` after `destroy()`) |
  | `disable` | some strategy is `"disable"` and the case has what it applies to: a resolver (`onResolverError`) or an effect (`onEffectError`) |
  | `throw` | some strategy is `"throw"` and the case has a resolver (effects then skip) |

  The census rejects an unknown trigger, an empty or repeated list, and
  `when` on a hand scenario. The model passes every strategy as a string; a
  function strategy makes `specTriggers` throw rather than guess.
- **`group`.** One signed decision whose quirk shows in several shapes gets
  one entry per shape and a shared `group` (`quirk-a`, `quirk-p`, `quirk-j`,
  `quirk-n`, `quirk-b`, `quirk-t`). The census counts every entry of a group
  used when any entry of it covered a difference, because one seed shows only
  some shapes. Entries of a group share `approvedBy` and `when`; a group
  that covered nothing is stale as a whole. `group` changes only the stale
  check, never what an entry covers.

Fuzz entries by group (52, as of #301): `quirk-a` 13, `quirk-p` 5, `quirk-j` 5,
`quirk-n` 10 (`timeout`, `aborted`, `wrote` and `start` records; `when:
timeout`), `quirk-b` 10 (`when: resolverRejects`), `quirk-t` 5 (no `when`: the
shape needs only a resolver whose write retracts its own constraint), `quirk-z`
3 (`when: settleStop`) and the L2 console-warning entry `l2-quirk-b-console-warn`
(no group, no `when`).

## Row t has a third path

Row t (approved: `stop()` from a completion hook reports the outcome only, with
no cancel after it) shows a third way at L3, found by the fuzz and pinned
below. A reconcile pass retracts a run after the run reported complete but
before it left flight: the run's own write retracted its constraint while
another resolver completed in the same tick. 1.35 then also reports
`onResolverCancel`, `onRequirementCanceled` and the `requirement.canceled`
observe event for it. 2.0 reports the completion only (it still aborts the
signal), and `onReconcileEnd` lists the requirement canceled on both, as in
row l. No `stop()` is involved. The scenario "a run retracted after it reported
complete: complete, then cancel" (L2) shows it; its three entries are
`l3-cand-t-*` for the plugin hooks and the observe event, and the five fuzz
entries are group `quirk-t`.

## Pinned fuzz cases

`diff/fuzz/pinned.json` holds four fixed cases that the ceiling phase runs
before its random ones, on every seed (fast-check `examples`): quirk p
(`retry-later` re-dispatch, seed 5's ceiling phase), quirk j (`stop()` then
`start()` re-dispatches, seed 5), quirk t (the third path above; since #301
the case is built from its hand scenario, because the seed-2 case it replaced
now ends at a quirk-b stop before t's records) and,
since #301, quirk z (a `settle()` still waiting at the teardown, seed 3 at
5,000 cases).
Each shows one approved quirk whose fuzz group the random cases of the fixed
seed (24301) never reach. Without them the census would find those groups
unused at the PR seed and fail them as stale, so whichever seed the PR or the
nightly runs would decide whether the group could exist. With them the
census sees every group used on each run, and finds a group stale the day 2.0
stops showing its quirk, which is the point of the stale check. An entry
still covers only what it names. The owner kept them on 2026-11-01: "keep
diff/fuzz/pinned.json (three fixed fuzz cases for quirks p, j and t on every
seed)".

## The nightly fuzz at 5,000 cases (#301)

At the L3 gate the PR fuzz passed and the nightly depth (5,000 cases) failed on
shapes of approved quirks a and n. The owner decided on 2026-11-01 to merge the
gate and fix the depth in its own slice: "timeout aborts recorded under their
own kind, and ends entries also dropping differences beside the stop". #301
built both, and found two more approved shapes on the way.

**Timeout aborts get their own kind.** In `diff/fuzz/model.ts` an abort whose
`signal.reason` is the resolver's timeout error is recorded as `["timeout",
"<m>.r<i>", attempt]`; any other abort stays `aborted`. 1.35 never aborts a
signal on a timeout, so a `timeout` record is 2.0's alone (row n): a survey of
seeds 1 to 20 and 24301 at the PR count, and 1, 2, 3, 4 and 24301 at depth,
found none in any 1.35 trace. Before, the comparison paired 2.0's early timeout
abort with 1.35's later cancel-time abort of the same attempt, and every other
run's record between the two moved. The n group's abort entry is re-scoped to
`timeout`. Effect runs and cleanups are kinded the same way since #301
(`["effect" | "cleanup", "<m>.x<i>", values]`), so row p's extra effect runs
need one entry, not one per effect.

**`ends` also drops differences beside the stop.** A difference is dropped if
it comes strictly after the stop, or if it is an unmatched record in the same
gap as an unmatched stop (between the same two matched records, in either
trace). Only an `ends` entry makes a stop, and only in a case with its `when`
triggers; a difference before the gap is still reported (`diff/compare.ts`
`isPastStop`, `diff/self/ends.test.ts`).

**Row z (approved 2026-11-01).** The owner approved 2.0's behaviour: "a pending
settle() resolves at stop or destroy, with no lingering timer and no late
rejection". 1.35 leaves a `settle()` that is still waiting when `stop()` or
`destroy()` runs pending, keeps its 5-second `maxWait` timer through
`destroy()`, and rejects it once the wait runs out (`settle() timed out`). 2.0
resolves it at `stop()` (`packages/core-next/src/api/core.ts`, `stopped()`).
The hand scenario "settle() pending across stop() and destroy()" (L3, in
`l3-lifecycle-plugins`) shows all three differences, each with a signed
`l3-quirk-z-settle-*` entry: the outcome 2.0 records at `stop()`, the timer
count after `destroy()`, and the late rejection only 1.35 records. In the fuzz
a settle step leaves its `settle()` waiting when its drive gives up (500 timer
jumps) with a run in flight; the group `quirk-z` covers the timer count after
a destroy step or the teardown and the late rejection, with `when:
settleStop`. The spec cannot narrow it below "the case has a resolver",
because every case ends with a settle step and then the teardown.

**Row b's window is wider than a retry backoff.** 1.35 reports a cancel and
then an error for one run also when the run rejects and is canceled in the
same timer tick, with no backoff at all (a probe with no retry policy and no
timeout shows it). The b group's `when` was `retryPolicy`, which missed that
window (seed 4 at depth, a timeout and `"throw"`), so it is now
`resolverRejects`: some resolver can reject, which every case of either window
has. Every b entry now ends the case: 1.35's extra error changes what the case
does next (the strategy disables, throws or re-runs), and the comparison pairs
the records after it differently for each seed. All ten were re-signed.

**Row t's error shape.** The same probe, with the cancel one microtask after
the rejection, shows row t's order for an error: 1.35 reports the error and
then a cancel for the same run, 2.0 the error only. That is row t's shape
("reports the outcome only, with no cancel after it") with an error as the
outcome. The `quirk-t` entries have no `when` and cover the missing cancel
records whatever the outcome, so this shape needs no new entry.

**Results at #301.** At the PR count (205 cases) seeds 1 to 20 and 24301 all
pass, 21 of 21. At 5,000 cases seeds 1, 3 and 4 pass; seeds 2 and 24301 still
fail, on approved shapes (a with n, and b) that per-shape entries cannot reach:

- the comparison aligns each stream on its own, so under quirk a the observe
  events of 2.0's re-dispatched pass (`fact.change`, `reconcile.start`, …) can
  be unmatched earlier than the hook-stream stop (seed 24301);
- where 1.35's extra error (b) pairs as `changed` with a later error of 2.0's,
  a stop at that record does not drop the records between its two halves, so a
  bystander write (`onFactSet`, `fact.change`, `onDerivation*`) that 2.0 makes
  earlier stays reported (seed 2; two replays of the round-1 residuals).

Covering these with entries would need wide bystander entries (an extra fact
write anywhere in a case with the trigger), which the owner has not approved.
They need a decision on the stop rule instead (for example, a stop drops the
unmatched records of every stream after the last record both traces matched
before it). Until then the nightly fuzz stays red on seeds like these and the
PR fuzz stays green.

