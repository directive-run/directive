# RFC: L9 trace and introspection

Status: draft for review, revision 2 (after the design review). No engine or oracle code merges from this document.
Tree: branch `p9/l9-rfc`, cut from `main` at `ea25c6ff` (L0 to L7 gated, L8 built and waiting for its gate; `layers.rules.json` `current` is `"L7"`). Nothing in `packages/conformance` or `packages/core-next/src` is changed by this PR.

## Changes since revision 1

Revision 1 went through a design review. It found one wrong claim in the design (the core needs a seam), one missing surface, a size cap set too low, and several open items. This revision fixes them. In order:

1. **The core needs a seam.** A seam is the part of a feature that lives in the core rather than in the new part. Revision 1 said the trace needs none, because it would read the records the kernel already emits. Four records lack a field the trace needs: `derivation.compute` has no `oldValue`; `constraint.evaluate` is `{id, active}`, with no `priority` and no `deps`; nothing records the requirements a pass added or removed; and `effect.run` is `{id}`, though the effects manager already passes `onRun` a `deps` list. File and line for each are in "Where it lives". I sketched the four fields in a scratch copy and measured them with esbuild, minified and gzipped, production: +78 B on `minimal`, +82 B on `two-module`, +88 B on `aperture`, +90 B on `full-entry`, and +24 B on `floor`. The sketch is not committed. There is a seam row in "Where it lives" and in Size.
2. **S6 is new: data-form introspection.** A data-form `when` is a predicate written as an object, such as `{ phase: "red" }`. 1.35 reports it on three surfaces: `inspect().constraints[].whenSpec`, the observer's `whenExplain`, and the clause tree in `explain()`. Revision 1 had none of the three. core-next has none either. Their only oracle tests sit at L13 for a reason that has nothing to do with them (they import `flushMicrotasks`), and the evaluator they need is L11's. S6, three new pins (U14 to U16) and a line in L9a's "done means" are added, with what the gate would have missed.
3. **Size.** Measured `minimal` was 29,960 B before L8 and is 32,350 B after it: +2,390 B. Revision 1's "29,970" was a budget, not a measurement. L7 and L8 both landed above their high estimates, and L8 came in at 1.84 times 1.35's in-place cost (0.88 times its isolated cost). The cap is now **+3.0 KB** on `minimal`, `two-module`, `aperture` and `full-entry`, and **+60 B** on `floor`. The basis is shown in Size.
4. **(bh) says how deep the freeze goes.** One level into the trace's own lists and rows, and no further: a deep freeze would reach the program's own values. A plugin that edits a frozen entry (U12) throws.
5. **(bi) says what it keeps.** The bookkeeping kept for a run that left the ring lasts only until its resolvers end, so it is bounded by the runs in flight.
6. **The open items are settled.** (a) The runaway error an observer throws is rethrown in 1.35 and swallowed in core-next: a one-line parity fix, now in L9a (S2). (b) core-next refreshes derivations before it announces a write, as 1.35 does (M7). (c) The kernel's dependency fields are the seam in item 1. (d) `why()` is a later L9 slice, for development only, and the devtools graph moves to L12 (A6).
7. **The fuzz has a plan for new shapes.** The harness reaches the trace only through `trace: true`, so it exercises R3 to R5 only. The order of `derivationsRecomputed` and of each `deps` list, and the durations, are compared for the first time at L9. L7 and L8 each met new shapes at their gate, and this layer will too. "The fuzz, designed in up front" now says which shapes are compared, how durations are masked, and L9-pre's bar.
8. **Decisions.** The size row is +3.0 KB. Each recommendation is kept, and each row is marked with the option taken under the owner's instruction of 2026-11-15.

## What we are building

L9 lets a program look inside a running system: a log of what each pass did and why (the trace), questions about what each definition is and what it carries (meta and tags), and the counters `inspect()` reports.

The plan's row reads "`trace()` + `introspect()`: observe, inspect, explain, meta, notify, tags, origins | trace, observe*, meta*, fact-tags-*, notify-guardrail-blocked | +2.5 KB | opt-in". The plan also puts opportunity A6 here: `system.why()` and the devtools graph. Jason's Phase 4 answer, "Keep the order (Recommended)" (2026-11-05), settles the shape, as at L8: the alphas keep 1.35's API, so each feature is a part that `createSystem` wires when 1.35's settings or calls ask for it, and it becomes an import at the beta. His "Full checks everywhere" gives L9 this document, the oracle first, the mutation gate, the random tests and two reviewers. When this document and 1.35 disagree, 1.35 wins.

Three terms, used throughout:

- **A run** is one reconcile pass, as the trace records it: the fact changes that started it, and the derivations, constraints, requirements, resolvers and effects it touched.
- **A tag** is a string in a definition's `meta.tags`, such as `"pii"`. A derivation **inherits** the tags of the facts it read, unless it or a derivation between them says `tagBoundary: true`.
- **The watched set** is the derivations something outside the derivation graph reads: a constraint, an effect, a subscriber. `inspect().observedDerivations` is its size.

**Most of the row is already built.** core-next carried these over at L2 to L6.

| Plan item | State in core-next | Where |
|---|---|---|
| `observe()`, its 1.35 events, coalescing by origin | Built; 2 rules missing (S1, S2) | `src/api/observe.ts` |
| Fact origins (`authored`, `hydrate`, `restore`) at the write | Built; 6 of 6 placed tests pass | `src/api/core.ts:1056–1061`, `src/api/facts.ts` |
| `explain()` | Built | `src/api/reconcile.ts:703–745` |
| `notify.guardrailBlocked` and `guardrailCoverage` | Built | `src/api/plugins.ts:230–282` |
| `notify.clobberLoopDetected` and `clobberLoopResolved` | **Not built.** 1.35 has four `notify` members (probe P20) | none |
| `inspect()`'s shape | Built, but `observedDerivations` and `pendingInvalidations` read 0, and `traceEnabled` reads false | `src/api/inspect.ts:42–58` |
| The watched set itself | Built, in the core | `src/api/core.ts:634, 1425–1436` |
| `system.trace`, the `trace:` option, `onTraceComplete` | **Not built.** `trace` reads null; the option warns once in development | `src/api/core.ts:1577–1581`, `src/api/system.ts:106–110` |
| `system.meta.*`, tag recording, tag inheritance | **Not built.** `meta` is `{}`; in development each member throws `featureMissing` naming layer 9 | `src/api/core.ts:1582`, `src/api/missing.ts:66–71` |
| `freezeMeta`, which reads `tags` strictly | Copied into the types, but nothing in the engine calls it | `src/types/meta.ts:96–128` |
| `system.why()`, the devtools graph (A6) | **Not built**; no 1.35 counterpart | none |
| Data-form introspection: `whenSpec`, the observer's `whenExplain`, the clause tree in `explain()` (S6) | **Not built.** The observer maps `constraint.evaluate` to `{id, active}` (`src/api/observe.ts:74–75`) from a record with no explain field (`src/api/reconcile.ts:126`). The evaluator for a data-form `when` is L11's compiler (`src/api/constraints.ts:122`) | none |

**Reading the table:** L9's real work is four things: the trace, meta and tags, two `inspect()` counters, and the slots for data-form introspection (S6). Observe, explain, origins and most of notify are done.

**In plain terms:** L9 is two new parts, `withTrace` and `withMeta`, plus small fixes to parts that exist. Unlike L8, its seam is small: core-next's kernel already emits a record for every step a run takes (`fact.set`, `constraint.evaluate`, `requirement.created`, `resolver.complete` and the rest), and `withObserve` already maps them to 1.35's events. The trace can be built the same way, once four records gain a field each ("Where it lives"); I measured that at 78 B on `minimal`. The probes found three 1.35 behaviours a user could notice: the trace hands every reader the same array and the live entries, so one reader's edit rewrites the trace for all; a run pushed out of the trace while its resolver still runs never reports `onTraceComplete`; and in production the 101st `observe()` call silently receives nothing. They are the candidate rows (bh), (bi) and (bj). The size is an owner decision (A1), and so is whether A6's `why()` is built now (A4).

## Gap analysis, measured

**In plain terms:** at a forced L9, 64 tests fail on v2, every one for a missing piece: no trace, no `meta`, and two counters stuck at zero. Eight more fail for L8 reasons that L8's gate will settle.

What I ran: `layers.rules.json` `current` set to `"L9"` in the working copy only. Then, from `packages/conformance`, `npx vitest run --project conformance:v2 --project conformance:v2:prod`, then `--project conformance:v2:dist`, then `--project conformance:diff`, each with the JSON reporter (each exited 1, as expected). Then `git checkout -- layers.rules.json`; `current` read `"L7"` again and `git status` was clean for the package. core and core-next were built first (`pnpm --filter … build`, both exit 0).

| Run | Tests | Pass | Fail | Skipped |
|---|---|---|---|---|
| `conformance:v2` and `conformance:v2:prod`, together, at forced L9 | 3,342 | 1,834 | 72 | 1,436 |
| `conformance:v2:dist` at forced L9 | 3,260 | 1,756 | 70 | 1,434 |
| `conformance:diff` at forced L9 | 434 | 424 | 10 | 0 |

**Reading the table:** of the 72, 64 are L9's and 8 are L8's. The `dist` run fails the same 64 and 6 of the 8 (the other 2 are a production-only file). Of the diff's 10, 3 are L9's: the two L9 scenarios and the fuzz.

**The 8 L8 failures are not L9 work.** They are the L8 pins U3, U6, U8 (a) and (b), and U9 in `l8-history-pins-oracle` (6) and U3 in its production twin (2). Each pins 1.35's history where L8 built an approved row: (bd), (ba), (be) and (bc). L8's gate turns them into signed expectations. So do the diff's 7 L8 failures (five in `l8-history-pins`, one each in `l8-history-navigation` and `l8-history`). `diff/divergences.json` holds no entry for an L8 row yet: of its 983 entries, the one with an `l8` id is row (as)'s `onSnapshot` twin, an L7 row. Precondition 2 below makes the L8 gate land first.

