# RFC: L7 batch resolvers

Status: draft for review, revision 2 (after the design review). No engine or oracle code merges from this document.
Tree: branch `p7/l7-rfc`, cut from `main` at `66628c60` (L0 to L6 built; `layers.rules.json` `current` is `"L6"`). Nothing in `packages/conformance` or `packages/core-next/src` is changed by this PR.

**Changes since revision 1.** The design review found two blockers and a set of wrong labels. All are fixed in place. Nothing else moved: the recommendations on the candidates stand.

1. **Unsigned entries cannot land.** Revision 1 said L7b would write the `divergences.json` entries for quirks g, h, i and k with `approvedBy` empty, and that the gate's census "fails only on unsigned entries". Both rules say no. GATE-2 rules 1 and 2 (`contracts/GATE-2.md:53–64`) let an engine PR touch `divergences.json` only if every entry it adds is signed, and the census fails an unsigned entry (`packages/conformance/README.md:210–211`). Now L7a and L7b sign their entries "on the owner's instruction", for approved rows only, once Jason approves this RFC. Declined rows get no entry; their 1.35 behaviour is pinned. The gate's done-means is "census exits 0".
2. **(as) and (at) move all three existing L7 diff scenarios, not only U7 and U8.** The `settle` op records `checkpoint("settle")` after `settle()` resolves (`diff/scenario.ts:495–497`). On 1.35 that is at 0 ms, so batch outcomes land after the checkpoint. With (as) they land before it. A new table under "Gap analysis" lists the three scenarios, and L7a's done-means no longer says they "match 1.35" without the exception: they match, or differ only by a signed entry.
3. **(as) keeps "better" and now states its risk.** The docs already promise what (as) delivers (`knowledge/core/core-patterns.md:132`, `knowledge/core/anti-patterns.md:257`). The risk: a user's fake-timer test that awaits `settle()` while a batch waits on its window, a backoff or a timeout now waits until the timers advance, and can deadlock. The harness is immune, because `drive` advances timers (`diff/scenario.ts:458`). `settle()` also rejects at 5 s for a slow batch with no `timeoutMs` (`engine.ts:4005`).
4. **(ap) is relabeled "better / test-rule".** The docs say "Collect requirements for 50ms" (`knowledge/core/resolvers.md:150`), but the code resets the timer on every add (`resolvers.ts:1899`). The debounce is undocumented. The visible effect is now stated.
5. **Quirk g gets its fuller account.** 1.35 declares the whole-batch abort intended (`resolvers.ts:2131–2136`). "Never run again" is its general rule for a canceled requirement that is still wanted, the same as row j (reproduced: `unmetAfter: [a, c]`). The direction is unchanged, so no new decision is needed. "Worse than its row" is gone, and "drops its result" now reads "drops its outcome report".
6. **The size estimate says what it rests on**: the 2,012 B fragment, L6's 0.78 ratio, and reuse. It gives L6's calibration, and L7a reports the part's bytes and the seam's bytes separately.
7. **The oracle section names the two vacuous tests** and makes L7-pre's pins bite on each. It adds pins for `requeue()` in a batch, the batch signal's abort reason, the 10,000 cap and the attempt a batch reports. The batched fuzz resolver moves from the gate into L7-pre.
8. **The types and the code disagree on `windowMs` and `maxSize`.** The types say `windowMs` is required and `maxSize` is "unlimited". The code defaults the first to 50 and caps the second at 10,000. Both are now stated (W1, W3).
9. **One correction the review did not ask for.** Revision 1 said "`ctx.attempt` is the batch's attempt". 1.35's `ResolverContext` has no `attempt` field (`types/resolvers.ts:179–183`), so that is a 2.0 seam, not an L7 parity item. The pin is the attempt number a batch passes to `onRetry` and `shouldRetry` (U16).

## What we are building

L7 makes a resolver collect requirements for a short window and handle them in one call.

The plan's row reads "Batch resolvers | batch-resolve-fallback, batched-resolver-retracting-own-requirement | +0.6 | opt-in". The alphas keep the 1.35 API, so L7 must run 1.35's `batch: { enabled, windowMs, maxSize, timeoutMs }` option unchanged, with `resolveBatch` (all or nothing), `resolveBatchWithResults` (one result per item), and the fallback to `resolve()` one at a time. The rules are the ones L2 to L6 settled on. Parity with 1.35 is the rule, and when this document and 1.35 disagree, 1.35 wins. Every layer slice runs `conformance:diff` at the forced layer.

**Part of the row is already built.** core-next carried these over at L2 and L3, and L7 reuses them.

| Plan item | State in core-next | Where |
|---|---|---|
| The `batch` option and the handler types | Built: 1.35's public types, copied | `src/types/resolvers.ts:149–158` (`BatchConfig`) |
| Definition checks: a resolver with no handler throws; `batch.enabled` with only `resolve()` warns | Built, development only, 1.35's three strings | `api/resolvers.ts:218–238` |
| A namespaced module's `resolveBatch` and `resolveBatchWithResults` get the module's own facts | Built: both are wrapped like `resolve` | `api/namespaced.ts:614–627` |
| One run's machinery: retry, backoff, jitter, timeout, abort, binding, the one-outcome mark, supersede | Built for single runs | `api/resolvers.ts` (the header, lines 1–62) |
| The window, `maxSize`, flush on `settle()`, the two handlers, the fallback, abort by requirement, stop and destroy | **Not built.** A batched requirement is dropped and waits unmet | `api/resolvers.ts:575–579` |
| Binding for a batch (quirk k) | **Not built** | `api/resolvers.ts:63` |

**Reading the table:** the types, the checks and the namespaced wrapping are done. The batch itself is not. Today core-next drops a batched requirement at dispatch, so a program with a batched resolver never resolves it.

**What may differ from 1.35.** Two kinds of difference are on the table.

- **Already approved.** GATE-1, Decision 2, approved fixing four batch quirks at L7: g, h, i and k (`packages/conformance/contracts/GATE-1.md:42–56`). No `divergences.json` entry exists for any of them yet. L7a and L7b write them and sign them "on the owner's instruction", the wording of GATE-2 rule 1, once Jason approves this RFC. An engine PR may add an entry only if it is signed (GATE-2 rule 2), and the census fails an unsigned one (`packages/conformance/README.md:210–211`).
- **New candidates.** Five, lettered after (ao): (ap) to (at). Each is built only if Jason approves it. When he approves one, its entry is signed the same way. Until he does, or if he declines, the slice keeps 1.35's behaviour, pins it, and writes no entry.

**In plain terms:** L7 is one new part, the batch window, on top of run machinery that already exists. The probes found that 1.35's batching has four problems a user would notice and that no row covers yet. `await system.settle()` returns while a batch is still running, though the docs say it waits. A steady trickle of requirements never flushes, though the docs say "collect for 50ms". A fallback batch cannot be canceled or stopped. And quirk g's cancel has a second half: the still-wanted requirements it cancels are never run again, which is 1.35's general rule for a canceled requirement that is still wanted. The size is the hard part. "Opt-in" cannot hold for bytes while 1.35's option works with no import, so every `createSystem` build pays an estimated 0.6 to 1.1 KB. `minimal` has 117 B of room under its ceiling, so the budget is an owner decision (A1).

## Gap analysis, measured

Every L7 failure is a missing piece: core-next never runs a batch.

What I ran: `layers.rules.json` `current` set to `"L7"` in the working copy only. Then, from `packages/conformance`, `npx vitest run --project conformance:v2 --project conformance:v2:prod`, then `--project conformance:v2:dist`, then `--project conformance:diff`, each with the JSON reporter. Then `git checkout -- layers.rules.json`; `current` read `"L6"` again and `git status` was clean for the package. core and core-next were built first (`pnpm --filter … build`, both exit 0).

