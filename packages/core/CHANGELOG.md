# @directive-run/core

## 1.0.1

### Patch Changes

- [`2c922f9`](https://github.com/directive-run/directive/commit/2c922f955e61a438bc9afa89f8e2d8c841ca77d0) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Performance optimizations: +36-95% faster derivations, +8-17% faster reconcile

  - Gate `validateValue` behind `__DEV__` — skip schema validation in production builds (+7-11% writes)
  - Eliminate TrackingContext object allocation — bare Set<string> dep stack (+50-112% derivation compute)
  - Skip plugin emit callbacks when no plugins registered (+14-16% reconcile)
  - Remove unused `unchanged` array from RequirementSet.diff() (+8-17% reconcile)
  - Short-circuit disabled constraint filter when disabled.size === 0
  - Remove TrackingContext interface (pre-launch cleanup — replaced with getCurrentDeps)

## 1.0.0

### Minor Changes

- [`a6a23b2`](https://github.com/directive-run/directive/commit/a6a23b2e52377a07bbbde52a89dcffcc3db2f826) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add DefinitionMeta — optional metadata for all 7 definition types

  **Core (`@directive-run/core`):**

  - `DefinitionMeta` type: label, description, category, color, tags, extensible index signature
  - `meta?` on modules, facts (via `t.number().meta()`), events (`{ handler, meta }`), constraints, resolvers, effects, derivations (`{ compute, meta }`)
  - `system.meta` O(1) accessor: module, fact, event, constraint, resolver, effect, derivation
  - `system.meta.byCategory()` and `system.meta.byTag()` bulk queries with `MetaMatch` return type
  - `system.inspect()` surfaces meta on all 7 definition types + modules array
  - `system.explain()` uses meta.label and meta.description in causal chains
  - Trace entries enriched with inline meta on all sub-arrays (factChanges, constraintsHit, resolversStarted, resolversCompleted, resolversErrored, effectsRun, derivationsRecomputed)
  - All meta frozen at registration via Object.create(null) + Object.freeze (prototype pollution defense)
  - Devtools graph renders meta.label for node labels, meta.color for node colors, meta.description as SVG tooltips

  **AI (`@directive-run/ai`):**

  - `formatSystemMeta(inspection)` — formats SystemInspection into LLM-readable markdown context
  - `toAIContext(system)` — convenience wrapper
  - `metaContext: true` option on both single-agent and multi-agent orchestrators
  - Token-efficient: only includes annotated definitions, omits empty sections

## 0.8.9

### Patch Changes

- [`a4adaca`](https://github.com/directive-run/directive/commit/a4adaca26a2536e052b15b737e6e940f68449f14) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add head-to-head benchmark suite comparing Directive against Zustand, Redux Toolkit, MobX, Jotai, Preact Signals, and XState

  - 11 comparison scenarios: single read/write, 1K cycles, derived values, batch writes, 10K throughput, multi-key read, alternating R/W, 3 derived values, subscribe+notify, store creation
  - 7 adapter modules wrapping each library into a common BenchAdapter interface
  - Run with `pnpm bench`

## 0.8.8

### Patch Changes

- [`d8f7341`](https://github.com/directive-run/directive/commit/d8f73411fac1cae004e7532600a4ef892938d451) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Performance optimizations: 3.1x faster reads, 97x faster reconcile

  - Hoist `__DEV__` const – prevents V8 JIT deopt in proxy get trap (fact reads 6.1M -> 18.9M ops/sec)
  - Fast-path `trackAccess` – skip when no tracking context active (+25% on reads)
  - Reorder proxy get trap – symbols first for React probe elimination
  - Replace `setTimeout(0)` with `queueMicrotask` in settle() – reconcile cycles 813 -> 18,780 ops/sec
  - Skip `withTracking` for derivations with stable deps – benefits multi-component renders
  - Guard `onCompute` allocation – eliminates array spread when no plugin listens
  - Add benchmark suite (15 benchmarks across 10 categories)

## 0.8.7

### Patch Changes

- [`627b7a7`](https://github.com/directive-run/directive/commit/627b7a7349fe2be0f3aca5bc54127aafba4863e0) Thanks [@jasoncomes](https://github.com/jasoncomes)! - SSR hydration for all adapters, query cache persistence, audit fixes

  - core: Add `mergeHydrationFacts` shared utility, cache `wrapWithNestedWarning` proxies, wire resolver key to engine, ship observability from .lab, add `getInflightCount()`, consolidate `safeStringify`
  - react: `useHydratedSystem` uses shared `mergeHydrationFacts`
  - vue: Add `DirectiveHydrator` component + `useHydratedSystem` composable
  - svelte: Add `setHydrationSnapshot` + `useHydratedSystem`
  - solid: Add `DirectiveHydrator` + `useHydratedSystem`
  - lit: Add `HydrationController` with lifecycle management
  - ai: Split orchestrator (8.7K -> 7.4K LOC), rename `dispose()` to `destroy()`, enable bundle splitting (246KB -> 109KB), remove legacy shims
  - query: Add `persistQueryCache` plugin for offline cache persistence

## 0.8.6

### Patch Changes

- [`d7f49ab`](https://github.com/directive-run/directive/commit/d7f49ab70b3f9da49ba98a7acb76e571e4b3c439) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Monorepo audit fixes: performance, types, adapters, community infra

  - core: Add `getInflightCount()` to ResolversManager – zero-allocation hot path for `isSettled` and `settle()`
  - devtools: Unify protocol types with `@directive-run/ai` – 7 new event types (checkpoint, task, goal), shared DebugEventType/BreakpointState
  - devtools: Interactive JsonTree data explorer, refetch/invalidate/reset action buttons, detectKind fix for subscriptions/infinite queries
  - adapters: Cache `require("@directive-run/query")` in module-level lazy helper, add as optional peerDependency
  - adapters: `useQuerySystem` accepts config objects directly (no factory wrapper)

## 0.8.5

## 0.8.4

## 0.8.3

### Patch Changes

- [`634c825`](https://github.com/directive-run/directive/commit/634c825d6daf22836b07df5713a949f036422222) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Fixed resolver facts proxy in multi-module systems to use the same scoped proxy as constraints/derive/effects. Previously, resolvers received a two-level namespace proxy (`facts.moduleName.key`) instead of the flat module-scoped proxy (`facts.key`), causing silent failures when writing facts. Also fixed batch resolver proxy wrapping (`resolveBatch`/`resolveBatchWithResults`) and added recovery for stuck requirements after reconcile max-depth bailout.

## 0.8.2

### Patch Changes

- [`5257894`](https://github.com/directive-run/directive/commit/52578949f868d5c17aec80f30c13f0391bac56c2) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Refactor system internals and fix proxy hardening gaps.

  - Extract proxy factories and module transformation into dedicated modules for maintainability
  - Fix tickMs dispatching only searching first module instead of all modules
  - Harden single-module events proxy with missing security traps (has, deleteProperty, ownKeys)
  - Replace O(n) array lookup with O(1) Set check in topological sort

## 0.8.1

## 0.8.0

### Minor Changes

- ### Features

  - Dev-mode nested mutation detection in facts store
  - Docs-artifacts CI job with knowledge bundling

  ### Refactors

  - Extract engine subsystems (accessors, definitions, trace) and deduplicate system.ts

  ### Chores

  - Update docs references for standalone directive-docs repo
  - Website extraction cleanup

## 0.7.0

### Minor Changes

- [`72ed25c`](https://github.com/directive-run/directive/commit/72ed25c1a6b00019a3f6e9e119de85d5107a5676) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add type-safe runtime dynamics for dynamic definition APIs.
  - Add `DynamicConstraintDef`, `DynamicEffectDef`, `DynamicResolverDef` types for typed `register()` and `assign()` callbacks
  - Parameterize `ConstraintsControl`, `EffectsControl`, `DerivationsControl`, `ResolversControl` on module schema — dynamic definition callbacks now receive typed `facts` with autocomplete
  - Add generic `call<T>()` on `DerivationsControl` for typed derivation return values
  - Thread type params through `System<M>` and `SingleModuleSystem<S>`

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

### Patch Changes

- [`02ee740`](https://github.com/directive-run/directive/commit/02ee7409536a59dd6492576252070127184dcca5) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Performance and correctness improvements to the core runtime.

  **Performance**

  - Convert recursive `invalidateDerivation` to iterative work queue (prevents stack overflow on 50+ deep derivation chains)
  - Effects auto-tracking stability optimization (skips `withTracking` overhead after 3 consecutive stable runs)
  - Resolver cache uses LRU eviction instead of FIFO (recently-used entries no longer evicted at capacity)
  - Conditional topo sort rebuild in constraints (skips full graph traversal when registering constraints without `after` deps)

  **Fixes**

  - Add `destroy()` to FactsStore — clears all listeners on system destroy (prevents memory leaks)
  - Add `setPrototypeOf` trap to all 13 proxies for consistent prototype pollution protection
  - Share visited Set across `invalidateMany` calls for correct deduplication
  - Reset effects dependency stability on errors and `runAll()`
  - Re-entrance guard on `engine.destroy()`

## 0.4.2

### Patch Changes

- [`4a0ca9d`](https://github.com/directive-run/directive/commit/4a0ca9d9ce710da4215b6d66f7dd1228187b0960) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Fix overly restrictive object schema type and update knowledge content.
  - Loosen `t.object<T>()` generic constraint to accept any type, not just `Record<string, unknown>`
  - Update AI docs, core docs, and all example files in knowledge package

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
