# RFC: L6 snapshots, hydrate, validation and persistence

Status: draft for review, revision 1. No engine or oracle code merges from this document.
Tree: branch `p6/l6-rfc`, cut from `main` at `1beb79fd` (L0 to L5 built; `layers.rules.json` `current` is `"L4"`; the L5 gate is being merged separately). Nothing in `packages/conformance` or `packages/core-next/src` is changed by this PR.

## What we are building

L6 is the saved-state layer. The plan's row reads "Snapshot/restore/hydrate, dev-only validation, t.* refine/transform/brand, persistence plugin", with the representative tests "restore-flush-reconcile, snapshot-events, nested-mutation-\*, schema-introspection, persistence", sized as "Aperture ~6.0 (ceiling 8)", and marked "core + plugin". The plan's seams table adds an L6 row: a saved-state envelope `{v, schema:{[module]:n}, facts}`, a module `version` plus `migrate(from, data)`, storage that may return a promise, a pluggable codec, a snapshot `{v, schemaHash}` with a state hash, and "a golden test that 1.35 ignores the new envelope fields". The owner's decision A2 (approved 2026-11-01) builds the `aperture` size fixture here, as a copy of the real lab, with nothing synthetic.

The rules are the ones L2 to L5 settled on. Parity with 1.35 is the rule, and when this document and 1.35 disagree, 1.35 wins. Every layer slice runs `conformance:diff` at the forced layer and checks the open gates. The layer gate runs green before the first build slice.

**Half of the row is already built.** core-next carried these over at L0 to L3 for parity, and their tests pass on v2 today:

| Plan item | State in core-next | Where |
|---|---|---|
| `hydrate()` | Built: applied after the module inits, after `initialFacts`, filed as origin `"hydrate"` | `api/core.ts:294–316, 1313–1355` |
| `getSnapshot()` | Built: `{ facts, version: 1 }` | `api/core.ts:1563–1565` |
| Development validation | Built: the validation part, wired by `createSystem` in development | `api/validate.ts:143–151`, `api/system.ts:24` |
| `t.*` refine, transform, brand | Built: the same chain as 1.35 | `api/schema/base.ts:153–215` |
| `system.restore()` | **Not built** | 1.35 `engine.ts:4298–4334` |
| The persistence plugin, and the hydration capability it uses | **Not built** | 1.35 `plugins/persistence.ts`, `core/internal-scopes.ts`, `engine.ts:4884–4891` |
| Schema introspection (`getKind`, `getSchemaFieldKinds`, `getOperatorsForKind`, `listAllPredicateOperators`) | **Not built**. Not in the plan's row, but its 28 tests are placed at L6 (`lib/layers.ts:71`) | 1.35 `core/schema-introspection.ts` |
| The `aperture` fixture | **Not built** | A2; the lab's shape is in `~/Desktop/directive-size-plan/research/deep-dx/lab/src/implementations/directive/` |

**What may differ from 1.35.** Nothing is approved yet. Ten **candidate divergences**, lettered after the ones already used ((a) to (ae)), are listed under "Decisions for the owner": (af) to (ao). Each is built only if Jason approves it. Until he does, the slice keeps 1.35's behaviour and pins it.

| If "approved" means | Then this gets built |
|---|---|
| Restore | `system.restore()` and the hydration capability, as one part wired by `createSystem` (so `floor` does not carry it). |
| The persistence plugin | `persistencePlugin` in core-next's `/plugins` entry: an import, so it costs `minimal` nothing. |
| Schema introspection | The four functions as a separate module behind root exports; tree-shaken, so it costs `minimal` nothing. |
| The `aperture` fixture | `scripts/fixtures/aperture.ts`: the lab's three Directive files, verbatim, and its system setup, with the page code stubbed. |
| The oracle first (L6-pre) | Black-box pins for the 15 behaviours below that no test pins on either engine, a 41-row mapping of the validation cases v2 skips, a golden test for the envelope, and one scenario moved to L12. |
| Candidates, built only if approved | (ag), (ah), (aj), (am): development-only checks and messages. (ai), (ak): the persistence plugin restores after the module inits and skips stale keys. (al): `.default()` seeds facts, as the docs say it does. (af), (an), (ao): recommended no. |
| Not built at L6 | `getDistributableSnapshot` and `watchDistributableSnapshot` (L12, with signing), `history.restore` and snapshot events (L8), the envelope itself (A4: the beta). |

**In plain terms:** L6 is smaller than the plan's row suggests: hydrate, snapshots, validation and the schema chain already work in core-next. What is left is `restore()`, the persistence plugin, schema introspection and the size fixture. The probes found that 1.35's persistence is broken in ways a user would notice: in the Aperture lab itself, the saved palette never survives a reload. They also found that the plan's envelope cannot be written where 1.35 reads saved data without breaking a rollback. The size cost to `minimal` is small, an estimated 0.2 to 0.35 KB, but `minimal` has 86 B of room, so it needs Jason's OK.

## Gap analysis, measured

What I ran: `layers.rules.json` `current` set to `"L6"` in the working copy only, then `npx vitest run --project conformance:v2 --project conformance:v2:prod` and `--project conformance:diff` from `packages/conformance`, with the JSON reporter. Then `git checkout -- packages/conformance/layers.rules.json`; `git status` was clean and `current` read `"L4"` again. `conformance:v2:dist` was not run.

| Run | Tests | Pass | Fail | Skipped |
|---|---|---|---|---|
| `conformance:v2` and `conformance:v2:prod`, together, at forced L6 | 3,240 | 1,479 | 68 | 1,693 |
| `conformance:diff` at forced L6 | 263 | 252 | 11 | 0 |

**Reading the table:** all 68 v2 failures are placed at L6, and all are in development-project files; no production-only file fails. 87 tests are placed at L6, every one black-box: 68 fail and 19 pass. The 19 that pass are the parts already built (11 `hydrate`, 1 `getSnapshot`, 7 `t.*` chain tests).

| Feature | Failing | Representative tests |
|---|---|---|
| `system.restore()` | 3 | `engine.test` "Snapshot > restore applies snapshot facts"; `ssr.test` "getSnapshot() → restore() round-trip restores facts from a snapshot into a running system"; "full SSR lifecycle: create → start → settle → snapshot → destroy" |
| The persistence plugin | 35 | `persistence.test` (all): name 1, restore at init 4, load errors 4, `onRestore` 2, `include` 2, `exclude` 2, `onFactSet` 3, `onFactDelete` 2, `onFactsBatch` 3, debounce 3, `onDestroy` 3, `onSave` 2, save errors 3, save guards 1 |
| The hydration capability | 2 | `hydration-scope.test` "marks restored values as hydration with persistence listed first"; "… whatever position the plugin is in" |
| Schema introspection | 28 | `schema-introspection.test`: `getKind` 8, `getSchemaFieldKinds` 2, `getOperatorsForKind` 13, `listAllPredicateOperators` 1, hostile getters 2, development warnings 2 |
| Already passing | 19 | `ssr.test` and `system.test` hydrate cases; `l8-system-oracle` "hydrate() data in a single-module system" (2); `engine.test` "getSnapshot returns current facts"; `schema-builders.test` refine, transform and brand (7) |
| **Total failing** | **68** | |

