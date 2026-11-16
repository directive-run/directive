# RFC: L13 subpaths, adapters and downstream packages

Status: draft for review, revision 1. No engine or oracle code merges from this document.
Tree: branch `p13/l13-rfc`, cut from `main` at `10d24668` (L0 to L7 gated; L8 built and waiting for its gate; L9 built, L9a and L9b merged as #394 and #395; `layers.rules.json` `current` is `"L7"`). L10, L11 and L12 have their RFCs (PRs #396, #397 and #400) and are not built. Nothing in `packages/conformance` or `packages/core-next/src` is changed by this PR.

## What we are building

L13 finishes the package. It builds the five entry points other than the root and `/plugins`, and it makes the packages in this repository that use core run on 2.0.

Terms used throughout:

- **An entry point** is a path a program can import: `@directive-run/core` (the root), and six **subpaths**: `/internals`, `/plugins`, `/testing`, `/migration`, `/adapter-utils` and `/worker`. 1.35 ships all seven.
- **An adapter** is a framework package that binds a system to a UI library: `react`, `vue`, `svelte`, `solid`, `lit`, and `el` (custom elements).
- **A downstream package** is any package in `packages/` that imports `@directive-run/core`: the adapters, `query`, `sources`, `mutator`, `optimistic`, `timeline`, `cli`, `ai`, `ai-harness` and `scaffold`.
- **All-in** is one bundle of every export of all seven entry points: what an app pays if it uses everything core ships.
- **Own code** is an entry point's code without the engine it imports.
- **A flush-only placement** is a test that `layers.json` puts at L13 for one reason only: it imports `flushMicrotasks`, a ten-line helper, from `/testing`.

The plan's row reads "Subpaths: testing, migration, worker, adapter-utils, internals; adapters + downstream packages | testing*, worker*, dev-mode-bundle, dist-types + query/ai/sources/react/vue/svelte/solid/lit/el suites | all-in: budget per layer at each gate; at L13 set the all-in ceiling from measurement, aiming ≤ half of 1.35 (~95 KB → ~48 KB) | subpaths". The plan's release path puts the in-repo switch order during the alpha as adapters, then `query`, `sources`, `mutator`, `optimistic` and `el`, then `timeline` and `cli`, then `ai` and `ai-harness`. Jason's Phase 4 answer, "Keep the order (Recommended)" (2026-11-05), settles the shape: the alphas keep 1.35's API. His "Full checks everywhere" gives L13 this document, the oracle first, the mutation gate, the random tests and two reviewers. When this document and 1.35 disagree, 1.35 wins; a difference is built only if the owner approves it as a lettered row.

**What each entry point is in core-next today.** Every entry ships (the census: "entries not shipped yet: none"). Four are stubs: each function has 1.35's name and signature and throws `featureMissing` (code `E_FEATURE_MISSING`) naming layer 13.

| Entry | 1.35's functions | core-next today | Where |
|---|---|---|---|
| `.` (root) | | Built to L9; L10 to L12 names missing | `src/index.ts` |
| `/internals` | | Re-exports of built managers and helpers; `safeStringify` missing (L13) and `hashObject` (L11) | `src/internals.ts` |
| `/plugins` | | Persistence built (L6); the rest is L12 | `src/plugins/index.ts` |
| `/testing` | 11 | `flushMicrotasks` built (L2); **10 stubs** | `src/utils/testing.ts:32`, `56–176` |
| `/adapter-utils` | 15 | **15 stubs**, `shallowEqual` among them, though the root's `shallowEqual` is built (`src/index.ts:30`) | `src/adapter-utils.ts:88–199` |
| `/worker` | 4 | **4 stubs** | `src/worker.ts:201–216` |
| `/migration` | 5 | **5 stubs** | `src/migration.ts:63–89` |

**Reading the table:** 34 stubs in four files are L13's work, plus one `/internals` name. The stub entries are built on their own (`tsup.config.ts`, `stubEntry`, "slice P3-F5"), so the four built entries keep their chunks.

**In plain terms:** L13 is mostly porting plain helpers. Testing, worker, migration and adapter-utils are about 8.0 KB of 1.35's code on their own, and they ride on hooks and members core-next already has: plugin hooks (L3), `observe` (L9), `inspect` (L2), history (L8). One small seam is needed in the core: adapter-utils' selector tracking has to reach a system's dependency tracker, which core-next keeps per system and 1.35 keeps as a global. The other half of L13 is the downstream packages, and there nothing exists yet: no package can run its suite on core-next. The probes found four 1.35 behaviours a user could notice: a test system's `isRunning`, `isInitialized` and `isSettled` never change after it is created; `eventHistory` records `dispatch` and not `events.*`; `createFakeTimers` has no way to schedule a timer, so it fires nothing; and a worker drops messages sent before `INIT` or after `DESTROY` without a reply. They are the candidate rows (bz) to (cc). The size is an owner decision (A1): measured, 2.0's all-in will be about the size of 1.35's, not half of it.

## Gap analysis, measured

**In plain terms:** at a forced L13 on v2, 118 tests fail at L13. 88 of them are flush-only placements that four earlier RFCs already re-place; the other 30 are L13's own, and each fails because a function is a stub. Another 46 flush-only tests are claimed by no RFC, and 35 of those belong at L0 to L7, where v2 never runs them today although they pass.

What I ran: `layers.rules.json` `current` set to `"L13"` in the working copy only. Then, from `packages/conformance`, `npx vitest run --project conformance:v2 --project conformance:v2:prod`, then `--project conformance:v2:dist --project conformance:v2:dist:prod`, then `--project conformance:diff`, each with the JSON reporter (each exited 1, as expected). Then `git checkout -- layers.rules.json`; `current` read `"L7"` again and `git status --porcelain` printed nothing. core and core-next were built first (`pnpm --filter … build`, both exit 0).

| Run | Tests | Pass | Fail | Skipped |
|---|---|---|---|---|
| `conformance:v2` and `conformance:v2:prod`, at forced L13 | 3,342 | 1,956 | 786 | 600 |
| `conformance:v2:dist` and `conformance:v2:dist:prod`, at forced L13 | 3,342 | 1,956 | 786 | 600 |
| `conformance:diff` at forced L13 | 434 | 409 | 25 | 0 |

**The 786 failures, by the layer `layers.json` gives each test.**

| Layer | Failures | Whose |
|---|---|---|
| L8 | 8 | L8's gate (its signed pins, as the L9 RFC found) |
| L9 | 2 | L9's gate |
| L10 | 109 | L10: 103 matched by title, and 6 in `mutants-derivations` whose titles a loop generates ("after 1 runs on one branch, then a flip"), so they match no `layers.json` key; their message, "d.register is not a function", is L10's |
| L11 | 201 | L11 |
| L12 | 348 | L12 |
| **L13** | **118** | below |
| **Total** | **786** | |

The `dist` pair fails the same tests by the same counts.

**The 118 at L13.**

| What fails | Tests | Files | The error | Whose |
|---|---|---|---|---|
| Flush-only, dynamic definitions | 44 | `dynamic-definitions` | "constraints.register is not in 2.0.0-alpha yet: it arrives in layer 10" and the rest of L10's API | L10's B2 re-places them |
| Flush-only, clobber plugins | 23 | `clobber-loop` (16), `clobber-alert` (7) | "clobberLoopPlugin is not in 2.0.0-alpha yet: it arrives in layer 12" | L12's U12 |
| Flush-only, data forms | 20 | `data-forms-namespaced` (12), `data-forms` (8) | assertion failures on data-form `when` and `on` | L11's U15 and L9's U14 |
| Flush-only, other | 1 | `system` ("watchDistributableSnapshot fires on changes") | "watchDistributableSnapshot is not in 2.0.0-alpha yet: it arrives in layer 12" | none: no RFC re-places it (below) |
| **L13's own: testing** | 19 | `testing-utils` (9), `testing-sees-batched-writes` (5), `testing` (5) | "createCoverageTracker is not in 2.0.0-alpha yet: it arrives in layer 13", and `createTestObserver`, `createTestSystem`, `flushAsync` | L13 |
| **L13's own: worker** | 11 | `worker` (5), `worker-mirrors-batched-writes` (3), `worker-set-fact` (3) | "createWorkerClient is not a function", "registerWorkerModule is not a function" | L13 |
| **Total** | **118** | | | |

**Reading the table:** L13's own failures are 30, and each is a stub. The 88 flush-only failures are other layers' tests.

**What `layers.json` places at L13.** 171 tests: 167 black-box and 4 internals (all in `resolvers.test.ts`, which v2 skips by category). 141 are flush-only placements and 30 are L13's own (by reason: `import flushMicrotasks` 141, `import registerWorkerModule` and `import handleWorkerMessages` 6 each, `import createWorkerClient` 5, `import createTestSystem` 5, `import createCoverageTracker` 5, `import flushAsync` 5, `import createTestObserver` 4). Of the 141, at forced L13: 88 fail, 49 pass and 4 are skipped.

| File | Flush-only tests | At forced L13 | Re-placed by |
|---|---|---|---|
| `dynamic-definitions` | 44 | 44 fail | L10's B2 |
| `engine` | 38 | **38 pass** | **none** |
| `clobber-loop` | 18 | 16 fail, 2 pass | L12's U12 |
| `data-forms-namespaced` | 15 | 12 fail, 3 pass | L11's U15 |
| `data-forms` | 9 | 8 fail, 1 pass | L9's U14 (branch `p9/l9-pre-a`, not merged) |
| `clobber-alert` | 7 | 7 fail | L12's U12 |
| `resolvers` | 4 | 4 skipped (internals) | **none** |
| `system` | 3 | 2 pass, 1 fails | **none** |
| `testing` | 2 | 2 pass | stays at L13: they test `flushMicrotasks` itself |
| `derivation-deps` | 1 | 1 passes | **none** |

**Where every flush-only test lands, measured.** I added `instruments: ["import flushMicrotasks"]` to the nine rules above (all but `testing`) in the working copy, ran the generator's own placement (`classify()` from `lib/classify.ts`, through `tsx`; 0 problems), read where each of the 141 lands, and restored the file with `git checkout`:

| File | Lands at |
|---|---|
| `dynamic-definitions` (44) | L10 43, L11 1 |
| `data-forms` (9) | L11 8, L2 1 |
| `data-forms-namespaced` (15) | L11 12, L9 2, L10 1 |
| `clobber-loop` (18) | L12 16, L2 2 |
| `clobber-alert` (7) | L12 7 |
| `engine` (38) | **L0 11, L2 11, L3 5, L4 5**, L9 6 |
| `system` (3) | **L0 1, L3 1**, L12 1 |
| `derivation-deps` (1) | **L0 1** |
| `resolvers` (4, internals) | L2 2, L7 1, L9 1 |

**Reading the table:** the bold rows are 35 black-box tests that belong at L0 to L4 and that no RFC re-places. Today v2 never runs them in CI, because they sit at L13, and at forced L13 every one of them passes on v2 and v2:dist. Re-placing them strengthens gates that are already signed, at no cost (B1). After every re-placement, L13 holds 32 tests: the testing suite (21) and the worker suite (11).

**`dist-types` and `dev-mode-bundle`.** The plan lists both under L13. `dist-types.test.ts` has `rule: "L13"`, but all 5 of its tests are placed at L0 (no feature beyond the schema builders), and they are in `v2-passing.json` (line 1877): they already pass on v2. `dev-mode-bundle.test.ts` is not ported: `scripts/classification.json` classes it `packaging` (7 cases; it reads 1.35's own `dist/`). Its 2.0 counterpart already runs: `size.mjs`'s dev-string guard ("dev-only strings guarded: 140", and 0 in `dist/production`), and the `p3f3-loud-unbuilt` tests. Neither needs L13 work.

**The diff at forced L13.** 25 failures: L8 7 (the L8 gate's), L10 2, L11 5, L12 7, the fuzz 1, and **L13 3**, all three in `diff/scenarios/l13-surface.test.ts`:

| Failing diff test | Differences | Why |
|---|---|---|
| "every root and /plugins export, by name and kind" | 100 | the root and `/plugins` names L10 to L12 have not built |
| "requirement helpers, typed helpers and the status plugin" | 56 | `createSystem` threw: the status plugin is L12's |
| "createSystemWithStatus wires the status plugin in" | 3 | the same |

**Reading the table:** the first is L13's surface check, but it compares only two of the seven entries (U16). The other two test L12's status plugin (`lib/layers.ts:66` places `utils/requirement-status` and `utils/system-with-status` at L12), so they belong at L12 (B4).

**The census.** `pnpm census` (exit 0) prints "1.35 names missing at unbuilt layers: 47 (L8 2, L11 33, L12 11, L13 1)". L13's one is `./internals safeStringify` (`contracts/next-unshipped.json:49`), which `@directive-run/ai` imports.

**The mutation gate.** The triage files hold 55 entries with `layer: "L13"`, all `later-layer`: `engine.json` 27, `system-module-transform.json` 17, `constraints.json` 7, `derivations.json` 2, `resolvers.json` 2 (counted with `node` over every file in `mutation-triage/`; 25 more mention L13 only in a note). Their notes name the killing tests, and each is a flush-only placement (`dynamic-definitions`, `data-forms-namespaced`, `data-forms`, `engine`). They move with the re-placements; none is a subpath mutant. **None can be:** Stryker mutates `packages/core/src/core/*.ts` only (`stryker.config.mjs:17–21`), and the four L13 files are `utils/testing.ts`, `utils/migration.ts`, `adapter-utils.ts` and `adapters/worker.ts`. The mutation gate cannot see L13's code today (B3). No `gate: L13` run exists; it is Precondition 3.

**The fuzz.** `diff/fuzz/model.ts` has no L13 feature: its feature table (`239–300`) and every step name nothing from `/testing`, `/worker`, `/adapter-utils` or `/migration` (a `grep` for each over the file finds none). The fuzz has nothing to reach at L13 today. Its one failure at forced L13 is L8 to L12's.

**What has no test at all in 1.35.** No ported test imports `/adapter-utils` (a `grep` over `packages/conformance/tests`: 0 files), and 1.35 has no test of `/migration` anywhere (`packages/core/src/utils/__tests__` holds history, snapshot signing and the three testing files). The adapters' own suites are the only tests of adapter-utils.

### The downstream packages

**In plain terms:** every downstream package runs on 1.35 today, through `workspace:*`. None can run on core-next: there is no switch. The only 2.0 consumer evidence is the Aperture lab, run outside this repository.

Read with a script over each package's `src/` (`$S/imports.mjs`; output `$S/imports.txt`), counting value imports (types left out):

| Package | Entry points it imports, and the value names | Layers those need | Test files |
|---|---|---|---|
| `react`, `vue`, `svelte`, `solid`, `lit` | root: `createSystem`, `createRequirementStatusPlugin`; `/adapter-utils`: `assertSystem`, `buildHistoryState`, `computeInspectState`, `createThrottle`, `defaultEquality`, `depsChanged`, `mergeHydrationFacts`, `runTrackedSelector`, `shallowEqual` (and `pickFacts`, except `react` and `lit`); tests: `createAuditLedger`, `memorySink` | L12 (status plugin, ledger), L13, history (L8) | 11, 3, 3, 3, 1 |
| `el` | `/adapter-utils`: `assertSystem`; root types | L13 | 4 |
| `query` | root: `createModule`, `createSystem`, `t` | not measured beyond the names | 18 |
| `sources` | root: `createModule`, `t` | not measured | 2 |
| `mutator` | root: `t`, `virtualClock` (built: `src/index.ts:219`); tests: `/testing` `flushAsync` | L13 for its tests | 3 |
| `optimistic` | none directly | | 1 |
| `timeline` | root: `createSystem`; tests: `/testing` `flushAsync` | L13 for its tests | 2 |
| `cli` | root: `createModule`, `createSystem`, `t`, `diffRules`, `replayUnder`, `sweepUnder`, `toReplayFrames` | L11 (the tools) | 6 |
| `ai` | root: `createModule`, `createSystem`, `t`, `getOperatorsForKind`, `getSchemaFieldKinds`, `predicateHash`, `validatePredicate`, `validatePredicateAgainstSchema`; `/adapter-utils`: `createCallbackPlugin`, `getBridgeFact`, `requirementGuard`, `setBridgeFact`; `/internals`: `isPrototypeSafe`, `safeStringify`; `/plugins`: `createCircuitBreaker`, `CircuitBreakerOpenError`, `createOTLPExporter`, `normalizeTokenUsage` | L11, L12, L13 | 73 |
| `ai-harness` | root: `createModule`, `createSystem`, `t`; `/plugins`: `devtoolsPlugin`, `loggingPlugin` | L12 | 15 |
| `scaffold` | root: `createModule`, `createSystem`, `t` (in templates) | | 0 |
| `knowledge`, `claude-plugin`, `mcp`, `lint`, `sandbox`, `vite-plugin-api-proxy` | none (`sandbox` lists the dependency and imports nothing) | | |

**Reading the table:** the adapters cannot switch before L12 and L13 are both built; `el` needs only `assertSystem`; `ai` is the widest consumer, of four entry points. "Test files" counts `*.test.ts(x)` under each package.

**Is there a switch?** No. Each package resolves `@directive-run/core` through `workspace:*` to `packages/core` (1.36.0, the same runtime as 1.35.0, below). The only engine switch in the repository is the conformance package's vitest projects, which alias every entry point to core-next through `lib/core-entries.ts` (`v2Entries`, `v2DistEntries`, derived from each package's `exports`; `vitest.config.ts:108–124`). No downstream `vitest` config names core-next (`git grep core-next` outside `packages/core-next` and `packages/conformance` finds only CI, `RELEASING.md`, `biome.json` and `size-budgets.next.json`).

**How alpha.0 ran the Aperture lab on 2.0.** `pnpm --filter @directive-run/core-next consumer:alpha <tgz>` (`scripts/alpha/consumer-check.mjs:1–20`; `RELEASING.md:85–97`): it copies the lab (default `~/Desktop/directive-size-plan/research/deep-dx/lab`, outside the repo) twice, installs `npm pack @directive-run/core@1.35.0` into one copy and the alpha tarball into the other, builds and serves each, runs `npm run parity`, and compares the two reports row by row against `consumer-approved.json`. That is one external app, not the in-repo suites.

## The design: each 1.35 rule, the mechanism that keeps it, and its pin

Where a row says "verified", the probe ran it against the published 1.35 (`packages/conformance/node_modules/directive-v1`, `1.35.0`), in development and production, with real timers; the output is under "Evidence". The rest is read from the code; 1.35 line numbers are in `packages/core/src/`.

### Where it lives, and the seam it needs

**In plain terms:** each subpath stays its own entry point, as in 1.35, so nothing in it reaches an app that does not import it. The core gains one seam: a way for `/adapter-utils` to borrow a system's tracker.

| Option | Keeps 1.35's API? | Who pays the bytes |
|---|---|---|
| **O1. The seven entry points as 1.35 ships them**, each built from its own file | Yes | Only apps that import a subpath; every `createSystem` build pays the tracker seam (reasoned, 20 to 40 B) |
| O2. The beta's moves now (`/migration` to `@directive-run/cli`, `timeline` into `/testing`, `mutator` and `optimistic` into `/mutations`, `contracts/PACKAGES-2.0.md:9–25`) | No: a 1.35 program's `/migration` import breaks | The same, minus `/migration` (1.6 KB) |

**Reading the table:** O1 keeps the alpha rule; O2 is the beta's, with its codemod.

**The seam: the selector needs the system's tracker.** 1.35's `runTrackedSelector` (`adapter-utils.ts:296–341`) runs the selector inside `withTracking` from `core/tracking.ts`, a module-level tracker: whatever the selector reads, through the proxy or not, is recorded. core-next keeps one tracker per system (`src/api/core.ts:540`, `const tracker: Tracker = { deps: null, effect_: undefined }`), and its `withTracking` takes it as an argument (`src/api/facts.ts:136–143`). So `/adapter-utils`, a separate entry, must reach a given system's tracker. Two ways:

- **S1 (recommended): the core registers each system's tracker in a module-level `WeakMap`**, in a module that the root and `/adapter-utils` share (tsup's `splitting: true` puts it in a shared chunk), and `runTrackedSelector` looks the system up. Nothing is added to the system's own keys, which stay equal to 1.35's 42 (P11). Reasoned at 20 to 40 B on every `createSystem` build, `floor` included; L13b measures it before anything else.
- S2: record reads in the proxy's `get` only. It costs nothing in the core, but it misses reads the selector makes outside the proxy (a closure over `system.facts`), which 1.35's global tracker sees. That is a behaviour change, so S2 is out.

`factKeys` then carries core-next's own `DERIVATION_DEP_PREFIX`, the same `\u001F` 1.35 uses (`core/tracking.ts:184`; core-next's `src/api/facts.ts`, `describeDep`), so a selector that reads a derivation returns `["\u001Fdouble", "n"]` on both engines (P8). Verified on 1.35, P10: a store subscription to that key never fires, so the adapters' extra listener is dead weight on both engines. Kept, not a candidate (C).