| Run | Tests | Pass | Fail | Skipped |
|---|---|---|---|---|
| `conformance:v2` and `conformance:v2:prod`, together, at forced L7 | 3,273 | 1,594 | 52 | 1,627 |
| `conformance:v2:dist` at forced L7 | 3,198 | 1,527 | 52 | 1,619 |
| `conformance:diff` at forced L7 | 309 | 306 | 3 | 0 |

**Reading the table:** the same 52 tests fail on the source and on the built `dist`, all in development-project files. No production-only file fails. The diff harness fails exactly the three L7 scenarios.

| File | Failing | Representative tests |
|---|---|---|
| `l7-batch-resolvers-oracle` | 35 | "the batch window › windowMs holds requirements back until it has passed"; "resolveBatchWithResults reports each item on its own › errors only the item that failed, with its own error"; "a batch that never settles times out" (4 cases); "stopping or destroying a system ends batched work" (6 cases); "abortOn on a batched resolver › rejects the batch's later writes to an abortOn fact that changed meanwhile" |
| `reconcile-timing-rules` | 8 | "a resolver whose own write retracts its requirement completes, never canceled (wait 0, 1, 3 and 10 microtasks, batched)", each with and without a derivation |
| `batch-resolve-fallback` | 4 | "resolves requirements individually when batch.enabled but no resolveBatch"; "flushes batch immediately when maxSize is reached"; "settle() flushes pending batches instead of hanging"; "handles errors in batched resolve() fallback without crashing" |
| `l3-proxies-oracle-gates` | 2 | "batch resolvers in a composed system › resolveBatch writes through the module's own facts", and the same for `resolveBatchWithResults` |
| `batched-resolver-retracting-own-requirement` | 1 | "a batched resolver whose own write retracts its requirement is not canceled" |
| `resolver-outcomes` | 1 | "a batch that satisfied its requirement is superseded when it returns" |
| `resolver-satisfied-by-own-write` | 1 | "attribution is per run › one batch's write does not shield another batch of the same definition" |
| **Total** | **52** | |