| What fails | Tests | Files | The error |
|---|---|---|---|
| **Trace** | 27 | `trace` (23 of 25), `blackbox-effects` (3), `constraint-disable` (1, `traceEnabled`) | "Cannot read properties of null (reading 'find')" and `'length'`, `'flatMap'`: `system.trace` is null |
| **Meta and tags** | 21 | `derivation-tag-inheritance` (6), `fact-tags-immutable` (4), `blackbox-tracking` (3), `fact-tags-recorded` (2), `meta-query-timing` (2), `schema-freeze-scope` (2), `blackbox-derivations` (1), `mutants-derivations` (1) | "meta.byTag is not in 2.0.0-alpha yet", and `meta.derivation`, `meta.carriesTag`, `meta.fact`; 2 are "store.registerKeys is not a function" |
| **The watched-set counter** | 14 | `mutants-derivations` (5), `watched-set-shrinks` (4), `tracking-frame-kind` (3), `l9-constraints-observed-derivations` (1), `round-1-findings` (1) | "expected +0 to be 1": `observedDerivations` is hard-coded 0 |
| **Observe** | 2 | `observe` (1, the 100-observer cap), `mutants-facts-system` (1, an observer whose own write runs away) | no warning; `['m1', 'm2']` where 1.35 gives `['m1']` |
| **Total** | **64** | | |

**Reading the table:** the trace and meta are the two big pieces, with 48 of the 64. The counter is 14 tests and probably one line of code, because core-next already keeps the watched set.

**What `layers.json` places at L9.** 132 tests. 11 are internals in `sources.test.ts`, which v2 skips by category (`helpers/layer-gate.ts`); L9-pre adds a `WHITE-BOX.md` bullet for them. Of the 121 black-box tests, 64 fail and 57 pass. The 57 that pass are observe (23: 7 of 8 in `observe`, all 7 in `observe-batched-writes`, all 3 in `observe-stream-reconstructs`, 5 in `blackbox-facts`, 1 in `effect-reconcile-boundaries`), origins (6 of 6), `notify-guardrail-blocked` (3 of 3), inspect and meta shapes read in older files (21, in `nested-mutation-checks`, `constraint-disable`, `l3-engine-oracle-inspect`, `multi-module-correctness.prod`, `blackbox-readonly-module-create`, `engine`, `nested-mutation-snapshot`, `round-1-findings` and `tracking-frame-kind`), and 4 in `system` and `trace`, two of them the tests below. The placements come from the generated file's `by` reasons: `member .inspect` (44), `member .observe` (37), `option trace` (30), `member .trace` (29), `member .meta` (23), `option meta` (5).

**Two placed tests pass without a trace, and could not fail for the reason they are named for.**

- `system.test` "Config Forwarding › trace config forwarded" (`tests/core/system.test.ts:980–988`) asserts `expect(system.trace).toBeDefined()`. On v2 `system.trace` is `null`, and `null` is defined. This is L8's U15 again. L9-pre makes it bite (U10).
- `trace.test` "returns cached array on repeat access without changes (E1)" passes because two reads of `null` are the same value. It starts to bite once L9b builds the trace.

**`meta-query-does-not-watch` is not an L9 test.** Its file rule says L9, but `layers.json` places both its tests at L10: they register definitions at run time. No change needed; it is listed so nobody looks for it in the L9 gate.

**The three data-form introspection tests are not in L9's 132 either.** `data-forms.test.ts`, "data-form introspection" (3 tests: `inspect()` shows the predicate spec, `observe()` emits `whenExplain`, `explain()` renders the clause tree) are placed at L13, each with the single reason `import flushMicrotasks` (`layers.json:2713–2723`; the note is `layers.rules.json:843`). That import is a one-line microtask flush, and it is not what the tests are about. What they exercise is a data-form `when`, which core-next evaluates only with the L11 compiler (`src/api/constraints.ts:122`; `layers.rules.json:25` places "data-form when, on and comparison operators" at L11). So the 1.35 surfaces they pin (S6) have no L9 owner today. Nothing at or below L9 would notice if they were missing.

| Failing diff test | Why |
|---|---|
| "trace: per-run changelogs with causes" (13 differences) | v2 warns "the `trace` option is not in 2.0.0-alpha yet", fires no `onTraceComplete`, and its `inspect()` has `traceEnabled: false` and no `trace` |
| "meta, tags and tag inheritance queries" (11) | the first `meta` call throws in development, so every later answer is missing |
| The fuzz, "random systems trace identically on every engine" | Seed 24301 shrinks to one module, `trace: true` and one settle: v2 warns, and fires no `onTraceComplete` |

**Reading the table:** the third L9 scenario, "observe subscribed late sees only what follows; unsubscribe is idempotent", already passes. The fuzz reaches the trace today, as it reached history at L8.

**The mutation gate.** No `gate: L9` run exists. The last dispatched runs of `mutation-nightly.yml` were both `gate: L8`: run 43154761738 (2026-11-12) printed "Layer gate L8: FAIL. 75 deferred entries at or below L8 are not killed", and run 43549853523 (2026-11-14) printed "Layer gate L8: every later-layer and feature-layer entry at or below L8 is killed by the tests at or below L8" (read from `gh run view --log --job 131014410654` and `132340056529`, line 231 of each). **Result for L9: not started.** It is Precondition 1. The triage files hold 252 entries with `layer: "L9"`: 160 `feature-layer` and 92 `later-layer`; 220 of them are in `mutation-triage/engine.json`, then `derivations.json` (15), `constraints.json` (6), and 3 or fewer in each of four more. 71 further entries mention L9 only in a note. To read the gate when it runs: `tsx scripts/mutation-score.ts --gate L9 --at <reports>` (`MUTATION.md:197–206`), and the "Layer gate L9" line of the Per-shard scores job.

## The design: each 1.35 rule, the mechanism that keeps it, and its pin

Where a row says "verified", the probe ran it against the published 1.35 (`packages/conformance/node_modules/directive-v1`, `1.35.0`), in development and production, with real timers. The output is under "Evidence". The rest is read from the code; 1.35 line numbers are in `packages/core/src/`.

### Where it lives, and the small seam it needs

**In plain terms:** each feature is a part that `createSystem` wires. The trace listens to the records the kernel already emits. Four of those records lack a field the trace needs, so the core gains a small seam: four fields, 78 B on `minimal`.