### `/testing`

**In plain terms:** test helpers. They wrap `createSystem` with a recording plugin and read `observe()` and `inspect()`. core-next has every hook they use.

| # | 1.35 rule | 2.0 mechanism | Pinned by |
|---|---|---|---|
| T1 | `flushMicrotasks` awaits 10 microtask turns (`utils/testing.ts:51–55`). | Built (L2). | `testing` (2) |
| T2 | `flushAsync`: 10 turns, a `setTimeout(0)`, 10 turns, another `setTimeout(0)`, 10 turns (`92–98`). | The same loop. | `testing` (5) |
| T3 | `settleWithFakeTimers(system, advance, { totalTime 5000, stepSize 10, maxIterations 1000 })` flushes, returns once `inspect().inflight` is empty, else advances by a step; at the end it throws "[Directive] settleWithFakeTimers did not settle after {totalTime}ms. N resolvers still inflight: ids" (`130–189`). | The same. | U4 |
| T4 | `createFakeTimers()` returns `advance`, `next`, `runAll`, `now`, `reset` over a private list that nothing can add to (`224–276`), though its doc says `advance` fires "any timers that fall within the window" (`191–223`). Verified, P3: `advance(1000)` then `now()` is 1000; a `setTimeout` fired only on real time. | Without (cb): the same. | U3; shows (cb) |
| T5 | `createMockResolver(type or options)` records calls, waits `delay`, throws `error`, calls `resolve` (`326–377`). `mockResolver(type)` returns `{ calls, pending, resolve, reject, resolveAll, rejectAll, reset, handler }`, a spread of an object with getters, so `calls` and `pending` become plain properties holding the live arrays (`436–512`). Verified, P4: one call and one pending after a write; `resolve()` emptied both. | The same spread. | U5 |
| T6 | `createTestSystem({ module })` or `({ modules })` (`708–728`). Mock resolvers replace the module's by type; a tracking plugin, first in `plugins`, records each fact change (`factsHistory`, capped at 10,000 with a once-per-system warning, `687–706`) and each created requirement; `dispatch` is wrapped to record `eventHistory` (`807–810`). The result is `{ ...system, eventHistory, resolverCalls, allRequirements, getFactsHistory, resetFactsHistory, waitForIdle, assertRequirement, assertResolverCalled, assertFactSet, assertFactChanges }` (`729–908`). The spread runs each getter once: verified, P1 and P9, `isRunning`, `isInitialized` and `isSettled` keep their creation values (false, false, true) after `start()`, while `start()` itself works (the constraint fired and the resolver ran). `events.inc()` changes the fact and is not recorded; only `dispatch` is. The init write is the first history row. `assertFactSet(key, undefined)` passes for any write (the value check is skipped when `value` is `undefined`). | The same spread: core-next's system has the same 42 own enumerable keys, `isRunning` an own getter (P11), so the spread copies the same members. With (bz): the flags forward to the system. | `testing-sees-batched-writes` (5); U1, U2, U6, U7; shows (bz), (ca) |
| T7 | Namespaced: a change to `"ns::key"` is recorded with `namespace` and the short `key` when `ns` is one of the modules; `assertFactSet` matches the short or the full key (`910–1020`). | The same. | `testing-sees-batched-writes`; U8 |
| T8 | `assertDynamic` and `assertNotDynamic` switch over `constraints`, `resolvers`, `derive` and `effects` `.isDynamic(id)` (`1148–1227`). | The same; it needs L10's `isDynamic`. | U9 |
| T9 | `createCoverageTracker(system)`: `run(scenario)` observes `constraint.evaluate` (active only), `resolver.start`, `effect.run` and `derivation.compute`; `report()` divides by `inspect()`'s lists, and an empty list counts as full coverage (`1272–1376`). Verified, P5: a derivation nothing read counts as missed (`derivationCoverage` 0). | The same, on core-next's `observe` (L9). | `testing-utils` (5) |
| T10 | `createTestObserver(system)`: `{ events, ofType, clear, dispose }` (`1378–1412`). Verified, P6: a write records `fact.change`, never `fact.set`. | The same. | `testing-utils` (4) |

