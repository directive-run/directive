# RFC: L5 sources

Status: draft for review, revision 2 (after the design review). No engine code merges from this document.
Tree: branch `p5/l5-rfc`, cut from `main` at `513064e2` (L0 to L3 built and gated, L4 built; `layers.rules.json` `current` is `"L3"`; the L4 gate, #316, is open). The measurements below also include the L5 oracle tests of the open PR #317 (`p5/oracle-l5-gate-debt`, cut from the same commit), copied into the working copy for the run and removed afterwards. Nothing in `packages/conformance` is changed by this PR.

**Changes since revision 1.** The design review ran six more probes against the built 1.35 (R1 to R6, listed under Evidence) and found problems in the first draft. Fixed here: `onEvict` follows attach order, not declaration order (V1); a failed attach's publish handle stays live (A3); K3 is narrowed to payloads queued after the closing write; (aa) now covers a return to the old key inside a retry's linger window; the clock default no longer compares an epoch time against `performance.now`; the `sources.test.ts` fate is amended, not split (U6); candidate (z) is renamed (ac), because (z) is already an approved row; the size projection is labelled an estimate with a measured upper bound; the plan's `aperture` is a real-lab copy at L6, so the synthetic fixture is dropped from L5-pre and made a decision (A2); and the decisions are rewritten as real decisions with a recommendation each.

## What we are building

L5 is sources. The plan's row reads "`source()`: attach, key/active gates, linger, coalesce, onEvict, module-scoped publish", sized as "Aperture ~5.4", and marked opt-in. The behaviour is 1.35's, as RFCs 0007 (coalesce), 0008 (`reportError`), 0009 (async stop and `onEvict`) and 0012 (gated and keyed sources, `docs/rfcs/0012-gated-keyed-sources.md`) describe it. No GATE file places an approved quirk at L5.

The rules are the ones L2 to L4 settled on. Parity with 1.35 is the rule, and when this document and 1.35 disagree, 1.35 wins. Every run ends in one outcome. One scheduler and one clock. The dev-string count stays exact. Every layer slice runs `conformance:diff` at the forced layer and checks the open gates. The layer gate runs green before the first build slice.

**What may differ from 1.35.** Nothing is approved yet. Three **candidate divergences**, lettered after the ones already used ((a) to (z)), are listed under "Decisions for the owner": (aa), (ab) and (ac). Each is built only if Jason approves it. Until he does, the slice keeps 1.35's behaviour.

| If "approved" means | Then this gets built |
|---|---|
| The sources part | A new opt-in part, `api/sources.ts` (`withSources`), wired in through three seams in the core: start, after the effects phase, and stop. It does everything 1.35's manager does at L5: attach and detach, publish with drop reasons, module-scoped publish, plugin hooks, attach and runtime errors, async teardown with timeouts, gates, linger, retry, coalesce and `onEvict`. |
| `system.evict()` | Moves from L10 to L5 with `onEvict` (B1), since neither does anything without the other. |
| The oracle first (L5-pre) | Black-box pins for every rule that only the white-box `sources.test.ts` covers today, a 68-row mapping of that file in `WHITE-BOX.md`, and a source in the frame-loop bench. |
| Candidates, built only if approved | (aa) a failed re-key leaves the source detached, so its retry is a rising edge, never lingers, and a return to the old key attaches at once. (ab) coalesced publishes still queued when a gate closes count as `gate-closed` drops, after `onSourceDetach`. (ac) a failed gated attach retries on the clock, not only when something else causes a pass. |
| Not built at L5 | `inspect().sources` and its counters (L9), `source.*` observation events (L9), sources on a module registered at runtime and the id collision check (L10), the replay guard (L8). |

**In plain terms:** core-next has no sources at all today: a module's `sources` are checked for dangerous keys and then ignored, so nothing attaches. L5 is one self-contained part. The three candidates are small fixes to 1.35's retry and coalesce corners. The one real tension is size: in the alpha, a 1.35 config declares sources with no import, so the code cannot stay out of `minimal` until the beta's `source()` wrapper (A1). That raise is an estimate, 1.7 to 2.5 KB, with a measured upper bound of 4.3 KB, and it needs Jason's OK.

## Gap analysis, measured

What I ran: `layers.rules.json` `current` set to `"L5"` in the working copy only, with #317's nine files copied in, then `npx vitest run --project conformance:v2`, `--project conformance:v2:dist` and `--project conformance:diff` from `packages/conformance`, with the JSON reporter. Then every file went back: `git status` was clean and `current` read `"L3"` again.

| Run | Tests | Pass | Fail | Skipped |
|---|---|---|---|---|
| `conformance:v2` at forced L5 | 3,118 | 1,323 | 16 | 1,779 |
| `conformance:v2:dist` at forced L5 | 3,118 | 1,323 | 16 | 1,779 |
| `conformance:diff` at forced L5 | 253 | 239 | 14 | 0 |

**Reading the table:** the two v2 runs fail on the same 16 tests, and every one is placed at L5, so nothing at L0 to L4 has slipped. 87 tests are placed at L5, but 68 of them are in `sources.test.ts`, which is classified internals (it imports `createSourcesManager`), so v2 skips the whole file. Of the 19 black-box L5 tests, 17 run in the development project: 16 fail and 1 passes. The other 2 are production-only files (`l5-sources-oracle-production`, `nested-mutation-checks.production`) that this run did not cover.

| Feature | Failing | Representative tests |
|---|---|---|
| Attach and detach | 2 | "plugins and a source's lifecycle: hear its attach at start, its publish, and its detach at stop, which unsubscribes it"; `system-async-lifecycle` "system.stopAsync() awaits an async source unsubscribe" |
| Errors | 1 | "a source whose attach throws: is reported to plugins as an attach error, and the next source still attaches" |
| Publish and drop reasons | 3 | "a publish the engine refuses: is a drop with its reason: an empty name, a blocked name, a name with no handler"; "… dropped as post-stop …"; "… dropped as post-destroy …" |
| Module-scoped publish | 3 (+1 production) | "a namespaced source: publishes its own module's event by its bare name"; "drops another module's event as cross-module, and development warns once per source"; "drops its own event named with its prefix …" |
| Active gate | 1 | "a gated source: whose gate is open at start is attached when start() returns" |
| Gate read checks | 4 (+1 production: "a gate mutating a value in place still attaches") | `nested-mutation-checks` "a gate that only reads attaches"; `nested-mutation-snapshot` "never runs a getter while recording", "a gate reading a large value stays cheap per write", "a gate that fails closed warns once in development when nothing else is listening" |
| Gates in a composed system | 2 | `l3-proxies-oracle-gates` "reads the module's own facts by bare name, and reflects them"; "with crossModuleDeps reads under self and the dependency's name" |
| Plugin source hooks | 0 of their own | 7 of the 9 oracle tests observe through `onSourceAttach`, `onSourcePublish`, `onSourceDrop`, `onSourceDetach` and `onSourceError`, so they fail with the features above |
| Key gate, linger, coalesce, retry, onEvict | 0 | No black-box test exists. They are covered only by the white-box file and the diff scenarios below |
| Already passing | 1 | `l3-engine-oracle-boundaries` "a dangerous key in sources" (core-next already checks `sources` keys, `api/core.ts:387`) |
| **Total failing** | **16** | |

**Reading the table:** every failure has one cause, that core-next never calls `attach`, which is why several tests fail with "handles.feed is not a function". The more important row is the second to last: key gates, linger, coalesce, retry and `onEvict` have no black-box test at all, so v2 could build them wrong and only the diff scenarios would notice. That is the main oracle gap, and L5-pre exists to close it.

| Failing diff scenario | Differences | Why |
|---|---|---|
| "sources: attach, publish, active gate and detach" | 63 | No sources on v2 |
| "sources: a publish naming another module's event is dropped" | 23 | The same |
| "a key gate re-keys the source and detaches on null" | 32 | The same |
| "gateLingerMs keeps a closed gate attached for a while" | 16 | The same |
| "coalesce lastWriteWins drops superseded publishes in a microtask" | 48 | The same |
| "onEvict runs on evict; a throwing attach reports a source error" | 31 | The same; and `evict` is placed at L10 by the detector (B1) |
| Differential fuzz (seed 24301) | shrunk to one case | Two modules, an ungated source on the second, one batch write. The fuzz model places sources at L5, so it fails for the same reason |
| Seven L4 scenarios (the disable/enable and membership ones) | 3 to 18 each | Not L5. They are the approved L4 quirks (c), (w), (x) and (y), whose signed `divergences.json` entries are in the open L4 gate, #316. They pass once it merges |

**Reading the table:** the six L5 scenarios and the fuzz case are the whole L5 diff gap, and none is an approved quirk or a candidate yet. The seven L4 rows are expected on `main` today and are the open-gate check's business: every L5 slice runs the census at L4's ceiling too, while #316 is open.

## The design: each 1.35 rule, the mechanism that keeps it, and its pin

Where a row says "verified", the behaviour was observed by running a probe against the built 1.35 package; the output is in "Evidence" at the end. The rest is read from the code, with lines cited. 1.35 paths are under `packages/core/src/core/`, core-next paths under `packages/core-next/src/`.

### How sources plug in, and what they cost `minimal`

**In plain terms:** sources become one part, like effects. It costs nothing in a system built without it. But in the alpha, a 1.35 config declares sources with no import, so `createSystem` has to carry the part, and `minimal` pays for it until the beta.

core-next composes a system from parts. `createSystem` passes a fixed list (`api/system.ts:37–45`: effects, reconcile, inspect, observe, plugins, plus validation in development) to `createSystemCore` (`api/core.ts:348–354`), and each part wires itself in through the kernel's feature registry (`api/core.ts:192–193`, `kernel.ts:115–124`). The `floor` size fixture is `createSystemCore` with no parts. The plan's feature mechanism (`interface Feature`, `featureMissing`, the `source()` wrapper) is not built yet.

| Question | Answer |
|---|---|
| Can the sources code stay out of `minimal` in the alpha? | No. A bundler keeps whatever `createSystem` can reach. Checked against 1.35: its `index.ts:93–100` exports only the source *types*, so there is nothing to import; a module's `sources:` key is a plain object and needs no import; so the alpha's `createSystem` must reach the sources part. Effects, inspect, observe and plugins are in `minimal` today for the same reason. A lazy `import()` cannot work: attach must happen inside `start()`, and the oracle pins "attached when start() returns". The plan also has no code-split modules in the alpha. |
| What stays out? | `floor` and `createSystemCore`: the part is a separate file that only `createSystem` imports. The core gains three optional calls (`features.sources?.start_()`, `gate_()`, `stop_()`), about 40 to 80 B in `floor`. |
| When does it leave `minimal`? | At beta, when the API changes land with the codemod: the plan's codemod already lists "history/trace/sources/dynamic imports". A source then comes from `source()` (or a `sources()` feature value), and `createSystem` stops wiring the part. |
| Is there an opt-in today that keeps 1.35 configs working? | Not without changing call sites, which would break "the existing tests run unchanged on both engines". Making the conformance alias inject the feature would test a shim, not the published API. Not recommended (A1). |

**Reading the table:** "opt-in" in the plan's row is a beta property. In the alpha it can only mean that the code is a separate part that `floor` does not contain. So L5 will raise the `minimal` budget, which has 11 B of room today.

The seams, in core-next's terms:

- `start_`: called in `start()` after the modules' `onStart` hooks and before `emit("system.start")` (`api/core.ts:1346–1350`), as 1.35 attaches after `onStart` and before the start event (`engine.ts:3347–3429`).
- `gate_`: called after the effects phase of every pass (`api/core.ts:1118–1126`), as 1.35 does (`engine.ts:1932–1951`).
- `stop_`: called at the start of `stopped()`, before `features.effects?.cleanupAll()` (`api/core.ts:1206–1207`), as 1.35 detaches sources before effect cleanups (`engine.ts:3473`). Its async half is awaited where 1.35's `stopAsync` awaits `cleanupAllAsync` (`engine.ts:3512–3533`).

### Attach and detach

**In plain terms:** a source attaches at start and detaches at stop, in a fixed order, and a broken source never stops the others.

| # | 1.35 rule | 2.0 mechanism and seam | Pinned by |
|---|---|---|---|
| A1 | At `start()`, after the modules' `onStart` hooks, every ungated source attaches in declaration order (`engine.ts:3361`, `sources.ts:1034–1056`). Gated sources are left to the gate evaluation that follows at once (`engine.ts:3426`), so a source whose gate is open at start is attached when `start()` returns, before the start event and the first pass. The **attach order** is therefore ungated sources first, then gated ones as their gates open; it is not the declaration order, and later rules (A4, V1) follow it. | `start_`. | oracle "hear its attach at start …" and "whose gate is open at start …" (both fail today) |
| A2 | `attach(publish, reportError)`; a keyed source also gets `{ key }` (`sources.ts:747–752`). The record exists before `attach` is called, so a publish made inside `attach` (the seed pattern) is dispatched (`sources.ts:610–639`). Verified, probe P5: the seed's write is in the facts when `start()` returns. | Same. | L5-pre pin (U5) |
| A3 | `attach` must return a function. A promise gets its own message; anything else gets "did not return an unsubscribe function"; both are attach errors, and the source is never added to the attached list: no `onSourceAttach`, and it is not stopped or evicted (`sources.ts:753–770`). A throw is an attach error, and the next source still attaches (`sources.ts:787–797`). **The publish handle of a failed attach stays live.** The record's `detached` flag is set only by a detach, and a failed attach never detaches, so a publish through the handle still dispatches and fires `onSourcePublish`. Verified, review probe R2: an attach that returned a Promise was reported as an attach error, then `publish("tick")` ran the handler once and fired `onSourcePublish`, with no `onSourceAttach`. (The non-function and throw paths take the same route in the code; only the Promise path was run.) | Same messages, and the same live handle. They reach plugins through `onSourceError`, so they are not dev-only. | oracle "a source whose attach throws …"; L5-pre pins for the promise and non-function cases, and U8 for the live handle |
| A4 | `stop()` detaches every source in reverse **attach** order, before the effects' cleanups (`engine.ts:3473`, `sources.ts:1090–1128`), so a gated source, attached last, detaches first (review probe R1: gated `g1` declared first; attach `u2, u3, g1`; unsubscribe `g1, u3, u2`). The record is flagged detached first, then `onSourceDetach` fires, then `unsubscribe` runs; a throw there is a cleanup error. A promise from `unsubscribe` is not awaited. | `stop_`. | oracle lifecycle test; U7, the order pin, with a gated source in it |
| A5 | `stopAsync()` and `destroyAsync()` await each `unsubscribe`, capped by the source's `evictTimeoutMs` or 5 s. `Infinity` disables the cap; zero, negative or non-finite values fall back to 5 s. A hang is a cleanup error and teardown goes on (`sources.ts:129–187, 1130–1182`). | The async half of `stop_`. Timers on the kernel clock (C list). | `system-async-lifecycle` "stopAsync() awaits an async source unsubscribe" (fails); L5-pre pins for the timeout and the override |
| A6 | Stop then start attaches again, with fresh counters and gate state (`sources.ts:1035–1046`). | Same. | L5-pre pin |

**Reading the table:** nothing here is in doubt; it is a port. A4's order matters because a source and an effect can share a resource, and 1.35 promises the source side lets go first. The order pin must include a gated source declared before the ungated ones, or it passes on declaration order.

### Publish

**In plain terms:** a publish is an event dispatch with guards. Every refusal has a name, and plugins hear it.

| # | 1.35 rule | 2.0 mechanism and seam | Pinned by |
|---|---|---|---|
| P1 | A publish is dispatched at once into the event handlers (`engine.ts:3409–3418`). It is refused, as a drop with a reason, when the system is destroyed (`post-destroy`) or stopped (`post-stop`), the name is empty or not a string (`invalid-event-name`) or blocked (`blocked-event-name`), or no handler exists (`unknown-event`) (`engine.ts:3376–3418`). An accepted publish fires `onSourcePublish`; a drop fires `onSourceDrop` (`sources.ts:649–669`). | The part's publish closure calls core-next's event dispatch. The guard returns a reason string or nothing, not an object per publish, so the frame path allocates nothing (C list). | oracle "a publish the engine refuses" (3, fail) |
| P2 | Module-scoped: a namespaced source (`ns::id`) publishes a bare name, which is scoped to `ns::name`. A name that contains `::` is a `cross-module-event` drop under its original name, and development warns once per source with the fix (`engine.ts:3385–3402, 2300–2320`). Production drops without a warning. | Same; the warning is a dev string. | oracle "a namespaced source" (3, fail) and its production twin |
| P3 | A publish through a detached record is dropped: silently after stop or re-registration, and counted as `gate-closed` after a gate close (`sources.ts:618–631, 649–653`). | Same. | white-box only; L5-pre pin |
| P4 | `reportError(err)` reports a runtime error, phase `runtime`, and does nothing after detach (`sources.ts:735–743`). | Same. | white-box only; L5-pre pin |
| P5 | Plugins hear `onSourceAttach` only after a successful attach and `onSourceDetach` before the unsubscribe. `onSourceError` gets the phase (attach, cleanup, runtime or gate) and a message cut at 256 characters (`sources.ts:76–89, 555–592`; `engine.ts:1185–1207`). Source errors go to plugins and the console, never to the error boundary. | Five more hook names on core-next's one hook stream (the plugins part). | oracle tests (7 of 9 observe through plugins); L5-pre pin for the 256-character cut |

**Reading the table:** P1 and P2 are what the oracle tests check today. P3 to P5 are pinned only in the white-box file, so L5-pre ports them. The engineering default in P1, a reason string instead of a result object, is invisible to users and keeps a source-driven frame free of allocation.

### Gates

**In plain terms:** a gate is a pure read of the facts that says whether, and under which key, a source should be attached. It is checked after every pass and fails closed.

| # | 1.35 rule | 2.0 mechanism and seam | Pinned by |
|---|---|---|---|
| G1 | `key(facts)` returns a string or null. `active(facts)` is sugar for a key that is `"__on__"` only when `active` returns exactly `true`. Declaring both throws at creation (`sources.ts:507–526`). | Same, when the part installs. | white-box only; L5-pre pins |
| G2 | Gates are evaluated after the effects phase of every pass and once at start; a pass that follows a history navigation skips them (`engine.ts:1932–1951, 3426`). Every gate is called on every such pass. | `gate_`. The navigation skip arrives with L8. Gates stay called on every pass (C list). | diff "sources: attach, publish, active gate and detach"; L8's replay test when L8 lands |
| G3 | Fail closed: a gate that throws, or returns anything but a string or null, counts as null (detach if attached) and is reported with phase `gate`. Development warns once per source (`sources.ts:1234–1268, 583–592`). | Same. | `nested-mutation-snapshot` "a gate that fails closed …" (fails); L5-pre pins |
| G4 | Edges: a rise attaches at once and never lingers; a fall detaches; a changed key detaches the old subscription and then attaches the new one with `ctx.key` (`sources.ts:942–972`). Teardown flags the record before `unsubscribe` (`sources.ts:810–834`). | Same. | diff "a key gate re-keys the source and detaches on null"; L5-pre pins |
| G5 | Development hands the gate a checked read-only view: a write or an in-place change is a gate error (`sources.ts:902–940, 1237–1253`). Production passes the facts and checks nothing. | core-next's development read-only view (`api/readonly.ts`); 0 B in production. | `nested-mutation-checks` and `-snapshot` (4 fail, plus 1 production) |
| G6 | In a namespaced system, a gate reads its own module's facts by bare name, and with `crossModuleDeps` it reads under `self` and the dependency's name (the expectations of the two failing `l3-proxies-oracle-gates` tests). | The namespaced facts view constraints already get. | `l3-proxies-oracle-gates` (2, fail) |

**Reading the table:** G2 is the one row with a design choice in it. A gate could be tracked like a derivation and called only when a fact it read changes. That would save a call per pass, but a gate that reads anything outside the facts would stop being re-checked, so it is listed as a default against it (C list).

### Linger

| # | 1.35 rule | 2.0 mechanism and seam | Pinned by |
|---|---|---|---|
| L1 | `gateLingerMs` delays the teardown of a fall or a re-key by a timer; the committed key stays until it fires (`sources.ts:955–970`). | A timer on the kernel clock, owned by the system so `destroy()` clears it. | diff "gateLingerMs keeps a closed gate attached for a while" |
| L2 | Inside the window: a return to the committed key cancels the timer and attaches nothing, which is a problem if the committed key's subscription is already gone (T3); the same target leaves it running; a third key detaches the committed subscription at once and attaches the new one (`sources.ts:1273–1297`). | Same. | white-box only; L5-pre pins for cancel, sustained, re-key and third key |
| L3 | Stop and start clear pending timers (`sources.ts:1043–1046, 1124–1127`); so does unregistering a module (`1079–1083`, L10). | Same. | L5-pre pin for stop |

**Reading the table:** linger is a port. The third-key rule (L2) is RFC 0012's safety guarantee G5, that a flapping key cannot keep an old channel open forever, so it gets its own pin.

### Retry after a failed attach

**In plain terms:** when a gate is open but the attach failed, 1.35 tries again with backoff. Two corners of that look wrong, and they are candidates (ac) and (aa).

| # | 1.35 rule | 2.0 mechanism and seam | Pinned by |
|---|---|---|---|
| T1 | A failed gated attach leaves the key uncommitted and retries with a backoff of 250 ms doubling to 30 s, with no limit (`sources.ts:848–900`). A retry recorded for a different key never delays this one. | Same. | white-box only; L5-pre pins |
| T2 | The retry happens only inside a gate evaluation (`sources.ts:1299–1307`), and gates are evaluated only on a pass (`engine.ts:1948`) or at start. Verified, probe P1 and again review probe R5: on a quiet system the source had made one attempt after 400 ms, past its 250 ms backoff, and made the second only after an unrelated write. | Without (ac): copied. With (ac): the backoff arms a timer that evaluates that gate when it ends. | a diff scenario for (ac) |
| T3 | A re-key whose new attach fails leaves `lastKey` at the old key, which was just torn down (`sources.ts:956–960, 892`). The next evaluation sees a re-key again, and with `gateLingerMs` it waits a whole linger window before retrying. Verified, probe P3: after the backoff, an unrelated write did not attach `b`; it attached one linger window later. **A return to the old key does not rescue it.** Inside that retry's linger window, going back to `a` cancels the timer (L2) but attaches nothing, since `a` is the committed key and its subscription is gone (`sources.ts:1273–1281`). Verified, review probe R4: after the return, the source stayed dark through 400 ms of quiet and attached only after another unrelated write. | Without (aa): copied. With (aa): a failed attach after a teardown commits null, so the retry is a rising edge, and a return to the old key is one too. | diff scenarios for (aa): U2 and U9 |

**Reading the table:** T1 is the rule; T2 and T3 are where its comment ("it never gives up") and its code disagree. They only matter when a transport is down, which is exactly when they matter most.

### Coalesce

| # | 1.35 rule | 2.0 mechanism and seam | Pinned by |
|---|---|---|---|
| K1 | `coalesce: "lastWriteWins"` keeps one pending payload per event name until a microtask; a second publish of that name replaces it and counts a `coalesced` drop; the flush dispatches in first-publish order (`sources.ts:680–720`). `"all"` and unset dispatch every publish at once. | Same, with `queueMicrotask` as 1.35, so the flush keeps its order against the reconcile microtask. | diff "coalesce lastWriteWins …"; L5-pre pins |
| K2 | A re-key starts with an empty buffer, because the buffer lives in the attach closure. | Same. | L5-pre pin |
| K3 | Payloads still pending when the record detaches are thrown away with no count (`sources.ts:705–710`). Which payloads: only those queued **after** the write that closes the gate, in the same tick. The flush microtask was queued by the first publish, ahead of the pass that evaluates the gate, so publishes made **before** the closing write are flushed and dispatched first. Verified, probe P2 (close, then two publishes in the same tick): one `coalesced` drop counted, the surviving payload never dispatched and never counted. Verified, review probe R3 (two publishes, then the closing write): one `coalesced` drop, and the second payload published and handled once. | Without (ab): copied. With (ab): each payload still pending at a gate close counts a `gate-closed` drop, after `onSourceDetach`. | a diff scenario for (ab) |

**Reading the table:** K3 is the only coalesce question. RFC 0012's guarantee G3 says an in-flight publish after a gate close is counted; a coalesced publish queued in the same tick as the close is in flight too, and goes uncounted. Publishes made before the closing write are not affected (review probe R3).

### onEvict and evict

| # | 1.35 rule | 2.0 mechanism and seam | Pinned by |
|---|---|---|---|
| V1 | `system.evict(deadline?)` does nothing while evicting or destroyed; otherwise it runs every attached source's `onEvict` in **attach** order (ungated first, then gated; `sources.ts:1034–1056, 1195`), each capped by its timeout, with errors as phase `runtime`, then `destroyAsync()` (`engine.ts:3559–3585`, `sources.ts:1184–1221`). Verified, review probe R1: gated `g1` declared first; evict `u2, u3, g1`. | `evict` on the system and `evictAll` in the part; both at L5 under B1. Iterates the attached list, not the declarations. | diff "onEvict runs on evict …"; U7 for the order |
| V2 | `deadline` is a wall-clock time in epoch milliseconds. One already past starts the work and returns at once; otherwise the work races the time left (`engine.ts:3570–3584`). | Same. The time left is `deadline - Date.now()`, and only that duration goes to a kernel-clock timer (C list). | L5-pre (U4) |
| V3 | `start()` during an eviction is ignored, with a development warning (`engine.ts:3303–3322`). | Same. | L5-pre pin |
| V4 | A detached source, such as a gated one whose key is null, is skipped (`sources.ts:1195`). | Same. | white-box only; L5-pre pin |

**Reading the table:** the scenario "onEvict runs on evict …" calls `system.evict(100)`, which is a deadline in 1970. So it tests only the path that returns at once: in probe P4, `evict` resolved after 1 ms and `onEvict` finished later. The L3 scenario "async stop, evict and destroy" (`l3-lifecycle-plugins.test.ts:259`) calls `system.evict(50)`, also a 1970 deadline, with no source at all. So the past-deadline path is covered twice and the other two not at all. Both stay; L5-pre adds a future deadline and none (U4).

### Deferred to their own layers

- `inspect().sources` rows and their counters (`publishCount`, `dropCount`, `lastDropReason` and the rest, `sources.ts:105–119, 1317–1339`): L9. 11 tests of `sources.test.ts` and the `multi-module-correctness.prod` file sit there, and so does `localId`, a field of the inspect row (review probe R6) that WHITE-BOX.md lists as an L5 need. The L5 part keeps no counters; L9 adds them.
- `source.*` observation events (`engine.ts:3149–3195`): L9, with `observe`.
- Sources on a module registered at runtime, re-registration and `cleanupModule` (`sources.ts:975–1032, 1058–1088`), and the id collision check (`engine.ts:343–346`, moved to L10 by #317): L10.
- The replay guard (`engine.ts:1932–1951`, `followsNavigation`): L8.

## Untested L5 behaviours, and what will pin each

**In plain terms:** most of 1.35's source rules are pinned only by a white-box file that v2 never runs, and the probes found eight behaviours no test pins on either engine. Each needs a pin before the slice that could break it. "Conformance" means a test that runs on v1 and v2; "diff" means a scenario the diff harness runs on both.

| # | Behaviour | Evidence | Pinned by | Slice |
|---|---|---|---|---|
| U1 | A failed gated attach on a quiet system is not retried until something else causes a pass | Probe P1, review probe R5 | A diff scenario: gate open at start, first attach throws, advance past the backoff, then one unrelated write | L5-pre |
| U2 | A failed re-key with `gateLingerMs` retries only after another linger window | Probe P3 | A diff scenario: re-key to a key whose attach throws, advance past the backoff, an unrelated write, advance one window | L5-pre |
| U3 | Coalesced payloads queued after the closing write are dropped and not counted; payloads queued before it are dispatched | Probe P2, review probe R3 | A diff scenario reading `onSourceDrop` and the event handler, with both orders | L5-pre |
| U4 | `evict` with a past deadline returns at once and finishes later; with a future one it waits up to the deadline; with none it waits for all of it | Probe P4 (the past case) | The onEvict scenario (`evict(100)`) and the L3 scenario "async stop, evict and destroy" (`evict(50)`, no source) both stay and both test only the past case; add a future-deadline variant and a no-deadline variant | L5-pre |
| U5 | A publish inside `attach` at start is applied before `start()` returns | Probe P5 | A conformance test | L5-pre |
| U6 | The white-box-only rules: G1, G3 for `key`, G4, L2, L3, T1, K1, K2, P3, P4, the 256-character cut, A5's timeouts, V3, V4 | `sources.test.ts` (68 cases at L5, internals) and `multi-module-correctness.test.ts` (white-box) | Port by a 68-row mapping, not a split (below) | L5-pre |
| U7 | Attach, evict and stop order follow attach order, with a gated source declared first | Review probe R1 | A conformance test with a gated source declared before two ungated ones; asserts attach, evict and unsubscribe order | L5-pre |
| U8 | A failed attach's publish handle still dispatches, with no `onSourceAttach` | Review probe R2 | A conformance test: an attach that returns a Promise, then a publish through the captured handle | L5-pre |
| U9 | Inside a retry's linger window, a return to the old key leaves the source dark | Review probe R4 | A diff scenario: re-key to a failing key, advance past the backoff, an unrelated write, return to the old key, 400 ms of quiet, then an unrelated write | L5-pre |

**Reading the table:** U1 to U3 and U9 are where the candidates live, so each is a diff scenario: it shows the 1.35 behaviour now, and it shows the difference, with a `divergences.json` entry, only if the owner approves the candidate. U7 and U8 are plain parity pins. U6 is the bulk of L5-pre's work.

**U6 in detail.** `sources.test.ts` has 81 cases, 68 of them placed at L5. By what they drive, the review split the 68 into 22 that touch only the manager, 26 end to end, 18 gated and 2 that observe. Most need a rewrite, not a lift: only about 15 `createSystem` calls exist among the 46 end-to-end and gated cases, so most of those drive the manager by hand. So L5-pre's done means include a 68-row mapping in `packages/conformance/WHITE-BOX.md`: each case is ported, rewritten, deferred to L9 (for counters), or marked internal with a reason.

**WHITE-BOX.md's fate for the file has to change.** Today its table says `core/sources.test.ts`: "rewrite against `source()` — required gap", and its L5 gap bullet asks for "a public scenario set for `source()`". `source()` is a beta API that does not exist in the alpha, so tests written against it cannot run on either engine until then, and L5 would be built with no black-box coverage. The amendment, made in L5-pre's PR (an `oracle-change`): the fate cell becomes "rewrite as black-box tests through a module's `sources:` key (L5-pre); the `source()` form is a port at the beta"; the L5 gap bullet says `sources:` where it says `source()`, and drops `localId`, which belongs at L9 (the inspect row's field, review probe R6); and the 68-row mapping is added under it.

## Performance

What I ran: `node bench/system/run.mjs --rounds 6` in `packages/core-next` (both engines built at `513064e2`, production, `process.env` swapped as for a bundled app, thread CPU time, median of 6 rounds, Apple M4 Pro, load 3.6 to 4.3 on 14 cores). Ratio is core-next's time over 1.35's, so 0.65 means core-next takes 65% of 1.35's time.

| Workload | 1.35 ns/op | core-next ns/op | core-next / 1.35 |
|---|---|---|---|
| scalar-writes | 121 | 80 | 0.67 |
| chain-10 | 3,345 | 2,066 | 0.61 |
| fanout-derive-50 | 18,048 | 10,351 | 0.56 |
| fanout-effect-50 | 16,965 | 7,782 | 0.46 |
| **frame-loop** (20 batched writes, 10 derivations, 5 effects, 2 reading `prev`, settle) | 11,235 | 7,351 | **0.65** |
| subscribe-1000 | 4,441 | 3,958 | 0.89 |
| batch-100 | 16,075 | 9,949 | 0.62 |
| multi-module-20 | 18,928 | 15,479 | 0.82 |
| create-destroy-1000 | 55,921 | 25,714 | 0.46 |
| startup-10-modules | 169,440 | 112,317 | 0.69 |

| Heap, steady state | 1.35 | core-next |
|---|---|---|
| Bytes per fact write | 88.0 B | 0.0 B |
| Bytes per write, with its settle | 92.5 B | 4.3 B |
| Bytes per frame (frame-loop) | 24,854 B | 19,872 B |

**Reading the tables:** the frame loop is at 0.65 of 1.35's time, so GATE-0's "0.8x or better on the frame loop by L5" is met today, with room of about 1.6 µs per frame. But the workload has no source in it, and an Aperture frame arrives through one. So the number does not yet measure what L5 adds. Allocation is the other gap: about 19.9 KB per frame against the plan's Aperture target of 1 KB. That target is not an L5 gate item, but the bench should keep reporting it.

What L5 must keep, and what it adds:

- No workload slower than `main` by more than 5% after any L5 slice, and every workload at 1.0 or better against 1.35.
- L5-pre adds a `frame-loop-source` workload (B2): per frame, a gated, coalesced source publishes one `frame` event whose handler makes the frame's 20 writes in one batch, and the gate is evaluated after the pass. The L5 gate judges it at 0.8 or better.
- On that path a publish allocates nothing but its payload (P1's reason string), and the gate check is one call and one string compare per pass. 1.35 builds a result object per publish (`engine.ts:3376–3418`).

## Slice plan

**In plain terms:** an oracle slice, two build slices and the gate. Each build slice is one PR at the committed `current`, tested at a forced L5 locally, as L4 was. The layer gate runs twice before L5a: once for #317, and again after L5-pre.

| Slice | Builds | Done means (checkable) | Tier |
|---|---|---|---|
| Precondition (not an L5 slice) | #317 merges; a fresh `mutation-nightly.yml` run with `gate: L5`. | The L5 layer gate reports PASS (today: FAIL, 42 deferred entries, run 41342730189; #317 kills 37 by hand, moves 2 to L10, and the other 3 are already placed at L7 and L11). | test oracle; in flight |
| L5-pre (oracle) | U1 to U9. The 68-row `sources.test.ts` mapping and the amended fate in `WHITE-BOX.md`. `evict` placed at L5 in `lib/layers.ts` (B1). A `frame-loop-source` workload (B2). | The new tests pass on `conformance:v1` and `v1:prod`, and on v2 fail only as this document predicts. `WHITE-BOX.md` holds a 68-row mapping, every row one of ported, rewritten, deferred to L9 for counters, or internal with a reason, and the file's fate and L5 gap bullet are amended (`localId` moved to L9). **`conformance:diff` at forced L5 fails only the six L5 scenarios, the fuzz case with a source, and the new U1 to U4 and U9 scenarios. The open-gate check passes at the committed `current` and at the ceiling of every open gate (L4 while #316 is open).** `pnpm census`, `check:expects` and `oracle:update` exit 0. `oracle-change` label. | test oracle; Sonnet |
| Layer gate, again | Nothing built. A fresh `mutation-nightly.yml` run with `gate: L5` after L5-pre merges. | The L5 layer gate reports PASS with L5-pre's tests in the tree. L5a does not start before it does. | test oracle; coordinator |
| L5a | The sources part and its three seams: A1 to A6, P1 to P5, and V1 to V4 with `system.evict()` (under B1). | At forced L5 on v2 and v2:dist: the 9 non-gate failures pass (attach and detach 2, errors 1, publish 3, module-scoped 3), the production twin passes on `v2:prod`, and L5-pre's lifecycle, publish, error and evict pins pass (U4, U5, U7 and U8 included), listed by file and title. `conformance:diff` at forced L5: "sources: a publish naming another module's event is dropped" and "onEvict runs on evict …" match 1.35, and the fuzz passes for ungated sources. Census at the committed `current` and at every open gate's ceiling; ratchet exits 0. core-next `test`, `typecheck`, `build` and `size:check`, with the exact dev-string count stated (106 today, plus the cross-module and start-during-evict warnings). `floor` grows by at most 80 B. The `minimal` raise, if A1 is approved, in this PR, with the measured size and attribution in `reason`. | core; Opus implementer, Sonnet diff reviewer plus Fable correctness reviewer |
| L5b | G1 to G6, L1 to L3, T1 to T3 and K1 to K3, with (aa), (ab) and (ac) only if approved. | The 7 gate failures pass at forced L5 (the gate open at start, 4 read checks, 2 composed-system gates), and so do L5-pre's gate, linger, retry and coalesce pins. `conformance:diff` at forced L5: "a key gate re-keys …", "gateLingerMs …", "coalesce lastWriteWins …" and "sources: attach, publish, active gate and detach" match 1.35; U1 to U3 and U9 match, or differ only by an approved candidate, each named. A timer-armed retry, if (ac) is approved, is cleared at stop and destroy, and a test with `vi.runAllTimers` and a source that never attaches passes. `frame-loop-source` at 0.8 or better against 1.35, and no workload slower than `main` by more than 5%. The exact dev-string count stated (plus the gate warning and the two gate-write errors). Plus L5a's census, ratchet and core-next checks. | core; as L5a |
| L5-gate | `current` to L5, `ratchet --update`, diff and fuzz at L5, a `divergences.json` entry per approved candidate with `approvedBy` empty unless Jason says to sign, `/principal` on L5. | 0 L5 failures on v2, v2:dist and v2:prod. The census fails only on unsigned entries. PR fuzz and nightly run v2 at L5. | test oracle; Sonnet plus the coordinator's read of each entry |

**Reading the table:** L5-pre is bigger than L4-pre was, because L4 had black-box tests to start from and L5 mostly does not, and because most of the 68 mapped cases need a rewrite. L5a is a port with no decisions in it. L5b holds all three candidates and the speed target, so it carries the risk: a gate that attaches before the commit that opened it, or a linger that re-defers a teardown, is a privacy bug in RFC 0012's terms, not only a parity bug.

### Size

Measured with `node scripts/size.mjs` on this branch (production, minified, gzip). Budgets are `main`'s `size-budgets.next.json`.

| Fixture | 1.35 | core-next now | Budget | Room |
|---|---|---|---|---|
| `minimal` | 55,290 B | 25,489 B | 25,500 B | 11 B |
| `two-module` | 55,381 B | 25,572 B | 25,600 B | 28 B |
| `floor` (no parts) | n/a | 10,367 B | 10,400 B | 33 B |
| full entry | n/a | 27,596 B | 27,700 B | 104 B |
| `graph.ts` alone | n/a | 1,797 B | 1,850 B | 53 B |
| `aperture` | does not exist; the plan builds it at L6 | | | |

| Piece | Reference | Estimate for 2.0 (not built or measured) |
|---|---|---|
| 1.35's whole sources manager | `sources.ts` bundled alone, production: about 4.8 KB gzip (4,810 B in the first run, 4,792 B in the review's rebuild; esbuild 0.27). It includes the counters and inspect rows (L9) and runtime registration (L10) | |
| **Measured upper bound** | `minimal` (25,489 B) with the whole 1.35 manager added: 29,824 B, so **+4,335 B**. An upper bound: it counts L9 and L10 code that L5 leaves out, and 1.35's code where core-next's would replace it | |
| Research prototype | `sources.ts` in the size-plan research tree, bundled alone: 12,837 B minified, **4,723 B gzip** | |
| Lifecycle, publish guards, plugin hooks, attach errors, module scoping | `sources.ts:597–834`, `engine.ts:3361–3418` | +0.7–1.0 KB |
| Async teardown with timeouts, `evictAll`, `system.evict()` | `sources.ts:129–187, 1130–1221`, `engine.ts:3559–3585` | +0.3–0.45 KB |
| Gates, linger, retry | `sources.ts:483–526, 842–972, 1223–1311` | +0.5–0.75 KB |
| Coalesce | `sources.ts:680–720` | +0.12–0.2 KB |
| The three seams (in `floor` too) | | +40–80 B |
| (aa), (ab), (ac) | | +20–60 B |
| **Sum** | | **+1.7–2.5 KB** |

**In plain terms:** the 1.7 to 2.5 KB is an estimate from line counts, and no build has checked it. The two measured numbers around it are 4.3 KB (the whole 1.35 manager added to `minimal`) and 4.7 KB (the research prototype alone), so the real figure is likelier above the estimate than below it. Against 11 B of room, L5a and L5b each raise the budget with a written reason, after the plan's attribution step (find the bytes, move cold code, fold duplicates). No budget is raised until Jason approves A1: the approval covers a raise to the measured size, up to 2.5 KB in total, and a raise past that comes back to him. `floor` grows only by the seams, 40 to 80 B, against 33 B of room, so it is raised too, with a smaller reason. The plan's "Aperture ~5.4" predates the Phase 2 measurements and no longer applies: an Aperture-shaped app on core-next will be near 27 to 28 KB in the alpha (25.5 KB plus the estimate). The plan builds the `aperture` fixture at L6, as a copy of the real lab; whether L5 needs a synthetic one sooner is decision A2.

## What the plan got wrong, or left out

- **"Opt-in" cannot mean "not in `minimal`" in the alpha.** 1.35's `index.ts` exports only source types and a module's `sources:` key needs no import, so the code is reachable from `createSystem`. The opt-in arrives with the beta's `source()` wrapper and the codemod (A1).
- **"Aperture ~5.4" is a pre-Phase-2 number**, and the fixture does not exist yet. The plan builds it at L6 as a copy of the real lab (`scripts/size-fixtures/aperture.ts`); a synthetic shape sooner would depart from the plan (A2).
- **`onEvict` is in the L5 row, `evict` in the L10 row, inside `dynamic()`.** Neither does anything without the other. The scenario table puts "onEvict runs on evict …" at L5 while the detector puts `evict` at L10 (`lib/layers.ts`, `evict: "L10"`) (B1). And at the beta `evict` would live in `dynamic()`, so a system with sources but no dynamic modules could not evict (B3).
- **The representative files are white-box.** `sources.test.ts` is classified internals (81 cases, 68 at L5) and `multi-module-correctness.test.ts` is white-box, so v2 runs neither. Black-box L5 coverage is 19 tests and 6 scenarios. WHITE-BOX.md's fate for `sources.test.ts`, "rewrite against `source()`", points at an API that does not exist until the beta (U6).
- **The frame-loop bench has no source in it**, so the L5 speed target is met today by a frame that L5 does not touch (B2).
- **The onEvict scenario's `evict(100)` is a deadline in 1970**, and so is the L3 scenario's `evict(50)`, so only the return-at-once path is tested (U4).
- **1.35's retry "never gives up" only on a busy system** (T2), a failed re-key retries through linger (T3), and a return to the old key inside that window leaves the source dark.
- **`evict` and `onEvict` follow attach order**, not the declaration order the comments describe (V1).
- **The L5 layer gate fails today** (42 entries). #317 clears it; the rule is to see it pass before L5a, and again after L5-pre adds its tests.

## Decisions for the owner

A "no", or no answer yet, means the slice keeps 1.35's behaviour and pins it with a core-next test.

| Decision | Product verdict | Recommendation |
|---|---|---|
| **A1** sources in `createSystem` in the alpha | Same behaviour; `minimal` grows by an estimated 1.7 to 2.5 KB (measured upper bound 4.3 KB) until the beta | Approve; raise `minimal` to the measured size, up to 2.5 KB, and come back above that |
| **A2** the `aperture` fixture | No behaviour change; decides which number the alpha.0 gate quotes | Keep the plan: a real-lab copy at L6, nothing synthetic at L5 |
| **(aa)** a failed re-key leaves the source detached | Better, small change | Approve, in L5b |
| **(ab)** coalesced payloads pending at a gate close count as drops | Better, small change | Approve, in L5b |
| **(ac)** a failed gated attach retries on the clock | Better, small change | Approve, in L5b |
| **B1** `evict` moves to L5 with `onEvict` | Same | Move it |
| **B2** a `frame-loop-source` workload judges the L5 gate | No behaviour change | Approve the shape before L5b |
| **B3** where `evict` lives at the beta | Same if on the system; a change if only in `dynamic()` | Keep it on the system; decide before the beta, nothing to do at L5 |

### A. Decisions

#### A1 where the sources code lives in the alpha

- **What 1.35 does.** Sources are part of every system: about 4.8 KB gzip for the manager alone.
- **What 2.0 would do.** A separate part, wired into the alpha's `createSystem` because a 1.35 config needs no import (1.35's `index.ts:93–100` exports only types), and kept out of `floor` and `createSystemCore`. A lazy `import()` cannot work, since attach must happen inside `start()`. At the beta, `source()` (or a `sources()` feature value) and the codemod move it behind an import, and `minimal` drops by its size.
- **Product verdict.** Same behaviour. `minimal` grows in the alpha by an estimated 1.7 to 2.5 KB, which no build has checked. The measured bounds: adding the whole 1.35 manager to `minimal` is +4,335 B, and the research prototype is 4,723 B alone. So the estimate is a projection from line counts, with 4.3 KB as the upper bound.
- **Recommendation.** Approve, and raise `minimal` in L5a and L5b to the measured size with a written reason. The range to approve is up to 2.5 KB in total; a raise past that comes back to Jason. The alternative, an import now, breaks "the existing tests run unchanged on both engines" for every source test, or tests a shim instead of the published API.

#### A2 the `aperture` size fixture: real-lab copy at L6, or a synthetic shape now

- **What 1.35 does.** Nothing: there is no Aperture fixture in the repo, and the plan's Aperture numbers (~5.4 KB at L5, ~6.0 KB with a ceiling of 8 KB at L6) were set before Phase 2 measured `minimal` at 25 KB.
- **What the plan would do.** Build `scripts/size-fixtures/aperture.ts` at L6, as "a copy of the lab's shape kept in-repo", so its number compares with the lab's chunk sizes (Directive 41.7 KB, XState 12.5 KB).
- **What revision 1 of this RFC proposed.** A synthetic `aperture.ts` at L5-pre: the frame-loop module, one gated coalesced source and two effects reading `prev`. That departs from the plan: the same name on a different shape gives a number that does not compare with the lab, and L6 would have to replace it.
- **Product verdict.** No behaviour change. It decides which number the alpha.0 gate quotes.
- **Recommendation.** Keep the plan. Build the real-lab copy at L6; add nothing synthetic at L5. L5's size is judged by `minimal`, which carries the sources part in the alpha (A1), and its speed by `frame-loop-source` (B2). If Jason wants an Aperture-shaped number sooner, the synthetic fixture is a departure he has to approve; build it then, name it so it is not mistaken for the lab copy, and budget it at the L5 gate from measurement.

#### (aa) a failed re-key leaves the source detached

- **What 1.35 does.** After a re-key tears down the old subscription and the new attach fails, the committed key still names the old one. Each retry is then treated as another re-key, and with `gateLingerMs` it waits a linger window first (probe P3). A rise never lingers anywhere else (`sources.ts:950`). Inside a retry's linger window, a return to the old key cancels the timer but attaches nothing: the source stayed dark through 400 ms of quiet and attached only after an unrelated write (review probe R4, `sources.ts:1273–1281`).
- **What 2.0 would do.** A failed attach after a teardown commits "detached", so the retry is a rising edge: immediate once the backoff allows it. A return to the old key is a rising edge too, and attaches at once, also inside what was a linger window.
- **Product verdict.** Better, small change. It shortens how long a broken re-key stays dark, by one linger window per retry, and it removes a corner where a source stays dark with nothing left to wake it. Nothing visible at L9 changes: the `inspect().sources` row has no key field (review probe R6: `id`, `moduleId`, `localId`, `attached`, `attachedAt`, `detachedAt`, the counts, `lastError`).
- **Recommendation.** Approve, in L5b.

#### (ab) coalesced publishes pending at a gate close count as drops

- **What 1.35 does.** A `lastWriteWins` source's payloads queued after the write that closes its gate, in the same tick, are thrown away with no count and no `onSourceDrop` (probe P2), while a publish after the detach is counted as `gate-closed`. Payloads queued before the closing write are flushed and dispatched first (review probe R3), so they are not affected.
- **What 2.0 would do.** Each discarded pending payload counts a `gate-closed` drop and fires `onSourceDrop`. The drop fires after `onSourceDetach`: the detach is the cause, and the drops are counted where 1.35 clears the buffer, in the flush microtask's detached branch, which runs after the gate evaluation that detached the record. A stop or a re-registration stays silent, as today. Nothing more is dispatched.
- **Product verdict.** Better, small change. Plugins and, at L9, `inspect().sources` see a few more drops; no event or fact changes.
- **Recommendation.** Approve, in L5b. It makes RFC 0012's G3 true for coalesced sources. Declining it costs nothing but a quiet gap in the drop count.

#### (ac) a failed gated attach retries on the clock

- **What 1.35 does.** The backoff is checked only when a gate is evaluated, which happens only on a pass something else caused. A quiet system whose transport failed at attach stays dark until any unrelated fact changes (probe P1, repeated as review probe R5), although the code's comment says it never gives up.
- **What 2.0 would do.** When the backoff is armed, a timer on the kernel clock evaluates that source's gate as the backoff ends. Same delays (250 ms doubling to 30 s), same attach, nothing else re-run. One cost comes with it: a source that never attaches keeps a timer armed for good, so a test that uses `vi.runAllTimers` against such a source hits vitest's 10,000-timer abort. The timer must be cleared on stop and destroy, and skipped after a history navigation (L8), and L5b has a test for the first.
- **Product verdict.** Better, small change. An app that relied on a retry happening only alongside other work would see attaches at the backoff's end instead.
- **Recommendation.** Approve, in L5b. A data channel that should be open and silently is not is the failure the retry exists to prevent.

### B. Recommendations the owner may overrule

#### B1 `system.evict()` moves to L5, with `onEvict`

- **What 1.35 does.** `evict` runs every attached source's `onEvict` in attach order, then `destroyAsync()`. The plan puts `onEvict` at L5 and `evict` at L10, under `dynamic()`.
- **What 2.0 would do.** Both at L5: `evict` is small (`engine.ts:3559–3585`, about 0.1 KB), it is a system method every system has, and without it `onEvict` cannot run. `lib/layers.ts` places `evict` at L5, and the scenario "async stop, evict and destroy" moves to L5 if nothing else in it is L10.
- **Product verdict.** Same.
- **Recommendation.** Move it. The alternative, keeping `evict` at L10, moves the onEvict scenario to L10 and leaves `onEvict` built but unreachable for five layers.

#### B2 the `frame-loop-source` workload the L5 gate is judged by

- **What 1.35 does.** Nothing: the frame-loop workload has no source.
- **What 2.0 would do.** L5-pre adds an Aperture-shaped frame that arrives through a gated, coalesced source, as described under Performance, reporting time and bytes per frame. The L5 gate judges it at 0.8 or better; the existing frame-loop stays as the L4 yardstick. This is a bench workload, not the size fixture of A2.
- **Product verdict.** No behaviour change; it fixes the yardstick.
- **Recommendation.** Approve the shape before L5b, so L5b's work is measured on the gate's own yardstick.

#### B3 where `evict` lives at the beta

- **What 1.35 does.** `evict` is a method on every system.
- **What the plan would do.** Its L10 row lists "dynamic(): register/assign/unregister/call, registerModule, evict", so at the beta `evict` would come with `dynamic()`. B1 builds it on the system at L5; nothing in L5 depends on where it ends up.
- **Product verdict.** Same if it stays on the system. A change if it moves into `dynamic()`: a system with sources and `onEvict` but no dynamic modules would have no way to evict, and a host runtime that evicts would have to import the dynamic machinery to call it.
- **Recommendation.** Keep it on the system: it is about 0.1 KB and it is how a host tells sources to let go. This is an open question for the owner to settle before the beta; L5 does not need the answer.

### C. Engineering defaults that keep parity (no decision needed)

- **Durations on the kernel clock, epoch times on `Date.now()`.** Linger, retry backoff, the evict deadline race and the teardown timeouts run as timers on the kernel clock, where 1.35 uses `setTimeout` (`sources.ts:153–187, 885–898, 962`; `engine.ts:3570–3584`). The kernel clock's `now()` is `performance.now` by default (`clock.ts:226–241`), a counter from process start, so an epoch time cannot be compared with it. Where 1.35 compares an epoch time, the part reads `Date.now()` directly: the evict `deadline` (the time left is `deadline - Date.now()`, and only that duration goes to a timer), and any wall-clock stamp. A retry's `nextAt` compares only with its own start, so it may use the kernel clock for both ends. `createSystem` supplies a `Date.now` clock itself when it is given no clock or parent (`api/core.ts:436–441`), but a parent's or an injected clock need not be epoch-based, so the part must not rely on that. 1.35 has no system clock option, and under a real clock or the harness's fake timers the two agree.
- **Gates are called on every pass**, as in 1.35 (G2). Tracking a gate's reads would save a call per pass but stop re-checking a gate that reads anything besides facts.
- **The evict deadline stays wall-clock epoch milliseconds**, 1.35's documented API (`types/system.ts:1430`).
- **`active` stays strict `=== true`**, and a non-boolean answer is detached without a gate error, as in 1.35; only `key` reports a wrong type.
- **Attach and cleanup error messages stay in production**, because they reach `onSourceError`; only the warnings and the gate-write errors are dev strings.
- **The publish guard returns a reason string**, not an object, and a publish allocates nothing but its payload.
- **No counters at L5.** `inspect().sources` and its counters, and `localId`, come with L9.
- **Coalesce flushes with `queueMicrotask`**, not the scheduler, so its order against the reconcile microtask matches 1.35 (probe P2 and review probe R3 depend on it).

## Evidence: probes

Two sets of probes ran against the built 1.35 package (`packages/core/dist/index.js`) with real timers. The first set is mine (P1 to P5); the second is the design review's (R1 to R6), written to check the first draft's claims. Neither lives in the repo; L5-pre turns each into a conformance test or diff scenario (U1 to U9).

- Probe source (P1 to P5): `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l5probe/probe.mjs`
- 1.35 output (P1 to P5): `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l5probe/out-v1.json`
- Review probe source (R1 to R6): `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l5rv/rv.mjs`
- 1.35 output (R1 to R6): `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l5rv/out-v1.json`
- Size script (A1 numbers): `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l5rv/sz.mjs`
- Measurement JSON (v2, v2:dist, diff at forced L5): `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l5/`

| Probe | Steps | 1.35 |
|---|---|---|
| P1 | Active gate open at start; the first attach throws, later ones succeed. Wait 400 ms with no writes, then write an unrelated fact | One attempt at start, still one after 400 ms (the backoff is 250 ms), the second only after the unrelated write |
| P2 | `lastWriteWins` source, gate open. Close the gate, then publish `tick` twice in the same tick, before the flush | One `coalesced` drop; the handler never runs; publish count 0, drop count 1; the surviving payload is neither dispatched nor counted |
| P3 | Key gate with `gateLingerMs: 50`; the attach for key `b` throws until told not to. Room `a` to `b`, wait 80 ms, wait past the backoff, allow `b`, write an unrelated fact, wait 80 ms | `a` detached and `b` failed after the window; after the unrelated write, `b` was still detached; it attached one window later |
| P4 | A source with an `onEvict` that takes 30 ms; `await system.evict(100)` | `evict` resolved after 1 ms; `onEvict` finished afterwards, then the unsubscribe; the system ended stopped |
| P5 | Active gate open at start; `attach` publishes a seed event that writes a fact | The fact holds the seed when `start()` returns |
| R1 | Three sources, the gated `g1` declared before the ungated `u2` and `u3`; start, settle, `evict()` | Attach `u2, u3, g1`; `onEvict` `u2, u3, g1`; unsubscribe `g1, u3, u2` |
| R2 | An attach that returns a Promise; then `publish("tick")` through the captured handle | An attach error was reported; the handler ran once; `onSourcePublish` fired; `onSourceAttach` did not |
| R3 | `lastWriteWins` source, gate open. Publish `tick` twice, then write the closing fact, in the same tick | One `coalesced` drop and one published `tick`; the handler ran once |
| R4 | Key gate, `gateLingerMs: 50`, key `b` fails. Room `a` to `b`, wait past the backoff, an unrelated write (retry linger armed), room back to `a`, wait 400 ms, another unrelated write | After the return, `attached` was false, and still false after 400 ms of quiet; `a` attached only on the next unrelated write |
| R5 | P1 repeated with a settle after the wait | 1 attempt at 400 ms; 2 after an unrelated write |
| R6 | The `inspect().sources` row after a failed re-key | Fields: `id`, `moduleId`, `localId`, `attached`, `attachedAt`, `detachedAt`, `publishCount`, `lastPublishAt`, `dropCount`, `lastDropReason`, `lastDropAt`, `errorCount`, `lastError`. No key field |

**Reading the table:** P1 and P3 are (ac) and (aa): the retry waits for unrelated work, and a broken re-key waits for linger. R4 adds a third wait to (aa): a return to the old key. P2 and R3 are (ab): a payload queued after the closing write vanishes uncounted, while one queued before it is dispatched. P4 is why the onEvict scenario needs two more variants. R1 is why the order pins need a gated source. R2 is A3's live handle. R6 is why (aa) changes nothing visible at L9 and why `localId` is an L9 field. P5 is a plain pin. The core-next column is missing because core-next has no sources: every probe would show nothing attaching.
