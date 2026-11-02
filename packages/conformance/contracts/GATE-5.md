# Phase 3 gate decisions: the L6 gate

Date: 2026-11-02. Jason approved the L6 rows of the Directive 2.0 decisions
page (https://claude.ai/artifact/Ex2LGyfVqFNztHCZrj9UkR) on 2026-11-01:
"Approve (ai)", "Approve (al)", and "Approve all recommendations" for the rest.
He asked Claude to sign the entries for the rows he approved, on his behalf,
as at the L3, L4 and L5 gates (GATE-2.md, rule 1). On 2026-11-02 he extended
that to golden files: "Extend it; Claude signs (Recommended)".

## What the L6 gate does

`layers.rules.json` `current` is `"L6"`: core-next runs every test and every
differential scenario placed at L6 or below (snapshots and `restore()`, the
persistence plugin, schema introspection, `.default()`, `.refine()`), and the
fuzz generates v2 cases up to L6. The ratchet (`v2-passing.json`) gained
101 tests and lost none, tested by name against the file on main; it
holds 1,694.

Each difference the diff harness shows at L6 is recorded in
`diff/divergences.json`, one entry per difference, each naming its scenario,
stream, kind, operation and step (and the path, for a changed record). There
are 169, all for hand scenarios; the fuzz needed none. Two golden cases differ
by an approved row, and each has a signed `goldenChanges` entry in
`api-changes.json`.

## The L6 decisions

The middle column says what each row decides, in plain words. The quotes in
the right column are Jason's own words.

| Row | What it decides | Outcome |
| --- | --- | --- |
| Size | `minimal` may grow to 28.8 KB for L6 | "Approve up to 28.8 KB". Measured 28,638 B at the gate (below) |
| (ag) | A development `restore()` checks the whole snapshot before it writes, so a bad one writes nothing | "Approve all recommendations", 2026-11-01. Built in L6a (#332) |
| (ah) | Development warnings for `restore()` before `initialize()` and for a `hydrate()` still pending, keyed on `initialize()` | "Approve all recommendations", 2026-11-01. Built in L6a (#332); its false warning fixed in L6b (below) |
| (ai) | The persistence plugin restores inside `initialize()`, in one order: module inits, then the saved data, then `initialFacts` and hydrate | "Approve (ai)", 2026-11-01. Built in L6b (#335) |
| (ak) | The plugin skips saved keys the schema no longer has | "Approve all recommendations", 2026-11-01; refined twice on 2026-11-02 (next section). Built in L6b (#335) and #338 |
| (al) | `.default()` fills each fact still `undefined` as the last step of `initialize()` | "Approve (al)", 2026-11-01; a filled default is saved, "Save it like any value (Recommended)", 2026-11-02. Built in L6c (#337) |
| (am) | A failed `.refine()` adds its message to the development error | "Approve all recommendations", 2026-11-01. Built in L6c (#337) |
| A4 | The alpha keeps 1.35's saved formats | "Approve all recommendations". Nothing changes on disk |
| A5 | The `aperture` fixture is the Aperture lab's three Directive files, verbatim, in production | "Approve all recommendations". Built in L6a (#332) |
| B4 | Distributable snapshots move to L12 | "Approve all recommendations" |
| B5 | Schema introspection stays at L6, reached from the full entry only | "Approve all recommendations". Adds 0 B to `minimal` |
| B6 | `restore()` lives in a part, not the core | "Approve all recommendations". Built in L6a (#332) |
| B7 | A `frame-loop-persist` workload judges the gate | "Approve all recommendations". Built in L6b (#335); result below |
| (af), (an), (ao), (aj) | Declined: a snapshot keeps sharing nested values (af); `.transform()` keeps dropping the checks before it (an); `hydrate()` keeps refusing a namespaced snapshot's flat keys (ao); the plugin keeps refusing Date facts (aj) | "Approve all recommendations": each stays as 1.35 |

### (ak) and its two refinements

The first L6b build skipped a stale key on load, as approved, and then left it
out of the next save. So a user who rolled back to an older app would find the
value gone. Jason was asked whether the plugin should keep such keys, and
chose "Keep them in storage (Recommended)": the plugin skips them on load and
writes them back unchanged on every save. Production storage then holds 1.35
production's bytes, including the U10 envelope case.

The L6-gate-prep correctness review then found that 1.35 development throws on
a stale key and restores only partway, so in development a rollback to 1.35
lost values on 2.0's bytes. Jason chose "Drop stale keys in dev (Recommended)":
in development only, the save leaves stale keys out, as 1.35's development save
does. #338 built it; production still writes them back.

**Follow-up (logged):** in production, a program that deletes a kept stale key
itself, which only untyped code can do, removes it from storage on 1.35 but
not on 2.0.

## The signed entries

All 169 carry `approvedBy: "Jason Comes"` and `date: "2026-11-02"`, and each is
for a hand scenario (`engine: "v2"`, one `step` each). Each reason names its
row and ends with the signing sentence quoting that row's approval.

| Row | Scenario | Entries | What differs |
| --- | --- | --- | --- |
| ag | "restore() with an unknown key or a bad value is half-applied in development" | 32 | the two bad restores (steps 2 and 5): 1.35 writes the keys before the bad one, 2.0 writes nothing |
| ai | U7a: "a persisted fact loses to an init that sets it, and survives ??= and a read" | 30 | the saved value beats the init that sets it; the init that reads a persisted fact sees `undefined`; the restore moves from setup to `initialize()` |
| ai | "the persistence plugin restores, saves debounced, and excludes keys" | 26 | the saved values beat the init's, so the later reads and saves carry them; the debounce timing and the excluded key match 1.35 |
| ai | U7b: "initialFacts beat the persistence plugin's restore" | 10 | `initialFacts` still win; only where the restore happens differs |
| ai | U15: "a namespaced system persists and restores flat ns::key keys" | 12 | the flat `c::n` key restores after the module init, so the saved value wins; the key format is unchanged |
| ai + ak | U9: "a stale saved key aborts the development restore partway" | 21 | 1.35 development throws on the stale key and leaves `label` unrestored; 2.0 warns and restores the rest |
| al | U11: "a .default(): a fact init leaves alone, one a ??= init sets, one it sets to undefined (U11)" | 19 | 2.0 fills the untouched fact and the one the init sets to `undefined`, in one batch at start; the `??=` fact and the plain init write are the same on both |
| al | U11: "a .default() with initialFacts: one they give, one they leave out (U11)" | 18 | the fact `initialFacts` gives is the same on both; 2.0 fills the three it leaves out |
| am | "t.* refine, transform, brand and wrong types in development" | 1 | the development error carries the `.refine()` message |

The ids are `l6-quirk-<rows>-<scenario slug>-<stream>-<kind>-<op>-step<N>`.
The first gate run signed 134 entries (commit 31d54fe3). Two U9 entries
for the saved `removedLater` key went at this run: after #338, 2.0's
development saves drop it as 1.35's do, so they covered nothing. The (al)
entries are new; their scenarios came in #339.

## The signed golden changes

`goldenChanges` (STABILITY.md "Golden changes") holds two entries, both in the
`read-1.35` direction: the workspace reading 1.35's data. Each names its case,
engines and row, and records the exact 2.0 value. A different 2.0 value, or
1.35's own, still fails. Each reason ends with the signing sentence and
"(goldenChanges signing per 'Extend it; Claude signs (Recommended)',
2026-11-02)".

| Case | Engines | Row | 1.35.0 | 2.0 (`expected2`) |
| --- | --- | --- | --- | --- |
| "persistence read" | v2, v2:dist | (ai) | `{"count":0,"label":"start","tags":[]}`: the script's init overwrites the restore | `{"count":2,"label":"middle","tags":["a",{"nested":[1,2]}]}`: the saved values win |
| "U10 production" | v2:dist:prod | (ak) | restored `{"v":1,"schema":{"m":1},"facts":{"n":6},"n":0}`, nothing logged | restored `{"n":0}`, nothing logged: the three keys the schema lacks are skipped |

Rollback stays strict. Every `1.35-reads` case (1.35 reading what 2.0 wrote)
passes with no entry on v2, v2:dist and v2:dist:prod: "persistence re-save",
"persistence write", and the rollback of every U10 start. That includes "U10
production rollback", because the production save writes the skipped keys
back ("Keep them in storage (Recommended)"), and "U10 development rollback",
because #338 drops them in development as 1.35 does. Claude signed no
`1.35-reads` entry.

## Fixes found in review

- **L6b, two systems sharing one plugin instance could lose data (#335).**
  The first build did not keep the saved data it loads per system. It is now
  held per system, so two systems on one instance each restore their own
  data, as in 1.35. The Opus correctness review found it.
- **L6b, the `<M>` type parameter (#335).** 1.35's `<M>` type parameter on
  the persistence plugin was missing; it is back.
- **#334, the census self-test.** The options-form self-test used
  `loggingPlugin` as an entry core-next had not built. L6b builds `/plugins`,
  so the test now uses a synthetic entry, as the next test does.
- **The (ah) false warning, carried from L6a.** Under (ai) the plugin restores
  inside `initialize()`, where the L6a "restore before initialize" warning
  fired falsely. The plugin applies saved data as a hydrate batch, not through
  `restore()`, so the plugin's normal flow warns nothing.
- **L6c, shared object defaults (#337).** Object and array defaults were one
  shared object across systems; each fill now gets its own copy.
- **Oracle fixes before the gate (#339, #340).** U10 rollback now runs from
  every stored start, not only the flat one; the persistence rollback reader
  has no init, so 1.35's read can fail; and "persistence write" checks the
  load, change and save path.

## The triage at this gate

Nine mutants of 1.35 were deferred as `feature-layer` L6: three in
`engine.ts` (`restore()` input checks, lines 4299, 4304 and 4311) and six in
`schema-builders.ts` (the base `.refine()`, lines 205 to 208). With `current`
at L6 they must be killed or counted. Each is now `later-layer` L6. The gate=L6
mutation run 41430058165 (at 3adf0c41, ceiling L6) records every one Killed,
by the test its note names: the three U14 cases of `l6-snapshots-oracle` ("that
is not an object…", "whose facts is missing…", "that holds a
prototype-polluting key…") and `l6-schema-oracle` ".refine() on a base builder
(U12) > keeps the type check, adds its predicate, and records { predicate,
message }". Those tests are placed at L6, and a full run holds every test a
ceiling-L6 run holds. The older gate=L6 run (41385391297) predates the tests
and shows them NoCoverage.

## Results

**Fuzz** at the L6 ceiling, run at the first gate commit. Since then 2.0 has
changed only in what a development save writes for stale keys (#338), and no
fuzz entry changed, so the runs stand. A passing seed means every compared case
showed only differences an existing signed entry covers.

- Pull-request count (287 cases a seed; seeds 1 to 20 and 24301): all 21 pass.
  Per seed, 118 to 140 cases also ran on 2.0, and 7 to 17 ended early at an
  `ends` stop. Seed 5 discarded one 1.35 runaway; no seed discarded a case
  after a stop.
- Deep runs (`DIFF_FUZZ_RUNS=5000 --testTimeout=1200000`):

| Seed | Cases (on 2.0 too) | Result | Time | Ended early at an `ends` stop | Discarded after a stop |
| --- | --- | --- | --- | --- | --- |
| 24301 | 7,000 (3,174) | passes, 6,999 compared | 328 s | 255 | 1 |
| 1 | 7,000 (3,179) | passes, 7,000 compared | 235 s | 270 | 0 |
| 2 | 7,000 (3,188) | passes, 7,000 compared | 230 s | 297 | 0 |

The runs shared one machine, so the times are not a speed measure. Seed
24301's one discard is the quirk-p case from GATE-4.md.

The census at this gate (seed 24301, PR count) reads: ``[census] fuzz: 287
cases compared (seed 24301), 135 of them on v2 too, 11 ended early by an `ends`
divergence (at step 3.7 on average; 0 at step 0)``. It has no "discarded after
a stop" clause: that seed discards none at the PR count.

**Bench (B7).** `frame-loop-persist` (the frame-loop-source frame with the
persistence plugin saving one of its 20 writes, debounced) measured at the
gate commit, production build, 8 rounds: 1.35 takes 13,186 ns a frame and 2.0
9,951 ns, so 2.0 takes 74% of 1.35's time (range 72% to 79%). That is inside
B7's bar of 80%, and matches L6b's 74% (#335). The bench flagged the machine as
busy (load about 8 on 14 cores); it measures thread CPU time, which ignores most
of that noise. 2.0 also allocates less a frame: 23,435 bytes against 30,233.

## Sizes

Measured with `pnpm size:check` in `packages/core-next` (esbuild, gzip level
9) at this gate. Both engines are built the same way since #333: production,
with development text stripped. Every fixture is under its budget in
`size-budgets.next.json`; the gate raises none.

| Fixture | 2.0 (bytes, min+gzip) | Budget | At the L5 gate | 1.35 |
| --- | --- | --- | --- | --- |
| minimal | 28,638 | 28,690 | 28,314 | 49,313 |
| two-module | 28,729 | 28,780 | 28,403 | 49,414 |
| aperture | 33,541 | 33,592 | | 53,871 |
| floor | 10,446 | 10,450 | 10,417 | |
| graph.ts alone | 1,797 | 1,850 | 1,797 | |
| full entry (every export) | 31,551 | 31,602 | 30,448 | |

The minimal app on 2.0 is 58% of its size on 1.35 (20,675 bytes smaller), and
162 bytes under the approved 28.8 KB. The Aperture lab is 62% of its 1.35 size
(20,330 bytes smaller). L6 cost `minimal` 324 bytes: the `restore()` part and
its seams in L6a (+150 B), the plugin's seam in L6b (+28 B) and the `.default()`
fill in L6c (+146 B; the `.refine()` message is development text, 0 B here). The plugin itself and schema introspection are imports,
outside `minimal`.