**Reading the table:** T6 is the heart of `/testing`, and it is a spread, so its behaviour depends on which members the system defines as own enumerable getters. P11 measured that both engines define the same 42.

### `/adapter-utils`

**In plain terms:** the helpers every adapter shares. Pure functions over a system's public members, except the selector, which needs the seam.

| # | 1.35 rule | 2.0 mechanism | Pinned by |
|---|---|---|---|
| AU1 | `computeInspectState(system)`: `isSettled`, `unmet`, `inflight`, and three flags from their lengths (`adapter-utils.ts:104–118`). | The same. | adapters' suites; U10 |
| AU2 | `createThrottle(fn, ms)`: trailing edge, latest arguments, a `cleanup` (`146–192`). | The same. | adapters' suites |
| AU3 | `assertSystem(hook, system)` throws "[Directive] {hook}() requires a system instance as the first argument. Received {system}." in development only (`198–204`). Verified, P8: production returned. | The same. | U12 |
| AU4 | `buildHistoryState(system)`: `null` with history off; otherwise navigation flags, snapshot metadata and bound methods over `system.history` (`216–259`). Verified, P8: `null`. | The same, over L8's history. | adapters' suites; U10 |
| AU5 | `pickFacts`, `defaultEquality` (`Object.is`), `mergeHydrationFacts(snapshot, initial)`: a non-null object `data` is the snapshot's facts, anything else is the record itself (`207–281, 381–402`). Verified, P8. | The same. | U10 |
| AU6 | `runTrackedSelector(system, deriveKeys, selector)`: a proxy whose derivation reads call `system.read` and are listed in `deriveKeys`, and whose other reads call `$store.get`; everything read is tracked (`296–341`). Verified, P8 and P10: `factKeys` `["\u001Fdouble", "n"]`, `deriveKeys` `["double"]`. | The seam S1; the same proxy. | U10 |
| AU7 | `depsChanged` compares the two lists in order (`344–356`). Verified, P8: `["a","b"]` against `["b","a"]` is a change. | The same. | U11 |
| AU8 | The bridge helpers `setBridgeFact`, `getBridgeFact`, `createCallbackPlugin`, `requirementGuard`, `requirementGuardMultiple` (`core/types/adapter-utils.ts:95–340`), and `shallowEqual` (`utils/utils.ts`). | Ported as code; `shallowEqual` re-exports the root's, which is built. | `ai`'s suite; U10 |

