---
"@directive-run/timeline": minor
"@directive-run/cli": minor
"@directive-run/mutator": patch
---

R5 hardening pack — production-readiness pass on the R2 ship

After the R5 AE-review-loop closed criticals, this pack lands the load-bearing DX/Arch findings so the substrate is ready for production use. No new commands; existing surfaces gain better docs, cleaner types, and consistent semantics.

**Documentation (R5 DX C3):**
- `@directive-run/timeline` README — replaces the outdated "v0.4 — diff mode (deferred)" Roadmap with shipped reality. New "Serialize, replay, bisect, diff" section walks all four operational entry points end-to-end with library + CLI examples for each.
- `@directive-run/cli` README — adds full sections for `directive replay`, `directive bisect` (with security note for `--assert`), and `directive timeline diff` (with exit-code documentation).
- `@directive-run/mutator` README — new "Recording cancellations for replay" section covers `recordReplayable()` end-to-end.

**Type ergonomics (R5 DX M1):**
- `BisectResult` now carries a `kind: 'found' | 'no-failure' | 'fails-on-empty' | 'non-deterministic'` discriminator. Consumers can `switch (result.kind)` for clean type-narrowed access instead of juggling three booleans plus an optional index. Legacy boolean fields stay populated for back-compat (marked `@deprecated`).

**Exit-code consistency (R5 DX M3):**
- `directive bisect` now exits `2` on a "standard hit" (located the first failing frame). Aligns with `directive timeline diff` (exit 2 = differences found), so CI gates can branch uniformly: `0 = clean, 1 = CLI error, 2 = problem found / refused`. Documented in CLI README.

**Docstring corrections (R5 Arch M5):**
- `recordReplayable()` JSDoc reframed: the function is a generic "call me when abort fires" hook. Pinning into facts is one use case; Sentry breadcrumbs / Redux logs / OpenTelemetry / metrics are equally valid. Removes the misleading "pairs with timeline" framing that overstated the coupling.

**Tests:** +1 test verifying the new `BisectResult.kind` field across all four outcomes. Workspace: 4090 → 4091.
