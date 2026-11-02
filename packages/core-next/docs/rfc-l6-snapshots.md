# RFC: L6 snapshots, hydrate, validation and persistence

Status: draft for review, revision 2 (after the design review). No engine or oracle code merges from this document.
Tree: branch `p6/l6-rfc`, cut from `main` at `1beb79fd` (L0 to L5 built; `layers.rules.json` `current` is `"L4"`; the L5 gate is being merged separately). Nothing in `packages/conformance` or `packages/core-next/src` is changed by this PR.

**Changes since revision 1.** The design review ran nine more probes (R1 to R9, listed under Evidence) on the published 1.35 (`directive-v1`). Its output matched the 1.36 workspace build byte for byte. It found six problems in the first draft, fixed in place:

1. **The 41 validation cases are not L6-pre work.** core-next already exports `createFactsStore` (`src/internals.ts:12`). Running `facts.test` and `mutants-facts.test` on core-next (163 cases) gives 158 pass and 5 fail, and none of the 5 is a validation case (`registerKeys` is missing; the delete and `onChange` call shape differs). v2 skips the files by a category rule (`packages/conformance/helpers/layer-gate.ts:122`), not because they cannot run. They are L0 triage debt, a separate follow-up slice. U13 and the 41-row mapping leave L6-pre.
2. **The golden harness has no v2 engine.** `packages/conformance/contracts/lib/golden.ts:46–47` loads only `"v1"` or `"local"`, and `"local"` is the 1.36 workspace build. L6-pre gains "the golden harness gains a core-next engine". L6b's check that 1.35 reads 2.0's saved data depends on it.
3. **The module inits run at `initialize()`, not `start()`** (`packages/core/src/core/engine.ts:3261`; `start()` calls it), and the Aperture lab calls `initialize()` first (`index.ts:78`). The loss reaches storage: `destroy()` wrote `{"scene::palette":"aperture"}` over the saved `"sodium"` (R4). Every place that said start now says initialize. (ai) must apply inside `initialize`, and (ah) and H3 key on `initialize`; keyed on start, (ah) would fire falsely on the lab.
4. **(ai) has a second change.** Today `initialFacts` beats the persistence plugin (R5), and revision 1's order would have let saved data beat `initialFacts` and SSR hydrate. (ai) is now one order, all inside `initialize`: module init, then the plugin's restore, then `initialFacts` and hydrate. Both visible changes are stated.
5. **(aj) is not a persistence bug.** In development, on both engines, every Date read through `system.facts` throws (R1, R2), and `contracts/STABILITY.md:55–56` says 1.35 facts are JSON-only. (aj) becomes Decline, and "the development view breaks Date reads" is an L0 question.
6. **(al) seeded before the inits would break `??=` inits.** (al) now fills only facts still undefined after the inits.

Smaller corrections: `restore()` rejects a nested `__proto__` too, so the port uses the deep check (S2, R7); `restore()` emits one `onFactsBatch` and no `onSnapshot` (S3, R6); the +184 B `restore` stub has no wiring on the flat or namespaced system, so the estimate gains +30 to 60 B; the hydration capability can cost 0 B, because the plugin can call `restore()`, which already files its batch as hydration (P3); the Aperture copy omits the lab's `devtools.ts`, and the lab pins a local 1.35.0-local.0 tarball (A5); and on 1.35 the next save overwrites a stored envelope in development and merges into it in production (P9, U10). The product-effect labels the review confirmed stand: (af), (ag), (ak), (am), (an) and (ao). (ah) becomes approve, with its trigger at `initialize`. "Decisions for the owner" now opens with six questions.

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
| Restore | `system.restore()`, as one part wired by `createSystem` (so `floor` does not carry it). The hydration capability only if the plugin turns out to need it (P3). |
| The persistence plugin | `persistencePlugin` in core-next's `/plugins` entry: an import, so it costs `minimal` nothing. |
| Schema introspection | The four functions as a separate module behind root exports; tree-shaken, so it costs `minimal` nothing. |
| The `aperture` fixture | `scripts/fixtures/aperture.ts`: the lab's three Directive files, verbatim, and its system setup, with the page code stubbed. |
| The oracle first (L6-pre) | Black-box pins for the 14 behaviours below that no test pins on either engine, a golden harness that can load core-next, a golden test for the envelope, and one scenario moved to L12. The 41 validation cases are not in L6-pre (U13). |
| Candidates, built only if approved | (ag), (ah), (am): development-only checks and messages. (ai): the persistence plugin restores inside `initialize`, after the module inits and before `initialFacts` and hydrate. (ak): the plugin skips stale keys. (al): `.default()` fills facts still undefined after the inits, as the docs say it does. (af), (an), (ao), (aj): recommended no. |
| Not built at L6 | `getDistributableSnapshot` and `watchDistributableSnapshot` (L12, with signing), `history.restore` and snapshot events (L8), the envelope itself (A4: the beta). |

**In plain terms:** L6 is smaller than the plan's row suggests: hydrate, snapshots, validation and the schema chain already work in core-next. What is left is `restore()`, the persistence plugin, schema introspection and the size fixture. The probes found that 1.35's persistence is broken in ways a user would notice: in the Aperture lab itself, the saved palette never survives a reload, and the next save writes the lab's default over it. They also found that the plan's envelope cannot be written where 1.35 reads saved data without breaking a rollback. The size cost to `minimal` is small, an estimated 0.21 to 0.28 KB (up to 0.4 KB if (al) is approved), but `minimal` has 86 B of room, so it needs Jason's OK.

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

**Tests v2 skips as white-box or internals.** None of the 12 internals files and none of the 13 white-box files in `WHITE-BOX.md` has a test placed at L6, so L6 has no equivalent of L5's 68 rows by placement. The plan's "dev-only validation" is tested mostly in two internals files, whose cases the detector places at L0: 22 in `facts.test.ts` ("schema validators (t.\*)", `strictKeys`, "validates through the proxy") and 19 in `mutants-facts.test.ts` (message previews, option defaults, `safeParse` schemas). v2 skips all 41, but by a category rule, not because they cannot run: `packages/conformance/helpers/layer-gate.ts:122` skips every file in the `internals` category, and core-next exports `createFactsStore` from `/internals` (`src/internals.ts:12`).

Revision 1 called these 41 "L6-pre work" and said the rules had never run on v2. Both were wrong. The review ran the two files on core-next (R9): 163 cases, 158 pass and 5 fail. Every failing case is outside the validation groups (`schema validators (t.*)`, `strictKeys`, `option defaults`, `safeParse` schemas, `validation message previews`): 2 call `registerKeys`, which core-next's store lacks, 1 expects an `onChange` call shape, and 2 expect a delete-notification shape. Verified by running them, with `#is-development` and `/internals` aliased to core-next's source. They are **L0 triage debt**, a separate follow-up slice (see the slice plan), not L6-pre.

