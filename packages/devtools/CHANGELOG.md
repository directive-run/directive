# @directive-run/devtools

## 1.1.0

## 1.0.1

## 1.0.0

## 0.8.9

## 0.8.8

## 0.8.7

## 0.8.6

### Patch Changes

- [`d7f49ab`](https://github.com/directive-run/directive/commit/d7f49ab70b3f9da49ba98a7acb76e571e4b3c439) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Monorepo audit fixes: performance, types, adapters, community infra

  - core: Add `getInflightCount()` to ResolversManager – zero-allocation hot path for `isSettled` and `settle()`
  - devtools: Unify protocol types with `@directive-run/ai` – 7 new event types (checkpoint, task, goal), shared DebugEventType/BreakpointState
  - devtools: Interactive JsonTree data explorer, refetch/invalidate/reset action buttons, detectKind fix for subscriptions/infinite queries
  - adapters: Cache `require("@directive-run/query")` in module-level lazy helper, add as optional peerDependency
  - adapters: `useQuerySystem` accepts config objects directly (no factory wrapper)

## 0.8.5

### Patch Changes

- [`3465ed9`](https://github.com/directive-run/directive/commit/3465ed9f70bcd52aebcf3bedb7eb0c01f9c4d676) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add query devtools Timeline, Explain, and data explorer panels

  - Timeline panel with swim-lane fetch bars, constraint trigger dots, and duration labels
  - Explain panel with causal chain visualization (why did this query fetch?)
  - Interactive JsonTree data explorer replacing flat JSON preview
  - Refetch/Invalidate/Reset action buttons per query
  - Auto-detect query kind (Query/Mutation/Subscription/Infinite)
  - Summary stats bar, stale badges, search filtering
  - Full ARIA keyboard navigation on tabs
  - 74 unit tests covering all exported helpers
  - StateView tabs brought to ARIA parity

## 0.8.4

## 0.8.3

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

## 0.3.0

### Minor Changes

- [`ed2475d`](https://github.com/directive-run/directive/commit/ed2475d4b01e87e198fe87d1f846abe19e8ce3ff) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add tasks system, supervisor resilience, and enriched debug timeline to the AI orchestrator. Consolidate error handling and harden resolvers in core. Simplify DevTools with rewritten session panel and removed dead views. Fix memory message deduplication in multi-agent orchestrator.

## 0.2.0

### Minor Changes

- [`b418d25`](https://github.com/directive-run/directive/commit/b418d259eb663bd79c769b89a5069e4a10ed160c) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add run history, constraint disable API, and DevTools overhaul with graph visualization, panel UI, and AI bridge. Rewrite AI package with modular orchestrator architecture, multi-agent orchestrator, evals framework, OTEL tracing, breakpoints, checkpoints, health monitoring, reflection patterns, and Gemini adapter. Add full DevTools React UI with timeline, DAG, flamechart, compare, replay, and anomaly detection views.
