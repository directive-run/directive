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
   signed (a, b, f, j, n, p, s, t at L3). A difference that matches no
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

- Five L2 quirk-b entries covered nothing at the L3 fixed seed, so the census
  failed them as stale and they were removed: the console-warning entry and the
  four "changed" entries that pair 1.35's extra error with another run's.
  Removing an entry needs no signature. The classes still occur at other seeds.
- Quirk b also shows under the `"throw"` strategy (the extra error 1.35 adds
  after a cancel surfaces as an unhandled error) and under `"disable"` (it
  disables the constraint). Both are covered by `l3-quirk-b-fuzz-*`.
- The fuzz now reaches the error-boundary strategies, so quirks a and p cascade
  through whole traces. The fixed-seed entries cover exactly what that seed
  shows. Other seeds show the same quirks with other indexes and ordering, so
  the nightly fuzz is expected to fail until those classes are decided: the PR
  description counts them.
