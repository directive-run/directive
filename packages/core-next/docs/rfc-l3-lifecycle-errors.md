# RFC: L3 lifecycle, error boundary and hook stream

Status: draft for review. No engine code merges from this document.
Tree: branch `p3/l3-rfc`, cut from `main` at `464c1b17` (core-next with L2a to L2d merged; `layers.rules.json` `current` is still `"L1"` on main).

## What we are building

L3 is the last layer of the alpha. It adds the parts of a system that sit around the reconcile engine: how a system starts, stops and reports that it is ready; what happens when a constraint, effect, derivation or resolver throws; and how plugins hear about all of it. After L3, `alpha.0` is L0 to L3 at full parity with the 1.35 API.

The rules are the ones L2 settled on. Parity with 1.35 is the rule, and when this document and 1.35 disagree, 1.35 wins. Every run ends in one outcome. There is one scheduler and one clock: no `setTimeout`, `setInterval`, `queueMicrotask`, `Date.now` or `Math.random` in new code. The dev-string count stays exact. The only behaviour that differs from 1.35 is a GATE-1 quirk fix, each with an unsigned `divergences.json` entry.

| If "approved" means | Then this gets built |
|---|---|
| The error boundary | A new part, `api/errors.ts`, plugged into the `reportError` seam every part already receives. `reportError` returns the strategy, and the caller acts on it. With no `errorBoundary` option the path is today's "skip". |
| Lifecycle | `isReady` and `whenReady()` driven by the first pass's end, module hooks, `destroyAsync()`, `initialFacts` and `hydrate()`, and `tickMs` on the kernel clock. |
| One hook stream | The plugin part keeps one array of plugins per hook, indexed by an integer hook id, so a record no plugin wants is never built. The 46 hook names stay as the public adapter. |
| Records | The kernel record shape is frozen at `v: 1`, with fields for errors (`code`, `phase`, `nodeId`, `cause`) and writes (`by`). Alphas still throw where 1.35 throws (GATE-1 decision 3.1). |
| Quirks | (a) the `"retry"` and `"retry-later"` strategies re-dispatch the resolver. (f) a timer completed while paused stops counting. (n) only if Jason approves it: a timeout aborts the attempt's signal. |

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

### Error boundary

**In plain terms:** 1.35's `errors.ts` decides a strategy for each error, and `engine.ts` acts on it in one place per source. core-next gets the same split: the boundary part decides, and the caller of `reportError` acts. No source gets a second error path.

