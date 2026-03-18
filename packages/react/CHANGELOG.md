# @directive-run/react

## 0.8.0

## 0.7.0

### Patch Changes

- [`702a3f6`](https://github.com/directive-run/directive/commit/702a3f6732f6c59ce95ab339b7b96d979d7d7fd7) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Fix missing `history` option on `useDirectiveRef` — `DirectiveRefBaseConfig` now accepts `history?: HistoryOption` and passes it through to `createSystem` in both single-module and namespaced modes.

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
