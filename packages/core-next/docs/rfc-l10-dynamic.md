# RFC: L10 dynamic definitions

Status: draft for review, revision 1. No engine or oracle code merges from this document.
Tree: branch `p10/l10-rfc`, cut from `main` at `17c5c556` (L0 to L7 gated; L8 built, its gate waiting on one owner signature; L9a merged, L9b on branch `p9/l9b`; `layers.rules.json` `current` is `"L7"`). Nothing in `packages/conformance` or `packages/core-next/src` is changed by this PR.

## What we are building

L10 lets a running system change what it is made of: add a derivation, constraint, resolver or effect after `createSystem`, replace one, remove one, run one on demand, and add or remove a whole module.

The plan's row reads "`dynamic()`: register/assign/unregister/call, registerModule, evict | dynamic-definitions, unregister-module | +1.5 KB | opt-in". Jason's Phase 4 answer, "Keep the order (Recommended)" (2026-11-05), settles the shape, as at L8 and L9: the alphas keep 1.35's API, so dynamic definitions are a part that `createSystem` wires, and they become an import at the beta. His "Full checks everywhere" gives L10 this document, the oracle first, the mutation gate, the random tests and two reviewers. When this document and 1.35 disagree, 1.35 wins; a difference is built only if the owner approves it as a lettered row.

Terms, used throughout:

- **A static definition** is one that came from the modules `createSystem` was given. **A dynamic definition** is one added later with `system.<kind>.register(id, def)`, where the kind is `derive`, `constraints`, `resolvers` or `effects`.
- **Assign** replaces a definition, static or dynamic, under the same id. **Unregister** removes a dynamic one; a static one cannot be removed. **Call** runs one definition once, now, outside the reconcile loop.
- **A pass** is one run of the reconcile loop. **Deferred** means an operation asked for during a pass is queued and applied after it.
- **A cached reader** is anything that read or asked about a name and keeps its answer until one of its dependencies changes: a derivation's cached value, a constraint's last evaluation, an effect, a subscriber.
- **`flattenModule(ns, mod)`** is the namespaced layer's per-module step as a function: one module's definitions with `ns::` ids and wrapped readers. core-next does this today inside one loop in `createNamespacedSystem`.

**Some of the row is already built.**

