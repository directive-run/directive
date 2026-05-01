---
"@directive-run/timeline": patch
"@directive-run/cli": patch
---

R5 fix-pack — closes critical/major findings from the R5 AE-review-loop on R2.A/B/C

Four parallel reviewers (security, architecture, DX, innovation) converged on a small set of high-leverage fixes after the R2 ship. This pack closes the criticals and the load-bearing majors. No new public APIs; type-narrowing only at consumer surfaces.

**Security (1 fix):**
- `reconstructDispatch()` now strips own `__proto__` / `constructor` / `prototype` keys from hostile timeline JSON before re-spreading into a `MUTATE` dispatch. Defense-in-depth — `JSON.parse` already stores these as benign own properties (no prototype-slot manipulation), but downstream user handlers doing `Object.assign(target, event.payload)` could be misled. Stripping at the boundary is cheaper than auditing every consumer. Regression test added. (R5 sec #8.)

**Architecture (3 fixes):**
- `diffTimelines` errorKey no longer includes `frameIndex` — same logical error appearing at shifted positions in two timelines was being double-reported as both `a-only` and `b-only`. Now keyed on `(kind, id, errorJson)` only; `frameIndex` is preserved on the surviving entries for locating. Regression test added. (R5 arch C1.)
- CLI no longer duplicates timeline types in `replay.ts` / `bisect.ts` / `timeline-diff.ts`. The lazy-import pattern is preserved exactly via `import type` (fully erased at compile time), and types are now single-sourced from `@directive-run/timeline`. Catches drift at compile time the next time timeline adds a field. (R5 arch C2.)
- New `cli/src/lib/timeline-loader.ts` consolidates the three repeated lazy-import blocks into `loadTimelinePackage(verbose)`. Removes ~75 lines of CLI noise; the install-prompt error message is now single-sourced. (R5 arch M2.)

**DX (2 fixes):**
- `loadSystemFactory()` now detects the most common confusion ("user passed a started-instance file expecting bisect to work like replay") and emits a targeted error with a copy-pasteable wrapper. Also reminds users to call `sys.start()` in their factory if they forgot. (R5 DX C4 / M11.)
- `directive bisect` `--assert` help text now carries an explicit security note: the expression is evaluated as JavaScript in the CLI process; only pass expressions from sources you trust. (R5 DX C2.)
- `directive bisect --json` now emits `firstFailingFrameIndex: null` (not absent) when no specific frame is the trigger, so jq consumers can distinguish "fails before frame 0" from "frame 0 itself triggers." (R5 sec #9.)

**Tests:** +2 regression tests (proto-pollution stripping in reconstructDispatch, diff errorKey index-shift elision). Workspace: 4088 → 4090.

Type narrowing introduced by the `import type` cleanup surfaced three latent unknown-casts in CLI commands (`bisect.ts` factory, `replay.ts` system, `timeline-diff.ts` deserialized). All bridged with explicit casts at the runtime-checked boundary. No behavioral change.

Deferred to a future pack (per the AE-review): subpath split of `timeline/index.ts` (1450 LOC) into `/bisect` and `/diff` exports, `BisectResult` discriminated-union refactor, README updates to all three packages, `recordReplayable` docstring reframing. None are critical.