| # | 1.35 rule | 2.0 mechanism and seam | Pinned by |
|---|---|---|---|
| E1 | Defaults: constraint, resolver, effect and derivation "skip"; system "throw" (`errors.ts:228–234`). `zeroConfig` sets the four to "skip" and an explicit `errorBoundary` wins (`system.ts:930–940`). | `api/errors.ts` `withErrorBoundary(config)`. It replaces the default `reportError` in the part context (`api/core.ts:565`); the default stays the floor's code. | `l3-errors-oracle` "which strategy a source gets" (4); `l3-system-oracle` "zeroConfig" (2) |
| E2 | A strategy is a string or a function `(error, id) => strategy \| void`. A function that returns nothing means "skip", and one that throws is logged and means "skip" (`errors.ts:371–414`). | Same function, ported. | "a handler function receives the thrown error and the id…", "a handler that throws is logged and the error is skipped" |
| E3 | Order: plugin `onError`, then `errorBoundary.onError`, then the strategy, then plugin `onErrorRecovery` with it; a throwing observer is logged and contained (`errors.ts:417–433, 475–506`). A non-Error is wrapped by its string form; a thrown `DirectiveError` passes through as the same object. | `reportError` emits the `error` record, calls the config callback, picks the strategy, emits `error.recovery`. Records stay the only path to plugins. | "what an observer is told" (4) |
| E4 | `"skip"`: swallow. In development, warn once per source when nothing handles it: no option for that source and no `onError` (`errors.ts:317–368`). | Today's warning, now gated on the config. The `warned` set and its 1,000-source cap move into the part. | "the development warning for an error nothing handles" (5) |
| E5 | `"disable"`: a constraint is disabled (`engine.ts:1262`); an effect is disabled (`engine.ts:1156`); a resolver disables the constraint that required it (`engine.ts:1485`). | `constraints.disable(id)` exists from L2. Effects gain `disable(id)` in `api/effects.ts`. Resolver errors pass `req.fromConstraint`. | "what each strategy does" (disable, 3); `l3-engine-oracle` "error boundary strategies" (3) |
| E6 | `"retry"`: a derivation is invalidated so the next read computes again (`engine.ts:1106`). An effect is run again in the next pass, at most 3 times in a row (`MAX_EFFECT_RETRIES`, `engine.ts:810, 1162–1172`); an ordinary change gives it its retries back. | Derivation: `graph` invalidate of that node. Effect: a rerun set in `api/effects.ts`, then `scheduleReconcile()`, through the scheduler. | "retry runs a failed effect again…", `l3-engine-oracle-effect-chain` (2), `blackbox-effects` (2) |
| E7 | `"retry"` on a resolver: **quirk (a)**, below. | Requeue. | below |
| E8 | `"retry-later"`: the attempt count per source, up to `maxRetries`; delay `delayMs × backoffMultiplier^(attempt−1)`, capped at `maxDelayMs` (defaults 1000, 3, 2, 30000); past the limit, "skip" with a dev warning; attempt counts kept for at most 1,000 sources (`errors.ts:66–151, 436–472`). A completed resolver clears its count and its waiting retry (`engine.ts:1463`). | Ported, with `clock.now()` for `Date.now()` (`errors.ts:117, 130`). | "retry-later" (4); "retry-later remembers attempts for a bounded number of sources" |
| E9 | Due retries are found by a poller: an interval of `min(max(delayMs, 250), 500)` ms, started on first use or when `retryLater` is configured, stopped when nothing waits and on `stop()` (`engine.ts:564–599`). A due constraint is marked dirty so it is asked again (`engine.ts:581–583`). | One repeating timer on the kernel clock, `{ owner: kernel.owner, kind: "retry-later" }`, re-armed only while something waits. Disposing the kernel clears it. It is data, so `nextDeadline()` sees it. | `superseded-bodies-and-retry-timer` K5; "stop() and stopAsync() end retry-later polling at once"; `constraint-reevaluation` "retry-later re-evaluates the constraint that threw" |
| E10 | `"throw"`: `handleError` throws the `DirectiveError` (`errors.ts:509–511`) from inside the pass (constraint, effect), the run (resolver) or the read (derivation). | Kept for the alphas (decision 3.1). The throw happens after the records are emitted, so the beta change is only where it goes. | "throw raises the DirectiveError to whoever read the derivation"; "throw stops the pass…" (2) |
| E11 | A module's `hooks.onResolverError` hears the error after the engine has handled it; a throwing hook is logged with the module's name (`engine.ts:1506–1525`). | The namespaced wrapper (`api/namespaced.ts`) calls the owning module's hook after `reportError` returns. | `l3-engine-oracle-boundaries` (2); "a module's onResolverError hook hears the error…" |

**Reading the table:** E1 to E4 decide, E5 to E10 act, and E11 is the module's side channel. The only new timer is the retry-later poller, and it moves from `setInterval` to the kernel clock. Its cadence stays 1.35's, so a due retry fires on the same poll tick as in 1.35.

### Quirk (a): the retry strategies re-dispatch the resolver

**In plain terms:** in 1.35, a resolver whose error strategy is "retry" or "retry-later" reports the strategy, but it never runs again until something else changes. 2.0 runs it again.

Why 1.35 never re-runs it. This is reasoned from the code; L3a confirms it with a trace on 1.35 before building.

- **"retry".** `recordError` calls `onError` from inside the run (`resolvers.ts:1296–1311`). The engine removes the id from `previousRequirements` and schedules a pass (`engine.ts:1489–1493`). That pass runs before the run's `.finally` frees its in-flight slot (`resolvers.ts:2026–2036`). So the requirement shows up as new, `resolve` sees the id still in flight and drops it as a duplicate, and nothing asks again.
- **"retry-later".** The waiting entry's callback only schedules a pass (`engine.ts:1495–1505`). The id was never removed from `previousRequirements`, so the diff sees no change.

