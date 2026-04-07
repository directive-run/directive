---
"@directive-run/core": patch
---

Performance: #is-development imports (+11-35% across all benchmarks) + AE review fixes

- Replace 40 `process.env.NODE_ENV` checks with `#is-development` compile-time imports (XState pattern)
- Fix P0: `system.observe()` now fires all events when no initial plugins configured (stale `hasPlugins` flag → live function)
- Fix P1: `reconcile.end` event now correctly reports `added`/`removed` from ReconcileResult
- Fix P1: `adapter-utils.ts` migrated to `isDevelopment` import
- Fix P2: `CoverageReport` now includes `effectCoverage` and `derivationCoverage` percentages
- Fix: SVG architecture diagram uses inline styles (GitHub CSP strips `<style>`)

Benchmarks (vs previous release):
- Minimal reconcile cycle: 34.9K → 47.2K ops/sec (+35%)
- Single constraint: 47.3K → 57.1K ops/sec (+21%)
- Fact write: 4.8M → 6.2M ops/sec (+27%)
- Auth flow: 32K → 36.1K ops/sec (+13%)