### `/worker`

**In plain terms:** runs a system in a Web Worker and mirrors its changes to the page. The worker side is a message handler around a namespaced system; the page side is a client with request ids and timeouts.

| # | 1.35 rule | 2.0 mechanism | Pinned by |
|---|---|---|---|
| W1 | `registerWorkerModule(name, module)` fills a module-level registry (`adapters/worker.ts:477–500`). | The same. | `worker-set-fact` (3) |
| W2 | `handleWorkerMessages()` sets `self.onmessage` (`515` onward). `INIT` builds a namespaced system from the registry, with a tracking plugin and `config.history`, and posts `READY`; an unregistered name posts `ERROR` with `source: "INIT"` and "[Directive Worker] Module "nope" not registered. …". Verified, P7. | The same. The system is imported lazily, as 1.35's `await import("../core/system.js")` in `createWorkerSystem`, so the page's bundle, which imports only the client, carries no engine. | `worker` (5); U13 |
| W3 | A message that arrives before `INIT`, or after `DESTROY`, is dropped with no reply (`dispatchMessage`: `if (!system) return`). Verified, P7: a `SET_FACT` before `INIT` and a `START` after `DESTROY` posted nothing. | Without (cc): the same. | U14; shows (cc) |
| W4 | `SET_FACT` needs `"module::fact"`; otherwise `ERROR` with "[Directive] worker: fact key "n" names no module. Use "<module>::<fact>"." (`writeFact`). `SET_FACTS` writes in one `batch`. Verified, P7. | The same. | `worker-set-fact` (3); U13 |
| W5 | The tracking plugin posts `FACT_CHANGED` per `onFactSet`; `onFactsBatch` folds consecutive changes to one key into one message with the first `prev` and the last value; `DERIVATION_CHANGED` per compute; `REQUIREMENT_CREATED`, `REQUIREMENT_MET`. Verified, P7: `START` posts the init write's `FACT_CHANGED` and `DERIVATION_CHANGED` before `STARTED`; an equal write posts nothing; `GET_SNAPSHOT` posts a `DERIVATION_CHANGED` before its result, because reading the snapshot recomputes. | The same plugin, on core-next's hooks (L3). | `worker-mirrors-batched-writes` (3); U15 |
| W6 | `GET_SNAPSHOT` answers with `getDistributableSnapshot` (L12), `INSPECT` with `inspect()`, `SETTLE` with `success` and the error message (`handleSettle`). | The same. | `worker` (5) |
| W7 | `createWorkerClient`: one pending map, request ids per kind (`snapshot-N`), a default timeout ("[Directive] worker request timed out after {ms}ms"), and a worker error rejects every pending request (`172–476`). Read, not run. | The same. | `worker` (5) |

### `/migration` and `/internals`

| # | 1.35 rule | 2.0 mechanism | Pinned by |
|---|---|---|---|
| MG1 | Five pure functions: `analyzeReduxSlice`, `analyzeZustandStore`, `analyzeXStateMachine` return a module structure; `generateModuleCode` prints it; `generateMigrationChecklist` prints a list (`utils/migration.ts`, 434 lines). No test anywhere in 1.35. | Ported as code. At the beta it moves to `@directive-run/cli` (`PACKAGES-2.0.md:15`). | U17 |
| IN1 | `/internals` exports `safeStringify(data, maxLen?)` (`contracts/api-surface.json:620`); `@directive-run/ai` imports it. | Ported; `hashObject` is L11's. | the census; `ai`'s suite |

### The downstream switch

**In plain terms:** a way to run a downstream package's own suite on core-next without editing the suite.

