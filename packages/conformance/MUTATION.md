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
2.0 oracle does not pin. Every kill the score counts comes from a test that
also runs on v2. To kill a mutant, write a black-box test; an `/internals`
test still documents 1.35 but does not move the gate.
Stryker runs `inPlace` from the repo root (the engine is outside this package)
and restores the files afterwards. Run it on a clean checkout.

## Run locally

Build core once (one test spawns a process against `dist/`):

    pnpm --filter @directive-run/core build
    pnpm --filter @directive-run/conformance mutate:file packages/core/src/core/tracking.ts

`mutate` with no argument runs the whole engine (hours; CI shards it). Reports
land in `packages/conformance/reports/mutation/` (`mutation.html` is the one
to read); the incremental cache is `packages/conformance/.stryker-cache/`.
Both are gitignored.

## CI

`.github/workflows/mutation-nightly.yml` runs the engine in six shards, caches
the incremental file per shard, uploads each shard's JSON and HTML, and prints
a per-shard score. It is report-only: `thresholds.break` is `null`. The 80%
gate (`high`) is added later.

## The rule

The gate is per layer. Before a layer is built, the 1.35 files it reproduces
must PASS:

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
"equivalent|internals-only|dev-only|not-observable|perf-only|v1-bug", "note": "..." }]`,
matched to report mutants by line + col + mutator + replacement (the report's
own numbers). No survivor stays unexplained: kill it with a conformance
scenario or triage it with a reason.

Two reasons leave the score, as in standard mutation scoring: `equivalent`
(no test of any kind could tell the mutant from the original) and
`internals-only` (the code is reached only through `/internals`, which 2.0
need not reproduce; the note names why no public path reaches it). Every
other reason stays in the denominator, so triage cannot lift a file over 80%.
A reviewer verifies each excluded entry before it merges.

| Layer | Files in `packages/core/src/core/` |
|---|---|
| L0-L1 (Phase 1) | facts.ts, derivations.ts, effects.ts, tracking.ts, read-only-view.ts, module.ts, internal-scopes.ts |
| L2 | constraints.ts, resolvers.ts, requirements.ts, timer.ts, clock.ts |
| L3 | engine.ts, engine-accessors.ts, engine-definitions.ts, engine-trace.ts, system.ts, system-proxies.ts, system-module-transform.ts, errors.ts, plugins.ts, schema-builders.ts, schema-introspection.ts, sources.ts |
| L11 | predicate.ts, predicate-describe.ts, predicate-hash.ts, predicate-to-mongo.ts, predicate-to-pgrest.ts, predicate-to-sql.ts, predict.ts, sweep-under.ts, replay-under.ts, rules-diff.ts, doctor.ts |

Every file lands in exactly one row. The `__tests__/` and `types/` folders are
not mutated.

If a run is killed or times out, re-run the shard with the same cache; the
incremental file keeps finished results.
