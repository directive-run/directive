# RFC: L8 history

Status: draft for review, revision 2 (after the design review). No engine or oracle code merges from this document.
Tree: branch `p8/l8-rfc`, cut from `main` at `5ec52ed3` (L0 to L7 built and gated; `layers.rules.json` `current` is `"L7"`). Nothing in `packages/conformance` or `packages/core-next/src` is changed by this PR.

## Changes since revision 1

Revision 1 went through a design review. It found three blockers and several wrong labels. This revision fixes all of them. In order:

1. **The seam is much bigger than revision 1 said.** The seam is the part of history that lives in the core rather than in the new part. Revision 1 put it at 10 to 40 bytes. That was a guess, and it was wrong. 1.35 spreads about 120 non-comment lines through its core for history: the write counters and the restored-keys set (`core/engine.ts:749–868`), the snapshot fold (`1842–1877`), and the navigation handling in derivations, effects, gated sources and the requirements rebuild (`1907–1995`). core-next has none of them; it has a `TODO(L8)` at `api/effects.ts:172`. I measured them. Bundled alone for production, minified and gzipped, the three regions weigh 603 B. The whole navigation seam, with every other place 1.35 handles a navigation, weighs 837 B. A real bundle compresses shared names, so it will cost less, but not 40 bytes. Every build pays it, `floor` included, and the beta cannot drop it. A1 is restated from this (Size, and A1).
2. **The gate plan now carries the L7 principal's brakes.** L8-pre runs the 21 PR seeds at forced L8 and leaves at most 10 unexplained cases. The gate is capped at 3 runs, then goes to Jason. The nightly case files store v2's trace. Fuzz handlers respect their abort as a drawn case option, not a universal rule (harness rule 9 says why). These are decision A3.
3. **L7's open follow-ups are now a precondition of L8-pre.** They are: rows or entries for deep cases 2/352 and 1/3262; row n's `when` narrowed to a timeout record; and the (g) `aborted` entry. The reason: with history on, an aborted or late write on one engine takes a snapshot the other engine does not. Each of those cases would come back in a new shape, as a snapshot count that differs. Settle them first, while they are still one-line differences.
4. **A dropped 1.35 rule is named and pinned.** At a changeset's start, `goBack` looks for an earlier changeset whose end is within `steps`, and jumps to that changeset's start (`utils/history.ts:442–453`). Revision 1 did not mention it. It is now in N10, pinned in U8, and (be)'s per-step rule is defined against it. (be) also changes `goBack(2)` from outside into a changeset, where 1.35 lands inside it. Both cases are pinned.
5. **Labels and numbers.** (bf) stays declined, for a corrected reason, with the product effect of declining stated. (ba) says its collision needs a system whose counter is behind the import. "L7 landed at 0.55 of 1.35's bytes" was wrong: 0.55 is GATE-6's time ratio. L7's bytes were 1,229 B against about 2.0 KB, a ratio of about 0.61, and its budget was raised four times from 1.1 KB. The stale "1.07 KB" is gone.
6. **Three more pins in L8-pre.** A diff scenario that navigates with a derivation, pinning N6's `collectInvalidated(navigationKeys)` by name (U17). Pause inside a changeset, where no range is recorded (U18). And U14's exact shape on 1.35: `goBack` during an awaiting resolver, whose late write then takes a snapshot and destroys redo (length 3, index 2).
7. **The mutation run.** The `gate: L8` run 42771832833 had not finished when this revision was written. The state is in the gap analysis.
8. **Decisions.** There are now nine answers, not eight: A3 is new, and A1 is restated from the measurement.

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

**In plain terms:** L8 is one new part, the history manager, plus a seam in the reconcile loop. The seam is the hard part, and the big part: about 120 lines in 1.35. A navigation must wake effects without dispatching resolvers, must not take a snapshot over the redo stack, and must not re-open a gated source. The probes found seven 1.35 problems a user could notice. A navigation while paused un-pauses. `replay()` and `import()` tell no listener. Snapshot ids collide after an import. Changesets point at the wrong snapshots once the ring buffer drops old ones. An import with a bad index breaks navigation. A snapshot can be rewritten through the public `snapshots` list, or through a fact restored from it. And the "Date, Map and Set corruption" the plan flagged is real, but narrower than the plan says: snapshots keep them; export and import lose them. As at L7, the size is an owner decision (A1), and this revision shows it is bigger than first said. New for L8 are two decisions asked up front: whether the deep random runs gate the layer, or report (A2), and the brakes the L7 principal review asked for (A3).

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

**The mutation gate.** A `gate: L8` run of `mutation-nightly.yml` is in progress (`gh run view 42771832833`, started 2026-11-10 06:56Z). When I last checked, at 07:24Z the same day, 9 of its 12 shards had passed (l3-rest, l3-system, l5-sources, l6-hydration, l6-introspection, l9-trace, l10-dynamic, l11-predicate, l11-rest) and 3 were still running (l1-state, l2-resolvers, l3-engine); the run's status was `in_progress` and it had no conclusion. **Result: still pending.** The score (`pnpm --filter @directive-run/conformance exec tsx scripts/mutation-score.ts --gate L8 <reports>`, `MUTATION.md`) and any debt entries go here when it finishes. To read it: `gh run view 42771832833 --json status,conclusion`, then `gh run view --log --job <the Per-shard scores job id>`, and the "Layer gate L8" lines. Debt becomes L8-pre work. The triage files already name L8 in 186 entries. 67 of them, in `mutation-triage/engine.json`, are `feature-layer` L8: history's per-pass bookkeeping and navigation write records. At the L8 gate they convert to gated, each with its killer from the gate run, as L7's 15 did.