| # | Rule | Mechanism | Pinned by |
|---|---|---|---|
| D1 | A package's suite runs unchanged on both engines. | `DIRECTIVE_ENGINE=v2`, read by each package's vitest config through one shared helper that aliases every `@directive-run/core` entry to core-next's built `dist/` from `lib/core-entries.ts`'s `v2DistEntries`, derived from `exports` and never written by hand. Without the variable, nothing changes. | each package's suite, twice in CI |
| D2 | The switch order is the plan's: adapters, then `query`, `sources`, `mutator`, `optimistic` and `el`, then `timeline` and `cli`, then `ai` and `ai-harness`. | One CI job per group, added as each group's layers land. | A4 |
| D3 | A package switches when its full suite passes on both engines with no test edited. | The job fails on any test that passes on 1.35 and not on 2.0. | A4 |
| D4 | `ai` switches only when its full suite, `ai-harness` and the minglingo runner tests pass on both engines, and a checkpoint saved under 1.35 loads under 2.0 (the plan's gate). | Its own gate in Phase 4; the minglingo tests live outside this repository. | A4 |

## Where it lives

**In plain terms:** four stub files become real, one name joins `/internals`, and the core gains one small seam.

| Piece | File | Change |
|---|---|---|
| `/testing` | `src/utils/testing.ts` | The 10 stubs become T2 to T10 |
| `/adapter-utils` | `src/adapter-utils.ts` | The 15 stubs become AU1 to AU8; `shallowEqual` re-exports the root's |
| `/worker` | `src/worker.ts` | The 4 stubs become W1 to W7; the system is imported lazily |
| `/migration` | `src/migration.ts` | The 5 stubs become MG1 |
| `/internals` | `src/internals.ts` | `safeStringify` (IN1) |
| **The seam** | `src/api/core.ts:540` and a shared module | Each system's tracker registered in a `WeakMap` (S1). Reasoned at 20 to 40 B; measured first in L13b |
| The build | `tsup.config.ts` (`entry`, `stubEntry`) | The three stub entries join the built ones, as each lands; the chunk split is re-checked |
| Leftovers | `src/unbuilt.ts`, the `featureMissing(…, 13)` calls | Removed when the last L13 entry lands (read, not checked: whether `lib/core-entries.ts` still points any specifier at `unbuilt.ts`) |
| The switch | a shared vitest helper beside `lib/core-entries.ts`; each downstream `vitest` config | D1 |

## The fuzz, designed in up front

**In plain terms:** the random tests reach nothing at L13 today, and need little. L13's code is a view of hooks the fuzz already compares.

What the model does today, read from the code: `diff/fuzz/model.ts` places each feature at a layer (`239–300`) and draws no L13 feature. The recorder already compares every plugin hook (`diff/hooks.ts`) and `inspect()` at every checkpoint (`diff/record.ts`), and those hooks are exactly what `createTestSystem` and the worker's tracking plugin read (`onFactSet`, `onFactsBatch`, `onDerivationCompute`, `onRequirementCreated`, `onRequirementMet`).

| L13 behaviour | The model reaches it today? | What L13-pre adds |
|---|---|---|
| The test system's history and requirement list (T6, T7) | No, though the hooks under it are compared | A drawn option, `via: "testSystem"`: a single-module case is built through `createTestSystem`, and `getFactsHistory()` and `allRequirements` are recorded at each checkpoint |
| The worker's mirror (W5) | No | Not added: it needs a `postMessage` shim; hand scenarios U15 |
| The selector (AU6) | No | Not added: hand pin U10 |
| `/migration` (MG1) | No | Not added: pure functions; U17's scenario compares every output |

**Harness rules.** L8's ten rules and L9's three carry over unchanged. One is new: the `testSystem` view ships with a self-test that drops one history row and must be caught. **L13-pre's bar:** the 21 PR seeds at forced L13 leave no unexplained case that the `testSystem` view introduced; every other case is explained by L8 to L12, whose gates come first (Precondition 1).

Whether the deep runs gate L13 is decision A2.

## Untested behaviours, and what will pin each

**In plain terms:** 17 items have no pin. Twelve came from the probes; five from reading the code and the scenario files.

| # | Behaviour | Evidence | Pinned by | Slice |
|---|---|---|---|---|
| U1 | A test system's `isRunning`, `isInitialized` and `isSettled` keep their creation values after `start()`; `start()` itself works | P1, P9 | A conformance test; shows (bz) | L13-pre |
| U2 | `eventHistory` records `dispatch` only; `events.*` changes the fact and is not recorded | P1 | A conformance test; shows (ca) | L13-pre |
| U3 | `createFakeTimers` has no way to add a timer: `advance`, `next` and `runAll` only move its clock | P3 | A conformance test; shows (cb) | L13-pre |
| U4 | `settleWithFakeTimers` throws its message, naming the in-flight resolvers, when time runs out | read, `utils/testing.ts:130–189` | A conformance test with a resolver that never ends | L13-pre |
| U5 | `mockResolver`'s `calls` and `pending` are plain properties holding the live arrays | P4 | A conformance test | L13-pre |
| U6 | The init write is the first `getFactsHistory()` row | P1 | A conformance test | L13-pre |
| U7 | `assertFactSet(key, undefined)` passes for any write of the key | P1 | A conformance test | L13-pre |
| U8 | A namespaced test system splits `"ns::key"` only when `ns` is a module | read, `910–1020` | A conformance test with a fact named `a::b` in module `m` | L13-pre |
| U9 | `assertDynamic` and `assertNotDynamic`, and their messages | read, `1148–1227` | A conformance test at L13 (it needs L10) | L13-pre |
| U10 | `/adapter-utils` as a whole: `computeInspectState`, `buildHistoryState` on and off, `pickFacts`, `mergeHydrationFacts`'s two shapes, `runTrackedSelector`'s `factKeys` with the prefixed derivation key, the bridge helpers | P8, P10; no ported test imports the entry | A diff scenario over every export, both engines | L13-pre |
| U11 | `depsChanged` is order-sensitive | P8 | In U10's scenario | L13-pre |
| U12 | `assertSystem` throws in development only | P8 | A conformance test in each mode | L13-pre |
| U13 | The worker's `ERROR` messages: an unregistered module at `INIT`, an unqualified key | P7 | A conformance test | L13-pre |
| U14 | A worker drops messages before `INIT` and after `DESTROY`, with no reply | P7 | A conformance test; shows (cc) | L13-pre |
| U15 | `START` posts the init write's changes before `STARTED`; an equal write posts nothing; `GET_SNAPSHOT` can post `DERIVATION_CHANGED` first | P7 | A conformance test of the message order | L13-pre |
| U16 | The surface scenario compares only the root and `/plugins` | `diff/scenarios/l13-surface.test.ts` | Extend it to all seven entries (B4) | L13-pre |
| U17 | `/migration` has no test anywhere | a read of `packages/core/src` | A diff scenario that calls the five functions on a Redux, a Zustand and an XState fixture and compares every string | L13-pre |

**Reading the table:** U1, U2, U3 and U14 are where the candidates live. Each pins 1.35's behaviour now and shows a difference only with an approved, signed entry. The 46 flush-only tests no RFC re-places are a placement, not a behaviour: B1.

## Performance

**In plain terms:** L13's code is off the hot path. Only the seam touches every system, once, at creation.

I did not run the bench for this RFC: no L13 code exists. What L13 must keep:

- No workload slower than `main` by more than 5% after any L13 slice. The seam is one `WeakMap.set` per `createSystem`.
- `runTrackedSelector` runs on every render that re-selects. It must allocate no more than 1.35's: one proxy and one tracking set per call. L13b checks it with the adapters' own benches if they have any, and otherwise with a `selector-1000` workload: 1,000 selector runs, time and bytes, judged at 1.0 or better against 1.35 (B5).
- With (bz), the test system's flags become getters: no cost outside tests.

## Slice plan

**In plain terms:** a placement fix that can land now, an oracle slice, three build slices, the downstream switch, and the gate.

| Slice | Builds | Done means (checkable) | Tier |
|---|---|---|---|
| L13-pre-a (now) | B1: `instruments: ["import flushMicrotasks"]` on `engine`, `system`, `derivation-deps` and `resolvers`. | `pnpm port` and `check:expects` exit 0; the 35 black-box tests land at L0 to L4 as measured above, run on v2 at `current` L7 and pass; `v2-passing.json` gains them; the census exits 0. `oracle-change` label. | test oracle; Sonnet implementer, one reviewer |
| Precondition 1 | The L8 to L12 gates. | `current` is L12. | coordinator |
| Precondition 2 | The switch helper (D1) and each downstream suite green on 1.35 through it. | Every downstream suite passes with and without the helper on 1.35. | test oracle |
| Precondition 3 | A `gate: L13` run of `mutation-nightly.yml`, after B3. | The L13 layer gate reports PASS, or its entries are listed as L13-pre work. | test oracle; coordinator |
| L13-pre (oracle) | U1 to U17; the `testSystem` fuzz view with its self-test; B2's `all-in` fixture; B3; B4. | The new tests pass on `conformance:v1` and `v1:prod`, and on v2 fail only as this document predicts. `conformance:diff` at forced L13 fails only the L13 scenarios and the U-scenarios. `pnpm census`, `check:expects` and `oracle:update` exit 0. | test oracle; Sonnet implementer, Fable correctness reviewer |
| L13a | `/testing` (T2 to T10) and `/internals` `safeStringify`. (bz), (ca), (cb) if approved. | The 19 testing failures pass on v2, v2:prod and v2:dist; U1 to U9 pass or differ only by signed entries; the census's L13 count is 0. Sizes within A1. | core; Opus implementer, Sonnet diff reviewer plus Fable correctness reviewer |
| L13b | **The seam first**, measured and reported. Then `/adapter-utils` (AU1 to AU8) and `/migration` (MG1). | U10 to U12 and U17 match 1.35. The six adapters' suites pass on both engines through D1. The PR reports the seam's bytes and each entry's bytes. | core; as L13a |
| L13c | `/worker` (W1 to W7). (cc) if approved. | The 11 worker failures pass; U13 to U15 match 1.35 or differ only by signed entries. | core; as L13a |
| L13d | The switch for `query`, `sources`, `mutator`, `optimistic`, `el`, then `timeline` and `cli`. | Each package's full suite passes on both engines with no test edited (D3). | test oracle; Sonnet implementer, one reviewer |
| L13-gate | `current` to L13, `ratchet --update`, diff and fuzz at L13, the triage entries converted, `GATE-13.md`, `/principal` on L13, the all-in measured against A1. | 0 L13 failures on v2, v2:dist and v2:prod. The census exits 0. PR fuzz passes at L13. The nightly follows A2. At most 3 gate runs, then Jason. | test oracle; Sonnet plus the coordinator's read |
| Phase 4 (not L13) | The `ai` and `ai-harness` switch (D4). | The plan's AI gate. | coordinator |

**Reading the table:** L13-pre-a does not wait for anything: the 35 tests pass today, and placing them where they belong makes v2's L0 to L4 gates check them.

## Size

**In plain terms:** 1.35's all-in is 97.5 KB. 2.0's is 40.5 KB today, and the approved and recommended plans for L10 to L13 add about 56.5 KB, almost all of it plugins and tools ported as code. So 2.0's all-in lands at about 1.35's size, not half. Half holds for neither the alpha nor the beta all-in; it is close only for the beta's smallest app.

**Method.** The L9 and L12 RFCs': esbuild 0.27.7 (tsup's copy, as `scripts/size.mjs` loads it), production (`#is-development` inlined and folded as `size.mjs` does, `NODE_ENV` "production"), minified, ESM, gzip level 9 by node zlib. 1.35 is built from the workspace's `packages/core/src`, as `size.mjs` builds its "core 1.35" lines. That tree is 1.36.0, whose source differs from the `@directive-run/core@1.35.0` tag outside tests in three places (`git diff --stat`): an explicit `process.env` guard in the dev-only `warnIfNotStarted`, one type export, and an unused licence validator deleted (#186). None reaches a production bundle; that is reasoned, not measured. core-next is built with its private-member mangling, as its build does. Script: `$S/size/measure.mjs`; output `$S/size/size.log`.