| | 1.35 | 2.0 |
|---|---|---|
| Mechanism | `previousRequirements.remove` plus a pass, which races the in-flight slot | The run ends and frees its slot, and then the requirement id goes into the reconcile part's **requeue set** (L2b, RFC row 7). The requeue applies only once the run is out of flight, so it cannot be dropped as a duplicate. The follow-up pass re-dispatches it if the requirement is still wanted. |
| "retry" | Never runs again | A fresh run, under the resolver's own `retry` policy (attempts and backoff), after the run that failed has ended. At most 3 boundary retries in a row per requirement, as effects have; a completion resets the count. See question 2. |
| "retry-later" | Never runs again | When the poller finds the entry due, the id is requeued and re-dispatched if still wanted. A retracted requirement cancels its waiting entry. |
| Outcome count | One error | One error per run. The re-dispatch is a new run with its own outcome. |
| Pinned by | The oracle tolerates both: "retry is reported for a failed resolver, which runs again the next time its requirement is raised" asserts only `≥ 2` calls | A core-next test per strategy in `src/__tests__/`. The diff scenarios "error boundary: onResolverError \"retry\"", "…\"retry-later\"" and "retry-later re-runs the resolver after its delay" show the difference, and get a `divergences.json` entry with `approvedBy` empty. |

**Reading the table:** the fix reuses the requeue path L2b built for `requeue`, so there is no second dispatch path. The cap of 3 is my proposal and is question 2. Without a cap, a resolver that always fails under "retry" would loop for as long as the process runs.

### Lifecycle, settle and whenReady

**In plain terms:** core-next already has `start`, `stop`, `destroy`, `stopAsync` and `settle`. What is missing is readiness, module hooks, the async destroy, the start-time options and the dev warning for a system nobody starts.

| # | 1.35 rule | 2.0 mechanism and seam | Pinned by |
|---|---|---|---|
| S1 | `isReady` turns true at the end of the first completed pass, and resolves the one shared `whenReady()` promise (`engine.ts:2201–2207`). `whenReady()` before `start()` rejects; after ready it resolves at once (`engine.ts:4379–4403`). | core-next's `isReady` returns `initialized` today (`api/core.ts:870–872`), which is wrong. It becomes a flag set where the pass emits `reconcile.end`, plus one lazily made promise. | `l3-engine-oracle` "readiness" (2) and "readiness and polling after the first pass"; `l3-system-oracle` "follow the lifecycle" (2); diff "whenReady, isReady and an async plugin onInit" |
| S2 | Module hooks: `onInit` after every module's `init` at creation (`engine.ts:4906–4909`); `onStart` in `start()` (`engine.ts:3347–3350`); `onStop` in `stop()` (`engine.ts:3480`); a module with only some hooks still stops and destroys. | Called from `createSystemCore`'s lifecycle, per module in registration order; the namespaced form passes its modules' hooks in, as it does `inits_`. | `engine` "Lifecycle" (3); `l3-engine-oracle-boundaries` (2); `l3-engine-oracle` "each transition happens once and is announced once" (4) |
| S3 | `stopAsync()` and `destroyAsync()` (RFC 0009): the same sequence as `stop` and `destroy`, awaiting in-flight runs, with a 10 s drain cap that names the runs that ignore their signal (`engine.ts:3512–3600`, `resolvers.ts:2053–2095`). | `destroyAsync` is added. The drain waits on the run table that `settle` already reads (`busy_()`), with its timeout as a kernel-clock timer of kind `"drain"`. Source unsubscribes (L5) plug into the same await later. | `system-async-lifecycle` (1); `l3-engine-oracle` "destroyAsync() stops, then announces the destroy"; diff "async stop and destroy wait for in-flight runs; evict" |
| S4 | Plugin `onInit` runs at creation, without being awaited, looping until no new plugin appears; a rejection is logged, never unhandled (`engine.ts:4893–4903`, `plugins.ts:~364`). | Already in `api/plugins.ts` `init`. Kept. | diff "whenReady, isReady and an async plugin onInit" |
| S5 | `initialFacts` apply at `start()` after the module inits and before the first pass. Namespaced form: skip, with a dev warning, an unknown namespace or a blocked name such as `__proto__`; refuse facts with prototype-pollution keys (`system.ts:388–460, 1086–1090, 1163–1175`). `hydrate()` loads facts before `start()` and is refused after it (`system.ts:504–515`). | An `applyInitial_` step inside `start()`, before `scheduleReconcile()`, written in one batch. `hydrate` stores the loaded facts for the same step. (Snapshot and restore stay L6.) | `system` "InitialFacts & Hydration" (2); `l3-system-oracle` "initialFacts in a namespaced system" (5); `engine` "initialFacts overrides module init values"; `ssr` (1); diff "SSR: hydrate before start…" |
| S6 | `createSystem()` with nothing, or with `null`, throws the library's own Error (not a `TypeError`). Schema keys starting with `$` are refused. A single-module system warns that `crossModuleDeps` are ignored. `isRunning`, `isSettled`, `isInitialized`, `isReady` and `trace` are enumerable, configurable accessors, and `meta` is an enumerable value. | Checks in `api/system.ts` and `api/validate.ts`. `trace` is the L9 feature slot's getter and `meta` the system's meta object, both defined at L3 so the surface matches (see "What the plan got wrong"). | `l3-system-oracle` (7); `engine` "Security" (1) |
| S7 | In development, a system created and never started warns once, on a host `setTimeout(0)`, unless `NODE_ENV` is `"test"` (`system.ts:1039–1056`). | A kernel-clock timer of kind `"dev"`, owned by the system, behind the dev flag. A virtual clock never fires it unless advanced, which is right for tests. | `l3-system-oracle` "a system that is never started" (6) |
| S8 | `settle()` waits for runs, polls and timers it owns; its timeout names what is still busy. | Built at L2 (RFC row 13). L3 adds the retry-later poller and the drain to `busy_()` only where 1.35's `settle` waits on them. | diff "settle waits for chained resolvers", "settle(maxWait) gives up…" |
| S9 | Restart: `start()` after `stop()` re-dispatches every requirement still wanted (quirk (j), fixed at L2). | Kept. L3 checks it again through `stopAsync()`. | core-next test from L2a |

