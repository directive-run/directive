# RFC: L8 history

Status: draft for review, revision 1. No engine or oracle code merges from this document.
Tree: branch `p8/l8-rfc`, cut from `main` at `5ec52ed3` (L0 to L7 built and gated; `layers.rules.json` `current` is `"L7"`). Nothing in `packages/conformance` or `packages/core-next/src` is changed by this PR.

## What we are building

L8 lets a system record its facts after each pass, and step back and forward through those records.

The plan's row reads "`history()`: goBack/Forward/goTo, replay, export/import, changesets, pause, onNavigate | history, effect-navigation-rerun, navigation-side-effects | +1.3 | opt-in". Jason's Phase 4 answer, "Keep the order (Recommended)" (2026-11-05, the Phase 4 re-plan page), settles the shape: the alphas keep 1.35's API, so history is a part that `createSystem` wires when the 1.35 `history:` setting is on. It becomes an import (`history: history()`) at the beta. His second answer, "Full checks everywhere", gives L8 the full L7 treatment: this design document, the oracle first, the mutation gate, the random tests and two reviewers. Parity with 1.35 is the rule, and when this document and 1.35 disagree, 1.35 wins. Every layer slice runs `conformance:diff` at the forced layer.

**Part of the row is already built.** core-next carried these over at L1 to L6, and L8 reuses them.

| Plan item | State in core-next | Where |
|---|---|---|
| The `history` option's types, `HistoryAPI`, `HistoryState`, `Snapshot` | Built: 1.35's public types, copied | `src/types/`, exported from `src/index.ts:99–101` |
| A module's `history.snapshotEvents`, and its development warnings | Built and passing | `api/module.ts:122–133, 197` |
| `system.restore()`, the store batch it writes in, and the deep prototype check | Built at L6, as the `withRestore` part | `api/restore.ts` |
| The fact-origin switch that files loaded facts as `"hydrate"` | Built; the `"restore"` origin is in the type but nothing produces it | `api/core.ts:991–1052`, `api/types.ts:41` |
| `system.history`, `onHistoryChange` | Stubbed: `history` reads null, and `onHistoryChange` returns a listener nothing calls | `api/missing.ts:50–53` |
| The `history:` option | Warns once in development that it is not built, then is ignored | `api/system.ts:94–109` |
| Effects that wake on a navigation, and `onNavigate: "skip"` | **Not built.** A `TODO(L8)` marks the place | `api/effects.ts:172–176` |
| Snapshots per pass, navigation, export and import, changesets, pause | **Not built** | none |

**Reading the table:** the types, the module option and `restore()` are done. Everything that records or replays a past is not. Today a 2.0 system asked for history runs as if it had none.

**What may differ from 1.35.** Ten new candidates, lettered after (av): (aw) to (bf). Each is built only if Jason approves it. An approved row gets a `divergences.json` entry, signed "on the owner's instruction" (GATE-2 rule 1). A declined row keeps 1.35's behaviour, pinned by a test, with no entry.

**In plain terms:** L8 is one new part, the history manager, plus a seam in the reconcile loop. The seam is the hard part: a navigation must wake effects without dispatching resolvers, must not take a snapshot over the redo stack, and must not re-open a gated source. The probes found seven 1.35 problems a user could notice. A navigation while paused un-pauses. `replay()` and `import()` tell no listener. Snapshot ids collide after an import. Changesets point at the wrong snapshots once the ring buffer drops old ones. An import with a bad index breaks navigation. A snapshot can be rewritten through the public `snapshots` list, or through a fact restored from it. And the "Date, Map and Set corruption" the plan flagged is real, but narrower than the plan says: snapshots keep them; export and import lose them. As at L7, the size is an owner decision (A1). New for L8 is a second decision asked up front (A2): whether the deep random runs gate the layer, or report.

## Gap analysis, measured

Every L8 failure is a missing piece: core-next has no history at all.

What I ran: `layers.rules.json` `current` set to `"L8"` in the working copy only. Then, from `packages/conformance`, `npx vitest run --project conformance:v2 --project conformance:v2:prod`, then `--project conformance:v2:dist`, then `--project conformance:diff`, each with the JSON reporter. Then `git checkout -- layers.rules.json`; `current` read `"L7"` again and `git status` was clean for the package. core and core-next were built first (`pnpm --filter … build`, both exit 0).

| Run | Tests | Pass | Fail | Skipped |
|---|---|---|---|---|
| `conformance:v2` and `conformance:v2:prod`, together, at forced L8 | 3,292 | 1,680 | 55 | 1,557 |
| `conformance:v2:dist` at forced L8 | 3,216 | 1,610 | 54 | 1,552 |
| `conformance:diff` at forced L8 | 369 | 362 | 7 | 0 |

**Reading the table:** the source and the built `dist` fail the same 54 development tests. The source run adds one production test. The diff harness fails the five L8 scenarios, the fuzz, and one fuzz self-test.

| File | Failing | Representative tests |
|---|---|---|
| `snapshot-events` | 15 of 17 | "only creates snapshots for listed events"; "undo reverses only snapshot events"; "history.snapshotModules › intersects with per-module history.snapshotEvents" |
| `navigation-side-effects` | 7 | "a reactive write during a history navigation › does not destroy the redo stack"; "› does not re-attach a gated source"; "› does not carry a navigation made while stopped into a later pass" |
| `effect-reconcile-boundaries` | 6 | "requirements after a history navigation › does not re-dispatch resolvers for the rewound state"; "history with an effect that dispatches › records settled states only, so undo lands on one" |
| `history-clone-integrity` | 6 | "history snapshots never alias live state › does not let a later mutation rewrite a snapshot already taken"; "› names the fact it could not capture" |
| `effect-navigation-rerun` | 4 | "re-runs an effect whose dependency was restored"; "keeps the redo stack intact"; "leaves an onNavigate: "skip" effect alone" |
| `blackbox-facts` | 4 | "facts: history snapshots › keeps Dates and Maps inside objects of a rebuilt array"; "› goes back and forward over a deleted fact" |
| `reconcile-timing-rules` | 4 | "coalescing › gives each awaited write its own pass, effect run and snapshot" |
| `blackbox-effects` | 3 of 4 | "effects after a history navigation › re-runs a mirroring effect and sits out an onNavigate skip one" |
| `l8-system-oracle` | 2 | "zeroConfig and history › turns history on in development when none is asked for"; "history.snapshotModules in a namespaced system › is quiet for entries that name a module" (it hears the "not built yet" warning) |
| `mutants-facts-system` | 2 | "keeps a nested object, Date and Map in history when the fact holds read-back wrappers"; "keeps a cyclic object fact in history" |
| `restore-flush-reconcile` | 1 | "a write made while a restore is flushing › is reconciled, so anything waiting on it still runs" |
| `l8-system-oracle-production` | 1 of 2 | "zeroConfig keeps a history that was asked for, and does not turn one on by itself" (production only, so not in the `dist` run) |
| **Total** | **55** | |

**Reading the table:** almost every failure is the same error: "Cannot read properties of null (reading 'goBack')", or `'snapshots'`. The three biggest files are the snapshot filters, the navigation side effects and the reconcile boundaries. Those three hold the subtle rules.

