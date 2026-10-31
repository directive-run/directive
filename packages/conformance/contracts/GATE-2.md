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

| Entry | Quirk | Ends a fuzz case at |
| --- | --- | --- |
| `l3-quirk-a-fuzz-hook-onReconcileStart-extra` | a and p | the `onReconcileStart` hook call only 2.0 makes, for the re-dispatch (op `extra`) |
| `l2-quirk-b-observe-resolver-error-missing` | b | the `resolver.error` observe event 1.35 adds after the cancel, the last of its four extra records (op `missing`); the other three stay ordinary entries |

## Still open: classes the fixed seed does not show

An entry for a class that the fixed seed does not show is stale there, and the
census fails it, so these cannot be covered. Seeds 1 to 20 at the PR's run count
show them (the PR description counts them): the resolver's own `start` record
(`external`, kind `<module>.r<n>`, one kind per resolver) as quirk a's first
difference in four "retry" cases; the quirk-b "changed" pairings; an
`aborted` record that differs in the resolver (`data[1]`), not only the attempt
number; quirk j's extra `onResolverStart` after `stop()` then `start()`; and the
records that follow an unhandled error under `"throw"`. The nightly fuzz fails
on them until the owner decides how to cover them.
