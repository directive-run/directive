# Mutation testing the oracle

The conformance suite is the oracle for the 2.0 rebuild, so its strength has
to be measured, not assumed. [Stryker](https://stryker-mutator.io) makes small
changes (mutants) to the 1.35 engine source in `packages/core/src/core/` and
re-runs the suite. A mutant the suite fails on is killed. One that passes is a
behaviour the oracle does not pin down.

## How the mutated source reaches the tests

`vitest.stryker.config.ts` keeps only `conformance:local` and
`conformance:local:prod`. Those alias `@directive-run/core` to core's `src/`
(see `lib/core-entries.ts`), so a mutant written into `src/` is what runs.
It also leaves out every file in the `internals` category (layers.json).
`conformance:v2` skips those, so a mutant only they kill is a behaviour the
2.0 oracle does not pin. To kill a mutant, write a black-box test; an
`/internals` test still documents 1.35 but does not move the gate.

### The layer ceiling

v2 also skips every test placed above the layer it has built (layers.json,
`current`). A test placed at L8 that happens to kill a mutant in `facts.ts`
does not protect the L1 build: it does not run on v2 until L8. So a layer's
score must count only kills by tests placed at or below that layer.

`MUTATION_LAYER=Ln` sets that ceiling. `vitest.stryker.config.ts` drops every
test file whose tests all sit above Ln, and passes the ceiling to
`helpers/layer-gate.ts`, which skips the remaining tests above Ln per test,
exactly as it skips tests above `current` on v2. The skip happens before the
test body runs, so a skipped test neither covers nor kills a mutant. Without
`MUTATION_LAYER` the run is the old one: every non-internals test counts.

### Deferral: a planted bug counts at the lowest layer whose tests reach it

A ceiling run reports a mutant `NoCoverage` when no test placed at or
below the ceiling executes it. That has two causes, and they mean
different things: a test placed higher reaches it (it belongs to that
layer's gate, not this one), or nothing reaches it at all (the oracle has a
hole). The full run, the same files with no ceiling, tells them apart.

    MUTATION_LAYER=L1 ... mutate:file <files>      -> ceiling report
    ... mutate:file <files>                        -> full report (no ceiling)
    tsx scripts/mutation-score.ts --full <full report or dir> <ceiling report or dir>

With `--full`, each `NoCoverage` mutant of the ceiling report is looked up
in the full report (same file, line, column, mutator, replacement):

| Ceiling run | Full run | Counted? |
|---|---|---|
| Killed / Timeout | (any) | yes, killed |
| Survived | (any) | yes: a test at or below the ceiling reaches it and misses it |
| NoCoverage | Killed, Timeout or Survived | **deferred**: not in the denominator, shown in the `deferred` column |
| NoCoverage | NoCoverage, or not in the report | yes: genuinely untested |

A full report whose source for the file differs from the ceiling report's
(the engine changed in between) defers nothing for that file (`stale` in
the column). Without `--full`, `NoCoverage` always counts: the
conservative score. A file whose every counted mutant was deferred or
excluded does not pass. The full run is not a free pass for what it
reaches: scored on its own (no `--full`), it must keep passing too, which
is how a deferred mutant that a higher test reaches but does not kill
still surfaces.

Deferral is only as fresh as the full report. A test deleted or moved
since that run can leave a mutant deferred that nothing reaches any more;
the next full run corrects it. For a `--check` that a merge relies on, run
both reports on the same commit.

Run each layer's files (the table below) with that layer as the ceiling. A
score from such a run counts only kills from tests that run on v2 at that
layer; a score from a run without the ceiling, or with a higher one,
overstates what the gate protects and must not be used for `--check`.
Stryker runs `inPlace` from the repo root (the engine is outside this package)
and restores the files afterwards. Run it on a clean checkout.

## Run locally

Build core once (one test spawns a process against `dist/`):

    pnpm --filter @directive-run/core build
    MUTATION_LAYER=L1 pnpm --filter @directive-run/conformance mutate:file packages/core/src/core/tracking.ts

`mutate` with no argument runs the whole engine (hours; CI shards it). Reports
land in `packages/conformance/reports/mutation/` (`mutation.html` is the one
to read); the incremental cache is `packages/conformance/.stryker-cache/`.
Both are gitignored.

## CI

`.github/workflows/mutation-nightly.yml` runs the engine in eight shards, one
per row of the table below (L3 and L11 are split in two and three for time),
each with its row's layer as `MUTATION_LAYER`. It caches the incremental file
per shard, keyed by the shard and a hash of `layers.json` (a test that moves
layer changes which tests may kill, so old results are not reused), uploads
each shard's JSON and HTML, and prints a per-shard score. It is report-only: `thresholds.break` is `null`. The 80%
gate (`high`) is added later.

Once a week (Sunday 03:11 UTC, and on `workflow_dispatch` with `ceiling:
none`) the same shards run with no ceiling: the full run. It has its own
incremental cache (`mutation-full-<shard>-…`) and uploads
`mutation-full-<shard>` artifacts kept for 35 days, so one failed weekly
run still leaves the previous week's. The nightly summary fetches the
newest `mutation-full-<shard>` artifact of each shard through the
Actions API and scores with `--full`; if there is none yet it scores
without (nothing deferred, and says so). A weekly run's summary scores the
full reports on their own, the check that they keep passing. A full shard
runs every non-internals test, so it takes longer than its ceiling run;
that is the cost of running it weekly, not nightly.

## The rule

The gate is per layer. Before a layer is built, the 1.35 files it reproduces
must PASS, on a report from a run with that layer's ceiling, so the gate
counts only kills from tests that run on v2 at that layer:

    MUTATION_LAYER=L1 pnpm --filter @directive-run/conformance mutate:file packages/core/src/core/facts.ts,packages/core/src/core/tracking.ts
    pnpm --filter @directive-run/conformance exec tsx scripts/mutation-score.ts --check --files facts.ts,tracking.ts packages/conformance/reports

`scripts/mutation-score.ts` takes Stryker JSON reports (files or directories)
and prints, per file, killed (+timeout), survived, no coverage, the raw score
and the gate score. The gate score is killed / all non-ignored mutants, less those triaged
`equivalent` or `internals-only` (below). A
mutant is ignored as message text when it is a `StringLiteral` mutant on a
line that builds an `Error`/`TypeError`/`RangeError`, calls `console.`,
`warn(` or `devWarn`, or has a `message:` key, or whose original literal
contains a space. A file PASSES when its gate score is at least 80% and every
remaining non-ignored survivor (Survived or NoCoverage) is listed in its
triage file.

Triage files live at `packages/conformance/mutation-triage/<basename>.json`:
`[{ "line": n, "col": n, "mutator": "...", "replacement": "...", "reason":
"equivalent|internals-only|dev-only|not-observable|perf-only|v1-bug|later-layer", "layer": "Ln" (later-layer only), "note": "..." }]`,
matched to report mutants by line + col + mutator + replacement (the report's
own numbers). No survivor stays unexplained: kill it with a conformance
scenario or triage it with a reason.

Two reasons leave the score, as in standard mutation scoring: `equivalent`
(no test of any kind could tell the mutant from the original) and
`internals-only` (the code is reached only through `/internals`, which 2.0
need not reproduce; the note names why no public path reaches it). Every
other reason stays in the denominator, so triage cannot lift a file over 80%.
A reviewer verifies each excluded entry before it merges.

`later-layer` (with a required `layer`, e.g. `{"reason": "later-layer",
"layer": "L4", "note": "prev capture"}`) marks code for a later layer's
feature that lower-layer tests merely execute. When the score is given the
run's ceiling (`--layer Ln`, or `--layer row` for each file's row in the
table below, which is what the nightly shards run at) and the ceiling is
below `layer`, the mutant is deferred, even if it Survived: that layer's
gate scores it. At or above `layer`, or with no `--layer`, it counts as if
untriaged. `layer` must be L0..L13 and above the file's row in the table;
anything else is a mislabel and the scorer exits with an error. A reviewer
verifies that the feature really belongs to that layer on the plan's layer
ladder.
Every `later-layer` entry needs a non-empty `note` naming the later feature
AND the test that kills the mutant in the full run; the scorer rejects an
empty one. A full report with no `source` (or a different one) is treated as
stale: nothing is deferred against it.