**Reading the table:** two thirds of the gap is one file, the L7 oracle. The rest are batch cases in files that mostly test single runs. `layers.json` places 52 tests at L7 by name; the run counts 52 failures because some names expand into several cases (the oracle's 30 names run as 35 cases) while other placed tests pass.

**The brief's count was 56; `main` places 52.** `layers.json` lists 30 L7 tests in the oracle (not 31), 6 in `batch-resolve-fallback` (not 7), 1 in `batched-resolver-retracting-own-requirement` (not 2), and none in `batched-read-your-write`: its 3 tests are placed at L2 and L4 and pass. The 6 L7 tests in `resolvers.test.ts` are internals, which v2 skips by category (`helpers/layer-gate.ts`), so they are not in the run.

**Two placed tests pass without any batch code, and a third passes for a real reason.** The first two are vacuous. They pass because the handler never runs on v2, and they could not fail for the reason they are named for.

- `batch-resolve-fallback` "batch + cancel stops batched resolvers when system is stopped during batch window" (`tests/core/batch-resolve-fallback.test.ts:194–253`) asserts only that `resolvedIds.length` is 0 (line 253). A system that never runs a batch satisfies it.
- `resolver-loading-flag` "a satisfied batch that times out: the finally lands (L10)" (`tests/core/resolver-loading-flag.test.ts:116–138`) asserts only that `loading` is false at the end (line 135). `loading` starts false, so a test that never sees it true passes.
- `batch-resolve-fallback` "emits dev warning when batch.enabled without resolveBatch" passes for a real reason: the warning is built.

L7-pre's pins make each one bite (U12): the stopped test gets a control run where the handler must run, and the loading test must see `loading` true while the handler runs and false after its `finally`.

| Failing diff scenario | Why |
|---|---|
| "a batch window collects requirements into one resolveBatch" | The handler never runs on v2 |
| "batch enabled with only resolve() falls back to one call each" | The same |
| "a failing batch retries and reports per batch" | The same |

**Reading the table:** each scenario adds its requirements in one pass, so none of them can see the window behaviours the probes found (B1, B7). L7-pre adds scenarios for them.

**What (as) and (at) do to these scenarios.** Once L7 is built, three scenarios move for a reason that has nothing to do with the handler running. The `settle` op records `checkpoint("settle")` as soon as `settle()` resolves (`diff/scenario.ts:495–497`). On 1.35 `settle()` resolves at 0 ms, so batch outcomes land after the checkpoint. With (as), `settle()` waits for the batch, so they land before it. This is reasoned from the code, not run: v2 has no batch yet.

| Scenario | Moved by | Why |
|---|---|---|
| "a batch window collects requirements into one resolveBatch" | (as) | Its handler waits on a 2 ms timer (`diff/scenarios/l7-batch.test.ts:62`), so its writes and outcomes land after the checkpoint on 1.35 and before it with (as) |
| "batch enabled with only resolve() falls back to one call each" | (at) | This is the fallback. With (at) its runs are ordinary runs that `settle()` waits for, so their outcomes move across the checkpoint |
| "a failing batch retries and reports per batch" | (as) | The first attempt throws and the retry waits 100 ms: `backoff: "none"` waits `initialDelay`, which defaults to 100 (`resolvers.ts:467–474`), and the scenario sets none. On 1.35 the retry and the completions land after the checkpoint; with (as), before it |

**Reading the table:** the three scenarios that look like plain parity checks are really tests of (as) and (at). If Jason approves them, L7a signs entries for these differences. If he declines, v2 keeps 1.35's early `settle()`, the scenarios match, and 1.35's behaviour is pinned.

**Fuzz.** No fuzz feature is placed at L7. The fuzz model (`diff/fuzz/model.ts`) has no batched resolver: neither `resolveBatch` nor a `batch:` option appears in it. L7-pre adds one (B3), placed at L7. It runs on 1.35 from L7-pre, and on v2 only once `current` is L7.

**The mutation gate.** A `gate: L7` run of `mutation-nightly.yml` is in progress (`gh run view 41977295101`). When this was written, 7 of its 12 shards had passed (l5-sources, l6-hydration, l6-introspection, l9-trace, l10-dynamic, l11-predicate, l11-rest) and 5 were still running (l1-state, l2-resolvers, l3-engine, l3-rest, l3-system). **Result: pending.** The score (`pnpm --filter @directive-run/conformance exec tsx scripts/mutation-score.ts --gate L7 <reports>`, `MUTATION.md`) and any deferred debt entries go here when it finishes; debt becomes L7-pre work. GATE-3 already moved one mutant to L7: `resolvers.ts` 2336:34, `hasPendingBatches` emptied, which needs a batch resolver to be killed (`contracts/GATE-3.md:87–88`).

## The design: each 1.35 rule, the mechanism that keeps it, and its pin

Where a row says "verified", a probe ran it against the published 1.35 (`packages/conformance/node_modules/directive-v1`, the `conformance:v1` pin, `1.35.0`), in development and production, with real timers. The output is under "Evidence". The rest is read from the code. 1.35 line numbers are in `packages/core/src/core/`; they are read from the workspace source. The published development bundle carries the same batch functions (`reqToBatch`, `batchInflight`, `supersedeSatisfiedBatches`, `batch-run-`), and every behaviour this document calls verified was run on the published build.

### Where it lives, and why "opt-in" means run time, not bytes

**In plain terms:** 1.35 reads `batch:` off a resolver with no import, so the code that handles it has to be in every system `createSystem` builds. What can be opt-in is the work: a program with no batched resolver runs none of it.

| Option | Keeps 1.35's API? | Who pays the bytes |
|---|---|---|
| **O1. A part wired by `createSystem`** (`withBatch`, like `withSources` at L5 and `withRestore` at L6) | Yes | Every `createSystem` build. `floor` and `createSystemCore` pay only a seam |
| O2. A separate import (`@directive-run/core/batch`, or the plan's `batch()` wrapper) | No: a 1.35 program's `batch:` would stop batching, or throw `featureMissing` | Only programs that import it |
| O3. A chunk loaded the first time a batched resolver is seen | No in practice: the load is async, so the first dispatch, `settle()` and fake-timer tests change | Only programs that use it, after a delay |

**Reading the table:** O1 is the only option that keeps the alpha rule. O2 is the right shape for the beta, where the plan's feature imports arrive. O3 trades a size win for a timing change on the first batch, which is the kind of difference the diff harness exists to catch.

**The mechanism, under O1.** The core's resolvers keep one seam: where `resolve()` meets `def.batch?.enabled` (`api/resolvers.ts:575`), it hands the requirement to `batch_` on the part context instead of dropping it. `withBatch` fills that seam. It owns the queues, the timer, and the batch run. A batch run is an ordinary `Run` (one controller, one stamp, one retry loop, one timeout) that owns a set of requirements instead of one. So L2's retry, backoff, jitter, timeout, binding, abort and the one-outcome mark serve a batch with no second copy. 1.35 has a second copy (`runBatchRetryLoop`, `resolvers.ts:1651–1718`), which is a large part of why its batch code is 2.0 KB (see Size).

**Opt-in at run time.** With no batched resolver, `withBatch` creates no queue, no timer and no map, and the seam is one property read per dispatch. The plan's seams (L2 "Resumable resolvers" and "cancellation trees plus `concurrency`") fit: the in-flight table gets one row per requirement, naming its batch run; the attempt a batch reports is the batch's attempt (1.35 has no `ctx.attempt`; the pin is the number `onRetry` and `shouldRetry` get, U16); a batch counts as one run for a future `concurrency` limit. `ctx.key` has no single value for a batch and is a beta question.

### The window

**In plain terms:** requirements for a batched resolver wait in a queue. The queue runs when it is full, when its timer fires, or when `settle()` asks.

| # | 1.35 rule | 2.0 mechanism | Pinned by |
|---|---|---|---|
| W1 | `windowMs` defaults to 50 (`resolvers.ts:417–420`). One queue per resolver definition (`batches`, keyed by resolver id). | The same defaults; one queue per definition. | oracle "by default collects requirements raised close together into one call" |
| W2 | **Each add restarts the timer** (`clearBatchTimer`, then `setTimeout`, `resolvers.ts:1899–1903`; the comment reads "Start or reset timer"). So the window is measured from the last add, not the first. The docs say otherwise: "Collect requirements for 50ms" (`knowledge/core/resolvers.md:150`). Verified, B1: six requirements added 30 ms apart, `windowMs: 50`, ran as one call at 210 ms. B1b: twenty added 20 ms apart ran as one call at 450 ms, nothing before. | Without (ap): copied. With (ap): the timer starts at the first add and is not moved. | L7-pre (U1) |
| W3 | `maxSize` reached: the queue runs at once (`1889–1898`). Without `maxSize`, a hard cap of 10,000 runs it (`1799`, `1879–1886`). | The same, both caps. | oracle "maxSize runs a full batch at once"; `batch-resolve-fallback` "flushes batch immediately" |
| W4 | `settle()` runs every queue at once (`engine.ts:4020–4021`), and a reconcile is scheduled while a queue is non-empty (`engine.ts:1581`). | The same, through the part's `settle` hook. | oracle "settle() runs a queued batch now" |
| W5 | The run uses the last non-undefined dispatch baseline of the queued requirements (`processBatch`, `1907–1942`), for binding. | The same. | oracle "abortOn on a batched resolver" |
| W6 | The timer is `setTimeout`. | The kernel clock, as L2's retry waits. Under the harness's fake timers the two agree. | C list |

**Reading the table:** W2 is the one a user trips over. A search box that raises a requirement every 20 ms, with a 50 ms window, never sends a request until the typing stops. `maxSize` is the only way out, and the default has none. The docs promise a fixed 50 ms window, and the debounce is undocumented, which is why (ap) is labeled better / test-rule.

**The types and the code differ on two options.** The types say `windowMs` is required (`BatchConfig`, `src/types/resolvers.ts:153`) and that `maxSize` defaults to "unlimited" (line 154). The code defaults `windowMs` to 50 (`DEFAULT_BATCH`, `resolvers.ts:417–420`), so plain JavaScript may leave it out, and it caps a queue with no `maxSize` at 10,000 (`DEFAULT_MAX_QUEUE_SIZE`, `1799`). core-next copies the types and the code as they are. A TypeScript user must write `windowMs`. A user who reads "unlimited" meets a flush at 10,000. No behaviour changes, so there is no candidate. The cap gets a pin (U15), and fixing the doc comment is a follow-up.

### Running a batch: the two handlers and the fallback

**In plain terms:** `resolveBatch` succeeds or fails as a whole. `resolveBatchWithResults` returns one result per requirement. With only `resolve()`, each requirement runs on its own after the window.

| # | 1.35 rule | 2.0 mechanism | Pinned by |
|---|---|---|---|
| R1 | `resolveBatch(reqs, ctx)`: its sync start runs in one store batch; on return, every requirement completes (`executeAllOrNothing`, `1518–1549`). An aborted batch reports nothing more. | The batch run's start in one store batch, as a single run's is (`api/resolvers.ts:311`). | oracle; diff "a batch window collects …" |
| R2 | `resolveBatchWithResults`: a result count that differs from the requirement count throws "Batch resolver … returned N results but expected M" (`1479–1484`). A failed item without an error reports `new Error("Batch item failed")`. | The same strings, in both modes: they are errors, not warnings. | oracle (3 cases) |
| R3 | A thrown batch retries under the policy: backoff, `onRetry` for each requirement, `shouldRetry`; when attempts run out, each requirement errors once with the last error (`1651–1796`). Verified, B3b: calls at 10, 110 and 320 ms, retries `#2` and `#3` for both requirements, one error each, `shouldRetry` asked 3 times. | L2's retry loop, unchanged. | oracle "a whole-batch failure retries the batch" (5 cases); diff "a failing batch retries …" |
| R4 | `batch.timeoutMs` wins over the resolver's `timeout` (`1739`); the message is "Batch resolver … timed out after N ms". | L2's timeout, with the batch's limit and message. Quirk n applies: the timeout aborts the attempt's signal. | oracle "a batch that never settles times out" (4) |
| R5 | **Every item of a with-results batch failed: the batch runs again at once, with no backoff, no `onRetry` and no `shouldRetry`, and each item reports an error on every attempt.** Verified, B3: three calls, all at 10 ms; no retries; `shouldRetry` asked 0 times; 6 errors for 2 requirements. | Quirk h (approved): the all-failed case goes through the retry policy like a thrown batch. With (ar): each item reports its error once, after the last attempt. | diff scenario (U4) |
| R6 | **Some items failed: no retry, ever** (`1510–1513`). Verified, B4: one call; `a` completed, `b` errored once, and a later pass did not run `b` again. | Quirk i (approved): the failed items are run again, see B2. | diff scenario (U5) |
| R7 | **The fallback** (`batch.enabled` with only `resolve()`): after the window, each requirement runs `executeResolve` with its own new controller, which nothing else can reach (`1564–1575`). Verified, B8: retracting `b` mid-run canceled nothing, and all three completed. B8b: `stop()` mid-run canceled nothing, and both completed after the stop. | Without (at): copied. With (at): each requirement becomes an ordinary single run once the window closes, in flight, cancelable, stopped by `stop()`, and waited for by `settle()`. | diff scenario (U8) |
| R8 | A batched resolver with no handler at all throws at `createSystem` in development (verified, B10). In production nothing checks it, and each requirement "completes" with no code run (verified, B10). | The same. Development already reports the mistake. | L7-pre production pin (U9) |

**Reading the table:** R5 and R6 are quirks h and i, already approved. R7 is new. A fallback batch looks like a resolver to the user, but stop, cancel and settle cannot reach it.

### Cancel, stop, settle and inspect

**In plain terms:** this is where a batch differs most from a single run. 1.35 tracks a running batch in its own maps, and several parts of the engine never look there.

| # | 1.35 rule | 2.0 mechanism | Pinned by |
|---|---|---|---|
| C1 | A queued requirement that is retracted leaves the queue and is canceled; a queue left empty never runs the handler (`2108–2129`). The cancel hook gets the whole requirement (verified, B6: keys `requirement,id,fromConstraint`). | The same. | oracle "takes a retracted requirement out of the batch"; "never runs the handler with no requirements" |
| C2 | **Retracting one requirement of a running batch aborts the whole batch and cancels every requirement in it** (`2131–2185`). 1.35 declares this intended: "you can't abort one row of a SQL UPDATE without aborting the transaction" (`2131–2136`). **The still-wanted ones are never run again.** That is 1.35's general rule for a canceled requirement that is still wanted, the same as row j. Verified, B2, and again in the design review's rerun: `b` retracted from `[a, b, c]` mid-run; the signal aborted, `a`, `b` and `c` were each canceled, the handler did not run again, and `a` and `c` stayed unmet (`unmetAfter: [a, c]`). | Quirk g (approved): only the retracted requirement is canceled. The batch keeps running for the rest, and drops its outcome report for the retracted one. `resolveBatch` writes facts directly, so the facts it writes are not undone. When every requirement has left, the batch's signal aborts. L7b copies this account into the entry's `reason`. | oracle "retracting every requirement of a running batch aborts it"; diff scenario (U2) |
| C3 | The cancel hook for a running batch's requirement gets `{ id }` only (`2181`: "the original requirement objects are not retained"). Verified, B2: keys `id`. | Without (aq): copied. With (aq): the whole requirement, as for a queued one. | L7-pre (U3) |
| C4 | `stop()` and `destroy()` cancel queued requirements, abort running batches and cancel each requirement once; a second `stop()` cancels nothing more (`2193–2234`). Quirk j applies: `start()` dispatches the still-wanted requirements again, into a new window. | The same, through the part's stop hook. | oracle "stopping or destroying a system ends batched work" (6) |
| C5 | A batch that satisfied its requirement and is still running is superseded when the requirement comes back (`supersedeSatisfiedBatches`, `1830–1862`). | L2's supersede, per requirement of the batch run. | `resolver-outcomes`; oracle "is canceled and its later failure dropped …" |
| C6 | **`settle()` resolves while a batch is still running.** `isSettled` counts `getInflightCount()` (`engine.ts:4008`), which counts single runs only (`resolvers.ts:2264–2270`). The docs say the opposite: "Wait for all resolvers to complete" (`knowledge/core/core-patterns.md:132`; `anti-patterns.md:257`). Verified, B7: the batch started at 0 ms and ended at 100 ms; `settle()` resolved at 0 ms. `inspect()` listed nothing in flight, both while the batch was queued and while it ran. | Without (as): copied. With (as): `settle()`, and every check of whether resolvers are running, counts a running batch; `inspect()` lists its requirements as in flight. The dispatch rule is unchanged: the listing is a view. A batch with no `timeoutMs` that runs past `settle()`'s 5 s `maxWait` (`engine.ts:4005`) makes it reject. | L7-pre (U7) |

**Reading the table:** C2 and C6 matter most. C2 strands requirements the app still wants, with no error. C6 breaks the server-render pattern, `await system.settle()` then read the facts, for any app that batches its loads.

### Binding, own writes and outcomes

| # | 1.35 rule | 2.0 mechanism | Pinned by |
|---|---|---|---|
| B-1 | A batch whose requirements all come from one constraint is bound to that constraint's `abortOn` keys (`1589–1601`). A clobbered write is dropped, the signal aborts, and the batch reports no outcome. Verified, B5 single-source: `status` stayed `"external"`, `aborted=true`, no complete, cancel or error. | L2's binding on the batch run. | oracle "abortOn on a batched resolver" |
| B-2 | **A batch with requirements from two constraints is not bound at all.** Verified, B5 mixed-source: the batch's write replaced `"external"` with `"from-batch"`, and both requirements completed. | Quirk k (approved): the binding is the union of the requirements' `abortOn` keys. A clobber behaves as B-1's does (B1). | diff scenario (U6) |
| B-3 | A batch's own write that retracts its requirement satisfies it: no cancel (`batched-resolver-retracting-own-requirement`; `reconcile-timing-rules`, 8 cases). Writes are attributed per batch run. | L2's writer stamps: the batch run's stamp. | the 10 tests named, fail today |
| B-4 | One outcome per requirement per run. Quirk b applies: a batch canceled while it waits to retry reports the cancel only. Quirk t applies: `stop()` from a completion hook during a batch's completion loop reports the remaining completions and no cancel after them. That is 2.0's rule, not 1.35's. Probed in L7-pre (U10, on the published 1.35.0): `stop()` from a's completion hook gives `complete a, cancel a, cancel b, cancel c, complete b, complete c`, so 1.35 reports two outcomes for every requirement of the batch. GATE-2's row t names single runs only. This is row t's batch-shaped path, as its third path was found by the fuzz at L3 and signed under the same row. L7a or L7b signs it under row t, with this path named in the entry's reason. | One done mark per requirement in the batch run. | oracle "does not run the batch again once a retry wait finds its requirements aborted"; U10 |
| B-5 | The error boundary hears each failed requirement on its own. Row p and quirk a apply per requirement: `"retry-later"` and `"retry"` dispatch it again into a new window, counted per requirement. With R5 copied, an all-failed with-results batch reports each error once per attempt, so the boundary hears it up to `attempts` times (reasoned from `executeWithResults`, not probed). | Per requirement. (ar) makes it once. | U11 |
| B-6 | Quirk e applies unchanged: a constraint `after` a batched one is unblocked when that requirement reports its outcome. The window adds its delay. | The same. | existing quirk-e pins |

**Reading the table:** B-2 is quirk k: a mixed batch silently writes over a fact the binding exists to protect. B-5 shows why (ar) is more than tidiness: the extra error reports reach the error boundary too.

## Untested behaviours, and what will pin each

**In plain terms:** 16 behaviours have no pin on either engine. Twelve came from the probes and the forced-L7 run. Four more come from reading the code. Each needs a pin before the slice that could break it. "Conformance" means a test that runs on v1 and v2; "diff" means a scenario the diff harness runs on both.

| # | Behaviour | Evidence | Pinned by | Slice |
|---|---|---|---|---|
| U1 | The window restarts on every add; a steady trickle never flushes | B1, B1b | A diff scenario with fake timers; shows (ap) if approved (better / test-rule) | L7-pre |
| U2 | Retracting one requirement of a running batch cancels all of them, and the still-wanted ones never run again | B2 | A diff scenario; shows quirk g | L7-pre |
| U3 | A running batch's cancel hook gets `{ id }` only | B2, B6 | A conformance test; shows (aq) if approved | L7-pre |
| U4 | An all-failed with-results batch reruns at once, with no backoff, `onRetry` or `shouldRetry`, and reports each error per attempt | B3 | A diff scenario; shows quirk h and (ar). The oracle's case compares a `Set` of ids, so it cannot see the repeats | L7-pre |
| U5 | A partly failed with-results batch is never retried | B4 | A diff scenario; shows quirk i | L7-pre |
| U6 | A mixed-source batch is unbound; a single-source one is bound | B5 | A diff scenario with both; shows quirk k | L7-pre |
| U7 | `settle()` resolves while a batch runs; `inspect()` lists no batch in flight | B7 | A conformance test; shows (as) if approved. The three existing L7 scenarios move for the same reason (see "Gap analysis") | L7-pre |
| U8 | The fallback's runs ignore retraction and `stop()` | B8, B8b | A diff scenario; shows (at) if approved | L7-pre |
| U9 | Production runs no check on a batched resolver with no handler, and completes its requirements | B10 | A conformance test in production | L7-pre |
| U10 | `stop()` from a completion hook in the middle of a batch's completion loop | probed in L7-pre: 1.35 gives `complete a, cancel a, cancel b, cancel c, complete b, complete c` | A conformance test (quirk t) | L7-pre |
| U11 | The error boundary hears an all-failed with-results item once per attempt | reasoned from `executeWithResults` | A diff scenario with `onResolverError: "retry-later"` | L7-pre |
| U12 | Two placed tests pass on v2 without any batch code, and could not fail for the reason they are named for | the forced-L7 run; `batch-resolve-fallback.test.ts:194–253` asserts only that `resolvedIds` is empty (253); `resolver-loading-flag.test.ts:116–138` never sees `loading` true (assertion at 135) | The stopped test gains a control run with no `stop()` where the handler must run. The loading test samples `loading` while the handler runs, expects true, then false after the `finally`, and expects the handler ran (an oracle change) | L7-pre |
| U13 | `requeue()` inside a batch handler requeues every requirement in the batch (`resolvers.ts:975–977`, `1142–1148`) | read from the code, not probed | A conformance test: after the batch, each requirement is treated as freshly added at the next reconcile | L7-pre |
| U14 | What the batch's signal carries when it aborts (`signal.reason`): on retraction (C2), on `stop()` and on a binding clobber (B-1) | B2 and B5 show the abort, not the reason; the code aborts with no argument at `1847` and `2155` | A conformance test per cause that records `signal.reason` | L7-pre |
| U15 | A queue with no `maxSize` runs at once when it reaches 10,000 requirements, though the types say "unlimited" (`1799`, `1879–1886`; W3) | read from the code, not probed | A conformance test with 10,000 adds and one more, timers faked | L7-pre |
| U16 | The attempt number a batch passes to `onRetry` and `shouldRetry` for each requirement (B3b: `#2`, `#3`). 1.35's `ResolverContext` has no `attempt` field | B3b | A conformance test on the attempt numbers | L7-pre |

**Reading the table:** U1 to U8 are where the quirks and candidates live, so each pins 1.35's behaviour now and shows the difference only with an approved, signed `divergences.json` entry. U9 is not a candidate: development already throws. U12 is test hygiene: a test that passes because nothing ran proves nothing, so each of the two now has a control that can fail. U13 to U16 pin what the oracle never mentions: a batch's `requeue()`, its abort reason, its size cap and its attempt number.

## Performance

**In plain terms:** L7 adds no work to a program that does not batch, and the bench has no batch workload yet.

I did not run the bench for this RFC: no L7 code exists, and the L6 numbers stand (every workload at 0.39 to 0.85 of 1.35's time). What L7 must keep, and what it adds:

- No workload slower than `main` by more than 5% after any L7 slice. The seam is one property read per dispatch.
- L7a adds a `batch-fanout-100` workload (B4): one pass raises 100 requirements for one batched resolver, the window flushes, the handler writes 100 facts. Time and bytes per flush. The L7 gate judges it at 1.0 or better against 1.35.
- 1.35 copies the config on every add (`{ ...DEFAULT_BATCH, ...def.batch }`, `1874`) and searches every queue on every abort (`2108–2129`). 2.0 resolves the config once per definition and keeps a requirement-to-queue index (C list).

## Slice plan

**In plain terms:** an oracle slice, two build slices and the gate. Each build slice is one PR at the committed `current`, tested at a forced L7 locally, as L5 and L6 were.

| Slice | Builds | Done means (checkable) | Tier |
|---|---|---|---|
| Precondition | The `gate: L7` mutation run (41977295101) finishes. | The L7 layer gate reports PASS, or its debt entries are listed as L7-pre work. | test oracle; coordinator |
| L7-pre (oracle) | U1 to U16. The two vacuous tests made to bite (U12). The fuzz model gains a batched resolver (B3), placed at L7. Any mutation debt. A `WHITE-BOX.md` L7 bullet for the 6 internals cases in `resolvers.test.ts`. | The new tests pass on `conformance:v1` and `v1:prod`, and on v2 fail only as this document predicts. `conformance:diff` at forced L7 fails only the three scenarios above and the new U-scenarios. The batched fuzz resolver runs on 1.35 from L7-pre, and on v2 only once `current` is L7. `pnpm census`, `check:expects` and `oracle:update` exit 0. `oracle-change` label. | test oracle; Sonnet |
| L7a | The seam in the core and the `withBatch` part, wired by `createSystem` (O1): W1 to W6, R1 to R4 and R7 to R8, C1 and C4 to C6, B-1 and B-3 to B-6. (ap), (as) and (at) only if approved. `batch-fanout-100` (B4). For approved rows, signed entries (GATE-2 rule 1). | At forced L7 on v2, v2:prod and v2:dist: the 52 failures pass, except those for quirks g, h, i and k, each listed by file and title. `conformance:diff`: the three L7 scenarios match 1.35, or differ only by a signed entry for (as) or (at) if approved; if declined they match and 1.35's early `settle()` is pinned. U1, U7 and U8 likewise. Entries are signed on the owner's instruction, for approved rows only; declined rows have none. Census and ratchet exit 0. core-next `test`, `typecheck`, `build` and `size:check`, with the exact development-string count (139 today). `floor` grows by at most 20 B; `minimal` within A1, with the measured size in `reason`. The report gives the part's bytes and the seam's bytes separately. | core; Opus implementer, Sonnet diff reviewer plus Fable correctness reviewer |
| L7b | Quirks g, h, i and k (approved), and (aq) and (ar) only if approved. Their `divergences.json` entries, signed "on the owner's instruction" (GATE-2 rule 1) once Jason approves this RFC. Quirk g's `reason` carries the fuller account in C2. | The rest of the 52 pass at forced L7. U2, U4, U5 and U6 differ from 1.35 only by signed entries for g, h, i and k; U3 and U11 only by signed entries for approved candidates. Plus L7a's checks. | core; as L7a |
| L7-gate | `current` to L7, `ratchet --update`, diff and fuzz at L7, `/principal` on L7. | 0 L7 failures on v2, v2:dist and v2:prod. The census exits 0. PR fuzz and nightly run v2 at L7. | test oracle; Sonnet plus the coordinator's read of each entry |

**Reading the table:** L7a carries the size and the most behaviour. L7b carries the four approved fixes, which change what users see, so each lands with its own diff evidence. Splitting them keeps the parity port reviewable on its own. Every entry lands signed, because an engine PR may not add an unsigned one. The signing waits for Jason's approval of this RFC, as at L2 and L3. A row he declines gets no entry, and its 1.35 behaviour is pinned in a core-next test instead.

## Size

**In plain terms:** every `createSystem` build pays for batching, and `minimal` has almost no room.

Measured with `node scripts/size.mjs --check` in `packages/core-next` on this branch (production, minified, gzip level 9; exit 0).

| Fixture | core-next now | Budget | Room to budget |
|---|---|---|---|
| `minimal` | 28,683 B | 28,760 B (owner's ceiling 28,800 B) | 77 B (117 B to the ceiling) |
| `two-module` | 28,771 B | 28,800 B | 29 B |
| `floor` | 10,439 B | 10,450 B | 11 B |
| `aperture` | 33,577 B | 33,660 B | 83 B |
| `full-entry` | 30,945 B | 31,671 B | 726 B |

**Reading the table:** `minimal`, `two-module`, `floor` and `aperture` are each within about 100 B of their budgets. `aperture` uses no batched resolver, but under O1 it pays for one.

| Piece | How measured | gzip |
|---|---|---|
| 1.35's batch code (`resolvers.ts:1450–1943` plus the batch branches of `abort`, `abortAll`, `processBatches` and `hasPendingBatches`) | Cut out as one fragment, minified with esbuild 0.27.3, gzip 9 | **2,012 B** measured; 1,851 B without its own retry loop |
| The same, as a share of a bundle | Reasoned from L6's ratio: the persistence plugin, 915 B alone, added 712 B to `minimal` (712 / 915 = 0.78). 1,851 B x 0.78 is about 1.44 KB; the 1,851 B figure leaves out the retry loop that L7a reuses (2,012 B x 0.78 would be 1.57 KB) | about 1.4 KB if ported line for line |
| L7a in core-next: the window, the two handlers, the fallback, abort by requirement, stop, settle | Reasoned: the batch run reuses L2's retry loop, timeout, binding, abort and outcome mark. This is the part that rests on reuse | **+0.5 to 0.8 KB** (estimate) |
| (ap) a fixed window | Reasoned: the timer is set once instead of on every add | about 0 B |
| (aq) the whole requirement on cancel | Reasoned: the run already holds them | +5 to 15 B |
| (ar) one error per item | Reasoned | +10 to 30 B |
| (as) settle and inspect count a running batch | Reasoned: one more set, read in two places | +20 to 50 B |
| (at) the fallback as single runs | Reasoned: a loop over L2's run start, replacing a private copy | −20 to +40 B |
| Quirks g, h, i, k | Reasoned: per-requirement ownership (g), the failed subset (i), the key union (k); h removes a branch | +80 to 180 B |
| The seam in `floor` | Reasoned: one call where the drop is today | +5 to 20 B |
| **Every `createSystem` build, L7 in total** | L7a plus every candidate and quirk | **+0.6 to 1.1 KB**, so `minimal` to about 29.3 to 29.8 KB (estimates, except the 2,012 B) |

**Reading the table:** the plan's +0.6 KB is the low end, and only because core-next reuses its run machinery. A line-for-line port of 1.35 would cost more than twice that. The candidates add little; the quirk fixes add the most of any group after L7a itself.

**What the estimate rests on.** Three things. The 2,012 B fragment is measured. L6's 0.78 ratio of bundle cost to stand-alone cost is measured. Reuse is a plan: the batch run shares L2's retry loop, timeout, binding, abort and outcome mark. If a batch run cannot share the L2 loop, the cost moves toward the 1.4 KB line-for-line figure, and A1's +1.1 KB cap would not hold. That is why L7a reports the part's bytes and the seam's bytes separately: the seam is the cost every build pays whatever the part does.

**L6 calibration.** L6 estimated +274 to 404 B for `minimal`, with (al). It landed +324 B at the end of L6c: 28,314 B to 28,638 B (+150 in L6a, +28 in L6b, then +85 and +61 in L6c; commits `1875ba89`, `3f0bee42`, `cb2f6bcd`). The tree at this RFC's cut reads 28,683 B, which is +369 B from the same start; the other 45 B came with later changes, not L6. Either figure is inside L6's range, a little below and a little above its middle (339 B). So the method has landed inside its range once. It has not yet been tested on a part that leans on reuse as heavily as L7a does.

## What the plan got wrong, or left out

- **"Opt-in" cannot mean bytes in the alpha.** 1.35 reads `batch:` with no import, so the code is in every `createSystem` build. Only the run time is opt-in. A byte-level opt-in needs an import (O2), which is a beta change (A1).
- **The +0.6 KB is the low end.** 1.35's batch code measures 2,012 B gzip on its own. core-next can land near +0.6 KB only by reusing its single-run machinery (+0.6 to 1.1 KB with the quirk fixes).
- **The representative tests are a small part of the oracle.** `batch-resolve-fallback` places 6 tests at L7 (4 fail; 2 pass, one of them vacuously) and `batched-resolver-retracting-own-requirement` places 1. The real oracle is `l7-batch-resolvers-oracle`: 30 tests, 35 cases.
- **Quirk g has a second half its row does not name.** GATE-1 says retracting one requirement "cancels the whole batch, including still-wanted siblings". The probe adds that the siblings are never run again (B2). 1.35 declares the whole-batch abort intended (`resolvers.ts:2131–2136`), and "never run again" is its general rule for a canceled requirement that is still wanted, the same as row j. The approved direction is unchanged: only the retracted requirement is canceled.
- **No row covers `settle()`.** It resolves while a batch runs, and `inspect()` shows no batch in flight (B7), though the docs say `settle()` waits for all resolvers. That is (as).
- **No row covers the window restarting on every add** (B1). The docs say "collect for 50ms"; the code debounces. That is (ap).
- **No row covers the fallback.** Its runs cannot be canceled or stopped (B8). That is (at).
- **Two placed tests prove nothing on v2 today:** they pass because the handler never runs (U12), and each needs a control that can fail.
- **The approved quirks have no entries yet.** g, h, i and k were approved at GATE-1 with no `divergences.json` entries. L7a and L7b write them signed, on the owner's instruction, once Jason approves this RFC. An engine PR may not add an unsigned entry.

## Decisions for the owner

**Owner decisions, 2026-11-05.** Jason answered four questions, quoted here in his words. Everything this section recommends is approved.

| Question | Jason's answer | What it settles |
|---|---|---|
| A1, the L7 size | "Approve up to +1.1 KB (Recommended)" | Batching is a `withBatch` part wired by `createSystem`. `minimal`, `two-module`, `aperture` and `full-entry` may each grow by up to 1.1 KB (`minimal` ceiling 29,900 B), and `floor` by up to 20 B. Each slice does the attribution step first and comes back above the cap. |
| (as) `settle()` waits for a running batch | "Approve (Recommended)" | Built in L7a, with the fake-timer and 5 s risks stated in its entries. |
| (ap), (aq), (ar), (at), B1 to B4, and signing | "Approve all (Recommended)" | (ap) and (at) in L7a, (aq) and (ar) in L7b; B1 to B4 as written (B3 in L7-pre); Claude signs the entries for these rows and for quirks g, h, i and k "on the owner's instruction" (GATE-2 rule 1). |
| The plan's all-in size target (22 KB, ceiling 25) | "Budget per layer; aim ≤ half of 1.35 (Recommended)" | Each layer's raise is approved at its gate. At L13 the all-in ceiling is set from measurement, aiming at no more than half of 1.35's all-in (about 95 KB measured with size.mjs's method on 2026-11-05, so about 48 KB). |

**In plain terms:** every L7 recommendation is approved, so the slices build all five candidates and sign their entries. The plan's 22 KB all-in number is retired.

**Owner decision (au), 2026-11-05, found in the L7a review.** A requirement of a running batch is superseded: the batch [A, B] satisfied A by its own write, and A comes back while the batch still runs. 1.35 completes A twice, once from the old batch and once from its new run, with no cancel. L7a's first build reported nothing for A from the old batch. RFC C5 promised "L2's supersede, per requirement", which for a single run means the old run reports a cancel and the new run completes. Jason chose "Same as single runs (Recommended)". So the old batch reports a cancel for A (the hook gets the whole requirement), and the new run completes it, one outcome per run. Product verdict: better, small change. L7a builds it. The L7 oracle pins 1.35's double completion, and the gate signs the (au) entry.

**Owner decision, L7b size, 2026-11-05.** L7b built quirks g, h, i and k with (aq) and (ar), and every fixture ended 53 to 72 B over A1's +1.1 KB, mostly for quirk i's failed-item split (about 110 B). Jason chose "Approve +1,175 B (Recommended)". L7 as a whole may grow each fixture by up to 1,175 B over its pre-L7 size: `minimal` at most 29,858 B.

**Owner decision, Phase 4, 2026-11-05.** Asked how Phase 4 continues after the L7 gate, Jason chose "Re-plan first (Recommended)". A short re-plan comes to him before L8 starts: feature imports before L8 to L12, lighter checks for the opt-in layers, and a Sizls app on 2.0 sooner.


**Questions for Jason.** Seven answers settle L7. The table below them has a product verdict for each, so Jason can bulk-approve.

1. **A1, where batching lives and its size.** A part wired by `createSystem` (O1), with `minimal`, `two-module` and `aperture` allowed up to +1.1 KB, `full-entry` up to +1.1 KB, and `floor` up to +20 B. **Recommend: approve.**
2. **(as), `settle()` waits for a running batch.** Better: it makes `settle()` do what the docs already say. The risk: a fake-timer test that awaits `settle()` while a batch waits on a timer hangs until the timers advance, and `settle()` rejects at 5 s for a slow batch with no `timeoutMs`. It also moves the three existing L7 diff scenarios. **Recommend: approve.**
3. **(ap), the window starts at the first add.** Better / test-rule: the docs say "collect for 50ms" and the code resets the timer on every add. A trickle whose adds are each closer than `windowMs` but whose span is longer becomes two calls where 1.35 made one. **Recommend: approve.**
4. **(at), fallback requirements run as ordinary single runs.** It also moves the fallback diff scenario. **Recommend: approve.**
5. **(aq) and (ar), the small ones.** **Recommend: approve both.**
6. **B1 to B4.** Keep as written. **Recommend: approve.**
7. **Signing.** Approving rows includes asking Claude to sign their entries "on the owner's instruction", as at L2 and L3 (GATE-2 rule 1). Declined rows get no entry, and their 1.35 behaviour is pinned. **Recommend: approve.**

A "no", or no answer yet, means the slice keeps 1.35's behaviour, pins it with a core-next test, and writes no entry.

| Decision | Product verdict | Recommendation |
|---|---|---|
| **A1** batching lives in a part wired by `createSystem`, and the L7 budgets | Same behaviour; every `createSystem` build grows by an estimated 0.6 to 1.1 KB | Approve: `minimal`, `two-module`, `aperture` and `full-entry` up to +1.1 KB each; `floor` up to +20 B; come back above that |
| **(ap)** the window starts at the first add | Better / test-rule, visible: the docs say "collect for 50ms" and the code debounces. A trickle whose span is longer than `windowMs` (adds at 0, 40 and 80 ms with a 50 ms window) becomes two calls where 1.35 made one | Approve, in L7a |
| **(aq)** the cancel hook gets the whole requirement for a running batch | Better, small change | Approve, in L7b |
| **(ar)** an all-failed with-results item reports its error once | Better, small change; the error boundary hears it once | Approve, in L7b, with quirk h |
| **(as)** `settle()` and `inspect()` count a running batch | Better, visible: `await settle()` now includes batched work, as the docs say. A fake-timer test that awaits `settle()` during a batch wait can hang; a slow batch with no `timeoutMs` makes `settle()` reject at 5 s. Moves the three existing L7 diff scenarios | Approve, in L7a |
| **(at)** the fallback's requirements run as ordinary single runs | Better, visible: retraction, `stop()` and `settle()` reach them. Moves the fallback diff scenario | Approve, in L7a |
| **B1** quirk k's rule: the union of the keys; a clobber acts as on a single-source batch | Same as the approved row | Approve |
| **B2** quirk i's shape: the failed items run again as a smaller batch | Same as the approved row | Approve |
| **B3** the fuzz model gains a batched resolver, in L7-pre, placed at L7 | No behaviour change | Approve |
| **B4** a `batch-fanout-100` workload judges the L7 gate | No behaviour change | Approve the shape before L7a |
| **Signing** L7a and L7b sign the entries for approved rows on the owner's instruction | No behaviour change; the census needs signed entries | Approve |

### A. Decisions

#### A1 where batching lives, and the L7 budgets

- **What 1.35 does.** `batch:` on any resolver works with no import. The batch code is part of the resolvers manager, in every system.
- **What 2.0 would do.** A `withBatch` part wired by `createSystem`, like `withSources` (L5, A1) and `withRestore` (L6, B6). `floor` and `createSystemCore` carry only the seam. At the beta, the plan's feature imports can offer O2 for builds that want to drop it.
- **Product verdict.** Same behaviour. Every `createSystem` build grows by an estimated 0.6 to 1.1 KB: `minimal` to about 29.3 to 29.8 KB.
- **Recommendation.** Approve O1 and a raise with a written reason in each slice: up to +1.1 KB on `minimal`, `two-module`, `aperture` and `full-entry`, and up to +20 B on `floor`. That makes `minimal`'s ceiling 29,900 B. Do the attribution step first (find the bytes, move cold code, fold duplicates), and come back if the measured size passes the cap.

### Candidate divergences

#### (ap) the window starts at the first add

- **What 1.35 does.** Each add restarts the timer (W2). Requirements raised more often than `windowMs` never flush until they stop, or until `maxSize`, or 10,000 (B1, B1b).
- **What 2.0 would do.** Start the timer at the first add of an empty queue and leave it. The batch runs at most `windowMs` after its first requirement.
- **Product verdict.** Better / test-rule, visible. Batch latency gets an upper bound. The docs say "Collect requirements for 50ms" (`knowledge/core/resolvers.md:150`), while the code resets the timer on every add (`resolvers.ts:1899`), so the debounce is undocumented. The visible effect: a trickle whose adds are each closer than `windowMs` but whose span is longer (adds at 0, 40 and 80 ms with a 50 ms window) becomes two calls, `[0, 40]` at 50 ms and `[80]` at 130 ms, where 1.35 made one call of three at 130 ms.
- **Recommendation.** Approve, in L7a.

#### (aq) the cancel hook gets the whole requirement

- **What 1.35 does.** For a queued requirement, `onResolverCancel` gets the requirement. For one in a running batch, it gets `{ id }` only (C3). A plugin that reads `req.requirement.type` on cancel gets `undefined`.
- **What 2.0 would do.** Pass the whole requirement in both cases. The batch run already holds it.
- **Product verdict.** Better, small change.
- **Recommendation.** Approve, in L7b.

#### (ar) an all-failed with-results item reports its error once

- **What 1.35 does.** Each attempt of an all-failed with-results batch reports an error for each item: 3 attempts, 2 items, 6 errors (B3). The error boundary can hear each one (B-5).
- **What 2.0 would do.** With quirk h, the failed attempts wait and retry under the policy. Each item reports its error once, after its last attempt, as a thrown batch already does (B3b). This is the one-outcome rule from quirk b, applied to with-results items.
- **Product verdict.** Better, small change.
- **Recommendation.** Approve, in L7b, with quirk h.

#### (as) `settle()` and `inspect()` count a running batch

- **What 1.35 does.** `settle()` runs the queues, then resolves without waiting for the batches it started (C6, B7). `inspect()` lists no batch in flight.
- **What the docs say.** `settle()` "waits for all resolvers to complete" (`knowledge/core/core-patterns.md:132`), and the anti-patterns page tells users to `await system.settle()` before reading resolved data (`knowledge/core/anti-patterns.md:257`). 1.35 does not do that for a batch. (as) makes `settle()` do what the docs say.
- **What 2.0 would do.** Count a running batch's requirements wherever the engine asks whether resolvers are running: `settle()`, the settled notification and `inspect()`. Dispatch is unchanged.
- **Product verdict.** Better, visible. `await system.settle()` returns after batched work, which is what the docs promise, and what server rendering and tests rely on. A test that awaited `settle()` and then expected the batch to still be running would change.
- **The risk, plainly.** A user's fake-timer test that awaits `settle()` while a batch waits on its window, a backoff or a timeout now waits until the timers advance, and can deadlock. The `maxWait` timer is fake too, so its rejection never fires either. On 1.35 the same test returned at once. The harness is immune: `drive` advances the fake timers until the promise settles (`diff/scenario.ts:423–463`; the advance is at 458).
- **The 5 s limit.** `settle(maxWait = 5000)` (`engine.ts:4005`) rejects with "settle() timed out after 5000ms" (`engine.ts:4065`). With (as), a batch that runs longer than 5 s and has no `timeoutMs` (or resolver `timeout`) makes `settle()` reject, where 1.35 resolved at 0 ms. A batch with a shorter `timeoutMs` ends first.
- **Visible in the diff harness.** All three existing L7 scenarios move (see "Gap analysis"). L7a signs their entries if (as) and (at) are approved, and pins 1.35 if they are declined.
- **Recommendation.** Approve, in L7a.

#### (at) the fallback's requirements run as ordinary single runs

- **What 1.35 does.** With only `resolve()`, each requirement runs on a private controller after the window. Retraction, `stop()` and `settle()` cannot reach it, and it reports `complete` after the system stopped (R7, B8, B8b).
- **What 2.0 would do.** When the window closes, start each requirement as an ordinary L2 run. It is then in flight, cancelable, stopped by `stop()`, and waited for by `settle()`.
- **Product verdict.** Better, visible: the fallback behaves like the resolver it falls back to. It also moves the scenario "batch enabled with only resolve() falls back to one call each" (see "Gap analysis"); L7a signs that entry if (at) is approved, and pins 1.35 if not.
- **Recommendation.** Approve, in L7a.

### B. Recommendations the owner may overrule

#### B1 quirk k's rule

- **What the row says.** "The `abortOn` contract holds for mixed batches."
- **What 2.0 would do.** Bind a mixed batch to the union of its requirements' `abortOn` keys, each compared with the batch's baseline (W5). A clobber drops the write, aborts the batch's signal and reports no outcome, as a single-source batch does today (B-1). A finer rule, ending the run only for the requirements whose constraint binds the key, would need one signal per requirement, and is a beta question.
- **Recommendation.** Approve.

#### B2 quirk i's shape

- **What the row says.** "Failed items retry individually."
- **What 2.0 would do.** After a partial failure, the successful items complete at once. The failed ones run again under the batch's retry policy, as a smaller call to `resolveBatchWithResults` with only them. They do not go through `resolve()`, which a batched resolver may not have.
- **Recommendation.** Approve.

#### B3 the fuzz model gains a batched resolver

- **What the tree does.** The fuzz model has no batch, so nothing random reaches L7.
- **Recommendation.** In L7-pre, add a batched resolver with a short window to `diff/fuzz/model.ts`, placed at L7. It runs on 1.35 from L7-pre, and on v2 only once `current` is L7, so the PR fuzz and the nightly run cover it from the gate on.

#### B4 the `batch-fanout-100` workload

- **What 2.0 would do.** One pass raises 100 requirements for one batched resolver; time and bytes per flush. The L7 gate judges it at 1.0 or better against 1.35.
- **Recommendation.** Approve the shape before L7a.

### C. Engineering defaults that keep parity (no decision needed)

- **The window timer runs on the kernel clock**, as L2's retry waits do. Under the harness's fake timers it matches 1.35's `setTimeout`.
- **The batch config is resolved once per definition**, not copied on every add.
- **A requirement-to-queue index** replaces 1.35's search of every queue on abort. The order of cancels stays 1.35's.
- **The 10,000 cap stays**, as a production limit with no message, as 1.35.
- **R2's two messages stay in production.** 1.35 throws them in both modes.
- **The last non-undefined baseline wins** for a batch's binding (W5), as 1.35.
- **Quirk n applies to a batch attempt**: a timeout aborts that attempt's signal with the timeout error.

## Evidence: probes

One probe script ran with real timers against the published 1.35 (`packages/conformance/node_modules/directive-v1`, `dist/development` and `dist/production`, version `1.35.0`). It does not live in the repo; L7-pre turns each probe into a conformance test or diff scenario (U1 to U11). Timings are rounded to 10 ms. Development and production gave the same results except B10, and B3b's last retry, which landed at 310 ms in production against 320 ms in development (timer jitter).

- Probe source: `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l7-rfc/probe.mjs`
- Output: `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l7-rfc/out-dev.json` and `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l7-rfc/out-prod.json`
- Forced-L7 runs: `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l7-rfc/v2.json`, `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l7-rfc/v2dist.json` and `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l7-rfc/diff.json`, summarised in `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l7-rfc/summ.txt`
- Size: `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l7-rfc/size.log`; the 1.35 fragment `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l7-rfc/frag.ts`
- The design review's rerun on the production build, same results: `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l7-review/rerun-prod.json`. It adds `unmetAfter` to B2 (`[a, c]`).

Every probe builds one module: a `want` fact lists ids, a constraint raises one `FETCH` requirement per id, and the resolver `fetch` is keyed by id. A plugin records the resolver hooks.

| Probe | Steps | 1.35 |
|---|---|---|
| B1 | `windowMs: 50`; add a requirement every 30 ms, six times | One call, `abcdef`, at 210 ms |
| B1b | `windowMs: 50`; add a requirement every 20 ms, twenty times | One call of 20, at 450 ms; nothing before |
| B2 | `resolveBatch` takes 60 ms; `want` is `[a, b, c]`; at 75 ms, `want` becomes `[a, c]` | The handler's signal aborted; `a`, `b` and `c` canceled, each with keys `id`; no complete; the handler did not run again in the next 300 ms; `a` and `c` stayed unmet (`unmetAfter: [a, c]`, from the rerun) |
| B6 | `want` is `[x, y]`; at 10 ms, `want` becomes `[x]` | `y` canceled, keys `requirement,id,fromConstraint`; `x` completed at 50 ms |
| B3 | `resolveBatchWithResults` fails every item; retry 3 attempts, exponential, 100 ms, a counting `shouldRetry` | Calls at 10, 10 and 10 ms; no retries; `shouldRetry` asked 0 times; 6 errors for 2 requirements |
| B3b | The same policy; `resolveBatch` throws | Calls at 10, 110 and 320 ms; retries `#2` and `#3` for each requirement; 2 errors; `shouldRetry` asked 3 times |
| B4 | With-results: `a` succeeds, `b` fails; 3 attempts; then an unrelated write | One call; `a` completed; `b` errored once; no retry, and the later pass did not run `b` |
| B5 single | Two ids from one constraint with `abortOn: ["status"]`; the handler writes `status` after 60 ms; `status` set to `"external"` at 40 ms | `status` stayed `"external"`; signal aborted; no outcome reported |
| B5 mixed | One id from each of two constraints, both with `abortOn: ["status"]`; the same writes | `status` became `"from-batch"`; signal not aborted; both completed |
| B7 | `resolveBatch` takes 100 ms; `want` is `[a]`; call `settle()`; `inspect()` while queued and while running | Handler started at 0 ms and ended at 100 ms; `settle()` resolved at 0 ms; `inspect().inflight` empty both times |
| B8 | `batch.enabled` with only `resolve()`, 60 ms each; `want` is `[a, b, c]`; at 75 ms, `want` becomes `[a, c]` | No cancel; no signal aborted; all three completed at 110 ms |
| B8b | The same; `stop()` at 75 ms | No cancel; both completed at 110 ms, after the stop |
| B10 | `batch.enabled` with no handler | Development: `createSystem` threw "Resolver "fetch" must define either resolve() or resolveBatch() …". Production: no error; `a` completed |

**Reading the table:** B1 and B1b are (ap). B2 is quirk g, including 1.35's rule that a canceled requirement that is still wanted never runs again; with B6 it is (aq). B3 is quirk h and (ar); B3b shows the thrown-batch path that h and (ar) align with. B4 is quirk i. B5 is quirk k, with its single-source control. B7 is (as), B8 and B8b are (at), and B10 is the production pin U9.
