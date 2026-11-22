# Phase 3 gate decisions: the L12 gate

Date: 2026-11-21 to 2026-11-22. Jason approved the L12 plugins RFC
(`rfc-l12-plugins.md`) on 2026-11-15 with "I approve you for to do
everything"; each row was taken as its "Option taken" says, and (bw) is
declined. Row (az) is an L8 row: "Approve all as recommended
(Recommended)" (2026-11-10). On 2026-11-19 he accepted the plugin bench
miss: "No, accept the gap for now (Recommended)". On 2026-11-22, asked
whether the (bx) exception should cover its knock-on effects, he answered:
"Yes, widen (bx) to its knock-on effects (Recommended)". Claude signs the
entries for approved rows on his behalf (GATE-2.md, rule 1). This record
covers gate runs 1, 2 and 3, of at most 3. **The gate is not green; it goes
back to Jason.**

## What the L12 gate does

`layers.rules.json` `current` is `"L12"`. core-next runs every test and
differential scenario placed at L12 or below: plugins, the audit ledger,
the logging and performance plugins and distributable snapshots. The fuzz
compares its plugin phase on v2.

**Run 1 is not green.** It moved `current` to L12, ported, ran
`oracle:update` and `ratchet --update` (+402, none lost; 3,040), signed the
(bx) U1 entry, two (az) entries and one (bi) log line, and cut U5 and U6 to
what both engines share (#339's mechanism). v1, v1:prod, v2, v2:prod,
v2:dist and v2:dist:prod exit 0. The census-seed fuzz hung.

**Run 2 is not green.** It found the hang: the trace aligner's DP table
(5.3e9 cells) on a shrink of the census seed's plugin case 13. #439 bounds
it. The shrunk case is (bx)'s knock-on, unsigned: a stop for the owner.

**Run 3 is not green.** It merges main at bce72ad9 (#439), signs (bx)'s
knock-on on the owner's 2026-11-22 words, converts all 28 L12
feature-layer mutants and passes every check but the PR and deep seeds.
15 of the 21 PR seeds fail (Stops).

## The L12 decisions

| Row | What it decides | Outcome |
| --- | --- | --- |
| (bu) | 2.0 signs data and metadata in their JSON form | Taken, "I approve you for to do everything" (2026-11-15). U5 keeps the shared part; 2.0 side in core-next l12a-distributable "(bu): undefined and a Date verify in place and after JSON" |
| (bv) | Data past 50 levels throws at signing; a function is dropped | Taken, the same words. U6 keeps the shared part; 2.0 side "(bv): data past 50 levels throws at signing and does not verify", "(bv): a function is dropped, ..." |
| (bw) | Declined | U10 pins 1.35 |
| (bx) | A watch also hears its included facts | Taken, the same words; widened to its knock-on effects, "Yes, widen (bx) to its knock-on effects (Recommended)" (2026-11-22) |
| (az) | replay() and import() call onHistoryNavigate (L8) | "Approve all as recommended (Recommended)" (2026-11-10); the ledger and logging twins |
| (bi) | Every run reports onTraceComplete once (L9) | "I approve you for to do everything" (2026-11-15); the logging twin |
| Bench | `plugins-100` at about 1.6 times 1.35 | Owner-accepted bench miss: "No, accept the gap for now (Recommended)" (2026-11-19). Not a stop |

## The signed entries

| Run | Row | Entries |
| --- | --- | --- |
| 1 | (bx) | `l12-bx-watch-hears-included-fact` (U1, step 3) |
| 1 | (az) | `l12-fuzz-az-external-ledger-navigate-entry` (`PAIR.ledgerNavigateInserted`), `l12-fuzz-az-external-log-timetravel-jump-extra` |
| 1 | (bi) | `l12-fuzz-bi-external-log-trace-complete-extra` |
| 3 | (bx) knock-on, group `row-bx`, `when` watchIncludesFacts | the getDistributableSnapshot skip warning, onError and onErrorRecovery "skip" extra (the hooks `requires` the warning), derivation.compute observe and onDerivationCompute moved one step earlier (`by` -1), the extra "watch" callback |
| 3 | (bx) knock-on, group `row-bx-logging`, `when` watchIncludesFacts + loggingPlugin | the logging plugin's "[Directive] error" and "[Directive] error.recovery" extra (each `requires` its hook's extra) and "[Directive] derivation.compute" moved |

The new trigger `watchIncludesFacts` is a watch with `includeFacts`
(diff/fuzz/model.ts). New hand-named classes: `distributableSkipped`,
`derivationThrown`, `derivationThrownMessage`, `derivedValue`,
`dependencyKeys`, `distributableSnapshot`. Self-test
`diff/self/l12-gate-bx-knockon.test.ts`: the same records with no watch,
or a watch without facts, still fail, as does any other kind, error
source, recovery, warning, a later move, or a log line without its hook.

**Proof (run 3).** Replays on the merged tree: `hang/shrunk-spec.json`,
plugin case 13 and the census seed's logging shrink (`specs/c3.json`)
replay ok with 0 unexplained; `shrunk-nofacts`, a1 and a2 stay ok.

## The mutation conversion

28 L12 `feature-layer` entries in `engine.ts` (4135 to 4256) are now
`later-layer`. 10 are Killed in the gate=L12 run 44937079779 (main at
3e943a32) by l12-plugins-pins-oracle and its production twin. 18 were
Survived or NoCoverage there; run 3's six "L12 gate mutation pins" (the
full unknown-key warnings, "(none)", exclusions in a snapshot and a watch,
metadata) kill them in a local Stryker run at ceiling L12
(`mutate:file engine.ts:4135-4260`). None is left. A gate=L12 CI run
should confirm the 18.