**Reading the table:** S1 is the one rule core-next gets wrong today rather than lacks. Every timer in this group (drain, never-started warning) lands on the kernel clock with an owner and a kind. So `destroy()` clears them, and a virtual clock shows them.

### Plugins and the one hook stream

**In plain terms:** core-next already turns kernel records into the 1.35 hooks (`api/plugins.ts`, the `HOOKS` table). What L3 adds is cost control, the `system.notify` channels, and the re-entrancy rules 1.35 has.

| # | 1.35 rule | 2.0 mechanism and seam | Pinned by |
|---|---|---|---|
| P1 | Every hook is called on a snapshot of the plugin list, so a plugin that unregisters mid-broadcast cannot make the next one miss it; a throwing hook is logged and isolated (`plugins.ts:296–313`). | Kept (`plugins.slice()` today). | diff "plugins run in order, and a throwing hook is isolated" |
| P2 | Registering a duplicate name warns and replaces (`plugins.ts:317–325`). | Ported. | No failing test today; ported for parity, with a core-next test |
| P3 | **One hook stream.** The plan: integer hook ids and per-hook arrays. | Each hook name gets a fixed integer id. The part keeps `byHook: Plugin[][]`, filled at register and unregister. A record kind maps to its id once. `live()` becomes `wants(id)`: an emitter skips building a record when no plugin has that hook and no observer listens. Records keep their string `at` on the wire, an open union. | `bench/system` with one plugin that has only `onError`: a fact write builds no record |
| P4 | `system.notify.guardrailBlocked` and `.guardrailCoverage` reach plugins only for a registered plugin's name; re-entry through the broadcast is capped at depth 4 (`engine.ts:528–531, 2823–2860`). | `notify` is defined by the plugins part and emits `guardrail.blocked` and `guardrail.coverage` records, mapped to `onGuardrailBlocked` and `onGuardrailCoverage`. | `notify-guardrail-blocked` (1); `l3-engine-oracle` "resolver keys and system.notify" (2); diff "notify: guardrail and clobber-loop channels reach plugins" |
| P5 | A plugin that opens a batch inside `onFactsBatch` neither releases its parent's derivation hold nor lets a listener see a value before every plugin has heard the batch. | Reasoned, to be confirmed against the three tests: the `fact.batch` record is delivered while the batch's hold is still up, and a nested batch from a hook re-enters the store's batch counter rather than opening a second hold. | `derivation-hold-reentrancy` (3) |
| P6 | The 46 hook names are a frozen contract; the call order is checked by the differential trace. | `HOOKS` gains the L3 names (`onGuardrailBlocked`, `onGuardrailCoverage`, `onFactDelete` if missing). Hooks for sources (L5), snapshots (L6), history (L8), trace (L9), definitions (L10) and clobber loops (L12) come with their layers. | the frozen contract in `contracts/` |