**Reading the table:** every failure is a missing piece, not a wrong one. One caution: `persistence.test.ts` drives the plugin against a mock system (`createMockSystem`, line 26), not a real one, so its 35 tests cannot see when the plugin's writes land relative to the module inits. The diff scenario and the probes can, and that is where the biggest finding is (U7).

| Failing diff scenario | Differences | Why |
|---|---|---|
| "the persistence plugin restores, saves debounced, and excludes keys" | 52 | `plugins.persistencePlugin is not a function` on v2 |
| "snapshot and restore round-trip, with reconcile after restore" | 43 | No `restore` on v2 |
| "schema introspection: kinds, operators and predicate validation" | 10 | No `getKind` on v2 |
| "distributable snapshots" | 3 | `getDistributableSnapshot` is not built. The scenario table places it at L6 (`layers.rules.json:118`), but the plan's L12 row ("signed/distributable snapshots") and the detector (`getDistributableSnapshot: "L12"`, `lib/layers.ts`) put it at L12 (B4) |
| Seven L5 scenarios: "async stop, evict and destroy", the two `l5-sources-leaks` rows and the four `l5-sources-pins` rows | 3 to 18 each | Not L6. They are the L5 gate's (approved rows (aa) to (ae) and B1), which is being merged separately. Not checked here |

**Reading the table:** the two L6 schema scenarios ("t.\* refine, transform, brand and wrong types in development" and "every t.\* builder accepts good writes and refuses bad ones") already pass. The L6 diff gap is three scenarios, plus one that belongs at L12.

**Tests v2 skips as white-box or internals.** None of the 12 internals files and none of the 13 white-box files in `WHITE-BOX.md` has a test placed at L6, so L6 has no equivalent of L5's 68 rows by placement. But the plan's "dev-only validation" is tested mostly in two internals files, whose cases the detector places at L0: 22 in `facts.test.ts` ("schema validators (t.\*)", `strictKeys`, "validates through the proxy") and 19 in `mutants-facts.test.ts` (message previews, option defaults, `safeParse` schemas). v2 skips all 41, because the files import `createFactsStore` from `/internals`. core-next built validation at L0 against black-box `schema-builders.test.ts` (82 cases) and the two passing scenarios, so these 41 rules have never run on v2. L6-pre maps them (U13).

**The plan's representative files mostly test other layers.** `restore-flush-reconcile` (1 test) and `snapshot-events` (17) are placed at L8, because they drive `history`. The `nested-mutation-*` files hold 16 tests at L2 to L9 and none at L6. Only `schema-introspection` and `persistence` are L6 files.

## The design: each 1.35 rule, the mechanism that keeps it, and its pin

Where a row says "verified", the behaviour was observed by running a probe against the built 1.x package in `packages/core/dist` (and, for Q6 to Q9, the built core-next too); the output is under "Evidence". The rest is read from the code, with lines cited. 1.35 paths are under `packages/core/src/`, core-next paths under `packages/core-next/src/`.

### Where each piece lives, and what it costs `minimal`

**In plain terms:** only `restore()` has to be in every system, because 1.35 puts it on every system with no import. It is about 0.2 KB. Everything else is an import, or is already there.

