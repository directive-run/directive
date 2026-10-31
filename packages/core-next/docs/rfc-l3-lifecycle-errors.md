# RFC: L3 lifecycle, error boundary and hook stream

Status: draft for review, revision 2 (the review's eight findings folded in). No engine code merges from this document.
Tree: branch `p3/l3-rfc`, cut from `main` at `464c1b17` (core-next with L2a to L2d merged; `layers.rules.json` `current` is still `"L1"` on main).

## What we are building

L3 is the last layer of the alpha. It adds the parts of a system that sit around the reconcile engine: how a system starts, stops and reports that it is ready; what happens when a constraint, effect, derivation or resolver throws; and how plugins hear about all of it. After L3, `alpha.0` is L0 to L3 at full parity with the 1.35 API.

The rules are the ones L2 settled on. Parity with 1.35 is the rule, and when this document and 1.35 disagree, 1.35 wins. Every run ends in one outcome. There is one scheduler and one clock: no `setTimeout`, `setInterval`, `queueMicrotask`, `Date.now` or `Math.random` in new code. The dev-string count stays exact.

**What may differ from 1.35.** Only quirks (a) to (k) in `packages/conformance/contracts/GATE-1.md` are approved divergences, and each gets an unsigned `divergences.json` entry when its layer lands. Anything else in this RFC that would behave differently from 1.35 is a **candidate divergence**. Each candidate has a letter ((n), (p), (q), (r)), is listed under "Decisions for the owner", list A, and is built only if Jason approves it. Until he does, the slice keeps 1.35's behaviour.

| If "approved" means | Then this gets built |
|---|---|
| The error boundary | A new part, `api/errors.ts`, plugged into the `reportError` seam every part already receives. `reportError` returns the strategy, and the caller acts on it. With no `errorBoundary` option the path is today's "skip". `"throw"` keeps 1.35's surfaces exactly (E10). |
| Lifecycle | `isReady` and `whenReady()` driven by the first pass's end, module hooks, `destroyAsync()`, `initialFacts` and `hydrate()`, and `tickMs` on the kernel clock. The clock gains a keep-alive option for the one 1.35 timer that does not hold a process open (C5). |
| One hook stream | Each hook name gets an integer id, and an emitter asks `wants(id)` before it builds a record, so a record no plugin wants is never built. `wants` reads each plugin's hook when the record is due, as 1.35 reads it at call time. The 46 hook names stay as the public adapter. |
| Records | The kernel record shape is frozen at `v: 1`, with fields for errors (`code`, `phase`, `nodeId`, `cause`) and writes (`by`). Alphas still throw where 1.35 throws (GATE-1 decision 3.1). |
| Approved quirks | (a) `onResolverError: "retry"` re-dispatches the resolver. This RFC proposes the bound that completes (a)'s definition: at most 3 in a row. (f) a timer completed while paused stops counting. |
| Candidates, built only if approved | (n) a timeout aborts the attempt's signal. (p) `"retry-later"` re-dispatches the resolver. (q) `startTimer` on a completed timer does nothing. (r) `destroy()` cancels the never-started warning. |

**In plain terms:** L3 adds no new engine. It fills in the edges of the one L2 built, through seams that already exist: the error callback every part gets, the requeue set, the kernel clock and the kernel's event stream.

## Gap analysis, measured

What I ran: `layers.rules.json` `current` set to `"L3"` in the working copy only, then `npx vitest run --project conformance:v2` and `--project conformance:v2:dist` from `packages/conformance`, with the JSON reporter. Then `current` went back to `"L1"`. Nothing in `packages/conformance` is changed by this PR.

| Run | Tests | Pass | Fail | Skipped |
|---|---|---|---|---|
| `conformance:v2` at forced L3 | 3,096 | 1,094 | 144 | 1,858 |
| `conformance:v2:dist` at forced L3 | 3,096 | 1,094 | 144 | 1,858 |

The two runs fail on exactly the same 144 tests. None of the failures is placed at L0, L1 or L2, so L2 is complete on this measure. 251 L3 tests already pass, and 113 L3 tests fail. The other 31 failures are L7 batch tests that the census places too low (see "What the plan got wrong").

| Feature | Failing | Files | Representative tests |
|---|---|---|---|
| Error strategies | 57 | `l3-errors-oracle` (30), `l3-engine-oracle` (10), `blackbox-effects` (5), `l3-engine-oracle-clusters`, `-effect-chain`, `-boundaries` (2 each), `l3-system-oracle` (2), 4 others (1 each) | "disable on a resolver disables the constraint that required it"; "retries a failing constraint after a growing delay, then gives up with a skip"; "throw raises the DirectiveError to whoever read the derivation"; "a handler function receives the thrown error and the id" |
| Lifecycle | 16 | `l3-system-oracle` (6), `l3-engine-oracle` (4), `engine` (3), `l3-engine-oracle-boundaries` (2), `system-async-lifecycle` (1) | "fires onStart hook on start()"; "destroyAsync() stops, then announces the destroy"; "a system that is never started is reported once, in development" |
| settle and whenReady | 5 | `l3-engine-oracle` (3), `l3-system-oracle` (2) | "isReady is false before start, and whenReady() before start rejects"; "whenReady() right after start resolves for every caller once the first pass is done" |
| Plugin hooks | 7 | `derivation-hold-reentrancy` (3), `l3-engine-oracle` (2), `notify-guardrail-blocked` (1), `derivation-deps` (1) | "survives a plugin that opens a batch from inside onFactsBatch"; "notify.guardrailBlocked reaches plugins only for a registered plugin name" |
| Clock and timer | 7 | `l3-system-oracle` (6), `system` (1) | "dispatches tick every tickMs once started, and stops with the system"; "zero and negative values are refused" |
| Other: system options and surface | 17 | `l3-system-oracle` (12), `system` (2), `engine` (2), `ssr` (1) | "initialFacts applied on start in namespaced mode"; "nothing at all: an Error of the library's own, not a runtime TypeError"; "`$` prefix keys in schema throw" |
| Other: lower-layer gaps reached through a plugin | 4 | `blackbox-derivations` (2), `blackbox-effects` (2) | "throws on read and recovers once the cycle is gone" (core-next says "Cycle detected", 1.35 says "Circular…"); "a derivation name runs the effect when the derivation changes" |
| **L3 total** | **113** | | |
| Batch, placed too low | 31 | `l7-batch-resolvers-oracle` | "by default collects requirements raised close together into one call…" |

**Reading the table:** more than half the gap is the error boundary, which core-next does not have at all today: `reportError` in `api/core.ts:565–613` always applies "skip". Lifecycle and system options are many small pieces. The plugin hooks group is small because L0 to L2 already deliver most hooks through `api/plugins.ts`. The four "lower-layer gaps" are L0 or L4 behaviours that the census lifted to L3 only because the test also installs a plugin; they get fixed in L3 anyway, since the gate will run them.

Two counting notes. The tests' `by` lists are long because one test usually uses several features: of the 113, 80 install a plugin, 55 configure `errorBoundary` and 43 use module hooks. So each slice's done-means lists the test files and titles it must turn green, not a feature tag. And 25 failing L3 tests have titles built at run time (`single:` and `namespaced:` loops) that `layers.json` does not list by name, so they fall back to their file's rule.

## The design: each 1.35 rule, the mechanism that keeps it, and its pin

Where a row says "verified", the behaviour was observed by running a script against the built 1.35 package; the observed output is in "Evidence" at the end. The rest is read from the code, with the lines cited.

### Error boundary

**In plain terms:** 1.35's `errors.ts` decides a strategy for each error, and `engine.ts` acts on it in one place per source. core-next gets the same split: the boundary part decides, and the caller of `reportError` acts. No source gets a second error path.

| # | 1.35 rule | 2.0 mechanism and seam | Pinned by |
|---|---|---|---|
| E1 | Defaults: constraint, resolver, effect and derivation "skip"; system "throw" (`errors.ts:228–234`). `zeroConfig` sets the four to "skip" and an explicit `errorBoundary` wins (`system.ts:930–940`). | `api/errors.ts` `withErrorBoundary(config)`. It replaces the default `reportError` in the part context (`api/core.ts:565`); the default stays the floor's code. | `l3-errors-oracle` "which strategy a source gets" (4); `l3-system-oracle` "zeroConfig" (2) |
| E2 | A strategy is a string or a function `(error, id) => strategy \| void`. A function that returns nothing means "skip", and one that throws is logged and means "skip" (`errors.ts:371–414`). | Same function, ported. | "a handler function receives the thrown error and the id…", "a handler that throws is logged and the error is skipped" |
| E3 | Order inside `handleError` (`errors.ts:475–511`): plugin `onError`, then `errorBoundary.onError`, then the strategy, then plugin `onErrorRecovery` with it; a throwing observer is logged and contained (`errors.ts:417–433`). A non-Error is wrapped by its string form; a thrown `DirectiveError` passes through as the same object. The source's own hook (`onConstraintError` and the like) comes after `handleError` returns, in the engine. | `reportError` emits the `error` record, calls the config callback, picks the strategy, emits `error.recovery`. The record behind each source hook (`constraint.error`, `effect.error`, `resolver.error`) is emitted by the caller after `reportError` returns, as 1.35 does. Records stay the only path to plugins. | "what an observer is told" (4) |
| E4 | `"skip"`: swallow. In development, warn once per source when nothing handles it: no option for that source and no `onError` (`errors.ts:317–368`). | Today's warning, now gated on the config. The `warned` set and its 1,000-source cap move into the part. | "the development warning for an error nothing handles" (5) |
| E5 | `"disable"`: a constraint is disabled (`engine.ts:1262`); an effect is disabled (`engine.ts:1156`); a resolver disables the constraint that required it (`engine.ts:1485`). | `constraints.disable(id)` exists from L2. Effects gain `disable(id)` in `api/effects.ts`. Resolver errors pass `req.fromConstraint`. | "what each strategy does" (disable, 3); `l3-engine-oracle` "error boundary strategies" (3) |
| E6 | `"retry"`: a derivation is invalidated so the next read computes again (`engine.ts:1106`). An effect is run again in the next pass, at most 3 times in a row (`MAX_EFFECT_RETRIES`, `engine.ts:810, 1159–1171`); an ordinary change gives it its retries back. | Derivation: `graph` invalidate of that node. Effect: a rerun set in `api/effects.ts`, then `scheduleReconcile()`, through the scheduler. | "retry runs a failed effect again…", `l3-engine-oracle-effect-chain` (2), `blackbox-effects` (2) |
| E7 | `"retry"` on a resolver: **quirk (a)**, below. | Requeue. | below |
| E8 | `"retry-later"`: the attempt count per source id, up to `maxRetries`; delay `delayMs × backoffMultiplier^(attempt−1)`, capped at `maxDelayMs` (defaults 1000, 3, 2, 30000); past the limit, "skip" with a dev warning; attempt counts kept for at most 1,000 sources (`errors.ts:66–151, 274, 436–472`). A completed resolver clears its count and its waiting entry (`engine.ts:1463`, `errors.ts:536–539`). For a resolver, what happens when the entry comes due is candidate (p), below. | Ported, with `clock.now()` for `Date.now()` (`errors.ts:117, 130`). | "retry-later" (4); "retry-later remembers attempts for a bounded number of sources" |
| E9 | Due retries are found by a poller: an interval of `min(max(delayMs, 250), 500)` ms, started on first use or when `retryLater` is configured, stopped when nothing waits and on `stop()` (`engine.ts:564–599`). A due constraint is marked dirty so it is asked again (`engine.ts:581–583`). The poller is unref'd, so a waiting retry never holds a Node process open (`engine.ts:599`). | One repeating timer on the kernel clock, `{ owner: kernel.owner, kind: "retry-later", keepAlive: false }` (C5), re-armed only while something waits. Disposing the kernel clears it. It is data, so `nextDeadline()` sees it. | `superseded-bodies-and-retry-timer` K5; "stop() and stopAsync() end retry-later polling at once"; `constraint-reevaluation` "retry-later re-evaluates the constraint that threw"; C5's core-next test |
| E10 | `"throw"` (verified): after the records and `onErrorRecovery(…, "throw")`, `handleError` throws the `DirectiveError` (`errors.ts:509–511`). The throw comes before the caller's next line, so **no source hook fires**: not plugin `onConstraintError` (`engine.ts:1260`), `onEffectError` (`engine.ts:1145`) or `onResolverError` (`engine.ts:1483`), and not the module's `hooks.onResolverError` (`engine.ts:1514–1534`). Where the throw lands depends on the source. **Derivation:** the code that read it gets the error. **Constraint or effect:** the throw leaves the pass, which stops there; `scheduleReconcile`'s catch (`engine.ts:1695–1699`) logs "[Directive] Unexpected error in reconcile:" in development and nothing in production. Nothing reaches the host: the write that started the pass returns normally, and a later `settle()` resolves. **Resolver:** the throw leaves the run (`resolvers.ts:1297–1311`), so the run's promise rejects with nobody listening: an unhandled promise rejection carrying the `DirectiveError`. | Kept exactly for the alphas (GATE-1 decision 3.1). `reportError` emits the `error` and `error.recovery` records and returns "throw"; each caller then throws at the point 1.35 does, before its source record and module hook. So the reader, the pass's catch and the run's promise each see what they see in 1.35. Beta changes only where the throw goes. | Oracle: "throw raises the DirectiveError to whoever read the derivation"; "throw stops the pass…" (2); diff 'error boundary: onResolverError "throw"'. New in L3b, a core-next test per source pinning each surface: no source hook, no module hook, the development-only `console.error` for a constraint and an effect, the unhandled rejection for a resolver, the write and `settle()` succeeding. |
| E11 | A module's `hooks.onResolverError` hears the error after the engine has handled it; a throwing hook is logged with the module's name (`engine.ts:1514–1534`). Under `"throw"` it never runs (E10). | The namespaced wrapper (`api/namespaced.ts`) calls the owning module's hook after `reportError` returns. | `l3-engine-oracle-boundaries` (2); "a module's onResolverError hook hears the error…" |

**Reading the table:** E1 to E4 decide, E5 to E10 act, and E11 is the module's side channel. E10 is the one row where "act" means "leave": the throw skips everything after it, which is why the source hooks stay silent. The only new timer is the retry-later poller, and it moves from `setInterval` to the kernel clock. Its cadence stays 1.35's, so a due retry fires on the same poll tick as in 1.35.

### Quirk (a): `onResolverError: "retry"` re-dispatches the resolver

**In plain terms:** GATE-1 approves one fix (GATE-1.md, row a): under `"retry"`, a failed resolver runs again. In 1.35 it reports the strategy and then never runs again until its requirement is retracted and raised anew. 2.0 runs it again. GATE-1 does not say how often, so the bound below is a proposal that completes (a)'s definition. `"retry-later"` is not part of (a): it is candidate (p), next section.

What 1.35 does (verified):

- `recordError` calls `onError` from inside the run (`resolvers.ts:1297–1311`). The engine removes the id from `previousRequirements` and schedules a pass (`engine.ts:1489–1493`).
- That pass runs while the failed run still holds its in-flight slot (freed in the run's `.finally`, `resolvers.ts:2027`). It emits `onReconcileStart`, then `onRequirementCreated` for each current requirement (1.35 emits it for every requirement on every pass that is not quiet, `engine.ts:2005–2009`), then `onReconcileEnd`. The resolver part drops the dispatch as a duplicate, so there is no `onResolverStart`.
- The run then ends, and the pass every finished run triggers (it happens under `"skip"` too) finds nothing to do. Calls stay at 1. An unrelated fact write does not change that; retracting and raising the requirement again does.

| | 1.35 | 2.0 |
|---|---|---|
| Up to the run's end | The error path's extra pass while the run is in flight, then the post-run pass | The same two passes with the same records. The error path still marks the id as added for the next diff and schedules that pass, so the dispatch is dropped as a duplicate, as in 1.35. |
| Re-dispatch | None | The error path also puts the id in the reconcile part's requeue set (L2b, RFC row 7). A requeue applies only once its run is out of flight (`api/reconcile.ts:448–462`), so the post-run pass applies it and schedules one more pass, which re-dispatches the requirement if it is still raised. That pass and the fresh run in it are the whole divergence. |
| The fresh run | – | A new run under the resolver's own `retry` policy (attempts and backoff), with its own outcome, so one outcome per run still holds. |
| Bound: **proposal for Jason, part of defining (a)** | None, and none is needed, because nothing runs again | At most 3 re-dispatches in a row per requirement id. A completed run of that requirement, or its retraction, resets the count. Past the cap the error is still reported as "retry", the engine does not re-dispatch, and development warns once, worded like 1.35's effect cap (`engine.ts:1159–1171`). The requirement is then where 1.35 leaves it: raised, and run again only when raised anew. |
| Pinned by | The oracle tolerates both: "retry is reported for a failed resolver, which runs again the next time its requirement is raised" asserts only `≥ 2` calls after a re-raise | A core-next test in `src/__tests__/`: the pass sequence, the cap and its reset. The diff scenario 'error boundary: onResolverError "retry"' shows the difference and gets a `divergences.json` entry with `approvedBy` empty. |

**Reading the table:** everything up to the post-run pass is 1.35's, record for record, and the fix reuses the requeue path L2b built for `context.requeue()`, so there is no second dispatch path. The cap is the only part of (a) that GATE-1 leaves open. Without one, a resolver that always fails would loop for as long as the process runs, because each failure re-dispatches the next. 3 is the number 1.35 already uses for effects. It is decision A1.

### Candidate (p): `"retry-later"` re-dispatches the resolver

**In plain terms:** quirk (a) names `"retry"` only. Under `"retry-later"` 1.35 has the same symptom: it reports the strategy, the poller later runs a pass, and the resolver still never runs again. Fixing that is a separate change that needs Jason's approval (decision A2). Until then L3b ports 1.35's behaviour.

What 1.35 does (verified). `handleError` counts the attempt and stores a waiting entry (`errors.ts:436–472`). The entry is keyed by the resolver id (`pendingRetries.set(sourceId, …)`, `errors.ts:121`), so two requirements of one resolver share one entry and one attempt count, and a later failure replaces the earlier entry. The requirement itself sits only in the entry's `context`. The engine finds the entry by resolver id and gives it a callback that only schedules a pass (`engine.ts:1495–1506`). The id was never removed from `previousRequirements`, so when the poller finds the entry due, that pass sees no change, and calls stay at 1. A completed run of the resolver clears its count and its entry. A retracted requirement leaves its entry in place, and the entry comes due and runs its harmless pass.

| | 1.35 (what L3b builds unless (p) is approved) | 2.0 if (p) is approved |
|---|---|---|
| The waiting entry | Keyed by resolver id, with the last failing requirement in `context` | The same key, attempt count, delays and "exceeded max retry-later attempts" fallback. **New data:** the entry keeps the set of requirement ids that failed while it waited, and an entry that replaces it carries the set forward. |
| When it comes due | One pass, which changes nothing | The same pass. Before it runs, each recorded id that is still raised goes into the requeue set, so that pass applies it and one more pass re-dispatches it. That pass and its run are the divergence. |
| A retracted requirement | Its entry stays, comes due and runs its pass | Unchanged. The retracted id is simply not requeued; nothing new cancels. |
| A completed run of the resolver | Clears the count and the whole entry | Unchanged. So a completion of one requirement still drops the waiting retry of another requirement of the same resolver, as in 1.35. Keying by requirement would fix that, but it changes attempt counts and the 1,000-source cap, so it is not proposed. |
| Bound | – | retry-later's own `maxRetries` (default 3). No new cap. |
| Pinned by | The oracle "retry-later gives a failed resolver's requirement another pass after its delay, not before" counts passes, which both behaviours satisfy. L3b adds a core-next test that pins 1.35's "never runs again". | A core-next test. The diff scenarios 'error boundary: onResolverError "retry-later"' and "retry-later re-runs the resolver after its delay" show the difference, with a `divergences.json` entry with `approvedBy` empty. |

**Reading the table:** (p) needs one piece of data 1.35 does not keep, the requirement ids in the entry, and otherwise follows the (a) path exactly. If Jason declines, L3b ports 1.35's entry as it is, and both retry-later scenarios must match 1.35.

### Lifecycle, settle and whenReady

**In plain terms:** core-next already has `start`, `stop`, `destroy`, `stopAsync` and `settle`. What is missing is readiness, module hooks, the async destroy, the start-time options and the dev warning for a system nobody starts.

| # | 1.35 rule | 2.0 mechanism and seam | Pinned by |
|---|---|---|---|
| S1 | `isReady` turns true at the end of the first completed pass, and resolves the one shared `whenReady()` promise (`engine.ts:2201–2207`). `whenReady()` before `start()` rejects; after ready it resolves at once (`engine.ts:4379–4403`). | core-next's `isReady` returns `initialized` today (`api/core.ts:870–872`), which is wrong. It becomes a flag set where the pass emits `reconcile.end`, plus one lazily made promise. | `l3-engine-oracle` "readiness" (2) and "readiness and polling after the first pass"; `l3-system-oracle` "follow the lifecycle" (2); diff "whenReady, isReady and an async plugin onInit" |
| S2 | Module hooks: `onInit` after every module's `init` at creation (`engine.ts:4906–4909`); `onStart` in `start()` (`engine.ts:3347–3350`); `onStop` in `stop()` (`engine.ts:3480`); a module with only some hooks still stops and destroys. | Called from `createSystemCore`'s lifecycle, per module in registration order; the namespaced form passes its modules' hooks in, as it does `inits_`. | `engine` "Lifecycle" (3); `l3-engine-oracle-boundaries` (2); `l3-engine-oracle` "each transition happens once and is announced once" (4) |
| S3 | `stopAsync()` (RFC 0009): the same sequence as `stop`, awaiting source unsubscribes. `destroyAsync()` is `stopAsync()` followed by `destroy()`. Neither waits for in-flight runs and neither has a drain cap: `drainResolvers` and its 10 s cap are used only by `unregisterModule` (L10) (`engine.ts:3512–3600`, `resolvers.ts:2053–2095`). (Corrected in L3a, PR #280: an earlier draft said both drain.) | `destroyAsync` is added as `stopAsync` then `destroy`. No drain timer at L3; the drain arrives with `unregisterModule` at L10, on the kernel clock. Source unsubscribes (L5) plug into the same await later. | `system-async-lifecycle` (1); `l3-engine-oracle` "destroyAsync() stops, then announces the destroy"; diff "async stop and destroy wait for in-flight runs; evict" |
| S4 | Plugin `onInit` runs at creation, without being awaited, looping until no new plugin appears; a rejection is logged, never unhandled (`engine.ts:4893–4903`, `plugins.ts:~364`). | Already in `api/plugins.ts` `init`. Kept. | diff "whenReady, isReady and an async plugin onInit" |
| S5 | `initialFacts` apply at `start()` after the module inits and before the first pass. Namespaced form: skip, with a dev warning, an unknown namespace or a blocked name such as `__proto__`; refuse facts with prototype-pollution keys (`system.ts:388–460, 1086–1090, 1163–1175`). `hydrate()` loads facts before `start()` and is refused after it (`system.ts:504–515`). | An `applyInitial_` step inside `start()`, before `scheduleReconcile()`, written in one batch. `hydrate` stores the loaded facts for the same step. (Snapshot and restore stay L6.) | `system` "InitialFacts & Hydration" (2); `l3-system-oracle` "initialFacts in a namespaced system" (5); `engine` "initialFacts overrides module init values"; `ssr` (1); diff "SSR: hydrate before start…" |
| S6 | `createSystem()` with nothing, or with `null`, throws the library's own Error (not a `TypeError`). Schema keys starting with `$` are refused. A single-module system warns that `crossModuleDeps` are ignored. `isRunning`, `isSettled`, `isInitialized`, `isReady` and `trace` are enumerable, configurable accessors, and `meta` is an enumerable value. | Checks in `api/system.ts` and `api/validate.ts`. `trace` is the L9 feature slot's getter and `meta` the system's meta object, both defined at L3 so the surface matches (see "What the plan got wrong"). | `l3-system-oracle` (7); `engine` "Security" (1) |
| S7 | In development, a system created and never started warns once, on a host `setTimeout(0)`, unless `NODE_ENV` is `"test"` (`system.ts:1039–1056`). The check runs when the timer fires (`!isRunning && !isInitialized`), and nothing clears the timer, so a system created and destroyed without starting still warns (verified). | A kernel-clock timer of kind `"dev"`, behind the dev flag, with owner 0, so `kernel.dispose()` does not clear it and `destroy()` keeps 1.35's behaviour. Clearing it on `destroy()` is candidate (r). | `l3-system-oracle` "a system that is never started" (6); a core-next test of the destroyed-before-start case |
| S8 | `settle()` resolves once no run is in flight, no pass is running or scheduled, no batch is pending and no derivation change is unannounced (`engine.ts:4005–4017`, the same checks as `isSettled`, `engine.ts:4354–4362`). A waiting retry-later entry, its poller and the tick timer do not hold it. | Built at L2 (RFC row 13). L3 adds nothing to `busy_()`: the poller, the tick and the drain timer stay out of it. | L3b: a core-next test that `settle()` resolves while a retry-later entry waits; diff "settle waits for chained resolvers", "settle(maxWait) gives up…" |
| S9 | Restart: `start()` after `stop()` re-dispatches every requirement still wanted (quirk (j), fixed at L2). | Kept. L3 checks it again through `stopAsync()`. | core-next test from L2a |

**Reading the table:** S1 is the one rule core-next gets wrong today rather than lacks. Every timer in this group (drain, never-started warning) lands on the kernel clock with an owner and a kind, so a virtual clock shows them. `destroy()` clears all of them except the never-started warning, which 1.35 lets fire (S7). S8 is placed in L3b, because the retry-later entry it must ignore arrives there.

### Plugins and the one hook stream

**In plain terms:** core-next already turns kernel records into the 1.35 hooks (`api/plugins.ts`, the `HOOKS` table). What L3 adds is cost control, the `system.notify` channels, and the re-entrancy rules 1.35 has. The cost control must not change two things 1.35 does: when it reads a plugin's hook, and the order after a duplicate register.

| # | 1.35 rule | 2.0 mechanism and seam | Pinned by |
|---|---|---|---|
| P1 | Every hook is called on a snapshot of the plugin list (`plugins.ts:305`), and the hook is read from the plugin object at call time (`(plugin as any)[hook]?.(…)`, `plugins.ts:308`). So a hook added to a plugin object after `register` fires, and a deleted one stops. A throwing hook is logged and isolated (`safeCall`, `plugins.ts:254–272`). | Kept: core-next already snapshots (`plugins.slice()`, `api/plugins.ts:118`) and reads `plugin[hook]` at dispatch (`api/plugins.ts:123`). | diff "plugins run in order, and a throwing hook is isolated"; L3c: a core-next test that a hook added after `register` fires |
| P2 | Registering a duplicate name warns, unregisters the old plugin and pushes the new one (`plugins.ts:317–326`), so the replacement moves to the end of the call order. | Already ported (`api/plugins.ts:134–145`: `splice`, then `push`). Kept; P3 must not change the order. | L3c: a core-next test that a replaced plugin's hooks run last |
| P3 | **One hook stream.** The plan: integer hook ids and per-hook arrays. | Each hook name gets a fixed integer id, and a record kind maps to its id once. `live()` becomes `wants(id)`: true when a listener other than the plugins part is on the sink, or when some registered plugin has that hook now. The plugins part answers by reading `plugin[name]` across its list when the record is due: one property read per plugin, no allocation, and nothing at all with no plugins. Dispatch stays one walk of the snapshot in registration order. The plan's per-hook arrays, filled at `register`, are not used: they would freeze each plugin's hooks at register time, so a hook added later would never fire (P1), and keeping them in P2's order means rebuilding them on every replace. Records keep their string `at` on the wire, an open union. | `bench/system` with one plugin that has only `onError`: a fact write builds no record |
| P4 | `system.notify.guardrailBlocked` and `.guardrailCoverage` reach plugins only for a registered plugin's name; re-entry through the broadcast is capped at depth 4 (`engine.ts:528–531, 2823–2860`). | `notify` is defined by the plugins part and emits `guardrail.blocked` and `guardrail.coverage` records, mapped to `onGuardrailBlocked` and `onGuardrailCoverage`. | `notify-guardrail-blocked` (1); `l3-engine-oracle` "resolver keys and system.notify" (2); diff "notify: guardrail and clobber-loop channels reach plugins" |
| P5 | A plugin that opens a batch inside `onFactsBatch` neither releases its parent's derivation hold nor lets a listener see a value before every plugin has heard the batch. | Reasoned, to be confirmed against the three tests: the `fact.batch` record is delivered while the batch's hold is still up, and a nested batch from a hook re-enters the store's batch counter rather than opening a second hold. | `derivation-hold-reentrancy` (3) |
| P6 | The 46 hook names are a frozen contract; the call order is checked by the differential trace. | `HOOKS` gains the L3 names (`onGuardrailBlocked`, `onGuardrailCoverage`, `onFactDelete` if missing). Hooks for sources (L5), snapshots (L6), history (L8), trace (L9), definitions (L10) and clobber loops (L12) come with their layers. | the frozen contract in `contracts/` |

**Reading the table:** P3 saves the cost of building a record when a plugin is installed but does not listen to that kind. That case matters, because the plan's own L12 plugins (logging, performance) each want only a few hooks. The saving comes from asking at emit time rather than from arrays built at register time, so P1 and P2 hold without exceptions.

### Records: one versioned event and write-log record

**In plain terms:** the kernel already emits `{ t, seq, sys, at, … }` and serializes it with `v: 1` (`kernel.ts:48–58, 78–80`). L3 freezes that shape and adds the fields later layers will need, without changing what any host sees in the alphas.

| Field | Meaning | Added at L3 for |
|---|---|---|
| `t`, `seq`, `sys`, `at` | Clock time, order on the sink, emitting kernel, kind | existed |
| `by` | The writer stamp (L2b) on `fact.set` and `fact.batch` records; 0 is omitted | sync echo suppression, audit, replay |
| `origin` | Reserved: `local`, `remote` or `restore` | `applyRemote` (2.x), L6 restore |
| `code`, `phase`, `nodeId`, `cause` | On `error` records: a stable code, the phase (`constraint`, `effect`, `derivation`, `resolver`, `system`), the source id, the thrown value | errors as records at beta (decision 3.1) |
| `strategy` | On `error.recovery` records | existed in the hook arguments |

**Reading the table:** with these fields fixed now, the beta change to errors as records changes only where a `"throw"` goes (a rejected `settle()` or `whenReady()`), not the record. `by` costs nothing per write when nobody listens, because records are built only when `wants()` says so.

### Clock and timer

**In plain terms:** core-next's clock already stores its timers as data, `{ deadline, owner, kind, seq }` (`clock.ts:24–37`). L3 moves 1.35's last host timers onto it, gives it the one keep-alive switch 1.35 relies on, and fixes quirk (f).

| # | 1.35 rule | 2.0 mechanism and seam | Pinned by |
|---|---|---|---|
| C1 | `tickMs`: a zero or negative value throws at `createSystem` (`system.ts:245–248, 1081–1084`); in development, a warning when no module has a `tick` event (`system.ts:374–386, 1106–1112`); on `start()`, `setInterval` dispatches `tick` to the first module that has one, cleared on `stop()` (`system.ts:530–553`). The interval is not unref'd, so a ticking system holds a Node process open. | A repeating kernel-clock timer `{ kind: "tick", owner }`, armed in `start()` and cleared in `stop()`, with keep-alive left on (C5). It is data, so a Durable Object can map `nextDeadline()` to `storage.setAlarm`. Timers derived from fact changes, which the plan wants instead of `setInterval(TICK)`, are a 2.x feature. | `l3-system-oracle` "tickMs" (6); `system` "throws when tickMs is zero or negative" |
| C2 | Every system-owned timer clears on `destroy()`, except the never-started warning (S7). | `owner: kernel.owner` on the retry-later poller, tick and drain timers. `clock.clearOwner` runs in `kernel.dispose()`. The dev warning has owner 0 unless (r) is approved. | L3a to L3c core-next tests: no live owned timer after `destroy()` |
| C3 | **Quirk (f).** `completeTimer` sets `status: "completed"` (`timer.ts:190–192`), and `elapsedMs` freezes only while `status === "paused"` (`timer.ts:97`). So a timer completed while paused starts counting again. | `elapsedMs` freezes whenever `pausedAtMs !== null`, and `completeTimer` keeps `pausedAtMs`. That is exactly the mutant `mutation-triage/timer.json` records as "arguably correct". `api/timer.ts` is a copy of 1.35's file, so this is a one-line change. | A core-next test, a diff scenario, a `divergences.json` entry with `approvedBy` empty |
| C4 | Timer snapshots | The timer heap as a snapshot part (`snapshot.contribute("timers", …)`) is L6; L3 only guarantees that every timer has a `kind` and an `owner`, so the part can be written then. | – |
| C5 | **Keep-alive.** Of 1.35's host timers only the retry-later poller is unref'd (`engine.ts:599`). The tick interval (`system.ts:543`), the drain timeout (`resolvers.ts:2071`) and the never-started `setTimeout(0)` (`system.ts:1048`) are not. | `TimerOptions` gains `keepAlive?: boolean`, default true. The real clock calls `unref?.()` on the host handle when it is false; hosts without `unref` (browsers, Workers) are unaffected. The virtual clock ignores it, and it is not in `TimerRecord`, because it is a host concern, not state. Only the poller sets it to false. | L3b: a core-next test with an injected `setTimer` whose handle records `unref`: the poller's handle is unref'd, the tick's is not |

**Reading the table:** after L3 no file in core-next outside `clock.ts` calls a host timer, which the "one scheduler" check can grep for. Without C5, moving the poller onto the kernel clock would make a Node process with a waiting retry stay alive where 1.35's exits. Quirk (f) is the smallest change in this RFC, and it is the only one in a file the L0 gate already covers.

## Candidate (n): what changes if it is approved

**In plain terms:** in 1.35, when a resolver times out, its `context.signal` is not aborted (`resolvers.ts:1189–1191`; core-next copies this, `api/resolvers.ts:25–28`). So a `fetch` given that signal keeps running after the engine has given up on it. The L2 gate recommended fixing it at L3, and it waits on Jason (decision A3). No conformance test pins either behaviour: I searched for assertions on `signal.aborted` after a timeout and found none.

| # | What changes | Detail |
|---|---|---|
| 1 | The signal a resolver sees is per attempt | Each attempt gets a child controller of the run's controller (the A4 owner tree). A cancel, supersede or `stop()` aborts the run, which aborts the attempt. A timeout aborts only the attempt, with `signal.reason` set to the timeout error. |
| 2 | The outcome rule must read the run's signal | Today the completion path checks `signal.aborted` first to tell a cancel from an error. It must check the run's signal, or a timeout would be reported as a cancel. This is the main risk, and the reviewer's first question. |
| 3 | Retry after a timeout gets a fresh signal | 1.35 can retry after a timeout only because the signal stayed clean. With per-attempt signals the next attempt starts unaborted. |
| 4 | Late writes still land | Only a supersede drops writes (RFC L2 row 3). `finally { loading = false }` still lands after a timeout, and the diff scenario "a timeout aborts the run but keeps its cleanup write" still holds. |
| 5 | `shouldRetry` still sees `{ reason: "timeout" }` | Unchanged. |
| 6 | Async constraint timeouts | Unchanged: a constraint has no signal. |
| 7 | Batch timeouts (L7) | The same rule, applied when L7 is built. Noted in the L7 card. |
| 8 | Record-keeping | A core-next test, a diff scenario that shows `signal.aborted` true after a timeout on 2.0, and a `divergences.json` entry with `approvedBy` empty. |
| 9 | Size | About 60 B gzip. |

If Jason declines, nothing changes: core-next keeps the 1.35 behaviour and its comment.

**Reading the table:** rows 1 and 2 are the real work; the rest follow from them. A per-attempt signal is also what `ctx.step()` and `ctx.fork()` need later, so the change is a seam as well as a fix.

## Slice plan

**In plain terms:** three build slices, one gate slice, and a small oracle fix first. Each build slice is one PR at the committed `current: "L1"`, with tests run at a forced L3 locally, as L2 did. A candidate goes into its slice only once Jason has approved it; otherwise the slice builds 1.35's behaviour and pins it.

| Slice | Builds | Done means (checkable) | Tier |
|---|---|---|---|
| L3-pre (oracle) | Census placement for the 31 batch tests in `l7-batch-resolvers-oracle`: the `batch` option is built in a helper the detector does not see. | At forced L3, no test from `l7-batch-resolvers-oracle` runs on v2. `pnpm census`, `check:expects` and `oracle:update` exit 0. `oracle-change` label. | test oracle; Sonnet |
| L3a | Lifecycle and system options: S1 to S7, S9, C1, C2. (r) only if approved. | Every failing test in the Lifecycle (16), settle and whenReady (5), Clock and timer (7) and system-options (17) groups passes at forced L3 on v2 and v2:dist; the PR lists them by file and title. `isReady` follows the first pass. A system destroyed before `start()` still warns in development, unless (r) is approved. The ratchet at L1 exits 0. core-next `test`, `typecheck`, `build`, `size:check` (exact dev-string count) pass; sizes reported. | core; Opus implementer, Sonnet diff reviewer plus Fable correctness reviewer |
| L3b | The error boundary: E1 to E11, S8, quirk (a) with the bound Jason approves, C5, and (p) only if approved. | All 57 error-strategy tests pass at forced L3 on both projects. `"throw"` is pinned per source by core-next tests (E10): no source hook, no module hook, development-only `console.error` for a constraint and an effect, an unhandled rejection for a resolver, and 'error boundary: onResolverError "throw"' matches 1.35. Quirk (a) is pinned by a core-next test and shows only in the diff scenario 'error boundary: onResolverError "retry"', with 1.35's extra pass kept. Retry-later: with (p) approved, a core-next test and the two retry-later scenarios show it; without, a core-next test pins "never runs again" and both scenarios match 1.35. `settle()` resolves while a retry-later entry waits (S8). The poller's host handle is unref'd and the tick's is not (C5). One outcome per run still holds: the L2a mutation (drop the in-flight-slot check) still fails a test. A system with no `errorBoundary` takes today's path, and `floor` grows by no more than the seam. No host timer in core-next outside `clock.ts` (grep). | core; as L3a |
| L3c | The hook stream and records: P1 to P6, the record fields, quirk (f), the four lower-layer gaps. (n) and (q) only if approved. | The plugin-hook group (7) and the lower-layer group (4) pass, so **0 L3 failures** at forced L3 on v2 and v2:dist. `bench/system` with an `onError`-only plugin builds no `fact.set` record (a counter test), and scalar-writes does not regress more than 5 % against main. Core-next tests: a hook added after `register` fires (P1); a replaced plugin runs last (P2). Quirk (f) is pinned by a core-next test. | core; as L3a |
| L3-gate | `current` to L3, `ratchet --update`, diff and fuzz at L3, one `divergences.json` entry per fixed quirk, with `approvedBy` empty: (a) and (f), and (n), (p), (q), (r) only if approved. Size budgets set from measurements (GATE-1 decision 3.2), `/principal` on L3. | The census fails only on the unsigned entries. The PR fuzz and the nightly run v2 at L3. | test oracle; Sonnet plus the coordinator's read of each entry |

**Reading the table:** L3a goes first because 43 of the error tests also use module hooks and readiness, so building the boundary on a finished lifecycle avoids chasing failures whose cause is another slice. L3a needs nothing from L3b, so no merge or reorder is needed. I checked this against the forced-L3 failure list from the gap analysis, file by file: none of L3a's 45 tests sets a non-skip `errorBoundary`. The only `errorBoundary` options in L3a's files are the two zeroConfig tests (`l3-system-oracle.test.ts:967–972`) and the module-hook describe (`l3-engine-oracle-boundaries.test.ts:266–386`), and both are among L3b's 57. The lifecycle and readiness describes (`l3-engine-oracle.test.ts:149–298`) set none. The one readiness-area test that needs retry-later, "stop() and stopAsync() end retry-later polling at once" (`l3-engine-oracle.test.ts:1201`), is also counted in L3b's 57. L3c ends at zero failures, so the gate slice stays mechanical.

### Size

All figures in the first table are measured with `node scripts/size.mjs` on this branch (production, minified, gzip). The projection is reasoned.

| Fixture | 1.35 | core-next at L2 (measured) | Projected after L3 |
|---|---|---|---|
| `minimal` | 55,290 B | 22,093 B | ~23.8–24.6 KB |
| `two-module` | 55,381 B | 22,198 B | ~23.9–24.7 KB |
| `floor` | n/a | 9,013 B | ~9.0–9.1 KB (the `reportError` seam only) |
| full entry | n/a | 24,228 B | ~26–26.8 KB |

| Piece | 1.35 alone, min+gzip (measured) | Projected 2.0 |
|---|---|---|
| Error boundary (`errors.ts` plus its engine wiring) | 1,514 B for `errors.ts` alone | +0.9–1.2 KB |
| Lifecycle, `initialFacts`, `hydrate`, `tickMs`, warnings | spread over `engine.ts` and `system.ts` | +0.6–0.9 KB |
| Hook stream, `notify`, record fields | 1,035 B for `plugins.ts` alone | +0.1–0.3 KB |
| Quirk (f) and candidates (n), (p), (q), (r) | – | < 0.2 KB |

**In plain terms:** L3 adds roughly 1.7 to 2.5 KB to the minimal app, which lands at about 24 KB against 1.35's 55 KB. That is above the L2 RFC's projection of 21.5 to 23 KB for the alpha, because L2 alone already reached 22.1 KB. The budget itself is set from the L3-gate measurement, as GATE-1 decision 3.2 already says (list B).

## What the plan got wrong, or left out

- **The census places 31 L7 batch tests at L3.** `l7-batch-resolvers-oracle` builds its `batch` option in a helper, so the detector (`lib/layers.ts:106`, `resolvers.*.batch`) never sees it, and 21 tests are placed at L3. Another 10 have titles `layers.json` cannot match. All 31 fail at forced L3. L3-pre fixes this before any build slice.
- **Four `it.each` tests in `l3-system-oracle` use L9 members.** "enumerable, configurable accessors" includes `trace`, and "meta is an enumerable, configurable value" reads `meta`; both are L9 features by the detector's own mapping. Their titles are built at run time, so the census falls back to the file's rule. Defining the two members at L3 (S6) is a few bytes and keeps the system's shape fixed from the alpha on; the alternative is to place the tests at L9.
- **Four L0 and L4 gaps hide at L3.** The derivation cycle message ("Cycle detected" against 1.35's "Circular…"), an effect whose deps name a derivation, and a data-form `on` refusal are placed at L3 only because the test also installs a plugin. They are fixed in L3c, not deferred, since the L3 gate will run them.
- **`zeroConfig` turns on history in development** (`system.ts:933`), which is L8. At L3, `zeroConfig` sets only the error-boundary defaults. Its history default comes with L8, and the L3 tests check only errors.
- **"Timers derived from fact changes" is not an L3 deliverable.** The seam is: every timer is data with an owner and a kind. Replacing `tickMs` with derived timers is a 2.x feature, so `tickMs` keeps its 1.35 meaning on the kernel clock.
- **Retry-later is a poller, not a deadline.** The plan's "timers as data" suggests exact deadlines. 1.35 polls every 250 to 500 ms, and parity wins, so the alpha keeps the poll (list B).
- **"Per-hook arrays" would change when a hook is read.** 1.35 reads `plugin[hook]` at call time, so arrays filled at `register` would drop a hook added later. P3 gets the same saving by asking at emit time.
- **"Timers on the kernel clock" needs a keep-alive switch.** 1.35 unrefs its poller but not its tick; a clock without the switch would get one of the two wrong (C5).

## Decisions for the owner

### A. Candidate divergences: each needs Jason's yes or no

Each is built only if approved. A "no", or no answer yet, means the slice keeps 1.35's behaviour and pins it with a core-next test.

| # | Decision | What 1.35 does | What 2.0 would do | Recommendation |
|---|---|---|---|---|
| A1 | The bound in quirk (a) (part of defining an approved quirk) | No bound: under "retry" the resolver never runs again, so none is needed | At most 3 re-dispatches in a row per requirement, reset by a completed run or a retraction. Past the cap: still reported as "retry", a one-time dev warning, and 1.35's state (raised, run again only when raised anew). | Approve the cap of 3. It is the number 1.35 already uses for effects, and without a cap a resolver that always fails loops forever. |
| A2 | (p) `"retry-later"` re-dispatches the resolver | Reports "retry-later", polls, runs one pass when the entry is due, and never re-runs the resolver (verified) | When the entry is due, each recorded requirement still raised is requeued and re-run, bounded by `maxRetries`. The entry gains the requirement ids it is waiting for; key, counts and delays stay 1.35's. | Approve, in L3b. It is (a)'s defect under the other retry strategy, the fix rides the same requeue path, and `maxRetries` already bounds it. |
| A3 | (n) a timeout aborts the attempt's signal | `context.signal` stays clean after a timeout, so the work keeps running (`resolvers.ts:1189–1191`) | Per-attempt signals; a timeout aborts only the attempt (section "Candidate (n)") | Approve, in L3c. It stops work the engine has already given up on, and per-attempt signals are the seam `ctx.step()` needs. |
| A4 | (q) `startTimer` on a completed timer | Restarts it, though its doc comment says "No-op if already running, paused, or completed" (`timer.ts:118–137`). No conformance test pins either. | Returns the state unchanged, as the doc says | Approve, in L3c beside (f): same file, one line, and it makes the code match its own contract. |
| A5 | (r) `destroy()` cancels the never-started warning | Warns even after `destroy()` (verified; not under `NODE_ENV=test`) | The dev timer gets the kernel's owner, so `destroy()` clears it | Approve, in L3a. The warning is a false alarm once the system has been disposed on purpose. |
| A7 | (s) a second `start()` arms another tick | `start()` arms a new tick interval every call, even while running or after `destroy()`, and keeps only the newest handle, so ticks double and the older interval keeps firing after `stop()` (`system.ts:525–553`; found in L3a) | Only a `start()` that actually starts the system arms the tick; `stop()` and `destroy()` clear it | Approve. Copying it means writing a timer that nothing owns or clears, which the one-clock rule forbids. L3a builds the fix and pins it; if the answer is no, the L3 gate copies 1.35 before it merges. |
| A6 | The GATE-1 "found later" items that touch L3 | `tickMs: Infinity` and `NaN` accepted; `modules: null`, `5` or `true` not refused; blocked `initialFacts` keys refused at different times; a first-compute derivation error escapes `start()` | Each could be refused or contained | Keep 1.35 for all four in the alphas, and decide each at beta. Two are config validation, and the other two are about where errors go, which beta's errors-as-records changes anyway. |

### B. Engineering defaults that keep parity (no decision needed)

- **Quirk (a)'s mechanism:** 1.35's extra pass on "retry" (while the run is in flight) and its post-run pass are kept record for record; the re-dispatch adds one pass after them.
- **Retry-later key:** one entry and one attempt count per resolver id, as 1.35, with or without (p).
- **A retracted requirement** leaves its retry-later entry in place; the entry comes due and runs its pass, as in 1.35. Nothing new cancels it.
- **`"throw"`** keeps 1.35's surfaces exactly (E10), source by source.
- **Retry-later timing:** 1.35's poll (`min(max(delayMs, 250), 500)` ms) on the kernel clock. Exact deadlines are a beta candidate.
- **`settle()`** ignores a waiting retry-later entry, as 1.35 does (S8).
- **Keep-alive:** only the poller is unref'd (C5).
- **Hook stream:** hooks read at emit time and a replaced plugin moves last (P1 to P3).
- **Quirk (f)'s scope:** GATE-1 fixes "completed while paused". A timer completed while running also keeps counting elapsed time, though `remainingMs` stays 0; freezing it needs a new, persisted `completedAtMs` field. L3 keeps 1.35 for the running case, logged as candidate (o) for the L6 gate, where the fact's saved shape is decided.
- **Record fields:** the `v: 1` fields are additive and invisible to hosts in the alphas. They are reviewed again with beta's errors-as-records.
- **Size:** budgets are set from the L3-gate measurement (GATE-1 decision 3.2), after the plan's size-attribution step and before any budget is raised. The projection of about 24 KB for `minimal` is noted for information.
- **Routine, copied from 1.35:** the boundary plugs into `reportError` rather than wrapping each part; quirk (a) uses the L2b requeue set, not a second dispatch path; every L3 timer is on the kernel clock with an owner and a kind. Also the `DirectiveError` fields (`source`, `sourceId`, `context`, `recoverable`), the 100-entry error ring, the dev-warning texts, `system.isInitialized`, and the plugin `onInit` loop, which already exists.

## Evidence: 1.35 probes

Each probe is a short script run with Node against `packages/core/dist` (1.35), in development mode unless noted.

| Probe | Set-up | Observed |
|---|---|---|
| `"retry"`, resolver fails 3 times then succeeds | `onResolverError: "retry"`, 3 s wait | 1 call, never done. Plugin order: `onErrorRecovery("retry")`, then `onResolverError`. |
| `"retry-later"`, same resolver | `delayMs: 50`, `maxRetries: 5`, 3 s wait | 1 call, never done. |
| Pass sequence after the failure | plugin logging passes and the in-flight count | `"skip"`: one pass (in flight 0). `"retry"`: a pass with 1 in flight (`onRequirementCreated`, no start), then a pass with 0. `"retry-later"`: the post-run pass, then the due pass. An unrelated write: still 1 call. Retract and raise again: 2 calls. |
| `"throw"` per source | all four options `"throw"`, plugin with the three source hooks and `onErrorRecovery` | Constraint and effect: `onErrorRecovery("throw")` only, then `console.error("[Directive] Unexpected error in reconcile:")`; the write returns, `settle()` resolves. Resolver: `onErrorRecovery("throw")`, then an unhandled rejection of the `DirectiveError`. Derivation: `onErrorRecovery("throw")`, then the read throws. No source hook fires in any case. |
| Destroyed before start | `createSystem`, then `destroy()`, then 20 ms | Development: the never-started warning fires. `NODE_ENV=test`: nothing. |
