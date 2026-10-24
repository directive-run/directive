# RFC: the L2 reconcile engine (constraints → requirements → resolvers)

Status: draft for the Phase 1 gate discussion. Nothing here merges before that gate.
Tree: branch `p2/l2-spike`, cut from `origin/main` at `c97dbba4` (core-next at L1). Spike code is on the same branch.

## What we are building

L2 adds the part of Directive that makes it Directive: constraints say what must be true, the engine turns each true constraint into a **requirement**, and a **resolver** runs to fulfil it. The rebuild must reproduce every 1.35 rule for this, because those rules took eight review rounds to get right and the conformance suite pins them.

The decision already made (Jason, 2026-10-21) is that there is **one async reconcile engine that behaves like 1.35**, running on the kernel's scheduler and clock, with follow-up passes going through the scheduler. `withPhases` stays an optional extra. This RFC says how that engine is built on core-next, maps every 1.35 rule to the mechanism that keeps it, and reports what a spike of it passes today.

| If "approved" means | Then this gets built |
|---|---|
| The pass | The L1 pass in `api/core.ts` gains three hooks (`begin_`, `evaluate_`, `commit_`) that an L2 part fills. No second engine, no second scheduler. |
| The parts | `api/constraints.ts`, `api/requirements.ts`, `api/resolvers.ts`, `api/reconcile.ts`, wired into `createSystem` like effects are. |
| The own-write rule | Writer stamps (plan item A3): each write records which run made it; the pass reads the stamps. This replaces 1.35's per-run write counters. |
| The seams | Interceptor point, stamp shape, resumable-run table, concurrency slot, owner-tree cancellation and owned timers, each placed in a named file (see "The seams"). |
| Errors | Alphas keep 1.35's throw behaviour. The list of what changes when errors become stream records is in "Errors", for sign-off before beta. |

## Words this document uses

| Term | Meaning | | Where |
|---|---|---|---|
| **pass** | One run of the core's `reconcile()`: take the keys changed since the last pass, run effects, then evaluate constraints and act on the requirement diff. Passes never overlap. | existed | `api/core.ts` `reconcile` |
| **pass keys** | The fact keys (and `\u001F`-prefixed derivation ids) changed since the previous pass began. | existed | `api/core.ts` `changedKeys` |
| **requirement id** | A string built from the requirement's content: its type, a colon, the other fields as sorted JSON. A resolver's `key` replaces it. | existed in 1.35 | `api/requirements.ts` |
| **run** | One resolver invocation for one requirement, with its own abort signal. | existed in 1.35 | `api/resolvers.ts` `Run` |
| **satisfied** | A run whose own writes, and nothing else, made its requirement disappear. It is not canceled. | existed in 1.35 | `engine.ts:1378` |
| **superseded** | A satisfied run whose requirement came back. A new run takes over; the old one's later writes are dropped. | existed in 1.35 | `resolvers.ts:1947` |
| **writer stamp** | A small integer on each write naming who made it: a run id, or 0 for anyone else. | new here | `api/reconcile.ts` |
| **owner** | The kernel's id for timer ownership. Disposing the kernel clears every timer with that owner. | existed | `kernel.ts` `owner` |

## The unit of reconcile is the 1.35 pass, kept whole

**In plain terms:** a pass is still 1.35's single async function. It starts inside the kernel's flush on the system's lane, and it awaits in exactly the two places 1.35 awaits, and nowhere else.

```
 a write ──► changedKeys ──► scheduleReconcile ──► kernel.request(lane)
                                                         │  one host microtask per lane per tick,
                                                         ▼  every system on the scheduler, by registration order
 kernel settle ─► reconcile():
   1  passKeys = changedKeys; changedKeys = new        begin_(): close this pass's writer stamps
   2  effects for passKeys                             await only if an effect returned a promise
   3  requirements = evaluate_(passKeys)               await only if a constraint read a changed key
   4  commit_(requirements)                            diff · satisfy or cancel · dispatch · requeue
   5  reconcile.end, reconciling = false               same continuation as step 4, as in 1.35
   6  changedKeys not empty ──► scheduleReconcile      the follow-up pass, through the scheduler again
```