| Piece | Must it be in `createSystem` in the alpha? | Why |
|---|---|---|
| `restore()` | Yes | A method on every 1.35 system (`engine.ts:4298`; the namespaced form binds the engine's, `core/system.ts:1006–1007`), reached with no import. As a part wired by `createSystem`, like validation, it stays out of `floor` and `createSystemCore` (B6). |
| The hydration capability | Yes, with `restore` | The plugin asks the system to file its writes as hydration. 1.35 keeps this in a module-private map keyed by system (`core/internal-scopes.ts`), installed before the first plugin's `onInit` (`engine.ts:4884–4891`). |
| `getSnapshot`, `hydrate`, validation, the `t.*` chain | Already in `minimal` | Built (table above). Validation is development-only at run time. |
| The persistence plugin | No | `import { persistencePlugin } from "@directive-run/core/plugins"`, as in 1.35. |
| Schema introspection | No | Root exports that a bundler drops when unused. It costs `full-entry` (every export), not `minimal`. |
| The envelope seams | No, at the alpha (A4) | A new format is a beta feature behind its own import. |

### Snapshot and restore

**In plain terms:** a snapshot is the facts in a plain object. Restore writes them back in one batch, filed as loaded data rather than as this run's decisions. Its corners are what happens when the data is bad, or the timing is wrong.

| # | 1.35 rule | 2.0 mechanism | Pinned by |
|---|---|---|---|
| S1 | `getSnapshot()` returns `{ facts: store.toObject(), version: 1 }` (`engine.ts:4085–4090`). `toObject` copies one level (`core/facts.ts:625`), so nested values are the live ones: pushing onto a snapshot's array changes the live fact, and nothing is notified. Verified, Q7 and S1, on both engines. | Built (`api/core.ts:1563–1565`); kept unless (af). | L6-pre pin (U1) |
| S2 | `restore(snapshot)` throws, in both modes, on a non-object ("requires a valid snapshot object"), on a missing `facts` object ("must have a facts object"), and on a prototype-polluting key ("rejected: snapshot contains potentially dangerous keys …") (`engine.ts:4299–4316`). | The same three messages, in production too: they are errors, not warnings. | L6-pre pins (U14) |
| S3 | The facts are written in one batch, inside the hydration origin, so plugins hear one `onFactsBatch` with origin `"hydrate"`, derivations invalidate, and a reconcile follows (`engine.ts:4318–4334`, `withHydrationOrigin` at `engine.ts:716`). A blocked key is skipped. | The part writes through the store's batch with core-next's origin switch (`api/core.ts:961`), as `hydrate` already does (`api/core.ts:1343–1345`). | diff "snapshot and restore round-trip, with reconcile after restore"; `ssr.test` (2, fail) |
| S4 | Only `snapshot.facts` is read. Every other field, including `version`, is ignored. Verified, S4: `{ v, schemaHash, schema, version, facts }` restored `facts` and nothing else. | Same. | L6-pre golden-style pin (U3) |
| S5 | Each key is checked as it is written. In development, an unknown key or a bad value throws after the earlier keys are committed, and the batch still flushes, so the system is left half-restored. Verified, S2 and S3: `n` was restored, `tags` was not, and the derivation already read the mix. In production nothing is checked, and an unknown key goes into the store. | Without (ag): copied. With (ag): in development, every key and value is checked before any is written; nothing changes in production. | diff scenario (U2) |
| S6 | `restore()` before `start()` is overwritten by the module inits at start, with no warning (verified, S5); after `destroy()` it still writes (verified, S6). | Without (ah): copied. With (ah): a development warning before start. After destroy is kept. | L6-pre pins (U4) |
| S7 | A namespaced snapshot has flat keys (`"c::n"`), since the namespaced system binds the engine's `getSnapshot` (`core/system.ts:1006`). `restore()` takes them; `hydrate()` does not, because it expects `{ c: { n } }`, so `hydrate(() => snapshot.facts)` drops every key. Development warns "unknown namespace "c::n"" once per key; production is silent. Verified, S7. | Same unless (ao). | L6-pre pin (U6) |

**Reading the table:** S1, S5 and S7 are the ones a user can trip over: a snapshot that is secretly live, a restore that half-applies, and a snapshot that `hydrate` silently ignores. The rest is a port.

### Hydrate (already built; the rules L6 must not break)

| # | 1.35 rule | State | Pinned by |
|---|---|---|---|
| H1 | `hydrate(loader)` throws after start; the loaded object is applied at start, after the module inits and after `initialFacts` (`core/system.ts:449–462, 504–520`; `engine.ts:3274–3285`). | Built, `api/core.ts:1313–1355` | `ssr.test`, `system.test` (pass) |
| H2 | Dangerous keys: the single-module form warns in development and skips the whole object (`core/system.ts:1171–1177`); the namespaced form throws (`core/system.ts:424–428`). | Built (`loadFlat`, `api/core.ts:302–316`) | `l8-system-oracle`, `ssr.test` (pass) |
| H3 | A loader that is not awaited before `start()` resolves too late, and its data is never applied, not even after a stop and start. Verified, Q8, on both engines, with no warning. | Built, as 1.35 | L6-pre pin (U5); (ah) adds a development warning |

### The persistence plugin

**In plain terms:** the plugin loads saved facts when the system is created, and saves the facts that change, a short while after the last change. The probes found three ways it loses a user's data, and each is a candidate.

| # | 1.35 rule | 2.0 mechanism | Pinned by |
|---|---|---|---|
| P1 | Options: `storage` (sync `Storage`), `key`, `include`, `exclude`, `debounce` (100 ms), `onRestore`, `onSave`, `onError` (`plugins/persistence.ts:30–47, 84–93`). A key is persisted unless excluded; with `include`, only if included (`100–104`). | Same. | `persistence.test` (fails) |
| P2 | Load: a missing value or a non-object is nothing; bad JSON and a prototype-polluting object go to `onError` and load nothing (`107–128`). | Same. | `persistence.test` (fails) |
| P3 | Restore happens in the plugin's `onInit`, which runs when the system is created, before `start()` (`161–200`). The writes are one batch inside the hydration capability; without it, the plugin logs an error and restores anyway (`171–197`). `onRestore` follows (`198`). | The capability is a module-private map, set by the part before the plugins' `onInit`, as 1.35 (`engine.ts:4884–4891`). | `hydration-scope.test` (2, fail) |
| P4 | **The module inits run at `start()`, after the plugin restored, so an init that sets a persisted fact overwrites it.** Verified, S11 and Q1. This is the Aperture lab's own setup: its `scene` init sets `palette` (`modules/scene.ts:49`), and the plugin persists `scene::palette` (`index.ts:18`), so on 1.35 the saved palette is restored and then replaced at every start. An init that leaves the fact alone (Q2) or uses `??=` (Q3) keeps it. | Without (ai): copied. With (ai): the restored object is applied on hydrate's path, after the module inits, filed as hydration. | diff scenario (U7) |
| P5 | Saving: each set, delete or batched change of a persisted key restarts one timer, `clearTimeout` then `setTimeout(save, debounce)` (`151–156, 210–239`). `save` writes the tracked, persisted keys as JSON (`131–148`), reading each through `system.facts` (`139`); an error goes to `onError`. `onDestroy` clears the timer and saves at once (`202–208`). Nothing saves before `onInit` (`132`). | Same timing, on `setTimeout`, as 1.35 (C list). | `persistence.test` (fails) |
| P6 | **In development, a save that includes a Date fact fails as a whole.** Reading the fact through the development view returns a wrapped Date, and `JSON.stringify` then throws "this is not a Date object.", so nothing is saved and only `onError` hears. Production saves it as an ISO string. Verified, Q5 and S16. Reasoned: the wrapper is the development view (line `139` reads through `system.facts`). | Without (aj): copied. With (aj): the plugin reads values from the store, not from the development view. | diff scenario (U8) |
| P7 | **A saved key the schema no longer has** (an app update removed a fact) is written like any other. In development that throws "Unknown fact key", the plugin manager logs "Plugin error", and the restore stops partway. Verified, S10. In production the stale key goes into the store, and is saved again on the next save. Reasoned from S12, where production wrote unknown keys. | Without (ak): copied. With (ak): keys not in the schema are skipped, with a development warning. | diff scenario (U9) |
| P8 | On a namespaced system the plugin sees flat keys: it saved `{"c::n":8}` and the lab's `include` names `"scene::palette"`. Verified, S13. | Same. | L6-pre pin (U15) |

**Reading the table:** P4 matters most. A persistence plugin whose saved values lose to the module's own init persists nothing for the commonest setup, and the 35 plugin tests miss it because they use a mock system. P6 and P7 are smaller, but each loses data silently, which is the failure persistence exists to prevent.

### `t.*` refine, transform, brand and default (built; three corners)

| # | 1.35 rule | State | Pinned by |
|---|---|---|---|
| T1 | `.refine(pred, message)` appends `pred` to the validators and records `{ predicate, message }` (`core/schema-builders.ts:205–215`). The message is never used: a failure reads "expected number, got number 3 (validator 2 failed)". Verified, Q9, both engines. | Built, as 1.35 | L6-pre pin (U12); (am) |
| T2 | `.transform(fn)` composes with an earlier transform and **drops every validator**, the type check included (`core/schema-builders.ts:165–178`). Nothing in 1.35 calls a transform on a write (no reader of `_transform` outside the builders). So `t.number().min(0).transform(f)` accepts `"7"` in development. Verified, Q9, both engines. | Built, as 1.35 | L6-pre pin (U12); (an) |
| T3 | `.brand()` keeps the validators and renames the type `Branded<…>` (`180–193`). | Built | `schema-builders.test` (pass) |
| T4 | `.default(value)` is stored and never applied. A fact declared `t.number().default(5)` reads `undefined` after start. Verified, Q6, both engines; nothing outside the builders reads `_default`. **The docs say otherwise:** `docs/api/facts.md:160–170`, "Module init seeds these automatically", and the plugin skills teach it. | Built, as 1.35 | L6-pre pin (U11); (al) |

**Reading the table:** T2 and T4 are cases where the API promises something the engine never does. T4 is the clearest: the published docs describe a feature that does not exist.

### Schema introspection

| # | 1.35 rule | 2.0 mechanism | Pinned by |
|---|---|---|---|
| I1 | `getKind(builder)` reads a builder's type name and wrappers into a kind tree (nullable, branded, array element, object shape); a getter that throws gives `{ kind: "unknown" }` (`core/schema-introspection.ts:180`). | A separate module; pure functions. | `schema-introspection.test` (28, fail) |
| I2 | `getSchemaFieldKinds(schema)` walks a schema or a bare facts record, and one hostile builder does not stop the walk (`228`). | Same. | Same |
| I3 | `getOperatorsForKind(kind)` and `listAllPredicateOperators()` answer from the predicate operator set (`320, 380`), which comes from `types/predicate.ts` (`17`), a constant of the L11 predicates. | The constant comes along: a list of names, not the predicate engine. | Same |
| I4 | Development warns when a `t.*` factory is passed without `()`, and when a schema yields no introspectable keys. | Two development strings. | Same |

**Reading the table:** introspection is a port of pure functions. Its only question is placement: its operators belong to L11, but it reads L0 builders, and its tests are placed at L6. Keep it here (B5).

### Deferred to their own layers

- `getDistributableSnapshot` and `watchDistributableSnapshot` (`engine.ts:4092–4296`): L12, with signing; move the "distributable snapshots" scenario there (B4).
- `history.restore`, snapshot events and `restore-flush-reconcile` (history-driven): L8.
- The envelope, module `migrate`, an async storage and a codec option: A4 places them at the beta.
- A state hash for desync checks: with `@directive-run/sync`, after the alpha.

## Untested behaviours, and what will pin each

**In plain terms:** the probes found 15 behaviours that no test pins on either engine. Each needs a pin before the slice that could break it. "Conformance" means a test that runs on v1 and v2; "diff" means a scenario the diff harness runs on both.

| # | Behaviour | Evidence | Pinned by | Slice |
|---|---|---|---|---|
| U1 | A snapshot's nested values are the live facts | S1, Q7 | A conformance test | L6-pre |
| U2 | A development restore with a bad key or value is half-applied; production writes the unknown key | S2, S3 | A diff scenario, both modes; shows (ag) if approved | L6-pre |
| U3 | `restore()` ignores every field but `facts` | S4 | A conformance test with `{ v, schemaHash, schema, facts }` | L6-pre |
| U4 | `restore()` before `start()` is overwritten by init; after `destroy()` it still writes | S5, S6 | Conformance tests | L6-pre |
| U5 | A `hydrate()` not awaited before `start()` is dropped for good | Q8 | A conformance test; (ah) adds a warning | L6-pre |
| U6 | A namespaced snapshot fed to `hydrate()` loads nothing | S7 | A conformance test | L6-pre |
| U7 | A persisted fact that the module's init sets is overwritten at start | S11, Q1 to Q3 | A diff scenario on a real system, with an init that sets the key and one that uses `??=` | L6-pre |
| U8 | In development, a save with a Date fact saves nothing | Q5, S16 | A diff scenario reading storage and `onError` | L6-pre |
| U9 | A stale key in storage aborts the development restore partway, and is written in production | S10 | A diff scenario | L6-pre |
| U10 | 1.35 reading a saved-state envelope fails in development and writes `v`, `schema` and `facts` as facts in production | S12 | A golden test in `contracts/golden.test.ts` (A4) | L6-pre |
| U11 | `.default()` is never applied | Q6 | A conformance test | L6-pre |
| U12 | `.refine()`'s message is not in the error; `.transform()` drops the checks | Q9 | Conformance tests in development | L6-pre |
| U13 | The 41 validation cases v2 skips (`facts.test.ts` 22, `mutants-facts.test.ts` 19) | `WHITE-BOX.md` | A 41-row mapping: each ported through `createSystem`, rewritten, or marked internal with a reason | L6-pre |
| U14 | `restore()`'s three errors, in both modes | `engine.ts:4299–4316` | Conformance tests, development and production | L6-pre |
| U15 | A namespaced system persists and restores flat `ns::key` keys | S13 | A diff scenario | L6-pre |

**Reading the table:** U2, U5, U7 to U9, U11 and U12 are where the candidates live, so each shows the 1.35 behaviour now, and the difference, with a `divergences.json` entry, only if the owner approves it. U10 is not a candidate: it is a fact about 1.35 that decides A4. U13 is the bulk of L6-pre's work, and smaller than L5's: the 41 cases drive the store directly, and most rewrite as one write through `system.facts`.

## Performance

What I ran: `node bench/system/run.mjs --rounds 6` in `packages/core-next` (both engines built at `1beb79fd`, production, `process.env` swapped as for a bundled app, thread CPU time, median of 6 rounds, Apple M4 Pro, load 4.5 to 5.0 on 14 cores). The ratio is core-next's time over 1.35's, so 0.63 means core-next takes 63% of 1.35's time.

| Workload | 1.35 ns/op | core-next ns/op | core-next / 1.35 |
|---|---|---|---|
| scalar-writes | 127 | 82 | 0.64 |
| chain-10 | 3,448 | 2,081 | 0.61 |
| fanout-derive-50 | 18,899 | 10,970 | 0.57 |
| fanout-effect-50 | 17,886 | 8,101 | 0.45 |
| frame-loop | 12,044 | 7,612 | 0.63 |
| **frame-loop-source** | 12,258 | 8,321 | **0.68** |
| subscribe-1000 | 4,671 | 3,959 | 0.85 |
| batch-100 | 16,860 | 10,315 | 0.61 |
| multi-module-20 | 19,826 | 16,288 | 0.82 |
| create-destroy-1000 | 60,923 | 23,614 | 0.39 |
| startup-10-modules | 180,272 | 112,326 | 0.63 |

| Heap, steady state | 1.35 | core-next |
|---|---|---|
| Bytes per fact write | 88.0 B | 0.0 B |
| Bytes per write, with its settle | 92.6 B | 4.7 B |
| Bytes per frame (frame-loop) | 24,853 B | 19,962 B |
| Bytes per frame (frame-loop-source) | 25,304 B | 21,067 B |

**Reading the tables:** restore, hydrate and snapshots are cold paths, so L6 adds nothing to any workload above. The one hot path L6 adds is the persistence plugin's hooks: with the plugin installed, 1.35 calls it on every write (`onFactSet`, or `onFactsBatch` per batch), adds the key to a set, scans `include` and `exclude`, and for a persisted key clears and re-arms a timer. The Aperture lab installs it, so its frame pays that on every one of its writes.

What L6 must keep, and what it adds:

- No workload slower than `main` by more than 5% after any L6 slice, and every workload at 1.0 or better against 1.35.
- L6b adds a `frame-loop-persist` workload (B7): `frame-loop-source` with `persistencePlugin({ include: [one key] })`, as the lab installs it, so most writes are not persisted and one is. The L6 gate judges it at 0.8 or better.
- On that path the plugin keeps 1.35's save timing but not its per-write work: whether a key persists is worked out once per key, and one timer re-arms itself on fire instead of a `clearTimeout` and `setTimeout` per write (C list).

## Slice plan

**In plain terms:** an oracle slice, three build slices and the gate. Each build slice is one PR at the committed `current`, tested at a forced L6 locally, as L5 was. The layer gate runs before L6-pre and again after it.

| Slice | Builds | Done means (checkable) | Tier |
|---|---|---|---|
| Precondition (not an L6 slice) | The L5 gate merges (`current` to `"L5"`); a fresh `mutation-nightly.yml` run with `gate: L6`. | The L6 layer gate reports PASS. Not run for this RFC. | test oracle; coordinator |
| L6-pre (oracle) | U1 to U15. The 41-row validation mapping in `WHITE-BOX.md` and an L6 gap bullet. The envelope golden test (U10). "distributable snapshots" moved to L12 in `layers.rules.json` (B4). | The new tests pass on `conformance:v1` and `v1:prod`, and on v2 fail only as this document predicts. `WHITE-BOX.md` holds 41 rows, each ported, rewritten or internal with a reason. **`conformance:diff` at forced L6 fails only the three L6 scenarios above and the new U2, U7 to U9 and U15 scenarios; the open-gate check passes at the committed `current` and at every open gate's ceiling.** `pnpm census`, `check:expects` and `oracle:update` exit 0. `oracle-change` label. | test oracle; Sonnet |
| Layer gate, again | Nothing built. A fresh `mutation-nightly.yml` run with `gate: L6` after L6-pre merges. | PASS with L6-pre's tests in the tree. L6a does not start before it does. | test oracle; coordinator |
| L6a | First, `scripts/fixtures/aperture.ts` with its measured budget (A5), so the slice's own growth shows against it. Then `restore()` and the hydration capability as one part (S1 to S7, B6), with (ag) and (ah) only if approved. | At forced L6 on v2 and v2:dist: the 3 restore failures pass, and L6-pre's U1 to U6 and U14 pass, listed by file and title. `conformance:diff`: "snapshot and restore round-trip …" matches 1.35, U2 matches or differs only by (ag). Census and ratchet exit 0. core-next `test`, `typecheck`, `build` and `size:check`, with the exact development-string count (116 today, plus any approved warnings). `floor` grows by at most 40 B; `minimal` within A3, with the measured size and attribution in `reason`. | core; Opus implementer, Sonnet diff reviewer plus Fable correctness reviewer |
| L6b | The persistence plugin in `/plugins` (P1 to P8), with (ai), (aj) and (ak) only if approved. `frame-loop-persist` (B7). | The 35 plugin tests and the 2 hydration-capability tests pass at forced L6. `conformance:diff`: "the persistence plugin …" and U15 match 1.35; U7 to U9 match or differ only by an approved candidate, each named. The golden test passes: 1.35 reads core-next's saved data as its own. `frame-loop-persist` at 0.8 or better; no workload slower than `main` by more than 5%. Plus L6a's census, ratchet and core-next checks. | core (users' saved data); as L6a |
| L6c | Schema introspection (I1 to I4), and (al) and (am) only if approved. | The 28 introspection tests pass at forced L6; "schema introspection: kinds, operators …" matches 1.35; U11 and U12 match or differ only by an approved candidate. `full-entry` within A3; `minimal` unchanged unless (al). Plus L6a's checks. | core if (al) is approved, since it changes start; otherwise Sonnet implementer and one Sonnet reviewer |
| L6-gate | `current` to L6, `ratchet --update`, diff and fuzz at L6, a `divergences.json` entry per approved candidate with `approvedBy` empty unless Jason says to sign, `/principal` on L6. | 0 L6 failures on v2, v2:dist and v2:prod. The census fails only on unsigned entries. PR fuzz and nightly run v2 at L6. | test oracle; Sonnet plus the coordinator's read of each entry |

**Reading the table:** L6a and L6b carry the risk. L6a changes what is in every system, and L6b handles users' saved data, where a mistake loses state and is hard to undo. L6c is pure functions unless (al) is approved, which changes what facts hold at start.

### Size

Measured with `node scripts/size.mjs` on this branch (production, minified, gzip level 9). Budgets are `main`'s `size-budgets.next.json`.

| Fixture | 1.35 | core-next now | Budget | Room |
|---|---|---|---|---|
| `minimal` | 55,290 B | 28,314 B | 28,400 B | 86 B |
| `two-module` | 55,381 B | 28,403 B | 28,500 B | 97 B |
| `floor` (no parts) | n/a | 10,417 B | 10,450 B | 33 B |
| full entry | n/a | 30,448 B | 30,550 B | 102 B |
| `aperture` (the lab copy, below) | 53,877 B | 33,035 B, measured by hand | none yet | A5 |

The pieces were measured with a script that repeats `size.mjs`'s build: the same esbuild (tsup's), minify, ESM, ES2022, production, the same `#is-development` inlining and the same property mangling for core-next. It reproduces `minimal` exactly (28,314 B), so its other numbers compare.

| Piece | How measured | gzip |
|---|---|---|
| `restore()` | A port of 1.35's `restore` with its three messages (`restore-stub.ts`), added to `minimal` | **+184 B** (measured; the port is mine, not a build of the real slice) |
| The hydration capability | Reasoned: one `WeakMap` set and one lookup | +20 to 40 B (estimate) |
| 1.35 `plugins/persistence.ts` | Alone | 915 B |
| The same | Added to `minimal` in `plugins: […]` | +712 B, not in `minimal` (an import) |
| 1.35 `core/schema-introspection.ts` | Alone | 998 B |
| The same | Three of its functions used from `minimal` | +714 B, not in `minimal` (tree-shaken); in `full-entry` |
| (ag), (ah), (aj), (am) | Development-only | 0 B in production |
| (ai), (ak) | In the plugin | +20 to 60 B to the plugin (estimate) |
| (al) | Seeding defaults at start, in `createSystem` | +60 to 120 B (estimate) |
| **`minimal`, L6 in total** | `restore`, the capability, and (al) if approved | **+0.2 to 0.35 KB**, to about 28.5 to 28.7 KB |
| **`full-entry`, L6 in total** | The above plus introspection | **+0.9 to 1.3 KB**, to about 31.4 to 31.8 KB |

**The `aperture` copy.** I copied the lab's `schemas.ts`, `modules/scene.ts` and `modules/notes.ts` verbatim, wrote its system setup from `index.ts:15–21` (three modules, the persistence plugin with `include: ["scene::palette"]`, and `history` off, as a production build of the lab has it), and stubbed the shared page code (`../../scene/*`, the same in all six of the lab's implementations) as external. Against core-next today, with 1.35's persistence source standing in for the plugin, it is **33,035 B**; against 1.35 it is **53,877 B**, so core-next is 39% smaller on the real app. The app's own code is about 4.3 KB of that (4,345 B with the library external). The lab uses 3 modules, `crossModuleDeps`, `init`, `derive`, events, effects, constraints and resolvers, sources in two modules, and 55 `t.*` builders, with no refine, transform or brand.