**Reading the table:** P3 is the plan's "int hook ids, per-hook arrays". It saves the cost of building a record when a plugin is installed but does not listen to that kind. That case matters, because the plan's own L12 plugins (logging, performance) each want only a few hooks.

### Records: one versioned event and write-log record

**In plain terms:** the kernel already emits `{ t, seq, sys, at, … }` and serializes it with `v: 1` (`kernel.ts:48–58, 78–80`). L3 freezes that shape and adds the fields later layers will need, without changing what any host sees in the alphas.

| Field | Meaning | Added at L3 for |
|---|---|---|
| `t`, `seq`, `sys`, `at` | Clock time, order on the sink, emitting kernel, kind | existed |
| `by` | The writer stamp (L2b) on `fact.set` and `fact.batch` records; 0 is omitted | sync echo suppression, audit, replay |
| `origin` | Reserved: `local`, `remote` or `restore` | `applyRemote` (2.x), L6 restore |
| `code`, `phase`, `nodeId`, `cause` | On `error` records: a stable code, the phase (`constraint`, `effect`, `derivation`, `resolver`, `system`), the source id, the thrown value | errors as records at beta (decision 3.1) |
| `strategy` | On `error.recovery` records | existed in the hook arguments |

**Reading the table:** with these fields fixed now, the beta change to errors as records changes only where a `"throw"` goes (a rejected `settle()` or `whenReady()`), not the record. `by` costs nothing per write when nobody listens, because records are built only when `live()` says so.

### Clock and timer

**In plain terms:** core-next's clock already stores its timers as data, `{ deadline, owner, kind, seq }` (`clock.ts:24–37`). L3 moves 1.35's last host timers onto it and fixes quirk (f).

| # | 1.35 rule | 2.0 mechanism and seam | Pinned by |
|---|---|---|---|
| C1 | `tickMs`: a zero or negative value throws at `createSystem` (`system.ts:245–248, 1081–1084`); in development, a warning when no module has a `tick` event (`system.ts:374–386, 1106–1112`); on `start()`, `setInterval` dispatches `tick` to the first module that has one, cleared on `stop()` (`system.ts:530–553`). | A repeating kernel-clock timer `{ kind: "tick", owner }`, armed in `start()` and cleared in `stop()`. It is data, so a Durable Object can map `nextDeadline()` to `storage.setAlarm`. Timers derived from fact changes, which the plan wants instead of `setInterval(TICK)`, are a 2.x feature. | `l3-system-oracle` "tickMs" (6); `system` "throws when tickMs is zero or negative" |
| C2 | Every system-owned timer clears on `destroy()`. | `owner: kernel.owner` on every L3 timer (retry-later, tick, drain, dev). `clock.clearOwner` runs in `kernel.dispose()`. | L3a to L3c core-next tests: no live timer after `destroy()` |
| C3 | **Quirk (f).** `completeTimer` sets `status: "completed"` (`timer.ts:190–192`), and `elapsedMs` freezes only while `status === "paused"` (`timer.ts:97`). So a timer completed while paused starts counting again. | `elapsedMs` freezes whenever `pausedAtMs !== null`, and `completeTimer` keeps `pausedAtMs`. That is exactly the mutant `mutation-triage/timer.json` records as "arguably correct". `api/timer.ts` is a copy of 1.35's file, so this is a one-line change. | A core-next test, a diff scenario, a `divergences.json` entry with `approvedBy` empty |
| C4 | Timer snapshots | The timer heap as a snapshot part (`snapshot.contribute("timers", …)`) is L6; L3 only guarantees that every timer has a `kind` and an `owner`, so the part can be written then. | – |