| Plan item | State in core-next | Where |
|---|---|---|
| `evict()` | **Built at L5** (owner B1, 2026-11-01: evict comes with the sources' `onEvict`) | `src/api/sources.ts:780–800`; `lib/layers.ts:200–202` |
| `constraints.disable/enable/isDisabled`, `effects.disable/enable/isEnabled` | Built; the diff scenario "constraints disable and enable at runtime" (placed at L10) passes at forced L10 | `src/api/constraints.ts:634–670`, `src/api/effects.ts` |
| The effects manager's `callOne` | Built, unused by any member | `src/api/effects.ts:626–631` |
| Effects that test `"name" in derived` depend on membership (quirk (c) and (w)) | Built for effects; "nothing changes membership before L10" | `src/api/facts.ts:115–119`, `src/api/core.ts:910–925` |
| `register`, `assign`, `unregister`, `call`, `isDynamic`, `listDynamic` on `constraints`, `resolvers`, `effects` | **Not built.** In development each throws `featureMissing` naming layer 10; in production they are absent | `src/api/missing.ts:62–70` |
| The same six on `derive` | **Not built, and not stubbed.** `system.derive` is a view over derivation names, so `system.derive.register` reads as an unknown derivation and the call is a `TypeError` | `src/api/core.ts:899–903` |
| `registerModule`, `unregisterModule` | **Not built**; stubbed as above | `src/api/missing.ts:70` |
| The store's `registerKeys` and `unregisterKeys` | **Not built** | none |
| `flattenModule(ns, mod)` | **Not a function yet**: the per-module body of a loop | `src/api/namespaced.ts:442–465` onward |
| `effects` linking a declared name when it comes to exist (`refreshDeps`) | Marked `TODO(L10)` | `src/api/effects.ts:179–181` |
| `meta.subscribe` callers other than `immediate` | Waiting for L10 | `src/api/meta.ts:18, 204` |

**Reading the table:** L10's real work is five things: the definitions registry for four kinds, the derivation half of it inside the core, `registerModule` and `unregisterModule` with `flattenModule`, the store's key registration, and the effects' late link. `evict` is done.

**In plain terms:** L10 is one new part, `withDynamic`, plus a seam in the core, because derivations live there. The probes found two 1.35 behaviours a user could notice and the plan already suspected: replacing a derivation with `{ compute, meta }` leaves it throwing on every read, and a derivation or constraint that asked for a name before it was registered never sees it arrive. They are the candidate rows (bl) and (bm). A third, a subscriber to a name that does not exist yet, is (bn). The size is an owner decision (A1), and it is much larger than the plan's +1.5 KB: 1.35's L10 code measures 5.6 KB on its own.

## Gap analysis, measured

**In plain terms:** at a forced L10, 109 tests fail on v2 for L10 reasons, every one for a missing member. 38 more fail for L8 and L9 reasons that those gates settle. And the 44 tests of L10's main file never run at L10 at all, because a test helper import places them at L13.

What I ran: `layers.rules.json` `current` set to `"L10"` in the working copy only (`sed`, then `grep` read `"current": "L10"`). Then, from `packages/conformance`, `npx vitest run --project conformance:v2 --project conformance:v2:prod`, then `--project conformance:v2:dist`, then `--project conformance:diff`, each with the JSON reporter (each exited 1, as expected). Then `git checkout -- layers.rules.json`; `current` read `"L7"` again and `git status --short` was empty for the package. core and core-next were built first (`pnpm --filter … build`, exit 0).

| Run | Tests | Pass | Fail | Skipped |
|---|---|---|---|---|
| `conformance:v2` and `conformance:v2:prod`, together, at forced L10 | 3,342 | 1,870 | 147 | 1,325 |
| `conformance:v2:dist` at forced L10 | 3,260 | 1,792 | 143 | 1,325 |
| `conformance:diff` at forced L10 | 434 | 423 | 11 | 0 |

**Reading the table:** of the 147, 109 are L10's, 30 are L9's and 8 are L8's. The `dist` run fails 107 of the L10 tests (the other 2 are in production-only files), the same 30 L9 tests and 6 of the 8 L8 tests. Of the diff's 11, 2 are L10's.

**The L8 and L9 failures are not L10 work.**

- **L8, 8 tests:** U3, U6, U8 (a) and (b) and U9 in `l8-history-pins-oracle` (6), and U3 in its production twin (2): the same 8 the L9 RFC listed. L8's gate turns them into signed expectations. So do the diff's 7 L8 failures (five in `l8-history-pins`, one each in `l8-history-navigation` and `l8-history`).
- **L9, 30 tests:** 27 are the trace (23 in `trace`, 3 in `blackbox-effects` "what a run tells the trace", 1 `traceEnabled` in `constraint-disable`), which L9b builds; the diff's "trace: per-run changelogs with causes" is the same. 2 call `$store.registerKeys` (`fact-tags-immutable`, `fact-tags-recorded`); L9-pre-a's B3 places them at L10 (`layers.rules.json:848` on `origin/p9/l9-pre-a`, not yet on `main`), so they join L10's list when it merges. 1 is a counter in `tracking-frame-kind` ("expected +0 to be 1").
- **The fuzz, 1 test:** seed 24301 fails "in the phase across every layer". The fuzz model draws no L10 feature (`diff/fuzz/model.ts:255–277`: the highest is `trace: 9`), so it is not an L10 failure. I did not shrink it; the L9 RFC shrank the same seed to `trace: true`.

| What fails (L10), by the highest member the test uses | Tests | The error |
|---|---|---|
| **`unregisterModule`** | 31 | `featureMissing` for `unregisterModule` (25: all of `unregister-module`) or for the `registerModule` that comes first (5); one production `TypeError`, where the stub is absent. 6 of the 31 are outside `unregister-module`: `blackbox-facts` (3), `l10-batch-resolvers-dynamic-oracle` (2), `blackbox-facts-production` (1) |
| **`registerModule`** | 16 | `featureMissing` (10); "d.register is not a function" (3, tests that register a derivation first); 3 assertions in `system` "Dynamic Module Registration" that expected 1.35's refusal text and got `featureMissing` |
| **`derive.*`** | 29 | `TypeError`: "d.register is not a function" (13), "system.derive.assign" (6), "system.derive.register" (4), "d.assign" (1), "d.call" (1); `featureMissing` for an `effects.register` in the same test (3); one assertion on "does not exist" |
| **`effects.*`** | 25 | `featureMissing` for `effects.call` (11), `register` (6), `assign` (4), `unregister` (1); 2 assertions on an expected message or no throw; one production `TypeError` |
| **`constraints.*`** | 4 | `featureMissing` for `constraints.register` (3) and `assign` (1) |
| **`resolvers.*`** | 4 | `featureMissing` for `resolvers.register` (the batched-resolver pins) |
| **Total** | **109** | |

**Reading the table:** every L10 failure is a missing member; none is a wrong answer from a built one. `derive.*` fails differently from the rest because `withMissing` does not stub it (see the first table).

**What `layers.json` places at L10.** 107 tests in 18 files, which run as 112 because one `mutants-derivations` test is a `%i` table of 6. One is internals (`sources.test.ts` "emits source.attach immediately when a module is registered after start"), which v2 skips by category. Of the 111 black-box runs, 109 fail and 2 pass. The placements' `by` reasons are all members: `.registerModule`, `.unregisterModule`, and `register`, `assign`, `unregister`, `call`, `isDynamic` and `listDynamic` on the four registries.

| File | Placed at L10 |
|---|---|
| `unregister-module` | 25 |
| `blackbox-effects` | 25 |
| `mutants-derivations` | 20 (25 runs) |
| `blackbox-facts` | 7 |
| `l10-batch-resolvers-dynamic-oracle` | 7 |
| `derivation-deps`, `system` | 4 each |
| `blackbox-derivations` | 3 |
| `blackbox-effects-readonly`, `meta-query-does-not-watch` | 2 each |
| `blackbox-effects-production`, `blackbox-facts-production`, `blackbox-facts-proxy`, `derived-in-constraints-effects`, `fact-tags-recorded`, `mutants-facts-system`, `round-2-criticals`, `sources` (internals) | 1 each |

**Two placed tests pass without the feature, and could not fail for the reason they are named for.**

- `blackbox-derivations` "rejects a null or non-object compute" expects a throw, and the missing `derive.register` throws a `TypeError`.
- `blackbox-facts` "refuses to re-declare an existing fact through a second module" expects a throw, and the `registerModule` stub throws.

This is L9's U10 again. L10-pre makes both bite by asserting the message (U11).

**L10's main test file is placed at L13.** `dynamic-definitions.test.ts` has `rule: "L10"` (`layers.rules.json:704–705`), but all 44 of its tests are placed at L13, each with the single reason `import flushMicrotasks` (`layers.json`; the note is `layers.rules.json:843`). That import is a one-line microtask flush from `/testing`; it is not what the tests are about. So the file that tests register, assign, unregister and call on every kind would be skipped at the L10 gate, and nothing at L10 would notice. This is the trap L9's U14 found for data-form introspection. The fix is a placement, not a rewrite: add `instruments: ["import flushMicrotasks"]` to the file's rule, as `requeue.test.ts` has (`layers.rules.json:409–412`), and check where each test lands (B2). I did not run them on v2: at every layer below L13 they are skipped.

**`evict` is not L10's.** The one evict test outside L5's files, `l3-engine-oracle-evict` "start() while evict() is running › is ignored", is placed at L5 by `member .evict` and passes today.

| Failing diff test | Why |
|---|---|
| "constraints, resolvers, effects and derivations registered, assigned, called, unregistered" (107 differences) | the first dynamic call fails on v2, so every later answer differs |
| "a module registered and unregistered at runtime" (41) | `registerModule` throws `featureMissing` on v2 |

**Reading the table:** the third L10 scenario, "constraints disable and enable at runtime", already passes. The fuzz does not reach L10 at all.

**The mutation gate.** No `gate: L10` run exists. The last dispatched run of `mutation-nightly.yml`, 43815165003 (2026-11-16), printed "Layer gate L9: FAIL. 170 deferred entries at or below L9 are not killed by the tests at or below L9" (line 65,776 of `gh run view --log`). **Result for L10: not started.** It is Precondition 1. The triage files hold 122 entries with `layer: "L10"`: 46 `feature-layer` and 76 `later-layer`. By file: `engine.json` 71, `effects.json` 34, `engine-accessors.json` 8, `constraints.json` 3, `facts.json` 2, and 1 each in `derivations.json`, `resolvers.json`, `system-module-transform.json` and `system.json`. 45 further entries mention L10 only in a note. `engine-definitions.json`, the file for 1.35's registry, holds 2 entries, both `equivalent`. To read the gate when it runs: `tsx scripts/mutation-score.ts --gate L10 --at <reports>` (`MUTATION.md`), and the "Layer gate L10" line of the Per-shard scores job.

## The design: each 1.35 rule, the mechanism that keeps it, and its pin

Where a row says "verified", the probe ran it against the published 1.35 (`packages/conformance/node_modules/directive-v1`, `1.35.0`), in development and production, with real timers. The output is under "Evidence". The rest is read from the code; 1.35 line numbers are in `packages/core/src/`.

### Where it lives, and the seam it needs

**In plain terms:** the registry and the module calls are one part that `createSystem` wires. Derivations live in the core, so the core gains a small seam that lets the part add, replace and remove one.

| Option | Keeps 1.35's API? | Who pays the bytes |
|---|---|---|
| **O1. A part wired by `createSystem`**: `withDynamic`, like `withHistory` (L8) and `withTrace` (L9) | Yes | Every `createSystem` build. `floor` pays only the derivation seam in the core |
| O2. An import (`dynamic()`, the plan's form) | No: `system.derive.register` and `system.registerModule` would vanish from a 1.35 program | Only programs that import it. This is the beta |

**Reading the table:** O1 keeps the alpha rule. Unlike L9, which read records the kernel already emitted, L10 changes the shape of the system, so each manager needs an add and a remove. Constraints, resolvers, effects and sources live in parts, so their add and remove live there too. Derivations do not: the core builds them in one loop at construction (`src/api/core.ts:863–882`: a `graph.computed` node per id, linked to a `keep` node, entered in `derivations` and `byNode`).

**The derivation seam, reasoned, not sketched.** Three pieces in the core, each exposed to the part on the context:

1. **`define(id, def)`**: the loop body, as a function the loop calls. It is a move, not new code.
2. **`replace(id, def)`**: swap the compute, mark the node stale, and carry the change to dependants and watchers, as 1.35's `invalidateReplacedDefinition` does (`core/derivations.ts:418–446`). It must keep the node and its dependency set, for the reason 1.35 gives at `derivations.ts:1199–1216`: a fresh node leaves stale links and a valid derivation under a stale one.
3. **`remove(id)`**: unlink the node from `keep` and from its dependencies, invalidate what depends on it, delete it from `derivations` and `byNode`, and drop it from the watched set (`mutants-derivations` "a removed derivation stops counting as watched at once").

Register and unregister also mark the name's membership key changed (`MEMBER_DEP_PREFIX`, `src/api/facts.ts:115–119`), which is what the effects' quirk (c) and (w) already listen for. I estimate the seam at 60 to 150 B on `floor` and did not sketch it; L10a measures it first, as L9a measured its seam.

**Opt-in?** No. 1.35 has no option for any of this: every system has the members. Like `meta` at L9, `withDynamic` always runs. Its cost is at the call; nothing runs per write.

### The registry: register, assign, unregister, call

**In plain terms:** one registry serves all four kinds. It checks the id, refuses a duplicate or a missing one, queues anything asked for during a pass, and tells plugins and `meta.subscribe` what changed.

| # | 1.35 rule | 2.0 mechanism | Pinned by |
|---|---|---|---|
| D1 | An id must be a non-empty string, not a blocked name (`__proto__`, `constructor`, `prototype`) and without `::`. A derivation id cannot be one of the six member names (`register`, `assign`, `unregister`, `call`, `isDynamic`, `listDynamic`) (`core/engine-definitions.ts:188–195, 280–286, 326–342`). Verified, P3, with 1.35's texts. | The same checks and texts, in `withDynamic`. The derive view answers the six names as members, not derivations. | `dynamic-definitions` (B2); `mutants-derivations`; U16 |
| D2 | `register` throws "… already exists. Use assign() to override."; `assign` throws "… does not exist. Use register() to create it." (`engine-definitions.ts:349–353, 404–408`). Verified, P3. | The same. | `mutants-derivations` "assign on a missing derivation throws"; `blackbox-effects` "assign on an unknown effect says so" |
| D3 | `unregister` removes only a dynamic definition. A static or unknown id is not an error: development warns "Cannot unregister static … Only dynamically registered …s can be removed." (for an unknown id too), production is silent (`engine-definitions.ts:427–438`). Verified, P3. | The same, text included. | `blackbox-effects` "a static effect cannot be unregistered", "unregistering an unknown effect is a no-op"; U10 |
| D4 | On a destroyed system `register`, `assign`, `unregister` and `call` throw "Cannot … on a destroyed system." (`engine-definitions.ts:488–494, 540–545`). Verified, P3. | The same. | U16 |
| D5 | During a pass, `register`, `assign` and `unregister` are queued (at most `maxDeferredRegistrations`, then "Too many deferred registrations") and applied after the pass; an error in a queued one is logged in development and dropped (`engine-definitions.ts:451–479, 498–511`; flushed at `core/engine.ts:2220`). Verified, P4: a constraint registered inside an effect was not dynamic inside the pass, was afterwards, and its resolver ran. | A queue in `withDynamic`, drained at the end of a pass through the reconciler's pass-end hook. | U5 |
| D6 | Each change tells plugins (`onDefinitionRegister`, `Assign`, `Unregister`, `Call`) and calls `meta.subscribe` listeners once; a fact write never does (`engine-definitions.ts:364–365, 420–421, 444–445`; `engine.ts:1679, 2512`). Verified, P5. | The plugin hooks exist in core-next's table; `withDynamic` emits them and calls `withMeta`'s listeners (`src/api/meta.ts:204`). | U8 |
| D7 | A constraint or resolver change schedules a pass. A derivation or effect change schedules one only if it left work owed, such as an invalidated watched derivation (`scheduleIfWorkOwed`, `engine-definitions.ts:382–393`), so `settle()` resolves after replacing a watched derivation. | The same rule, read from the core's watched set. | `round-2-criticals` "does not leave the system waiting for quiet forever" |
| D8 | `call(id)` runs one definition now: a derivation recomputes and returns its value, ignoring the cache; a constraint returns the requirements it would add; a resolver runs for a given requirement; an effect runs, even without a change, and a disabled one does nothing. An unknown id throws "Cannot call … — it does not exist." (`engine-definitions.ts:539–566`; `derivations.ts:1282–1292`). Verified, P3 and P6. | Through each manager; the effects manager's `callOne` exists. | `blackbox-effects` "which effects run" (5); `mutants-derivations` "call() recomputes every time" |
| D9 | `isDynamic(id)` and `listDynamic()` answer only for `register`ed ids. A definition a module brought through `registerModule` is not dynamic (`engine.ts:4535–4608` never touches the registry's sets). Verified, P5: `isDynamic` false, `listDynamic` `[]`. | The same. | U6 |
| D10 | Meta on a registered or assigned constraint, resolver or effect is frozen with `freezeMeta`; a derivation's is frozen by its manager (`engine-definitions.ts:355–359, 410–414`). | `withMeta`'s `freezeMeta`, at the same points. | `mutants-derivations` "assign swaps the function and drops the old meta" |

**Reading the table:** most of the registry is bookkeeping with exact error texts, and 1.35's own tests pin it well once `dynamic-definitions` is placed at L10. D5 is the one with timing: a definition added inside an effect is not there until the pass ends.

### Each kind

| # | 1.35 rule | 2.0 mechanism | Pinned by |
|---|---|---|---|
| K1 | **Derivations.** `register` accepts a function or `{ compute, meta }` and unwraps the object (`derivations.ts:247–288, 1197–1240`). `assign` keeps the node and its dependency set, swaps the compute, and wakes subscribers and dependants once per valid-to-stale edge (`1242–1264`). `unregister` removes its own links, invalidates its dependants, and forgets it (`1266–1276`). | The seam's `define`, `replace` and `remove`. | `mutants-derivations` (20); `blackbox-derivations` (3); `derivation-deps` (4) |
| K2 | **`assign` with `{ compute, meta }` breaks the derivation.** The registry calls the manager, which unwraps the object into a function, and then writes the raw object back over it (`engine-definitions.ts:417–419`: `manager.assignDefinition`, then `mergedMap[id] = def`, where the merged map is the manager's own `definitions`). Every read, `call` and `meta.derivation` then throws "def is not a function" ("m is not a function" in production). Assigning a function afterwards repairs it. `register` with the same object works, because it writes the merged map before the manager unwraps it (`361–362`). Verified, P1b, on a dynamic and on a static derivation. | Without (bl): copied. With (bl): `assign` unwraps the object as `register` does. | U1; shows (bl) |
| K3 | **Constraints.** `register`, `assign` (including `abortOn`, which binds a batched requirement to the live facts) and `unregister` go through the constraints manager; `unregister` also clears the binding-disabled warnings for the id, so a re-registered constraint can warn again (`engine.ts:2612–2631`; `core/constraints.ts:1674–1748`). | The constraints part gains add, replace and remove. | `l10-batch-resolvers-dynamic-oracle` "assigning abortOn …"; `derived-in-constraints-effects` |
| K4 | **Unregistering a constraint whose resolver is running does not stop the run.** Verified, P6: the resolver's `signal` was not aborted, it finished, and its write landed. | Copied. Read in L10a to find which 1.35 rule keeps the requirement alive; pinned before it is built. | U9 |
| K5 | **Resolvers.** `register` and `assign` also publish the resolver's `key` function as the dedupe identity for its requirement type; `unregister` removes it, and cancels and drains what is queued or running in a batch (`engine.ts:2651–2672, 1269`; `core/resolvers.ts:2051–2086, 2346–2416`). | The resolvers part gains add, replace, remove and drain. | `l10-batch-resolvers-dynamic-oracle` (6) |
| K6 | **Effects.** A registered effect's `prevFacts` start as the facts at registration; the last reader of `prev` leaving stops the copying; `assign` cleans up the old definition first; an effect that fails after being unregistered is not run again (`core/effects.ts:1489–1586`). A declared name that becomes a derivation later is linked then (`refreshDeps`). | The effects part gains add, replace and remove; `TODO(L10)` at `effects.ts:179` becomes `link` on register. | `blackbox-effects` (25) |

### Modules: registerModule and unregisterModule

**In plain terms:** `registerModule` merges a whole module into a running system; `unregisterModule` takes it out, in reverse order, and waits for its work to stop.

| # | 1.35 rule | 2.0 mechanism | Pinned by |
|---|---|---|---|
| M1 | Refused during a pass ("Cannot register module … during reconciliation") and on a destroyed system (`engine.ts:4435–4446`). Keys are checked (blocked names; a schema key starting with `$`); a fact that already exists throws "Schema collision: Fact … already exists" (`4449–4479`). Verified, P5. | The same, in `withDynamic`. | `blackbox-facts` "refuses to re-declare …" (made to bite, U11) |
| M2 | A derivation the module names that already exists is **replaced**, with no error and no warning (`engine.ts:4535–4541`; `derivations.ts:1199–1216` says so on purpose). Verified, P5: `double` read `-1` afterwards. | The seam's `replace`. | `mutants-derivations` "replacing a live name through registerModule" (2); U7 |
| M3 | Order: schema merged and its tags recorded at once (before a source the module registers can publish), schema types frozen, events, derivations, effects, sources (plugins told before attach), constraints, resolvers with their keys, the store's `registerKeys`, module meta, `meta.subscribe` listeners, `init` in a batch, `onModuleRegistered`, `onInit`, and `onStart` with a pass if running (`engine.ts:4508–4642`). Verified, P5: `meta.subscribe` was called twice for one `registerModule` (once from the store's key hook, `engine.ts:1070`, once at `4625`). | The same order, by calling each part's add. | `fact-tags-recorded` "records a module's tags before a source …"; `sources.test.ts` (internals); U8 |
| M4 | Namespaced: the namespace must be new, without `::`, and not a blocked name; the module is flattened with `prefixModuleDefinition`; a failed registration rolls the namespace bookkeeping back so the name is free again (`core/system.ts:786–855`). | `flattenModule(ns, mod)`, made from the loop at `src/api/namespaced.ts:465` onward, which construction then calls once per module. | `system.test` "Dynamic Module Registration" (4); `unregister-module` "frees the namespace again when registerModule itself fails" |
| M5 | `unregisterModule` takes a namespace (or, single-module, an id), throws on a destroyed system, during a pass, or for an unknown module ("no such module namespace"), and joins a second concurrent call for the same module (`engine.ts:4661–4712`; `system.ts:857–899`). Verified, P7. | The same. | `unregister-module` (25) |
| M6 | Teardown is the reverse of registration and the order is load-bearing: sources (including a pending linger timer), resolvers (aborted, then drained, with their keys removed only if no surviving resolver declares one), constraints, effects, derivations, events, facts last (the store's `unregisterKeys`, reported to plugins as one batch of deletions), tags and meta dropped, `meta.subscribe` listeners, `onStop` (a throw is logged, and the name is still released), plugins told, and a pass awaited if running (`engine.ts:4717–4876`). | Each part's remove, in that order. | `unregister-module` "tears down in the documented order" and 24 more; `mutants-facts-system` |
| M7 | A late write from a retired module's resolver is dropped, not thrown, and cannot reach a replacement module with the same name (`unregister-module` "does not let a retired module's late write reach its replacement"). | The store's `unregisterKeys` removes the declaration, not just the value. | `unregister-module`; `blackbox-facts-production` |

**Reading the table:** M2 and M6 are where a rebuild would go wrong. M2 looks like a bug and is documented 1.35 behaviour, pinned by two tests. M6's order is pinned by a test that records it.

### Interactions with cached readers, the reconcile loop, history, the trace and meta

| # | 1.35 rule | 2.0 mechanism | Pinned by |
|---|---|---|---|
| I1 | **A reader that met a name before it existed never sees it arrive.** A derivation that asked `"later" in derived`, or read `derived.later` and got `undefined`, keeps its answer after `later` is registered, and after a write to the fact `later` reads. A constraint whose `when` asked the same was evaluated once and never again, so its resolver never ran. Verified, P2, both modes. Effects are the exception: they depend on membership (quirk (c) and (w)) and re-run. | Without (bm): copied; core-next already records membership only in effect frames (`src/api/core.ts:910–925`). With (bm): derivation and constraint frames record the name's membership key too, and register and unregister mark it changed. | U2, U3; shows (bm) |
| I2 | **A subscriber to a name that does not exist yet is never called.** `subscribe(["later"], …)` warns "subscribe: unknown key" in development and is not called after `later` is registered and changes. Verified, P2. | Without (bn): copied. | U4; shows (bn) |
| I3 | **The trace's hit rows.** core-next's seam reads `constraints.state_(id)!.priority` for every constraint with a current requirement (`src/api/reconcile.ts:568–573`). That is safe only while constraint states are never deleted, and L10's `unregister` deletes one. With K4, a requirement can outlive its constraint. | Change the read to tolerate a missing state (`state_(id)?.priority`), and pin it: trace on, unregister a constraint while its resolver runs, settle. Reasoned from K4 and the code; L10a confirms whether the requirement is still current after the unregister. | U13 |
| I4 | **The trace and history see a dynamic change like any other pass.** Registering a constraint and its resolver added trace runs whose hit names the new constraint, and the resolver's write added one history snapshot. Verified, P8. | Nothing new: the parts' records already cover it. | U14 |
| I5 | `meta` answers include dynamic definitions, and lose unregistered ones and their tags (`engine.ts:4813, 4828`). A metadata query does not put every derivation into the watched set. | `withMeta` reads the managers live. | `meta-query-does-not-watch` (2) |

**Reading the table:** I1 is the issue the plan flagged as "not seen by cached readers", now confirmed. It is not only derivations: a constraint gated on a later registration never fires.

## Where it lives

**In plain terms:** one new file, edits to five existing parts and the namespaced layer, and a seam in the core for derivations.

| Piece | File | Change |
|---|---|---|
| `withDynamic` | `src/api/dynamic.ts` (new) | The registry (D1 to D10), the queue, `registerModule` and `unregisterModule` (M1 to M7), the plugin and `meta.subscribe` calls |
| **The seam**: `define`, `replace`, `remove` for a derivation; membership keys | `src/api/core.ts:863–925` | The loop body becomes `define`; `replace` and `remove` are new; with (bm), derivation and constraint frames record a missing name's membership key. Reasoned at 60 to 150 B on `floor`. L10a, first |
| Constraints | `src/api/constraints.ts` | Add, replace, remove, `callOne` |
| Resolvers | `src/api/resolvers.ts` | Add, replace, remove, drain, `callOne`; key functions |
| Effects | `src/api/effects.ts:179` | Add, replace, remove; the `TODO(L10)` link |
| Sources | `src/api/sources.ts` | A module's sources attached late and cleaned up, with the linger timer |
| The store | `src/api/facts.ts` | `registerKeys` and `unregisterKeys` on `$store` |
| The namespaced layer | `src/api/namespaced.ts:442–465` onward | `flattenModule(ns, mod)`, called by construction and by `registerModule` |
| The trace's hit rows | `src/api/reconcile.ts:571` | A missing state is tolerated (I3) |
| `withMissing` | `src/api/missing.ts:62–70` | The L10 stubs go |

## The fuzz, designed in up front

**In plain terms:** the random tests do not reach L10 at all today. They need steps that add, replace and remove definitions and modules while the system runs.

What the model does today, read from the code: `FEATURE_LAYERS` (`diff/fuzz/model.ts:236–277`) tops out at `trace: 9`; its steps (`97–132`) are writes, events, time, lifecycle, snapshots and history. No step registers, assigns, unregisters or calls anything, and no case registers a module.

| L10 behaviour | The model reaches it today? | What L10-pre adds |
|---|---|---|
| Register, assign, unregister and call of each kind (D1 to D10, K1 to K6) | No | A `dynamic: 10` feature and steps `register`, `assign`, `unregister`, `call`, with the kind and the id drawn from a small pool that overlaps the static ids, so collisions, missing ids and static refusals happen |
| The queue (D5) | No | The same steps drawn inside an effect body |
| `registerModule` and `unregisterModule` (M1 to M7) | No | Steps that register and retire a second drawn module, namespaced and single, while a resolver runs |
| Cached readers (I1, I2) | No | A derivation and a constraint that ask `in` about a pooled id before it is registered |
| The trace and history across a change (I3, I4) | Partly: `trace` and `history` are drawn | Nothing more; the new steps run under them |

**What is compared, and the shapes that are new.** The recorder keeps the plugin hooks and the whole `inspect()` at every checkpoint. New at L10: the `onDefinition*` and `onModule*` hooks, their order and payloads; `listDynamic()` order; error messages from refused calls (compared exactly, since 1.35's texts are kept in production); and the `inspect()` lists after a removal. Expect new shapes at the gate as differences of order (a module's definitions torn down in an order the reconciler iterates differently) and of count (a deferred registration applied before or after a pass's effects). This is a prediction from L7 to L9, not a measurement.

**Harness rules, decided now.** L8's ten rules and L9's three carry over. Three are new:

1. **Ids come from a pool.** Register, assign and unregister draw ids from a pool of four per kind that includes the static ids, so D2 and D3 are exercised as often as success.
2. **Each new step ships with a self-test**: one that drops an `onDefinitionRegister`, one that applies a deferred registration a pass early.
3. **The L10-pre exit bar.** The 21 PR seeds at forced L10 leave at most 10 unexplained cases. A case is explained if its shrunk form is "dynamic not built" or one of L8's and L9's items.

Whether the deep runs gate L10 is decision A2.

## Untested behaviours, and what will pin each

**In plain terms:** 16 items have no pin at L10 today. Eleven came from the probes; five from the forced-L10 run and from reading the code.

| # | Behaviour | Evidence | Pinned by | Slice |
|---|---|---|---|---|
| U1 | `derive.assign(id, { compute, meta })` leaves every read, `call` and `meta.derivation` throwing "def is not a function" until a function is assigned | P1b | A conformance test, dynamic and static; shows (bl) | L10-pre |
| U2 | A derivation that asked `in` or read a name before it was registered keeps its answer after the registration and after a write upstream | P2 | A diff scenario; shows (bm) | L10-pre |
| U3 | A constraint gated on a later-registered name is never re-evaluated, and its resolver never runs | P2 | A diff scenario; shows (bm) | L10-pre |
| U4 | `subscribe` to a name that does not exist yet warns in development and is never called | P2 | A conformance test in each mode; shows (bn) if approved | L10-pre |
| U5 | A registration inside an effect is deferred: not dynamic inside the pass, dynamic after, and its resolver runs | P4 | A diff scenario | L10-pre |
| U6 | A module's definitions are not dynamic: `isDynamic` false, `listDynamic` empty | P5 | A conformance test | L10-pre |
| U7 | `registerModule` over a live derivation replaces it with no warning | P5 | A conformance test in development | L10-pre |
| U8 | `meta.subscribe` is called twice by `registerModule`, once each by `register`, `assign` and `unregister`, and never by a write | P5 | A conformance test | L10-pre |
| U9 | Unregistering a constraint while its resolver runs does not abort the run, and its write lands | P6 | A diff scenario | L10-pre |
| U10 | Unregistering a static or unknown id does not throw; development warns "Cannot unregister static …", even for an unknown id; production is silent | P3 | A conformance test in each mode | L10-pre |
| U11 | `blackbox-derivations` "rejects a null or non-object compute" and `blackbox-facts` "refuses to re-declare an existing fact …" pass on v2 today because the member is missing | the forced-L10 run | Assert the message (an oracle change) | L10-pre |
| U12 | `dynamic-definitions.test.ts` (44 tests) sits at L13 for `import flushMicrotasks` | `layers.json`; `layers.rules.json:704–705, 843` | B2: re-place, not rewrite | L10-pre |
| U13 | The trace's hit rows after a constraint is unregistered while its requirement lives | read: `src/api/reconcile.ts:571`; P6 | A conformance test with trace on that unregisters mid-flight and settles | L10-pre |
| U14 | A dynamic registration's pass is traced and snapshotted like any other | P8 | A diff scenario with `trace` and `history` | L10-pre |
| U15 | `unregisterModule` on a single-module and a namespaced system: the facts go; a second call throws "no such module namespace" | P7 | Already pinned by `unregister-module`; listed so L10b checks both modes | none |
| U16 | The refusal texts (D1, D2, D4) are the same in production as in development | P3 | A conformance test in production | L10-pre |

**Reading the table:** U1 to U4 are where the candidates live. Each pins 1.35's behaviour now, and shows the difference only with an approved, signed entry. U11 and U12 are not behaviours; they keep the gate honest.

## Performance

**In plain terms:** a system that never registers anything must not slow down; a registered definition must be as fast as a static one.

I did not run the bench for this RFC: no L10 code exists. What L10 must keep:

- No workload slower than `main` by more than 5% after any L10 slice. `withDynamic` adds nothing per write.
- A registered derivation, constraint or effect runs on the same path as a static one: no lookup through the registry on a read.
- With (bm), the membership key is recorded only on a miss (a name that does not exist), so a read of an existing derivation costs what it costs today.
- `unregisterModule` awaits its drain and a pass, as 1.35 does; that is latency the caller asked for.
- L10b adds a `module-churn` workload (B5): register and retire a module 100 times while a resolver runs. Time and bytes, judged at 1.0 or better against 1.35.

## Slice plan

**In plain terms:** an oracle slice, two build slices, and the gate.

| Slice | Builds | Done means (checkable) | Tier |
|---|---|---|---|
| Precondition 1 | A `gate: L10` run of `mutation-nightly.yml`. | The L10 layer gate reports PASS, or its debt entries are listed as L10-pre work. | test oracle; coordinator |
| Precondition 2 | The L9 gate (L9b merged, `current` L9), with L9-pre-a's B3. | The 30 L9 failures at forced L10 pass or are signed; the two `registerKeys` tests are placed at L10. | coordinator |
| L10-pre (oracle) | B2 (re-place `dynamic-definitions`). U1 to U14 and U16. U11 made to bite. The fuzz steps and rules 1 to 3 (B1), each with a self-test. Any mutation debt. | The 21 PR seeds at forced L10 leave at most 10 unexplained cases. The new tests pass on `conformance:v1` and `v1:prod`, and on v2 fail only as this document predicts. `conformance:diff` at forced L10 fails only the two L10 scenarios, the fuzz and the new scenarios. `pnpm census`, `check:expects` and `oracle:update` exit 0. `oracle-change` label. | test oracle; Sonnet implementer, Fable correctness reviewer |
| L10a | **The seam first**: `define`, `replace`, `remove` and the membership keys, measured and reported. Then `withDynamic`'s registry for the four kinds (D1 to D10, K1 to K6), the queue, the effects' late link, the `meta.subscribe` callers. (bl) and (bm) if approved. I3. | At forced L10 on v2, v2:prod and v2:dist, the 62 registry failures pass (29 `derive.*`, 25 `effects.*`, 4 `constraints.*`, 4 `resolvers.*`), and the re-placed `dynamic-definitions` tests that do not register a module. The diff "constraints, resolvers, effects and derivations registered …" matches 1.35 or differs only by signed entries. core-next `test`, `typecheck`, `build`, `size:check` with the exact development-string count. The PR reports the seam's bytes and the registry's separately, before L10b starts. | core; Opus implementer, Sonnet diff reviewer plus Fable correctness reviewer |
| L10b | `flattenModule`, `registerModule`, `unregisterModule` (M1 to M7), `registerKeys` and `unregisterKeys`, sources and resolver drain, `module-churn` (B5). | The 47 module failures pass (31 `unregisterModule`, 16 `registerModule`), and the two `registerKeys` tests. The diff "a module registered and unregistered at runtime" matches 1.35. The 21 PR fuzz seeds at forced L10 pass, or every failure is listed with its row. Plus L10a's checks. | core; as L10a |
| L10-gate | `current` to L10, `ratchet --update`, diff and fuzz at L10, the 46 feature-layer triage entries converted, `GATE-10.md`, `/principal` on L10. | 0 L10 failures on v2, v2:dist and v2:prod. The census exits 0. PR fuzz passes at L10. The nightly follows A2. At most 3 gate runs, then Jason. | test oracle; Sonnet plus the coordinator's read of each entry |

**Reading the table:** L10a is the per-definition surface, and L10b the per-module one built on it. Splitting them puts the seam's bytes on the record before the larger half is written.

## Size

**In plain terms:** 1.35's L10 code weighs about 5.6 KB on its own, almost four times the plan's +1.5 KB. Ported at the rates L9 and L8 landed, that is about 4.1 to 5.0 KB in every `createSystem` build. The recommended cap is +5.0 KB, and +150 B on `floor`.

**The post-L9 base.** Measured with `node scripts/size.mjs --check` in `packages/core-next` on this branch (production, minified, gzip 9; exit 0): `minimal` 33,778 B, `two-module` 33,867 B, `floor` 10,990 B, `aperture` 38,667 B, `full-entry` 36,049 B. That is after L9a only. L9b's branch (`origin/p9/l9b`, `size-budgets.next.json`, each budget 10 B over its measurement) gives the post-L9 sizes:

| Fixture | `main` now (after L9a) | L9b's branch (post-L9) |
|---|---|---|
| `minimal` | 33,778 B | 35,282 B |
| `two-module` | 33,867 B | 35,373 B |
| `floor` | 10,990 B | 11,017 B |
| `aperture` | 38,667 B | 40,150 B |
| `full-entry` | 36,049 B | 37,551 B |

L9's cap on `minimal` is 35,339 B; L9b is 57 B under it.

**1.35's L10 code, measured.** The method is the L9 RFC's. A script lifts each region from `packages/core/src` by an anchor and bracket balance, wraps the regions in one function whose free names are parameters (so the minifier mangles them as in a real build), and bundles it with esbuild 0.27.7, production (`isDevelopment` replaced by `false` in the source, so development text drops out), minified, gzip 9. The wrapper's own cost is subtracted. `engine-definitions.ts` is bundled whole, with `#is-development` removed from its source and its two runtime imports external.

| Piece | Regions | Non-comment lines | Minified | Gzip |
|---|---|---|---|---|
| The registry | `core/engine-definitions.ts`, whole | 395 | 4,705 B | **1,667 B** |
| `registerModule` | `core/engine.ts:4411–4643` | 171 | 2,461 B | 882 B |
| `unregisterModule` | `engine.ts:4661–4712, 4715, 4717–4876` | 150 | 2,106 B | 784 B |
| The engine's wiring and the members on `constraints`, `effects`, `resolvers` | `engine.ts:1666–1680, 2220, 3502, 2612–2631, 2637–2648, 2651–2672, 4879–4882` | 71 | 1,236 B | 406 B |
| All of `engine.ts` above, in one bundle | | 392 | 5,805 B | **1,830 B** |
| Derivations' dynamic half | `core/derivations.ts:386–475, 1197–1292` | 117 | 1,011 B | 451 B |
| Constraints' | `core/constraints.ts:1674–1803` | 95 | 962 B | 466 B |
| Effects' | `core/effects.ts:1489–1586` | 68 | 761 B | 373 B |
| Resolvers' (including the drain) | `core/resolvers.ts:2051–2086, 2346–2444` | 105 | 1,248 B | 583 B |
| Sources' | `core/sources.ts:975–1032, 1058–1088` | 53 | 591 B | 288 B |
| The store's `registerKeys` and `unregisterKeys` | `core/facts.ts:645–683, 694–728` | 46 | 605 B | 370 B |
| `derive`'s six members | `core/engine-accessors.ts:46–55` | 10 | 240 B | 90 B |
| Namespaced `registerModule` and `unregisterModule` | `core/system.ts:786–899` | 77 | 1,191 B | 431 B |
| Single-module | `system.ts:1338–1359` | 19 | 314 B | 143 B |
| **Everything above, in one gzip stream** | the minified pieces concatenated | 1,377 | 18,237 B | **5,627 B** |
| The same pieces, each gzipped alone, summed | | | | 6,692 B |

**Reading the table:** gzipped one by one, the registry and the engine's module code are 3.5 KB, the managers' halves 2.2 KB, and the store, `derive`'s members and the system layer 1.0 KB: 6.7 KB, which one gzip stream shrinks to 5.6 KB. Error texts are a large share, and they stay: 1.35 keeps them in production and tests assert them (U16). Not counted: `prefixModuleDefinition` (`core/system-module-transform.ts`), because core-next already has its flattening; and `evict`, built at L5. core-next already has the effects manager's `callOne`, about 0.1 KB of the effects line.

**How much of 1.35's size a port pays.** Three layers are measured. L7 landed at 0.61 of 1.35's isolated bytes, and 12% over its first cap. L8 landed at 0.88, 26% above its high estimate. L9: the post-L8 base was 32,339 B (L9's cap, 35,339 B, less its +3.0 KB), and L9b measures 35,282 B, so **+2,943 B**, 0.87 of the 3.4 KB the L9 RFC measured in isolation, 98% of its cap, and 9% above its middle estimate (2.7 KB). L9a's seam landed at +105 B against a sketched +78 B, 35% over. So L7, L8 and L9 each landed above an estimate made for it (L7 its first cap, L8 its high estimate, L9 its middle), and L9's seam above its sketch.

| Estimate | Basis | `minimal` grows by |
|---|---|---|
| The derivation seam | Reasoned ("Where it lives"); not sketched | 60 to 150 B |
| Low | 5.5 KB (5.6 KB less the effects `callOne` core-next has) at L7's 0.61 | about 3.4 KB |
| Middle | 5.5 KB less about 0.8 KB that a rebuild folds: `registerModule` and `unregisterModule` routed through the same per-kind add and remove the registry uses, where 1.35 repeats them; the rest at L9's 0.87 | about 4.1 KB |
| High | 5.6 KB (5,627 B) at L8's 0.88, no folding and no reuse | about 4.95 KB (4,952 B) |
| The earlier misses repeated | The middle (4.1 KB) at L9's +9% and L7's +12% | 4.5 and 4.6 KB |
| The worst miss repeated | The middle at L8's +26% | 5.2 KB |
| (bl) assign unwraps the object form | Reasoned: one call moved | +0 to 20 B |
| (bm) membership keys in derivation and constraint frames | Reasoned: one branch on a miss, in the seam | +30 to 80 B |
| (bn) subscribers to a later name | Reasoned: a pending-key list and a check on register | +80 to 150 B |
| `floor` | The seam only; the part is not in the floor | 60 to 150 B; cap +150 B |

**Reading the table:** the plan's +1.5 KB is below even the low estimate, which assumes a rebuild as tight as L7's. The middle assumes the one fold the code invites.

**The basis for +5.0 KB.** It is the high estimate, 4,952 B, rounded up. It covers a repeat of L7's and L9's misses from the middle (4.5 and 4.6 KB) and not of L8's (5.2 KB). I would not raise it on a guess: a larger cap is a larger allowance to spend. The cap is protected by timing instead: L10a reports the seam's bytes and the registry's before L10b starts, so a layer on course to pass +5.0 KB says so while the module half is still unbuilt.

| Fixture | Post-L9 (L9b's branch) | Cap (post-L9 plus) | At most |
|---|---|---|---|
| `minimal` | 35,282 B | +5.0 KB | 40,282 B (40,339 B if L9 lands at its cap) |
| `two-module` | 35,373 B | +5.0 KB | 40,373 B |
| `aperture` | 40,150 B | +5.0 KB | 45,150 B |
| `full-entry` | 37,551 B | +5.0 KB | 42,551 B |
| `floor` | 11,017 B | +150 B | 11,167 B |

The cap is a difference over the size L9 merges at, and the L10-gate re-reads that base. `floor`'s cap is the seam's high estimate; it is reasoned, not measured, so L10a's first commit measures it and comes back if it is over.

**Under "Keep the order".** Every `createSystem` build carries the registry and the module calls until the beta, used or not. At the beta, `dynamic()` becomes an import, and an app that skips it drops all but the seam: about 4 KB at the middle estimate.

## What the plan got wrong, or left out

- **+1.5 KB is about a third of the measured cost.** 1.35's L10 code is 5.6 KB on its own; the estimate for core-next is 3.4 to 5.0 KB.
- **`evict` is L5's,** and built (owner B1, 2026-11-01).
- **It is not opt-in.** 1.35 has no option; every system has the members, as with `meta` at L9.
- **L10's main test file sits at L13.** `dynamic-definitions`' 44 tests are placed by `import flushMicrotasks`, the trap L9's U14 found. B2 re-places them.
- **`registerKeys` is L10's,** from L9's B3; its two tests move here when L9-pre-a merges.
- **`derive`'s six members are not stubbed** by `withMissing`, so a 1.35 program calling them gets a `TypeError`, not the "not built" message.
- **Derivations need a core seam.** They live in the core, not a part, so adding and removing one cannot be done from `withDynamic` alone.
- **The two bugs the plan suspected are real, and a third shape joins them.** `assign` with `{ compute, meta }` breaks reads (K2); readers that met a name before it existed never see it (I1), constraints included; and subscribers to such a name are never called (I2).
- **Two placed tests prove nothing on v2 today** (U11).
- **The trace's `state_(id)!`** assumes a constraint state is never deleted; L10's `unregister` deletes one, and a requirement can outlive its constraint (K4, I3).

## Decisions for the owner

**Questions for Jason.** Seven answers settle L10. The table after them gives each a product verdict, so Jason can bulk-approve. No owner answer is recorded for L10 yet.

1. **A1, the L10 size.** `withDynamic` as a part wired by `createSystem` (O1), with a derivation seam in the core; `minimal`, `two-module`, `aperture` and `full-entry` each allowed up to +5.0 KB over their post-L9 size, and `floor` up to +150 B. **Recommend: approve.**
2. **A2, do deep fuzz runs gate L10, or report?** **Recommend: "Gate on short seeds; deep runs report"**, as at L8 and L9.
3. **A3, fuzz-ready before the gate.** **Recommend: approve L8's brakes unchanged**, with the L9 gate as the precondition.
4. **(bl), `assign` with `{ compute, meta }` works.** **Recommend: approve.**
5. **(bm), a derivation or constraint sees a name registered after it asked.** **Recommend: approve.**
6. **(bn), a subscriber to a name registered later is told.** **Recommend: decline.**
7. **B1 to B5.** **Recommend: approve.**

A "no", or no answer yet, means the slice keeps 1.35's behaviour, pins it with a core-next test, and writes no entry.

| Decision | Product verdict | Recommendation |
|---|---|---|
| **A1** dynamic definitions in a part wired by `createSystem`, and the L10 budgets | Same behaviour; every `createSystem` build grows by an estimated 3.4 to 5.0 KB, most likely 4.1 KB, until the beta, when apps that skip `dynamic()` drop nearly all of it | Approve: up to +5.0 KB on four fixtures, +150 B on `floor`; come back above that |
| **A2** deep runs report, short seeds gate | No behaviour change; decides when L10 can merge | "Gate on short seeds; deep runs report" |
| **A3** fuzz-ready before the gate | No behaviour change; bounds the gate's cost | Approve |
| **(bl)** `derive.assign(id, { compute, meta })` replaces the derivation and keeps it readable | Better, visible: a program that swaps in a derivation with a label or tags gets the new value; in 1.35 every read of it throws until a plain function is assigned | Approve, in L10a |
| **(bm)** a derivation or constraint that asked for a name before it existed recomputes when the name is registered or unregistered | Better, rare but silent: a feature flag or plugin that registers a derivation later is seen by the code that was waiting for it; in 1.35 a constraint gated on it never fires. A derivation that asked recomputes once more on a registration, which a test counting computes would see | Approve, in L10a |
| **(bn)** `subscribe` to a name that does not exist yet starts calling once it is registered | Better, rare: development already warns "unknown key" at the call. Costs a list of pending names in every build | Decline; pin 1.35 (U4) and revisit with the beta's `subscribe` |
| **B1** the fuzz steps and harness rules 1 to 3 | No behaviour change | Approve |
| **B2** `dynamic-definitions.test.ts` re-placed by `instruments: ["import flushMicrotasks"]` | No behaviour change; a layer placement | Approve |
| **B3** `registerKeys` and `unregisterKeys` are built at L10, with L9-pre-a's placement | No behaviour change | Approve |
| **B4** signing for approved rows | No behaviour change; the census needs signed entries | Approve |
| **B5** a `module-churn` workload | No behaviour change | Approve |

### A. Decisions

#### A1 where dynamic definitions live, and the L10 budgets

- **What 1.35 does.** `register`, `assign`, `unregister`, `call`, `isDynamic` and `listDynamic` on four registries, and `registerModule` and `unregisterModule`, on every system, with no import and no option.
- **What 2.0 would do.** `withDynamic`, a part wired by `createSystem`, like `withHistory` (L8) and `withTrace` (L9). Derivations are built in the core, so the core gains `define`, `replace` and `remove`. At the beta, `dynamic()` becomes an import.
- **The measured basis.** 1.35's L10 code is 5,627 B in one gzip stream, measured in isolation (Size). L8 and L9 landed at 0.88 and 0.87 of their isolated figures; L7 at 0.61. L7, L8 and L9 each landed above an estimate made for it, and L9's seam 35% above its sketch. The middle estimate is 4.1 KB and the high 4.95 KB.
- **Product verdict.** Same behaviour. Every `createSystem` build grows by about 3.4 to 5.0 KB until the beta: `minimal` to about 38.7 to 40.2 KB.
- **Recommendation.** Approve O1 and a raise with a written reason in each slice: up to +5.0 KB over the post-L9 sizes on `minimal` (40,282 B on L9b's measurement), `two-module` (40,373 B), `aperture` (45,150 B) and `full-entry` (42,551 B), and up to +150 B on `floor` (11,167 B). Do the attribution step first: find the bytes, move cold code, fold the module calls into the per-kind add and remove. L10a reports the seam's bytes and the registry's before L10b starts. Come back if a slice lands above the cap, and before L10b if L10a is on course to.

#### A2 do deep fuzz runs gate L10, or report?

- **What L8 and L9 chose.** "Gate on short seeds; deep runs report".
- **Why L10 is no different.** The new steps reach code the fuzz has never run, so the deep runs will mostly find new shapes of the approved rows and of K4, as at L8.
- **Recommendation.** The gate merges when the 21 PR seeds pass at L10; nightly deep runs report; any case triaged as a real 2.0 bug blocks at once.

#### A3 fuzz-ready before the gate

- **What L8 chose.** L8-pre leaves at most 10 unexplained cases; the gate is capped at 3 runs, then goes to Jason; case files store v2's trace; earlier follow-ups land first.
- **What L10 adds.** The model has no L10 step today, so L10-pre's fuzz work is larger than L9-pre's. Rule 1 (ids from a pool) is the L10-specific brake, and it is B1.
- **Recommendation.** Approve L8's brakes unchanged, with the L9 gate as the precondition.

### Candidate divergences

#### (bl) `assign` with `{ compute, meta }` keeps the derivation readable

- **What 1.35 does.** The registry calls the derivations manager, which unwraps `{ compute, meta }` into a function, and then writes the raw object back over it (`core/engine-definitions.ts:417–419`). Every read, `call` and `meta.derivation` then throws "def is not a function" ("m is not a function" in production), on a dynamic or a static derivation, until a function is assigned (K2, P1b). `register` with the same object works.
- **What 2.0 would do.** Unwrap the object on `assign` as on `register`: the new compute runs, and the new meta replaces the old.
- **Product verdict.** Better, visible: the documented object form works on both calls. No program can depend on the 1.35 behaviour, since every read throws.
- **Recommendation.** Approve, in L10a. The plan already says 2.0 must not copy this bug.

#### (bm) a reader that asked for a name before it existed sees it arrive

- **What 1.35 does.** A derivation or a constraint `when` that asks `"later" in derived`, or reads `derived.later` and gets `undefined`, records no dependency on `later`. When `later` is registered, nothing wakes it: the derivation keeps its old answer even after a write to a fact `later` reads, and the constraint is never evaluated again (I1, P2). Effects already re-run, through quirk (c) and (w).
- **What 2.0 would do.** Record the name's membership key in derivation and constraint frames on a miss, the mechanism effects use today, and mark it changed on register and unregister. Unregistering a name a reader depends on already wakes it in 1.35 (`mutants-derivations` "recomputes and notifies dependents").
- **Product verdict.** Better, rare but silent: the code that was waiting for a late registration sees it. A derivation that asked recomputes once more on that registration.
- **Recommendation.** Approve, in L10a, with U2 and U3 showing the difference.

#### (bn) a subscriber to a name registered later is told

- **What 1.35 does.** `subscribe(["later"], fn)` before `later` exists warns "subscribe: unknown key" in development and never calls `fn`, even after `later` is registered and changes (I2, P2).
- **What 2.0 would do.** Keep the unknown names and attach them on registration.
- **Product verdict.** Better, rare: only code that subscribes before it registers.
- **Recommendation.** Decline. Development already says so at the call, and a pending list costs every build. Pin 1.35 (U4) and revisit with the beta's `subscribe`.

### B. Recommendations the owner may overrule

#### B1 the fuzz steps and harness rules

- **Recommendation.** In L10-pre: a `dynamic: 10` feature, the `register`, `assign`, `unregister` and `call` steps with pooled ids, the module steps, the deferred variant, each with a self-test (rules 1 to 3). They run on 1.35 from L10-pre, and on v2 only once `current` is L10.

#### B2 re-place `dynamic-definitions.test.ts`

- **What the tree does.** All 44 of its tests are placed at L13 by `import flushMicrotasks`, though the file's rule is L10.
- **Recommendation.** In L10-pre, add `instruments: ["import flushMicrotasks"]` to its rule, as `requeue.test.ts` has, regenerate `layers.json`, and list where each test lands. Expected L10, except any that use a later feature.

#### B3 the store's key registration at L10

- **Recommendation.** `$store.registerKeys` and `unregisterKeys` are built in L10b with `registerModule`, which is their only engine caller; the two L9 tests that call `registerKeys` directly move to L10 with L9-pre-a's placement.

#### B4 signing

- **Recommendation.** L10a and L10b sign the entries for approved rows "on the owner's instruction", as at L2, L3, L7, L8 and L9 (GATE-2 rule 1). Declined rows get no entry.

#### B5 the `module-churn` workload

- **Recommendation.** Register and retire a module 100 times while a resolver runs; time and bytes; judged at 1.0 or better against 1.35 at the gate. Approve the shape before L10b.

### C. Engineering defaults that keep parity (no decision needed)

- **The error texts are 1.35's,** in production as in development (D1 to D4, M1, M5).
- **A definition change during a pass is queued**, at most `maxDeferredRegistrations`, and applied after the pass (D5).
- **A static definition cannot be unregistered**; development warns, with 1.35's text, even for an unknown id (D3).
- **A module's definitions are not dynamic** (D9).
- **`registerModule` over a live derivation replaces it**, silently (M2).
- **`unregisterModule`'s teardown order**, its drain, its handling of a throwing `onStop`, and its awaited pass are 1.35's (M6).
- **Unregistering a constraint does not stop its running resolver** (K4), unless L10a's read finds that 1.35 does so in some case P6 did not cover.
- **The trace tolerates a constraint that is gone** (I3); this changes no 1.35 behaviour, since 1.35 reads the hit rows from its own state.
- **`meta.subscribe` is called as 1.35 calls it**, twice for `registerModule` (D6, M3).

## Evidence: probes

**What I ran.** Each command's output went to a file, and I read the files back, not a pipe.

- Forced-L10 runs: the script `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l10/forced.sh` (exit 0; each vitest run exit 1; `current` restored to `"L7"`, package status clean, recorded in `current-forced.txt`). Reports: `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l10/v2.json`, `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l10/v2dist.json` and `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l10/diff.json`, summarised by `summ.js` into `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l10/summ.txt`, with failure lines in `v2-fails.txt`, `v2dist-fails.txt` and `diff-fails.txt` and the L10 messages grouped in `l10-msgs.txt`, all in the same directory.
- Placement: a `node -e` read of `packages/conformance/layers.json` for every test with `layer: "L10"` (`/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l10/l10-tests.txt`, 107 entries), and for `dynamic-definitions.test.ts` (44 tests, all L13, all `import flushMicrotasks`) and `l3-engine-oracle-evict.test.ts` (1, L5).
- Mutation: a `node -e` count over `packages/conformance/mutation-triage/*.json` (`/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l10/mut.txt`); `gh run list --workflow mutation-nightly.yml` (`mut-runs.json`) and `gh run view 43815165003 --log` (`mutlog-43815165003.txt`, exit 0), both in the same directory.
- Size of 1.35: `node measure.mjs <repo> <out>` in `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l10/size/`, exit 0; output in `size.log` beside it, each bundle as `<piece>.min.js`, and the one-stream total in `concat.log`. The script is the L9 RFC's, with the L10 regions. Two fixes from the L9 script: a group of statements with no declarations, and `engine-definitions.ts`'s `isDevelopment`, which the L9 script's `define` did not reach because it is an import (its first run kept the development warnings, and the final run has none: `grep -c console` gives 0).
- Size of core-next: `node scripts/size.mjs --check` in `packages/core-next` (exit 0; `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l10/next-size.log`). L9b's sizes: `git show origin/p9/l9b:size-budgets.next.json`.
- Probes: `node probe.mjs <dist> <out.json>` and `node p1b.mjs <dist>` against `dist/development` and, with `NODE_ENV=production`, `dist/production` of the published `1.35.0`; exit 0 for all four. Source and output: `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l10/probe/probe.mjs`, `out-dev.json`, `out-prod.json`, `p1b.mjs`, `p1b-dev.json` and `p1b-prod.json` in that directory. Development and production gave the same results for every probe, except that production printed no warnings and its mangled name in P1 is `m` where development's is `def`. P1's first form threw at `meta.derivation` and lost its other answers, so P1b repeats it step by step.

**What I read, not ran:** the 1.35 and core-next file and line citations above; K2's cause (that the registry's merged map is the manager's own `definitions`), which P1b's result agrees with; M3's order and M6's teardown order; the seam's three pieces and its 60 to 150 B; I3's hazard (`src/api/reconcile.ts:571`); and the post-L8 base of 32,339 B, taken from L9's cap of 35,339 B.

**Not settled.** Why 1.35 does not abort the resolver of an unregistered constraint (K4): P6 shows that it does not, not which rule keeps its requirement alive. I did not run the re-placed `dynamic-definitions` tests on v2, nor shrink the fuzz failure.

The probes build one module, `m`: facts `a`, `b` and `log`; a derivation `double`; an event `bump`; a requirement `WORK`. Each adds what it needs.

| Probe | Steps | 1.35 |
|---|---|---|
| P1b | `derive.register("tripled", f => f.a * 3)`; `assign("tripled", { compute, meta })`; read, `call`, write `a`, read, `meta.derivation`; assign a function back; the same assign on the static `double`; `register("objreg", { compute, meta })` | Before: 3. After the assign: read, `call`, read after a write and `meta.derivation` all throw "def is not a function" (production "m is not a function"). After a function is assigned back: 6. The static `double` throws the same way. `register` with the object form reads 102, meta `{ label: "Obj" }` |
| P2 | Derivations `reader` (`"later" in derived`), `direct` (reads `derived.later`), a constraint gated on `"later" in derived`, `subscribe(["later"])`; start; register `later`; write `a`; unregister `later` | `reader` "none" and `direct` "v undefined" before, after the register, after the write and after the unregister. The constraint evaluated once, never again; its resolver never ran. The subscriber was never called; development warned "subscribe: unknown key "later"" |
| P3 | Register an existing id, assign a missing one, register `call`, an id with `::`, `__proto__`; unregister a static and an unknown id; call an unknown derivation; after `destroy()`, register and call | "Derivation "double" already exists. Use assign() to override."; "… "ghost" does not exist. Use register() to create it."; "Derivation ID "call" conflicts with a reserved derive method name."; "Definition ID "a::b" cannot contain "::" …"; "Security: Definition ID "__proto__" is a blocked property."; both unregisters return, development warning "Cannot unregister static derivation "double" …" and "Cannot unregister static effect "nope" …"; "Cannot call derivation "nope" — it does not exist."; "Cannot register derivation "x" on a destroyed system."; "Cannot call derivation "double" on a destroyed system." |
| P4 | An effect registers a constraint when `a` is 2; write `a = 2` | Right after the write: not dynamic. Inside the effect: not dynamic, `listDynamic` `[]`. After settling: dynamic, and its resolver wrote "late ran" |
| P5 | `meta.subscribe`; `registerModule` of a module with fact `c` and derivations `double` (over the live one) and `cPlus`; a second module with fact `c`; then `register`, `assign`, `unregister` of `z`; a write | `double` −1, `cPlus` 8; `isDynamic("cPlus")` false, `listDynamic` `[]`. "Schema collision: Fact "c" already exists. Cannot register module "y"." `meta.subscribe` calls: 2 for the module, then 1 each for register, assign and unregister, 0 for the write |
| P6 | Register a constraint whose 30 ms resolver writes `log`; write; unregister the constraint 5 ms later; `constraints.call` of an unknown id and of a registered one | The run was not aborted, finished, and `log` read "done"; `inspect().constraints` empty. "Cannot call constraint "nope" — it does not exist."; `call("c2")` returned the requirement it would add, with `fromConstraint: "c2"` |
| P7 | Single-module: `registerModule` of fact `c`, `unregisterModule("x")`. Namespaced: the same under `x`, then again | Single: `c` 1, then gone (`"c" in facts` false). Namespaced: `facts.x.c` 2, then `facts.x` undefined; the second call: "Cannot unregister module "x": no such module namespace." |
| P8 | `trace` and `history` on; register a constraint and its resolver, which writes `b` | 3 trace runs added, the last hitting `c`; 1 history snapshot added; `b` 9 |

**Reading the table:** P1b is (bl), and P2 is (bm) and (bn). P4, P5 and P6 are the 1.35 answers pinned as U5 to U9, and P3 the texts pinned as U10 and U16.