**In plain terms:** L6 adds about 0.2 to 0.35 KB to every system, almost all of it `restore()`, against 86 B of room, so `minimal` needs a raise (A3). The plan's "Aperture ~6.0 (ceiling 8)" was written before Phase 2 measured `minimal` at 25 KB; the real lab copy is 33 KB on core-next today. That is a new number to set, not a regression (A5). One caution: the lab's own chunk numbers (Directive 41.7 KB, XState 12.5 KB) came from its Vite build of the published package, not from this method, so the fixture compares with itself and with 1.35 on the same copy, not with those numbers.

## What the plan got wrong, or left out

- **Half of the row is built.** `hydrate`, `getSnapshot`, development validation and the `t.*` chain were carried over at L0 to L3, and their tests pass on v2. What is left is `restore`, the persistence plugin and its hydration capability, introspection and the fixture.
- **The representative tests are mostly other layers'.** `restore-flush-reconcile` and `snapshot-events` are placed at L8 (they drive `history`), and the `nested-mutation-*` files hold no L6 test. Only `schema-introspection` and `persistence` are L6 files, and `persistence.test.ts` uses a mock system.
- **Schema introspection is not in the row**, but its 28 tests are placed at L6 (B5).
- **"distributable snapshots" is placed at L6** in the scenario table, while the plan's L12 row and the detector put it at L12 (B4).
- **"Aperture ~6.0 (ceiling 8)" predates Phase 2.** The real lab copy is 33.0 KB on core-next today (A5).
- **The envelope's golden test, "1.35 ignores the new envelope fields", is half true.** `system.restore()` does ignore them (S4). The persistence plugin does not: it restores every top-level key as a fact (`plugins/persistence.ts:173–178`), so an envelope in storage fails in development and writes `v`, `schema` and `facts` as facts in production (S12). `contracts/STABILITY.md:46–56` requires 1.35 to read the workspace's persistence output as its own, or a `goldenChanges` entry signed by Jason. The plan's rollback promise ("revert PR + lockfile, safe via golden-file compatibility") depends on this (A4).
- **"Dev-only validation" is tested mostly by internals files** v2 skips: 41 cases (U13).
- **The docs promise a feature neither engine has:** `.default()` seeding (T4, (al)).
- **The plan does not mention that the lab's own persistence is broken on 1.35** (P4). The lab is the alpha's proof app, so its `npm run parity` should include a reload.

