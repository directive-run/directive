# RFC: L4 full effects

Status: draft for review, revision 2. No engine code merges from this document.
Tree: branch `p4/l4-rfc`, cut from `main` at `2aeb7598` (L0 to L3 built and gated; `layers.rules.json` `current` is `"L3"`). Size budgets are the ones `main` gained after this cut, in `size-budgets.next.json` (#298).

**What changed in revision 2** (answering the design review; its probes are listed under "Evidence"):

- Quirk (c): core-next does not copy 1.35's membership tracking, so the membership bug is a separate L0 to L3 parity bug, fixed in its own PR first. It is not moot under (c).
- A throwing effect run keeps the last good run's dependencies on both engines (T1).
- (y) is widened from declared `deps` to the whole dependency record, including `on` and the error-boundary path.
- (x) is corrected: 1.35 runs the cleanup just before the first run after `enable`, and at `stop()`. Verdict: Better, small change.
- The skip counter note is corrected: the skip never fires at all.
- New section: untested L4 behaviours and the test that pins each.
- Plan: bigger L4-pre done-means, a wider T2 index, and the membership fix as a precondition.
- Data forms: recommendation is to stay at L11. L4 alone will probably raise the `minimal` budget.
- "Decisions for the owner" is rewritten.

## What we are building

L4 finishes effects. The plan's row reads "Full effects: deps/on, prev, skip-tracking that works per frame, sync reconcile fast path", and GATE-1 places one approved quirk here, (c): a membership test such as `"x" in derived` inside an effect re-runs the effect only when membership changes.

The rules are the ones L2 and L3 settled on. Parity with 1.35 is the rule, and when this document and 1.35 disagree, 1.35 wins. Every run ends in one outcome. One scheduler and one clock. The dev-string count stays exact. Every layer slice runs `conformance:diff` at the forced layer and checks the open gates.

**What may differ from 1.35.** Quirk (c) is approved (GATE-1, decision 2). Anything else here that would behave differently from 1.35 is a **candidate divergence**, lettered after the ones already used ((a) to (v)): (w), (x) and (y). They are listed under "Decisions for the owner" and are built only if Jason approves them. Until he does, the slice keeps 1.35's behaviour.

| If "approved" means | Then this gets built |
|---|---|
| Effect controls | `system.effects.disable`, `enable` and `isEnabled` on the system, over the manager core-next already has. An unknown id throws 1.35's error. |
| Per-frame tracking | An auto-tracked effect still records its reads on every run, as in 1.35, but into reused storage, so a run that reads what it read last time allocates nothing. Choosing which effects run costs per changed key, not per effect. |
| Precondition, not an L4 slice | The membership parity fix: a membership-only reader of a derivation must be woken at every change, as in 1.35. It is a bug at L0 to L3, being fixed now in a separate core-next PR (branch `p3/core-next-membership-watch`), with a conformance pin after it. L4b builds on that fix. |
| Quirk (c) | Inside an effect, `"x" in derived` records a membership dependency instead of the derivation's value. Nothing changes membership before L10. |
| Data forms | Recommended to stay at L11 with the predicates feature (B1). Only if the owner overrules: one predicate evaluator shared by constraint `when` and effect `on`, in a slice L4c. |
| Already built, pinned here | `deps`, `prev`, lazy `prev` and the synchronous pass, which came in with L0 to L3. |
| Candidates, built only if approved | (w) a membership test that answers false also waits for membership. (x) `disable()` runs the effect's cleanup at once. (y) an effect keeps its whole dependency record (declared `deps`, derivation deps, auto-tracked reads, the `on` gate) across `disable()` and `enable()`, including when the error boundary's "disable" strategy did the disabling. |

**In plain terms:** most of L4 is already in core-next. What is missing is small: the effect controls on the system, quirk (c), and making re-tracking cost nothing per frame. The open questions are three small behaviour changes, (x), (y) and (w), and the shape of the frame-loop workload (B2). Data forms are a placement question, and the recommendation is to leave them at L11 (B1).

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

**Reading the table:** all three must match 1.35 by the gate of the layer they are placed at, and none is an approved quirk or a candidate. Two of them depend on decision B1, because the scenario table places data forms at L4 while the test detector places them at L11. The recommendation is L11, which moves those two scenarios there and leaves the controls scenario as the only diff failure at L4.

## The design: each 1.35 rule, the mechanism that keeps it, and its pin

Where a row says "verified", the behaviour was observed by running a script against the built 1.35 package; the output is in "Evidence" at the end. The rest is read from the code, with the lines cited. 1.35 paths are under `packages/core/src/core/`, core-next paths under `packages/core-next/src/`.

### deps and on

**In plain terms:** declared `deps` already work in core-next. `on` is half there: it is validated but never evaluated.

| # | 1.35 rule | 2.0 mechanism and seam | Pinned by |
|---|---|---|---|
| D1 | A declared `deps` list is fixed. Each name that is a derivation maps to the derivation's dependency key; any other name is a fact key (`effects.ts:787–806, 847–856`). | Built: `depKey` maps the name and calls `ctx.watch` (`api/effects.ts:145–162, 497–504`). | `derivation-deps` (3), `derived-in-constraints-effects` (6), `blackbox-effects` deps tests (pass) |
| D2 | A name that means nothing yet is asked again on each pass, so a derivation registered after its effect is found (`effects.ts:813–825, 946`). | Names can only start to exist with dynamic registration, so this arrives with L10, beside `register`. | L10's tests |
| D3 | An effect with dependencies runs only when one of them is among the pass's changed keys. One with none (never run, or an auto-tracked run that read nothing) runs on every change (`effects.ts:937–978`). | Built: `select()` (`api/effects.ts:389–413`). L4b replaces the scan with an index (T2). | `effect-deps-startup` (2), `effect-reconcile-boundaries` (9) |
| D4 | `on` must be a predicate, or the system throws at creation (`effects.ts:866–875`). Its dependencies are the fact paths it names (`extractDeps`, `effects.ts:877`). After the dependency check, the gate is evaluated against a snapshot of the facts and the previous snapshot, and the effect runs only if it passes (`effects.ts:965–971`). The gate sits inside `if (state.dependencies)` (`effects.ts:949`), which is why (y) matters for it. A throw from the gate is attributed to the effect (`effects.ts:882–886`). | Validation is built (`api/effects.ts:151–155`); the gate is not. Under the recommendation on B1 the gate and its evaluator arrive with the L11 predicates feature. If the owner overrules B1: a new `api/predicate.ts`, the one evaluator that constraint `when` and effect `on` both call, with the gate run inside `select()`. | diff "an `on` predicate gates an effect…", "data-form when, on and comparison operators" (both at L11 under the recommendation); `data-forms` (3 at L11 today) |
| D5 | Effects run in declaration order, and an effect asked to run again by the `"retry"` strategy runs whatever changed (`effects.ts:1317–1340`). | Built: the states map keeps declaration order; `rerun_` (`api/effects.ts:474–479`). The index in T2 must emit in declaration order. | diff "effects disable, enable and run in declaration order" |

**Reading the table:** D1, D3 and D5 are done and pinned. D2 belongs to L10, where a name can come to exist. D4 is the real work, and where it lands is decision B1: the recommendation is L11.

### Effect controls

**In plain terms:** the system gets the three methods 1.35 has. Two details of 1.35's `disable` look like bugs, and they are candidates (x) and (y). (y) is wider than revision 1 said: the dependency record that `disable` throws away is more than the declared `deps`.

| # | 1.35 rule | 2.0 mechanism and seam | Pinned by |
|---|---|---|---|
| C1 | `system.effects.disable(id)`, `enable(id)` and `isEnabled(id)` (`engine.ts:2633–2636`). An unknown id throws `[Directive] Unknown effect: <id>`, in production too (`effects.ts:828–832`, reached through `getState`). | A `system.effects` object defined by the effects part, over the manager's existing methods. The unknown-id throw is a plain throw, not a dev string. | the 9 failing control tests |
| C2 | A disabled effect is checked when it is about to run, so one disabled by an earlier effect in the same pass does not run (`effects.ts:1207`). | Built: `run()` checks `state.enabled` (`api/effects.ts:328`). | `l1-effects` and `blackbox-effects` "an effect disabled by an earlier one in the same pass does not run" |
| C3 | `disable` sets `enabled` to false and throws away the dependency set, so the derivations it read stop being watched (`effects.ts:1447–1458`). It does **not** run the effect's cleanup. The cleanup runs just before the first run after `enable`, and at `stop()` (verified, probe XY: nothing at `disable`, nothing at `enable`, the cleanup at the next run). | core-next's `disable` runs the cleanup at once (`api/effects.ts:460–466`). Without (x), L4a removes that call. Watching becomes counted: core-next's `watched` set is add-only (`api/core.ts:1475`), so the effects part gains an unwatch that releases a derivation no other reader holds. | "a disabled effect drops the derivations it pinned"; a diff scenario for the cleanup's timing (x) |
| C4 | Because the dependency record is gone, an effect that had one runs on **every** change after `enable`, for the rest of the system's life. Verified: a declared `deps: ["a"]` effect ran on writes to `b` and `c` (probe XY). A declared derivation dep, `deps: ["d"]`, did the same (probe Yd). An effect with `on: { a: { $gt: 5 } }` ran ungated, at `a = 2` and at `b = 1`, because the `on` gate sits inside `if (state.dependencies)` and the dependencies are `null` (probe Yon; `effects.ts:949, 965`). The error boundary's `"disable"` strategy reaches the same `disable`, so an effect it disabled and the owner then enabled does the same (probe EB: `deps: ["a"]` ran on a write to `b`). An auto-tracked effect runs once on the next change of anything, then tracks again (probe Ya). | Without (y), the slice copies all of this. With (y), `disable` keeps the dependency record: declared and derivation deps, the last auto-tracked read set, and the `on` gate; it releases only the derivation watching, so a disabled effect still pins nothing. `enable` re-watches. This covers the boundary path too. `enable` does not run the effect and does not replay changes that came while it was disabled. | a diff scenario per case (declared, derivation dep, auto-tracked, `on`, boundary); a core-next test per case; the `on` case at L11 with data forms |

**Reading the table:** C1 and C2 close nine of the ten failures. C3 and C4 are where core-next and 1.35 differ today or would differ after a fix. Neither is pinned by a conformance test, which is why they need a decision, not a default.

### prev and lazy prev

**In plain terms:** built in L1 and L3 and passing. L4 adds one rule that arrives with `on`, and keeps the copy 1.35 makes.

| # | 1.35 rule | 2.0 mechanism and seam | Pinned by |
|---|---|---|---|
| P1 | `prevFacts` is a shallow plain-object copy of the facts, taken after each effects phase, and `null` on an effect's first pass (`effects.ts:1248–1251, 1283, 1294`). | Built: `snapshotPrevious` (`api/effects.ts:415–417`). | 59 prev tests (pass); diff "an effect sees the previous facts in prev" |
| P2 | The copy is made only when something can read it: an effect whose `run` takes a second parameter, or any `on` gate (`effects.ts:722–743`). The parameter test is an arity sniff (`effects.ts:376–452`). | Built for `run` (`declaresPrev`, `PREV_READ`, `api/effects.ts:83–143`). An `on` gate must also count, when the gate arrives (L11 under the recommendation). | the public half of `effects-lazy-prev-facts` (WHITE-BOX.md, split); a core-next test that an `on`-only system still copies, with the gate |
| P3 | A new copy each pass, so a `prevFacts` an async effect holds across an `await` keeps that pass's values (probe P: the same on both engines). | Kept. A double-buffered or in-place `prev` would change what a held reference sees, so it is not proposed. The copy stays one per pass, not one per gated effect (1.35 builds one per gate in `shouldRun`, `effects.ts:967`). | an existing async prev test; the gate's slice adds one with two gates |

**Reading the table:** `prev` costs one copy of every fact per pass, in 1.35 and core-next alike. L4 does not try to remove it, because the cheaper designs change what a held `prevFacts` sees. The one saving is P3's last line: gates share the pass's copy.

### Skip-tracking that works per frame

**In plain terms:** 1.35 has a skip, but it never fires for an effect that runs every frame. 2.0 does not skip the tracking; it makes it free.

| # | 1.35 rule | 2.0 mechanism and seam | Pinned by |
|---|---|---|---|
| T1 | An auto-tracked effect records what it reads on every run, and its dependencies become exactly what the last run read (`effects.ts:1143–1176, 1124–1137`). **A run that throws keeps the dependencies of the last good run**: the error path resets only the stability counter (`effects.ts:1179–1189`), on both engines (probe T: after a throwing run that read `a`, a write to `a` did not wake the effect and a write to `b`, which the last good run had read, did). An async body records only what it read before its first `await` (`effects.ts:1164–1171`; read from the code, not yet run). The skip after 3 identical runs (`STABLE_THRESHOLD`, `effects.ts:189, 1059–1076`) is reset by any change to one of its dependencies (`effects.ts:956–958`), by a throw (`reportEffectError`, `effects.ts:1188`) and by `runAll` (`effects.ts:1438`). So the skip never fires: an effect woken by its own dependencies, which is every per-frame effect, always tracks, and the review found no path that takes the skip. | The observable rule is kept: dependencies are what the last run read, and a throwing run leaves them alone. The counter is not ported (C list). Each effect keeps two reusable sets: a run tracks into the spare one; if it read the same keys, the old set stays and the spare is cleared for next time; if it read different keys, the two swap; **if the run throws, the spare is discarded and the old set stays**. A frame whose reads did not change allocates nothing. Today core-next makes a new `Set` per run (`api/effects.ts:348–356`). | L4b: a core-next counter test (10,000 runs with the same reads, no new set after the first two); a core-next test that a throwing run keeps the previous set; the frame-loop workload's heap line |
| T2 | Choosing effects walks every effect and its dependencies each pass (`effects.ts:1298–1343`); core-next does the same (`api/effects.ts:389–413`). | A reverse index, dependency key to effect positions, updated only when a set changes (T1's swap). A pass marks the positions its changed keys reach and runs them in declaration order. Reruns and dependency-free effects stay as today. The index must also cover three things the walk gets for free: **navigation keys** (a history navigation wakes every effect except those declaring `onNavigate: "skip"`, which see only the real changed keys and sit out a pass of pure navigation, `effects.ts:1296–1340`; history is L8, but the index must not assume one key set per pass); **`refreshDeps`** (L10: a declared name that comes to exist is added to the index when it resolves, `effects.ts:813, 946`); and **(y)'s restore** (a disabled effect keeps its index entries, selection skips it while disabled, and `enable` needs no re-indexing). | diff "effects disable, enable and run in declaration order"; `fanout-effect-50` and frame-loop bench; core-next tests for a navigation-only pass with and without `onNavigate: "skip"` (written when L8 lands), for a late-resolved name (L10), and for disable then enable |
| T3 | Effects with declared `deps` never track (`effects.ts:1217–1219`). | Built (`api/effects.ts:344–345`). The graph's `Static` flag (`graph.ts:51`) is not used for effects, see the C list. | existing deps tests |

**Reading the table:** "skip-tracking that works per frame" turns out to be a speed target, not a rule. 1.35's skip is reset by the very change that wakes the effect, and by the two other ways into a run, so it never helps a frame loop. Recording reads into reused storage keeps 1.35's rule exactly and removes the per-run allocation. That the skip never fires also makes "do not port the counter" the safer choice: there is no behaviour in it to lose.

### The synchronous pass

| # | 1.35 rule | 2.0 mechanism and seam | Pinned by |
|---|---|---|---|
| S1 | The effects phase is awaited only when an effect returned a promise, and constraint evaluation only when one is async, so a pass with only synchronous work ends in the microtask it began in, and `settle()` sees it done on its first check (`engine.ts:1915–1926`). Measured, probe S, on both engines: right after a synchronous fact write `isSettled` is false, and after exactly one `await Promise.resolve()` it is true and the effect has run. | Built: `runEffectsFast` and `evaluate_` return a promise only when they must (`api/core.ts:1049–1066`). | L4-pre: a conformance test, run on v1 and v2, that a synchronous pass is settled after exactly one microtask; and that an async effect makes `settle()` wait (`blackbox-effects` "an async effect makes settle() wait for it", passing) |

**Reading the table:** nothing to build. The row needs one pin of its own, in conformance, so a later slice cannot add an `await` to the pass without a test noticing.

### Quirk (c): a membership test re-runs an effect only when membership changes

**In plain terms:** in 1.35, `"x" in derived` inside an effect counts as reading `x`'s value, so the effect re-runs every time `x` changes, though the answer to "does `x` exist" never did. 2.0 records the question it was actually asked. Before that can be built, core-next has to get the 1.35 behaviour right first, and today it does not.

What 1.35 does (verified, probes M and CM). The derived view's `has` trap tracks the derivation's dependency key when the name is a derivation (`derivations.ts:809–822`), the same key a value read tracks. **For an observer reader, which is an effect or a subscription, it also adds the name to `observedIds`** (`derivations.ts:817–819`), and that is what keeps the derivation watched, so a later change reaches the reader. A name that is not a derivation answers false and tracks nothing. `Object.keys(derived)` and spread track nothing themselves (`derivations.ts:836–838`); spread then reads each value through its getter.

**What core-next does is not a copy of that.** Its `has` trap (`api/core.ts:744–751`) records the dependency key and an `asked_` signal, but never watches the derivation: its comment says "as in 1.35 … the target is left for whoever reads its value", which leaves out the `observedIds` half (1.35's `mutants-derivations` test "a membership test from a constraint makes the name watched" pins that half). So a reader whose only question is membership is woken by the first change and never again. Probe M, writes `a = 1, 2, 3` to a module whose effect only tests `"d" in derived`: 1.35 runs it at all three; core-next at the first only. A second effect that reads `d`'s value hides the bug (probe M_watched: both engines run both effects every time).

**The membership bug is not moot under (c).** (c) is for effects only, so constraints keep 1.35's value tracking, and there core-next is wrong today. Probe CM, a constraint `when` that only tests `"d" in d`, writes `a = 1, 2, 3, then b = 1`: 1.35 evaluates it at the start and at all three `a` writes, not at `b`; core-next evaluates it at the start and at the first `a` write only. This is an L0 to L3 parity bug. It is being fixed now in a separate core-next PR (branch `p3/core-next-membership-watch`), with a conformance pin after it. It is a precondition for L4b, not an L4 slice, and L4b's (c) builds on that fix: it changes the same trap, so it starts from the fixed trap, not around it.

| | 1.35 | 2.0 |
|---|---|---|
| `"d" in derived` inside an effect, `d` a derivation | Tracks `d`'s value key and marks `d` observed; the effect re-runs when `d` changes | Tracks a membership key for `d`, and does not watch `d`. The effect has a dependency, so it does not fall into "no dependencies, run on every change", and the key never enters the changed set before L10. At L10, `register` and `unregister` of a derivation add its membership key. |
| The same test inside a constraint or a derivation | Tracks the value key (and marks `d` observed, for an observer) | Unchanged from 1.35, which the precondition fix restores: (c) names effects. The `asked_` signal a derivation uses stays as it is. |
| `"nope" in derived`, not a derivation | False, tracks nothing; an effect that read nothing else runs on every change | Without (w): unchanged. With (w): records the membership key for `nope`, so the effect re-runs only when `nope` comes to exist. |
| `derived.d`, `Object.keys`, spread | Value read; untracked; value reads | Unchanged |
| Mechanism | – | The effects part marks the tracker while an effect body runs; the `has` trap then records `MEMBER + id` instead of the value key. The mark costs nothing in a system without effects, so `floor` does not grow. |
| Pinned by | `l1-derivations-effects` "re-runs when it only tested the derivation's membership" (L0) asserts 1.35's re-run, on one change | L4-pre rewrites that test so it pins neither (the quirk (e) pattern: "Not pinned here; core-next pins the 2.0 behaviour"). A core-next test pins 2.0 across at least three changes. A new diff scenario, "an effect that only tests a derivation's membership", writes at least three times, shows the difference and gets a `divergences.json` entry. |

**Reading the table:** the change is one key in one trap, but the subtle part is the second line of the 2.0 column. If the membership test recorded nothing, a membership-only effect would run on every change, which is worse than 1.35. Recording a key that never changes is what makes it re-run "only when membership changes". The scenario writes at least three times because the bug above shows only from the second change on.

## Untested L4 behaviours, and what will pin each

**In plain terms:** the design review found behaviours that 1.35 has and that no test pins today on either engine. Each needs a pin before the slice that could break it, so a change in behaviour fails a test instead of a user. "Conformance" means a test that runs on v1 and v2; "diff" means a scenario the diff harness runs on both.

| # | Behaviour | Evidence | Pinned by | Slice |
|---|---|---|---|---|
| U1 | A membership-only reader is woken at **every** change that moves the derivation, not the first. For constraints: writes `a = 1, 2, 3, b = 1` evaluate at the start and at the three `a` writes only. | Probe CM (1.35 passes; core-next fails) | A conformance test with at least three writes, after the membership fix | the fix PR |
| U2 | The same, for an effect, and then the 2.0 behaviour of (c): the effect runs at none of the writes. | Probe M | Diff scenario "an effect that only tests a derivation's membership" with at least three writes; a core-next test for 2.0 | L4b |
| U3 | A throwing run keeps the last good run's dependencies; only the stability counter resets. | Probe T (identical on both engines) | A conformance test; a core-next test that the two-set swap keeps the old set on a throw | L4-pre; L4b |
| U4 | An async effect records only the reads made before its first `await`. | Read from `effects.ts:1164–1171`; not yet run | A conformance test: read `a`, `await`, read `b`; a write to `b` does not wake it, a write to `a` does | L4-pre |
| U5 | After `disable` then `enable`, a write to an unrelated fact still triggers the effect, for declared deps, a derivation dep, an auto-tracked effect, an `on` effect, and an effect the error boundary disabled. | Probes XY, Yd, Ya, Yon, EB (1.35 only; core-next has no `system.effects`) | One diff scenario per case; a core-next test per case that copies 1.35 if (y) is not approved and pins the restore if it is. The `on` case waits for the predicates feature (L11). | L4a |
| U6 | When the cleanup runs on `disable`: not at `disable`, not at `enable`, just before the first run after `enable`, and at `stop()`. | Probe XY | A diff scenario "an effect's cleanup when disabled"; a core-next test of whichever outcome the owner picks (x) | L4a |
| U7 | A synchronous pass is settled after exactly one microtask, and the effect has run by then. | Probe S (identical on both engines) | A conformance test | L4-pre |

**Reading the table:** U3 and U7 already pass on both engines, U1 passes on v2 once the fix lands, and U4 has never been run, so it is the one most likely to find something. All four are plain conformance pins and change no behaviour. U2, U5 and U6 are where the engines differ or may differ, so each is a diff scenario, with a `divergences.json` entry only if the owner approves the difference.

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

**In plain terms:** one fix that must land first, an oracle slice, two build slices and the gate. Each build slice is one PR at the committed `current: "L3"`, tested at a forced L4 locally, as L3 was. A fourth build slice, L4c, exists only if the owner overrules B1.

| Slice | Builds | Done means (checkable) | Tier |
|---|---|---|---|
| Precondition (not an L4 slice) | The membership parity fix in core-next, in its own PR (`p3/core-next-membership-watch`), and a conformance pin after it (U1). | Probe CM and probe M's `member` effect match 1.35 across at least three changes on v2. The pin passes on v1 and v2. It merges before L4b starts. | core; in flight |
| L4-pre (oracle) | Census: `trace` as an L9 option; the two data-form scenarios placed at L11 (B1). The L0 quirk-(c) test rewritten to pin neither. Conformance tests U3, U4 and U7. A `frame-loop` workload in `bench/system` (B2). | At forced L4, the `trace` test does not run on v2. **`conformance:diff` at forced L4 fails only the scenarios this document names (the controls scenario, until L4a), and no data-form scenario runs below L11. The open-gate check passes at the committed `current` and at the ceiling of every open gate.** `pnpm census`, `check:expects` and `oracle:update` exit 0. The rewritten test passes on v1 and v2. U3, U4 and U7 pass on v1 and v2. `oracle-change` label. | test oracle; Sonnet |
| L4a | Effect controls: C1 to C4, with (x) and (y) only if approved; counted watching. | The 9 control tests pass at forced L4 on v2 and v2:dist, listed by file and title. `conformance:diff` at forced L4: "effects disable, enable and run in declaration order" matches 1.35, or differs only by an approved (x) or (y), each named. The U5 and U6 scenarios exist and show only approved differences. Census at the committed `current` and at the ceiling of every open gate. Ratchet at L3 exits 0. core-next `test`, `typecheck`, `build`, `size:check` with the exact dev-string count, sizes reported. | core; Opus implementer, Sonnet diff reviewer plus Fable correctness reviewer |
| L4b | Quirk (c), with (w) if approved; T1 and T2; the frame-loop numbers. | Core-next tests for (c) (and (w)) across at least three changes (U2); the new scenario shows only (c) at forced L4. The counter test shows no new dependency set after the second identical run; a throwing run keeps the previous set (U3). The T2 index passes the declaration-order scenario, a disable-then-enable test, and tests for navigation keys with and without `onNavigate: "skip"` and for a late-resolved name, or a recorded reason where L8 or L10 must write them. No bench workload slower than `main` by more than 5%; `fanout-effect-50` and `frame-loop` reported. The one-outcome mutation from L2a still fails a test. `floor` grows by at most 20 B. A budget raise for `minimal`, if needed, in this PR with the measured size and attribution in `reason`. Plus L4a's diff, census, ratchet and core-next checks. | core; as L4a |
| L4c (only if the owner overrules B1) | D4 and P2's `on` rule: one evaluator for data-form `when` and `on`, written for size. | Both data-form scenarios match 1.35 at forced L4. The 3 L11 data-form tests pass on v2 when run at L11. A data-form `when` that throws is attributed to its constraint, an `on` that throws to its effect. Budget raise in the same PR, with the measured size in `reason`. Plus L4a's checks. | core; as L4a |
| L4-gate | `current` to L4, `ratchet --update`, diff and fuzz at L4, one `divergences.json` entry per difference kind for (c), and for (w), (x), (y) only if approved, `approvedBy` empty unless Jason says to sign. Size budgets from measurements. `/principal` on L4. | 0 L4 failures on v2 and v2:dist. The census fails only on unsigned entries. PR fuzz and nightly run v2 at L4. | test oracle; Sonnet plus the coordinator's read of each entry |

**Reading the table:** L4a goes first among the build slices because the control tests are 9 of the 10 failures and touch nothing L4b changes. L4b is the one slice with real risk: an index that drops an effect, emits out of order, or forgets a navigation, late-name or re-enabled effect breaks parity silently, which is why those cases are in its done-means. The membership fix is a precondition, not a slice of L4: it is a parity bug at L0 to L3 and has its own review.

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
| Predicate evaluator (L4c, only if B1 is overruled) | 1.35: 1,778 B for `evaluatePredicate` alone, 2,374 B with `isPredicate`, `extractDeps` and `memoizePredicate` (measured, esbuild, production) | +0.9–1.4 KB, written for size |

**In plain terms:** L4 alone adds roughly 0.3 to 0.55 KB, against `minimal`'s 473 B of room, and the membership fix lands first and may spend some of that room. So L4 will likely exceed the room, and an L4 slice will raise the `minimal` budget with a written reason, after the plan's attribution step (find the bytes, move cold code, fold duplicates). The plan's budget rule allows a raise on those terms, and the owner sees it at the L4 phase gate. Data forms on top would add 0.9 to 1.4 KB and put `minimal` at about 26.2 to 27.0 KB against the 25,500 B budget. The plan places the predicates DSL at L11 as an opt-in feature (+3.5 KB), so the recommendation is to keep it there and raise no budget for it (B1). The plan's "core through effects about 4.8 KB" predates the Phase 2 measurements and no longer applies.

## What the plan got wrong, or left out

- **Most of L4 is already built.** `deps`, `prev`, the lazy `prev` sniff and the synchronous pass came in with L0 to L3; 93 of the 104 L4 tests pass today.
- **The representative files are white-box.** `effects.test.ts` and `effects-lazy-prev-facts.test.ts` drive the manager directly and are not ported (WHITE-BOX.md: rewrite, and split). L4 is measured by `blackbox-effects`, `l1-effects`, `derived-in-constraints-effects`, `effect-deps-startup` and the diff scenarios.
- **1.35's skip-tracking never works per frame, and never fires at all.** It is reset by the change that wakes the effect, by a throw and by `runAll`. So the L4 item is a speed target, met by reuse, not a behaviour to copy.
- **Data forms have two layers.** The scenario table places "data-form when, on…" and the `on` gate scenario at L4; the test detector places every data form at L11 (`lib/layers.ts:502–538`), and the plan puts the predicates DSL at L11 as opt-in. The scenarios should move to L11 (B1).
- **Quirk (c) is pinned the 1.35 way at L0.** The L4 slice cannot land without rewriting that test first (L4-pre).
- **One L9 test is placed at L4.** `createSystem({ trace: true })` is not a detected option.
- **There is no frame-loop bench.** GATE-0's L5 speed target names one.
- **core-next's `disable` already differs from 1.35**: it runs the cleanup. No test sees it today; (x) decides it.
- **core-next's membership tracking is not 1.35's, and the gap is not moot under (c).** 1.35's `has` trap also marks an observer's read as observed (`derivations.ts:817–819`); core-next's never watches. A membership-only reader, whether an effect or a constraint `when`, is woken by the first change and then never (probes M and CM). (c) covers effects only, so constraints stay wrong until the separate fix (`p3/core-next-membership-watch`) lands. No test catches it today because the L0 test writes once.
- **Revision 1 misread two 1.35 behaviours.** A throwing run does not reset an effect's dependencies, and `disable` does not run the cleanup at `disable` but just before the first run after `enable`. Both are corrected above.

## Decisions for the owner

A "no", or no answer yet, means the slice keeps 1.35's behaviour and pins it with a core-next test.

### A. Decisions

#### (x) `effects.disable(id)` runs the effect's cleanup at once

- **What 1.35 does.** `disable` does not run the cleanup. The effect's last cleanup stays until the first run after `enable`, and `stop()` runs it (probe XY). So a disabled effect's listener or timer keeps going for as long as it is disabled.
- **What 2.0 would do.** The cleanup runs when the effect is disabled (core-next's manager already does). The next run after `enable` starts clean.
- **Product verdict.** Better, small change. An app that disables an effect to pause it while keeping its listener alive would notice the cleanup running at once, and the listener would be gone until the effect's next run.
- **Recommendation.** Approve, in L4a. A "disabled" effect that keeps a timer or listener is the more likely surprise, and the change is one call in core-next. If the owner knows of a pause-and-keep-listening use, the answer is no, and L4a removes that call.

#### (y) an effect keeps its whole dependency record across `disable` and `enable`

- **What 1.35 does.** `disable` throws the dependency record away. After `enable`, an effect with declared `deps`, or with a derivation dep, runs on every change of any fact for the rest of the system's life. An effect with an `on` gate runs ungated, because the gate is only checked when the effect has dependencies (probes XY, Yd, Yon). An auto-tracked effect runs once on the next change of anything, then tracks again (probe Ya). The error boundary's `"disable"` strategy reaches the same `disable`, so an effect it disabled behaves the same after the owner enables it (probe EB).
- **What 2.0 would do.** `disable` keeps the declared and derivation deps, the last auto-tracked read set and the `on` gate, and releases only the derivation watching, so a disabled effect pins nothing. `enable` re-watches. Same on the boundary path. `enable` does not run the effect and does not replay changes made while it was disabled.
- **Product verdict.** Better for declared deps, derivation deps, `on` and the boundary path: a targeted effect stays targeted, and a gated one stays gated. For auto-tracked effects: Better, small change. 1.35's run on the next unrelated change happens to catch up on writes made while disabled; under (y) the effect waits for one of its own keys.
- **Recommendation.** Approve, in L4a. The forgetting is a side effect of releasing pinned derivations, not a design, and it turns a targeted or gated effect into one that fires on every write. The owner should confirm the no-catch-up rule for auto-tracked effects; a catch-up run on `enable` is possible but larger and not recommended.

#### (w) how far (c) reaches: a membership test that answers false also waits for membership

- **What 1.35 does.** `"d" in derived` for a derivation tracks `d`'s value, so the effect re-runs at every change of `d` (approved quirk (c) changes this). `"nope" in derived` for a name that is not a derivation answers false and tracks nothing, so an effect that read nothing else runs on every change (probe M, `absent`).
- **What 2.0 would do.** With (c) alone: the true case records a membership key. With (w): the false case does too, so the effect re-runs only when `nope` comes to exist (L10). Either way (c) reaches effects only: constraints and derivations keep 1.35's tracking, which the separate membership fix restores in core-next.
- **Product verdict.** Better, small change. An effect whose only question is "does this exist" stops running on every write.
- **Recommendation.** Approve (w) in L4b, and confirm that (c) stops at effects. Without (w), (c) holds for true answers only.

#### B2 the frame-loop workload the L5 gate is judged by

- **What 1.35 does.** Nothing: there is no frame-loop bench. The nearest workload, `fanout-effect-50`, is at 0.43 of 1.35's time already.
- **What 2.0 would do.** L4-pre adds an Aperture-shaped workload in `bench/system`: per frame, writes to about 20 facts in one batch, 10 derivations, 5 auto-tracked effects (2 reading `prev`), then a settle; report time and bytes per frame.
- **Product verdict.** No behaviour changes; it fixes the yardstick.
- **Recommendation.** Approve the shape. GATE-0's per-frame target (15 µs, 1 KB) and its "0.8x by L5" need one fixed workload, and fixing it before L4b means L4b's gains are measured on the gate's own yardstick.

### B. Recommendation the owner may overrule

#### B1 data forms stay at L11

- **What 1.35 does.** Data-form `when` and `on` are in the core: a predicate object is evaluated by a built-in evaluator (1,778 B alone, 2,374 B with its helpers).
- **What 2.0 would do.** The plan puts the predicates DSL at L11 as an opt-in feature (+3.5 KB). Leave it there. Building a lean evaluator at L4 instead would put `minimal` at about 26.2 to 27.0 KB against the 25,500 B budget, a raise that buys one feature the plan already prices at L11. The two data-form diff scenarios move to L11, and L4c is not built.
- **Product verdict.** Same once the predicates feature is imported. Until L11, a 1.35 config that uses data forms cannot run on core-next. Today core-next accepts an `on` data form and then ignores it, so the effect runs on every change; L4-pre should make that a clear error naming the missing feature (the plan's `featureMissing` pattern), not a silent ungated run.
- **Recommendation.** Stay at L11, with no budget raise for data forms. The owner may overrule: an alpha meant for a real consumer that holds 1.35 configs might want data forms at L4, and L4c is the slice for that, costing the raise above. Separately, L4 alone will probably need its own `minimal` raise (see Size).

### C. Engineering defaults that keep parity (no decision needed)

- **The skip counter is not ported.** `STABLE_THRESHOLD` only changes cost, never which keys an effect depends on, and the skip never fires in 1.35 (T1); T2 and the reused sets get the saving without it.
- **A throwing run keeps the previous dependencies** (T1), on both engines.
- **Effects stay in the reconcile pass**, not on the graph's own effect nodes. Graph effects flush right after a write; Directive effects run inside the pass, after derivations and before constraints. Moving them would change timing that the diff harness checks.
- **(c) is for effects only.** Constraints and derivations keep 1.35's membership tracking (`mutants-derivations` "a membership test from a constraint makes the name watched" pins the constraint case in 1.35). Extending (c) is a beta question.
- **`Object.keys(derived)` and spread inside an effect** stay untracked, as in 1.35.
- **One `prev` copy per pass**, shared by every `on` gate, where 1.35 builds one per gate. Same answers.
- **An `on` gate makes `prev` observed** (1.35's rule), when the gate arrives.
- **The unknown-id error** is a plain throw in production too, as 1.35; the dev-string count does not change for it.
- **Re-asking unresolved `deps` names** comes with L10's `register`.

## Evidence: probes

Revision 1 ran its own script. Revision 2 replaces it with the design review's probes, which cover the same cases and more. They are vitest files that run one scenario on either engine, through the conformance `@engine` alias, and write what happened to a JSON file. They live in the review session's scratch folder, not in the repo, and L4-pre turns the ones that matter into conformance tests (the untested-behaviours section).

- Probe source: `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l4-rv/r.probe.ts`
- 1.35 output: `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l4-rv/out-v1.json`
- core-next output: `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l4-rv/out-v2.json`

Module for most probes: facts `a`, `b`, `c`, `mode`; derivation `d = a + 1`. "v2 has no controls" means `system.effects` is undefined on core-next, so the step throws and the rest of the probe is not comparable.

| Probe | Steps | 1.35 | core-next |
|---|---|---|---|
| M | An effect that only tests `"d" in derived` (`member`) and one that tests `"nope" in derived` (`absent`); writes `a = 1, 2, 3`, then `b = 1`, `c = 1` | `member` runs at `a = 1, 2, 3` and not at `b` or `c`; `absent` runs at every write | `member` runs at `a = 1` only; `absent` as 1.35 |
| M_watched | The same, plus an effect that reads `d`'s value | Both effects run at every `a` write | The same: a value reader hides the bug |
| CM | A constraint `when` that only tests `"d" in d`; writes `a = 1, 2, 3`, then `b = 1` | Evaluated at the start and at all three `a` writes; not at `b` | Evaluated at the start and at `a = 1` only |
| T | An effect that reads `mode` and `b`; with `mode` true it reads `a` and throws. Writes `mode = true`, `c`, `a`, `b`, `c` | The throwing run is not adopted: `c` and `a` do not wake it, `b` does | The same |
| XY | `deps: ["a"]` effect with a cleanup; `a = 1`, `disable`, `a = 2`, `b = 1`, `enable`, `b = 2`, `c = 3`, `a = 4`, stop | No cleanup at `disable` or `enable`. At `b = 2`: cleanup, run (ungated). At `c = 3`: cleanup, run. At `a = 4`: cleanup, run. Cleanup at stop | v2 has no controls |
| Yd | `deps: ["d"]`; `a = 1`, `disable`, `enable`, `b = 1`, `a = 2` | Runs at `b = 1` (ungated) | v2 has no controls |
| Ya | Auto-tracked on `a`; `a = 1`, `disable`, `enable`, `b = 1`, `b = 2`, `a = 2`, `b = 3` | Runs at `b = 1`, then not at `b = 2`, runs at `a = 2`, not at `b = 3` | v2 has no controls |
| Yon | `on: { a: { $gt: 5 } }`; `a = 1, 6`, `disable`, `enable`, `a = 2`, `b = 1` | Gated before (runs at `a = 6` only); after `enable`, runs at `a = 2` and at `b = 1` | v2 has no controls and no predicate evaluator (it runs at start) |
| EB | `deps: ["a"]` effect that throws on its second run, `errorBoundary: { onEffectError: "disable" }`; `a = 1` (the run throws), `a = 2`, `enable`, `b = 1`, stop | The boundary disables it (`isEnabled` false). After `enable`, a write to `b` runs it | v2 has no controls |
| S | Synchronous write, then `await Promise.resolve()` once | `isSettled` false at once, true after one microtask, effect run | The same |
| P | An async effect holds `prev` across an `await` | Held reference keeps its pass's values | The same |
| U | `disable("nope")`, `enable("nope")` | Throws `[Directive] Unknown effect: nope` | v2 has no controls |

**Reading the table:** M and CM are the membership bug: 1.35 runs the reader at every change, core-next at the first. M_watched is why a test with a value reader missed it. T is the throw rule, identical on both. XY, Yd, Ya, Yon and EB are (x) and (y): XY shows the cleanup waiting until the first run after `enable`, and every row after `enable` shows a lost record, including the `on` gate (Yon) and the error-boundary path (EB). S is the one-microtask pin. (An `isEnabled` line in probe U is a probe bug, `log` out of scope, and carries no information.)
