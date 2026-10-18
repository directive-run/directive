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

Before Phase 1 starts, every surviving mutant gets either a new conformance
scenario that kills it, or a written reason it is equivalent (the change
cannot alter observable behaviour). No survivor stays unexplained.