## Decisions for the owner

A "no", or no answer yet, means the slice keeps 1.35's behaviour and pins it with a core-next test.

| Decision | Product verdict | Recommendation |
|---|---|---|
| **A3** L6 size budgets | Same behaviour; `minimal` grows by an estimated 0.2 to 0.35 KB | Approve raises to the measured size: `minimal` and `two-module` up to +350 B, `full-entry` up to +1.3 KB, `floor` up to +40 B; come back above that |
| **A4** the saved-state envelope at the alpha | Same as 1.35 at the alpha | Keep 1.35's formats at the alpha; the envelope comes at the beta, behind its own import and storage key |
| **A5** the `aperture` fixture's shape and budget | No behaviour change; decides the number the alpha.0 gate quotes | The lab's files verbatim, page code stubbed, production; budget from measurement at L6a, replacing the plan's 6 KB and 8 KB |
| **(af)** a snapshot copies nested values | Better, small change, at a cost per snapshot | No: keep 1.35, pin it, document it |
| **(ag)** a development restore checks everything before writing | Better, small change (development only) | Approve, in L6a |
| **(ah)** development warnings for `restore()` before start and `hydrate()` not awaited | Better, small change (development only) | Approve, in L6a |
| **(ai)** the persistence plugin restores after the module inits | Better | Approve, in L6b |
| **(aj)** the persistence plugin saves Date facts in development | Better, small change (development only) | Approve, in L6b |
| **(ak)** the persistence plugin skips saved keys the schema no longer has | Better, small change | Approve, in L6b |
| **(al)** `.default()` seeds facts at start, as the docs say | Better | Approve, in L6c |
| **(am)** `.refine()`'s message appears in the error | Better, small change (development text) | Approve, in L6c |
| **(an)** `.transform()` keeps the checks before it | Worse for some schemas | No: keep 1.35, document that a transform is not applied |
| **(ao)** `hydrate()` accepts a namespaced snapshot's flat keys | Better, small change | No at the alpha: `restore()` is the snapshot path; reconsider with the envelope |
| **B4** "distributable snapshots" moves to L12 | Same | Move it |
| **B5** schema introspection stays at L6 | Same | Keep it at L6 |
| **B6** `restore` lives in a part, not in the core | Same | Approve |
| **B7** a `frame-loop-persist` workload judges the L6 gate | No behaviour change | Approve the shape before L6b |