| Entry, bundled alone | 1.35 | core-next today |
|---|---|---|
| root | 67,841 B | 37,551 B |
| `/internals` | 41,112 B | 6,261 B |
| `/plugins` | 28,804 B | 1,686 B |
| `/testing` | 49,770 B | 413 B (stubs) |
| `/worker` | 49,762 B | 281 B (stubs) |
| `/migration` | 1,592 B | 300 B (stubs) |
| `/adapter-utils` | 1,373 B | 469 B (stubs) |
| **All-in, the seven in one bundle** | **97,527 B** | **40,480 B** |
| All-in without `/plugins` | 75,752 B | 39,226 B |

**Reading the table:** 1.35's `/testing` and `/worker` are as large as its engine because each imports `createSystem` (the worker's import is dynamic, and a one-file bundle inlines it). The all-in is the number that matters, because shared code is counted once. The plan's "~95 KB" is this measurement; 97,527 B is its exact value, and half is 48,764 B.

**1.35's L13 code, its own.** Each subpath bundled with every file outside it left external:

| Piece | Minified | Gzip |
|---|---|---|
| `/testing`, own code | 8,237 B | 2,697 B |
| `/worker`, own code | 5,572 B | 2,198 B |
| `/migration` (no imports) | 4,591 B | 1,592 B |
| `/adapter-utils` with the bridge helpers, own code | 2,781 B | 1,258 B |
| `/internals` `safeStringify` | 242 B | 211 B |
| **Sum** | | **7,956 B** |
| What the adapters import of `/adapter-utils` (ten names, the engine external) | 2,414 B | 1,134 B |
| What `ai` imports of it (four names) | 464 B | 248 B |

**Reading the table:** L13's code is plain helpers, like L11's tools and L12's plugins, so I estimate it at 1.0, a straight port: about 8.0 KB, less about 1.0 KB of stubs it replaces (reasoned from the stub rows above, which share `featureMissing`), so **about +7.0 KB on the all-in**. It reaches no `createSystem` build: only the seam does (reasoned 20 to 40 B).

**2.0's all-in after L13, projected.** From the L10, L11 and L12 RFCs' A1 rows, each a target and a cap:

| Step | Basis | Target | At every cap |
|---|---|---|---|
| Today, post-L9 (`10d24668`) | measured | 40,480 B | 40,480 B |
| L10 | L10 RFC rev 2, A1: +4.1 KB target, +5.0 KB cap | 44,580 B | 45,480 B |
| L11 | L11 RFC rev 2, A1: the engine +4.2 KB (cap +4.8 KB) and the tools' 10,946 B measured, at 1.0 | 59,730 B | 61,480 B |
| L12 | L12 RFC, A1: the engine part +0.5 KB (cap +0.75 KB) and the plugins and tools' 29.8 KB, at 1.0 | 90,030 B | 92,480 B |
| L13 | this RFC: +7.0 KB target, +8.0 KB cap | **97,030 B** | **100,480 B** |
| 1.35 | measured | 97,527 B | |

**Reading the table:** at every target, 2.0's all-in is 0.5% under 1.35's; at every cap, 3% over. The projection may count the L11 tools twice by up to a few KB, because the L12 RFC's plugin bundle includes the tools the clobber loop imports; that is reasoned, not measured. Either way, half of 1.35, 48,764 B, is about 48 KB away. The 2.0 engine is much smaller (`minimal` 35,282 B against 49,313 B), but about 49 KB of what 1.35 ships is tools, plugins and subpaths that L11 to L13 port as code at their 1.35 size.

**Whether "half of 1.35" holds.**

- **The alpha: no.** It wires everything and keeps 1.35's API; the all-in lands at about 1.35's size.
- **The beta's all-in: no, as planned.** "Keep the order" turns features into imports, which shrinks an app that skips them, but an all-in imports them all. `PACKAGES-2.0.md` moves `/migration` out (1.6 KB) and `devtools-ai-bridge` out (part of devtools' 12.4 KB), and moves `timeline`, `mutator` and `optimistic` in (not measured). The net is a few KB. Reaching 48 KB would need the ported tools and plugins rebuilt at well under half their size, or moved out of core.
- **The beta's smallest app: close.** `minimal`'s beta-wiring line is 26,505 B today (`size.mjs`, exit 0), 54% of 1.35's `minimal`; half is 24,657 B, 1,848 B away. L10 to L12 add only their seams to that line, if their parts join the beta list.

**`full-entry` is not the all-in.** `full-entry` is `export * from "@directive-run/core"`: the root only (`scripts/size.mjs:677–684`). No fixture measures `/plugins`, `/testing`, `/worker`, `/migration` or `/adapter-utils`. So the L12 RFC's +31.0 KB cap on `full-entry` counts about 21 KB of plugins that live in `/plugins` (devtools, logging, performance, observability, OTLP, the circuit breaker, the clobber pair) and that `full-entry` never imports; the root's share is the ledger, the status plugin, the snapshot tools and signing, about 8.5 KB by the L12 RFC's own rows. A cap with about 21 KB of slack never fires. B2 adds an `all-in` fixture where those bytes do show.

## What the plan got wrong, or left out

- **"Half of 1.35" does not hold for the all-in, alpha or beta.** The plan's L10 to L13 port tools, plugins and subpaths as code; together they are about half of 1.35's all-in on their own. Measured, 2.0's all-in lands at about 1.35's 97.5 KB. Half is near only for the beta's smallest app.
- **The flush trap is wider than the four earlier RFCs found.** 46 more flush-only tests (`engine` 38, `system` 3, `resolvers` 4, `derivation-deps` 1) are claimed by none, and 35 of them belong at L0 to L4, where v2 never runs them today; they pass at forced L13 (B1).
- **`full-entry` is not an all-in**, and nothing measures the subpaths. L12's `full-entry` cap counts bytes that fixture never imports.
- **The mutation gate cannot see L13's code.** Stryker mutates `src/core/*.ts` only. The 55 L13 triage entries are other layers' mutants, placed through flush-only tests.
- **`dev-mode-bundle` and `dist-types` are not L13 work.** The first is a packaging test of 1.35's `dist/`, not ported, and its 2.0 counterpart already runs. The second's 5 tests are at L0 and already pass on v2.
- **`/adapter-utils` and `/migration` have no 1.35 test in the oracle.** The adapters' suites are adapter-utils' only tests; migration has none at all.
- **Two "L13" diff scenarios test L12's status plugin.**
- **The selector needs a core seam.** 1.35's tracker is global; core-next's is per system.
- **The downstream suites have no switch to v2.** The plan's row lists them as L13 tests, but nothing can run them on core-next yet, and `ai`'s switch needs L11 and L12 too, and tests outside this repository.

## Decisions for the owner

**Questions for Jason.** Nine answers settle L13. The table after them gives each a product verdict, so Jason can bulk-approve.

1. **A1, the L13 size and the all-in ceiling.** O1, the seven entries as 1.35 ships them. The all-in may never exceed 1.35's, 97,527 B; L13 itself adds at most +8.0 KB (target +7.0 KB) to the all-in and +60 B to every app fixture and `floor`. **Recommend: approve.**
2. **A2, do deep fuzz runs gate L13, or report?** **Recommend: "Gate on short seeds; deep runs report"**, as at L8 and L9.
3. **A3, fuzz-ready before the gate.** **Recommend: approve L8's brakes unchanged.**
4. **A4, which downstream suites gate L13.** **Recommend: the six adapters, `el`, `query`, `sources`, `mutator`, `optimistic`, `timeline` and `cli`; `ai` and `ai-harness` switch at their own Phase 4 gate.**
5. **(bz), a test system's state flags stay live.** **Recommend: approve.**
6. **(ca), `eventHistory` records `events.*` calls too.** **Recommend: decline.**
7. **(cb), `createFakeTimers` gets a way to schedule.** **Recommend: decline.**
8. **(cc), a worker answers a message it cannot handle.** **Recommend: decline.**
9. **B1 to B6.** **Recommend: approve; B1 now, as L13-pre-a.**

A "no", or no answer yet, means the slice keeps 1.35's behaviour, pins it with a core-next test, and writes no entry. This revision does not assume the owner's instruction of 2026-11-15 ("I approve you for to do everything"), under which the L9 to L12 RFCs took each recommended option; if it covers L13, the recommendations below are the options taken.