## The design: each 1.35 rule, the mechanism that keeps it, and its pin

Where a row says "verified", a probe ran it against the published 1.35 (`packages/conformance/node_modules/directive-v1`, the `conformance:v1` pin, `1.35.0`), in development and production, with real timers. The output is under "Evidence". The rest is read from the code. 1.35 line numbers are in `packages/core/src/`, read from the workspace source. The published development bundle carries the same functions (`createHistoryManager`, `withRestoreOrigin`, `withNavigation`, `refreshLatestSnapshot`, the four clone tiers, "cannot be captured in history", `onNavigate !== "skip"`).

### Where it lives, and why "opt-in" means run time, not bytes

**In plain terms:** 1.35 reads `history:` off the options with no import, so the code that handles it has to be in every system `createSystem` builds. What can be opt-in is the work: a system with history off runs none of it.

| Option | Keeps 1.35's API? | Who pays the bytes |
|---|---|---|
| **O1. A part wired by `createSystem`** (`withHistory`, like `withBatch` at L7 and `withRestore` at L6) | Yes | Every `createSystem` build. `floor` and `createSystemCore` pay only the seam, measured at about 0.8 KB in isolation (Size) |
| O2. A separate import (`history: history()`, the plan's form) | No: a 1.35 program's `history: true` would stop recording | Only programs that import it. This is the beta |
| O3. A chunk loaded the first time `history:` is seen | No in practice: the load is async, and 1.35 takes its first snapshot in the first pass after `start()` (H11) | Only programs that use it, after a delay |

**Reading the table:** O1 is the only option that keeps the alpha rule, and it is what Jason chose. O2 is the beta. O3 would lose the first snapshot.

**The mechanism, under O1.** The core keeps one seam: a `history_` slot on the part context, read once per pass where 1.35 takes its snapshot (`core/engine.ts:1842–1877`). `withHistory` fills it. It owns the ring buffer, the clone, navigation, changesets, export and import, and pause. The navigation rules that touch the reconcile loop stay in the core, because they decide what a pass does: the write counting that tells a navigation's reactions from ordinary work, the restored keys that wake effects alone, and the gated-source skip. They are not a few branches. 1.35 spreads about 120 non-comment lines through its core for them (`core/engine.ts:749–868, 1842–1877, 1907–1995`, plus the call sites and the navigation arm in `core/effects.ts`), and core-next has none of them yet. With the slot empty they do nothing at run time, but they are still bytes: that is the seam, measured under Size. A navigation writes through the core's origin switch with a new `"restore"` origin, as 1.35's manager does through `withRestoreOrigin` (`core/engine.ts:725–732`).

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
| N6 | The restored keys skip the changed set. They wake effects, except those with `onNavigate: "skip"`. Constraints do not see them as changed. Requirements are rebuilt without dispatching. The pass takes no snapshot and re-attaches no gated source (`core/engine.ts:749–868, 1798–1806, 1907–1995`; `core/effects.ts:1309–1337`). | The same, in the core: the restored keys are a second key set for the pass, and effects are asked once for each (the `TODO(L8)` at `api/effects.ts:172`). | `effect-navigation-rerun` (4); `effect-reconcile-boundaries` (6); `blackbox-effects` (4); `sources` internals (1) |
| N7 | A write a listener makes during a navigation is the program's own. It reconciles, but its pass takes no snapshot and re-attaches no gated source. The rule is counted per write, not per key, so an ordinary write in the same pass still snapshots. A navigation made while stopped is not carried into a later pass (`core/engine.ts:749–797, 861–868`). | The same counters, in the core. | `navigation-side-effects` (7); `restore-flush-reconcile` (1) |
| N8 | An effect re-run by a navigation that dispatches an event warns once in development, naming the effect (`core/engine.ts:2337`). | The same string. | `effect-reconcile-boundaries` "warns when it dispatches" |
| N9 | Hooks. `onSnapshot` and the `onHistoryChange` listeners after each snapshot; `onHistoryNavigate(from, to)` and the listeners after each `goBack`, `goForward` and `goTo` (`core/engine.ts:1614–1631`). | The same, through the plugin hooks core-next already names. | diff "onNavigate rerun vs skip on goTo, and onHistoryChange" |
| N10 | Changesets. `beginChangeset` records the current index. `endChangeset` records the range, if a snapshot was taken in it. `goBack` inside a range jumps to its start; `goForward` inside or at its start jumps to its end (`utils/history.ts:429–492, 592–609`). Verified, H9b: `goBack(2)` from inside a range lands on its start; the second step is dropped. Verified, H8: a range keeps its indexes when the ring buffer drops old snapshots, so with `maxSnapshots: 4` an undo from `n = 6` went to `n = 4`, skipping `n = 5`, which no changeset grouped. **A rule revision 1 dropped:** `goBack` from a changeset's *start* looks for an earlier changeset whose end is below the current index and within `steps` of it, and jumps to that changeset's start; only if there is none does it move `steps` snapshots (`utils/history.ts:442–453`). So from the start of one changeset, `goBack(1)` crosses an earlier changeset that ends one snapshot away as a single step. The design review's probe `n10_start_branch` exercised it on 1.35 (index 2 for one setup, index 0 for the other). A step from a plain index does not do this: the review's `be_changeset_steps` probe, `goBack(2)` from index 5 with a changeset over 2 to 4, landed at index 3, inside the changeset. | Without (bb) and (be): copied, including the start rule. With (bb): ranges move with the buffer, and are dropped when cut off. With (be): each step is taken in turn, and the start rule is kept as one of its arms (see (be)). | diff "export, import and changesets"; U7, U8 (three pins) |

**Reading the table:** N6 and N7 are the heart of L8, and the oracle covers them well: 17 tests in three files. N5 and N10 are the user-visible problems. A debugger that pauses recording and then steps back starts recording again. An undo after the buffer fills can jump two steps.

### Export, import and the surface

**In plain terms:** export turns the whole history into JSON. Import reads it back. `system.history` is the manager itself, with more on it than the type says.

| # | 1.35 rule | 2.0 mechanism | Pinned by |
|---|---|---|---|
| E1 | `export()` is `JSON.stringify({ version: 1, snapshots, currentIndex })`, with the redacted facts (`utils/history.ts:523–529`). JSON loses types. Verified, H2: after an export and an import, a Date fact was a string, and a Map and a Set were `{}`. The plan's frozen contracts include a golden file for the export: 2.0 reads 1.35's, and 1.35 reads 2.0's. | Without (aw): copied, byte for byte. | `utils/history` internals; the golden file; U1 |
| E2 | `import()` checks the version, the list, each snapshot's fields and prototype safety. On a failure it logs "Failed to import history data" and changes nothing (`utils/history.ts:531–590`). It does not check `currentIndex` against the list. Verified, H15: an import with `currentIndex: 99` left the index at 99 and the facts unchanged, and a `goBack` then moved to 98, with nothing to restore. | Without (bc): copied. With (bc): an index outside the list fails the import like any bad field. | U9 |
| E3 | `import()` replaces the snapshots and restores the current one. It keeps the old changesets, and it does not move the next id (`196`). Verified, H7: into a fresh system, after importing ids 1 to 4, the next snapshot was id 2 again, and `goTo(2)` went to the imported one. **The collision needs a system whose counter is behind the import.** A fresh system's counter is. On a system that had already taken more snapshots than the import holds, the review's probe `az_ba_bc` gave ids `[1, 4]`: no collision. | Without (ba): copied. With (ba): the next id follows the highest imported id. (bb) drops the old changesets. | U6 |
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

8. **Case files store v2's trace.** The nightly writes 1.35's trace for each failing case. L7's principal review could sample only 6 of 42 deep cases from real v2 traces, because the files held 1.35's side alone. L8-pre makes the case file hold both traces, so a triage reads a case without re-running it.
9. **Fuzz handlers respect their abort as a drawn case option.** Today every resolver handler ignores its abort and writes late; the harness only counts it (`diff/fuzz/model.ts:621–625`). The L7 principal asked for abort-aware handlers. I chose a drawn option (`respectsAbort`), not a universal change, for two reasons. An ignoring handler is real program code, and it is the only way the oracle still tests the approved late-write rows (g), n and the unapproved 2/352. And with history on, a late write is a snapshot, so the two engines can differ in snapshot count for a reason that has nothing to do with history. The draw lets the engine tests use respecting handlers by default and keeps the ignoring ones in a minority. L8-pre also hand-pins the ignoring handler with history on (U14).
10. **The L8-pre exit bar.** L8-pre runs the 21 PR seeds at forced L8 and classifies every failing case: history missing in v2 (the first difference is a missing snapshot or navigation), harness gap, approved row, or unexplained. At most 10 may be unexplained. Fixing the harness gaps it finds is L8-pre work. L8b repeats the run on the built engine at the same bar before the gate PR opens.

Whether the deep runs gate L8 is decision A2. The brakes in rules 8 to 10, and the 3-run cap on the gate, are decision A3.

## Untested behaviours, and what will pin each

**In plain terms:** 18 behaviours have no pin on either engine. Thirteen came from the probes. Five came from the forced-L8 run, from reading the code, and from the design review. Each needs a pin before the slice that could break it. "Conformance" means a test that runs on v1 and v2; "diff" means a scenario the diff harness runs on both.

| # | Behaviour | Evidence | Pinned by | Slice |
|---|---|---|---|---|
| U1 | Export and import turn a Date into a string, and a Map and a Set into `{}` | H2 | A conformance test; shows (aw) if approved | L8-pre |
| U2 | A fact that mixes a Date with a function falls to the JSON tier: the Date becomes a string, the function is dropped. A class instance loses its prototype in every tier | H3 | A conformance test; shows (ax) if approved | L8-pre |
| U3 | A stored snapshot can be changed through `snapshots`, and through a fact restored from it | H4, H4b | A conformance test with both paths; shows (bd) | L8-pre |
| U4 | A navigation clears a pause, and the next write takes a snapshot | H5 | A diff scenario; shows (ay) | L8-pre |
| U5 | `replay()` and `import()` tell no listener; `goTo` the current id does | H6 | A diff scenario that records the `onHistoryChange` count; shows (az) | L8-pre |
| U6 | Snapshot ids repeat after an import into a system whose counter is behind it, and `goTo` finds the first. Into a system already past the imported ids they do not repeat | H7; the review's `az_ba_bc` (ids `[1, 4]`) | A conformance test with both setups; shows (ba) | L8-pre |
| U7 | Changesets keep their indexes when the buffer drops snapshots, when a new snapshot cuts off redo, and across an import | H8; read from `utils/history.ts:377–390, 578–580` | A diff scenario with `maxSnapshots: 4`; shows (bb) | L8-pre |
| U8 | Three pins. (a) `goBack(2)` from inside a changeset lands on its start. (b) `goBack(2)` from outside, into a changeset (changeset over 2 to 4, from index 5): 1.35 lands at index 3, inside it; (be) lands at 2, its start. (c) The dropped start rule: at a changeset's start, `goBack(steps)` jumps to the start of an earlier changeset whose end is within `steps`, else moves `steps` snapshots (`utils/history.ts:442–453`) | H9b; the review's `be_changeset_steps` and `n10_start_branch` | A conformance test for each; (a) and (b) show (be), (c) must pass unchanged with (be) | L8-pre |
| U9 | An import with `currentIndex` outside the list is accepted and breaks navigation | H15 | A conformance test; shows (bc) | L8-pre |
| U10 | Going back leaves a fact the snapshot did not hold at its current value; going forward does not delete it again. Delete `n`, `goBack` gives 1, `goForward` is still 1 | H12; the review's `bf_redo_over_delete` | A conformance test with the delete and the redo; shows (bf) if approved | L8-pre |
| U11 | With `redactSnapshot`, a navigation writes the redacted value into the live fact | H14 | A conformance test, and a docs follow-up | L8-pre |
| U12 | `system.history` carries `takeSnapshot`, `restore`, `refreshLatestSnapshot`, `isEnabled` and `isRestoring` | H10 | A conformance test on the members and one manual `takeSnapshot` | L8-pre |
| U13 | The first snapshot is taken after `start()`, labelled with the init keys | H11 | A diff scenario | L8-pre |
| U14 | A navigation while a resolver runs, while a batch is queued, and while a batch runs. The exact shape for the resolver, reproduced on 1.35 by the review's `u14_nav_during_resolver`: with the index at 2, `goBack` while the resolver awaits moves to 1; the resolver's late write then takes a snapshot, which cuts off redo (length 3, index 2) | the review's probe; the batch cases are read from `core/engine.ts:1907–1995` | Hand probes on the published 1.35 for the queued and running batch, then a diff scenario for each of the three | L8-pre |
| U15 | `system.test` "history config forwarded (boolean)" and "(object)" assert `toBeDefined()`, which `null` passes | the forced-L8 run; `tests/core/system.test.ts:934–945` | Each asserts `system.history` is not null, and one `goBack` lands (an oracle change) | L8-pre |
| U16 | The fault-injection self-test fails at forced L8, because its case now draws history | the forced-L8 run; `diff/self/tamper.test.ts:558` | Pin the self-test's case to a spec without history, or make it expect history's difference | L8-pre |
| U17 | A navigation that moves a derivation an effect reads: the effect wakes, and constraints do not see the key as changed. This is N6's `collectInvalidated(navigationKeys)` (`core/engine.ts:1907–1911`) | read from the code; no conformance test names it | A diff scenario that navigates with a derivation in play and records the effect runs and the requirement events | L8-pre |
| U18 | `pause()` inside a changeset: `endChangeset` records a range only if a snapshot was taken in it, so no range is recorded and a later `goBack` moves one snapshot | read from `utils/history.ts:366–368, 592–609` | A conformance test: begin, pause, write, end, resume, `goBack` | L8-pre |

**Reading the table:** U1 to U10 are where the candidates live, and U8 now holds the dropped start rule. Each pins 1.35's behaviour now and shows the difference only with an approved, signed entry. U11 is not a candidate: a restore cannot tell a redacted value from a real one, so the fix is a sentence in the docs. U14 is the L7 lesson in table form: pin the hard combinations by hand before the random tests find them.

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
| Precondition 1 | The `gate: L8` mutation run (42771832833) finishes. | The L8 layer gate reports PASS, or its debt entries are listed as L8-pre work. | test oracle; coordinator |
| Precondition 2 | L7's open follow-ups land, from the L7 principal review. | Rows or entries for deep cases 2/352 and 1/3262. Row n's `when` narrowed to a timeout record. The (g) `aborted` entry. Why first: with history on, an aborted or late write on one engine takes a snapshot the other engine does not, so each of these would resurface as a snapshot-count difference. The L7 principal's candidate engine bug (case 1/1967, branch `p7/batch-maxsize-remainder`) merges first too. It is an L7 fix, listed so it is not lost. | test oracle; coordinator |
| L8-pre (oracle) | U1 to U18. The two vacuous tests made to bite (U15). The fuzz additions (B1) and the harness rules 1 to 10 above, each with a self-test. A `WHITE-BOX.md` L8 bullet for the 39 internals tests in `utils/history.test.ts`. Any mutation debt. Both preconditions done first. | The 21 PR seeds at forced L8 leave at most 10 unexplained cases, every other failure classified (rule 10). Case files hold v2's trace (rule 8). Fuzz handlers have the `respectsAbort` option (rule 9). The new tests pass on `conformance:v1` and `v1:prod`, and on v2 fail only as this document predicts. `conformance:diff` at forced L8 fails only the five L8 scenarios, the fuzz and the new U-scenarios. The new fuzz ops run on 1.35 from L8-pre, and on v2 only once `current` is L8. `pnpm census`, `check:expects` and `oracle:update` exit 0. `oracle-change` label. | test oracle; Sonnet implementer, Fable correctness reviewer |
| L8a | The seam in the core and the `withHistory` part, wired by `createSystem` (O1): T1 to T8, N1 to N10, E1 to E4, S1 to S3. (ay), (az), (ba), (bc) and (be) if approved, because they change the same lines. `history-undo-100` (B2). Signed entries for approved rows. | At forced L8 on v2, v2:prod and v2:dist: the 55 failures pass, except those that pin an approved row, each listed by file and title. `conformance:diff`: the five L8 scenarios match 1.35, or differ only by signed entries. The 21 PR fuzz seeds at forced L8 pass, or every failure is listed with its row. Census and ratchet exit 0. core-next `test`, `typecheck`, `build` and `size:check`, with the exact development-string count. Sizes within A1; the PR reports the part's bytes, the seam's bytes and the beta-wiring line, each measured the way Size does. | core; Opus implementer, Sonnet diff reviewer plus Fable correctness reviewer |
| L8b | (bb) and (bd), and (aw), (ax) and (bf) only if approved. Their signed entries. | U3 and U7 differ from 1.35 only by signed entries; U1, U2 and U10 likewise if approved. The deep seeds at forced L8 run in report mode to the end of each seed, and every reported case is listed with a first triage. Plus L8a's checks. | core; as L8a |
| L8-gate | `current` to L8, `ratchet --update`, diff and fuzz at L8, the 67 feature-layer triage entries converted, `GATE-7.md`, `/principal` on L8. | 0 L8 failures on v2, v2:dist and v2:prod. The census exits 0. PR fuzz passes at L8. The nightly follows A2. **At most 3 gate runs;** if the third does not finish the gate, it goes to Jason with the open cases listed, and no fourth starts. The nightly case files store v2's trace beside 1.35's. | test oracle; Sonnet plus the coordinator's read of each entry |

**Reading the table:** L8a carries the size and almost all the behaviour. L8b carries the two fixes that change how history is stored, so each lands with its own diff evidence. Every entry lands signed. The signing waits for Jason's approval of this RFC.

## Size

**In plain terms:** every `createSystem` build pays for history until the beta, and the price is higher than revision 1 said. The part of it nobody can drop, the seam, measures about 0.8 KB in isolation, not 10 to 40 bytes. Every fixture is within a few bytes of its budget today.

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

**The seam, measured.** I lifted the 1.35 lines out of `core/engine.ts` and `core/effects.ts`, wrapped them in one function whose free names are parameters (so the minifier mangles them as in a real build), and bundled them alone: esbuild 0.27, production (`isDevelopment` false, so the development warning drops out), minified, gzip 9. The function wrapper's own cost is subtracted. The scripts and outputs are listed under "Evidence".

| What was bundled | Non-comment lines | Minified | Gzip |
|---|---|---|---|
| The three regions the design review named: `engine.ts:749–868, 1842–1877, 1907–1995` | 121 | 1,225 B | **603 B** |
| The whole navigation seam: the navigation lines of those regions, plus `noteWrite` and `passIsEntirelyNavigation` (`874–897`), the restore branch and `noteWrite` in `onChange` (`971–975, 981–987`), the batch path (`1026–1044`), the pass prologue (`1798–1806`), the dispatch warning and guard (`2332–2340` and one line), and the navigation arm of `selectEffects` in `core/effects.ts` (`1309–1337`) | 160 | 1,823 B | **837 B** |
| The same, plus the effect-phase write counters the snapshot fold reads (`803–805, 834–847, 1732–1741`) | 188 | 2,018 B | 941 B |

**Reading the table:** the design review's "about 117 lines" is 121 by my count of non-comment lines in those three regions. The first row is the floor of the seam. The second is the seam as 1.35 writes it. The third counts the effect-phase counters too; core-next has no equivalent, so a port needs something that tells the fold a pass came from effects alone.

**A bundled fragment overstates its real cost,** because the names it shares with the rest of a build compress away. The calibration: 1.35's whole history feature measured 1.3 KB when removed from the Aperture build, while the manager alone weighs 1,869 B in isolation and the seam 837 B. Together that is 2,706 B in isolation against 1,300 B in place, a ratio of 0.48. So the seam in place is likely 0.4 KB, and 0.84 KB is a ceiling for a port that copies 1.35's shape.

| Piece | How measured | gzip |
|---|---|---|
| 1.35's history manager (`utils/history.ts`, its two imports external) | Bundled and minified with esbuild 0.27.3, gzip 9 | **1,869 B** measured (4,583 B minified) |
| 1.35's whole history feature, inside the Aperture build | Removed and re-measured, in the coresize notes; quoted on the Phase 4 page | **1.3 KB** measured |
| 1.35's navigation seam, in isolation | The table above | **837 B** measured (603 B for the three named regions) |
| What rebuilt layers cost against 1.35's | **L7's bytes:** 1,229 B in `minimal` against about 2.0 KB for 1.35's batching, a ratio of about 0.61. Its first cap was 1.1 KB and was raised four times, to 1,250 B (`size-budgets.next.json`). The Phase 4 page's 0.55 is GATE-6's *time* ratio, not bytes | ratio |
| The seam in core-next | Measured 837 B in isolation; in place likely half. Reuses the core's origin switch and effect index if it can | **+0.4 to 0.8 KB** (estimate) |
| The part in core-next (`withHistory`: ring buffer, clone, navigation, changesets, export and import, pause) | Reasoned: 1.35's manager in place is about 0.9 KB (1,869 B at the 0.48 ratio). A rebuild at L7's 0.61 reaches 0.55 KB. The top of the range is no reuse. It reuses `withRestore`'s write path, the deep prototype check and the origin switch | **+0.5 to 0.9 KB** (estimate) |
| (ay) keep the pause | Reasoned: save and put back one flag | about 5 B |
| (az) replay and import tell listeners | Reasoned: two calls to the existing notify | +10 to 20 B |
| (ba) ids continue after an import | Reasoned: one max over the ids | +10 to 20 B |
| (bb) changesets follow the buffer | Reasoned: shift or drop on each drop, clear on import | +40 to 80 B |
| (bc) import checks the index | Reasoned: one more check, and a message | +15 to 30 B |
| (bd) no aliasing | Reasoned: a copy on restore, and two `Object.freeze` calls per snapshot | +20 to 40 B |
| (be) a changeset is one step | Reasoned: one step loop replaces three searches, and keeps the start rule as an arm | about 0 to +40 B |
| (aw) export keeps Date, Map and Set | Reasoned: an encoder and a reviver | +120 to 200 B |
| (ax) the JSON tier keeps Date, Map and Set | Reasoned: a walk; it can share (aw)'s encoder | +80 to 150 B |
| (bf) going back clears facts the snapshot lacked | Reasoned | +20 to 40 B |
| **Every `createSystem` build, the recommended set** | Seam, part, and (ay), (az), (ba), (bb), (bc), (bd), (be) | **+1.0 to 1.9 KB**, so `minimal` to about 30.9 to 31.8 KB |
| `floor` and `createSystemCore` | The seam alone | **+0.4 to 0.8 KB**, so `floor` to about 10.8 to 11.3 KB |
| The same as the recommended set, with (aw), (ax) and (bf) as well | | +1.2 to 2.3 KB |

**Reading the table:** revision 1 put the seam at 10 to 40 B and the total at +0.9 to 1.5 KB. The measurement moves the seam by a factor of 10 to 20 and the total up by about 0.1 to 0.4 KB. The low end is still L7's ratio (0.61) applied to 1.35's 1.3 KB, plus the fixes: about 1.0 KB. The high end adds the seam's ceiling. L7's lesson is to pad: its first cap, 1.1 KB, ran 12% under what it spent.

**What the estimate rests on.** Three figures are measured: the 1,869 B manager, the 837 B seam, and the 1.3 KB removal figure. The 0.61 ratio is measured on L7. The 0.48 calibration is arithmetic on three measured figures. Reuse is a plan. A real stub port of the seam into core-next, measured with `scripts/size.mjs`, would replace the isolation figure with an in-place one; L8a does exactly that first, before the part. L8a reports the part's bytes and the seam's bytes separately, because the seam is the cost every build pays and the beta cannot take back.

**Under "Keep the order".** Every `createSystem` build carries history until the beta: about +1.0 to 1.9 KB, history on or off. At the beta, history becomes an import. The beta-wiring line then gains the whole seam, 0.4 to 0.8 KB, because the seam lives in the core: `minimal` about 25.7 to 26.1 KB, against 25,321 B today. Revision 1 said 25,321 to 25,361 B. That was the 10 to 40 B guess.

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
- **The seam is not a few branches.** 1.35 spreads about 120 lines through its core for history, and it is the one cost the beta cannot give back to apps that skip history. The plan's "+1.3 KB, opt-in" read as if the cost were one removable piece.
- **L7's byte ratio was misquoted.** 0.55 was a time ratio. In bytes L7 landed at about 0.61 of 1.35, and still ran over its first cap four times.

## Decisions for the owner

**Owner decisions, 2026-11-10.** Jason answered four questions, quoted here in his words.

| Question | Jason's answer | What it settles |
|---|---|---|
| A1, the L8 size | "Approve up to +2.0 KB (Recommended)" | Each of `minimal`, `two-module`, `aperture` and `full-entry` may grow by up to +2.0 KB over pre-L8, and `floor` by up to +0.9 KB. Each slice trims first and comes back if it lands above the cap. |
| A2 and A3, how L8 is checked | "Approve both (Recommended)" | Deep runs report while the 21 short seeds gate, and a real 2.0 bug still blocks. The fuzz is made ready before the gate: L8-pre leaves at most 10 unexplained cases; the gate is capped at 3 runs, then goes to the owner; case files store v2's trace; abort respect is a drawn option; L7's follow-ups come first. |
| (aw)–(bf), and B1–B3 | "Approve all as recommended (Recommended)" | (ay), (az), (ba), (bb), (bc), (bd) and (be) are approved. (aw) and (ax) are deferred to the beta's versioned export. (bf) is declined. B1–B3 are approved, including Claude signing for the approved rows. |
| L7's leftover row, deep case 2/352 | "Approve 2.0's (Recommended)" | When an aborted batch's late write comes after destroy(), 2.0 reports nothing; 1.35 reports it as clobbered. It is hook-only, and its entry is signed with the L7 follow-ups. |


**Questions for Jason.** Nine answers settle L8. The table after them gives each a product verdict, so Jason can bulk-approve.

1. **A1, the L8 size.** History as a `withHistory` part wired by `createSystem` (O1), with `minimal`, `two-module`, `aperture` and `full-entry` each allowed up to +2.0 KB over pre-L8, and `floor` up to +0.9 KB (the seam, which the beta cannot drop). **Recommend: approve.**
2. **A2, do deep fuzz runs gate L8, or report?** Asked now, before the build. **Recommend: "Gate on short seeds; deep runs report".**
3. **(ay), (az), (ba), (bc) and (be), the small fixes.** **Recommend: approve all five.**
4. **(bb), changesets follow the buffer.** **Recommend: approve.**
5. **(bd), no aliasing.** **Recommend: approve.**
6. **(aw) and (ax), Date, Map and Set in export and the JSON tier.** **Recommend: defer to the beta's versioned export.**
7. **(bf), going back clears what the snapshot lacked.** **Recommend: decline.**
8. **B1 to B3, and signing.** **Recommend: approve.**
9. **A3, fuzz-ready before the gate.** L8-pre leaves at most 10 unexplained cases; the gate is capped at 3 runs; case files store v2's trace; abort respect is a drawn option; L7's follow-ups first. **Recommend: approve.**

A "no", or no answer yet, means the slice keeps 1.35's behaviour, pins it with a core-next test, and writes no entry.

| Decision | Product verdict | Recommendation |
|---|---|---|
| **A1** history lives in a part wired by `createSystem`, and the L8 budgets | Same behaviour; every `createSystem` build grows by an estimated 1.0 to 1.9 KB, of which the seam, 0.4 to 0.8 KB, stays at the beta | Approve: up to +2.0 KB on four fixtures, +0.9 KB on `floor`; come back above that |
| **A2** deep runs report, short seeds gate | No behaviour change; decides when L8 can merge | "Gate on short seeds; deep runs report" |
| **A3** fuzz-ready before the gate: at most 10 unexplained cases leaving L8-pre, a 3-run cap on the gate, v2 traces in case files, abort respect as a drawn option, L7's follow-ups first | No behaviour change; bounds the gate's cost, which was about 9.3M tokens at L7 | Approve |
| **(aw)** export and import keep Date, Map and Set | Better, rare: only apps with such facts, which 1.35 warns against. Changes the export golden file | Defer to the beta's versioned export |
| **(ax)** the JSON tier keeps Date, Map and Set | Better, rare: a fact must mix one with a function | Defer, with (aw) |
| **(ay)** a navigation keeps a pause | Better, small change | Approve, in L8a |
| **(az)** `replay()` and `import()` tell listeners | Better, visible: a history panel built on `onHistoryChange` updates after them | Approve, in L8a |
| **(ba)** snapshot ids continue after an import | Better, small change | Approve, in L8a |
| **(bb)** changesets follow the buffer, the redo cut and import | Better, visible: an undo after the buffer fills no longer skips a step | Approve, in L8b |
| **(bc)** an import with a bad index fails | Better, small change | Approve, in L8a |
| **(bd)** stored snapshots are not shared with live facts or the `snapshots` list | Better, visible: code that edits a snapshot in place now throws in strict mode, where 1.35 silently rewrote history | Approve, in L8b |
| **(be)** a changeset counts as one of the steps; the start rule stays | Better, small change: `goBack(2)` into a changeset from outside no longer stops inside it | Approve, in L8a |
| **(bf)** going back clears facts the snapshot lacked | Better for undo and redo, rare: it only matters to programs that delete facts. Declining leaves redo wrong after a delete: delete `n`, `goBack` gives 1, `goForward` is still 1 | Decline; the fix reaches into the restored-keys path the seam must get exactly right, so do it after the gate, with fact versions at the beta |
| **B1** the fuzz additions and harness rules, in L8-pre | No behaviour change | Approve |
| **B2** a `history-undo-100` workload judges the L8 gate | No behaviour change | Approve the shape before L8a |
| **B3** signing: L8a and L8b sign entries for approved rows on the owner's instruction | No behaviour change; the census needs signed entries | Approve |

### A. Decisions

#### A1 where history lives, and the L8 budgets

- **What 1.35 does.** `history:` works with no import. The manager and its wiring are in every system, and about 120 lines of navigation handling run through its core.
- **What 2.0 would do.** A `withHistory` part wired by `createSystem`, like `withBatch` (L7, A1) and `withRestore` (L6, B6), plus a seam in the core. At the beta, `history: history()` replaces the setting, and apps that do not import it drop the part. They do not drop the seam.
- **What revision 1 got wrong.** It said `floor` and `createSystemCore` carry only a seam of 10 to 40 B. Measured, the seam is 837 B in isolation, and likely about half that in place (Size). So the cost split is: seam 0.4 to 0.8 KB (every build, kept at the beta); part 0.5 to 0.9 KB (every build now, dropped at the beta by apps that skip history); the small fixes 0.1 to 0.2 KB.
- **Product verdict.** Same behaviour. Every `createSystem` build grows by an estimated 1.0 to 1.9 KB, with or without history, until the beta: `minimal` to about 30.9 to 31.8 KB. The beta-wiring line gains the seam alone, 0.4 to 0.8 KB.
- **Recommendation.** Approve O1, and a raise with a written reason in each slice: up to +2.0 KB over pre-L8 on `minimal`, `two-module`, `aperture` and `full-entry` (`minimal` at most 31,912 B), and up to +0.9 KB on `floor` (at most 11,346 B). Do the attribution step first: find the bytes, move cold code, fold duplicates. L8a ports the seam into core-next before the part, and reports its in-place size, so the real number replaces the isolated one early. Come back if the measured size passes the cap. If (aw), (ax) and (bf) are approved too, the cap would need about +2.4 KB.

#### A2 do deep fuzz runs gate L8, or report?

- **What happened at L7.** The gate took ten runs and about 5M tokens. The deep fuzz kept finding harness gaps and approved differences in new shapes. The last five rounds found no 2.0 bug. At run 9, Jason chose "Gate on short seeds; deep runs report (Recommended)" (2026-11-09).
- **Why ask now.** L8's history ops multiply the shapes the fuzz can find, and they combine with every L7 batch shape. Asking at the gate, as L7 did, means paying for rounds first.
- **Option 1, "Gate on short seeds; deep runs report" (recommended).** The gate merges when the 21 PR seeds pass at L8. Nightly deep runs keep running. A failure in a case that uses history or a batch is reported, not failing, and each is triaged in follow-up slices. Any case triaged as a real 2.0 bug blocks at once. "2.0-only live" still fails the nightly, as the L7 gate review set. Three additions come from L7's lessons: the deep seeds run in report mode from L8b, so triage starts before the gate; report mode runs to the end of each seed; and the gate is capped at 3 runs (A3).
- **Option 2, "Deep runs gate".** The gate also needs the three deep seeds at 5,000 cases to pass. It finds more before the merge, at L7's cost of about 400k tokens a round.
- **Option 3, "Deep runs gate, two triage rounds at most".** Then report, as option 1. It buys two rounds of deep evidence at a known cost.
- **Recommendation.** Option 1. The short seeds already cover every L8 behaviour the model can reach. The deep runs mostly find new shapes of approved rows, and those can be triaged after the merge without blocking L9.

#### A3 fuzz-ready before the gate

- **What happened at L7.** The gate and the runs around it cost about 9.3M tokens. The gate spend that found bugs was about 1.5M. Runs 5 to 10 cost about 2.5M and found no bug. The L7 principal review's second lens judged that unsustainable, and recommended "Fuzz-ready before the gate", aiming at a gate of 1.5M or less. It left the decision to Jason, batched with these.
- **What L8 would do.**
  1. L8-pre runs the 21 PR seeds at forced L8 and leaves at most 10 unexplained cases (harness rule 10).
  2. The gate is capped at 3 runs. After the third, it goes to Jason with the open cases listed.
  3. The nightly case files store v2's trace, so a triage can read a case without re-running it (harness rule 8).
  4. Fuzz handlers respect their abort as a drawn case option, not a universal rule (harness rule 9). Reasons are there.
  5. L7's open follow-ups land before L8-pre starts (the slice plan's Precondition 2).