| Option | Keeps 1.35's API? | Who pays the bytes |
|---|---|---|
| **O1. Parts wired by `createSystem`**: `withTrace` and `withMeta`, like `withHistory` at L8 | Yes | Every `createSystem` build. `floor` pays only the seam's one field in the core, 24 B measured |
| O2. Imports (`trace: trace()`, `introspect()`, the plan's form) | No: a 1.35 program's `trace: true` would stop tracing, and `system.meta` would vanish | Only programs that import them. This is the beta |

**Reading the table:** O1 keeps the alpha rule. Unlike L8, L9's seam is small, because 1.35's trace call sites (`core/engine.ts`, 24 places, measured at 733 B under Size) mostly have a counterpart in core-next that is already paid for: the kernel's records. `withObserve` maps them to 1.35's observation events (`src/api/observe.ts:14–60`); `withTrace` maps them to trace entries. **Revision 1 said "almost no seam" and "no field to add"; the design review checked each field of 1.35's trace entry against the records, and four are missing:**

| Record in core-next | Today | What 1.35's trace entry holds | Where 1.35 has it |
|---|---|---|---|
| `derivation.compute` | `{id, value, deps}` (`src/api/core.ts:820–824`) | `oldValue`, the cached value before the recompute | `core/engine.ts:1088–1098` (`onCompute(id, value, oldValue, deps)`) |
| `constraint.evaluate` | `{id, active}` (`src/api/reconcile.ts:126`) | `priority` and `deps` of each constraint hit | `core/engine.ts:2013–2027` |
| Requirements added and removed | no record: `requirement.created` fires for every current requirement each pass (`reconcile.ts:528`), and `retract` emits nothing (`reconcile.ts:413–446`) | the lists a pass added and removed | `core/engine.ts:2030–2052` |
| `effect.run` | `{id}` (`src/api/effects.ts:710–711`), though the manager already has `onRun(id, deps)` and `wantsRunDeps` (`effects.ts:22–27, 438–445`) and the wiring discards `deps` (`effects.ts:709–714`) | `triggeredBy`, what the effect read | `core/engine.ts:1128–1139` |

I checked the rest of the entry the same way, and read each remaining field as already covered: fact changes by `fact.set` (`prev`, `value`), resolver start, completion and error by the resolver records, effect errors by `effect.error`. That is a read of `src/api/reconcile.ts` and `effects.ts`, not a run; L9b finds out if a field is missing.

**The seam, measured.** I copied `packages/core-next` to a scratch directory (with its own `scripts/size.mjs`, so this branch is untouched) and made the smallest change that gives each record its field. `compute` reads `d.live_ ? d.node_.value : undefined` before it recomputes and adds it to the record. `constraint.evaluate` gains `priority` (a one-line `priorityOf` on the constraints part) and `deps` (`depsOf`, through `describeDep`). Two records, `requirement.added` and `requirement.removed`, are emitted where the pass already builds its `added` and `removed` lists. `effect.run` passes `onRun`'s `deps`, and `wantsRunDeps` asks only while something listens to `effect.run`. Same method as the L8 RFC's Size section: esbuild 0.27.7 through `scripts/size.mjs`, production, minified, gzip 9. The baseline reproduced the sizes in Size exactly, and then with the sketch:

| Fixture | Before | With the four fields | The seam |
|---|---|---|---|
| `minimal` | 32,350 B | 32,428 B | **+78 B** |
| `two-module` | 32,439 B | 32,521 B | **+82 B** |
| `floor` | 10,967 B | 10,991 B | **+24 B** |
| `aperture` | 37,238 B | 37,326 B | **+88 B** |
| `full-entry` | 34,573 B | 34,663 B | **+90 B** |
| `minimal`, beta wiring | 26,240 B | 26,311 B | +71 B |

**Reading the table:** `floor` pays only `oldValue`, because `compute` is in the core and the other three fields sit in the constraint, requirement and effect parts that `floor` does not load. The sketch is a lower bound: it is not type-checked, not run, and has no `explain` field (S6). Two things the real change must do differently. The `oldValue` read belongs inside the `wants` check, so a build with nothing listening reads nothing. And `wantsRunDeps` must answer true only while the trace is on, not whenever an observer listens to `effect.run`, or every observed effect run builds a `deps` list.

**Opt-in at run time.** With `trace` off, `withTrace` subscribes to nothing and `system.trace` reads null. `meta` has no option in 1.35: every system has it, so `withMeta` always runs. Its cost is at definition time (copy the tags once) and at query time; nothing runs per write.

### The trace

**In plain terms:** with `trace` on, each pass that did something becomes an entry in a ring of 100. An entry whose resolvers are still running stays "pending" and is finished when they finish.

| # | 1.35 rule | 2.0 mechanism | Pinned by |
|---|---|---|---|
| R1 | Off by default: `system.trace` is null, `inspect().traceEnabled` is false, and `inspect()` has no `trace` key. On with `true` or any object (`core/engine-trace.ts:162–185`). Verified, P1. | The same; `withMissing`'s "not built" warning goes. | `trace` "returns null when trace is not enabled"; diff "trace: per-run changelogs"; U10 |
| R2 | `maxRuns` defaults to 100 (`engine-trace.ts:186–190`). Verified, P2: 105 runs left 100, the first id 6. | The same. | `trace` (25) |
| R3 | A write is recorded when it happens and moved into the next run when it starts (`core/engine.ts:953–955, 998–1006`; `engine-trace.ts` `startRun`). A run records the derivations it recomputed with their dependency edges, the constraints it hit, the requirements it added and removed, the resolvers it started, and the effects it ran with what each read (`engine.ts:1090–1154, 1787–1792, 2013–2052, 2126–2141`). A run with no fact change, constraint hit, added requirement or effect run is dropped (`hasTraceActivity`). Verified, P6: a write of the same value added no entry. | From the kernel's records, in `withTrace`. | `trace` (25); `blackbox-effects` "what a run tells the trace" (3) |
| R4 | A run that started resolvers is stored as `pending`. It is finished when its last resolver completes, errors or is canceled: the status turns `settled`, the duration is set, the causal chain is built ("plan changed → charge constraint hit → CHARGE requirement added → charge resolved (5ms)"), and `onTraceComplete` fires with it (`engine-trace.ts` `finalizeTrace`; `engine.ts:1471–1474, 1509–1512, 1542–1544`). A run with no resolver is finished at the end of its pass. Verified, P5: read mid-flight the entry was `pending`; the same object later read `settled`. | The same. | `trace` "attributes async resolver completion to the correct trace" |
| R5 | A resolver error is stored as `String(error)` ("Error: card declined"), and the entry gets the anomaly "1 resolver(s) errored". After 3 runs, a run 5 times slower than the average gets a duration anomaly (`updateTraceStats`). Verified, P11. | The same. | `trace`; U8 |
| R6 | The ring drops the oldest entry when it passes `maxRuns`. A dropped entry that is still pending loses its resolvers' attribution, so its `onTraceComplete` never fires (`evictOldestTrace`). With `maxRuns` 0 or below, the list is always empty, and only runs with no resolver report. Verified, P3: `maxRuns: 0` and `-1` each gave an empty list and `onTraceComplete` for runs 1 and 3, not for run 2, which started a resolver. | Without (bi): copied. With (bi): every run reports once, and the dropped run's record lasts only until its last resolver ends, so what is kept is bounded by the runs in flight. | U2 |
| R7 | `system.trace` returns a cached copy of the list: the same array until the next change. The entries are the live ones (`getEntries`). Verified, P4: an item pushed onto one read showed in the next; an edit to `trace[0]` showed in `system.trace` and in `inspect().trace`. `inspect().trace` is a `structuredClone`, so editing it changes nothing (`engine.ts:3851–3853`; verified, P9). | Without (bh): copied. With (bh): the cached array is frozen, and each entry is frozen once it settles, one level into the trace's own lists and rows (see (bh)). | `trace` "returns cached array on repeat access (E1)"; U1 |
| R8 | `destroy()` empties the trace; it then reads `[]` (`engine.ts:3500, 3550`; verified, P8). | The same. | U9 |
| R9 | `onTraceComplete` receives the live entry (`core/plugins.ts:465`). | The same; frozen with (bh). | diff hook `onTraceComplete` |

**Reading the table:** R3 and R4 are the heart of the trace, and the oracle covers them well: 25 tests and a diff scenario. R6 and R7 are the user-visible problems. A telemetry plugin counting runs through `onTraceComplete` loses one whenever a slow resolver outlives 100 newer runs. And any code that sorts or annotates `system.trace` in place changes it for every other reader.

### Meta and tags

**In plain terms:** `system.meta` answers what a definition is (its label, description, tags) and which values carry a tag. Fact tags are copied once, when the system is built, so nobody can quietly take a tag back.

| # | 1.35 rule | 2.0 mechanism | Pinned by |
|---|---|---|---|
| M1 | `meta.module`, `fact`, `event`, `constraint`, `resolver` and `effect` return the authored meta, or `undefined`. A fact's meta is the schema type's own `_meta`, frozen, with its `tags` frozen; the schema type itself is frozen (`engine.ts:2679–2716`). Verified, P12: frozen, the same object as the schema's, tags frozen. | The same, in `withMeta`. | diff "meta, tags …"; `fact-tags-immutable` "refuses a _meta reassignment"; `schema-freeze-scope` (2) |
| M2 | `meta.tags` must be an array of strings, or `createSystem` throws "meta.tags must be an array of strings". It is copied into a fresh frozen array, so an Array subclass overriding `includes` is never asked, and a caller's later edit to the array is not seen (`types/meta.ts:96–128`). Verified, P19: after `createSystem`, emptying the caller's array left `tags` as `["pii"]`. | Call the `freezeMeta` core-next already has, where 1.35 calls it (`engine.ts:136–141, 158–161`, `derivations.ts:282`, `engine-definitions.ts:358, 413`). | `fact-tags-immutable` (4); U6 |
| M3 | The runtime keeps its own copy of every fact's tags, untagged keys included, built at registration (`factTagSets`, `engine.ts:2474–2494`). `carriesTag("fact", key, tag)` reads it: `undefined` for a key never recorded, `false` for an untagged one. A key added through the store's `registerKeys` is recorded too, and re-declaring a key with a different type throws (`core/facts.ts:645–680`; `engine.ts:1064–1071`). | The same map, in `withMeta`. `registerKeys` is decision B3. | `fact-tags-recorded` (2); `fact-tags-immutable` "refuses a re-registration" |
| M4 | A derivation inherits the tags of the facts it read, through derivations it read, stopping at any `tagBoundary: true` (`inheritedTagsFor`, `engine.ts:2419–2464`). Dependencies are what the last computation read, so the answer is about the current state. `meta.derivation(id)` returns the authored meta, or a frozen copy with `inheritedTags` when it inherits. Verified, P15: `contact` gave `{ inheritedTags: ["pii"] }` with no authored meta; `cost`, a boundary, gave `{ tagBoundary: true }`. | The walk over core-next's own graph edges. | `derivation-tag-inheritance` (6) |
| M5 | `carriesTag(kind, id, tag)` has three answers. For a derivation: authored tags first, then the inherited walk; a body that throws gives `undefined`. For other kinds, a `switch`, so `"__proto__"` cannot answer; an unknown kind or id gives `undefined` (`engine.ts:2724–2788`). Verified, P14. | The same. | `mutants-derivations` "a name that is not a derivation …"; U5 |
| M6 | `byTag(tag, { kind })` lists every definition carrying the tag; a derivation can appear as `authored` and again as `inherited`. The walk is fenced off dependency tracking (`collectAllMeta`, `engine.ts:2526–2600`). It computes derivations nothing has read yet. Verified, P13: `contact`, never read, was listed as inherited; the returned rows are not frozen, their `meta` is. | The same, inside the tracking fence core-next has. | `derivation-tag-inheritance`; `blackbox-tracking` (3); U4 |
| M7 | A metadata question asked while a plugin is told about a write sees that write: derivations are invalidated before the announcement (`engine.ts:930–940`). | The same order, settled by a read: core-next's `onChange` invalidates the derivations (`src/api/core.ts:1072`) before it emits `fact.set` (`1073–1077`), inside a hold (`holdDepth++`, `1069`). The two tests fail today only on the missing `meta`; L9a runs them to confirm. | `meta-query-timing` (2) |
| M8 | `meta.subscribe(tags?, listener, { immediate })` calls the listener when definitions change and when keys are registered, and never on a fact write. The tag list narrows nothing (`engine.ts:2790–2820`). A throwing listener is logged as "Metadata subscriber error". Verified, P16: one call for `immediate`, none for a write, none when a gate opened and a derivation started inheriting `pii`. | The same. At L9 nothing but `immediate` calls it; L10's dynamic definitions are the other callers. | U3 |

**Reading the table:** M2 and M3 exist because tags decide what a redaction plugin hides, so 1.35 makes them hard to change after the fact. M8 is a surprise worth pinning: a `meta.subscribe` listener is not told when a derivation starts carrying `pii`, though `byTag("pii")` changes then.

### Observe, inspect, explain, notify and origins

**In plain terms:** observe, explain and origins are built. Five rules are missing: four small ones (S1 to S4) and the data-form slots (S6).

| # | 1.35 rule | 2.0 mechanism | Pinned by |
|---|---|---|---|
| S1 | At most 100 observers. The 101st gets a no-op unsubscribe and never hears anything; development warns "Maximum observer limit (100) reached", production is silent (`engine.ts:2924–2936`). Verified, P18: no event reached the 101st; after one unsubscribe, a new observer heard events. | Without (bj): copied into `withObserve`. | `observe` "caps at 100 observers"; U7 |
| S2 | An observer that throws a runaway error while it is given a batch stops the batch. The catch around each key's delivery rethrows the error before it logs or moves on (`engine.ts:3026–3029`, with the helper `isRunawayError`, `core/facts.ts:23`): a guard the runtime raised is not a consumer's throw, and logging it would disarm the guard. Read, not run. | core-next's catch in the batch loop (`src/api/observe.ts:186–191`) logs every throw and goes on, so `m2` is delivered too. The fix is one line, first in the catch: `if (isRunawayError(error)) throw error;`, with the helper core-next already has (`src/api/facts.ts:30`). It is in L9a. | `mutants-facts-system` "stops delivering a batch to an observer once its own write runs away" |
| S3 | `inspect().observedDerivations` is the watched set's size; `pendingInvalidations` is the watched derivations that moved and are not yet announced, 0 on a settled system (`engine.ts:3765–3774`; `core/derivations.ts:1104–1125`). | Read core-next's `watched` set (`src/api/core.ts:634`) through a feature accessor; today `inspect.ts` returns 0. The diff masks both values (`diff/compare.ts:524–528`), so only conformance tests pin them. | 14 tests (the table above) |
| S4 | `notify` has four members: `guardrailBlocked`, `guardrailCoverage`, `clobberLoopDetected`, `clobberLoopResolved`; the last two share the depth-4 re-entry cap (`engine.ts:2823–2919`; verified, P20). | Add the two missing members to `withPlugins`. Their only callers are the clobber-loop plugins (L12 tests). | U11 |
| S5 | `explain()` and the fact origins. | Built; no change. | `l3-engine-oracle-inspect`; `fact-origin-at-write` (6) |
| S6 | Data-form introspection, for a constraint whose `when` is a data form (an object such as `{ phase: "red", elapsed: { $gte: 30 } }`). `inspect().constraints[].whenSpec` is that object. An observer's `constraint.evaluate` event carries `whenExplain`, a list of per-clause pass and fail results (built at `engine.ts:1254–1255`, delivered at `3046–3051`, and only when it exists). `explain(requirementId)` prints the clauses under "Predicate clauses:" with a tick or a cross, combinators indented (`engine.ts:3913`; `explainWhen`, `constraints.ts:246–250, 1809`). A function-form `when` has none of the three. Verified, P21, development and production alike: the data form gave `whenSpec`, `whenExplain` `[["phase",true],["elapsed",true]]` and "✓ phase $eq red (actual: red)"; the function form gave no `whenSpec` key, no `whenExplain` key, and no clause section. | None of the three exists in core-next. The observer maps `constraint.evaluate` to `{id, active}` (`src/api/observe.ts:74–75`) from a record with no explain field (`reconcile.ts:126`), though the plugin hook table has an `explain` slot (`plugins.ts:64`); there is no `whenSpec` or `explainWhen` in `src/api`. The evaluator is L11's compiler (`constraints.ts:122`), so L9 builds the slots and L11 fills them: an `explain` field on the record, `whenExplain` passed through only when present (the key absent, not `undefined`), `whenSpec` on the inspected constraint only when present, and the clause printer with the compiler. | `data-forms.test.ts` "data-form introspection" (3), now at L13; U14 to U16 |

**Reading the table:** S3 is 14 of the 64 failures and the cheapest fix in the layer. S6 is in none of the 64: its tests are placed at L13, so a forced L9 never runs them, and nothing at L9 would have said it was missing.

### A6: `system.why()` and the devtools graph

**In plain terms:** A6 is new. 1.35 has no `why()`, so the oracle cannot check it, and the devtools graph belongs to the devtools plugin, which is L12.

The plan's opportunity 6 is "'Why did this run' answered from the graph: `system.why(id)` in dev, and devtools draws the real node graph." What I found:

- `grep` for `why(` over `packages/core/src` (excluding tests) finds nothing: 1.35 has no such member. A6 is an addition, so it needs its own tests, not parity tests.
- 1.35's graph drawing is `plugins/devtools-graph.ts`, inside the devtools plugin. It reads `system.facts`, `system.derive` and `system.history`, not engine internals. Its tests, `tests/plugins/devtools.test.ts` and `devtools-when-explain.test.ts`, are placed at L12 (`layers.rules.json:755–760`).
- core-next has the graph hooks A6 needs from L0 (the plan's "graph hooks for A6").

**Settled in revision 2:** `why()` is a later L9 slice (L9c), for development only, and the devtools graph moves to L12, where its tests are placed (`layers.rules.json:755–760`: `devtools.test.ts` and `devtools-when-explain.test.ts`). So A6 has two halves at two layers. `why(id)` can be a development-only part: production drops it, as it drops `withValidation`, so it costs no production bytes. The devtools graph waits for the devtools plugin at L12. Whether `why()` is built now is decision A4.

## Where it lives

**In plain terms:** two new files, edits to five existing parts, and a small seam in the core (the four record fields, 78 B on `minimal`).

| Piece | File | Change |
|---|---|---|
| `withTrace` | `src/api/trace.ts` (new) | The ring, runs, pending runs, the causal chain, stats and anomalies, `onTraceComplete`. Fed by the kernel's records |
| `withMeta` | `src/api/meta.ts` (new) | `system.meta`, the fact tag map, inheritance, `freezeMeta` at definition time, `subscribe` |
| `withInspect` | `src/api/inspect.ts` | The two counters (S3), `traceEnabled`, and `trace` when on |
| `withObserve` | `src/api/observe.ts` | The cap (S1), the runaway rethrow (S2), and `whenExplain` passed through when the record has one (S6) |
| `withPlugins` | `src/api/plugins.ts` | The two `notify` members (S4) |
| **The seam**: four record fields | `src/api/core.ts:810–824`, `src/api/reconcile.ts:126, 413, 528`, `src/api/constraints.ts` (`priorityOf`), `src/api/effects.ts:709–714` | `oldValue`; `priority` and `deps`; `requirement.added` and `requirement.removed`; `deps` on `effect.run`. Sketched and measured: 78 B on `minimal`, 24 B on `floor`. L9a, first |
| The S6 slots | `src/api/reconcile.ts:126` (an `explain` field), `src/api/inspect.ts` (`whenSpec`), `src/api/observe.ts:74–75`, `explain` | The places that carry `whenSpec`, `whenExplain` and the clause tree. They stay empty until L11's compiler fills them |
| The core | `src/api/core.ts:1577–1582` | The `trace` and `meta` slots become the parts' members |
| `withMissing`, `createSystem` | `src/api/missing.ts:66–71`, `src/api/system.ts:106–110` | The `meta.*` stubs and the "not built" trace warning go |
| `why()` (only if A4 says build) | `src/api/why.ts` (new), development only | A6's first half |

## The fuzz, designed in up front

**In plain terms:** the random tests already turn the trace on and compare what it reports. Before the build, they need to compare durations fairly, and to reach the ring and meta.

What the model does today, read from the code: `trace` is a feature at L9 (`diff/fuzz/model.ts:276–277`); a case draws `trace` as a boolean (`518`) and passes `trace: true` (`1775`). The recorder captures every `onTraceComplete` (`diff/hooks.ts:59`) and the whole `inspect()` at every checkpoint (`diff/record.ts:141–163`), so `inspect().trace` and `traceEnabled` are compared after every settle. The counters are masked (`diff/compare.ts:524–528`). The harness fakes `Date` and `performance` from time 0 (`diff/scenario.ts:23, 737`). That is the whole reach: the model draws the trace only as a boolean, so it exercises R3 to R5 and nothing else of L9.

| L9 behaviour | The model reaches it today? | What L9-pre adds |
|---|---|---|
| A run per pass, its contents, `onTraceComplete` (R3, R4) | Yes | Nothing |
| Pending runs and resolver errors (R4, R5) | Yes: resolvers and failing resolvers are drawn | Nothing |
| The ring dropping runs, a pending run dropped (R2, R6) | No: `maxRuns` is always 100, more than any case's runs | Draw `maxRuns` from 1, 3 and 100 |
| Durations, the causal chain's "(5ms)", the duration anomaly (R4, R5) | Yes, and they can differ: the two engines' fake clocks can end a wait at different times (L7 run 5) | A projection, as for resolver durations (`diff/compare.ts:626–660, 755–810`): `duration` by contract, the chain's milliseconds and the anomaly's numbers masked |
| `meta` answers, tags, inheritance (M1 to M6) | No | A `meta` op that records `byTag` and `carriesTag` for each tag the case's schema draws, and a module option that tags facts and draws `tagBoundary` |
| `meta.subscribe` (M8) | No | Not added: at L9 only `immediate` calls it. Hand pin U3 |
| The observer cap (S1) | No | Not added: it needs 100 observers. Hand pin U7 |
| The counters (S3) | Masked | Not added: conformance tests pin them |

**Reading the table:** the model already reaches the trace's core, so the fuzz will be in the gate from the day `current` is L9. Its gaps are the ring and meta, which the table adds, and timing: without the projection, every case with a slow resolver could differ by a millisecond in a causal chain. Timing is not the only new shape; the next three paragraphs say which others to expect.

**What the harness compares at L9, and the shapes that are new.** The recorder keeps every `onTraceComplete` entry and the whole `inspect()` at every checkpoint, so every field of every trace entry is compared, lists in order. Compared for the first time at L9: the order of `derivationsRecomputed`; the order inside each `deps` list (a recompute's, a constraint hit's, an effect's `triggeredBy`); the order of `constraintsHit`, `requirementsAdded` and `requirementsRemoved`; each `priority`; `oldValue` against `newValue` of every recompute; and the three timings (`timestamp`, `duration`, each resolver's `duration`). L7 and L8 each met new shapes at their gate (an abort or a late write taking a snapshot the other engine did not take), because turning a feature on brought compared fields the harness had never compared. L9 does the same: today `inspect().trace` is compared against a v2 whose trace is empty. Expect the new shapes at the gate as differences of order (the seam's `requirement.added` and `requirement.removed` fire in the reconciler's iteration order, which 1.35's set diff may not share; a derivation's `deps` follow the tracker's read order), of count (a derivation recomputed lazily on one engine and eagerly on the other), and of timing. This is a prediction from the two earlier layers, not a measurement.

**How durations are masked, decided now.** An entry's `duration` and `timestamp`, and each `resolversCompleted` row's `duration`, are compared by contract: each is a finite number at or above 0 on both engines, and not compared for equality. The causal chain's "(5ms)" and the numbers in a duration anomaly are replaced by a placeholder before the comparison, and a duration anomaly's presence is not compared (it depends on time, U13); the "1 resolver(s) errored" anomaly is compared. Trace ids are compared by order, not value. Everything else in an entry is compared exactly, including the order of every list, so that an order difference shows up as a case and not as a silent mask. Each projection ships with its self-test (rule 2).

**L9-pre's bar.** The 21 PR seeds at forced L9 leave at most 10 unexplained cases. At L9-pre v2 has no trace, no meta and no S6, so every `trace: true` case fails the same way, and the shrinker reduces them to one root cause. A case is explained if its shrunk form is "trace not built", "meta not built", "S6 not built" or one of L8's items; the bar counts the rest. To keep a projection from meeting the bar by hiding real differences, the 21 seeds also run 1.35 against 1.35 with one engine's clock skewed by a few milliseconds, and no differences are allowed. At the gate, the 21 seeds pass at L9 or every failure is listed with its row, and the deep seeds report (A2). The numbers are L8's; the plan above is what keeps them from being met by luck.

**Harness rules, decided now.** L8's ten rules carry over unchanged (the L8 RFC, "The fuzz, designed in up front"). Three are new:

1. **Trace timing is compared by contract.** `duration`, `timestamp`, the causal chain's "(Nms)", the anomaly's numbers and a duration anomaly's presence are projected the way resolver durations are. Trace ids are compared by order.
2. **The projection and the `meta` op each ship with a self-test**: one that drops an `onTraceComplete`, and one that answers `carriesTag` wrong.
3. **The L9-pre exit bar.** The 21 PR seeds at forced L9 leave at most 10 unexplained cases, as at L8 (A3); the plan above says what counts as explained.

Whether the deep runs gate L9 is decision A2.

## Untested behaviours, and what will pin each

**In plain terms:** 16 items have no pin at L9. Twelve came from the probes; four from the forced-L9 run and from reading the code. (U14 is a placement, not a behaviour.)

| # | Behaviour | Evidence | Pinned by | Slice |
|---|---|---|---|---|
| U1 | `system.trace` hands every reader the same array and the live entries; an edit rewrites the trace for every reader and for `inspect().trace` | P4, P9 | A conformance test; shows (bh) | L9-pre |
| U2 | A pending run dropped from the ring never reports `onTraceComplete`; with `maxRuns` 0 or below the list is empty and only runs without resolvers report | P3 | A diff scenario with `maxRuns: 1` and a slow resolver, and one with `maxRuns: 0`; shows (bi) | L9-pre |
| U3 | `meta.subscribe` is called for `immediate` only: not on a write, not when a derivation starts inheriting a tag | P16 | A diff scenario | L9-pre |
| U4 | `byTag` computes derivations nothing has read, and lists them as inherited | P13 | A diff scenario that asks before any read | L9-pre |
| U5 | `carriesTag` gives `undefined` for an unknown kind, `"__proto__"`, an unknown id, and a derivation whose body throws | P14 | A conformance test | L9-pre |
| U6 | A caller's edit to its `tags` array after `createSystem` is not seen | P19 | A conformance test | L9-pre |
| U7 | The 101st observer hears nothing; production gives no message | P18 | A conformance test in each mode; shows (bj) if approved | L9-pre |
| U8 | A resolver error is stored as `String(error)`, with the anomaly "1 resolver(s) errored"; a later pass that only re-hits the constraint is its own run | P11 | A diff scenario | L9-pre |
| U9 | After `destroy()`, `system.trace` is `[]`, not null | P8 | A conformance test | L9-pre |
| U10 | `system.test` "trace config forwarded" asserts `toBeDefined()`, which `null` passes | the forced-L9 run; `tests/core/system.test.ts:980–988` | Assert an array, and one entry after a write (an oracle change) | L9-pre |
| U11 | `notify` has `clobberLoopDetected` and `clobberLoopResolved`, with the depth cap | P20; `engine.ts:2823–2919` | A conformance test with a plugin that re-emits | L9-pre |
| U12 | A plugin that edits the entry `onTraceComplete` gives it changes `system.trace` | read from `engine-trace.ts` and `plugins.ts:465` | A conformance test; shows (bh) | L9-pre |
| U13 | The duration anomaly ("5x+ above average") depends on real time | read from `updateTraceStats` | Not pinned: timing. Rule 1 masks it | none |
| U14 | The three data-form introspection tests sit at L13 for `import flushMicrotasks`, and the data-form `when` they exercise is L11's | the forced-L9 run; `layers.json:2713–2723`; `layers.rules.json:843` | Re-place, not rewrite: add `instruments: ["import flushMicrotasks"]` to the file's rule, as `requeue.test.ts` has (`layers.rules.json:409–412`), and check where each lands. Expected L11, the first layer v2 can pass them; they cannot be L9, because core-next has no evaluator for a data-form `when` there. Skipped at L9, they pass when L11 lands | L9-pre |
| U15 | A function-form `when` gives no `whenSpec` key in `inspect()`, no `whenExplain` on the observer's event and no "Predicate clauses:" in `explain()`; a data form gives all three | P21 | A conformance test at L9 with a function-form constraint, in each mode. It pins the absent half on both engines; the present half is U14's tests | L9-pre |
| U16 | The observer's `constraint.evaluate` event has no `whenExplain` key at all when there is nothing to explain: absent, not `undefined` (`engine.ts:3046–3051`) | P21 (`hasKey: false`) | A conformance test that asserts `"whenExplain" in event` is false (`toEqual` cannot tell the two apart) | L9-pre |

**Reading the table:** U1, U2, U7 and U12 are where the candidates live. Each pins 1.35's behaviour now and shows the difference only with an approved, signed entry. U14 to U16 are not candidates either: they place and pin S6. U3 and U4 are not candidates; they are 1.35's documented answers ("the state the system is in, not every state it could reach", `engine.ts:2405–2418`), pinned so the port keeps them.

## Performance

**In plain terms:** trace off must cost nothing; trace on costs one entry per pass, as in 1.35.

I did not run the bench for this RFC: no L9 code exists, and the L8 numbers stand. What L9 must keep:

- With trace off, no workload slower than `main` by more than 5% after any L9 slice. Under O1, trace off means `withTrace` does not subscribe to the kernel's records, which is less work than 1.35's per-write `if (traceEnabled)`.
- `meta` costs nothing per write. `carriesTag("fact", …)` is a map lookup, as in 1.35, because redaction plugins ask it on every write.
- The seam costs nothing with nothing listening: the `oldValue` read goes inside the `wants` check, and `wantsRunDeps` answers true only while the trace is on. L9a's bench run checks both.
- `byTag` and inherited `carriesTag` walk the graph and can compute derivations (M6). That is 1.35's cost, kept.
- L9b adds a `trace-100` workload (B2): 100 writes with trace on, then read `system.trace`. Time and bytes, judged at 1.0 or better against 1.35.

## Slice plan

**In plain terms:** an oracle slice, two build slices, an optional A6 slice, and the gate.

| Slice | Builds | Done means (checkable) | Tier |
|---|---|---|---|
| Precondition 1 | A `gate: L9` run of `mutation-nightly.yml`. | The L9 layer gate reports PASS, or its debt entries are listed as L9-pre work. | test oracle; coordinator |
| Precondition 2 | The L8 gate. | `current` is L8; the 8 L8 failures and 7 L8 diff failures seen at forced L9 are signed expectations. | coordinator |
| L9-pre (oracle) | U1 to U12 and U14 to U16 (U14 re-places the three data-form introspection tests). U10 made to bite. The fuzz additions and rules 1 to 3 (B1), each with a self-test. A `WHITE-BOX.md` L9 bullet for the 11 internals in `sources.test.ts`. B3. Any mutation debt. | The 21 PR seeds at forced L9 leave at most 10 unexplained cases. The new tests pass on `conformance:v1` and `v1:prod`, and on v2 fail only as this document predicts. `conformance:diff` at forced L9 fails only the two L9 scenarios, the fuzz and the new U-scenarios. `pnpm census`, `check:expects` and `oracle:update` exit 0. `oracle-change` label. | test oracle; Sonnet implementer, Fable correctness reviewer |
| L9a | **The seam first**: the four record fields, measured against the 78 B sketch and reported. Then `withMeta` (M1 to M8), the counters (S3), the observe rules (S1, the cap; S2, the runaway rethrow), the two `notify` members (S4) and the S6 slots. (bj) if approved. | At forced L9 on v2, v2:prod and v2:dist, the 37 meta, counter and observe failures pass (21 + 14 + 2), except any that move by B3. The diff "meta, tags …" scenario matches 1.35. **S6:** the U15 and U16 pins pass on v2, v2:prod and v2:dist; the three data-form tests, re-placed by U14, stay skipped at L9 and pass when L11 lands. **What the gate would have missed without S6:** the observer's `whenExplain`, `whenSpec` in `inspect()` and the clause tree in `explain()` would all be unbuilt, and nothing at or below L9 would run them (their tests sit at L11 or L13), so the miss would surface at L11 or L13, in a layer that does not own the code, the way L7's and L8's new shapes surfaced at their gates. core-next `test`, `typecheck`, `build`, `size:check` with the exact development-string count. Sizes within A1; the PR reports the seam's bytes and `withMeta`'s separately, before L9b starts. | core; Opus implementer, Sonnet diff reviewer plus Fable correctness reviewer |
| L9b | `withTrace` (R1 to R9), from the kernel's records; `inspect().trace` and `traceEnabled`; `trace-100` (B2). (bh) and (bi) if approved, with signed entries. | The 27 trace failures pass. The diff "trace: per-run changelogs" matches 1.35 or differs only by signed entries. The 21 PR fuzz seeds at forced L9 pass, or every failure is listed with its row. The deep seeds at forced L9 run in report mode to the end of each seed, each reported case triaged. Plus L9a's checks; the PR reports `withTrace`'s bytes, and any record field the trace needed that the seam did not carry. | core; as L9a |
| L9c (only if A4 says build) | `why(id)`, development only, with its own tests. | Production bytes unchanged (the dist check shows 0 new production strings). | core; Sonnet implementer, one reviewer |
| L9-gate | `current` to L9, `ratchet --update`, diff and fuzz at L9, the 160 feature-layer triage entries converted, `GATE-9.md`, `/principal` on L9. | 0 L9 failures on v2, v2:dist and v2:prod. The census exits 0. PR fuzz passes at L9. The nightly follows A2. At most 3 gate runs, then Jason. | test oracle; Sonnet plus the coordinator's read of each entry |

**Reading the table:** L9a is the always-on surface; L9b is the opt-in one. Splitting them keeps each PR's size and diff evidence separate, and lets the cheapest 37 fixes land first.

## Size

**In plain terms:** 1.35's L9 code that core-next lacks weighs about 3.4 KB on its own. Ported at the rate L8 landed, that is about 2.7 to 3.0 KB in every `createSystem` build, with the seam (78 B on `minimal`, measured on a sketch) inside it. Every fixture is 10 bytes under its budget today. The recommended cap is +3.0 KB, and +60 B on `floor`.

Measured with `node scripts/size.mjs --check` in `packages/core-next` on this branch (production, minified, gzip level 9; exit 0).

| Fixture | core-next now | Budget | Room |
|---|---|---|---|
| `minimal` | 32,350 B | 32,360 B | 10 B |
| `two-module` | 32,439 B | 32,449 B | 10 B |
| `floor` | 10,967 B | 10,977 B | 10 B |
| `aperture` | 37,238 B | 37,248 B | 10 B |
| `full-entry` | 34,573 B | 34,583 B | 10 B |
| `minimal`, beta wiring (only the parts it uses) | 26,240 B | reported, not budgeted | |

**Reading the table:** there is no room. Any L9 byte needs A1.

**1.35's L9 code, measured.** The method is the L8 RFC's. A script lifts each region from `packages/core/src` by an anchor and bracket balance, wraps the regions in one function whose free names are parameters (so the minifier mangles them as in a real build), and bundles it with esbuild 0.27.7, production (`isDevelopment` false, so development text drops out), minified, gzip 9. The wrapper's own cost, the same parameters and return with an empty body, is subtracted. `engine-trace.ts` is bundled whole, its imports external.

| Piece | Regions (`core/engine.ts` unless named) | Non-comment lines | Minified | Gzip |
|---|---|---|---|---|
| The trace manager | `core/engine-trace.ts`, whole | 324 | 3,753 B | **1,398 B** |
| The trace call sites | 20 statements and 4 members: `923–928, 953–955, 998–1006, 1090–1098, 1128, 1131–1154, 1471–1474, 1509–1512, 1542–1544, 1717–1719, 1783–1792, 2013–2052, 2126–2141, 2211–2213, 2675–2677, 3500, 3550, 3850–3853` | 125 | 1,670 B | **733 B** |
| Meta and tags | `factTags`, `inheritedTagsFor`, the fact tag map, the meta subscribers, `collectAllMeta`, `system.meta`, `onKeysRegistered`: `1064–1071, 2387–2392, 2419–2494, 2510–2600, 2679–2821` | 249 | 2,819 B | **989 B** |
| `freezeMeta` | `core/types/meta.ts:96–128` | 24 | 435 B | 236 B |
| `notify` (four members) | `2823–2919` | 73 | 462 B | 187 B |
| `observe` | `2921–3259` | 286 | 3,490 B | 1,239 B |
| `inspect` | `3761–3855` | 83 | 1,435 B | 619 B |
| `explain` | `3857–3989` | 101 | 1,929 B | 854 B |
| Fact origin | `908–920` | 9 | 54 B | 39 B |
| **What core-next lacks**, in one bundle: the call sites with meta and tags | as above | 374 | 4,494 B | **1,665 B** |
| Every engine region above, in one bundle | | 926 | 11,943 B | 4,215 B |

**Reading the table:** what core-next lacks is the trace manager (1,398 B), its call sites and meta together (1,665 B), and `freezeMeta` (236 B): about 3.3 KB, plus about 0.1 KB of small pieces (the two `notify` members, the cap, the counters). Observe, inspect and explain are 2.7 KB of 1.35 that core-next already carries.

**How much of 1.35's size a port pays.** Two layers are measured. L7's bytes landed at about 0.61 of 1.35's (the L8 RFC), and above its first cap: 1,229 B against a cap of 1.1 KB, 12% over. L8's landed higher. Measured, `minimal` went from 29,960 B before L8 (the design review's measurement on `8b60e038`; I did not rebuild it) to 32,350 B after L8b (`99184937`; I re-measured this one, exit 0): **+2,390 B**. Revision 1 wrote "29,970 B" for the starting point; that is the budget at that commit, 10 B above the measured size, and not a measurement (the budget moved 29,970 B to 32,360 B, also +2,390 B). Against 1.35's L8 code, +2,390 B is 0.88 of the 2,706 B measured in isolation (the manager, 1,869 B, and the seam, 837 B), or about 0.82 after taking out the 0.1 to 0.2 KB the approved fixes added. Against 1.35's own cost in place, the 1.3 KB measured by removing history from the Aperture build, it is **1.84 times** (2,390 / 1,300). The L8 RFC had assumed 0.48 of isolated and estimated +1.0 to 1.9 KB, so L8 landed 26% above its high estimate.

| Estimate | Basis | `minimal` grows by |
|---|---|---|
| The seam | Measured on a sketch ("Where it lives") | +78 B on `minimal` |
| Low | 3.4 KB at L7's 0.61, plus the seam | about 2.2 KB |
| Middle | the call sites (733 B) replaced by the seam (78 B, measured) and the kernel's records, which core-next already pays for; the rest (about 2.7 KB) at L8's 0.82, plus about 0.3 KB of mapping code in `withTrace`; plus S2 and S6 below | about 2.7 KB |
| High | 3.4 KB at L8's 0.88, no reuse | about 3.0 KB |
| The earlier misses repeated | The middle estimate (2.7 KB) at L7's 1.12 (over its first cap), and at L8's 1.26 (over its high estimate) | 3.0 KB and 3.4 KB |
| (bh) frozen trace | Reasoned: a small helper that freezes the array, each settled entry, its lists and their rows | +40 to 80 B |
| (bi) every run reports | Reasoned: keep a dropped run's bookkeeping until its resolvers end | +20 to 40 B |
| (bj) the cap warns in production | Reasoned: the message string kept in production | +60 to 90 B |
| S2 the runaway rethrow | Reasoned: one line; the helper is already in core-next | +10 to 30 B |
| S6 the slots | Reasoned: an `explain` field, a pass-through, a `whenSpec` read; the clause printer is L11's | +40 to 100 B |
| `floor` and `createSystemCore` | The seam's `oldValue` read only (measured); the parts are not in the floor | +24 B measured; cap +60 B |
| A6 `why()` | Development only | 0 B in production |

**Reading the table:** the plan's +2.5 KB is near the middle estimate, by luck more than design. The low end needs a rebuild as tight as L7's, which L8 did not repeat. The high end is a straight port.

**The basis for +3.0 KB.** Three routes reach it. (1) A straight port of the 3.4 KB core-next lacks, at L8's isolated ratio: 3.4 x 0.88 = 3.0 KB. (2) 1.35's own cost in place. L8 measured it by removing the feature from a build: 1.3 KB against 2.7 KB in isolation, a ratio of 0.48. L9's removal is not measured, so apply L8's ratio: 3.4 x 0.48 = 1.6 KB in place, and L8 landed at 1.84 times its in-place cost, so 1.6 x 1.84 = 3.0 KB. (3) The middle estimate, 2.7 KB, after the misses of the two earlier layers: at L7's 12% it is 3.0 KB; at L8's 26% it is 3.4 KB. So **+3.0 KB is the high estimate. It covers a repeat of L7's miss and not of L8's.** I would not raise it on a guess: a larger cap is a larger allowance to spend. Revision 1 recommended +2.6 KB, which was below the high estimate and below both repeats. The cap is protected by timing instead: L9a reports the seam's bytes and `withMeta`'s before L9b starts, so a layer that is on course to pass +3.0 KB says so while the trace is still unbuilt, and not at the gate (L7 raised its cap four times).

| Fixture | Today | Cap (today plus) | At most |
|---|---|---|---|
| `minimal` | 32,350 B | +3.0 KB | 35,350 B |
| `two-module` | 32,439 B | +3.0 KB | 35,439 B |
| `aperture` | 37,238 B | +3.0 KB | 40,238 B |
| `full-entry` | 34,573 B | +3.0 KB | 37,573 B |
| `floor` | 10,967 B | +60 B | 11,027 B |

`floor`'s cap is the seam's measured 24 B plus a margin: the sketch is a lower bound (no `explain` field, no types), and 60 B is two and a half times what it measured.

**Under "Keep the order".** Every `createSystem` build carries the trace and meta until the beta, on or off. At the beta, both become imports (`trace()`, `introspect()`). The seam is small, and 71 B of it stays in the beta-wiring line (26,240 B to 26,311 B in the sketch), because the four fields live in the parts an app already uses, not in the trace. An app that skips the trace and meta parts drops everything else: about 2.6 KB at the middle estimate. That is the difference from L8, whose seam (about 0.4 to 0.8 KB) stays in every build.

## What the plan got wrong, or left out

- **Most of the row is built.** Observe, explain, origins and half of notify arrived at L2 to L6. L9's real work is the trace, meta and tags, and two counters.
- **Meta is not opt-in, even at run time.** 1.35 has no `meta` option; every system has `system.meta`. Only the trace is opt-in, and only at run time in the alpha.
- **A6 is not parity work, and half of it is L12.** 1.35 has no `why()`, so the oracle cannot check it, and the devtools graph lives in the devtools plugin, whose tests are L12.
- **`meta-query-does-not-watch` is L10's.** Its tests register definitions at run time.
- **Two L9 tests need `$store.registerKeys`**, the store half of L10's `registerModule` (B3).
- **`notify` has four members**, not the two core-next has.
- **Two placed tests prove nothing on v2 today** (U10, and the cached-array test).
- **The trace is mostly a reader of records, not a set of call sites.** 1.35 threads it through 24 places in its engine; core-next's kernel records replace most of that. Revision 1 said all of it. Four records lack a field (`oldValue`, `priority` and `deps`, the requirement diff, an effect's `deps`), and a sketch of them costs 78 B on `minimal`.
- **The L8 calibration was wrong.** L8 landed at about 0.82 to 0.88 of 1.35's isolated bytes, not 0.48, and L7 and L8 both landed above their high estimates. A1 below uses the measured ratio and puts the cap at the high estimate.
- **Data-form introspection was missing from the plan's row, and its tests sit at the wrong layer.** `whenSpec`, the observer's `whenExplain` and the clause tree in `explain()` are L9 surfaces. Their only tests are placed at L13 for a flush helper, and the evaluator they need is L11's (S6, U14).

## Decisions for the owner

**Questions for Jason.** Eight answers settle L9. The table after them gives each a product verdict, so Jason can bulk-approve.

1. **A1, the L9 size.** `withTrace` and `withMeta` as parts wired by `createSystem` (O1); `minimal`, `two-module`, `aperture` and `full-entry` each allowed up to +3.0 KB over their size today, and `floor` up to +60 B. **Recommend: approve.**
2. **A2, do deep fuzz runs gate L9, or report?** **Recommend: "Gate on short seeds; deep runs report"**, as at L8.
3. **A3, fuzz-ready before the gate.** **Recommend: approve L8's brakes unchanged.**
4. **A4, A6's `why()`.** **Recommend: build it in L9c, development only, after L9b; the devtools graph waits for L12.**
5. **(bh), the trace cannot be edited through a read.** **Recommend: approve.**
6. **(bi), every run reports `onTraceComplete` once.** **Recommend: approve.**
7. **(bj), the observer cap warns in production.** **Recommend: decline.**
8. **B1 to B4.** **Recommend: approve.**

A "no", or no answer yet, means the slice keeps 1.35's behaviour, pins it with a core-next test, and writes no entry.

| Decision | Product verdict | Recommendation | Option taken |
|---|---|---|---|
| **A1** the trace and meta live in parts wired by `createSystem`, and the L9 budgets | Same behaviour; every `createSystem` build grows by an estimated 2.2 to 3.0 KB, most likely 2.7 KB, until the beta, when apps that skip both drop it all | Approve: up to +3.0 KB on four fixtures, +60 B on `floor`; come back above that | **Approved**: O1, +3.0 KB on four fixtures, +60 B on `floor` |
| **A2** deep runs report, short seeds gate | No behaviour change; decides when L9 can merge | "Gate on short seeds; deep runs report" | **Taken**: gate on short seeds; deep runs report |
| **A3** fuzz-ready before the gate | No behaviour change; bounds the gate's cost | Approve | **Taken**: approve |
| **A4** `system.why()` in development | Better, new: a developer can ask why a derivation, constraint or effect ran. No production bytes. Not checked by the oracle | Build in L9c; devtools graph at L12 | **Taken**: build in L9c, development only; devtools graph at L12 |
| **(bh)** the trace's array is frozen, and each entry is frozen once settled | Better, visible but rare: code that sorts or annotates `system.trace` in place now throws in strict mode, where 1.35 silently changed the trace for every reader. A plugin that edits the entry `onTraceComplete` hands it throws too (U12) | Approve, in L9b | **Taken**: approve, in L9b; the freeze is one level into the trace's own lists and rows |
| **(bi)** a run pushed out of the trace still reports `onTraceComplete` when its resolvers end | Better, rare: a telemetry plugin no longer loses runs under load, or every resolver run when `maxRuns` is 0 | Approve, in L9b | **Taken**: approve, in L9b |
| **(bj)** the 101st observer warns in production too | Better, rare: an app with more than 100 observers learns why one is deaf. Costs a production string | Decline; development already warns, and the cap is a leak guard | **Taken**: decline; pin 1.35 (U7); no entry |
| **B1** the fuzz additions and harness rules 1 to 3 | No behaviour change | Approve | **Taken**: approve |
| **B2** a `trace-100` workload | No behaviour change | Approve | **Taken**: approve |
| **B3** the two `registerKeys` tests move to L10 | No behaviour change; a layer placement | Approve | **Taken**: approve |
| **B4** signing for approved rows | No behaviour change; the census needs signed entries | Approve | **Taken**: approve |

*"Owner instruction 2026-11-15: 'I approve you for to do everything'. Under it, Claude takes each recommended option below. The owner may overrule any of them."*

### A. Decisions

#### A1 where the trace and meta live, and the L9 budgets

- **What 1.35 does.** `trace:` and `system.meta` work with no import. The trace is threaded through 24 places in the engine; meta is about 250 lines of it.
- **What 2.0 would do.** `withTrace` and `withMeta`, parts wired by `createSystem`, like `withHistory` (L8, A1). The trace reads the kernel's records, so the core gains only a small seam: four record fields, 78 B on `minimal`. At the beta both become imports, and an app that skips them drops all of L9.
- **The measured basis.** core-next lacks about 3.4 KB of 1.35's code, measured in isolation (Size). L8 landed at 0.88 of its isolated figure and 1.84 times 1.35's in-place cost; L7 at 0.61. The seam, sketched, is 78 B on `minimal`. The middle estimate is about 2.7 KB. L7 and L8 both landed above their high estimates, so the cap is the high estimate, 3.0 KB; Size shows three routes to that number.
- **Product verdict.** Same behaviour. Every `createSystem` build grows by about 2.2 to 3.0 KB until the beta: `minimal` to about 34.6 to 35.4 KB.
- **Recommendation.** Approve O1 and a raise with a written reason in each slice: up to +3.0 KB over today's sizes on `minimal` (at most 35,350 B), `two-module` (35,439 B), `aperture` (40,238 B) and `full-entry` (37,573 B), and up to +60 B on `floor` (11,027 B: the seam's measured 24 B plus a margin). Revision 1 recommended +2.6 KB; L7 and L8 both landed above their high estimates, so revision 2 puts the cap at the high estimate. Do the attribution step first: find the bytes, move cold code, fold duplicates. L9a reports the seam's bytes and `withMeta`'s before L9b starts, so the real ratio replaces the estimate early. Come back if a slice lands above the cap, and before L9b if L9a is on course to.
- **Option taken.** The recommended one: O1, with a cap of +3.0 KB (+60 B on `floor`).

#### A2 do deep fuzz runs gate L9, or report?

- **What L8 chose.** "Gate on short seeds; deep runs report" (2026-11-10).
- **Why L9 is no different.** The trace's records are mostly a new view of events the fuzz already compares (hooks and `observe`), so the deep runs will mostly find new shapes of approved rows, as at L8.
- **Recommendation.** The L8 answer: the gate merges when the 21 PR seeds pass at L9; nightly deep runs report; any case triaged as a real 2.0 bug blocks at once.
- **Option taken.** "Gate on short seeds; deep runs report".

#### A3 fuzz-ready before the gate

- **What L8 chose.** L8-pre leaves at most 10 unexplained cases; the gate is capped at 3 runs, then goes to Jason; case files store v2's trace; abort respect is a drawn option; earlier follow-ups land first.
- **What L9 adds.** Nothing new to decide. Rule 1 (trace timing by contract) is the L9-specific brake, and it is B1.
- **Recommendation.** Approve L8's brakes unchanged, with the L8 gate as the precondition in place of L7's follow-ups.
- **Option taken.** Approved, as L8's brakes.

#### A4 A6's `system.why()`

- **What 1.35 does.** Nothing: there is no `why()`. A developer reads `system.trace` or `explain(requirementId)`.
- **Option 1, build in L9c (recommended).** `why(id)` for a derivation, constraint or effect: what it last read, which of those changed, and which write changed them, read from the graph core-next keeps. Development only, so production is unchanged. It adds a member the 1.35 types do not have, so it is declared in an alpha-only type augmentation and listed in the api-surface record.
- **Option 2, defer to the beta.** Build it with the beta's API changes, where new members are expected anyway.
- **Either way,** the devtools graph is built with the devtools plugin at L12, on the same graph read.
- **Recommendation.** Option 1, after L9b and only if L9a and L9b land inside A1. It is cheap, dev-only, and the plan chose it for this layer; it carries no parity risk because nothing in 1.35 can disagree with it.
- **Option taken.** Option 1: `why()` is built in L9c, development only. The devtools graph waits for L12.

### Candidate divergences

#### (bh) the trace cannot be edited through a read

- **What 1.35 does.** `system.trace` returns the same cached array until the next run, and the entries in it are the live ones. An item pushed onto one read shows in the next; an edit to an entry shows in `system.trace`, in `inspect().trace` and in what a later `onTraceComplete` reader sees (R7, P4, P9).
- **What 2.0 would do.** Freeze the cached array, so the "same array on repeat access" rule the tests pin still holds. Freeze each entry when it settles, so a pending entry can still be finished.
- **How deep the freeze goes.** A shallow `Object.freeze(entry)` freezes only the entry's own fields: `entry.factChanges.push(...)` would still work, so a plugin could still edit a settled entry through any of its lists. A deep freeze that follows every reference would reach the program's own values (`oldValue` and `newValue` in `factChanges` and `derivationsRecomputed` are the facts' values, and `meta` is the definition's), and would freeze its state. So the freeze goes one level into what the trace creates and owns: the cached array, each settled entry, the lists inside it and the row objects in those lists. It does not follow into `oldValue`, `newValue` or `meta`. A pending entry is not frozen, because the manager is still adding to its lists. Reasoned, not run; L9b pins it with a test that pushes onto `entry.factChanges` and edits a row.
- **Who throws.** Code in strict mode (every ES module) that edits a frozen entry throws a `TypeError`. That includes the plugins of U12: one that annotates the entry `onTraceComplete` hands it throws at the edit. Whether the plugin manager catches and logs that throw is not checked here; L9b pins it with U12.
- **Product verdict.** Better, visible but rare: code that sorts or annotates the trace in place throws in strict mode, where 1.35 silently changed it for everyone. A devtools panel that sorts a copy is unaffected.
- **Recommendation.** Approve, in L9b. It is the trace's counterpart of L8's approved (bd).
- **Option taken.** Approved: build in L9b, with the freeze one level into the trace's own structure.

#### (bi) every run reports `onTraceComplete` once

- **What 1.35 does.** A pending run pushed out of the ring loses its resolvers' bookkeeping, so it never reports. With `maxRuns` 0 or below, every run that starts a resolver is lost this way, while runs without one still report (R6, P3).
- **What 2.0 would do.** Keep a dropped run's bookkeeping until its resolvers end, then report it, though it is no longer in `system.trace`.
- **What it keeps.** The bookkeeping kept for a dropped run lasts only until that run's last resolver ends, and then goes. What is retained is bounded by the runs in flight (at most one record for each run that still has a resolver running), not by the number of runs, and `destroy()` clears it (R8). Reasoned, not run; L9b pins it with a test that runs more than `maxRuns` slow runs and checks the count afterwards.
- **Product verdict.** Better, rare: it matters to a telemetry plugin under load, or to `maxRuns: 0`, which reads as "keep nothing, report everything" and in 1.35 does neither consistently.
- **Recommendation.** Approve, in L9b.
- **Option taken.** Approved: build in L9b.

#### (bj) the observer cap warns in production

- **What 1.35 does.** The 101st `observe()` returns a no-op and hears nothing; development warns, production says nothing (S1, P18).
- **What 2.0 would do.** Keep the cap, and warn in both modes.
- **Product verdict.** Better, rare: only an app that leaks observers, or uses more than 100 on purpose.
- **Recommendation.** Decline. Development already says it, the cap exists to stop a leak, and a production string costs every build. Pin 1.35 (U7) and revisit with the beta's `observe`.
- **Option taken.** Declined: keep 1.35's silent cap and pin it (U7). No entry.

### B. Recommendations the owner may overrule

#### B1 the fuzz additions and harness rules

- **Recommendation.** In L9-pre: draw `maxRuns`, add the `meta` op and the tag option, project trace timing by contract (rule 1), each with a self-test (rule 2). They run on 1.35 from L9-pre, and on v2 only once `current` is L9.

#### B2 the `trace-100` workload

- **Recommendation.** 100 writes with trace on, then read `system.trace`; time and bytes; judged at 1.0 or better against 1.35 at the gate. Approve the shape before L9b.

#### B3 the two `registerKeys` tests move to L10

- **What the tree does.** `fact-tags-immutable` "refuses a re-registration of a key that already exists" and `fact-tags-recorded` "records a key registered through the store" call `system.facts.$store.registerKeys`. That is 1.35's store half of `registerModule`, which is L10's (`core/facts.ts:643–680`). core-next's store has no such member.
- **Recommendation.** A layer rule in `layers.rules.json` places these two tests at L10, with this reason, in L9-pre. The alternative is building `registerKeys` in L9a, ahead of the rest of dynamic registration, which splits L10's feature across two layers.

#### B4 signing

- **Recommendation.** L9b signs the entries for approved rows "on the owner's instruction", as at L2, L3, L7 and L8 (GATE-2 rule 1). Declined rows get no entry.

### C. Engineering defaults that keep parity (no decision needed)

- **`maxRuns` defaults to 100**, and any object turns the trace on, as 1.35.
- **The trace is read through `inspect().trace` as a `structuredClone`**, as 1.35.
- **`destroy()` leaves `system.trace` as `[]`**, not null, as 1.35 (P8).
- **Resolver errors are stored as `String(error)`**, and the anomaly texts are 1.35's.
- **`meta.subscribe`'s tag list narrows nothing**, and its listener is called with no argument, as 1.35.
- **Fact tags are copied once, at definition time**, and an unrecorded key answers `undefined`, as 1.35.
- **The observer cap is 100**, development warns, production is silent, unless (bj) is approved.
- **`notify`'s four members share the depth-4 re-entry cap**, as 1.35.
- **The "not built" messages for `trace` and `meta.*` go** when their parts land.

## Evidence: probes

**What I ran.** One probe script, with real timers, against the published 1.35 (`packages/conformance/node_modules/directive-v1/dist/development` and `dist/production`, version `1.35.0`): `node probe.mjs <dist> <out.json>`, exit 0 in both modes. It does not live in the repo; L9-pre turns each probe into a test (U1 to U12). Development and production gave the same results for every probe except P18, where only development warned.

- Probe source: `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l9/probe/probe.mjs`
- Output: `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l9/probe/out-dev.json` and `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l9/probe/out-prod.json`
- Forced-L9 runs: `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l9/v2.json`, `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l9/v2dist.json` and `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l9/diff.json`, summarised in `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l9/summ.txt`, failure messages in `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l9/detail.txt`, and the join to `layers.json` in `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l9/join.txt`
- Size: `node measure.mjs <repo>` in `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l9/size/`, exit 0; output in `size.log` beside it, with each bundle as `<piece>.min.js`; core-next's fixtures in `next-size.log`
- Mutation runs: `gh run list --workflow mutation-nightly.yml` and `gh run view --log --job <id>`, saved as `mut-runs.json` and `mutlog-<job>.txt` in `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l9/`

**What I ran in revision 2.** Each command's output went to a file, and I read the files back, not a pipe.

- Seam sketch: `python3 -I sketch.py` applied the four edits to a copy of `packages/core-next` (exit 0). `node scripts/size.mjs` in the copy gave the baseline, which reproduced Size exactly (`minimal` 32,350 B, `two-module` 32,439 B, `floor` 10,967 B, `aperture` 37,238 B; exit 0), and then the sketch's sizes in the table under "Where it lives" (exit 1, only because every fixture is over its budget by design). Files: `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l9/seam/sketch.py`, `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l9/seam/sketch.diff` (the 93-line diff), `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l9/seam/base.log` and `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l9/seam/after.log`. Not committed; not type-checked; not run.
- S6 probe (P21): `node s6.mjs <dist>` from `packages/conformance` against the published 1.35, `dist/development` and `dist/production`, exit 0 for both; `cmp` of the two outputs: identical. Files: `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l9/probe/s6.mjs`, `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l9/probe/s6-development.json` and `/private/tmp/claude-501/-Users-jasonwcomes-Desktop-Sizls/ebd6ca9b-2d9b-4900-914a-7ddf7f3f3b5d/scratchpad/l9/probe/s6-production.json`.
- **Read, not run:** the file and line citations in this revision (each checked by reading the file at the line given; `observe.ts` is 186–191 for the catch, not the 168–176 the review gave, which is where `withObserve` starts); S2's rethrow (`engine.ts:3026–3029`); M7's order in core-next (`core.ts:1069–1077`); the claim that the rest of 1.35's trace entry is covered by existing records; and the 29,960 B pre-L8 size, taken from the design review.

Every probe builds one module, `account`: facts `email` (tagged `pii`), `plan`, `seats` and `gate`; derivations `contact` (reads `email`), `cost` (`tagBoundary: true`) and `shown` (reads `email` only while `gate` is true); an `upgrade` event; a `charge` constraint and an async `charge` resolver (5 ms) that sets `seats` to 0, or throws "card declined". A plugin records `onTraceComplete`.

| Probe | Steps | 1.35 |
|---|---|---|
| P1 | No `trace` option; start | `trace` null; `traceEnabled` false; no `trace` key in `inspect()` |
| P2 | `trace: true`; start; 104 writes, each awaited | After start: 1 entry, settled, fact changes `email, plan, seats, gate`, an effect with `triggeredBy: []`. After the writes: 100 entries, ids 6 to 105; 105 `onTraceComplete` calls |
| P3 | `maxRuns: 0`, and `-1`; start; `upgrade` (starts the resolver) | Both: an empty list; `onTraceComplete` for runs 1 and 3, not run 2 |
| P4 | Read `trace` twice; push onto one; read again. Edit `trace[0].causalChain` | The same array; the pushed item is in the third read (101 items). The edit shows in `trace` and in `inspect().trace` |
| P5 | `maxRuns: 10`; `upgrade`; read while the resolver runs; wait | Mid-flight: run 2 `pending`, 1 resolver started, no completion yet. Later: the same object, `settled`, chain "plan changed → charge constraint hit → CHARGE requirement added → charge resolved (Nms)"; then run 3, "seats changed" |
| P6 | Write `seats` its current value | No entry added |
| P8 | `destroy()`; read `trace` | `[]` |
| P9 | Edit `inspect().trace[0]` | `system.trace` unchanged |
| P11 | As P5, the resolver throws | Run 2: "… → charge errored", `resolversErrored` `["Error: card declined"]`, anomalies `["1 resolver(s) errored"]`. Run 3: no fact change, chain "charge constraint hit" |
| P12 | `meta.fact("email")` | `{ label: "Email", tags: ["pii"] }`, frozen, the same object as the schema type's `_meta`; tags frozen; the schema type frozen |
| P13 | `byTag("pii")` before `contact` is read | `email` authored; `contact` and `shown` inherited. Rows not frozen; their `meta` frozen |
| P14 | `carriesTag` for an unknown fact, `seats`, `contact`, `cost`, kind `"bogus"`, kind `"__proto__"`, the module, an unknown derivation | `undefined`, `false`, `true`, `false`, `undefined`, `undefined`, `false`, `undefined` |
| P15 | `meta.derivation` for `contact`, `cost`, an unknown id | `{ inheritedTags: ["pii"] }`, `{ tagBoundary: true }`, `undefined` |
| P16 | `meta.subscribe(["pii"], …)` and `meta.subscribe(…, { immediate: true })`; write `email`; open `gate` | One call, from `immediate`. None for the write, none for the gate |
| P17 | `inspect()` counters on that system | `observedDerivations` 0, `pendingInvalidations` 0 |
| P18 | 100 observers, then a 101st; write; free one; add another; write | The 101st heard nothing and got a function back; the new one after freeing heard events. Development warned "Maximum observer limit (100) reached …"; production did not |
| P19 | `t.string().meta({ tags })`; `createSystem`; empty `tags` | `meta.fact` still `["pii"]`; `carriesTag` still true |
| P20 | `Object.keys(system.notify)` | `clobberLoopDetected`, `clobberLoopResolved`, `guardrailBlocked`, `guardrailCoverage` |
| P21 | A constraint with a data-form `when` (`{ phase: "red", elapsed: { $gte: 30 } }`) and one with a function-form `when`, each in its own system; observe `constraint.evaluate`; start; write `elapsed` to 30; read `inspect().constraints` and the `explain` of the unmet requirement | Data form: `whenSpec` is the object; the event has `whenExplain` `[["phase",true],["elapsed",true]]`; `explain` has "Predicate clauses:" and "✓ phase $eq red (actual: red)". Function form: no `whenSpec` key; the event has no `whenExplain` key; `explain` lists the relevant facts and has no clause section |

**Reading the table:** P3 is (bi), P4 is (bh), and P18 is (bj). P13 and P16 are the two meta surprises pinned as U4 and U3, and P21 is S6, pinned as U15 and U16. The output files key each probe by the script's own names: P1 to P11 are `T1_off` to `T11_error` (there is no P7 or P10), P12 is `M1_fact`, P13 `M3_byTag_*`, P14 `M4_carries`, P15 `M5_derivation`, P16 `M2_subscribe`, P17 `I1_counters`, P18 `O1_cap`, P19 `M7_callerEditsTags` and P20 `N1_notify`; P21 is in its own file, keyed `data` and `fn`.