**Reading the table:** after L3 no file in core-next calls a host timer, which the "one scheduler" check can grep for. Quirk (f) is the smallest change in this RFC, and it is the only one in a file the L0 gate already covers.

## Quirk (n): what changes if it is approved

**In plain terms:** in 1.35, when a resolver times out, its `context.signal` is not aborted (`resolvers.ts:1189–1191`; core-next copies this, `api/resolvers.ts:25–28`). So a `fetch` given that signal keeps running after the engine has given up on it. The L2 gate recommended fixing it at L3, and it waits on Jason. No conformance test pins either behaviour: I searched for assertions on `signal.aborted` after a timeout and found none.

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

**In plain terms:** three build slices, one gate slice, and a small oracle fix first. Each build slice is one PR at the committed `current: "L1"`, with tests run at a forced L3 locally, as L2 did.

| Slice | Builds | Done means (checkable) | Tier |
|---|---|---|---|
| L3-pre (oracle) | Census placement for the 31 batch tests in `l7-batch-resolvers-oracle`: the `batch` option is built in a helper the detector does not see. | At forced L3, no test from `l7-batch-resolvers-oracle` runs on v2. `pnpm census`, `check:expects` and `oracle:update` exit 0. `oracle-change` label. | test oracle; Sonnet |
| L3a | Lifecycle and system options: S1 to S7, C1, C2. | Every failing test in the Lifecycle (16), settle and whenReady (5), Clock and timer (7) and system-options (17) groups passes at forced L3 on v2 and v2:dist; the PR lists them by file and title. `isReady` follows the first pass. No host timer in core-next (grep). The ratchet at L1 exits 0. core-next `test`, `typecheck`, `build`, `size:check` (exact dev-string count) pass; sizes reported. | core; Opus implementer, Sonnet diff reviewer plus Fable correctness reviewer |
| L3b | The error boundary: E1 to E11 and quirk (a). | All 57 error-strategy tests pass at forced L3 on both projects. Quirk (a) is pinned by two core-next tests (retry, retry-later) and shows only in the three diff scenarios named above. One outcome per run still holds: the L2a mutation (drop the in-flight-slot check) still fails a test. A system with no `errorBoundary` takes today's path, and `floor` grows by no more than the seam. | core; as L3a |
| L3c | The hook stream and records: P2 to P6, the record fields, quirk (f), quirk (n) if approved, and the four lower-layer gaps. | The plugin-hook group (7) and the lower-layer group (4) pass, so **0 L3 failures** at forced L3 on v2 and v2:dist. `bench/system` with an `onError`-only plugin builds no `fact.set` record (a counter test), and scalar-writes does not regress more than 5 % against main. Quirk (f) is pinned by a core-next test. | core; as L3a |
| L3-gate | `current` to L3, `ratchet --update`, diff and fuzz at L3, one `divergences.json` entry per fixed quirk (a, f, and n if approved) with `approvedBy` empty, size budgets set from measurements (GATE-1 decision 3.2), `/principal` on L3. | The census fails only on the unsigned entries. The PR fuzz and the nightly run v2 at L3. | test oracle; Sonnet plus the coordinator's read of each entry |

**Reading the table:** L3a goes first because 43 of the error tests also use module hooks and readiness, so building the boundary on a finished lifecycle avoids chasing failures whose cause is another slice. L3c ends at zero failures, so the gate slice stays mechanical.

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
| Quirks (f) and (n) | – | < 0.1 KB |

**In plain terms:** L3 adds roughly 1.7 to 2.5 KB to the minimal app, which lands at about 24 KB against 1.35's 55 KB. That is above the L2 RFC's projection of 21.5 to 23 KB for the alpha, because L2 alone already reached 22.1 KB. Question 5 asks whether that is acceptable before the budgets are set.

## What the plan got wrong, or left out