- **Product verdict.** No behaviour change. It bounds the cost of finding L8's last differences.
- **Recommendation.** Approve all five. The cap is the one that needs Jason: it makes the third failed gate his call, not the coordinator's.

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

- **What 1.35 does.** The next id is not moved, so on a system whose counter is behind the import, such as a fresh one, new ids repeat imported ones and `goTo` finds the first (E3, H7). A system already past the imported ids does not collide: the review's probe gave `[1, 4]`.
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

- **What 1.35 does.** `goBack(2)` from inside a changeset lands on its start; the second step is dropped (N10, H9b). From outside, `goBack(2)` into a changeset stops inside it, at index 3 in the review's probe. At a changeset's start, an earlier changeset within `steps` is crossed as one step (N10, `utils/history.ts:442–453`). The docs say a changeset "is traversed as one step".
- **What 2.0 would do.** Take each step in turn, with the steps left counted down. (1) A step from inside a changeset lands on its start. (2) A step from a changeset's start, when an earlier changeset ends within the steps left, lands on that earlier changeset's start. This is 1.35's start rule (`utils/history.ts:442–453`), kept so that rule does not become a second, unlisted difference. (3) Any other step moves one snapshot. So `goBack(2)` from outside into a changeset (changeset over 2 to 4, from index 5) takes one plain step to 4, then crosses the changeset to 2; 1.35 lands at 3, inside it. `goBack(2)` from inside still lands on the start. U8 pins all three arms.
- **Product verdict.** Better, small change: undo no longer stops in the middle of a changeset when the step count runs into it.
- **Recommendation.** Approve, in L8a.