### A. Decisions

#### A3 the L6 size budgets

- **What 1.35 does.** `restore` is on every system, and the persistence plugin and introspection are imports.
- **What 2.0 would do.** The same split. `restore` and the hydration capability are a part wired by `createSystem` (+184 B measured for a port of `restore`, +20 to 40 B estimated for the capability). (al), if approved, adds 60 to 120 B to every system. Introspection reaches `full-entry` only.
- **Product verdict.** Same behaviour. `minimal` grows by an estimated 0.2 to 0.35 KB, to about 28.5 to 28.7 KB; `full-entry` by 0.9 to 1.3 KB.
- **Recommendation.** Approve raises to the measured size, with a written reason in each slice: `minimal` and `two-module` up to +350 B in total, `full-entry` up to +1.3 KB, `floor` up to +40 B. A raise past that comes back to Jason. Do the attribution step first (find the bytes, move cold code, fold duplicates).

#### A4 the saved-state envelope at the alpha

- **What 1.35 does.** `getSnapshot()` returns `{ facts, version: 1 }`, and `restore()` reads only `facts` (S4). The persistence plugin saves a flat object of facts and restores every top-level key (S12).
- **What the plan would do.** Build the envelope `{v, schema:{[module]:n}, facts}`, module `version` and `migrate`, storage that may return a promise, a codec, and `{v, schemaHash}` at L6, with a golden test that 1.35 ignores the new fields.
- **What the probes show.** For `restore()`, extra fields are harmless. For saved data they are not: written where 1.35 reads, an envelope fails in development (a plugin error, nothing restored) and in production restores `v`, `schema` and `facts` as facts (S12). `STABILITY.md` requires 1.35 to read 2.0's saved data as its own, so writing the envelope at the alpha needs a signed `goldenChanges` entry and gives up rollback for saved data.
- **Product verdict.** Same as 1.35 at the alpha.
- **Recommendation.** Keep both formats exactly as 1.35 at the alpha: `getSnapshot()` stays `{ facts, version: 1 }`, and `persistencePlugin` keeps its flat JSON. Build only invisible seams at L6: the plugin loads and saves through one internal codec point and one storage adapter, with 1.35's JSON and sync `Storage` as the only implementations. The envelope, `migrate`, async storage and a codec option come at the beta, in a new import that writes under its own storage key, so a rollback leaves 1.35's data alone. Add the U10 golden test now, so that a later change to the format has to be made on purpose.