## Results (run 3)

| Check | Exit | Result |
| --- | --- | --- |
| `pnpm census` | 0 | 10 projects, 15,643 tests; the census-seed fuzz finishes |
| `check:expects` | 0 | |
| `oracle:update` | 0 | after the last harness edit |
| `conformance:checks` | 0 | 253 passed |
| diff self-tests | 0 | 595 tests |
| Root biome | 0 | |
| `ratchet --update` | 0 | +6 (the mutation pins), none lost; 3,046 |
| `pnpm -r --filter './packages/*' typecheck` | 1 | only the known gap (`ai-harness`, `cli`, `mcp`); core, core-next, conformance pass |
| The 21 PR seeds at L12 | 1 | d, 1, 12 exit 0; 2, 3, 4, 6, 8, 10, 13, 15, 16, 17, 19, 20 fail; 5 and 18 time out at 120 s; 14 died (IPC channel closed); 7, 9, 11 (1,800 s) not reached |
| Deep seeds 1, 2, 24301 | — | stopped early once the PR seeds failed; partial logs only |

## Stops

- **(bx)'s knock-on, shapes the run 3 entries do not cover** (PR seeds 2,
  3, 6, 8, 10, 15, 17, 19; all with a fact-including watch). A watch
  callback missing on 2.0 (6, 8, 17), derivation computes, invalidations
  and notifies extra on 2.0 that are not one-step moves (3, 10), a moved
  compute whose dependency list holds `derive.d0` (2, outside
  `dependencyKeys`), and a compute whose id differs (19). Specs
  `$G/specs/pr<seed>.json`, logs `$G/r3pr-seed-<seed>.log`. They look like
  (bx)'s consequence, but each needs its own narrow entry and proof.
- **The logging plugin's echo of approved rows, unsigned** (PR seeds 4, 13,
  16, 20; logging, no watch): e.g. seed 4, 2.0 logs "[Directive]
  resolver.write.rejected" at warn where 1.35 logs facts.batch (the batch
  clobber rows). Each needs a log twin under its row, as run 1 did for (az)
  and (bi).
- Seeds 5 and 18 time out at 120 s; seed 14's worker died.

## Follow-ups

- Sign or decide the stops above (owner), then a run 4.
- A gate=L12 mutation run to confirm the 18 local kills.
- Deep seeds 1, 2 and 24301 in full, after the PR seeds pass.
- `/principal` on L12 (the RFC's gate row).
