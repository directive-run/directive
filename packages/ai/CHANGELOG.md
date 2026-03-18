# @directive-run/ai

## 0.8.1

## 0.8.0

## 0.7.0

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

## 0.4.2

## 0.4.1

### Patch Changes

- [`73a604e`](https://github.com/directive-run/directive/commit/73a604e68f86f785f413fbfb9314f9fac90fef2a) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Enforce stricter lint rules and add CLI + knowledge packages.

  **Features**

  - Add `@directive-run/cli` with `ai-rules init` command for installing AI coding rules across editors (Claude, Cursor, Copilot, Cline, Windsurf)
  - Add `@directive-run/knowledge` for extracting structured knowledge from Directive packages

  **Improvements**

  - Promote 8 Biome lint rules from warn to error: `noUnusedTemplateLiteral`, `useLiteralKeys`, `useExponentiationOperator`, `useConst`, `noUselessElse`, `noConfusingVoidType`, `noCommaOperator`, `noDelete`
  - Auto-fix all lint violations across source files (no API changes)

## 0.4.0

### Minor Changes

- [`ed2475d`](https://github.com/directive-run/directive/commit/ed2475d4b01e87e198fe87d1f846abe19e8ce3ff) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add tasks system, supervisor resilience, and enriched debug timeline to the AI orchestrator. Consolidate error handling and harden resolvers in core. Simplify DevTools with rewritten session panel and removed dead views. Fix memory message deduplication in multi-agent orchestrator.

## 0.3.0

### Minor Changes

- [`b418d25`](https://github.com/directive-run/directive/commit/b418d259eb663bd79c769b89a5069e4a10ed160c) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add run history, constraint disable API, and DevTools overhaul with graph visualization, panel UI, and AI bridge. Rewrite AI package with modular orchestrator architecture, multi-agent orchestrator, evals framework, OTEL tracing, breakpoints, checkpoints, health monitoring, reflection patterns, and Gemini adapter. Add full DevTools React UI with timeline, DAG, flamechart, compare, replay, and anomaly detection views.

## 0.2.0

### Minor Changes

- [`7e3e3ed`](https://github.com/directive-run/directive/commit/7e3e3ed20754c1b605596d1f7a2969590af73f7c) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add `snapshotEvents` option to `createModule` for controlling which events create time-travel snapshots. Add optional equality function parameter to `useSelector` across all framework adapters. Remove deprecated `bus`, `obs`, `multi`, and `costRatePerMillion` aliases from `createAgentStack`.
