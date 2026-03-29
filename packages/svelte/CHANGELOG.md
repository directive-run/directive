# @directive-run/svelte

## 0.8.5

## 0.8.4

## 0.8.3

### Patch Changes

- [`0e51375`](https://github.com/directive-run/directive/commit/0e51375f17cb6b271b5af58b0c49f72b6ea945a5) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add @directive-run/query – declarative data fetching with causal cache invalidation.

  New package: createQuery, createMutation, createSubscription, createInfiniteQuery, createBaseQuery, createGraphQLQuery, createGraphQLClient, createQuerySystem, createQueryModule, withQueries, explainQuery. 191 tests across 15 test files.

  Framework adapters: useQuerySystem hook added to React, Vue, Svelte, Solid. QuerySystemController added to Lit. Factory pattern keeps @directive-run/query as zero-coupling optional dep.

## 0.8.2

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

## 0.4.2

## 0.4.1

## 0.4.0

## 0.3.0

## 0.2.0