#### (bf) going back clears facts the snapshot lacked

- **What 1.35 does.** A restore writes only the keys the snapshot holds (N4, H12).
- **What 2.0 would do.** Clear the keys the *departed* snapshot held and the target snapshot lacks, so a fact that existed then and not now goes away on `goBack`, and a delete is re-done on `goForward`. It never touches a key neither snapshot held, and so never touches a key a redactor deleted (revision 1 had this wrong).
- **Product effect of declining.** As reproduced on 1.35: delete `n`, `goBack` gives `n` = 1, then `goForward` still gives 1, because redo does not re-delete. The program sees a state that never existed. It needs a program that deletes facts, which is rare.
- **Product verdict.** Better for undo and redo, small, rare.
- **Recommendation.** Decline for now. The rule joins the cleared keys to the restored keys, the exact path the seam has to get right and the one the L8 gate will test hardest. Pin 1.35 (U10), then revisit after the gate with fact versions at the beta. If Jason would rather have it now, it fits in L8b for about +20 to 40 B.

### B. Recommendations the owner may overrule

#### B1 the fuzz additions and harness rules

- **What the tree does.** The model reaches snapshots and one-step navigation, and none of the bookkeeping.
- **Recommendation.** In L8-pre: the ops and options in the reach table, the `history` record, the triggers and classes for each approved row, and the harness rules 1 to 10, each with a self-test. They run on 1.35 from L8-pre, and on v2 only once `current` is L8.

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

**Revision 2 probes.** The design review ran its own probe against the same published 1.35, in production and development: `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l8-review/probe.mjs`, with output in `out-prod.json` and `out-dev.json` beside it. This revision uses these entries: `be_changeset_steps` (goBack(2) from index 5 landed at index 3), `n10_start_branch` (both arms of the start rule), `bf_redo_over_delete` (back 1, forward still 1), `az_ba_bc` (ids `[1, 4]` on a system past the import; replay and import tell nothing), and `u14_nav_during_resolver` (index 2 before, 1 during, then length 3 and index 2 after the late write). L8-pre turns each into a test (U6, U8, U10, U14).

**Seam measurement.** The script `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l8-rfc/seam-regions.mjs` reads `packages/core/src/core/engine.ts` and `effects.ts`, wraps the line ranges, and prints lines, minified bytes and gzip for each set; the minified outputs sit beside it as `seam-*.min.js`. Run it with `node seam-regions.mjs`.

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
