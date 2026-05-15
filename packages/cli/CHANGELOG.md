# @directive-run/cli

## 1.4.0

### Minor Changes

- [`d6147f6`](https://github.com/directive-run/directive/commit/d6147f673ee41cc4d9dbb1918167177cc5952373) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add `directive replay <timeline.json>` command — wires the R1.A scaffold to the public CLI

  Pairs with `@directive-run/timeline`'s `serializeTimeline()`. Workflow:

  1. Production captures the last N seconds of timeline frames via `recordTimeline(sys, ...)` + `serializeTimeline(t)` and ships the JSON to a bug tracker.
  2. A developer runs `directive replay bug-1234.json --system path/to/module.ts`.
  3. The CLI loads the user's system, replays every dispatchable frame, prints `ReplayResult` (dispatched / skipped / truncated counts).

  ```sh
  directive replay bug-1234.json --system src/app/system.ts
  # ✓ replay complete: 47 dispatched / 18 skipped

  directive replay error.json --system src/system.ts --json
  # {"dispatched": 47, "skipped": 18, "truncated": 0}

  directive replay error.json --system src/system.ts --max-frames 10000
  ```

  **Options:**

  - `--system, -s <path>` (required) — TypeScript file exporting a Directive system.
  - `--max-frames <n>` — cap on frames replayed (default 100,000).
  - `--all-frames` — walk every frame, not just dispatchable ones (diagnostic mode).
  - `--json` — emit `ReplayResult` as JSON.
  - `--verbose, -v` — per-frame trace.

  **Peer dep:** `@directive-run/timeline@^0.2.0` is now an optional peer of `@directive-run/cli`. The CLI surfaces a clear install-prompt error if the user runs `directive replay` without it installed.

  **v0.2 scope (deferred per `docs/IDEAS.md`):**

  - `--as-test` flag emits a vitest source file with R1.B matchers.
  - `--bisect <good.json>` for git-bisect over timeline frames (R2.A BUILD CANDIDATE).
  - `--diff <other.json>` for causal-graph diff output (R2.C).

  7 new tests covering arg parsing, file-not-found / invalid-JSON / invalid-shape error paths, plus a happy-path integration test that replays a synthetic mutator-shape frame against a stub system.

- [`ecc8378`](https://github.com/directive-run/directive/commit/ecc8378cc47876a9526a5827f83f3261890ee5f2) Thanks [@jasoncomes](https://github.com/jasoncomes)! - R2.A: `directive bisect` — git-bisect for timelines

  Binary-search a recorded timeline for the first frame whose inclusion in the replay prefix flips a user-supplied assertion from passing to failing. The CLI surface mirrors `git bisect run`, but operates over `ObservationEvent` frames instead of git commits.

  **Why it lands now.** The R1 substrate (deterministic replay + matchers + cancellable HOC) made midpoint-replay-and-assert a one-line operation. Without R1.A's `replayTimeline()` and the determinism guarantees underneath it, every midpoint would be a non-trivial reconstruction; with it, bisect is a tiny binary-search loop over a primitive that already exists.

  **`bisectTimeline()` library API** (`@directive-run/timeline`):

  ```ts
  import { bisectTimeline, deserializeTimeline } from "@directive-run/timeline";

  const bad = deserializeTimeline(JSON.parse(prodErrorReportText));
  const result = await bisectTimeline(
    bad,
    () => {
      const sys = createSystem({ module: counterModule });
      sys.start();
      return sys;
    },
    (sys) => sys.facts.score >= 0
  );
  console.log(`first failing frame: #${result.firstFailingFrameIndex}`);
  ```

  Three failure modes are reported as discrete result fields rather than thrown errors, so the caller can branch deterministically:

  - `noFailureFound: true` — assertion passes after replaying the full timeline; nothing to bisect.
  - `failsOnEmptyReplay: true` — assertion fails on a freshly-started system before any frame replays; bug is in initialization.
  - `nonDeterministic: true` — two full-timeline replays produced different oracle verdicts; bisection refuses (returns early).

  Per-iteration cost is one full replay of `mid` frames. Iteration count is bounded by `2 + 1 + ceil(log2(N))` (determinism gate + empty probe + binary search). For a 10k-frame timeline that's ~14 iterations; for a 1k-frame timeline ~13.

  **`directive bisect` CLI** (`@directive-run/cli`):

  ```sh
  directive bisect bug-1234.json \
    --system test/bisect-system.ts \
    --assert 'facts.count >= 0'
  ```

  The `--system` file must export a _factory_ (a `createSystem` / `systemFactory` / default-export function returning a started Directive system) so bisect can instantiate a fresh hermetic system per midpoint replay. The `--assert` expression evaluates as a JS function body with `facts` and `system` in lexical scope. The CLI is a local-trust tool — don't relay these strings from untrusted callers.

  **11 new library tests** (timeline): happy path, frame-0 trigger, no-failure, fails-on-empty, non-determinism detection, O(log N) iteration bound, factory-freshness invariant, async factories/oracles, determinism-check disable, 1-frame, 0-frame.

  **10 new CLI tests** (cli): missing args, malformed JSON / assertion, factory-missing, full happy path with synthetic 4-frame timeline + JSON output, no-failure-found human output.

- [`189dee2`](https://github.com/directive-run/directive/commit/189dee240b97255f798df1b7a54e368a04460b5d) Thanks [@jasoncomes](https://github.com/jasoncomes)! - R2.C: `directive timeline diff` — semantic causal-graph diff between two serialized timelines

  Not a textual JSON diff — a causal one. Reports per-category deltas (frame counts, constraint fires, mutation kinds, resolver runs, new errors) so a reviewer can see "Run B fired constraint `loadOnLoading` 3 extra times Run A didn't" without eyeballing a 4000-line diff.

  The diff vocabulary mirrors `@directive-run/timeline/matchers` inverted into reporters: where the matcher surface asserts `toFireConstraint(id, count)` / `toMutate(kind)` / `toResolveWithinMs(resolver)`, the diff surfaces the same buckets as count deltas. Same vocabulary, opposite direction.

  **`diffTimelines()` library API** (`@directive-run/timeline`):

  ```ts
  import { diffTimelines, deserializeTimeline } from "@directive-run/timeline";

  const a = deserializeTimeline(JSON.parse(goodJson));
  const b = deserializeTimeline(JSON.parse(badJson));
  const diff = diffTimelines(a, b);

  if (diff.identical) {
    // semantically same — no further work
  } else {
    for (const c of diff.constraintFires) {
      console.log(`'${c.id}': ${c.aCount} → ${c.bCount} (${c.delta})`);
    }
  }
  ```

  Result categories (only differing entries surface — identical ones are elided):

  - `constraintFires` — per-constraint `constraint.evaluate` count delta, sorted by descending |delta|.
  - `mutations` — per-mutation-kind dispatch count delta. Aligned with `replayTimeline`'s dispatchable filter (`pendingMutation` writes with `status: 'pending'` and a string `kind`).
  - `resolverRuns` — per-resolver `start` / `complete` / `error` axis counts.
  - `newErrors` — `constraint.error` / `resolver.error` / `effect.error` frames that appear on one side but not the other (or differ structurally at the same frame index).
  - `identical` — fast `true` if no category surfaced any difference.

  Defensive `safeStringify` guards the diff against unstringifiable error values (circular refs, BigInts, etc.) — diffing two timelines with hostile error payloads doesn't crash.

  **`directive timeline diff` CLI** (`@directive-run/cli`):

  ```sh
  directive timeline diff baseline.json regression.json
  # Exit 0 = identical, 2 = differences found, 1 = CLI argument error.

  directive timeline diff a.json b.json --json | jq .constraintFires
  ```

  Exit code 2 (not 0/1) so CI can distinguish "diff found differences" from "CLI failed to run." Suitable as a CI gate on PRs that change state-management code.

  **Tests:** 10 new library tests (identical, constraint deltas, sort order, mutations, resolver runs, errors, lifecycle frames ignored, circular refs, same-shape error elision, two empty timelines) + 9 new CLI tests (arg parsing, file errors, validation errors, identical exit 0, diverging exit 2, --json mode). Workspace: 4069 → 4088 (+19).

  Closes R2.C from `docs/IDEAS.md`. Cascade-edge diff and Mermaid sequence-diagram emission are deferred to v0.2.

- [`0d8cae5`](https://github.com/directive-run/directive/commit/0d8cae57e7e9b28ecb64e98588458a264dbd06c1) Thanks [@jasoncomes](https://github.com/jasoncomes)! - R5 hardening pack — production-readiness pass on the R2 ship

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

### Patch Changes

- [`40d688e`](https://github.com/directive-run/directive/commit/40d688e0f1e60670f91e229762d25adb0879339e) Thanks [@jasoncomes](https://github.com/jasoncomes)! - R5 fix-pack — closes critical/major findings from the R5 AE-review-loop on R2.A/B/C

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

- Updated dependencies []:
  - @directive-run/knowledge@1.4.0

## 1.3.0

### Patch Changes

- Updated dependencies []:
  - @directive-run/knowledge@1.3.0

## 1.1.2

### Patch Changes

- Updated dependencies []:
  - @directive-run/knowledge@1.1.2

## 1.1.1

### Patch Changes

- Updated dependencies []:
  - @directive-run/knowledge@1.1.1

## 1.1.0

### Patch Changes

- Updated dependencies []:
  - @directive-run/knowledge@1.1.0

## 1.0.1

### Patch Changes

- Updated dependencies []:
  - @directive-run/knowledge@1.0.1

## 1.0.0

### Patch Changes

- Updated dependencies []:
  - @directive-run/knowledge@1.0.0

## 0.8.9

### Patch Changes

- Updated dependencies []:
  - @directive-run/knowledge@0.8.9

## 0.8.8

### Patch Changes

- Updated dependencies []:
  - @directive-run/knowledge@0.8.8

## 0.8.7

### Patch Changes

- Updated dependencies []:
  - @directive-run/knowledge@0.8.7

## 0.8.6

### Patch Changes

- Updated dependencies []:
  - @directive-run/knowledge@0.8.6

## 0.8.5

### Patch Changes

- Updated dependencies []:
  - @directive-run/knowledge@0.8.5

## 0.8.4

### Patch Changes

- Updated dependencies []:
  - @directive-run/knowledge@0.8.4

## 0.8.3

### Patch Changes

- Updated dependencies []:
  - @directive-run/knowledge@0.8.3

## 0.8.2

### Patch Changes

- Updated dependencies []:
  - @directive-run/knowledge@0.8.2

## 0.8.1

### Patch Changes

- Updated dependencies []:
  - @directive-run/knowledge@0.8.1

## 0.8.0

### Patch Changes

- Updated dependencies []:
  - @directive-run/knowledge@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies []:
  - @directive-run/knowledge@0.7.0

## 0.6.0

### Minor Changes

- ### Breaking Changes

  - **Rename `debug.runHistory` → `trace`**: `createSystem({ debug: { runHistory: true } })` is now `createSystem({ trace: true })`. The `DebugConfig` type is removed; use `TraceOption` instead. `system.runHistory` is now `system.trace`. `RunChangelogEntry` is now `TraceEntry`.
  - **Rename `debug.timeTravel` → `history`**: `createSystem({ debug: { timeTravel: true } })` is now `createSystem({ history: true })`. `system.timeTravel` is now `system.history`. `snapshotEvents` moves from top-level module config to `history: { snapshotEvents: [...] }`.
  - **HistoryState API aligned with HistoryAPI**: `canUndo`/`canRedo`/`undo()`/`redo()` removed from `HistoryState` (returned by `useHistory` hooks). Use `canGoBack`/`canGoForward`/`goBack()`/`goForward()` instead.
  - **Observability plugin moved to lab**: `createObservability` and `createAgentMetrics` are no longer exported from `@directive-run/core/plugins` or `@directive-run/ai`. The implementation is preserved in `observability.lab.ts` for re-evaluation. Types are still exported.

  ### Features

  - Document full `getDistributableSnapshot` API including `includeFacts`, `excludeDerivations`, `metadata`, and `includeVersion` options.
  - Add `.lab.ts`/`.lab.md` feature lifecycle convention for managing lab → prod → deprecated phases.

  ### Fixes

  - Add global `cursor: pointer` to all buttons.
  - Narrow home page hero code block width.

### Patch Changes

- Updated dependencies []:
  - @directive-run/knowledge@0.6.0

## 0.5.0

### Minor Changes

- [`7229881`](https://github.com/directive-run/directive/commit/72298811032bbaf988bf8c200cc8ba481f0132f7) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add dynamic runtime definitions, harden security, and refactor internals.

  **Features**

  - Add `register()`, `assign()`, `getOriginal()`, `restoreOriginal()` for constraints, resolvers, derivations, and effects at runtime
  - Add `DerivationsControl` type for dynamic definition methods on `system.derive`
  - Add `read()` overload for fact keys on `SingleModuleSystem`

  **Fixes**

  - Fix command injection vulnerability in CLI `graph` command (`exec` → `execFile`)
  - Reject schema keys starting with `$` to prevent internal collision
  - Prefix all testing assertion errors with `[Directive]`
  - Harden all 11 proxies with `defineProperty`, `getPrototypeOf`, `setPrototypeOf` traps

  **Improvements**

  - Extract shared adapter utilities (SSE parsing, hooks, error handling) in AI package
  - Split orchestrator into pattern-composition, pattern-factories, pattern-serialization (10,272 → 8,729 LOC)
  - Split `facts.ts` into `schema-builders.ts` + facts store
  - Consolidate `BLOCKED_PROPS` to single export in `tracking.ts`
  - Remove 7 internal builder types from public exports

  **BREAKING:** `constraintFactory` renamed to `createConstraintFactory`, `resolverFactory` renamed to `createResolverFactory`

### Patch Changes

- Updated dependencies []:
  - @directive-run/knowledge@0.5.0

## 0.4.2

### Patch Changes

- Updated dependencies []:
  - @directive-run/knowledge@0.4.2

## 0.2.0

### Minor Changes

- [`73a604e`](https://github.com/directive-run/directive/commit/73a604e68f86f785f413fbfb9314f9fac90fef2a) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Enforce stricter lint rules and add CLI + knowledge packages.

  **Features**

  - Add `@directive-run/cli` with `ai-rules init` command for installing AI coding rules across editors (Claude, Cursor, Copilot, Cline, Windsurf)
  - Add `@directive-run/knowledge` for extracting structured knowledge from Directive packages

  **Improvements**

  - Promote 8 Biome lint rules from warn to error: `noUnusedTemplateLiteral`, `useLiteralKeys`, `useExponentiationOperator`, `useConst`, `noUselessElse`, `noConfusingVoidType`, `noCommaOperator`, `noDelete`
  - Auto-fix all lint violations across source files (no API changes)

### Patch Changes

- Updated dependencies []:
  - @directive-run/knowledge@0.2.0