- **The census places 31 L7 batch tests at L3.** `l7-batch-resolvers-oracle` builds its `batch` option in a helper, so the detector (`lib/layers.ts:106`, `resolvers.*.batch`) never sees it, and 21 tests are placed at L3. Another 10 have titles `layers.json` cannot match. All 31 fail at forced L3. L3-pre fixes this before any build slice.
- **Four `it.each` tests in `l3-system-oracle` use L9 members.** "enumerable, configurable accessors" includes `trace`, and "meta is an enumerable, configurable value" reads `meta`; both are L9 features by the detector's own mapping. Their titles are built at run time, so the census falls back to the file's rule. Defining the two members at L3 (S6) is a few bytes and keeps the system's shape fixed from the alpha on; the alternative is to place the tests at L9.
- **Four L0 and L4 gaps hide at L3.** The derivation cycle message ("Cycle detected" against 1.35's "Circular…"), an effect whose deps name a derivation, and a data-form `on` refusal are placed at L3 only because the test also installs a plugin. They are fixed in L3c, not deferred, since the L3 gate will run them.
- **`zeroConfig` turns on history in development** (`system.ts:933`), which is L8. At L3, `zeroConfig` sets only the error-boundary defaults. Its history default comes with L8, and the L3 tests check only errors.
- **"Timers derived from fact changes" is not an L3 deliverable.** The seam is: every timer is data with an owner and a kind. Replacing `tickMs` with derived timers is a 2.x feature, so `tickMs` keeps its 1.35 meaning on the kernel clock.
- **Retry-later is a poller, not a deadline.** The plan's "timers as data" suggests exact deadlines. 1.35 polls every 250 to 500 ms, and parity wins, so the alpha keeps the poll (question 3).

## Open questions for Jason

1. **Quirk (n).** Should a timeout abort the attempt's signal, with per-attempt signals, as set out above? My recommendation: yes, in L3c, with a divergence entry. It stops work the engine has already given up on, and per-attempt signals are the seam `ctx.step()` needs.
2. **The bound on quirk (a)'s "retry".** GATE-1 says "re-dispatched under its retry policy". I propose: each re-dispatch is a fresh run that uses the resolver's own `retry` policy, with at most 3 boundary retries in a row per requirement, reset on completion. That is the cap 1.35 already gives effects. My recommendation: approve the cap of 3. Without one, a resolver that always fails loops forever.
3. **Retry-later timing.** Keep 1.35's poll cadence in the alphas (parity), or fire each retry at its exact deadline? My recommendation: keep the poll for the alphas, and list exact deadlines as a beta candidate. The poll is one kernel-clock timer, so it is still data.
4. **Quirk (f)'s scope.** GATE-1 fixes "completed while paused". A timer completed while running also keeps counting elapsed time, though `remainingMs` stays 0. Freezing that case needs a new `completedAtMs` field in the timer fact, which is persisted. My recommendation: fix only the paused case now, and log the running case as candidate quirk (o) for the L6 gate, where the fact's saved shape is decided.
5. **Size.** The alpha's `minimal` app is projected at about 24 KB gzip, against the L2 RFC's 21.5 to 23 KB. Is that acceptable, with the budget set from the L3-gate measurement (GATE-1 decision 3.2)? My recommendation: yes, after the size-attribution step the plan prescribes, and before raising any budget.
6. **The "found later" items that touch L3.** GATE-1 logged these: `tickMs: Infinity` and `NaN` accepted; `modules: null`, `5` or `true` not refused; a first-compute derivation error escapes `start()`; `startTimer` restarts a completed timer. My recommendation: L3 copies 1.35 for all four (the oracle pins today's behaviour or nothing), and each becomes a candidate divergence at beta. Except `startTimer`, which I would fix with (f), because its own doc comment says "no-op".
7. **Freezing the record shape now.** Do you approve the `v: 1` fields in "Records" as the shape beta's errors-as-records and the 2.x write log will read? My recommendation: yes. Adding fields later is cheap, but renaming them after the alphas is not.

## Decisions made here (reversible)

- The boundary plugs into `reportError` rather than wrapping each part. Every part already receives it, so the boundary is one part and nothing else changes.
- Quirk (a) uses the L2b requeue set, not a second dispatch path.
- Every L3 timer is on the kernel clock with an owner and a kind: retry-later, tick, drain and the never-started warning.

Routine, no design needed: the `DirectiveError` fields (`source`, `sourceId`, `context`, `recoverable`), the 100-entry error ring, the dev-warning texts (copied), `system.isInitialized`, and the plugin `onInit` loop, which already exists.