**Reading the chain:** steps 3 to 5 share one continuation, which is what 1.35 does (`engine.ts:1974–2290`): the diff, the dispatch, the `onReconcileEnd` hook and the moment `isSettled` can turn true all land on the same microtask as in 1.35. Step 3 answers synchronously, with no await at all, when no constraint read any pass key (1.35's `evaluateUnaffected`). When it must evaluate, the evaluation keeps 1.35's async shape: one async readiness round per `after` level, and async constraints evaluated in parallel. A system with no constraints and no resolvers never defines the L2 feature, so its pass is byte for byte the L1 pass.

**Why follow-ups go through the scheduler:** every reason for another pass (a write during a pass, a run that ended, a requeue, `constraints.enable()`) calls the core's `scheduleReconcile`, which calls `kernel.request()`. Systems that share a scheduler therefore flush together, in registration order, in one host callback. The one exception is inherited from L1 unchanged: a follow-up asked for inside this system's own micro-lane settle gets its own microtask, as 1.35's per-microtask follow-up passes do (`api/core.ts` `followUp`).

**What bounds it:** the effect-chain cut (100 passes woken only by effect writes) stays. 1.35's `MAX_RECONCILE_DEPTH` is reset every pass and cannot fire (`engine.ts:2265–2294` says so and why), so it is not ported. A resolver that requeues itself forever is unbounded in 1.35 and stays unbounded in the alphas; see Risks.

## Data flow: what lives on the graph and what the kernel owns

**In plain terms:** facts and derivations are graph nodes. Constraint conditions are not, at L2. Resolver runs are kernel-owned async work. Requirement identity is a content string, never an object.

| Thing | At L2 it is | Why |
|---|---|---|
| Fact | A graph signal (unchanged from L0) | |
| Derivation | A graph computed (unchanged) | |
| Constraint condition (`when`, `require`) | A function evaluated inside the pass, its reads tracked through the system tracker as string deps: fact keys and `\u001F`-prefixed derivation ids. The pass finds affected constraints by key (`byKey`). | It must run in the pass, after effects, in priority and `after` order, and it may be async. A graph computed runs on pull and cannot track across an `await`. L0 and L1 effects already use this tracker, so it is proven. |
| Requirement | `{ requirement, id, fromConstraint }`; the set is a `Map` keyed by id, first one wins | The id is the diff key, the in-flight key, the requeue key and, later, the snapshot key. |
| Run | An `AbortController`, a promise, and a run id that doubles as its writer stamp | |
| Retry sleep, run timeout, async-constraint timeout | Timers on the kernel clock, `owner: kernel.owner`, `kind: "retry"` or `"timeout"` | Disposing the kernel clears them; a virtual clock makes them deterministic. 1.35 used bare `setTimeout`. |

**A rule the graph alone would have broken (found by the spike).** An async constraint with `deps: ["ready"]` names a derivation it never reads. The derivation goes stale on the first change and is never recomputed, so a dirty-mark walk stops at it and the constraint never wakes again. 1.35 keeps it waking (`derivation-deps.test.ts`, "keeps re-evaluating an async constraint that never reads the derivation"). The spike adds a **watched** set to the core's invalidation walk: a derivation named in declared deps reports itself as changed on every upstream write, even while stale. Moving constraint conditions onto graph nodes later (with L4 effects) must keep this rule.

## Every 1.35 rule, the mechanism that keeps it, and the test that pins it

**In plain terms:** each rule below is a behaviour 1.35 has that a naive engine gets wrong. The last column says what the spike does today when the gate is forced to L2 locally.

| # | 1.35 rule | 2.0 mechanism | Pinned by | Spike |
|---|---|---|---|---|
| 1 | A run whose own writes retract its requirement completes, and is not canceled. Keyed siblings share ownership of one pass's changes. | Writer stamps. `begin_` closes the record `key → writers` for the pass. A removed requirement is satisfied when its run wrote this pass and every changed key its constraint read was written only by runs whose requirements were removed in the same pass. | `resolver-satisfied-by-own-write`, `resolver-outcomes` (keyed), `resolver-retracting-own-requirement` | 7/7 L2 pass. Gap: inputs reached through a derivation are not followed yet (1.35 walks `dependencyEdges`). |
| 2 | Exactly one outcome per run: complete, cancel or error. | One terminal transition per run. The completion path checks `signal.aborted` first, and the end handler acts only while the in-flight slot still holds this run. | `resolver-outcomes` | 3/3 L2 pass. See question 3: 1.35 itself breaks this rule in one case. |
| 3 | Late writes are dropped only when a newer run supersedes. Timeouts and cancels keep them, so `finally { loading = false }` lands. | A `discard` flag on the run's `ctx.facts`, set only by supersede. Cancel and timeout abort the signal but keep writing. | `resolver-loading-flag`, `superseded-bodies-and-retry-timer` | 1/1 and 4/5 L2 pass. M1b needs constraint binding (row 11). |
| 4 | A `when` or `require` that throws keeps the deps it read. `start()` re-asks every constraint. | The tracker frame is kept on a throw; `start()` marks every constraint dirty. | `constraint-reevaluation` | 4/4 L2 pass |
| 5 | `retry-later` always retries. | Error-boundary strategy | `constraint-reevaluation` (H4), `error-boundary` | L3: not built |
| 6 | Writes in one tick merge into one pass. A write after an `await` gets its own pass. | Unchanged core scheduling, plus the resolver's synchronous start wrapped in one `store.batch`, as 1.35 does. | `reconcile-timing-rules` | Mechanism present. Those tests sit at L7 and L8. |
| 7 | Requeue: a run can ask for its requirement to be dispatched again. It applies only once that run is out of flight. | A requeue set, applied after the new requirement set is committed, then a follow-up pass. | `requeue`, `requeue-after-resolver-finishes` | 3/3 pass. `requeue` 0/4: it imports `flushMicrotasks` from `/testing`, which v2 lacks. With a temporary local `/testing` file (not committed) it is 4/4. |
| 8 | Retry with backoff (none, linear, exponential), `maxDelay` clamp before jitter, jitter (none, full, equal, `{maxMs}`), at least 1 ms. | `delayFor`, ported, on the kernel clock. Jitter draws from the kernel's seeded rng when it has one. | `resolvers.test.ts` (internals), diff scenarios "retry with exponential backoff…", "full and equal jitter…" | Built. Black-box: "is not retried if it throws after satisfying" passes. The diff scenarios were not run. |
| 9 | Timeout aborts the run, reports one error, and keeps its later writes. | `withTimeout` on the kernel clock; the error is marked so `shouldRetry` sees `reason: "timeout"`. | `resolver-outcomes`, diff "a timeout aborts the run but keeps its cleanup write" | Pass |
| 10 | Abort reasons reach `shouldRetry`: error, timeout, cancelled, clobbered. | `shouldRetry(error, attempt, { reason })` | diff "shouldRetry sees why each attempt aborted" | error and timeout only; clobbered needs row 11 |
| 11 | Constraint binding (RFC-0003): `abortOn` and `bind`, clobber detection, detach instead of abort. | To build on writer stamps: a clobber is a write to an owned key stamped by someone else. | `resolvers.test.ts` binding block, M1 and M1b, two diff scenarios | Not built. Missing from the plan's L2 list. |
| 12 | `after` and priority order constraints. A blocked constraint carries its last requirements. Resolving one dirties its dependents. | Priority first, then a topological order over `after`. | `constraints.test.ts` (internals), diff "priority and after order dependent constraints" | Built. Not run: internals files are skipped on v2. |
| 13 | `settle()` waits for runs in flight. Its timeout names them. | `busy_()` folded into `isSettled`; `details_()` and `unmet_()` added to the timeout message. | `engine.test.ts` (Settle) | 2/2 pass |
| 14 | `constraints.disable`, `enable`, `isDisabled` | On the constraints part; `enable` schedules a pass. | `constraint-disable` | 5/5 pass |
| 15 | Resolvers read other modules only through `ctx.deps`; constraints read `facts.self`. | Namespaced wrapping in `api/namespaced.ts`, as derivations and effects are wrapped today. | `blackbox-cross-module-deps`, `derived-in-constraints-effects` | Not built: 1/2 and 3/5 |
| 16 | A data-form `when` containing `$changed` is rejected at `createSystem`. | Predicate validation | `data-forms` | Not built: 0/3. It needs the data-form compiler. |
| 17 | Effects never write facts; navigation re-runs. Sources stay in their own module. | Not L2 | `effect-readonly-facts*`, `multi-module-correctness` | L1, L5 and L8 |

### Spike results, measured

What I ran: `layers.rules.json` `current` set to `"L2"` in the working copy only, then `vitest --project conformance:v2` over 18 files, then the file restored. Nothing in `packages/conformance` is committed.

| Run | L2 tests passing | L0/L1 tests in the same files |
|---|---|---|
| core-next at L1, no spike (17 files) | 13 of 62. All are `createModule` validation, or tests that pass when nothing happens. | 63 of 63 |
| Spike (18 files) | **53 of 64** | 63 of 63 |

**In plain terms:** the spike makes 39 more L2 tests pass in the same 17 files. Every one of the 11 failures comes from a feature the spike left out (rows 7, 11, 15 and 16), not a wrong rule.

At the committed gate (`current: "L1"`), `conformance:v2`, `v2:prod`, `v2:dist`, `v2:dist:prod` and `diff` pass 1,133 tests with 0 regressions. One check, `self/engine-identity` "is not the other engine", timed out at 5 s on both dist projects when all five projects ran together. Run alone it passes in 4.2 to 4.3 s. core-next `test` (172), `typecheck`, `build` and `size:check` all pass.

## The seams, placed

**In plain terms:** these are the plan's L2 extension points. Each one now has a definite place in the code, so later features plug in rather than force a rewrite.

| Seam | Where it sits | Shape | Spike |
|---|---|---|---|
| **Pre-commit interceptor** | `api/facts.ts` `store.set` and `delete`, immediately before `graph.write`: the line where the spike's `stamp?.(key)` is now. Events are intercepted in `dispatch`, before the handler's batch. | `intercept({ key, value, prev, stamp }) → value \| VETO`, registered through the kernel feature registry. When nothing is registered it costs one check per write. | The hook point exists. No interceptor yet. |
| **Provenance stamp** | Passed with each write. The spike sets it on the run's `ctx.facts` around the write, and the first stamp consumes it, so a listener's nested write is not credited to the run. The alpha passes it explicitly: `store.set(key, value, stamp)`. | `type Stamp = number`; 0 means unattributed. A per-kernel table interns `{ by, cause?: seq, txn?, justification?, origin: "local" \| "remote" \| "restore" }` on first use, so a write carries only the integer and allocates nothing. `system.applyRemote(writes, origin)` stamps `remote`. | `by` only (the run id), set ambiently and consumed by one stamp |
| **Resumable runs** | A snapshot part through `withSnapshot` (`snapshot.ts`): `contribute("resolvers", { dump, load })` | Requirement ids are content-built and frozen as a contract. Each in-flight row is `{ reqId, resolverId, attempt, nextRetryAt }`. On load, each run is re-dispatched with `ctx.attempt` set and its retry timer re-armed on the clock. One `ctx` factory, which features extend (`ctx.step`, `ctx.until`, `ctx.fork`). | Content ids built; `ctx` built in one place (`execute`); no snapshot part yet |
| **Concurrency strategy** | `resolve(req)` in `api/resolvers.ts`, before a run is created | `concurrency: n \| "latest" \| "queue" \| (running, incoming) => "start" \| "queue" \| "drop" \| { cancel: runId[] }`. Today's rule (one run per id, dropped as a duplicate unless satisfied, then superseded) is the default strategy. | Default rule only |
| **Cancellation off the owner tree** | Each run's controller belongs to its system. `kernel.dispose()` disposes children first. Run timers carry `owner`, so `clock.clearOwner` ends them. | Later work a run spawns (`ctx.fork`) gets a child controller tied to the run's signal: the A4 cancellation tree. | `stop()` and `destroy()` abort every run; timers carry the owner |
| **Timers as data** | `clock.setTimeout(fn, ms, { owner, kind })` for retry, run timeout and async-constraint timeout | `TimerRecord { deadline, owner, kind, seq }` is already data, so the L3 timer heap snapshot and `nextDeadline()` follow. | Built |
| **Cost and effects metadata** | Resolver definition: `meta`, `writes`, `cost` | Types only at the alpha; read later by planners | Not built (types only) |
| **One versioned record** | The kernel stream that L0 and L1 already use | The spike's new record kinds (`constraint.*`, `requirement.*`, `resolver.*`) map onto the 1.35 hooks in `api/plugins.ts`, so the L3 record already carries L2 events. | Built |

## Errors: alphas keep 1.35's throws; this is what records would change

**In plain terms:** today some errors escape to the caller of a write, or become unhandled rejections. The plan's L3 seam says errors become stream records that are "never thrown into the host from a flush". That is a behaviour change, so it waits for Jason's sign-off and lands no earlier than beta. The alphas, and the spike, keep every row in the "Today" column.

| # | Today (1.35, kept in the alphas) | With stream records | Evidence |
|---|---|---|---|
| 1 | `errorBoundary.on*Error: "throw"` rethrows a `DirectiveError` inside the pass (constraint, effect) or inside the run (resolver). The rest of the pass is skipped. The host sees an unhandled rejection (resolver) or, in development only, "Unexpected error in reconcile" (constraint). | An `error` record `{ code, phase, nodeId, cause, strategy: "throw" }`. The pass finishes. The throw reaches the host as a rejected `settle()` or `whenReady()` (proposed). | Reasoned from `errors.ts:509–511`, `engine.ts:1258–1264, 1694–1701`, `resolvers.ts:2012–2040` |
| 2 | A store listener that throws (`subscribe` on a fact, `watch`, `$store.subscribe`) propagates out of the write that notified it. | The write commits, the error becomes a record, and the other listeners still run. | Read: core-next `facts.ts` `notify` and `run` have no catch |
| 3 | "Infinite notification loop detected after 100 iterations" is thrown from the write. | A record; the write returns. | `facts.ts` `run` |
| 4 | "Infinite derivation notification loop" is thrown from the write. | A record | `core.ts` `release` |
| 5 | The scheduler's "lane did not settle" is thrown to whoever asked for the sync flush. | A record | `scheduler.ts` `flushLane` |
| 6 | `onError` and `onErrorRecovery` receive a `DirectiveError`. | They become views over the record. The payload type stays `DirectiveError`. | Plan, L3 seam |
| 7 | Unchanged by records, because none of these come from a flush: the `settle()` timeout rejection; construction-time throws (an `after` cycle, blocked keys, `$changed`); `system.read` of an unknown id; reading a throwing derivation. | Unchanged | |

## Size

**In plain terms:** the spike's pieces are 18 to 39 percent of their 1.35 counterparts. A "hello world" with no constraints still pays for the engine, though, because the alpha's `createSystem` must carry it.

All figures below are measured. Each file is bundled alone, minified, with its other imports external and development text not folded. The 1.35 figures are within 2 percent of the plan's 10.7 KB and 15.0 KB.

| Piece | 1.35 min | Spike min (gz) | Spike ÷ 1.35 | Missing from the spike | Projected alpha min |
|---|---|---|---|---|---|
| constraints | 11,047 B | 4,345 B (2,012) | 0.39 | Data-form `when`, development warnings, explain and inspect | ~5.0 KB |
| resolvers | 15,025 B | 2,681 B (1,400) | 0.18 | Binding and clobber (row 11), statuses for inspect, drain-on-evict (L3). Batch is L7 and opt-in, so it is not counted. | ~4.5 KB |
| requirements | 1,033 B | 867 B (489) | 0.84 | Public helpers (`req`, `forType`): L13 | ~0.9 KB |
| reconcile pass (1.35: part of `engine.ts`, 42,628 B) | n/a | 2,983 B (1,396) | – | Derivation walk (row 1), namespaced wiring | ~3.6 KB |

The plan's achieved ratios (facts 0.48, effects 0.36, engine/system 0.17) do not reproduce with this per-file method: it gives facts 0.83 and effects 0.52. So the projection below uses the fixture deltas, which are measured the way the gates measure.

| Fixture (production, gzip) | L1 today | With the spike | Projected L2 complete | Projected alpha (L3) |
|---|---|---|---|---|
| `minimal` (no constraints) | 14,531 B | **18,816 B (+4,285)** | ~20.0–20.5 KB | ~21.5–23 KB (1.35: 55,260 B) |
| `floor` (`createSystemCore`, no parts) | 8,624 B | 8,766 B (+142) | ~8.8 KB | – |
| `graph.ts` | 1,797 B | 1,797 B (untouched; budget 1,800) | | |

The projections are reasoned. L2 complete adds about 1.2 to 1.7 KB gzip for rows 1, 11, 15 and 16 and for inspect. L3 adds lifecycle, the error boundary and the hook stream.

## Risks

| Risk | Why it matters | What to do |
|---|---|---|
| Microtask parity is not yet checked | The await points mirror 1.35, but only the differential harness checks tick-for-tick traces, and its L2 scenarios were not run. | Run `conformance:diff` with `current: "L2"` as the first build step. |
| Own-write through a derivation | The spike cancels a run that retracts its requirement through a derivation, which 1.35 counts as satisfied. | Follow the constraint's derivation deps through their graph links to fact nodes. `reconcile-timing-rules` "via a derivation" (L7) covers it. |
| Ambient stamp | A run's stamp held in a variable could be credited to a nested write. The spike consumes it on first use. | Pass stamps explicitly in the alpha. |
| Stamps only while a run is live | Kept for parity with 1.35, which counts writes only then. A change made while no run was live does not count against a later run. A latent quirk. | Keep for the alphas; a candidate divergence at beta. |
| Unbounded requeue loops | A resolver that requeues itself forever never trips a guard, in 1.35 or here. | 1.35's own comment names the fix: repeat detection on (constraint, requirement id). |
| `engine-identity` near its timeout | 4.2–4.3 s against a 5 s default; it timed out once under parallel load. | Raise that test's timeout before CI flakes on it. |

## What the plan got wrong, or left out

- **The interceptor's location.** `kernel.ts` places the pre-commit interceptor in the settle, after the settlers and before `graph.flush`. By then the store holds the new value and synchronous subscribers have run, so nothing can be vetoed. It belongs before `graph.write` in `api/facts.ts`.
- **RFC-0003 constraint binding is missing from the L2 list.** The conformance suite places it at L2 (row 11). Plan item A3 says stamps replace "the satisfiedByOwnWrite and clobber code", so binding should be built on stamps at L2.
- **"Exactly one outcome per run" is not what 1.35 does.** Verified: on published 1.35.0, a run whose requirement is retracted during its retry backoff reports `cancel` and then `error`. The spike reproduces this. It is question 3.
- **Two L2-placed test groups need things that are not L2.** `requeue.test.ts` imports `flushMicrotasks` from `@directive-run/core/testing` (an L13 subpath). The `data-forms` `$changed` rejection needs the data-form compiler. Either L2 ships those pieces or the census should place the tests higher.
- **"Constraint condition is a node object" does not hold at L2.** Conditions stay on the tracker at L2 for the reasons in "Data flow". They become nodes with L4 effects, keeping the watched-derivation rule.

## Open questions for Jason

1. **Errors as stream records.** Do you sign off the change list in "Errors" (rows 1–6) for beta? Do you accept the proposed host channel for `"throw"`, a rejected `settle()` or `whenReady()`? Until you do, alphas keep 1.35's behaviour, and the spike does.
2. **A minimal app pays for the reconcile engine.** The alpha keeps 1.35's `createSystem`, so an app with no constraints carries the engine: measured +4.3 KB gzip today, projected about 20 KB at L2 and 22 KB at alpha, against 55 KB for 1.35. Your 2026-10-21 rule lets builds that include constraints exceed 8 KB. Does `minimal` count as one of those builds, with its budget set at the Phase 2 gate from these measurements? Or should beta offer an engine-free entry? The `floor` fixture, 8.8 KB, shows what that entry would cost.
3. **The two-outcome case.** Should alphas reproduce it (1.35 parity, as the spike does now), or fix it to one outcome and list it in `divergences.json`? My recommendation: keep parity in the alphas and fix it at beta, with a 1.35.x patch if you want the two engines to agree sooner.

## Decisions made in the spike (reversible)

- Writer stamps instead of write counts. The check is equivalent to 1.35's: "every change this pass to a key the constraint read was stamped by one of the runs removed together."
- L2 is three hooks in the existing pass, not a second engine. A module with no constraints and no resolvers gets no L2 feature, so its pass is unchanged.
- Development text in the spike is behind the dev flag, and the size script's "dev strings in a production bundle" check passes.

Routine, no design needed: requirement normalization (null, a single requirement, an array), the first-wins requirement set, the resolver lookup by type or predicate, the `requirement.created` / `met` / `canceled` hooks, and the `onReconcileEnd` result shape.