#### A5 the `aperture` fixture

- **What exists.** Nothing in the repo. The plan budgets it at 6 KB, with a ceiling of 8 KB. A2 builds it at L6 as a copy of the real lab.
- **What 2.0 would do.** `scripts/fixtures/aperture.ts` plus the three lab files verbatim, the system setup from `index.ts:15–21`, `history` off (a production build of the lab has none), and the shared page code (`../../scene/*`, the same in all six implementations) stubbed. `size.mjs` measures it on both engines, as it does `minimal`.
- **Product verdict.** No behaviour change. It decides the number the alpha.0 gate quotes: about 33.0 KB on core-next against 53.9 KB on 1.35 today (39% smaller), plus L6's own bytes.
- **Recommendation.** Approve the shape. Set its budget from measurement in L6a, before L6a's code lands, at the measured size plus a small margin, and retire the plan's 6 KB and 8 KB for it. The published comparison with the lab's other implementations needs all six measured one way, which is release work, not L6's.

#### (af) a snapshot copies nested values

- **What 1.35 does.** `getSnapshot()` copies one level, so a snapshot's arrays and objects are the live facts. Changing one changes the system's state, with no notification (S1, Q7). core-next does the same.
- **What 2.0 would do.** Copy every value. `structuredClone` would throw on functions and class instances that 1.35 allows in facts, and a JSON copy would turn Dates into strings. A safe copy costs time on large states.
- **Product verdict.** Better, small change, at a cost on every snapshot.
- **Recommendation.** No. Keep 1.35, pin it (U1), and document that a snapshot shares values with the live facts. Reconsider with the codec at the beta.

#### (ag) a development restore checks everything before writing

- **What 1.35 does.** In development, `restore()` checks each key as it writes it. A bad key or value throws after earlier keys are committed, and the batch flushes, so derivations see a half-restored state (S2, S3).
- **What 2.0 would do.** In development, check every key and value first, and write nothing if one fails. The same error is thrown. Production is unchanged: it checks nothing, as today.
- **Product verdict.** Better, small change. Development only, and only when the restore was going to throw anyway.
- **Recommendation.** Approve, in L6a.

#### (ah) development warnings for `restore()` before start, and `hydrate()` not awaited

- **What 1.35 does.** `restore()` before `start()` is overwritten by the module inits (S5). A `hydrate()` whose promise is still pending at `start()` is never applied (Q8). Both are silent.
- **What 2.0 would do.** Warn once in development in each case, naming the fix ("use `hydrate()` before start" and "await `hydrate()` before `start()`"). No behaviour changes.
- **Product verdict.** Better, small change. Two development strings; 0 B in production.
- **Recommendation.** Approve, in L6a.

#### (ai) the persistence plugin restores after the module inits

- **What 1.35 does.** The plugin restores when the system is created, and the module inits run later at `start()`, so an init that sets a persisted fact overwrites the saved value at every start (S11, Q1). That is the Aperture lab's setup: its saved palette never survives a reload on 1.35.
- **What 2.0 would do.** The plugin hands its restored object to hydrate's path, applied after the module inits and after `initialFacts`, filed as hydration. If the system is already started when the plugin initialises, it applies at once, as today.
- **Product verdict.** Better. It is visible: an init that read a restored value now sees the value before restore, so an init that derives from saved state (`facts.count = facts.saved + 1`) would change. An init that uses `??=` ends with the same value (Q3).
- **Recommendation.** Approve, in L6b. A persistence plugin that loses to the module's own defaults persists nothing in the commonest setup.

#### (aj) the persistence plugin saves Date facts in development

- **What 1.35 does.** In development, a save that includes a Date fact throws inside `JSON.stringify`, so nothing at all is saved, and only `onError` hears (Q5, S16). Production saves.
- **What 2.0 would do.** Read the values to save from the store, not through the development view.
- **Product verdict.** Better, small change. Development only: an app now saves in development what it already saves in production.
- **Recommendation.** Approve, in L6b.

#### (ak) the persistence plugin skips saved keys the schema no longer has

- **What 1.35 does.** In development, a saved key that is no longer in the schema throws "Unknown fact key", and the restore stops partway with a "Plugin error" log (S10). In production the stale key goes into the store and is saved again.
- **What 2.0 would do.** Skip keys not in the schema, with one development warning naming them. The other keys restore.
- **Product verdict.** Better, small change. It is what an app update that removes a fact needs, until the beta's `migrate`.
- **Recommendation.** Approve, in L6b.

#### (al) `.default()` seeds facts at start

- **What 1.35 does.** Stores the default and never applies it (Q6). `docs/api/facts.md:160–170` says "Module init seeds these automatically".
- **What 2.0 would do.** At start, before the module inits, set each fact that declares a default, so an init, `initialFacts` and `hydrate` still win.
- **Product verdict.** Better, and visible: facts that were `undefined` at start now hold their declared defaults, so a constraint or derivation that reads them sees a value on the first pass. Every system pays about 60 to 120 B.
- **Recommendation.** Approve, in L6c. The alternative is to correct the docs and the plugin skills, which is also a change users would notice.

#### (am) `.refine()`'s message appears in the error

- **What 1.35 does.** Records the message and never shows it: the error reads "(validator 2 failed)" (Q9).
- **What 2.0 would do.** Put the message in the development error, after the existing text.
- **Product verdict.** Better, small change. Development text only.
- **Recommendation.** Approve, in L6c.

#### (an) `.transform()` keeps the checks before it

- **What 1.35 does.** A transform drops every validator, the type check included, and is itself never applied to a write (Q9).
- **What 2.0 would do.** Keep the checks before the transform.
- **Product verdict.** Worse for some schemas. Since the transform is never applied, apps write its output type, and a kept input check would reject those writes.
- **Recommendation.** No. Keep 1.35, pin it (U12), and document that a transform is type information only. Decide what a transform should do at the beta.

#### (ao) `hydrate()` accepts a namespaced snapshot's flat keys

- **What 1.35 does.** `hydrate()` on a namespaced system expects `{ ns: { key } }`, while `getSnapshot()` gives `{ "ns::key" }`, so feeding one to the other loads nothing (S7).
- **What 2.0 would do.** Accept both forms.
- **Product verdict.** Better, small change.
- **Recommendation.** No at the alpha. `restore()` is the snapshot path and works (S7). Reconsider with the envelope, which settles one spelling for saved state.

### B. Recommendations the owner may overrule

#### B4 "distributable snapshots" moves to L12