**What `layers.json` places at L8.** 111 tests, in 18 files. 40 are internals: the 39 in `utils/history.test.ts` and 1 in `sources.test.ts`. v2 skips internals by category (`helpers/layer-gate.ts`), so they are not in the run, and L8-pre adds a `WHITE-BOX.md` bullet for them. Of the 71 black-box tests, 55 fail and 16 pass. The 16 that pass are `createModule`'s `snapshotEvents` checks (12, built with `createModule`), the hydrate check (1, built at L6), and the three below.

**Three placed tests pass without any history. Two of them could not fail for the reason they are named for.**

- `system.test` "Config Forwarding › history config forwarded (boolean)" and "(object)" (`tests/core/system.test.ts:934–945` and the case after it) assert `expect(system.history).toBeDefined()`. On v2 `system.history` is `null`, and `null` is defined. L8-pre makes them bite (U15).
- `blackbox-effects` "an onNavigate skip effect still runs for a real change" passes because nothing navigates. It tests something real, that a skip effect still runs for an ordinary write, and it starts to bite once L8a builds the skip.

| Failing diff test | Why |
|---|---|
| "history: back, forward and effects re-run on navigation" (36 differences) | v2 has no snapshots, so the `back` op throws on null and no `onSnapshot` or `onHistoryNavigate` hook fires |
| "history: export, import and changesets" (32) | The same |
| "history goTo a snapshot id, then replay" (32) | The same |
| "history pause and resume skip snapshots while paused" (27) | The same |
| "onNavigate rerun vs skip on goTo, and onHistoryChange" (50) | The same |
| The fuzz, "random systems trace identically on every engine" | It now draws history cases. Seed 24301 shrinks to one module, `history: true` and one dispatch: 1.35 takes a snapshot, v2 does not |
| The self-test "the fuzzer catches injected faults › drops one requirement.created observe event" | The case it injects into now draws history, so the first difference it reports is history's, not the dropped event |

**Reading the table:** the five scenarios are the L8 diff oracle. The last two rows are the L7 lesson arriving early. The fuzz model already reaches history, so the random tests will be in the gate whether we plan for them or not. "The fuzz, designed in up front" below says what they reach and what they need.

**The mutation gate.** A `gate: L8` run of `mutation-nightly.yml` is in progress (`gh run view 42771832833`, started 2026-11-10 06:56Z). When this was written, 9 of its 12 shards had passed (l3-rest, l3-system, l5-sources, l6-hydration, l6-introspection, l9-trace, l10-dynamic, l11-predicate, l11-rest) and 3 were still running (l1-state, l2-resolvers, l3-engine). **Result: pending.** The score (`pnpm --filter @directive-run/conformance exec tsx scripts/mutation-score.ts --gate L8 <reports>`, `MUTATION.md`) and any debt entries go here when it finishes; debt becomes L8-pre work. The triage files already name L8 in 186 entries. 67 of them, in `mutation-triage/engine.json`, are `feature-layer` L8: history's per-pass bookkeeping and navigation write records. At the L8 gate they convert to gated, each with its killer from the gate run, as L7's 15 did.

## The design: each 1.35 rule, the mechanism that keeps it, and its pin

Where a row says "verified", a probe ran it against the published 1.35 (`packages/conformance/node_modules/directive-v1`, the `conformance:v1` pin, `1.35.0`), in development and production, with real timers. The output is under "Evidence". The rest is read from the code. 1.35 line numbers are in `packages/core/src/`, read from the workspace source. The published development bundle carries the same functions (`createHistoryManager`, `withRestoreOrigin`, `withNavigation`, `refreshLatestSnapshot`, the four clone tiers, "cannot be captured in history", `onNavigate !== "skip"`).

### Where it lives, and why "opt-in" means run time, not bytes

**In plain terms:** 1.35 reads `history:` off the options with no import, so the code that handles it has to be in every system `createSystem` builds. What can be opt-in is the work: a system with history off runs none of it.