| Decision | Product verdict | Recommendation |
|---|---|---|
| **A1** the seven entries as 1.35 ships them; the all-in ceiling; L13's budgets | Same behaviour. Apps that import no subpath grow by the seam only (20 to 40 B, reasoned). The all-in lands at about 1.35's size: 2.0 is not half of 1.35 for an app that uses everything | Approve: all-in at most 97,527 B; L13 at most +8.0 KB on the all-in (target 7.0 KB) and +60 B on `minimal`, `two-module`, `aperture`, `full-entry` and `floor`; come back above either |
| **A2** deep runs report, short seeds gate | No behaviour change; decides when L13 can merge | "Gate on short seeds; deep runs report" |
| **A3** fuzz-ready before the gate | No behaviour change | Approve L8's brakes |
| **A4** which suites gate L13 | No behaviour change; decides what "done" means for the downstream packages | Adapters, `el`, `query`, `sources`, `mutator`, `optimistic`, `timeline`, `cli` at L13; `ai` and `ai-harness` at Phase 4 |
| **(bz)** a test system's `isRunning`, `isInitialized` and `isSettled` read the system | Better, visible in tests only: a test that asserts `isRunning` after `start()` passes, where in 1.35 it reads false forever | Approve, in L13a |
| **(ca)** `eventHistory` records `events.*` calls | Better in principle, but worse for existing tests: counts in tests written against 1.35 change | Decline; pin U2 |
| **(cb)** `createFakeTimers` can schedule | Better, but a new API; 1.35's docs already point to `vi.useFakeTimers()` | Decline; pin U3; revisit when `timeline` joins `/testing` at the beta |
| **(cc)** a worker posts `ERROR` for a message before `INIT` or after `DESTROY` | Better, rare: an early write is no longer lost silently; but it adds messages a 1.35 client never saw | Decline; pin U14; revisit with the beta's worker |
| **B1** re-place the 46 unclaimed flush-only tests | No behaviour change; 35 tests start gating L0 to L4 | Approve, now, as L13-pre-a |
| **B2** an `all-in` fixture in `size.mjs`, both engines, budgeted | No behaviour change; the all-in becomes a number every PR reports | Approve, in L13-pre |
| **B3** Stryker mutates the four L13 files for the L13 gate | No behaviour change | Approve, in L13-pre |
| **B4** the two status-plugin scenarios move to L12; the surface scenario covers all seven entries | No behaviour change; placements | Approve, in L13-pre |
| **B5** a `selector-1000` workload | No behaviour change | Approve, in L13b, unless an adapter bench covers it |
| **B6** signing for approved rows | No behaviour change; the census needs signed entries | Approve |

### A. Decisions

#### A1 where the subpaths live, the all-in ceiling, and the L13 budgets

- **What 1.35 does.** Seven entry points, each its own file; an app pays only for what it imports.
- **What 2.0 would do.** The same seven (O1). The core gains one seam: each system's tracker in a `WeakMap`, so `/adapter-utils` can track a selector (S1).
- **The measured basis.** 1.35's all-in is 97,527 B. L13's own code is 7,956 B in 1.35, ported at 1.0 less the stubs it replaces: about +7.0 KB on the all-in. The L10 to L12 RFCs put 2.0's all-in at 90,030 B after L12 at their targets and 92,480 B at their caps (Size).
- **The ceiling, and why it is not half.** Half of 1.35 is 48,764 B, and 2.0's all-in is projected at 97,030 B at every target. No cap at L13 can close a 48 KB gap: it comes from L11 and L12's tools and plugins, ported as code at their 1.35 size. So the ceiling I recommend is **1.35's own all-in, 97,527 B**: 2.0 is never larger than 1.35 for an app that uses everything. It binds before the layer caps do: if L10 to L12 each land at their caps, the all-in reaches 92,480 B, and L13 has 5,047 B, not 8.0 KB, so L13 comes back to the owner. That is the point of a ceiling.
- **Half, said plainly.** It holds for neither the alpha nor the beta all-in. It is close for the beta's smallest app (26,505 B today, half of 1.35's `minimal` is 24,657 B). If Jason wants half for the all-in, it is a beta decision: rebuild the tools and plugins smaller, or move them out of core, beyond what `PACKAGES-2.0.md` already moves.
- **Product verdict.** Same behaviour. An app that imports no subpath grows by the seam only.
- **Recommendation.** Approve O1; the all-in ceiling at 97,527 B, measured by B2's fixture from L13-pre; L13 up to +8.0 KB on the all-in (target 7.0 KB) and +60 B on the five app fixtures (the seam's reasoned 20 to 40 B and a margin). L13b measures the seam first and comes back if it is over 60 B. Restate the plan's "half" as a beta target for the minimal line.

#### A2 do deep fuzz runs gate L13, or report?

- **What L8 and L9 chose.** "Gate on short seeds; deep runs report".
- **Why L13 is no different.** The model reaches nothing new at L13 except the `testSystem` view, which reads hooks the fuzz already compares.
- **Recommendation.** The same answer.

#### A3 fuzz-ready before the gate

- **Recommendation.** L8's brakes unchanged, with the L8 to L12 gates as the precondition.

#### A4 which downstream suites gate L13

- **What the plan says.** The row lists "query/ai/sources/react/vue/svelte/solid/lit/el suites" as L13's tests, and the release path orders the switch adapters, then `query`, `sources`, `mutator`, `optimistic` and `el`, then `timeline` and `cli`, then `ai` and `ai-harness`, with `ai`'s own gate.
- **What the tree shows.** `ai` needs L11's tools, L12's plugins and L13's `/internals` and `/adapter-utils`, and its gate needs the minglingo runner tests, which are outside this repository, and a 1.35 checkpoint.
- **Recommendation.** L13's gate runs every downstream suite but `ai` and `ai-harness` on both engines, through D1. `ai` and `ai-harness` switch at their own Phase 4 gate.

### Candidate divergences

#### (bz) a test system's state flags read the system

- **What 1.35 does.** `createTestSystem` returns `{ ...system, … }`. The spread runs each getter once, so `isRunning`, `isInitialized` and `isSettled` keep their creation values: false, false and true, whatever the system does later (P1, P9). The methods work; only these read stale.
- **What 2.0 would do.** Build the same object, but define those flags (and any other own getter of the system) as getters that read the system.
- **Product verdict.** Better, visible in tests only.
- **Recommendation.** Approve, in L13a. A test that relied on the stale value is hard to imagine; one that is surprised by it is easy.

#### (ca) `eventHistory` records `events.*` calls too

- **What 1.35 does.** Only `dispatch` is wrapped. `ts.events.inc()` changes the fact and adds nothing to `eventHistory` (P1).
- **What 2.0 would do.** Record both.
- **Product verdict.** Better in principle; worse for existing tests, whose `eventHistory` counts would change.
- **Recommendation.** Decline. Pin U2.

#### (cb) `createFakeTimers` can schedule

- **What 1.35 does.** The factory keeps a timer list that nothing can add to, so `advance`, `next` and `runAll` fire nothing; only `now()` moves (P3). Its doc says otherwise.
- **What 2.0 would do.** Add `setTimeout` and `clearTimeout` members that schedule on it.
- **Product verdict.** Better, but new API, and 1.35's docs already send users to `vi.useFakeTimers()` with `settleWithFakeTimers`.
- **Recommendation.** Decline. Pin U3; revisit when `timeline` joins `/testing` at the beta.

#### (cc) a worker answers a message it cannot handle

- **What 1.35 does.** A message before `INIT`, or after `DESTROY`, is dropped with no reply (P7).
- **What 2.0 would do.** Post `ERROR` with the message type as `source`.
- **Product verdict.** Better, rare: a write sent before the worker is ready is no longer lost silently. But a 1.35 client never saw these messages, and its `onError` would now fire.
- **Recommendation.** Decline. Pin U14; revisit with the beta's worker.

### B. Recommendations the owner may overrule

#### B1 re-place the 46 unclaimed flush-only tests

- **Recommendation.** Now, as L13-pre-a: `instruments: ["import flushMicrotasks"]` on the rules for `engine.test.ts`, `system.test.ts`, `derivation-deps.test.ts` and `resolvers.test.ts`, as `requeue.test.ts` has (`layers.rules.json:409–412`). Measured: 35 black-box tests land at L0 to L4 and pass on v2; the rest land at L7, L9 and L12.

#### B2 an `all-in` fixture

- **Recommendation.** In L13-pre, `size.mjs` measures one bundle of the seven entries on both engines and budgets core-next's against A1. From then on every PR reports it.

#### B3 the mutation scope

- **Recommendation.** In L13-pre, add `utils/testing.ts`, `utils/migration.ts`, `adapter-utils.ts`, `core/types/adapter-utils.ts` and `adapters/worker.ts` to Stryker's `mutate` list for the `gate: L13` run.

#### B4 the L13 scenarios

- **Recommendation.** Re-tag "requirement helpers, typed helpers and the status plugin" and "createSystemWithStatus wires the status plugin in" L12 in `layers.rules.json`'s `scenarios`. Extend "every root and /plugins export" to all seven entries (U16).