- **What the tree does.** The scenario table places it at L6 (`layers.rules.json:118`); the detector (`getDistributableSnapshot: "L12"`) and the plan's L12 row put the feature at L12.
- **Recommendation.** Move the scenario to L12 in L6-pre. Building `getDistributableSnapshot` at L6 would pull L12's code forward for one scenario.

#### B5 schema introspection stays at L6

- **What the tree does.** The detector places `core/schema-introspection` at L6 (`lib/layers.ts:71`). Its operator answers come from the L11 predicate operator list, a constant.
- **Recommendation.** Keep it at L6, carrying the constant. It reads the L0 builders, costs `minimal` nothing, and moving it would move 28 tests and a scenario.

#### B6 `restore` lives in a part, not in the core

- **What 2.0 would do.** A part wired by `createSystem`, like validation, holding `restore` and the hydration capability. `floor` and `createSystemCore` stay without it. The part needs the core's origin switch, one more call on the part context.
- **Recommendation.** Approve. `floor` has 33 B of room, and `restore` is about 184 B.

#### B7 the `frame-loop-persist` workload

- **What 2.0 would do.** `frame-loop-source` with the persistence plugin installed as the lab installs it, one included key, reporting time and bytes per frame. The L6 gate judges it at 0.8 or better.
- **Recommendation.** Approve the shape before L6b, so the plugin's per-write cost is measured on the gate's own yardstick.

### C. Engineering defaults that keep parity (no decision needed)

- **The plugin's timer is `setTimeout`**, as 1.35 (`plugins/persistence.ts:151–156`). The plugin is outside the kernel and sees only the system, so it does not follow an injected virtual clock; under the harness's fake timers the two agree.
- **One re-arming timer** instead of a `clearTimeout` and `setTimeout` per write: the timer fires, sees that the last change moved the deadline, and re-arms for the rest. The save happens at the same time as in 1.35.
- **Whether a key persists is worked out once per key**, not by scanning `include` and `exclude` on every write.
- **`restore()`'s three errors stay in production**: they are thrown in both modes by 1.35, so they are not development strings.
- **`restore()` and the plugin file their writes as `"hydrate"`**, as 1.35 does (`engine.ts:4318–4334`, `plugins/persistence.ts:171–197`).
- **The hydration capability is installed before the plugins' `onInit`**, so the first plugin in the array gets it (`engine.ts:4884–4891`).
- **The kernel's snapshot registry** (`snapshot.ts`, `contribute`/`dump`/`load`) is not part of `getSnapshot()` at the alpha, since 1.35's snapshot holds facts only. It is where the beta's envelope gathers module parts.

## Evidence: probes

Two probe scripts ran with real timers against the built 1.x package in `packages/core/dist/development` and `dist/production` (the bench reports this build as `@directive-run/core@1.36.0`; the conformance `v1` project pins the published 1.35.0), and the second also against the built core-next (`packages/core-next/dist`). Neither lives in the repo; L6-pre turns each into a conformance test, diff scenario or golden test (U1 to U15).

- Probe sources: `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l6probe/probe.mjs` (S1 to S16) and `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l6probe/probe2.mjs` (Q1 to Q9)
- Output: `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l6probe/out-dev.json`, `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l6probe/out-prod.json`, and `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l6probe/out2-v1-development.json` (and the `v1-production`, `v2-development` and `v2-production` files beside it)
- Size script and the Aperture copy: `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l6size/sz.mjs`, output `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l6size/sz.out`
- Measurement JSON (v2 and diff at forced L6) and the bench output: `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l6/`

| Probe | Steps | 1.x (and core-next where run) |
|---|---|---|
| S1, Q7 | `getSnapshot()`, then push onto the snapshot's array | The live fact changed, in both modes, on both engines |
| S2 | Running system; `restore({ facts: { n: 5, bogus: 1, tags: ["x"] } })` | Development: threw "Unknown fact key: "bogus"", `n` was 5, `tags` unchanged, the derivation read "5/1". Production: no throw, all written |
| S3 | `restore({ facts: { n: 7, tags: "not-an-array" } })` | Development: threw a validation error after `n` was written. Production: `tags` became the string |
| S4 | `restore({ v, schemaHash, schema, version, facts: { n: 3 } })` | `n` was 3; nothing else read |
| S5 | `restore({ facts: { n: 9 } })` before `start()` | 9 before start, 0 after (init wins) |
| S6 | `restore()` after `destroy()` | No throw; the fact was written |
| S7 | Namespaced: `getSnapshot()` from one system, then `hydrate(() => snap.facts)` and `restore(snap)` into others | Keys `c::n`, `c::tags`, `c::when`; hydrate loaded nothing (development warned "unknown namespace" per key); restore loaded 42 |
| S8, Q8 | `hydrate(async …)`, then `start()` without awaiting, then stop and start | The value was never applied, on both engines |
| S9 | Save a Date through the plugin, restore it | Production saved an ISO string; the restore was then overwritten by init (S11). Development: the probe's own `String()` on the fact threw "incompatible receiver", which shows the development view hands out a wrapped Date (Q5) |
| S10 | Storage holds `{ n: 2, removedLater: true }` | Development: "Plugin error" logged, restore aborted. Both modes ended with init's value (S11) |
| S11 | Storage holds `{ n: 5 }`; init sets `n = 0` | 5 before start, 0 after |
| S12 | Storage holds a 2.0-style envelope `{ v, schema, facts: { n: 6 } }` | Development: "Plugin error", nothing restored. Production: `v`, `schema` and `facts` became facts |
| S13 | Namespaced, `include: ["c::n"]`: write, destroy, read storage | Saved `{"c::n":8}` |
| S14 | Plugin installed, nothing written after init, destroy | Production saved every fact; development saved nothing (the Date fact, Q5) |
| S15, Q9 | `t.number().min(0).transform(f)`; `t.number().refine(even, "must be even")`; `.default(5)` | `"7"` accepted in development; the refine error said "(validator 2 failed)"; the default fact read `undefined`. Same on core-next |
| S16 | `setItem` throws | Production: `onError` got "QuotaExceeded"; development got "this is not a Date object." (the save failed earlier, Q5) |
| Q1 | The lab's pattern: storage `{"scene::palette":"sodium"}`, init sets `palette = "aperture"` | "sodium" before start, "aperture" after, both modes |
| Q2, Q3 | The same with an init that leaves `palette` alone, or uses `??=` | "sodium" kept |
| Q4 | Save with no Date fact, development | Saved |
| Q5 | Save with a Date fact, development | Nothing saved; `onError` got "this is not a Date object."; production saved |
| Q6 | `t.number().default(5)`, `t.boolean().default(true)`, no init | Both `undefined` after start, both modes, both engines |

**Reading the table:** S11 and Q1 are (ai): the lab's own persistence loses to its init. Q5 is (aj), S10 is (ak), S12 decides A4, and S4 is why `restore()` can take an envelope later. S2 and S3 are (ag); S5 and Q8 are (ah). Q6 is (al), and Q9 is (am) and (an). S1 and S7 are (af) and (ao), both recommended no.