| Option | Keeps 1.35's API? | Who pays the bytes |
|---|---|---|
| **O1. A part wired by `createSystem`** (`withHistory`, like `withBatch` at L7 and `withRestore` at L6) | Yes | Every `createSystem` build. `floor` and `createSystemCore` pay only the seam |
| O2. A separate import (`history: history()`, the plan's form) | No: a 1.35 program's `history: true` would stop recording | Only programs that import it. This is the beta |
| O3. A chunk loaded the first time `history:` is seen | No in practice: the load is async, and 1.35 takes its first snapshot in the first pass after `start()` (H11) | Only programs that use it, after a delay |

**Reading the table:** O1 is the only option that keeps the alpha rule, and it is what Jason chose. O2 is the beta. O3 would lose the first snapshot.

**The mechanism, under O1.** The core keeps one seam: a `history_` slot on the part context, read once per pass where 1.35 takes its snapshot (`core/engine.ts:1842–1877`). `withHistory` fills it. It owns the ring buffer, the clone, navigation, changesets, export and import, and pause. The navigation rules that touch the reconcile loop stay in the core, because they decide what a pass does: the write counting that tells a navigation's reactions from ordinary work, the restored keys that wake effects alone, and the gated-source skip. They cost the core a few branches and are dead with the slot empty. A navigation writes through the core's origin switch with a new `"restore"` origin, as 1.35's manager does through `withRestoreOrigin` (`core/engine.ts:725–732`).

**Opt-in at run time.** With history off, `withHistory` creates no buffer and no listener set, the slot stays empty, and the seam is one read per pass. Two paths turn history on: the option, and `zeroConfig` in development (`core/system.ts:926–933`, verified H13). The second means every `zeroConfig` app runs the part in development. Production bytes are the same either way.

### Taking snapshots

**In plain terms:** after each pass that changed a fact, 1.35 copies every fact into a ring buffer of 100.

| # | 1.35 rule | 2.0 mechanism | Pinned by |
|---|---|---|---|
| T1 | A pass that saw fact writes takes one snapshot, before its effects run. The label is `facts-changed:` and up to five keys, then `+N more` (`core/engine.ts:1866–1874`). The first snapshot is taken in the first pass after `start()`, with the init facts. Two writes in one tick give one snapshot. Verified, H11: one snapshot after start, labelled `facts-changed:n,d,m,s,email`; two synchronous writes gave one more; an event gave one more. | The same, through the seam. | `reconcile-timing-rules` (4); U13 |
| T2 | Filters. A module's `history.snapshotEvents` limits which of its events snapshot; a direct write always does (`core/engine.ts:423–440`). The system's `history.snapshotModules` limits which modules' events do, and warns in development for an unknown name or a single-module system (`core/system.ts:239–280, 1118–1122`). | The same; the event set is built once, at `createSystem`. | `snapshot-events` (17); `l8-system-oracle` |
| T3 | Writes an effect makes finish the pass that caused them. They are folded into that pass's snapshot (`refreshLatestSnapshot`, `core/engine.ts:1856–1860`; `utils/history.ts:396–405`), so undo lands on a settled state. | The same. | `effect-reconcile-boundaries` "records settled states only" |
| T4 | The ring buffer holds `maxSnapshots`, 100 by default (`utils/history.ts:139–154, 386–390`). A snapshot taken after a `goBack` cuts off every snapshot ahead of it (`377–380`). | The same. | `utils/history` internals; U7 |
| T5 | The clone has four tiers: `structuredClone` of the whole object; then per key; then per key after unwrapping the development proxies; then `JSON.parse(JSON.stringify(…))`. A key that fails all four is left out, with one warning per key per process (`utils/history.ts:229–304`). Verified, H1 in production: a Date, a Map and a Set survive a snapshot and a `goBack`. Verified, H3: when one fact holds a function, every key takes the per-key path, and a fact holding `{ when: Date, cb: fn }` falls to JSON, so its Date comes back as a string and its function is gone. A class instance comes back as a plain object in every tier. | The same tiers. With (ax): the last tier keeps Date, Map and Set. | `history-clone-integrity` (6); `mutants-facts-system` (2); `blackbox-facts` (4); U2 |
| T6 | `redactSnapshot` runs before the clone. If it throws, the raw facts are stored, with a warning (`utils/history.ts:218–227`). Verified, H14: a `goBack` writes the redacted value into the live fact, so `email` became `"[REDACTED]"`. | The same. | `utils/history` internals; U11 |
| T7 | While paused, `takeSnapshot` stores nothing and returns `{ id: -1 }` (`utils/history.ts:366–368`). | The same. | diff "history pause and resume …" |
| T8 | The stored snapshots are shared. The `snapshots` getter copies the list, not the snapshots (`utils/history.ts:357–359`), and a restore writes the stored values into the live facts (`338`). Verified, H4: setting `snapshots[0].facts.n = 99` rewrote history, and `goTo` restored 99. Verified, H4b: after a `goBack`, changing the live fact in place changed the stored snapshot too. | Without (bd): copied. With (bd): restore writes copies, and each stored snapshot is frozen. | U3 |

**Reading the table:** T5 is the plan's "corruption" claim, and it is narrower than the plan says. Snapshots keep Dates, Maps and Sets. They are lost in two places: the JSON tier, which needs a fact that mixes them with something uncloneable, and export (E1). T8 is the one that matters more. The clone code says a snapshot must never alias live state, because then "time travel shows a past that never happened" (`utils/history.ts:242–252`). The read path and the restore path both alias it.

### Navigating

**In plain terms:** a navigation writes a stored snapshot back into the facts. Effects that mirror state run again. Nothing that acts on the outside world runs again.

| # | 1.35 rule | 2.0 mechanism | Pinned by |
|---|---|---|---|
| N1 | `goBack(steps)` and `goForward(steps)` stop at the ends, and do nothing when the index does not move (`utils/history.ts:429–492`). | The same. | `utils/history` internals; diff "back, forward …" |
| N2 | `goTo(id)` with an unknown id warns "Snapshot N not found", in production too (verified, H16). `goTo` the current id restores it and fires the navigate hook from N to N (verified, H6), where `goBack` at the start does nothing. | The same (C list). | `utils/history` internals; U5 |
| N3 | `replay()` jumps to snapshot 0 and restores it. It tells no listener: no `onHistoryNavigate`, no `onHistoryChange` (`utils/history.ts:512–521`; verified, H6). It does not play the timeline. | Without (az): copied. With (az): it tells both, as `goTo` does. | diff "goTo a snapshot id, then replay"; U5 |
| N4 | A restore checks the data's prototype safety (console.error and skip), then writes the snapshot's keys in one store batch, inside the restore origin. A dangerous key warns and is skipped (`utils/history.ts:307–342`). **A key missing from the snapshot keeps its current value.** Verified, H12: a fact first set after the snapshot was still `"x"` after going back to it. | The same, through `withRestore`'s write path and the `"restore"` origin. Without (bf): copied. | `blackbox-facts` "goes back and forward over a deleted fact"; U10 |
| N5 | **A restore clears the pause.** It sets `paused` for the restore and sets it false after, whatever it was before (`utils/history.ts:414–426`). Verified, H5: `pause()`, then `goBack()`: `isPaused` read false, and the next write took a snapshot. | Without (ay): copied. With (ay): the pause the user set survives. | U4 |
| N6 | The restored keys skip the changed set. They wake effects, except those with `onNavigate: "skip"`. Constraints do not see them as changed. Requirements are rebuilt without dispatching. The pass takes no snapshot and re-attaches no gated source (`core/engine.ts:780–790, 1906–1966`; `core/effects.ts:1307–1331`). | The same, in the core: the restored keys are a second key set for the pass, and effects are asked once for each (the `TODO(L8)` at `api/effects.ts:172`). | `effect-navigation-rerun` (4); `effect-reconcile-boundaries` (6); `blackbox-effects` (4); `sources` internals (1) |
| N7 | A write a listener makes during a navigation is the program's own. It reconciles, but its pass takes no snapshot and re-attaches no gated source. The rule is counted per write, not per key, so an ordinary write in the same pass still snapshots. A navigation made while stopped is not carried into a later pass (`core/engine.ts:749–797, 861–868`). | The same counters, in the core. | `navigation-side-effects` (7); `restore-flush-reconcile` (1) |
| N8 | An effect re-run by a navigation that dispatches an event warns once in development, naming the effect (`core/engine.ts:2337`). | The same string. | `effect-reconcile-boundaries` "warns when it dispatches" |
| N9 | Hooks. `onSnapshot` and the `onHistoryChange` listeners after each snapshot; `onHistoryNavigate(from, to)` and the listeners after each `goBack`, `goForward` and `goTo` (`core/engine.ts:1614–1631`). | The same, through the plugin hooks core-next already names. | diff "onNavigate rerun vs skip on goTo, and onHistoryChange" |
| N10 | Changesets. `beginChangeset` records the current index. `endChangeset` records the range, if a snapshot was taken in it. `goBack` inside a range jumps to its start; `goForward` inside or at its start jumps to its end (`utils/history.ts:429–492, 592–609`). Verified, H9b: `goBack(2)` from inside a range lands on its start; the second step is dropped. Verified, H8: a range keeps its indexes when the ring buffer drops old snapshots, so with `maxSnapshots: 4` an undo from `n = 6` went to `n = 4`, skipping `n = 5`, which no changeset grouped. | Without (bb) and (be): copied. With (bb): ranges move with the buffer, and are dropped when cut off. With (be): a range counts as one of the steps. | diff "export, import and changesets"; U7, U8 |

**Reading the table:** N6 and N7 are the heart of L8, and the oracle covers them well: 17 tests in three files. N5 and N10 are the user-visible problems. A debugger that pauses recording and then steps back starts recording again. An undo after the buffer fills can jump two steps.

### Export, import and the surface

**In plain terms:** export turns the whole history into JSON. Import reads it back. `system.history` is the manager itself, with more on it than the type says.

| # | 1.35 rule | 2.0 mechanism | Pinned by |
|---|---|---|---|
| E1 | `export()` is `JSON.stringify({ version: 1, snapshots, currentIndex })`, with the redacted facts (`utils/history.ts:523–529`). JSON loses types. Verified, H2: after an export and an import, a Date fact was a string, and a Map and a Set were `{}`. The plan's frozen contracts include a golden file for the export: 2.0 reads 1.35's, and 1.35 reads 2.0's. | Without (aw): copied, byte for byte. | `utils/history` internals; the golden file; U1 |
| E2 | `import()` checks the version, the list, each snapshot's fields and prototype safety. On a failure it logs "Failed to import history data" and changes nothing (`utils/history.ts:531–590`). It does not check `currentIndex` against the list. Verified, H15: an import with `currentIndex: 99` left the index at 99 and the facts unchanged, and a `goBack` then moved to 98, with nothing to restore. | Without (bc): copied. With (bc): an index outside the list fails the import like any bad field. | U9 |
| E3 | `import()` replaces the snapshots and restores the current one. It keeps the old changesets, and it does not move the next id (`196`). Verified, H7: after importing ids 1 to 4, the next snapshot was id 2 again, and `goTo(2)` went to the imported one. | Without (ba): copied. With (ba): the next id follows the highest imported id. (bb) drops the old changesets. | U6 |
| E4 | `import()` tells no listener (verified, H6). | Without (az): copied. With (az): it tells both. | U5 |
| S1 | `system.history` is null without the option (`core/engine.ts:2605`), and with `history: false`. `zeroConfig` turns it on in development only (verified, H13). | The same. `withMissing` stops setting `history` and `onHistoryChange`, and the "not built yet" warning goes. | `l8-system-oracle` (2); `l8-system-oracle-production` |
| S2 | `system.history` is the manager. Beyond `HistoryAPI` it carries `takeSnapshot`, `restore`, `refreshLatestSnapshot`, `isEnabled` and `isRestoring` (verified, H10). A manual `takeSnapshot("manual")` works. | The same members. L6 moved `history.restore` here. Whether the beta's `history()` keeps them is a beta question. | U12 |
| S3 | `onHistoryChange(listener)` returns an unsubscribe. With history off, nothing calls the listener (`core/engine.ts:4343–4348`). | The same; today's stub already returns one. | diff "onNavigate rerun vs skip …" |

**Reading the table:** E1 and E3 are where history leaves the process, and both lose something. S2 matters for parity: a devtools panel can call `history.takeSnapshot`, and 2.0 must keep it working in the alphas.

### The fuzz, designed in up front

**In plain terms:** the L7 gate took ten runs because the random tests kept finding new shapes at the gate. For L8, the reach and the harness rules are settled before the build starts.

The fuzz model already places `history` at L8 (`diff/fuzz/model.ts:184`). A spec turns it on with `maxSnapshots: 20` (`1284`), and `back` and `forward` steps navigate one step (`1415–1425`). Modules can hold Date facts (`70`, `228`). So from the day `current` is L8, every PR fuzz run compares history on both engines.

| History behaviour | The model reaches it today? | What L8-pre adds |
|---|---|---|
| Snapshot per pass, its label, the `onSnapshot` hook (T1, T3) | Yes | Nothing |
| One-step `goBack` and `goForward`, with effects, constraints and sources (N1, N6, N7) | Yes | `steps` from 1 to 3 |
| Navigation while a resolver or a batch is in flight | Yes, by chance | Hand pins first (U14), and `when` triggers `navigated` and `navigatedBusy` |
| Date facts across a navigation (T5) | Yes | Nothing |
| `goTo`, `replay` (N2, N3) | No | Two ops; `goTo` picks a snapshot by position, read on each engine |
| Export and import (E1 to E4) | No | A `roundtrip` op: export, then import into the same system |
| Changesets, pause and resume (N5, N10) | No | Four ops |
| The ring buffer dropping snapshots (T4, N10) | Rarely: 20 is more than most cases write | Draw `maxSnapshots` from 3, 5 and 20 |
| `snapshotEvents`, `onNavigate: "skip"` (T2, N6) | No | A module option and an effect option |
| `onHistoryChange` and the history's own state | No: only hooks are recorded | A `history` record after each history op: index, length, ids, `isPaused`, and the listener count |
| Uncapturable facts, Map and Set, `redactSnapshot`, `zeroConfig` | No | Not added: functions do not compare by value. Hand pins cover them |

**Reading the table:** the model reaches the riskiest part today, navigation mixed with in-flight work, and none of the bookkeeping. L8-pre adds the bookkeeping ops, so the random tests see every candidate before the build, not at the gate.

**Harness rules, decided now.** Each comes from an L7 run.

1. **Triggers and classes ship with the oracle.** L7 run 2 stopped because the harness had no batch `when` triggers or `$like` classes. L8-pre adds a `when` trigger and a `$like` class for each approved L8 row, each with a self-test, before L8a starts.
2. **The L7 rules carry over unchanged.** The shared wait, the never-settles discard at max(1% of cases, 3), "Discard after the stop", the `moved` op and batch report mode apply to history cases as they are. A navigation is not a settle step, so the shared wait does not run at it.
3. **Hand pins come before random combinations.** U14 pins 1.35's navigation during a running resolver, a queued batch and a running batch, by hand. Until those pins land, the model draws no navigation while work is in flight.
4. **Snapshot timestamps are compared by order, not value.** They come from `Date.now`, and the two engines' fake clocks can end a wait at different times (L7 run 5, seed 4).
5. **Approved (as) differences reach history records.** With (as), 2.0's `settle()` waits for a batch, so a snapshot the batch's write takes lands on the other side of a settle checkpoint. L8-pre writes the (as) `moved` twins for `onSnapshot` up front.
6. **A history fault must be caught.** L8-pre adds a tamper self-test that drops one `onSnapshot` and one that sends a `goBack` one step too far. It also fixes the existing self-test that now draws a history case (U16).
7. **The build slices run the forced-L8 fuzz.** L8a and L8b each run the 21 PR seeds at forced L8 locally, and list every failure in the PR. L8b also runs the deep seeds at forced L8 in report mode, to the end of each seed. L7 learned at its tenth run that report mode had seen only the first failure per seed: there were 42, not 3.

Whether the deep runs gate L8 is decision A2.

## Untested behaviours, and what will pin each

**In plain terms:** 16 behaviours have no pin on either engine. Thirteen came from the probes. Three came from the forced-L8 run and from reading the code. Each needs a pin before the slice that could break it. "Conformance" means a test that runs on v1 and v2; "diff" means a scenario the diff harness runs on both.

| # | Behaviour | Evidence | Pinned by | Slice |
|---|---|---|---|---|
| U1 | Export and import turn a Date into a string, and a Map and a Set into `{}` | H2 | A conformance test; shows (aw) if approved | L8-pre |
| U2 | A fact that mixes a Date with a function falls to the JSON tier: the Date becomes a string, the function is dropped. A class instance loses its prototype in every tier | H3 | A conformance test; shows (ax) if approved | L8-pre |
| U3 | A stored snapshot can be changed through `snapshots`, and through a fact restored from it | H4, H4b | A conformance test with both paths; shows (bd) | L8-pre |
| U4 | A navigation clears a pause, and the next write takes a snapshot | H5 | A diff scenario; shows (ay) | L8-pre |
| U5 | `replay()` and `import()` tell no listener; `goTo` the current id does | H6 | A diff scenario that records the `onHistoryChange` count; shows (az) | L8-pre |
| U6 | Snapshot ids repeat after an import, and `goTo` finds the first | H7 | A conformance test; shows (ba) | L8-pre |
| U7 | Changesets keep their indexes when the buffer drops snapshots, when a new snapshot cuts off redo, and across an import | H8; read from `utils/history.ts:377–390, 578–580` | A diff scenario with `maxSnapshots: 4`; shows (bb) | L8-pre |
| U8 | `goBack(2)` from inside a changeset lands on its start | H9b | A conformance test; shows (be) | L8-pre |
| U9 | An import with `currentIndex` outside the list is accepted and breaks navigation | H15 | A conformance test; shows (bc) | L8-pre |
| U10 | Going back leaves a fact the snapshot did not hold at its current value | H12 | A conformance test; shows (bf) if approved | L8-pre |
| U11 | With `redactSnapshot`, a navigation writes the redacted value into the live fact | H14 | A conformance test, and a docs follow-up | L8-pre |
| U12 | `system.history` carries `takeSnapshot`, `restore`, `refreshLatestSnapshot`, `isEnabled` and `isRestoring` | H10 | A conformance test on the members and one manual `takeSnapshot` | L8-pre |
| U13 | The first snapshot is taken after `start()`, labelled with the init keys | H11 | A diff scenario | L8-pre |
| U14 | A navigation while a resolver runs, while a batch is queued, and while a batch runs | not probed; read from `core/engine.ts:1906–1966` | Hand probes on the published 1.35, then a diff scenario for each | L8-pre |
| U15 | `system.test` "history config forwarded (boolean)" and "(object)" assert `toBeDefined()`, which `null` passes | the forced-L8 run; `tests/core/system.test.ts:934–945` | Each asserts `system.history` is not null, and one `goBack` lands (an oracle change) | L8-pre |
| U16 | The fault-injection self-test fails at forced L8, because its case now draws history | the forced-L8 run; `diff/self/tamper.test.ts:558` | Pin the self-test's case to a spec without history, or make it expect history's difference | L8-pre |

**Reading the table:** U1 to U10 are where the candidates live. Each pins 1.35's behaviour now and shows the difference only with an approved, signed entry. U11 is not a candidate: a restore cannot tell a redacted value from a real one, so the fix is a sentence in the docs. U14 is the L7 lesson in table form: pin the hard combinations by hand before the random tests find them.

## Performance

**In plain terms:** history off costs one read per pass. History on copies every fact after every pass, as 1.35 does.

I did not run the bench for this RFC: no L8 code exists, and the L7 numbers stand. What L8 must keep, and what it adds:

- With history off, no workload slower than `main` by more than 5% after any L8 slice.
- 1.35 clones every fact on every snapshot (`store.toObject()`, then `structuredClone`, `utils/history.ts:206–236`), so a pass costs time in proportion to all the facts, not the changed ones. L8 keeps that: it is parity, and the plan's "fact versions with structural sharing" is the beta's answer to it.
- L8a adds a `history-undo-100` workload (B2): 100 writes with history on, then 100 `goBack` calls. Time and bytes. The L8 gate judges it at 1.0 or better against 1.35.
- 1.35 searches the changeset list on every `goBack` and `goForward` (`Array.find`, `utils/history.ts:436–449, 475`). (be)'s step loop does the same work once per step. With few changesets, neither matters.

## Slice plan

**In plain terms:** an oracle slice, two build slices and the gate, as at L7. Each build slice is one PR at the committed `current`, tested at a forced L8 locally.

| Slice | Builds | Done means (checkable) | Tier |
|---|---|---|---|
| Precondition | The `gate: L8` mutation run (42771832833) finishes. | The L8 layer gate reports PASS, or its debt entries are listed as L8-pre work. | test oracle; coordinator |
| L8-pre (oracle) | U1 to U16. The two vacuous tests made to bite (U15). The fuzz additions (B1) and the harness rules 1 to 6 above, each with a self-test. A `WHITE-BOX.md` L8 bullet for the 39 internals tests in `utils/history.test.ts`. Any mutation debt. | The new tests pass on `conformance:v1` and `v1:prod`, and on v2 fail only as this document predicts. `conformance:diff` at forced L8 fails only the five L8 scenarios, the fuzz and the new U-scenarios. The new fuzz ops run on 1.35 from L8-pre, and on v2 only once `current` is L8. `pnpm census`, `check:expects` and `oracle:update` exit 0. `oracle-change` label. | test oracle; Sonnet implementer, Fable correctness reviewer |
| L8a | The seam in the core and the `withHistory` part, wired by `createSystem` (O1): T1 to T8, N1 to N10, E1 to E4, S1 to S3. (ay), (az), (ba), (bc) and (be) if approved, because they change the same lines. `history-undo-100` (B2). Signed entries for approved rows. | At forced L8 on v2, v2:prod and v2:dist: the 55 failures pass, except those that pin an approved row, each listed by file and title. `conformance:diff`: the five L8 scenarios match 1.35, or differ only by signed entries. The 21 PR fuzz seeds at forced L8 pass, or every failure is listed with its row. Census and ratchet exit 0. core-next `test`, `typecheck`, `build` and `size:check`, with the exact development-string count. Sizes within A1; the PR reports the part's bytes, the seam's bytes and the beta-wiring line. | core; Opus implementer, Sonnet diff reviewer plus Fable correctness reviewer |
| L8b | (bb) and (bd), and (aw), (ax) and (bf) only if approved. Their signed entries. | U3 and U7 differ from 1.35 only by signed entries; U1, U2 and U10 likewise if approved. The deep seeds at forced L8 run in report mode to the end of each seed, and every reported case is listed with a first triage. Plus L8a's checks. | core; as L8a |
| L8-gate | `current` to L8, `ratchet --update`, diff and fuzz at L8, the 67 feature-layer triage entries converted, `GATE-7.md`, `/principal` on L8. | 0 L8 failures on v2, v2:dist and v2:prod. The census exits 0. PR fuzz passes at L8. The nightly follows A2. | test oracle; Sonnet plus the coordinator's read of each entry |

**Reading the table:** L8a carries the size and almost all the behaviour. L8b carries the two fixes that change how history is stored, so each lands with its own diff evidence. Every entry lands signed. The signing waits for Jason's approval of this RFC.

## Size

**In plain terms:** every `createSystem` build pays for history until the beta, and every fixture is within a few bytes of its budget.

Measured with `node scripts/size.mjs --check` in `packages/core-next` on this branch (production, minified, gzip level 9; exit 0).

| Fixture | core-next now | Budget | Room |
|---|---|---|---|
| `minimal` | 29,912 B | 29,914 B (L7's allowance ended at 29,933 B) | 2 B |
| `two-module` | 30,003 B | 30,005 B | 2 B |
| `floor` | 10,446 B | 10,450 B | 4 B |
| `aperture` | 34,805 B | 34,807 B | 2 B |
| `full-entry` | 32,154 B | 32,161 B | 7 B |
| `minimal`, beta wiring (only the parts it uses) | 25,321 B | reported, not budgeted | |

**Reading the table:** there is no room. Any L8 byte needs A1. The beta-wiring line shows what the beta saves today: `minimal` without the setting-wired parts is 4,591 B smaller.

| Piece | How measured | gzip |
|---|---|---|
| 1.35's history manager (`utils/history.ts`, its two imports external) | Bundled and minified with esbuild 0.27.3, gzip 9 | **1,869 B** measured (4,583 B minified) |
| 1.35's whole history feature, inside the Aperture build | Removed and re-measured, in the coresize notes; quoted on the Phase 4 page | **1.3 KB** measured |
| What rebuilt layers cost against 1.35's | The Phase 4 page: 0.55 to 0.8; batching was 1.07 KB against 2.0 KB | ratio |
| L8a in core-next: the part, the seam, parity | Reasoned: 0.6 to 1.0 of the 1.3 KB. The top of the range is no reuse at all. It reuses `withRestore`'s write path, the deep prototype check and the origin switch | **+0.8 to 1.3 KB** (estimate) |
| (ay) keep the pause | Reasoned: save and put back one flag | about 5 B |
| (az) replay and import tell listeners | Reasoned: two calls to the existing notify | +10 to 20 B |
| (ba) ids continue after an import | Reasoned: one max over the ids | +10 to 20 B |
| (bb) changesets follow the buffer | Reasoned: shift or drop on each drop, clear on import | +40 to 80 B |
| (bc) import checks the index | Reasoned: one more check, and a message | +15 to 30 B |
| (bd) no aliasing | Reasoned: a copy on restore, and two `Object.freeze` calls per snapshot | +20 to 40 B |
| (be) a changeset is one step | Reasoned: one step loop replaces three searches | −20 to +20 B |
| (aw) export keeps Date, Map and Set | Reasoned: an encoder and a reviver | +120 to 200 B |
| (ax) the JSON tier keeps Date, Map and Set | Reasoned: a walk; it can share (aw)'s encoder | +80 to 150 B |
| (bf) going back clears facts the snapshot lacked | Reasoned | +20 to 40 B |
| The seam in `floor` | Reasoned: the slot read and the navigation counters | +10 to 40 B |
| **Every `createSystem` build, the recommended set** | L8a plus (ay), (az), (ba), (bb), (bc), (bd) and (be) | **+0.9 to 1.5 KB**, so `minimal` to about 30.8 to 31.4 KB |
| The same, with (aw), (ax) and (bf) as well | | +1.1 to 1.9 KB |

**Reading the table:** the plan's +1.3 KB is 1.35's own cost, inside the range. The candidates I recommend add up to about 0.2 KB. The three I recommend deferring would add up to 0.4 KB more, to every app, for cases 1.35 already warns against.

**What the estimate rests on.** Two figures are measured: the 1,869 B manager, and the 1.3 KB removal figure. The 0.55 to 0.8 ratio is measured on three earlier layers. Reuse is a plan. If the navigation seam cannot share the core's existing origin switch and effect index, the cost moves toward the top of the range. L8a reports the part's bytes and the seam's bytes separately, because the seam is the cost every build pays.

**Under "Keep the order".** Every `createSystem` build carries history until the beta: about +0.9 to 1.5 KB, history on or off. At the beta, history becomes an import. The beta-wiring line then gains only the seam: `minimal` about 25,321 to 25,361 B, against 25,321 B today.

## What the plan got wrong, or left out

- **"Opt-in" cannot mean bytes in the alpha.** 1.35 reads `history:` with no import, so the code is in every `createSystem` build. Only the run time is opt-in.
- **"Corrupting Date/Map/Set" is half right.** Snapshots keep them: the whole-object `structuredClone` succeeds (H1). They are lost in export and import (H2), and in the JSON tier, which needs a fact that mixes them with a function (H3). 1.35 also warns in development that a Date, Map or Set fact is not supported ("Facts must be JSON-roundtrippable"). And in 1.35 development, a Date fact's own methods throw ("this is not a Date object"), with or without history: that is a dev-proxy matter, logged as a follow-up, not L8.
- **The worse aliasing is not the clone.** The public `snapshots` list and every restore share the stored objects (T8, H4, H4b). That is (bd).
- **"replay" does not replay.** It jumps to the first snapshot and tells no listener (N3).
- **`zeroConfig` turns history on in development** (S1, H13). Every `zeroConfig` app runs history while it is being built.
- **`system.history` is wider than `HistoryAPI`.** It carries five more members, and a devtools panel can call them (S2).
- **The representative tests are a small part of the oracle.** `history` is 39 internals tests v2 does not run. `effect-navigation-rerun` (4) and `navigation-side-effects` (7) are two of 12 failing files. The largest is `snapshot-events`, with 15.
- **The random tests already reach history.** The fuzz model placed it at L8 long ago, so the fuzz fails at forced L8 today. L8 has to plan for it from the start.
- **Two placed tests prove nothing on v2 today** (U15).

## Decisions for the owner

**Questions for Jason.** Eight answers settle L8. The table after them gives each a product verdict, so Jason can bulk-approve.

1. **A1, the L8 size.** History as a `withHistory` part wired by `createSystem` (O1), with `minimal`, `two-module`, `aperture` and `full-entry` each allowed up to +1.5 KB over pre-L8, and `floor` up to +40 B. **Recommend: approve.**
2. **A2, do deep fuzz runs gate L8, or report?** Asked now, before the build. **Recommend: "Gate on short seeds; deep runs report".**
3. **(ay), (az), (ba), (bc) and (be), the small fixes.** **Recommend: approve all five.**
4. **(bb), changesets follow the buffer.** **Recommend: approve.**
5. **(bd), no aliasing.** **Recommend: approve.**
6. **(aw) and (ax), Date, Map and Set in export and the JSON tier.** **Recommend: defer to the beta's versioned export.**
7. **(bf), going back clears what the snapshot lacked.** **Recommend: decline.**
8. **B1 to B3, and signing.** **Recommend: approve.**

A "no", or no answer yet, means the slice keeps 1.35's behaviour, pins it with a core-next test, and writes no entry.

| Decision | Product verdict | Recommendation |
|---|---|---|
| **A1** history lives in a part wired by `createSystem`, and the L8 budgets | Same behaviour; every `createSystem` build grows by an estimated 0.9 to 1.5 KB | Approve: up to +1.5 KB on four fixtures, +40 B on `floor`; come back above that |
| **A2** deep runs report, short seeds gate | No behaviour change; decides when L8 can merge | "Gate on short seeds; deep runs report" |
| **(aw)** export and import keep Date, Map and Set | Better, rare: only apps with such facts, which 1.35 warns against. Changes the export golden file | Defer to the beta's versioned export |
| **(ax)** the JSON tier keeps Date, Map and Set | Better, rare: a fact must mix one with a function | Defer, with (aw) |
| **(ay)** a navigation keeps a pause | Better, small change | Approve, in L8a |
| **(az)** `replay()` and `import()` tell listeners | Better, visible: a history panel built on `onHistoryChange` updates after them | Approve, in L8a |
| **(ba)** snapshot ids continue after an import | Better, small change | Approve, in L8a |
| **(bb)** changesets follow the buffer, the redo cut and import | Better, visible: an undo after the buffer fills no longer skips a step | Approve, in L8b |
| **(bc)** an import with a bad index fails | Better, small change | Approve, in L8a |
| **(bd)** stored snapshots are not shared with live facts or the `snapshots` list | Better, visible: code that edits a snapshot in place now throws in strict mode, where 1.35 silently rewrote history | Approve, in L8b |
| **(be)** a changeset counts as one of the steps | Better, small change | Approve, in L8a |
| **(bf)** going back clears facts the snapshot lacked | Better for undo, risky: a redactor that deletes keys would clear live facts | Decline; revisit with fact versions at the beta |
| **B1** the fuzz additions and harness rules, in L8-pre | No behaviour change | Approve |
| **B2** a `history-undo-100` workload judges the L8 gate | No behaviour change | Approve the shape before L8a |
| **B3** signing: L8a and L8b sign entries for approved rows on the owner's instruction | No behaviour change; the census needs signed entries | Approve |

### A. Decisions

#### A1 where history lives, and the L8 budgets

- **What 1.35 does.** `history:` works with no import. The manager and its wiring are in every system.
- **What 2.0 would do.** A `withHistory` part wired by `createSystem`, like `withBatch` (L7, A1) and `withRestore` (L6, B6). `floor` and `createSystemCore` carry only the seam. At the beta, `history: history()` replaces the setting, and apps that do not import it drop the part.
- **Product verdict.** Same behaviour. Every `createSystem` build grows by an estimated 0.9 to 1.5 KB, with or without history, until the beta: `minimal` to about 30.8 to 31.4 KB. The beta-wiring line moves by the seam alone, 0 to 40 B.
- **Recommendation.** Approve O1, and a raise with a written reason in each slice: up to +1.5 KB over pre-L8 on `minimal`, `two-module`, `aperture` and `full-entry` (`minimal` at most 31,412 B), and up to +40 B on `floor` (at most 10,486 B). Do the attribution step first: find the bytes, move cold code, fold duplicates. Come back if the measured size passes the cap. If (aw) and (ax) are approved too, the cap would need about +1.9 KB.

#### A2 do deep fuzz runs gate L8, or report?

- **What happened at L7.** The gate took ten runs and about 5M tokens. The deep fuzz kept finding harness gaps and approved differences in new shapes. The last five rounds found no 2.0 bug. At run 9, Jason chose "Gate on short seeds; deep runs report (Recommended)" (2026-11-09).
- **Why ask now.** L8's history ops multiply the shapes the fuzz can find, and they combine with every L7 batch shape. Asking at the gate, as L7 did, means paying for rounds first.
- **Option 1, "Gate on short seeds; deep runs report" (recommended).** The gate merges when the 21 PR seeds pass at L8. Nightly deep runs keep running. A failure in a case that uses history or a batch is reported, not failing, and each is triaged in follow-up slices. Any case triaged as a real 2.0 bug blocks at once. "2.0-only live" still fails the nightly, as the L7 gate review set. Two additions come from L7's lessons: the deep seeds run in report mode from L8b, so triage starts before the gate, and report mode runs to the end of each seed.
- **Option 2, "Deep runs gate".** The gate also needs the three deep seeds at 5,000 cases to pass. It finds more before the merge, at L7's cost of about 400k tokens a round.
- **Option 3, "Deep runs gate, two triage rounds at most".** Then report, as option 1. It buys two rounds of deep evidence at a known cost.
- **Recommendation.** Option 1. The short seeds already cover every L8 behaviour the model can reach. The deep runs mostly find new shapes of approved rows, and those can be triaged after the merge without blocking L9.

### Candidate divergences

#### (aw) export and import keep Date, Map and Set

- **What 1.35 does.** `export()` is plain JSON. A Date comes back as a string, a Map and a Set as `{}` (E1, H2).
- **What 2.0 would do.** Keep `version: 1` and the snapshots exactly as 1.35 writes them, so 1.35 still reads a 2.0 export as it reads its own. Add one top-level field that 1.35's import ignores (it reads only `version`, `snapshots` and `currentIndex`, `utils/history.ts:541–556`), listing each Date, Map and Set by snapshot and path, with its value. 2.0's import revives them from it.
- **Product verdict.** Better, rare. It changes the export golden file, so it needs a signed golden change. 1.35 already warns that such facts are not supported.
- **Recommendation.** Defer to the beta's versioned export, where the format changes anyway. Pin 1.35 now (U1).

#### (ax) the JSON tier keeps Date, Map and Set

- **What 1.35 does.** A fact that `structuredClone` refuses is copied through JSON, so a Date inside it becomes a string (T5, H3).
- **What 2.0 would do.** Copy that fact with a walk that keeps Date, Map and Set and drops only what cannot be copied, naming the dropped paths in the existing warning.
- **Product verdict.** Better, rare: a fact must hold a function and a Date together.
- **Recommendation.** Defer, with (aw); they share the encoder. Pin 1.35 now (U2).

#### (ay) a navigation keeps a pause

- **What 1.35 does.** A restore sets `paused` false when it ends, whatever it was (N5, H5).
- **What 2.0 would do.** Put back the pause the restore found.
- **Product verdict.** Better, small change. A debugger that pauses, then steps back, stays paused.
- **Recommendation.** Approve, in L8a.

#### (az) `replay()` and `import()` tell listeners

- **What 1.35 does.** Neither calls `onHistoryNavigate` or the `onHistoryChange` listeners (N3, E4, H6). A panel built on `onHistoryChange` shows the old index and list after either.
- **What 2.0 would do.** Both call the hook and the listeners with the old and new index, as `goTo` does.
- **Product verdict.** Better, visible: one more `onHistoryNavigate` for a plugin, and a panel that updates. The diff scenario "goTo a snapshot id, then replay" moves; L8a signs that entry.
- **Recommendation.** Approve, in L8a.

#### (ba) snapshot ids continue after an import

- **What 1.35 does.** The next id is not moved, so new ids repeat imported ones, and `goTo` finds the first (E3, H7).
- **What 2.0 would do.** Set the next id past the highest imported id.
- **Product verdict.** Better, small change.
- **Recommendation.** Approve, in L8a.

#### (bb) changesets follow the buffer, the redo cut and import

- **What 1.35 does.** A changeset keeps its indexes when old snapshots drop, when a new snapshot cuts off redo, and across an import (N10, E3, H8). An undo can then skip a step or group steps nobody grouped.
- **What 2.0 would do.** Shift a range when the buffer drops a snapshot, drop it when its start falls off or is cut off, and clear all ranges on import.
- **Product verdict.** Better, visible: undo does what the changeset said.
- **Recommendation.** Approve, in L8b.

#### (bc) an import with a bad index fails

- **What 1.35 does.** It accepts any number as `currentIndex` (E2, H15).
- **What 2.0 would do.** Treat an index outside the list as a bad field: log "Failed to import history data" and change nothing.
- **Product verdict.** Better, small change.
- **Recommendation.** Approve, in L8a.

#### (bd) stored snapshots are not shared

- **What 1.35 does.** The `snapshots` list hands out the stored snapshots, and a restore writes the stored values into the facts (T8, H4, H4b).
- **What 2.0 would do.** A restore writes copies. Each stored snapshot and its `facts` record are frozen when stored. A nested object reached through the list is still not frozen; freezing deep would cost a walk per pass.
- **Product verdict.** Better, visible. Code that edits a snapshot in place throws in strict mode, where 1.35 silently rewrote history. A navigation costs one copy.
- **Recommendation.** Approve, in L8b.

#### (be) a changeset counts as one of the steps

- **What 1.35 does.** `goBack(2)` from inside a changeset lands on its start; the second step is dropped (N10, H9b). The docs say a changeset "is traversed as one step".
- **What 2.0 would do.** Take each step in turn: a step inside or at the edge of a changeset crosses it, any other step moves one snapshot.
- **Product verdict.** Better, small change.
- **Recommendation.** Approve, in L8a.

#### (bf) going back clears facts the snapshot lacked

- **What 1.35 does.** A restore writes only the keys the snapshot holds (N4, H12).
- **What 2.0 would do.** Set every other schema fact to `undefined`, except the ones left out as uncapturable.
- **Product verdict.** Better for undo, but risky. A redactor that deletes a key would clear the live fact on every navigation.
- **Recommendation.** Decline. Pin 1.35 (U10), and revisit with fact versions at the beta.

### B. Recommendations the owner may overrule

#### B1 the fuzz additions and harness rules

- **What the tree does.** The model reaches snapshots and one-step navigation, and none of the bookkeeping.
- **Recommendation.** In L8-pre: the ops and options in the reach table, the `history` record, the triggers and classes for each approved row, and the harness rules 1 to 6, each with a self-test. They run on 1.35 from L8-pre, and on v2 only once `current` is L8.

#### B2 the `history-undo-100` workload

- **What 2.0 would do.** 100 writes with history on, then 100 `goBack` calls; time and bytes. The L8 gate judges it at 1.0 or better against 1.35.
- **Recommendation.** Approve the shape before L8a.

#### B3 signing

- **What 2.0 would do.** L8a and L8b sign the entries for approved rows "on the owner's instruction", as at L2, L3 and L7 (GATE-2 rule 1). Declined rows get no entry.
- **Recommendation.** Approve.

### C. Engineering defaults that keep parity (no decision needed)

- **`system.history` stays the whole manager**, with its five extra members (S2).
- **`goTo` the current id restores and fires the hook**, as 1.35 (N2).
- **The uncapturable warning stays once per key per process**, held at module scope, as 1.35.
- **The export stays `version: 1`**, and the import's messages stay in production: 1.35 logs them in both modes.
- **The clone tiers stay as 1.35's**, unless (ax) is approved later.
- **Snapshot timestamps come from `Date.now`**, as 1.35. Under the harness's fake timers both engines read the same clock.
- **The manager's writes carry the `"restore"` origin**, so plugins and the navigation counters see them as 1.35 does.
- **The snapshot event set is built once**, at `createSystem`, as 1.35.

## Evidence: probes

One probe script ran with real timers against the published 1.35 (`packages/conformance/node_modules/directive-v1`, `dist/development` and `dist/production`, version `1.35.0`). It does not live in the repo; L8-pre turns each probe into a conformance test or diff scenario (U1 to U13). Development and production gave the same results except two. H1 threw in development: reading a Date fact's methods throws there with or without history, which a second probe confirmed. And H13: `zeroConfig` turns history on in development only.

- Probe source: `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l8-rfc/probe.mjs`, and the Date check `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l8-rfc/probe-date.mjs`
- Output: `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l8-rfc/out-dev.json`, `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l8-rfc/out-prod.json` and `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l8-rfc/out-date.json`
- Forced-L8 runs: `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l8-rfc/v2.json`, `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l8-rfc/v2dist.json` and `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l8-rfc/diff.json`, summarised in `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l8-rfc/summ.txt`
- Size: `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l8-rfc/size.log`; the 1.35 manager fragment `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l8-rfc/hist-frag.js`

Every probe builds one module with facts `n` (a number), `d` (a Date), `m` (a Map), `s` (a Set), `mix`, `cls`, `late` and `email`, and a `bump` event. A plugin records `onSnapshot` and `onHistoryNavigate`. Each step is a write followed by `await settle()`.

| Probe | Steps | 1.35 |
|---|---|---|
| H1 | Write, write, `goBack` | Production: the Date, Map and Set are still a Date, a Map and a Set. Development: reading the Date's methods throws, with or without history (the Date check) |
| H2 | Export from one system, import into another | `n` restored; `d` a string; `m` and `s` are `{}`. The export holds `"1970-01-01T00:00:01.000Z"` |
| H3 | `mix = { when: Date, cb: fn }`, `cls = new Point(4)`; change both; `goBack` | `mix` is `{ when: "1970-01-01T00:00:03.000Z" }`; `cls` is a plain `{ x: 4 }`; `d` is still a Date |
| H4 | Set `snapshots[i].facts.n = 99`; `goTo` that snapshot | `n` is 99, and the stored snapshot says 99 |
| H4b | `mix = { v: 1 }`, then `{ v: 2 }`; `goBack`; set `mix.v = 42` in place | The live fact and the stored snapshot both read 42 |
| H5 | `pause()`, `goBack()`, then a write | `isPaused` true, then false; the write took snapshot 4 |
| H6 | `replay()`; `goTo` the current id; `import(export())` | `replay`: index 0, `n` 0, no navigate hook and no listener call. `goTo` current: one hook, one call. `import`: none |
| H7 | Export ids 1 to 4; import them into a fresh system; write | Ids `[1, 2, 3, 4, 2]`; `goTo(2)` went to the imported one (`n` 1) |
| H8 | `maxSnapshots: 4`; a changeset over two writes; three more writes; undo twice, redo once | Before the overflow, undo and redo cross the changeset. After it: undo from `n = 6` went to `n = 4`, then 3; redo went to 4 |
| H9b | Two writes; a changeset over three; `goBack(2)` | Index 2, `n` 2: the changeset's start. The second step was dropped |
| H10 | List `system.history`'s members; call `takeSnapshot("manual")` | `HistoryAPI`'s members plus `isEnabled`, `isRestoring`, `refreshLatestSnapshot`, `restore` and `takeSnapshot`. The manual snapshot was id 2 |
| H11 | Start; two synchronous writes; an event | One snapshot after start (`facts-changed:n,d,m,s,email`), then one per pass |
| H12 | Snapshot without `late`; set `late = "x"`; `goBack` | `late` is still `"x"`; `n` went back to 1 |
| H13 | `zeroConfig: true`; with `history: false`; neither | Development: on, off, off. Production: off, off, off |
| H14 | `redactSnapshot` that sets `email` to `"[REDACTED]"`; two writes; `goBack` | The live `email` is `"[REDACTED]"` |
| H15 | Export; set `currentIndex: 99`; import | Index 99, facts unchanged; `goBack` moved to 98 and restored nothing |
| H16 | `goTo(12345)` | Warns "Snapshot 12345 not found" in both modes; index unchanged |

**Reading the table:** H2 and H3 are (aw) and (ax): the losses the plan flagged, in the two places they happen. H4 and H4b are (bd). H5 is (ay), H6 is (az), H7 is (ba), H8 is (bb), H9b is (be), H15 is (bc), and H12 is (bf). H10, H11, H13, H14 and H16 pin 1.35's behaviour where no candidate applies.
