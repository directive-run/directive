# Phase 1 gate decisions

Date: 2026-10-30. Jason approved the Phase 1 gate and every recommendation
below ("Approved gates and go with your recommendation: but needs to be
correct not a patch or monkey fix"). The three L2 design answers were the
coordinator's recommendations, adopted under that approval; Jason can still
overrule any of them before its layer is built.

## What Phase 1 delivered

L0 and L1 of core-next: the reactive graph, the scheduler and clock, facts,
derivations, effects and modules. Measured on main (production, minified,
gzip):

| What | 2.0 | 1.35 |
| --- | --- | --- |
| Reactive graph | 1,797 B (budget 1,800 B) | n/a |
| Minimal app | 14,426 B | 55,290 B |
| Two-module app | 14,509 B | 55,381 B |
| Floor (`createSystemCore`, no parts) | 8,629 B | n/a |
| Every core-next export | 16,332 B | n/a |

Every whole-system workload in `bench/system` runs 35 to 56 percent faster
than 1.35, and a write allocates no memory. The graph alone stays 25 to 50
percent slower than alien-signals (accepted 2026-10-20). All six L1 files pass
the mutation gate (derivations 86.9, effects 83.4, facts 91.8, module 100,
read-only-view 97.2, tracking 90.5). `v2-passing.json` holds 988 tests.

## Decision 1: the gate

Phase 1 is approved. L2 may be built.

## Decision 2: the eleven 1.35 quirks are fixed in 2.0

2.0 fixes each one in the layer that builds it, rather than copying the 1.35
behaviour and removing it later. 1.x is untouched. When a layer lands, the PR
that builds it adds, for each quirk in that layer:

- a black-box test of the 2.0 behaviour, and a differential scenario that
  shows the difference from 1.35;
- a `diff/divergences.json` entry with `approvedBy` left empty. Jason signs it
  on the PR (README, "Divergences"); an agent never fills it in.

| | 1.35 behaviour | 2.0 behaviour | Layer |
| --- | --- | --- | --- |
| a | Under `onResolverError: "retry"` the resolver is never run again | The resolver is re-dispatched under its retry policy | L3 |
| b | A run whose requirement is retracted during its retry backoff reports `cancel`, then `error` | Exactly one outcome per run: `cancel` | L2 |
| c | `"x" in derived` inside an effect re-runs the effect | A membership test re-runs the effect only when membership changes | L4 |
| d | During fact-listener notification, a listener that reads a derivation after an earlier listener's nested write gets the stale value | The fresh value (core-next already behaves this way) | L0 |
| e | A constraint `after` one that never fires is blocked forever | A constraint `after` another is unblocked once that one has evaluated without firing, or its requirement has resolved | L2 |
| f | A timer completed while paused keeps counting elapsed time | Completing freezes elapsed time | L3 |
| g | Retracting one requirement of a running batch cancels the whole batch, including still-wanted siblings | Only the retracted requirement is canceled | L7 |
| h | A batch where every item fails retries at once, ignoring backoff and the retry hook | The batch retries under its retry policy | L7 |
| i | Failed batch items are never retried one by one, though the docs say they can be | Failed items retry individually | L7 |
| j | After `stop()` then `start()`, still-wanted canceled requirements are not run again | `start()` re-dispatches every requirement still wanted | L2 / L3 |
| k | A batch that mixes requirements from different constraints overwrites a concurrent write to an `abortOn` fact | The `abortOn` contract holds for mixed batches | L7 |

Found later and logged with the follow-ups, not yet decided: the derive view
reports `"toString" in system.derive` as true while the value is undefined;
`startTimer` restarts a completed timer though its doc says no-op; config
validation gaps (`tickMs: Infinity` and `NaN`, `modules: null` / `5` / `true`,
blocked `initialFacts` keys refused at different times); `canceled[].resolverId`
is `"unknown"` for an aborted resolver; a first-compute derivation error
escapes `start()`.

## Decision 3: the L2 design questions (RFC #232)

1. **Errors as stream records.** The change list in the RFC's "Errors" section
   (rows 1 to 6) is approved for beta, with the `"throw"` strategy reaching
   the host as a rejected `settle()` or `whenReady()`. The alphas keep 1.35's
   throw behaviour, as the plan says.
2. **A minimal app pays for the reconcile engine.** In the alphas `minimal`
   counts as a build that includes constraints, so its budget is set at the
   Phase 2 gate from measurements. Beta offers an engine-free entry through
   the opt-in feature imports; the `floor` fixture (8.6 KB) is its measure.
3. **The two-outcome case.** Fixed in 2.0 from the start (Decision 2, row b).
   This replaces the RFC's suggestion to keep parity in the alphas.

## Decision 4: two mutation-gate rules

Both change `MUTATION.md` and `scripts/mutation-score.ts`, and both are
general rules, not exceptions for one file.

1. **Proxy mechanics leave the score.** A mutant whose only effect is on a
   view's Proxy mechanics (a trap's return value, a property descriptor, or
   the identity or caching of a view object) is excluded, like `equivalent`.
   2.0 replaces these views with compiled accessors, so `STABILITY.md` states
   that view identity, descriptors and `Reflect` results are not part of the
   contract. The proof is the same as for `equivalent`: with the mutant
   applied by hand, the whole suite at the file's ceiling passes, and a
   reviewer re-checks each entry.
2. **A mutant is scored at the layer of the feature it implements.** Code
   that no test reaches, or that tests run but cannot observe until a later
   feature exists, may be assigned that later layer with a note naming the
   feature. It is deferred until that layer's gate, where it counts like any
   other mutant: the later layer's tests must kill it before that layer is
   built. A mutant a test at or below the file's row can observe is never
   deferred. This supersedes the 2026-10-24 clarification that code no test
   reaches counts against its file's row. The scorer prints the deferred
   count per layer, so the debt stays visible.

## Decision 5: the principal review

The second principal review of Phase 1 runs on Fable when its allowance
resets. Its blockers become slices.