#### B5 a `selector-1000` workload

- **Recommendation.** 1,000 `runTrackedSelector` calls over a system with five facts and two derivations; time and bytes; judged at 1.0 or better against 1.35.

#### B6 signing

- **Recommendation.** L13a and L13c sign the entries for approved rows on the owner's instruction, as at L2, L3 and L7 to L9 (GATE-2 rule 1). Declined rows get no entry.

### C. Engineering defaults that keep parity (no decision needed)

- **The flush helpers are 1.35's loops**, exactly: 10 microtask turns; and 10, a macrotask, 10, a macrotask, 10.
- **`factsHistory` caps at 10,000 rows** and warns once per system, as 1.35.
- **The worker's message protocol is unchanged**: names, fields, `"module::fact"` keys, the batch fold, and the `ERROR` texts.
- **`assertSystem` throws in development only**, as 1.35 (P8).
- **`factKeys` carries the `\u001F`-prefixed derivation key**, and the adapters' listener on it stays dead, as 1.35 (P8, P10).
- **`depsChanged` stays order-sensitive**, so an adapter re-subscribes exactly as often as on 1.35.
- **`/adapter-utils`' `shallowEqual` is the root's**, which is built.
- **The worker imports the engine lazily**, so a page that imports only the client carries no engine.

## Evidence: probes

**What I ran.** Each command's output went to a file, and I read the files back, not a pipe. `$S` is `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l13`.

- Install and builds: `pnpm install --frozen-lockfile --prefer-offline --ignore-scripts` (exit 0); `pnpm --filter @directive-run/core build` and `pnpm --filter @directive-run/core-next build` (exit 0 each). Logs `$S/install.log`, `$S/build-core.log`, `$S/build-next.log`.
- core-next sizes: `node scripts/size.mjs --check` in `packages/core-next` (exit 0): `minimal` 35,282 B, `two-module` 35,373 B, `floor` 11,022 B, `aperture` 40,150 B, `full-entry` 37,551 B, `minimal` beta wiring 26,505 B; 1.35's `minimal` 49,313 B. `$S/size-next.log`.
- Census: `pnpm census` in `packages/conformance` (exit 0). `$S/census.log`.
- Forced L13: `$S/forced.sh` set `current` to `"L13"`, ran the three vitest commands under "Gap analysis" (exit 1 each), and restored the file with `git checkout`; `current` read `"L7"` and `git status --porcelain` was empty. Reports `$S/v2.json`, `$S/v2dist.json`, `$S/diff.json`; the join to `layers.json` in `$S/join.txt` and `$S/l13-status.txt`; the diff summary in `$S/diff-summ.txt`; the L13 placement list in `$S/l13-tests.json` and `$S/l13-placement.txt`.
- Placement simulation: `instruments` added to nine rules in the working copy, `classify()` run through `tsx` from a temporary script at the repo root (exit 0, 0 problems), then `git checkout -- packages/conformance/layers.rules.json` and the script removed; `git status --porcelain` empty. Output `$S/sim.txt`.
- Downstream imports: `node $S/imports.mjs`, output `$S/imports.txt`.
- Size: `node $S/size/measure.mjs ~/dev/directive2-l13rfc` (exit 0), esbuild 0.27.7; output `$S/size/size.log`, each bundle as `<piece>.min.js` beside it.
- Probes: `node probe.mjs <dist> <out>` and `node probe2.mjs <dist> <out>` in `$S/probe/`, against `directive-v1/dist/development` and, with `NODE_ENV=production`, `dist/production` (exit 0 each). `out-dev.json` and `out-prod.json` differ only in P8's `assertSystem` (development throws, production returns) and in one development warning; `out2-dev.json` and `out2-prod.json` are identical (`cmp`). `node keys.mjs` against 1.35's and core-next's `dist/development/index.js` (exit 0), output `$S/probe/keys.json`.

**What I read, not ran.** The 1.35 and core-next file and line citations above; W7 (the worker client); T3, T7 and T8; the claim that the three source differences between the 1.35.0 tag and the workspace's 1.36.0 do not reach a production bundle; the L10, L11 and L12 RFCs' A1 figures (`git -C ~/dev/directive2-l1{0,1,2}rfc show HEAD:…`); and whether `src/unbuilt.ts` is still referenced. The one development warning in `out-dev.json`, "System created but start() was never called", most likely comes from the worker probe's system, created at `INIT` and started by a later message after a `setTimeout(0)`; I did not isolate it.

Every probe but P7 builds one module, `m`: fact `n` (init 0), derivation `double`, event `inc`, a constraint `big` (`n > 5`) requiring `X`, and a resolver for `X` that sets `n` back to 0; probe 1 adds an effect `log` that reads `n`.

| Probe | Steps | 1.35 |
|---|---|---|
| P1 | `createTestSystem({ module })`; read the flags; `start()`; `dispatch({ type: "inc" })`; `events.inc()`; `assertFactSet("n", undefined)`; `assertFactSet("n", 99)` | Flags false, true before and false, false, true after; `isRunning` is a plain property on the result. `n` is 2; `eventHistory` `["inc"]`; history `n`: none→0, 0→1, 1→2. The `undefined` assert passes; the 99 assert throws "Expected fact "n" to be set to 99 but got: 0, 1, 2" |
| P3 | `createFakeTimers()`; a real `setTimeout(5)`; `advance(1000)`, `next()`, `runAll()`; wait 20 ms | `now()` 1000; the real timer had not fired after `advance`, and fired after the real wait; members `advance`, `next`, `now`, `reset`, `runAll` |
| P4 | `mockResolver("X")` as the resolver; write `n` to 6; `resolve()` | One call, one pending, one in flight; then none pending or in flight; `calls` a plain property |
| P5 | `createCoverageTracker`; `run` a write of 1 | `constraintsMissed` `["big"]`, `resolversMissed` `["x"]`, `effectsRun` `["log"]`, `derivationsComputed` `[]`; coverage 0, 0, 1, 0 |
| P6 | `createTestObserver`; start; write | Members `clear`, `dispose`, `events`, `ofType`; types `constraint.evaluate`, `derivation.compute`, `effect.run`, `fact.change`, `reconcile.start`, `system.start`; `ofType("fact.set")` 0 |
| P7 | In-process worker (`self`, `postMessage` stubbed); `SET_FACT` before `INIT`; `INIT`; `START`; `SET_FACT "n"`; `SET_FACT "m::n"` 2, twice; `SET_FACTS`; `INSPECT`; `GET_SNAPSHOT`; `DESTROY`; `START`; `INIT` with `"nope"` | Nothing before `INIT`; `READY`, `FACT_CHANGED`, `DERIVATION_CHANGED`, `STARTED`; `ERROR` "fact key "n" names no module …", `source: "SET_FACT"`; one `FACT_CHANGED` `m::n` 2, then nothing for the equal write; one `FACT_CHANGED` for the batch; `INSPECT_RESULT` with 15 keys; `DERIVATION_CHANGED` then `SNAPSHOT_RESULT` (`createdAt`, `data`); `DESTROYED`, then nothing for `START`; `ERROR` "Module "nope" not registered …", `source: "INIT"` |
| P8 | `runTrackedSelector` with `double + n`, and with `double` alone; `depsChanged`; `buildHistoryState`; `computeInspectState`; `mergeHydrationFacts` ×3; `assertSystem("useX", null)` | `factKeys` `["\u001Fdouble", "n"]` and `["\u001Fdouble"]`, `deriveKeys` `["double"]`; order change counts; history `null`; `{ b: 2, a: 1 }`, `{ data: null, a: 1 }`, `{ b: 2 }`; development throws "useX() requires a system instance …", production returns |
| P9 | `createTestSystem`; `start()`; write `n` to 6; wait | `n` back to 0 (the resolver ran); `allRequirements` `["X"]`; flags still false, false, true; `onSettledChange` called 7 times on a second write |
| P10 | A `$store.subscribe(["\u001Fdouble"])`; write `n`; read `double` | 0 calls; `double` 2 |
| P11 | `Object.keys` of a system on each engine, and of its spread | 42 own enumerable keys on both, the same names; `isRunning` an own getter on both; the spread has 42 |

**Reading the table:** P1 and P9 are (bz) and (ca), P3 is (cb), and P7 is (cc). P8 and P10 settle the selector's prefixed key as a default (C), and P11 shows that a spread-based `createTestSystem` copies the same members on core-next. The probe files key them as `T1_spread` (P1), `T2_fakeTimers` (P3), `T3_mockResolver` (P4), `T4_coverage` (P5), `T5_observer` (P6), `T6_worker` (P7) and `T7_selector` (P8) in `out-*.json`, and `P1b` (P9) and `P8_prefixedKeySubscription` (P10) in `out2-*.json`.
