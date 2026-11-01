# RFC: L4 full effects

Status: draft for review, revision 1. No engine code merges from this document.
Tree: branch `p4/l4-rfc`, cut from `main` at `2aeb7598` (L0 to L3 built and gated; `layers.rules.json` `current` is `"L3"`). Size budgets are the ones `main` gained after this cut, in `size-budgets.next.json` (#298).

## What we are building

L4 finishes effects. The plan's row reads "Full effects: deps/on, prev, skip-tracking that works per frame, sync reconcile fast path", and GATE-1 places one approved quirk here, (c): a membership test such as `"x" in derived` inside an effect re-runs the effect only when membership changes.

The rules are the ones L2 and L3 settled on. Parity with 1.35 is the rule, and when this document and 1.35 disagree, 1.35 wins. Every run ends in one outcome. One scheduler and one clock. The dev-string count stays exact. Every layer slice runs `conformance:diff` at the forced layer and checks the open gates.

**What may differ from 1.35.** Quirk (c) is approved (GATE-1, decision 2). Anything else here that would behave differently from 1.35 is a **candidate divergence**, lettered after the ones already used ((a) to (v)): (w), (x) and (y). They are listed under "Decisions for the owner", list A, and are built only if Jason approves them. Until he does, the slice keeps 1.35's behaviour.

| If "approved" means | Then this gets built |
|---|---|
| Effect controls | `system.effects.disable`, `enable` and `isEnabled` on the system, over the manager core-next already has. An unknown id throws 1.35's error. |
| Per-frame tracking | An auto-tracked effect still records its reads on every run, as in 1.35, but into reused storage, so a run that reads what it read last time allocates nothing. Choosing which effects run costs per changed key, not per effect. |
| Quirk (c) | Inside an effect, `"x" in derived` records a membership dependency instead of the derivation's value. Nothing changes membership before L10. |
| Data forms | Only if decision B1 says L4: one predicate evaluator shared by constraint `when` and effect `on`. |
| Already built, pinned here | `deps`, `prev`, lazy `prev` and the synchronous pass, which came in with L0 to L3. |
| Candidates, built only if approved | (w) a membership test that answers false also waits for membership. (x) `disable()` runs the effect's cleanup at once. (y) an effect keeps its declared `deps` after `disable()` and `enable()`. |

**In plain terms:** most of L4 is already in core-next. What is missing is small: the effect controls on the system, quirk (c), the data forms, and making re-tracking cost nothing per frame. The biggest question is not engineering but placement and size: whether data forms belong here at all (B1).

## Gap analysis, measured

What I ran: `layers.rules.json` `current` set to `"L4"` in the working copy only, then `npx vitest run --project conformance:v2`, `--project conformance:v2:dist` and `--project conformance:diff` from `packages/conformance`, with the JSON reporter. Then `current` went back to `"L3"`. Nothing in `packages/conformance` is changed by this PR.

| Run | Tests | Pass | Fail | Skipped |
|---|---|---|---|---|
| `conformance:v2` at forced L4 | 3,102 | 1,306 | 10 | 1,786 |
| `conformance:v2:dist` at forced L4 | 3,102 | 1,306 | 10 | 1,786 |
| `conformance:diff` at forced L4 | 228 | 225 | 3 | 0 |

**Reading the table:** the two v2 runs fail on exactly the same 10 tests, and every one is placed at L4, so nothing at L0 to L3 has slipped. 104 tests are placed at L4: 93 pass, 10 fail, and 1 is skipped. That is the first measure of how much of L4 already exists.

| Feature | Failing | Files | Representative tests |
|---|---|---|---|
| Effect controls (`system.effects.disable`, `enable`, `isEnabled`) | 9 | `blackbox-effects` (5), `l1-effects` (4) | "a disabled effect is skipped, enabling brings it back"; "an effect disabled by an earlier one in the same pass does not run"; "a disabled effect drops the derivations it pinned"; "enable, disable and isEnabled on an unknown effect throw" |
| deps and on | 0 | | 83 tests with `deps` pass. No test with an `on` data form runs at L4: the census lifts every data form to L11 (see B1). |
| prev | 0 | | 59 tests whose effect takes `prev` pass |
| Skip-tracking per frame | 0 | | A speed property; no conformance test can see it |
| Sync reconcile fast path | 0 | | Built at L2 and L3 |
| Quirk (c) | 0 | | Nothing fails yet, but one L0 test pins 1.35's behaviour and will fail once (c) is built: `l1-derivations-effects` "re-runs when it only tested the derivation's membership" |
| Other: placed too low | 1 | `trace` | "calls onTraceComplete plugin hook with finalized trace entry": it uses `createSystem({ trace: true })`, an L9 option the detector does not know, so it is placed at L4 by its module's `deps` |
| **Total** | **10** | | |

**Reading the table:** nine of the ten failures are one missing member: core-next's effects manager already has `disable`, `enable` and `isEnabled` (`api/effects.ts:460–473`), but the system does not expose them. The tenth is a census gap, not an engine gap. `deps`, `prev` and the synchronous pass all pass already.

| Failing diff scenario | Differences | Why |
|---|---|---|
| "data-form when, on and comparison operators" | 117 | core-next has no predicate evaluator. A data-form `when` is called as a function and throws (`onConstraintError` is extra on v2), and a data-form `on` is checked but never evaluated, so its effect runs on every change. |
| "an `on` predicate gates an effect; derived values read inside run" | 18 | The same missing `on` gate: the gated effect runs where 1.35 holds it back. |
| "effects disable, enable and run in declaration order" | 8 | `system.effects` is missing, so the step that disables an effect throws. |

**Reading the table:** all three are L4 work, and none is an approved quirk or a candidate, so all three must match 1.35 by the L4 gate. Two of them depend on decision B1, because the scenario table places data forms at L4 while the test detector places them at L11.

## The design: each 1.35 rule, the mechanism that keeps it, and its pin

Where a row says "verified", the behaviour was observed by running a script against the built 1.35 package; the output is in "Evidence" at the end. The rest is read from the code, with the lines cited. 1.35 paths are under `packages/core/src/core/`, core-next paths under `packages/core-next/src/`.

### deps and on

**In plain terms:** declared `deps` already work in core-next. `on` is half there: it is validated but never evaluated.

| # | 1.35 rule | 2.0 mechanism and seam | Pinned by |
|---|---|---|---|
| D1 | A declared `deps` list is fixed. Each name that is a derivation maps to the derivation's dependency key; any other name is a fact key (`effects.ts:787–806, 847–856`). | Built: `depKey` maps the name and calls `ctx.watch` (`api/effects.ts:145–162, 497–504`). | `derivation-deps` (3), `derived-in-constraints-effects` (6), `blackbox-effects` deps tests (pass) |
| D2 | A name that means nothing yet is asked again on each pass, so a derivation registered after its effect is found (`effects.ts:813–825, 946`). | Names can only start to exist with dynamic registration, so this arrives with L10, beside `register`. | L10's tests |
| D3 | An effect with dependencies runs only when one of them is among the pass's changed keys. One with none (never run, or an auto-tracked run that read nothing) runs on every change (`effects.ts:937–978`). | Built: `select()` (`api/effects.ts:389–413`). L4b replaces the scan with an index (T2). | `effect-deps-startup` (2), `effect-reconcile-boundaries` (9) |
| D4 | `on` must be a predicate, or the system throws at creation (`effects.ts:866–875`). Its dependencies are the fact paths it names (`extractDeps`, `effects.ts:877`). After the dependency check, the gate is evaluated against a snapshot of the facts and the previous snapshot, and the effect runs only if it passes (`effects.ts:965–971`). A throw from the gate is attributed to the effect (`effects.ts:882–886`). | Validation is built (`api/effects.ts:151–155`); the gate is not. If B1 says L4: a new `api/predicate.ts`, the one evaluator that constraint `when` and effect `on` both call, with the gate run inside `select()`. | diff "an `on` predicate gates an effect…", "data-form when, on and comparison operators"; `data-forms` (3 at L11 today) |
| D5 | Effects run in declaration order, and an effect asked to run again by the `"retry"` strategy runs whatever changed (`effects.ts:1317–1340`). | Built: the states map keeps declaration order; `rerun_` (`api/effects.ts:474–479`). The index in T2 must emit in declaration order. | diff "effects disable, enable and run in declaration order" |

**Reading the table:** D1, D3 and D5 are done and pinned. D2 belongs to L10, where a name can come to exist. D4 is the real work, and how much of it L4 does is decision B1.

### Effect controls

**In plain terms:** the system gets the three methods 1.35 has. Two details of 1.35's `disable` look like bugs, and they are candidates (x) and (y).

| # | 1.35 rule | 2.0 mechanism and seam | Pinned by |
|---|---|---|---|
| C1 | `system.effects.disable(id)`, `enable(id)` and `isEnabled(id)` (`engine.ts:2633–2636`). An unknown id throws `[Directive] Unknown effect: <id>`, in production too (`effects.ts:828–832`, reached through `getState`). | A `system.effects` object defined by the effects part, over the manager's existing methods. The unknown-id throw is a plain throw, not a dev string. | the 9 failing control tests |
| C2 | A disabled effect is checked when it is about to run, so one disabled by an earlier effect in the same pass does not run (`effects.ts:1207`). | Built: `run()` checks `state.enabled` (`api/effects.ts:328`). | `l1-effects` and `blackbox-effects` "an effect disabled by an earlier one in the same pass does not run" |
| C3 | `disable` sets `enabled` to false and throws away the dependency set, so the derivations it read stop being watched (`effects.ts:1447–1458`). It does **not** run the effect's cleanup: the cleanup runs at the effect's next run or at `stop()` (verified). | core-next's `disable` runs the cleanup at once (`api/effects.ts:460–466`). Without (x), L4a removes that call. Watching becomes counted: core-next's `watched` set is add-only (`api/core.ts:1475`), so the effects part gains an unwatch that releases a derivation no other reader holds. | "a disabled effect drops the derivations it pinned"; a core-next test of when the cleanup runs |
| C4 | Because the dependency set is gone, an effect with declared `deps` runs on **every** change after `enable`, for the rest of the system's life (verified: writes to `b` woke an effect with `deps: ["a"]`). An auto-tracked effect runs on the next change of anything, then tracks again. | Without (y), the slice copies this. With (y), `enable` restores the declared set (and re-watches its derivations); auto-tracked effects keep 1.35's behaviour. | a core-next test; the diff scenario shows (y) if approved |

**Reading the table:** C1 and C2 close nine of the ten failures. C3 and C4 are where core-next and 1.35 differ today or would differ after a fix. Neither is pinned by a conformance test, which is why they need a decision, not a default.

### prev and lazy prev

**In plain terms:** built in L1 and L3 and passing. L4 adds one rule that arrives with `on`, and keeps the copy 1.35 makes.

| # | 1.35 rule | 2.0 mechanism and seam | Pinned by |
|---|---|---|---|
| P1 | `prevFacts` is a shallow plain-object copy of the facts, taken after each effects phase, and `null` on an effect's first pass (`effects.ts:1248–1251, 1283, 1294`). | Built: `snapshotPrevious` (`api/effects.ts:415–417`). | 59 prev tests (pass); diff "an effect sees the previous facts in prev" |
| P2 | The copy is made only when something can read it: an effect whose `run` takes a second parameter, or any `on` gate (`effects.ts:722–743`). The parameter test is an arity sniff (`effects.ts:376–452`). | Built for `run` (`declaresPrev`, `PREV_READ`, `api/effects.ts:83–143`). An `on` gate must also count, with D4. | the public half of `effects-lazy-prev-facts` (WHITE-BOX.md, split); a core-next test that an `on`-only system still copies |
| P3 | A new copy each pass, so a `prevFacts` an async effect holds across an `await` keeps that pass's values. | Kept. A double-buffered or in-place `prev` would change what a held reference sees, so it is not proposed. The copy stays one per pass, not one per gated effect (1.35 builds one per gate in `shouldRun`, `effects.ts:967`). | an existing async prev test; L4c adds one with two gates |

**Reading the table:** `prev` costs one copy of every fact per pass, in 1.35 and core-next alike. L4 does not try to remove it, because the cheaper designs change what a held `prevFacts` sees. The one saving is P3's last line: gates share the pass's copy.

### Skip-tracking that works per frame

**In plain terms:** 1.35 has a skip, but it never fires for an effect that runs every frame. 2.0 does not skip the tracking; it makes it free.

| # | 1.35 rule | 2.0 mechanism and seam | Pinned by |
|---|---|---|---|
| T1 | An auto-tracked effect records what it reads on every run, and its dependencies become exactly what the last run read (`effects.ts:1143–1176, 1124–1137`). A throw resets them (`effects.ts:1186–1189`); an async body records only what it read before its first `await` (`effects.ts:1164–1171`). The skip after 3 identical runs (`STABLE_THRESHOLD`, `effects.ts:189, 1059–1076`) is reset by any change to one of its dependencies (`effects.ts:956–958`), so an effect woken by its own dependencies, which is every per-frame effect, always tracks. Only a `"retry"` re-run can take the skip. | The observable rule is kept: dependencies are what the last run read. The counter is not ported (B list). Each effect keeps two reusable sets: a run tracks into the spare one, and if it read the same keys, the old set stays and the spare is cleared for next time; otherwise the two swap. A frame whose reads did not change allocates nothing. Today core-next makes a new `Set` per run (`api/effects.ts:348–356`). | L4b: a core-next counter test (10,000 runs with the same reads, no new set after the first two); the frame-loop workload's heap line |
| T2 | Choosing effects walks every effect and its dependencies each pass (`effects.ts:1298–1343`); core-next does the same (`api/effects.ts:389–413`). | A reverse index, dependency key to effect positions, updated only when a set changes (T1's swap). A pass marks the positions its changed keys reach and runs them in declaration order. Reruns and dependency-free effects stay as today. | diff "effects disable, enable and run in declaration order"; `fanout-effect-50` and frame-loop bench |
| T3 | Effects with declared `deps` never track (`effects.ts:1217–1219`). | Built (`api/effects.ts:344–345`). The graph's `Static` flag (`graph.ts:51`) is not used for effects, see the B list. | existing deps tests |

**Reading the table:** "skip-tracking that works per frame" turns out to be a speed target, not a rule. 1.35's skip is reset by the very change that wakes the effect, so it never helps a frame loop. Recording reads into reused storage keeps 1.35's rule exactly and removes the per-run allocation.

### The synchronous pass

| # | 1.35 rule | 2.0 mechanism and seam | Pinned by |
|---|---|---|---|
| S1 | The effects phase is awaited only when an effect returned a promise, and constraint evaluation only when one is async, so a pass with only synchronous work ends in the microtask it began in, and `settle()` sees it done on its first check (`engine.ts:1915–1926`). | Built: `runEffectsFast` and `evaluate_` return a promise only when they must (`api/core.ts:1049–1066`). | L4b: a core-next test that a synchronous pass leaves `isSettled` true before the next microtask, and that an async effect makes `settle()` wait (`blackbox-effects` "an async effect makes settle() wait for it", passing) |

**Reading the table:** nothing to build. The row needs one pin of its own, so a later slice cannot add an `await` to the pass without a test noticing.

### Quirk (c): a membership test re-runs an effect only when membership changes

**In plain terms:** in 1.35, `"x" in derived` inside an effect counts as reading `x`'s value, so the effect re-runs every time `x` changes, though the answer to "does `x` exist" never did. 2.0 records the question it was actually asked.

What 1.35 does (verified). The derived view's `has` trap tracks the derivation's dependency key when the name is a derivation (`derivations.ts:809–822`), the same key a value read tracks. A name that is not a derivation answers false and tracks nothing. `Object.keys(derived)` and spread track nothing themselves (`derivations.ts:836–838`); spread then reads each value through its getter. core-next copies all of this (`api/core.ts:744–751`).

| | 1.35 | 2.0 |
|---|---|---|
| `"d" in derived` inside an effect, `d` a derivation | Tracks `d`'s value key; the effect re-runs when `d` changes | Tracks a membership key for `d`. The effect has a dependency, so it does not fall into "no dependencies, run on every change", and the key never enters the changed set before L10. At L10, `register` and `unregister` of a derivation add its membership key. |
| The same test inside a constraint or a derivation | Tracks the value key | Unchanged: (c) names effects. The `asked_` signal a derivation uses stays as it is. |
| `"nope" in derived`, not a derivation | False, tracks nothing; an effect that read nothing else runs on every change | Without (w): unchanged. With (w): records the membership key for `nope`, so the effect re-runs only when `nope` comes to exist. |
| `derived.d`, `Object.keys`, spread | Value read; untracked; value reads | Unchanged |
| Mechanism | – | The effects part marks the tracker while an effect body runs; the `has` trap then records `MEMBER + id` instead of the value key. The mark costs nothing in a system without effects, so `floor` does not grow. |
| Pinned by | `l1-derivations-effects` "re-runs when it only tested the derivation's membership" (L0) asserts 1.35's re-run | L4-pre rewrites that test so it pins neither (the quirk (e) pattern: "Not pinned here; core-next pins the 2.0 behaviour"). A core-next test pins 2.0. A new diff scenario, "an effect that only tests a derivation's membership", shows the difference and gets a `divergences.json` entry. |

**Reading the table:** the change is one key in one trap, but the subtle part is the second line of the 2.0 column. If the membership test recorded nothing, a membership-only effect would run on every change, which is worse than 1.35. Recording a key that never changes is what makes it re-run "only when membership changes".

## Performance

What I ran: `node bench/system/run.mjs --rounds 6` in `packages/core-next` (both engines built at `2aeb7598`, production, `process.env` swapped as for a bundled app, thread CPU time, median of 6 rounds, Apple M4 Pro, load 4.7 to 6.7 on 14 cores, under the bench's noise flag). Ratio is core-next's time over 1.35's, so 0.43 means core-next takes 43% of 1.35's time.

| Workload | 1.35 ns/op | core-next ns/op | core-next / 1.35 |
|---|---|---|---|
| scalar-writes (1,000 writes, then a settle) | 126 | 83 | 0.65 |
| fanout-effect-50 (1 write, 50 effects re-run, settle) | 18,118 | 7,866 | 0.43 |
| chain-10 | 3,405 | 2,160 | 0.64 |
| fanout-derive-50 | 19,142 | 11,128 | 0.57 |
| subscribe-1000 | 4,706 | 4,148 | 0.88 |
| batch-100 | 16,934 | 10,273 | 0.61 |
| multi-module-20 | 20,007 | 16,583 | 0.83 |
| create-destroy-1000 | 61,827 | 25,988 | 0.42 |
| startup-10-modules | 193,183 | 117,829 | 0.60 |

| Heap, steady state | 1.35 | core-next |
|---|---|---|
| Bytes per fact write | 88.0 B | 0.0 B |
| Bytes per write, with its settle | 94.5 B | 6.1 B |

**Reading the tables:** core-next is faster than 1.35 on every workload today, from about 12% faster (subscribe-1000) to more than twice as fast (fanout-effect-50 and create-destroy). A fact write allocates nothing. There is **no frame-loop bench** in the repo: GATE-0's "0.8× or better on the frame loop by L5" has no workload behind it yet. The nearest is fanout-effect-50, already at 0.43.

What L4 must keep, and what it adds:

- No workload slower than `main` by more than 5% after any L4 slice (L3c's rule), and every workload at 1.0 or better against 1.35.
- A write stays at 0 B; T1 makes an auto-tracked effect run with unchanged reads 0 B too.
- L4-pre adds a `frame-loop` workload (decision B2), so the L5 gate has a number to judge.

## Slice plan

**In plain terms:** an oracle slice first, then two or three small build slices and the gate. Each build slice is one PR at the committed `current: "L3"`, tested at a forced L4 locally, as L3 was.

| Slice | Builds | Done means (checkable) | Tier |
|---|---|---|---|
| L4-pre (oracle) | Census: `trace` as an L9 option; the two data-form scenarios placed per B1. The L0 quirk-(c) test rewritten to pin neither. A `frame-loop` workload in `bench/system` (B2). | At forced L4, the `trace` test does not run on v2. `pnpm census`, `check:expects` and `oracle:update` exit 0. The rewritten test passes on v1 and v2. `oracle-change` label. | test oracle; Sonnet |
| L4a | Effect controls: C1 to C4, with (x) and (y) only if approved; counted watching. | The 9 control tests pass at forced L4 on v2 and v2:dist, listed by file and title. `conformance:diff` at forced L4: "effects disable, enable and run in declaration order" matches 1.35, or differs only by an approved (x) or (y), each named; every other failing scenario is listed and is a data-form one awaiting L4c. Census at the committed `current` and at the ceiling of every open gate. Ratchet at L3 exits 0. core-next `test`, `typecheck`, `build`, `size:check` with the exact dev-string count, sizes reported. | core; Opus implementer, Sonnet diff reviewer plus Fable correctness reviewer |
| L4b | Quirk (c), with (w) if approved; T1 and T2; S1's pin; the frame-loop numbers. | Core-next tests for (c) (and (w)); the new scenario shows only (c) at forced L4. The counter test shows no new dependency set after the second identical run. No bench workload slower than `main` by more than 5%; `fanout-effect-50` and `frame-loop` reported. The one-outcome mutation from L2a still fails a test. `floor` grows by at most 20 B. Plus L4a's diff, census, ratchet and core-next checks. | core; as L4a |
| L4c (only if B1 is "L4") | D4 and P2's `on` rule: one evaluator for data-form `when` and `on`, written for size. | Both data-form scenarios match 1.35 at forced L4. The 3 L11 data-form tests pass on v2 when run at L11. A data-form `when` that throws is attributed to its constraint, an `on` that throws to its effect. Budget raise in the same PR, with the measured size in `reason`. Plus L4a's checks. | core; as L4a |
| L4-gate | `current` to L4, `ratchet --update`, diff and fuzz at L4, one `divergences.json` entry per difference kind for (c), and for (w), (x), (y) only if approved, `approvedBy` empty unless Jason says to sign. Size budgets from measurements. `/principal` on L4. | 0 L4 failures on v2 and v2:dist. The census fails only on unsigned entries. PR fuzz and nightly run v2 at L4. | test oracle; Sonnet plus the coordinator's read of each entry |

**Reading the table:** L4a goes first because the control tests are 9 of the 10 failures and touch nothing L4b changes. L4b is the one slice with real risk: an index that drops an effect, or emits out of order, breaks parity silently, which is why the declaration-order scenario is in its done-means. L4c exists only if B1 puts data forms here.

### Size

Measured with `node scripts/size.mjs` on this branch (production, minified, gzip). Budgets are `main`'s `size-budgets.next.json`.

| Fixture | 1.35 | core-next now | Budget | Room |
|---|---|---|---|---|
| `minimal` | 55,290 B | 25,027 B | 25,500 B | 473 B |
| `two-module` | 55,381 B | 25,123 B | 25,600 B | 477 B |
| `floor` (no effects manager) | n/a | 10,206 B | 10,400 B | 194 B |
| full entry | n/a | 27,151 B | 27,700 B | 549 B |
| `graph.ts` alone | n/a | 1,797 B | 1,850 B | 53 B |

| Piece | Reference | Projected 2.0 |
|---|---|---|
| Effect controls, unknown-id throw, counted watching | `engine.ts:2633–2636` | +80–140 B |
| (x) and (y) | – | +20–40 B |
| Quirk (c) and (w) | – | +40–80 B (effects part; `floor` 0–20 B) |
| T1 reusable sets, T2 index | – | +150–300 B |
| Predicate evaluator (L4c) | 1.35: 1,778 B for `evaluatePredicate` alone, 2,374 B with `isPredicate`, `extractDeps` and `memoizePredicate` (measured, esbuild, production) | +0.9–1.4 KB, written for size |

**In plain terms:** without data forms, L4 adds roughly 0.3 to 0.55 KB, which fits `minimal`'s 473 B of room only at the low end; if it does not, L4b runs the plan's attribution step before asking for a raise. With data forms, `minimal` lands near 26.2 to 27 KB and needs Jason's OK for a raise (B1). The plan's "core through effects about 4.8 KB" predates the Phase 2 measurements and no longer applies.

## What the plan got wrong, or left out

- **Most of L4 is already built.** `deps`, `prev`, the lazy `prev` sniff and the synchronous pass came in with L0 to L3; 93 of the 104 L4 tests pass today.
- **The representative files are white-box.** `effects.test.ts` and `effects-lazy-prev-facts.test.ts` drive the manager directly and are not ported (WHITE-BOX.md: rewrite, and split). L4 is measured by `blackbox-effects`, `l1-effects`, `derived-in-constraints-effects`, `effect-deps-startup` and the diff scenarios.
- **1.35's skip-tracking never works per frame.** It is reset by the change that wakes the effect. So the L4 item is a speed target, met by reuse, not a behaviour to copy.
- **Data forms have two layers.** The scenario table places "data-form when, on…" and the `on` gate scenario at L4; the test detector places every data form at L11 (`lib/layers.ts:502–538`). One must change (B1).
- **Quirk (c) is pinned the 1.35 way at L0.** The L4 slice cannot land without rewriting that test first (L4-pre).
- **One L9 test is placed at L4.** `createSystem({ trace: true })` is not a detected option.
- **There is no frame-loop bench.** GATE-0's L5 speed target names one.
- **core-next's `disable` already differs from 1.35**: it runs the cleanup. No test sees it today; (x) decides it.
- **core-next's quirk (c) case is neither 1.35 nor 2.0 today.** A membership-only effect re-runs on the first change of its derivation and not after (Evidence). (c) in L4b makes the point moot; until then it is a known L0 gap that no test catches.

## Decisions for the owner

### A. Candidate divergences: each needs Jason's yes or no

A "no", or no answer yet, means the slice keeps 1.35's behaviour and pins it with a core-next test.

| # | Decision | What 1.35 does | What 2.0 would do | Verdict | Recommendation |
|---|---|---|---|---|---|
| A1 | (w) a membership test that answers false also waits for membership (part of defining (c)) | `"nope" in derived` tracks nothing, so an effect that read nothing else runs on every change | Records a membership key for `nope`; the effect re-runs only when `nope` comes to exist (L10) | Better, small change | Approve, in L4b. Without it, (c) holds for true answers only, and an effect whose only question is "does this exist" keeps running on every write. |
| A2 | (x) `effects.disable(id)` runs the effect's cleanup at once | Keeps the last cleanup until the effect's next run or `stop()` (verified), so a disabled effect's listener or timer keeps going | Runs the cleanup when disabled; the next run after `enable` starts clean | Better | Approve, in L4a. core-next already does this, and a disabled effect that keeps a timer running is a leak a user cannot see. |
| A3 | (y) an effect keeps its declared `deps` after `disable` and `enable` | Forgets them: after `enable` it runs on every change of any fact, for the life of the system (verified) | Restores the declared set and re-watches its derivations; auto-tracked effects as 1.35 | Better | Approve, in L4a. The forgetting is a side effect of releasing pinned derivations, not a design, and it turns a targeted effect into one that fires on every write. |

### B. Owner decisions that are not divergences

| # | Decision | Options | Recommendation |
|---|---|---|---|
| B1 | Where data forms land, and the budget | (1) L4c builds one lean evaluator for `when` and `on`; `minimal` rises by about 0.9 to 1.4 KB with a written reason. (2) Data forms stay at L11 with predicates; the two scenarios move to L11; alpha.0 ships without data forms. | (1). The plan's row names `on`, data-form `when` is part of constraints, which Jason ruled may cost more than the 8 KB goal, and an alpha meant for a real consumer should not reject 1.35 configs. The evaluator lives in its own module so beta can make it an opt-in import. |
| B2 | The frame-loop workload the L5 gate is judged by | An Aperture-shaped workload in `bench/system`: per frame, writes to about 20 facts in one batch, 10 derivations, 5 auto-tracked effects (2 reading `prev`), then a settle; report time and bytes per frame. | Approve the shape. GATE-0's per-frame target (15 µs, 1 KB) and its "0.8× by L5" need one fixed workload, and fixing it before L4b means L4b's gains are measured on the gate's own yardstick. |

### C. Engineering defaults that keep parity (no decision needed)

- **The skip counter is not ported.** `STABLE_THRESHOLD` only changes cost, never which keys an effect depends on; T1 gets the saving without it.
- **Effects stay in the reconcile pass**, not on the graph's own effect nodes. Graph effects flush right after a write; Directive effects run inside the pass, after derivations and before constraints. Moving them would change timing that the diff harness checks.
- **(c) is for effects only.** Constraints and derivations keep 1.35's membership tracking (`mutants-derivations` pins the constraint case). Extending it is a beta question.
- **`Object.keys(derived)` and spread inside an effect** stay untracked, as in 1.35.
- **One `prev` copy per pass**, shared by every `on` gate, where 1.35 builds one per gate. Same answers.
- **An `on` gate makes `prev` observed** (1.35's rule), with L4c.
- **The unknown-id error** is a plain throw in production too, as 1.35; the dev-string count does not change for it.
- **Re-asking unresolved `deps` names** comes with L10's `register`.

## Evidence: 1.35 probes

One script run with Node against `packages/core/dist` (1.35) and `packages/core-next/dist`, in development. Module: facts `a`, `b`; derivation `d = a + 1`; effects `declared` (`deps: ["a"]`, returns a cleanup), `member` (only `"d" in derived`), `absent` (only `"nope" in derived`).

| Step | 1.35 | core-next |
|---|---|---|
| `a = 1` | `declared:cleanup`, `declared`, `member`, `absent` | the same |
| `b = 1` | `absent` | `absent` |
| `effects.disable("declared")` | no cleanup runs | throws: `system.effects` is undefined |
| `a = 2` | `member`, `absent` | `declared:cleanup`, `declared`, `absent` |
| `enable`, then `b = 2` | `declared:cleanup`, `declared`, `absent` | `absent` |
| `b = 3` | `declared:cleanup`, `declared`, `absent` | `absent` |

**Reading the table:** the first line shows quirk (c): `member` re-runs because `d`'s value changed, though `d` existed all along. The disable line shows 1.35 keeping the cleanup (A2). The last two lines show A3: after `enable`, an effect with `deps: ["a"]` runs on writes to `b`. On core-next, `declared` runs at `a = 2` only because the disable call threw. But `member` does not run there, though it did at `a = 1`: today core-next re-runs a membership-only effect on the first change and then never again. Reasoned from the code: the `has` trap records `d`'s key but does not watch `d` (`api/core.ts:744–751`, against `watch` at `api/core.ts:1475`), so once `d` is stale and nobody reads it, later changes never reach the changed set. 1.35 re-runs it every time. The L0 test passes because it checks one change only. After (c), the question disappears: 2.0 does not re-run it at all.
