# Phase 3 gate decisions: the L4 gate

Date: 2026-11-01. Jason approved the L4 rows of the Directive 2.0 decisions
page (https://claude.ai/artifact/Ex2LGyfVqFNztHCZrj9UkR): "Approve all five".
He asked Claude to sign the divergence entries for the rows he approved, on
his behalf, as at the L3 gate (GATE-2.md, rule 1).

## What the L4 gate does

`layers.rules.json` `current` is `"L4"`: core-next runs every test and every
differential scenario placed at L4 or below, and the fuzz generates v2 cases up
to L4 (effects with `deps`, on top of everything up to L3). The ratchet
(`v2-passing.json`) gained 11 tests and lost none, tested by name
against the file on main. Each difference the diff harness shows at L4 is
recorded in `diff/divergences.json`, one entry per difference, each naming its
scenario, stream, kind, operation and step.

## The L4 decisions

| Row | Decision (quoted from the decisions page) | Outcome |
| --- | --- | --- |
| c | GATE-1 quirk (c): "A membership test re-runs the effect only when membership changes" | Approved; effects only, built in L4b (#313) |
| w | "A membership test that answers false": "As quirk c says, it re-runs only when the answer changes, including while the answer stays false." | Approved 2026-11-01: "Quirk c applies to effects only; constraints keep 1.35's behaviour." Built in L4b (#313) |
| x | "Cleanup on effects.disable()": "2.0 runs the cleanup straight away when the effect is disabled." | Approved 2026-11-01. Built in L4a (#308) |
| y | "deps and on after disable and enable": "2.0 keeps the declared deps and on gate across disable and enable." 1.35 "forgets its declared deps and on gate, and runs on every change, including through the error boundary's disable strategy." | Approved 2026-11-01. Built in L4a (#308) |
| B1 | "Where data-form predicates live": "Stay at layer eleven. Building them at layer four would put the minimal app at about 26.2 to 27 KB, over its 25.5 KB budget." | Approved 2026-11-01: "they stay at layer eleven." Placed by L4-pre (#306) |
| B2 | "The frame-loop benchmark's shape": "A new frame-loop workload, which the layer-five gate measures against the plan's target of at most 0.8 times 1.35's time." | Approved 2026-11-01. Built in #305 |
| z | "A settle() waiting across stop() or destroy()": "2.0 resolves it at stop or destroy, and its timer is cleared." | Approved in chat on 2026-11-01; its entries were signed at the L3 gate and still cover it at L4 |

## The membership parity fix (#302)

Before quirk (c) could be built, 2.0 had to match 1.35 where (c) does not
apply. In 1.35 a membership test on a derivation (`"d" in derived`) inside a
constraint or an effect watches the derivation, so the reader is woken at
every change of its value. 2.0 did not watch it. #302 made the derive view's
`has` trap watch the derivation for constraint and effect askers, as 1.35
does, and #303 pinned it. L4b (#313) then changed effects only: inside an
effect body the trap records a membership key and does not watch the
derivation. Constraints and derivations keep 1.35's rule, which the L2 diff
scenario "a constraint that only tests a derivation's membership" checks on
every engine (it shows no difference).

## The signed entries

All 57 are for hand scenarios (`engine: "v2"`, one `step` each). No fuzz entry
was needed: the fuzz never calls `effects.disable()` or `enable()` and never
tests membership, so rows c, w, x and y cannot show in a fuzz case, and the
error boundary's `"disable"` strategy shows nothing on its own (row y needs an
`enable()` after it, and row x a cleanup still pending at the disable).

| Row | Scenario | Entries | What only one engine records |
| --- | --- | --- | --- |
| c | "an effect that only tests a derivation's membership" | 12 | 1.35's re-run at each of the four writes of `a` (steps 1, 3, 5, 9): the `onEffectRun` hook, the `effect.run` event, the effect's own record |
| w | "an effect that tests a name that is not a derivation" | 18 | 1.35's re-run at each of the six writes (steps 1, 3, 5, 7, 9, 11), the same three records |
| y | "disable then enable: an effect with declared deps and a write to an unrelated fact" | 6 | 1.35's runs at the writes of `b` and `c` after `enable()` (steps 9, 11) |
| y | "disable then enable: an effect with a derivation dep and a write to an unrelated fact" | 6 | the same, steps 7 and 9 |
| y | "disable then enable: an auto-tracked effect and a write to an unrelated fact" | 3 | 1.35's run at the write of `b` after `enable()` (step 7) |
| y | "disable then enable: an effect the error boundary disabled and a write to an unrelated fact" | 6 | 1.35's runs at the writes of `b` and `c` after `enable()` (steps 7, 9) |
| x | "an effect's cleanup when disabled" | 6 | 2.0's cleanup at each `disable()` (steps 3, 4, 5); 1.35's at the run after `enable()` (step 9) and at `stop()` (step 12, twice) |

The ids are `l4-quirk-<row>-<scenario slug>-<stream>-<kind>-<op>-step<N>`.
The y scenario with an `on` gate needs data-form predicates, so it sits at L11
(B1) and does not run at this gate.

## Found while raising the gate

- At L4 the diff harness shows differences in seven hand scenarios and in no
  fuzz case: with `current` at L4 and no new fuzz entry, the PR fuzz passes at
  seeds 1 to 20 and 24301. Every difference is one of rows c, w, x and y;
  nothing else differs, so nothing went to the owner unsigned.
- The controls show no difference: the L4 scenarios "deps at startup", "effects
  disable, enable and run in declaration order", "effects: deps, prev, cleanup
  and auto-tracking" and "effects: a throwing effect goes to the boundary and
  keeps running" pass on every engine, and so does the L2 constraint control
  for (c).
- The 11 ratchet additions are tests of `effects.disable()`, `enable()` and
  `isEnabled()` (`blackbox-effects`, `engine`, `l1-effects`), which pass on
  core-next's source and dist.

## Results

FUZZ

## Sizes

Measured with `pnpm --filter @directive-run/core-next size` (esbuild, gzip
level 9) at this gate. L4a and L4b raised no budget: every fixture is under
the Phase 2 gate's budget in `size-budgets.next.json`.

| Fixture | 2.0 (bytes, min+gzip) | Budget | 1.35 |
| --- | --- | --- | --- |
| minimal | 25,489 | 25,500 | 55,290 |
| two-module | 25,572 | 25,600 | 55,381 |
| floor | 10,367 | 10,400 | |
| graph.ts alone | 1,797 | 1,850 | |
| full entry (every export) | 27,596 | 27,700 | |

The minimal app on 2.0 is 46% of its size on 1.35 (29,801 bytes smaller), with
11 bytes left under its budget.