The score output lists every deferred mutant (`file:line:col mutator`, in a
collapsible block). Reviewer step: spot-check that each listed line really
belongs to a later layer's feature (open the line, read the entry's note),
because a deferral removes that mutant from the gate score.

| Layer | Files in `packages/core/src/core/` |
|---|---|
| L0-L1 (Phase 1) | facts.ts, derivations.ts, effects.ts, tracking.ts, read-only-view.ts, module.ts |
| L2 | constraints.ts, resolvers.ts, requirements.ts, timer.ts, clock.ts |
| L3 | engine.ts, engine-accessors.ts, engine-definitions.ts, engine-trace.ts, system.ts, system-proxies.ts, system-module-transform.ts, errors.ts, plugins.ts, schema-builders.ts, schema-introspection.ts, sources.ts |
| L6 | internal-scopes.ts |
| L11 | predicate.ts, predicate-describe.ts, predicate-hash.ts, predicate-to-mongo.ts, predicate-to-pgrest.ts, predicate-to-sql.ts, predict.ts, sweep-under.ts, replay-under.ts, rules-diff.ts, doctor.ts |

Every file lands in exactly one row. The `__tests__/` and `types/` folders are
not mutated.

If a run is killed or times out, re-run the shard with the same cache; the
incremental file keeps finished results.
