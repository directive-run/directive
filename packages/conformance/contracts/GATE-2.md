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
fuzz entry is narrowed" below). The four groups that have one:

| Group | Entries | `when` | Ends a fuzz case at |
| --- | --- | --- | --- |
| `quirk-a` (row A1) | `l3-quirk-a-fuzz-hook-onReconcileStart-extra`, `l3-quirk-a-fuzz-hook-onResolverStart-extra`, `l3-quirk-a-fuzz-external-start-extra`, `l3-quirk-a-fuzz-external-start-changed-attempt`, `l3-quirk-a-fuzz-external-wrote-changed-attempt` | `resolverRetry` | the first record only the re-dispatch makes: its `onReconcileStart` or `onResolverStart` call, the resolver's own `start` record (extra, or with another attempt number), or a `wrote` record with another attempt number. `l3-quirk-a-fuzz-hook-onResolverRetry-missing` is in the group but does not end a case |
| `quirk-p` (row p) | `l3-quirk-p-fuzz-hook-onReconcileStart-extra`, `l3-quirk-p-fuzz-hook-onResolverStart-extra` | `resolverRetryLater` | the `onReconcileStart` or `onResolverStart` call of the `retry-later` re-dispatch |
| `quirk-j` | `l3-quirk-j-fuzz-hook-onResolverStart-extra`, `l3-quirk-j-fuzz-hook-onReconcileStart-extra`, `l3-quirk-j-fuzz-hook-onReconcileEnd-changed-inflight`, `l3-quirk-j-fuzz-hook-onReconcileEnd-changed-unmet` | `restart` | the first record of the run that `stop()` then `start()` re-dispatches on 2.0 (an extra start, or an `onReconcileEnd` whose in-flight or unmet list holds it) |
| `quirk-b` | `l2-quirk-b-observe-resolver-error-missing` | `retryPolicy` | the `resolver.error` observe event 1.35 adds after the cancel, the last of its four extra records (the other three are ordinary entries) |

Twelve entries end a case in all (5, 2, 4 and 1). At the PR seed 6 cases end
early, at step 4.2 on average, none at step 0.

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

Fuzz entries by group (38): `quirk-a` 6, `quirk-p` 2, `quirk-j` 4, `quirk-n` 10
(`aborted`, `wrote` and `start` records; `when: timeout`), `quirk-b` 10
(`when: retryPolicy`), `quirk-t` 5 (no `when`: the shape needs only a resolver
whose write retracts its own constraint) and the L2 console-warning entry
`l2-quirk-b-console-warn` (no group, no `when`).

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

`diff/fuzz/pinned.json` holds three fixed cases that the ceiling phase runs
before its random ones, on every seed (fast-check `examples`): quirk p
(`retry-later` re-dispatch, seed 5's ceiling phase), quirk j (`stop()` then
`start()` re-dispatches, seed 5) and quirk t (the third path above, seed 2).
Each shows one approved quirk whose fuzz group the random cases of the fixed
seed (24301) never reach. Without them the census would find those groups
unused at the PR seed and fail them as stale, so whichever seed the PR or the
nightly runs would decide whether the group could exist. With them the
census sees every group used on each run, and finds a group stale the day 2.0
stops showing its quirk, which is the point of the stale check. An entry
still covers only what it names. The owner kept them on 2026-11-01: "keep
diff/fuzz/pinned.json (three fixed fuzz cases for quirks p, j and t on every
seed)".

## Known open: the nightly fuzz at 5,000 cases

The PR fuzz passes: the fixed seed (24301), 287 cases compared, 90 of them on
v2, 6 ended early; and seeds 1 to 20 plus 24301 at the PR run count (205) all
exit 0, 21 of 21.

The nightly fuzz runs 5,000 cases and still fails. The three seeds run at that
depth (2, 24301 and 1) all fail on shapes of approved quirks a and n that the
entries do not cover:

- seed 2: quirk a, where a record beside the stop differs (`onFactSet` missing
  on v2, then extra `reconcile.start` and `requirement.created`) and `ends`
  does not drop it, because "beside" is not "after";
- seed 24301: quirk n, a timed-out attempt's error records (`onError`,
  `onErrorRecovery`, `onResolverError`, `resolver.error`, extra on v2) at a
  step where the pairing differs;
- seed 1: an `external` `start` record whose resolver differs (`data[1]`), a
  pairing artifact of quirks a and n.

These are classified from the first difference of each seed, not by proving
every record. None looks like an unapproved row. The owner decided on
2026-11-01 to merge the gate now and fix this in its own slice: "timeout
aborts recorded under their own kind, and ends entries also dropping
differences beside the stop". Until that lands, the nightly fuzz is red at
5,000 cases and the PR fuzz stays green.
