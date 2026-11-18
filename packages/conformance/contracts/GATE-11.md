# Phase 3 gate decisions: the L11 gate

Date: 2026-11-18. Jason approved the L11 predicates-and-rule-tools RFC
(`rfc-l11-predicates.md`, revision 2, "Decisions for the owner") on
2026-11-15 with "I approve you for to do everything". Under that approval
Claude took the recommended option for rows (bp), (bq), (br) and (bs). On
2026-11-17 Jason answered the gate's open questions with "Approve all as
recommended (Recommended)". Claude signs the entries for approved rows on
his behalf, as at the earlier gates (GATE-2.md, rule 1). This record covers
gate runs 1 and 2, of at most 3.

## What the L11 gate does

`layers.rules.json` `current` is `"L11"`. core-next runs every test and
every differential scenario placed at L11 or below: data-form predicates
for `when`, `on`, `compute`, `patch` and a resolver's `key`, and the rule
tools. The fuzz also compares its data-form phase on v2.

**Run 1 is not green.** It moved `current` to L11, signed 66 entries for
approved rows, and cut U1 to U3 down to what both engines share. It then
stopped on three 2.0 parity differences in core-next (Stops). #429 fixed all
three.

**Run 2 is not green.** It merges main at 381a52ec (#429), narrows run 1's
(bc) entry to (bc)'s own message, re-runs the PR and deep seeds, and runs
every check. Run 1's stop specs now replay clean. Every PR-seed and
deep-seed failure matches an approved row: quirk b, (ay) and row t. Run 2
did not commit the entries those failures need, for the reason given in
Stops. The 14 L11 feature-layer mutation entries have no killer: the gate=L11
run reports all 14 as NoCoverage.

## The L11 decisions

| Row | What it decides | Outcome |
| --- | --- | --- |
| (bp) | A global regex in a data form fires inside a system; a direct call alternates | Taken, "I approve you for to do everything" (2026-11-15). 1.35-side pin U1 |
| (bq) | A combinator beside a fact key is refused, with the compilers' message | Taken, the same words. 1.35-side pin U2; 54 hand entries |
| (br) | A data form that names a derivation warns in development | Taken, the same words. 1.35-side pin U3 |
| (bs) | An unknown operator throws at registration | Declined as recommended ("I approve you for to do everything"); U4 pins 1.35 |
| (bt) | Declined | 1.35 stands; no entry |
| O3 | Not taken | — |
| (ce), U18 | A constraint's `unregister` keeps the removed rule's `whenSpec`, so a later function-form `register` under the same id reports the old clauses. RFC R3: "Copied until probed. L11-pre probes it (U18). If it is confirmed, it is a candidate row (bu), opened then and not decided here." L11-pre confirmed it. 2.0 keeps the stale spec as 1.35 does | "Approve all as recommended (Recommended)" (2026-11-17), which also gave it a new letter, because (bu) collides with the L12 RFC's (bu) to (by). (ce) is the next free letter after (cd) in every GATE-*.md and RFC. Parity, so no entry |
| (y) | Approved 2026-11-01 (its GATE record) | 6 hand entries (run 1) |
| Quirk j | GATE-1/GATE-2 | 1 fuzz entry (run 1) |

## The signed entries (run 1, as committed)

| Row | Hand entries (records) | Fuzz entries |
| --- | --- | --- |
| (y) | 6 (6): the effect `on`-gate disable/enable scenario. L11a's six drafts excuse the same records, so they were deduped | 0 |
| (bq) | 54 (57): U2's diff scenario, where 2.0 refuses the spec at `createSystem` | 0 |
| Quirk j | 0 | 1: `l7-quirk-j-fuzz-external-batch-start-extra`, the batch path (seed 8 at L11) |
| Quirk b, keyed | 0 | 4: `l11-quirk-b-keyed-*`, `when` resolverRejects + resolverKey, where the requirement is `{ at, type }` and the id is the key's answer |
| (bc) | 0 | 1: `l11-fuzz-bc-console-error-extra-import-failed` |
| **Total** | **60** (63 records) | **6** |

## The (bc) narrowing (run 2)

Run 1's (bc) entry was wider than its row. It bound the second console
argument by the contract's mask alone (`{ "$incidental": "object" }`), so it
excused any 2.0 history import failure in a roundtrip case.

Run 2 adds a `$text` class, `historyIndexNotASnapshot`
(`diff/fingerprint.ts`). It reads the recorded error before the mask and
admits only `{ $error: { name: "Error", message: "[Directive] Invalid
history data: currentIndex must be the index of a snapshot" } }`. A `$text`
pattern may now stand where an object is masked, as well as a string. The
entry's second argument is now `{ "$text": "historyIndexNotASnapshot" }`.

The self-test is in `diff/self/history-triggers.test.ts`, "(bc)'s console
entry excuses only (bc)'s own import failure". It admits (bc)'s own failure.
It rejects three other import failures ("currentIndex must be a number",
"snapshots must be an array", "Unexpected token") and a TypeError with
(bc)'s text. Fuzz seed 5's spec still replays ok, covered by this entry
alone.

## The pins (run 1)

U1, U2 and U3 in `l11-predicate-pins-oracle` (and U1 in its production
file) keep only what both engines share, and name their rows (#339's
mechanism). They were edited in `packages/core`'s originals and re-ported.
core-next's `src/__tests__/l11a-predicates.test.ts` pins 2.0's side:

- "(bp) a global regex fires inside a system; a direct call alternates";
- "(bq) a combinator beside a fact key is refused with the compilers' message";
- "(br) a data form that names a derivation warns in development".

## The mutation conversion

**Not done.** The gate=L11 run 44259509948 (mutation-nightly.yml on main)
concluded `failure`. Every mutate shard passed; "Per-shard scores" failed.
The 14 L11 `feature-layer` entries are all in `engine.ts`, lines 3920 to
3950. They are `system.explain()`'s per-clause breakdown of a data-form
constraint `when`: a combinator header (`$all`/`$any` with its fraction,
`$not` with its note) and the child indentation. Stryker reports all 14 as
**NoCoverage**: no test explains a constraint whose data-form `when` has a
combinator. They cannot become `later-layer` with a named killer.
`conformance:checks` fails on "no feature-layer entry is for a built layer"
until they do.

Run 3 needs an oracle pin first: an `explain()` of a requirement from a
constraint whose `when` is `{ $all: [...] }`, `{ $any: [...] }` and
`{ $not: ... }`, with a passing and a failing child, placed at L11, in
`packages/core` and ported. Then a gate=L11 mutation run names the killers.

## Results (run 2)

Each exit code is the command's own, read from its file.

| Check | Exit | Result |
| --- | --- | --- |
| `v2`, `v2:prod`, `v2:dist`, `v2:dist:prod` | 0 each | 2,505, 106, 2,505 and 107 passed, 0 failed; 1,048 skipped by the layer gate on `v2` and `v2:dist` |
| `v1`, `v1:prod` | 0 each | 3,554 and 106 passed |
| `ratchet --update` | 0 | +4, none lost; 2,635 pass on source and dist |
| `check:expects` | 0 | 201 files, 7,885 assertions, identical to a fresh port |
| `oracle:update` | 0 | after the last oracle change |
| `conformance:checks` | 1 | 245 passed, 1 failed: "no feature-layer entry is for a built layer" (the 14 NoCoverage entries) |
| diff self-tests (`diff/self`) | 0 | 24 files, 353 tests |
| `pnpm census` | 1 | 5 problems: `conformance:diff` and `conformance:checks` exit 1; the default-seed fuzz (seed d, quirk b with a list key); the feature-layer check; and the `row-bc` group stale (the census seed draws no (bc) case), which run 2 then pinned (below). The census was not re-run after the pin |
| Root biome, error level | 0 | 1,526 files |
| `pnpm -r --filter './packages/*' typecheck` | 1 (`--no-bail`) | Only `ai-harness`, `cli` and `mcp` fail, each on modules that are not built locally (`@directive-run/ai`, `scaffold`, `timeline`, `lint`, `sandbox`, a generated registry): the known local build gap. conformance and core-next pass |
| The 21 PR seeds at L11 (120 s; 1,800 s for 5, 7, 9 and 11) | see below | 3 exit 0 on the first pass (2, 3, 13), plus 5 and 11 on the slow pass and 12 on the rerun. 15 fail, each on an approved row's shape (below) |

**The PR seeds, case by case.** Each failing spec was saved from its log
and replayed (`$G/specs`, `$G/replay`). Seeds 12 and 14 ran once while run
2 was editing `divergences.json`, which `runScenario` reads per case. Both
were rerun: 12 passes, and 14 fails on a different case.

| Shape | Seeds | Row | What is missing |
| --- | --- | --- | --- |
| A post-cancel resolver error, where the resolver's `key` is a **list** (`["type"]`), so the requirement id is its stable JSON, `"A0"` with the quotes. Every case's erroring id is in an earlier `requirement.canceled` | d, 1, 6, 7, 9, 10, 15, 16, 20; deep 1, 2, 24301 | quirk b (keyed twins) | the keyed twins' `id` class admits only a function key's `A0`; a twin for the resolver-threw console warning, which `l2-quirk-b-console-warn` covered until #354 removed it as stale |
| An `onSnapshot` 1.35 makes while paused, whose facts include L11's template-patch string fact `tx` | 4, 8, 17, 18, 19 | (ay) | the `snapshot` class and the L10 twins' class name no `tx` (as at the L10 gate for `zf`, `zw`, `g0`, `g1`) |
| A resolver's own write retracts its constraint in a **batched** case. 1.35 also reports the cancel; 2.0 does not, and the compare pairs 1.35's `r1` cancel with the batch `rb`'s | 14 | row t (reasoned from the trace) | a batch-pairing twin of row t's entries (`requirementId` and `requirement.item`) |

**Proof of the first two shapes.** The fingerprint classes were widened in
the working tree only, then reverted. `requirementType` admitted `"A0"`,
and both snapshot classes admitted `tx`. With that, every quirk b spec
(d, 1, 6, 7, 9, 10, 15, 16, 20; deep 1, 2, 24301) and every (ay) spec (4,
8, 17, 18, 19) replays with 0 unexplained. The trailing differences in some
cases (a reconcile pass, a `disabled` constraint, the history record) are
covered by the original entries' `ends` once the first record is excused.
Seed 14's spec still has 13 unexplained differences with that widening; row
t's fit is reasoned, not proven.

## Deep runs: report mode (A2)

Run as the nightly does (`DIFF_FUZZ_RUNS=5000 DIFF_FUZZ_BATCH_REPORT=1`, an
8 GB heap), in the background beside the PR seeds.

| Seed | Exit | Time | Reported cases (batched) | Stopped on |
| --- | --- | --- | --- | --- |
| 1 | 1 | 20 min | all:857, all:1028, all:1395, all:2195, all:2816, up to L11#233 | up to L11: quirk b, list key (above) |
| 2 | 1 | 21 min | all:2247, all:2890, all:3992 | quirk b, list key |
| 24301 | 1 | 13 min | all:422, all:687, all:2654, all:3053 | up to L11: quirk b, list key |

The "all" cases are the batched cases GATE-8 and GATE-9 list at L9 and L10,
with the same case numbers: L7 batch shapes, report-mode follow-ups.
1:up to L11#233 is new and batched. It was reported, not replayed: a
follow-up for run 3.

Stale signed entries: the census found one stale group, `row-bc`. Run 2 pinned fuzz seed 5's spec for it in `diff/fuzz/pinned.json`, one case for the group, as the L8 to L10 gates did.

## Owner row candidates

None new. Every run 2 failure is an approved row's shape.

## Stops

- **Run 1's three stops are closed by #429.** These are `onDefinitionAssign`'s
  old value (seeds 3, 10), `unregisterModule` after `stop()` (seed 1), and
  the keyed id after a refused unregister (seeds 8, 14). Run 1's specs s1,
  seed3, s5 and s24301 replay ok=true on the merged tree, and no PR seed
  fails on those shapes.
- **Run 2's entries for quirk b (list key), (ay) (`tx`) and row t (batch
  pairing) are not committed.** The session's permission classifier refused
  the edit that signs them, a new `approvedBy: "Jason Comes"` entry plus a
  widened class on signed entries, as "undermining oversight". Run 2 did
  not try another route. Until they land, 15 of the 21 PR seeds and all
  three deep seeds fail. The rows are approved: quirk b (GATE-1, decisions
  page row 2, 2026-11-01), (ay) ("Approve all as recommended
  (Recommended)", 2026-11-10) and row t (2026-11-01). Jason, or a session
  he allows, signs them.
- **No difference matches no row.**

## Follow-ups

- The 14 NoCoverage `explain()` lines (above) need a pin before the
  conversion.
- 1:up to L11#233 (deep, batched): replay it.
- The keyed twins' `at` is `{ $like: integer }`. The model can draw
  `at: null`, which the twins do not admit. No case shows it yet.
- Edits to `divergences.json` during a run change that run's own entries
  (`readDivergences` per case). Seeds 12 and 14 were rerun for this.