**The plan's representative files mostly test other layers.** `restore-flush-reconcile` (1 test) and `snapshot-events` (17) are placed at L8, because they drive `history`. The `nested-mutation-*` files hold 16 tests at L2 to L9 and none at L6. Only `schema-introspection` and `persistence` are L6 files.

## The design: each 1.35 rule, the mechanism that keeps it, and its pin

Where a row says "verified", the behaviour was observed by running a probe against the built 1.x package in `packages/core/dist` (and, for Q6 to Q9, the built core-next too); the output is under "Evidence". The rest is read from the code, with lines cited. 1.35 paths are under `packages/core/src/`, core-next paths under `packages/core-next/src/`.

### Where each piece lives, and what it costs `minimal`

**In plain terms:** only `restore()` has to be in every system, because 1.35 puts it on every system with no import. It is about 0.2 KB with its wiring. Everything else is an import, or is already there.

| Piece | Must it be in `createSystem` in the alpha? | Why |
|---|---|---|
| `restore()` | Yes | A method on every 1.35 system (`engine.ts:4298`; the namespaced form binds the engine's, `core/system.ts:1006–1007`), reached with no import. As a part wired by `createSystem`, like validation, it stays out of `floor` and `createSystemCore` (B6). The measured +184 B port has no wiring on the flat or namespaced system; the wiring is an estimated +30 to 60 B more. |
| The hydration capability | Probably not | The plugin asks the system to file its writes as hydration. 1.35 keeps this in a module-private map keyed by system (`core/internal-scopes.ts`), installed before the first plugin's `onInit` (`engine.ts:4884–4891`). A 2.0 plugin that applies saved data through `restore()` needs no capability, because `restore()` already batches as hydration (S3). L6b decides, by the 2 `hydration-scope.test` cases (P3). |
| `getSnapshot`, `hydrate`, validation, the `t.*` chain | Already in `minimal` | Built (table above). Validation is development-only at run time. |
| The persistence plugin | No | `import { persistencePlugin } from "@directive-run/core/plugins"`, as in 1.35. |
| Schema introspection | No | Root exports that a bundler drops when unused. It costs `full-entry` (every export), not `minimal`. |
| The envelope seams | No, at the alpha (A4) | A new format is a beta feature behind its own import. |

### Snapshot and restore

**In plain terms:** a snapshot is the facts in a plain object. Restore writes them back in one batch, filed as loaded data rather than as this run's decisions. Its corners are what happens when the data is bad, or the timing is wrong.

| # | 1.35 rule | 2.0 mechanism | Pinned by |
|---|---|---|---|
| S1 | `getSnapshot()` returns `{ facts: store.toObject(), version: 1 }` (`engine.ts:4085–4090`). `toObject` copies one level (`core/facts.ts:625`), so nested values are the live ones: pushing onto a snapshot's array changes the live fact, and nothing is notified. Verified, Q7 and S1, on both engines. | Built (`api/core.ts:1563–1565`); kept unless (af). | L6-pre pin (U1) |
| S2 | `restore(snapshot)` throws, in both modes, on a non-object ("requires a valid snapshot object"), on a missing `facts` object ("must have a facts object"), and on a prototype-polluting key ("rejected: snapshot contains potentially dangerous keys …") (`engine.ts:4299–4316`). The check is deep: a `__proto__` nested inside a fact's value is rejected too. Verified, R7. | The same three messages, in production too: they are errors, not warnings. The port uses the deep check, not a test of the top-level keys. | L6-pre pins (U14) |
| S3 | The facts are written in one batch, inside the hydration origin, so plugins hear one `onFactsBatch` with origin `"hydrate"`, derivations invalidate, and a reconcile follows (`engine.ts:4318–4334`, `withHydrationOrigin` at `engine.ts:716`). A blocked key is skipped. Plugins hear nothing else: no `onFactSet` and no `onSnapshot`. Verified, R6. | The part writes through the store's batch with core-next's origin switch (`api/core.ts:961`), as `hydrate` already does (`api/core.ts:1343–1345`), and emits no other hook. | diff "snapshot and restore round-trip, with reconcile after restore"; `ssr.test` (2, fail); U14 |
| S4 | Only `snapshot.facts` is read. Every other field, including `version`, is ignored. Verified, S4: `{ v, schemaHash, schema, version, facts }` restored `facts` and nothing else. | Same. | L6-pre golden-style pin (U3) |
| S5 | Each key is checked as it is written. In development, an unknown key or a bad value throws after the earlier keys are committed, and the batch still flushes, so the system is left half-restored. Verified, S2 and S3: `n` was restored, `tags` was not, and the derivation already read the mix. In production nothing is checked, and an unknown key goes into the store. | Without (ag): copied. With (ag): in development, every key and value is checked before any is written; nothing changes in production. | diff scenario (U2) |
| S6 | The module inits run in `initialize()` (`engine.ts:3261`), which `start()` calls if it has not run. So `restore()` before the system is initialized is overwritten by the inits, with no warning (verified, S5, which restored before `start()`); after `destroy()` it still writes (verified, S6). A `restore()` after `initialize()` and before `start()` is not overwritten (reasoned from `engine.ts:3261–3290`, not probed; U4 pins it). | Without (ah): copied. With (ah): a development warning when `restore()` runs before `initialize()`. After destroy is kept. | L6-pre pins (U4) |
| S7 | A namespaced snapshot has flat keys (`"c::n"`), since the namespaced system binds the engine's `getSnapshot` (`core/system.ts:1006`). `restore()` takes them; `hydrate()` does not, because it expects `{ c: { n } }`, so `hydrate(() => snapshot.facts)` drops every key. Development warns "unknown namespace "c::n"" once per key; production is silent. Verified, S7. | Same unless (ao). | L6-pre pin (U6) |

**Reading the table:** S1, S5 and S7 are the ones a user can trip over: a snapshot that is secretly live, a restore that half-applies, and a snapshot that `hydrate` silently ignores. The rest is a port.

### Hydrate (already built; the rules L6 must not break)

| # | 1.35 rule | State | Pinned by |
|---|---|---|---|
| H1 | `hydrate(loader)` throws after start; the loaded object is applied in `initialize()` (which `start()` calls), after the module inits and after `initialFacts` (`core/system.ts:449–462, 504–520`; `engine.ts:3274–3285`). | Built, `api/core.ts:1313–1355` | `ssr.test`, `system.test` (pass) |
| H2 | Dangerous keys: the single-module form warns in development and skips the whole object (`core/system.ts:1171–1177`); the namespaced form throws (`core/system.ts:424–428`). | Built (`loadFlat`, `api/core.ts:302–316`) | `l8-system-oracle`, `ssr.test` (pass) |
| H3 | A loader that is still pending when the system initializes (`initialize()`, or `start()`, which calls it) resolves too late, and its data is never applied, not even after a stop and start. Verified, Q8, on both engines, with no warning. | Built, as 1.35 | L6-pre pin (U5); (ah) adds a development warning, triggered at `initialize` |

### The persistence plugin

**In plain terms:** the plugin loads saved facts when the system is created, and saves the facts that change, a short while after the last change. The probes found two ways it loses a user's data (P4, P7), and each is a candidate. A third, Date facts in development (P6), is the development view's fault and is declined.

| # | 1.35 rule | 2.0 mechanism | Pinned by |
|---|---|---|---|
| P1 | Options: `storage` (sync `Storage`), `key`, `include`, `exclude`, `debounce` (100 ms), `onRestore`, `onSave`, `onError` (`plugins/persistence.ts:30–47, 84–93`). A key is persisted unless excluded; with `include`, only if included (`100–104`). | Same. | `persistence.test` (fails) |
| P2 | Load: a missing value or a non-object is nothing; bad JSON and a prototype-polluting object go to `onError` and load nothing (`107–128`). | Same. | `persistence.test` (fails) |
| P3 | The plugin restores in its `onInit`, which runs when the system is created, before `initialize()` and `start()` (`161–200`). It writes each key as `system.facts[key] = value` inside one store batch and adds the key to its saved set; it does not go through `restore()`. The batch runs inside the hydration capability; without it, the plugin logs an error and restores anyway (`171–197`). `onRestore` follows (`198`). | With (ai), the plugin still reads storage at `onInit` but applies it later, inside `initialize` (P4). It applies through `restore()`, which already files one batch as hydration (S3), and adds the restored keys to its saved set itself. So the capability (a module-private map set before the plugins' `onInit`, as 1.35, `engine.ts:4884–4891`) may cost 0 B. L6b confirms it by the 2 `hydration-scope.test` cases, and builds the capability only if they need it. | `hydration-scope.test` (2, fail) |
| P4 | **The module inits run in `initialize()`, after the plugin restored (it restores when the system is created), so an init that sets a persisted fact overwrites it, and the next save writes the init's value over the saved one.** Verified, S11 and Q1, and R4 in the lab's own call order (`system.initialize()` at `index.ts:78`, `start()` after fonts load at `index.ts:79`): the saved `"sodium"` read back as `"aperture"` right after `initialize()`, and `destroy()` wrote `{"scene::palette":"aperture"}` into storage. The lab's `scene` init sets `palette` (`modules/scene.ts:49`) and the plugin persists `scene::palette` (`index.ts:18`). An init that leaves the fact alone (Q2) or uses `??=` (Q3) keeps it. Also verified, R5: `initialFacts` beats the plugin today (`"init-facts"` won over the saved `"sodium"`). Today's order is therefore: plugin, then module inits, then `initialFacts` and hydrate. | Without (ai): copied. With (ai): one order, all inside `initialize`: module inits, then the plugin's restore, then `initialFacts` and hydrate (see (ai)). | diff scenario (U7) |
| P5 | Saving: each set, delete or batched change of a persisted key restarts one timer, `clearTimeout` then `setTimeout(save, debounce)` (`151–156, 210–239`). `save` writes the tracked, persisted keys as JSON (`131–148`), reading each through `system.facts` (`139`); an error goes to `onError`. `onDestroy` clears the timer and saves at once (`202–208`). Nothing saves before `onInit` (`132`). | Same timing, on `setTimeout`, as 1.35 (C list). | `persistence.test` (fails) |
| P6 | **In development, every Date read through `system.facts` throws, on both engines**: `getTime()` and `JSON.stringify` fail with "this is not a Date object.". The plugin reads each fact through `system.facts` (line `139`), so a save that includes a Date fact saves nothing, and only `onError` hears. Production reads the Date and saves an ISO string. Verified, R1 and R2 (single-module and namespaced, 1.35 and core-next), Q5 and S16. The engine already warns when a Date is assigned ("Facts must be JSON-roundtrippable"), and `contracts/STABILITY.md:55–56` says 1.35 facts are JSON-only. This is the development view's fault, not persistence's. | Same: (aj) is declined. The fault goes to L0 as a question: "the development view breaks Date reads". | conformance test of the read (U8) |
| P7 | **A saved key the schema no longer has** (an app update removed a fact) is written like any other. In development that throws "Unknown fact key", the plugin manager logs "Plugin error", and the restore stops partway. Verified, S10. In production the stale key goes into the store, and is saved again on the next save. Reasoned from S12, where production wrote unknown keys. | Without (ak): copied. With (ak): keys not in the schema are skipped, with a development warning. | diff scenario (U9) |
| P8 | On a namespaced system the plugin sees flat keys: it saved `{"c::n":8}` and the lab's `include` names `"scene::palette"`. Verified, S13. | Same. | L6-pre pin (U15) |
| P9 | Loading an envelope and then saving: the next save overwrites the envelope in development (`{"n":1}`, after a plugin error at load) and merges into it in production (`{"v":1,"schema":{"m":1},"facts":{"n":6},"n":1}`). Verified, R8. | Same. | L6-pre pin (U10) |

**Reading the table:** P4 matters most. A persistence plugin whose saved values lose to the module's own init persists nothing for the commonest setup, and the 35 plugin tests miss it because they use a mock system. P7 is smaller, but it also loses data silently, which is the failure persistence exists to prevent. P6 looks like a persistence bug and is not: the plugin only inherits a development view that cannot read a Date.

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

**In plain terms:** the probes found 14 behaviours that no test pins on either engine (revision 1 counted 15; U13 left). Each needs a pin before the slice that could break it. "Conformance" means a test that runs on v1 and v2; "diff" means a scenario the diff harness runs on both.

| # | Behaviour | Evidence | Pinned by | Slice |
|---|---|---|---|---|
| U1 | A snapshot's nested values are the live facts | S1, Q7 | A conformance test | L6-pre |
| U2 | A development restore with a bad key or value is half-applied; production writes the unknown key | S2, S3 | A diff scenario, both modes; shows (ag) if approved | L6-pre |
| U3 | `restore()` ignores every field but `facts` | S4 | A conformance test with `{ v, schemaHash, schema, facts }` | L6-pre |
| U4 | `restore()` before the system is initialized is overwritten by the module inits (`initialize()`); after `initialize()` and before `start()` it sticks; after `destroy()` it still writes | S5, S6; the middle case is reasoned from `engine.ts:3261–3290` | Conformance tests; the middle case calls `initialize()` and `start()` separately, as the lab does | L6-pre |
| U5 | A `hydrate()` still pending when the system initializes (`initialize()`, or `start()`, which calls it) is dropped for good | Q8 | A conformance test; (ah) adds a warning | L6-pre |
| U6 | A namespaced snapshot fed to `hydrate()` loads nothing | S7 | A conformance test | L6-pre |
| U7 | A persisted fact that the module's init sets is overwritten at `initialize()`, and the next save writes the init's value; `initialFacts` beats the plugin; an init that reads a persisted fact sees the saved value (this last one is reasoned from the order, not probed) | S11, Q1 to Q3, R4, R5 | A diff scenario on a real system, with an init that sets the key, one that uses `??=`, one that reads it, and `initialFacts`, calling `initialize()` and `start()` separately | L6-pre |
| U8 | In development, every Date read through `system.facts` throws, so a save with a Date fact saves nothing | Q5, S16, R1, R2 | A conformance test of the read (both engines agree today), plus a line in the persistence diff scenario for the save | L6-pre |
| U9 | A stale key in storage aborts the development restore partway, and is written in production | S10 | A diff scenario | L6-pre |
| U10 | 1.35 reading a saved-state envelope fails in development and writes `v`, `schema` and `facts` as facts in production; its next save overwrites the envelope in development and merges into it in production | S12, R8 | A golden test in `contracts/golden.test.ts` (A4), which needs the core-next engine L6-pre adds to the golden harness | L6-pre |
| U11 | `.default()` is never applied | Q6 | A conformance test | L6-pre |
| U12 | `.refine()`'s message is not in the error; `.transform()` drops the checks | Q9 | Conformance tests in development | L6-pre |
| U13 | **Moved out of L6-pre.** The 41 validation cases v2 skips (`facts.test.ts` 22, `mutants-facts.test.ts` 19) run on core-next, and none of the 5 failing cases in those files is one of them | R9 | A separate L0 triage slice (see the slice plan) | not L6 |
| U14 | `restore()`'s three errors, in both modes, with the deep prototype check (a nested `__proto__` is rejected); one `onFactsBatch` and no `onFactSet` or `onSnapshot` | `engine.ts:4299–4316`, R6, R7 | Conformance tests, development and production | L6-pre |
| U15 | A namespaced system persists and restores flat `ns::key` keys | S13 | A diff scenario | L6-pre |

**Reading the table:** U2, U5, U7, U11 and U12 are where the candidates live, so each shows the 1.35 behaviour now, and the difference, with a `divergences.json` entry, only if the owner approves it. U8 is no longer one: (aj) is declined, so it pins today's behaviour. U10 is not a candidate: it is a fact about 1.35 that decides A4. L6-pre is smaller than L5's oracle slice: 14 pins, a golden engine, and one scenario move.

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
| L6-pre (oracle) | U1 to U12, U14 and U15 (U13 left L6-pre). The golden harness gains a core-next engine (`contracts/lib/golden.ts:46–47` accepts only `"v1"` and `"local"`), then the envelope golden test (U10) with the next-save pins. An L6 gap bullet in `WHITE-BOX.md`. "distributable snapshots" moved to L12 in `layers.rules.json` (B4). | The new tests pass on `conformance:v1` and `v1:prod`, and on v2 fail only as this document predicts. `loadEngine` accepts a core-next engine, and the golden cases that need only built layers pass on it; the rest skip by layer, each with a reason. **`conformance:diff` at forced L6 fails only the three L6 scenarios above and the new U2, U7, U9 and U15 scenarios; the open-gate check passes at the committed `current` and at every open gate's ceiling.** `pnpm census`, `check:expects` and `oracle:update` exit 0. `oracle-change` label. | test oracle; Sonnet |
| Layer gate, again | Nothing built. A fresh `mutation-nightly.yml` run with `gate: L6` after L6-pre merges. | PASS with L6-pre's tests in the tree. L6a does not start before it does. | test oracle; coordinator |
| L6a | First, `scripts/fixtures/aperture.ts` with its measured budget (A5), so the slice's own growth shows against it. Then `restore()` as one part (S1 to S7, B6), wired on the flat and the namespaced system, with (ag) and (ah) only if approved; (ah) keys on `initialize`, not `start`. | At forced L6 on v2 and v2:dist: the 3 restore failures pass, and L6-pre's U1 to U6 and U14 pass, listed by file and title. `conformance:diff`: "snapshot and restore round-trip …" matches 1.35, U2 matches or differs only by (ag). Census and ratchet exit 0. core-next `test`, `typecheck`, `build` and `size:check`, with the exact development-string count (116 today, plus any approved warnings). `floor` grows by at most 40 B; `minimal` within A3, with the measured size and attribution in `reason`. | core; Opus implementer, Sonnet diff reviewer plus Fable correctness reviewer |
| L6b | The persistence plugin in `/plugins` (P1 to P8), with (ai) and (ak) only if approved; (ai) is the order inside `initialize`. The hydration capability only if the 2 `hydration-scope` cases need it (P3). `frame-loop-persist` (B7). | The 35 plugin tests and the 2 hydration-capability tests pass at forced L6. `conformance:diff`: "the persistence plugin …" and U15 match 1.35; U7 to U9 match or differ only by an approved candidate, each named. The golden test passes on the core-next engine L6-pre adds: 1.35 reads core-next's saved data as its own. `frame-loop-persist` at 0.8 or better; no workload slower than `main` by more than 5%. Plus L6a's census, ratchet and core-next checks. | core (users' saved data); as L6a |
| L6c | Schema introspection (I1 to I4), and (al) and (am) only if approved. | The 28 introspection tests pass at forced L6; "schema introspection: kinds, operators …" matches 1.35; U11 and U12 match or differ only by an approved candidate. `full-entry` within A3; `minimal` unchanged unless (al). Plus L6a's checks. | core if (al) is approved, since it changes `initialize`; otherwise Sonnet implementer and one Sonnet reviewer |
| L6-gate | `current` to L6, `ratchet --update`, diff and fuzz at L6, a `divergences.json` entry per approved candidate with `approvedBy` empty unless Jason says to sign, `/principal` on L6. | 0 L6 failures on v2, v2:dist and v2:prod. The census fails only on unsigned entries. PR fuzz and nightly run v2 at L6. | test oracle; Sonnet plus the coordinator's read of each entry |

**Reading the table:** L6a and L6b carry the risk. L6a changes what is in every system, and L6b handles users' saved data, where a mistake loses state and is hard to undo. L6c is pure functions unless (al) is approved, which changes what facts hold after `initialize`.

**Follow-up outside L6: L0 triage (a separate slice).** The two internals files `facts.test.ts` and `mutants-facts.test.ts` (163 cases) run on core-next today: 158 pass. The slice lifts the category skip for them (or moves them out of the `internals` category), ports the 5 failing cases to the store shape core-next has (`registerKeys`, the `onChange` and delete call shapes) or marks each internal with a reason, and adds the L0 question "the development view breaks Date reads" (P6, (aj)). Done means: the two files run on v2 with 0 failures or listed exceptions, and the census exits 0. Not on L6's critical path.

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
| `restore()` | A port of 1.35's `restore` with its three messages (`restore-stub.ts`), added to `minimal` | **+184 B** (measured; the port is mine, not a build of the real slice, and it has no wiring on the flat or namespaced system) |
| Wiring `restore()` onto the flat and the namespaced system | Reasoned: the stub has none | +30 to 60 B (estimate) |
| The hydration capability | Reasoned: one `WeakMap` set and one lookup, if it is built | 0 B if the plugin applies saved data through `restore()` (P3); otherwise +20 to 40 B (estimate) |
| 1.35 `plugins/persistence.ts` | Alone | 915 B |
| The same | Added to `minimal` in `plugins: […]` | +712 B, not in `minimal` (an import) |
| 1.35 `core/schema-introspection.ts` | Alone | 998 B |
| The same | Three of its functions used from `minimal` | +714 B, not in `minimal` (tree-shaken); in `full-entry` |
| (ag), (ah), (am) | Development-only | 0 B in production |
| (ai), (ak) | In the plugin, including the one seam that gives the plugin a turn inside `initialize` (P3) | +20 to 60 B to the plugin (estimate) |
| (al) | Filling still-undefined defaults at the end of `initialize`, in `createSystem` | +60 to 120 B (estimate) |
| **`minimal`, L6 in total** | `restore` (184), its wiring (30 to 60) and the capability (0 to 40); plus (al) (60 to 120) if approved | **+214 to 284 B** without (al), to about 28.53 to 28.60 KB; **+274 to 404 B** with it, to about 28.59 to 28.72 KB (estimates, except the 184) |
| **`full-entry`, L6 in total** | The above plus introspection | **+0.9 to 1.4 KB**, to about 31.4 to 31.9 KB |

**The `aperture` copy.** I copied the lab's `schemas.ts`, `modules/scene.ts` and `modules/notes.ts` verbatim, wrote its system setup from `index.ts:15–21` (three modules, the persistence plugin with `include: ["scene::palette"]`, and `history` off, as a production build of the lab has it), and stubbed the shared page code (`../../scene/*`, the same in all six of the lab's implementations) as external. Against core-next today, with 1.35's persistence source standing in for the plugin, it is **33,035 B**; against 1.35 it is **53,877 B**, so core-next is 39% smaller on the real app. The app's own code is about 4.3 KB of that (4,345 B with the library external). The lab uses 3 modules, `crossModuleDeps`, `init`, `derive`, events, effects, constraints and resolvers, sources in two modules, and 55 `t.*` builders, with no refine, transform or brand. **What the copy leaves out, and what the lab pins.** It omits the lab's `devtools.ts` (27 lines: `mountTimeTravel`, a `lil-gui` panel over `system.history` and `system.inspect()`), which `index.ts:9` imports and `index.ts:117` wires through the page's `devtools` option. The fixture is a production build with `history` off, where the panel returns at once, so devtools stays out of the fixture. The lab's `package.json` pins `@directive-run/core` to a local tarball, `1.35.0-local.0` (a scratch build outside the repo), not the registry's 1.35.0. So the fixture compares only with itself on the two engines, never with the lab's own chunk numbers (A5).

**In plain terms:** L6 adds an estimated 0.21 to 0.28 KB to every system (up to 0.4 KB with (al)), almost all of it `restore()` and its wiring, against 86 B of room, so `minimal` needs a raise (A3). The plan's "Aperture ~6.0 (ceiling 8)" was written before Phase 2 measured `minimal` at 25 KB; the real lab copy is 33 KB on core-next today. That is a new number to set, not a regression (A5). One caution: the lab's own chunk numbers (Directive 41.7 KB, XState 12.5 KB) came from its Vite build (the lab now pins a local tarball and imports `devtools.ts`), not from this method, so the fixture compares with itself and with 1.35 on the same copy, not with those numbers.

## What the plan got wrong, or left out

- **Half of the row is built.** `hydrate`, `getSnapshot`, development validation and the `t.*` chain were carried over at L0 to L3, and their tests pass on v2. What is left is `restore`, the persistence plugin and its hydration capability, introspection and the fixture.
- **The representative tests are mostly other layers'.** `restore-flush-reconcile` and `snapshot-events` are placed at L8 (they drive `history`), and the `nested-mutation-*` files hold no L6 test. Only `schema-introspection` and `persistence` are L6 files, and `persistence.test.ts` uses a mock system.
- **Schema introspection is not in the row**, but its 28 tests are placed at L6 (B5).
- **"distributable snapshots" is placed at L6** in the scenario table, while the plan's L12 row and the detector put it at L12 (B4).
- **"Aperture ~6.0 (ceiling 8)" predates Phase 2.** The real lab copy is 33.0 KB on core-next today (A5).
- **The envelope's golden test, "1.35 ignores the new envelope fields", is half true.** `system.restore()` does ignore them (S4). The persistence plugin does not: it restores every top-level key as a fact (`plugins/persistence.ts:173–178`), so an envelope in storage fails in development and writes `v`, `schema` and `facts` as facts in production (S12). `contracts/STABILITY.md:46–56` requires 1.35 to read the workspace's persistence output as its own, or a `goldenChanges` entry signed by Jason. The plan's rollback promise ("revert PR + lockfile, safe via golden-file compatibility") depends on this (A4).
- **"Dev-only validation" is tested mostly by internals files** that v2 skips by a category rule, not because it cannot run them: the 41 cases pass on core-next (U13). That is L0 triage debt, not L6-pre.
- **The golden harness cannot load core-next.** `contracts/lib/golden.ts:46–47` accepts only `"v1"` and `"local"` (the 1.36 workspace build). The plan's rollback promise and L6b's "1.35 reads 2.0's saved data" check need a core-next engine there, so L6-pre builds it.
- **The docs promise a feature neither engine has:** `.default()` seeding (T4, (al)).
- **The plan does not mention that the lab's own persistence is broken on 1.35** (P4). The lab is the alpha's proof app, so its `npm run parity` should include a reload. The lab calls `initialize()` first, and the next save then writes the lab's default over the user's saved palette (R4).

## Decisions for the owner

**Questions for Jason.** Six answers settle everything revision 2 changed. The rest of the table below keeps the labels and recommendations the review confirmed, so Jason can bulk-approve them.

1. **A3, size.** Approve a small raise: `minimal` and `two-module` up to +350 B (estimate: +214 to 284 B; up to +404 B if (al) is approved, which comes back to Jason if the measured size is past +350 B), `full-entry` up to +1.4 KB, `floor` up to +40 B. **Recommend: approve.**
2. **(ai), order.** One order, inside `initialize`: module init, then the plugin's restore, then `initialFacts` and hydrate. **Recommend: approve.**
3. **(al).** `.default()` fills only facts still undefined after the inits. **Recommend: approve.**
4. **(aj).** The plugin does not read around the development view; the JSON-only rule stays. **Recommend: decline,** and put "the development view breaks Date reads" to L0.
5. **A4.** Keep 1.35's saved-state formats in the alpha. Whether the beta's new key also dual-writes is decided at the beta. **Recommend: approve.**
6. **A5, and B4 to B7.** Keep as written, amended as above (A5 now says what the copy omits; B6 sizes `restore` with its wiring). **Recommend: approve.**

A "no", or no answer yet, means the slice keeps 1.35's behaviour and pins it with a core-next test.

| Decision | Product verdict | Recommendation |
|---|---|---|
| **A3** L6 size budgets | Same behaviour; `minimal` grows by an estimated 214 to 284 B (up to 404 B with (al)) | Approve a small raise: `minimal` and `two-module` up to +350 B, `full-entry` up to +1.4 KB, `floor` up to +40 B; come back above that |
| **A4** the saved-state envelope at the alpha | Same as 1.35 at the alpha | Keep 1.35's formats at the alpha. Whether the beta's new key also dual-writes is decided at the beta |
| **A5** the `aperture` fixture's shape and budget | No behaviour change; decides the number the alpha.0 gate quotes | The lab's three Directive files verbatim, page code and `devtools.ts` left out, production; budget from measurement at L6a, replacing the plan's 6 KB and 8 KB |
| **(af)** a snapshot copies nested values | Better, small change, at a cost per snapshot | No: keep 1.35, pin it, document it |
| **(ag)** a development restore checks everything before writing | Better, small change (development only) | Approve, in L6a |
| **(ah)** development warnings for `restore()` before `initialize()` and `hydrate()` not awaited | Better, small change (development only) | Approve, in L6a, triggered at `initialize` |
| **(ai)** the persistence plugin restores inside `initialize`, in one order | Better, with two visible changes: an init that sets a persisted fact no longer wins, and an init no longer sees the saved value | Approve, in L6b: module init, then the plugin, then `initialFacts` and hydrate |
| **(aj)** the persistence plugin saves Date facts in development | No change: the fault is the development view's, and facts are JSON-only | Decline; keep the JSON rule; the Date-read fault goes to L0 as a question |
| **(ak)** the persistence plugin skips saved keys the schema no longer has | Better, small change | Approve, in L6b |
| **(al)** `.default()` fills facts still undefined after the inits, as the docs say | Better, and visible | Approve, in L6c |
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
- **What 2.0 would do.** The same split. `restore` is a part wired by `createSystem`: +184 B measured for a port of `restore` that has no wiring on the flat or namespaced system, plus an estimated +30 to 60 B to wire it. The hydration capability costs 0 B if the plugin applies saved data through `restore()`, which already files its batch as hydration, and an estimated +20 to 40 B if L6b needs it. (al), if approved, adds an estimated 60 to 120 B to every system. Introspection reaches `full-entry` only.
- **Product verdict.** Same behaviour. `minimal` grows by an estimated 214 to 284 B, to about 28.53 to 28.60 KB (274 to 404 B, to about 28.59 to 28.72 KB, with (al)); `full-entry` by an estimated 0.9 to 1.4 KB.
- **Recommendation.** Approve a small raise, with a written reason in each slice: `minimal` and `two-module` up to +350 B in total, `full-entry` up to +1.4 KB, `floor` up to +40 B. The +350 B covers the whole range without (al) and most of it with (al); a raise past that comes back to Jason. Do the attribution step first (find the bytes, move cold code, fold duplicates).

#### A4 the saved-state envelope at the alpha

- **What 1.35 does.** `getSnapshot()` returns `{ facts, version: 1 }`, and `restore()` reads only `facts` (S4). The persistence plugin saves a flat object of facts and restores every top-level key (S12).
- **What the plan would do.** Build the envelope `{v, schema:{[module]:n}, facts}`, module `version` and `migrate`, storage that may return a promise, a codec, and `{v, schemaHash}` at L6, with a golden test that 1.35 ignores the new fields.
- **What the probes show.** For `restore()`, extra fields are harmless. For saved data they are not: written where 1.35 reads, an envelope fails in development (a plugin error, nothing restored) and in production restores `v`, `schema` and `facts` as facts (S12). `STABILITY.md` requires 1.35 to read 2.0's saved data as its own, so writing the envelope at the alpha needs a signed `goldenChanges` entry and gives up rollback for saved data. The next save differs by mode (R8): in development it overwrites the stored envelope with the plain facts (`{"n":1}`), and in production it merges into it (`{"v":1,"schema":{"m":1},"facts":{"n":6},"n":1}`). L6-pre pins both (U10).
- **Product verdict.** Same as 1.35 at the alpha.
- **Recommendation.** Keep both formats exactly as 1.35 at the alpha: `getSnapshot()` stays `{ facts, version: 1 }`, and `persistencePlugin` keeps its flat JSON. Build only invisible seams at L6: the plugin loads and saves through one internal codec point and one storage adapter, with 1.35's JSON and sync `Storage` as the only implementations. The envelope, `migrate`, async storage and a codec option come at the beta, in a new import that writes under its own storage key, so a rollback leaves 1.35's data alone. Add the U10 golden test now, so that a later change to the format has to be made on purpose. Whether the beta's new key also dual-writes 1.35's key, so that a rollback finds current data, is decided at the beta with the format; the alpha does not need it. The golden test needs the core-next engine that L6-pre adds to the golden harness.

#### A5 the `aperture` fixture

- **What exists.** Nothing in the repo. The plan budgets it at 6 KB, with a ceiling of 8 KB. A2 builds it at L6 as a copy of the real lab.
- **What 2.0 would do.** `scripts/fixtures/aperture.ts` plus the three lab files verbatim, the system setup from `index.ts:15–21`, `history` off (a production build of the lab has none), and the shared page code (`../../scene/*`, the same in all six implementations) stubbed. `size.mjs` measures it on both engines, as it does `minimal`.
- **What the copy leaves out.** The lab's `devtools.ts` (27 lines, a `lil-gui` panel over `system.history` and `system.inspect()`, imported at `index.ts:9` and wired at `index.ts:117`). Devtools does not belong in the fixture: with `history` off the panel returns at once, and the fixture is the app as a production user ships it. The fixture file says so in a header comment.
- **What the lab pins.** `@directive-run/core` is a local tarball, `1.35.0-local.0`, a scratch build outside the repo, not the registry's 1.35.0. So the fixture compares only with itself on the two engines, never with the lab's own chunk numbers.
- **Product verdict.** No behaviour change. It decides the number the alpha.0 gate quotes: about 33.0 KB on core-next against 53.9 KB on 1.35 today (39% smaller), plus L6's own bytes.
- **Recommendation.** Approve the shape, amended as above. Set its budget from measurement in L6a, before L6a's code lands, at the measured size plus a small margin, and retire the plan's 6 KB and 8 KB for it. The published comparison with the lab's other implementations needs all six measured one way, which is release work, not L6's.

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

#### (ah) development warnings for `restore()` before `initialize()`, and `hydrate()` not awaited

- **What 1.35 does.** The module inits run in `initialize()` (`engine.ts:3261`), which `start()` calls if it has not run. A `restore()` made before that is overwritten by the inits (S5). A `hydrate()` whose promise is still pending when `initialize()` runs is never applied (Q8). Both are silent. A `restore()` after `initialize()` and before `start()` is not overwritten (reasoned from the code; U4 pins it).
- **What 2.0 would do.** Warn once in development in each case, naming the fix ("call `restore()` after `initialize()`, or use `hydrate()`" and "await `hydrate()` before `initialize()` or `start()`"). No behaviour changes. The trigger is `initialize`, not `start`: the Aperture lab calls `system.initialize()` first (`index.ts:78`) and `start()` later (`index.ts:79`), so a warning keyed on `start` would fire falsely on a restore made in between.
- **Product verdict.** Better, small change. Two development strings; 0 B in production.
- **Recommendation.** Approve, in L6a, triggered at `initialize`.

#### (ai) the persistence plugin restores inside `initialize`, in one order

- **What 1.35 does.** The plugin restores when the system is created (its `onInit`). The module inits then run in `initialize()` and overwrite any persisted fact they set, and the next save writes the init's value over the saved one. On the lab's own call order, the saved `"sodium"` read back as `"aperture"` right after `initialize()`, and `destroy()` wrote `{"scene::palette":"aperture"}` into storage (P4, R4). `initialFacts` and `hydrate` are applied after the inits and today beat the plugin (R5). So today's order is: plugin, module inits, then `initialFacts` and hydrate.
- **What 2.0 would do.** One order, all inside `initialize`: module inits, then the plugin's restore, then `initialFacts` and hydrate. The plugin still reads storage when the system is created and holds the parsed object. It applies it through `restore()` (filed as hydration) at its turn inside `initialize`. The plugin has no turn there today (its hooks are `onInit` and `onStart`), so L6b adds one internal seam; its cost is in the +20 to 60 B estimate. Revision 1 applied saved data on hydrate's path, which would have let it beat `initialFacts` and SSR hydrate. This order does not.
- **What a user can see, two changes.** (1) A persisted fact that an init sets now keeps its saved value; the lab's saved palette survives a reload. (2) The saved value is no longer there until `initialize()`: an init that reads a persisted fact sees its own starting value, not the saved one (`facts.count = facts.saved + 1` changes), and a read between `createSystem` and `initialize()` sees nothing (R4 read `"sodium"` there on 1.35). What does not change: `initialFacts` and `hydrate` still beat saved data (R5), and an init that uses `??=` ends with the same value (Q3).
- **Product verdict.** Better for saved state, with the two visible changes above. Change (2) is reasoned from the order and pinned first in U7, not probed.
- **Recommendation.** Approve, in L6b: module init, then the plugin, then `initialFacts` and hydrate, inside `initialize`. A persistence plugin that loses to the module's own defaults persists nothing in the commonest setup.

#### (aj) the persistence plugin saves Date facts in development

- **What 1.35 does.** In development, every Date read through `system.facts` throws, on both engines: `getTime()` and `JSON.stringify` fail with "this is not a Date object." (R1, R2, Q5). The plugin reads each fact through `system.facts`, so a save that includes a Date fact saves nothing, and only `onError` hears. Production reads the Date and saves an ISO string. The engine already warns when a Date is assigned ("Facts must be JSON-roundtrippable"), and `contracts/STABILITY.md:55–56` says 1.35 facts are JSON-only.
- **What 2.0 would do.** Nothing: keep the JSON rule. The fault is in the development view, not in persistence. Reading around it in the plugin would fix one reader and leave every other Date read broken.
- **Product verdict.** No change.
- **Recommendation.** Decline, keeping the JSON rule. Pin the read (U8). Put one question to L0 (the follow-up slice): "the development view breaks Date reads". It should either hand Dates through or turn the assignment warning into an error, so that development and production agree.

#### (ak) the persistence plugin skips saved keys the schema no longer has

- **What 1.35 does.** In development, a saved key that is no longer in the schema throws "Unknown fact key", and the restore stops partway with a "Plugin error" log (S10). In production the stale key goes into the store and is saved again.
- **What 2.0 would do.** Skip keys not in the schema, with one development warning naming them. The other keys restore.
- **Product verdict.** Better, small change. It is what an app update that removes a fact needs, until the beta's `migrate`.
- **Recommendation.** Approve, in L6b.

#### (al) `.default()` fills facts still undefined after the inits

- **What 1.35 does.** Stores the default and never applies it (Q6, R3). `docs/api/facts.md:160–170` says "Module init seeds these automatically".
- **What 2.0 would do.** As the last step of `initialize`, after the module inits, the plugin's restore and `initialFacts` and hydrate, set each fact that declares a default and is still `undefined`. A default never overwrites or double-writes a loaded value. Seeding before the inits, as revision 1 proposed, would break `??=` inits: `facts.x ??= 10` would find the default already there and never run.
- **Product verdict.** Better, and visible: facts that were `undefined` after the inits now hold their declared defaults, so a constraint or derivation that reads them sees a value on the first pass. Every system pays an estimated 60 to 120 B.
- **Recommendation.** Approve, in L6c: defaults fill facts still undefined after the inits. The alternative is to correct the docs and the plugin skills, which is also a change users would notice.

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

- **What 2.0 would do.** A part wired by `createSystem`, like validation, holding `restore` and the hydration capability. `floor` and `createSystemCore` stay without it. The part needs the core's origin switch, one more call on the part context, and wiring onto the flat and the namespaced system.
- **Recommendation.** Approve. `floor` has 33 B of room, and `restore` is about 184 B measured, an estimated 214 to 244 B with its wiring.

#### B7 the `frame-loop-persist` workload

- **What 2.0 would do.** `frame-loop-source` with the persistence plugin installed as the lab installs it, one included key, reporting time and bytes per frame. The L6 gate judges it at 0.8 or better.
- **Recommendation.** Approve the shape before L6b, so the plugin's per-write cost is measured on the gate's own yardstick.

### C. Engineering defaults that keep parity (no decision needed)

- **The plugin's timer is `setTimeout`**, as 1.35 (`plugins/persistence.ts:151–156`). The plugin is outside the kernel and sees only the system, so it does not follow an injected virtual clock; under the harness's fake timers the two agree.
- **One re-arming timer** instead of a `clearTimeout` and `setTimeout` per write: the timer fires, sees that the last change moved the deadline, and re-arms for the rest. The save happens at the same time as in 1.35.
- **Whether a key persists is worked out once per key**, not by scanning `include` and `exclude` on every write.
- **`restore()`'s three errors stay in production**: they are thrown in both modes by 1.35, so they are not development strings.
- **`restore()` and the plugin file their writes as `"hydrate"`**, as 1.35 does (`engine.ts:4318–4334`, `plugins/persistence.ts:171–197`).
- **If the hydration capability is built (P3), it is installed before the plugins' `onInit`**, so the first plugin in the array gets it (`engine.ts:4884–4891`).
- **The kernel's snapshot registry** (`snapshot.ts`, `contribute`/`dump`/`load`) is not part of `getSnapshot()` at the alpha, since 1.35's snapshot holds facts only. It is where the beta's envelope gathers module parts.

## Evidence: probes

Two probe scripts ran with real timers against the built 1.x package in `packages/core/dist/development` and `dist/production` (the bench reports this build as `@directive-run/core@1.36.0`; the conformance `v1` project pins the published 1.35.0), and the second also against the built core-next (`packages/core-next/dist`). Neither lives in the repo; L6-pre turns each into a conformance test, diff scenario or golden test (U1 to U15). The design review added three scripts, run with real timers against the published 1.35 (`packages/conformance/node_modules/directive-v1`, the `conformance:v1` pin): they reran the S and Q probes and added R1 to R8 (R1 to R3 also ran on core-next's `dist`). R9 is a vitest run. The review's output matched the 1.36 workspace build byte for byte.

- Probe sources: `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l6probe/probe.mjs` (S1 to S16) and `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l6probe/probe2.mjs` (Q1 to Q9)
- Output: `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l6probe/out-dev.json`, `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l6probe/out-prod.json`, and `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l6probe/out2-v1-development.json` (and the `v1-production`, `v2-development` and `v2-production` files beside it)
- Size script and the Aperture copy: `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l6size/sz.mjs`, output `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l6size/sz.out`
- Measurement JSON (v2 and diff at forced L6) and the bench output: `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l6/`
- Review probe sources: `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l6-rfc-rv/p1.mjs` (S), `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l6-rfc-rv/p2.mjs` (Q) and `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l6-rfc-rv/p3.mjs` (R1 to R8)
- Review output: `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l6-rfc-rv/o1-development.json`, `o1-production.json`, `o2-development.json`, `o2-production.json` and `o3.txt` (R1 to R8: 1.35 development, 1.35 production, core-next development, core-next production) in the same folder. R9: `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l6-rfc-rv/internals.json`, run with `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l6-rfc-rv/vitest.internals.mts`

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
| Q1 | The lab's pattern: storage `{"scene::palette":"sodium"}`, init sets `palette = "aperture"` | "sodium" before start, "aperture" after, both modes (R4 splits `initialize()` from `start()`: the change happens at `initialize()`) |
| Q2, Q3 | The same with an init that leaves `palette` alone, or uses `??=` | "sodium" kept |
| Q4 | Save with no Date fact, development | Saved |
| Q5 | Save with a Date fact, development | Nothing saved; `onError` got "this is not a Date object."; production saved |
| Q6 | `t.number().default(5)`, `t.boolean().default(true)`, no init | Both `undefined` after start, both modes, both engines |
| R1 | Development and production, single-module system: read a Date fact through `system.facts`; call `getTime()` and `JSON.stringify` | Development: both threw "this is not a Date object.", on 1.35 and core-next. Production: `getTime()` returned 0 and JSON gave an ISO string |
| R2 | The same on a namespaced system | Development: `getTime()` threw, on both engines. Production: it returned 0 |
| R3 | `t.number().default(5)` with `initialFacts: {}` | `undefined` after start and no key in the snapshot, on both engines, both modes |
| R4 | The lab's call order: storage `{"scene::palette":"sodium"}`, the plugin with `include`, an init that sets `palette = "aperture"`; read, `initialize()`, read, `start()`, read, `destroy()`, read storage | "sodium", then "aperture" right after `initialize()`, "aperture" after `start()`; storage after `destroy()` held `{"scene::palette":"aperture"}`. Both modes |
| R5 | Storage `{"scene::palette":"sodium"}`, the plugin, `initialFacts: { scene: { palette: "init-facts" } }`, no init | "init-facts" won. Both modes |
| R6 | A spy plugin with `onFactSet`, `onFactsBatch` and `onSnapshot`; `restore({ facts: { n: 3 } })` | One `onFactsBatch` and nothing else. Both modes |
| R7 | `restore` of parsed JSON `{"facts":{"o":{"__proto__":{"x":1}}}}` | Threw "restore() rejected: snapshot contains potentially dangerous keys …". Both modes |
| R8 | Storage holds `{v:1,schema:{m:1},facts:{n:6}}`; the plugin; write `n = 1`; destroy | Development: a plugin error at load, then stored `{"n":1}`. Production: stored `{"v":1,"schema":{"m":1},"facts":{"n":6},"n":1}` |
| R9 | `facts.test.ts` and `mutants-facts.test.ts` on core-next, with `#is-development` and `/internals` aliased to core-next's source | 163 cases: 158 pass, 5 fail. The failures: `registerKeys` is not a function (2), the `onChange` call shape (1), the delete notification shape (2). None is in a validation group |

**Reading the table:** S11, Q1, R4 and R5 are (ai): the lab's own persistence loses to its init, and `initialFacts` beats the plugin today. R1 and R2 are why (aj) is declined, S10 is (ak), S12 and R8 decide A4, and S4 is why `restore()` can take an envelope later. S2 and S3 are (ag); S5 and Q8 are (ah), at `initialize`. R3 and Q6 are (al), and Q9 is (am) and (an). R6 and R7 shape `restore()`'s port (U14). R9 moves the 41 validation cases out of L6-pre. S1 and S7 are (af) and (ao), both recommended no.
