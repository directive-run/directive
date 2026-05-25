# @directive-run/react

## 1.12.0

## 1.11.0

### Minor Changes

- [`280928d`](https://github.com/directive-run/directive/commit/280928dec0776fda998055fc9b47955abdf58c04) Thanks [@jasoncomes](https://github.com/jasoncomes)! - feat: predicate-from-intent + audit-ledger + predict + doctor (R4 sprint wrap)

  The headline this release earns:

  > _"The LLM wrote a rule. The type-checker said no. The doctor said no.
  > The predictor said which facts must change. Two turns later, the rule
  > was in production — and every state change since then ships with a
  > tamper-evident, hash-chained (djb2 32-bit; SHA-256 reserved for v2)
  > explanation. Tamper one byte, the chain proves it."_

  Six new public APIs across three packages, all compounding on the
  rules-as-data substrate shipped earlier this quarter.

  ### `@directive-run/ai`: `predicateFromIntent`

  Let an LLM emit a `FactPredicate` JSON, structurally + semantically
  validated against your schema before it reaches the engine. Five layers:
  output-size cap (default 64 KiB DoS guard), `JSON.parse`,
  `validatePredicate` (closed operator set + depth + JSON-safety),
  operator-count cap, `validatePredicateAgainstSchema` (operator-on-kind).
  On failure: structured error feeds back to the model in the next
  attempt. Throws `PredicateFromIntentError` on retry exhaustion.

  ```ts
  const predicate = await predicateFromIntent({
    intent: "block checkout if cart is empty or user is unverified",
    schema: myModule.schema,
    runner,
  });
  // → typed FactPredicate, ready to drop into a constraint
  ```

  Tool-spec preset `predicateToolSpec(schema)` for OpenAI / Anthropic
  function-calling APIs.

  ### `@directive-run/core/plugins`: `createAuditLedger`

  Append-only, queryable, hash-chained log of every state change.
  Captures `constraint.evaluate` (with `whenSpec` + `whenExplain`),
  `fact.change` (prior/next), `resolver.write.rejected`,
  `resolver.complete/error`, system lifecycle. Query by fact path
  (exact match, no LIKE wildcards), constraint id, kind, time range.
  Sync djb2 hash chain (`verify()` is sync); optional async SHA-256
  strong verify reserved for v2.

  Built-in **PII redaction**: fact values for `meta({ tags: ["pii"] })`
  keys are replaced with `"[redacted]"` by default. Opt out with
  `capturePII: true`.

  ```ts
  const ledger = createAuditLedger();
  createSystem({ module, plugins: [ledger.plugin] });

  ledger.query({
    factPath: "cartTotal",
    changedBetween: ["2026-01-01", "2026-06-01"],
  });
  ledger.verify(); // tamper detection
  ```

  ### `@directive-run/core`: `predict()`

  "Would this predicate fire against these facts? If not, what's the
  smallest change that would make it fire?" Closes the LLM-emit
  iteration loop: model writes rule → `predict()` reports
  `missingChanges` with human-readable suggestions → model rewrites.

  ### `@directive-run/core`: `doctor.checkAgainst()`

  Structural contradiction detection between a candidate predicate and
  existing constraints. Three types: `direct` (mutually exclusive),
  `subset` (candidate is redundant), `overlap` (warning). Pairs with
  `predicateFromIntent` for the "doctor says no" gate before LLM-emitted
  rules reach production.

  ### `@directive-run/core`: schema introspection

  `getKind(schema)`, `getSchemaFieldKinds(schema)`,
  `getOperatorsForKind(kindNode)` — runtime discriminant for the
  operator-on-kind matrix that previously only lived in the
  `OperatorObject<V>` type. Used by `predicateFromIntent` and
  `validatePredicateAgainstSchema`; also useful for prompt builders,
  playground UIs, and `predicateToZod` (future).

  ### `@directive-run/react`: `useAuditLedger`

  Subscribe to an audit ledger and get the latest entries matching a
  filter, re-rendering as new entries land. The "drop `<AuditLog />`
  in your dev sidebar" hook.

  ```ts
  const entries = useAuditLedger(ledger, {
    kind: "constraint.evaluate",
    limit: 20,
  });
  ```

  ### What's deferred (tracked in IDEAS.md)

  - **SQLite / Parquet / Loki sinks** — sink interface is open; v1 ships
    in-memory `memorySink` only.
  - **Audit-ledger devtools panel** — `useAuditLedger` hook ships;
    full panel integration with the floating devtools panel is a
    follow-up.
  - **Strong async SHA-256 verify** — v1 ships sync djb2 32-bit chain
    (fast, isomorphic, catches accidental + light-adversarial tamper).
    SHA-256 dual-chain reserved for v2.
  - **Full SMT-lite `doctor`** — z3.wasm-based satisfiability. v1 ships
    structural contradiction detection (direct / subset / overlap).
  - **`predicateToZod()`** — schema introspection unlocks this. ~0.5d
    follow-up once demanded.
  - **`useAuditLedger` for Vue / Svelte / Solid / Lit** — React only in
    v1; framework parity is mechanical.

  Compounds with: `@directive-run/query`, RFC-0004 data predicates, R4.G
  `replayUnder`, R4.F `diffRules`, R4.H `predicateToSQL`. The eight-tool
  story — see the `eight-tools-from-one-decision` blog post.

  > Correction (v1.12.x AE review): the original v1.11.0 language overpromised. The shipped substrate is tamper-evident with hash-chained (djb2 32-bit) entries; "court-admissible" and "GDPR-grade" were marketing claims that exceeded what the code delivers. See docs/concepts/audit-ledger.md for the accurate threat model.

## 1.10.0

## 1.9.0

## 1.8.0

## 1.7.0

## 1.6.1

### Patch Changes

- [`b506536`](https://github.com/directive-run/directive/commit/b506536aa7babfa2931b55c11ce6f36b13052e0d) Thanks [@jasoncomes](https://github.com/jasoncomes)! - fix: dev-mode validation runs in consumer production builds (v1.5.0 / v1.6.0)

  The published bundles in v1.5.0 and v1.6.0 baked `isDevelopment = true`
  as a literal — tsup resolved the `#is-development` package.json import
  to `dev-true.ts` (which was `export default true;`) and shipped the
  constant into the chunk. Every consumer's production build then ran
  dev-mode fact-validation as if `NODE_ENV` were `development`, and a
  fact-write that should have been valid threw mid-build:

  ```
  [Directive] Validation failed for "<key>": expected <type>, got null
  ```

  `directive.run` itself hit this — `next build` failed end-to-end on a
  clean v1.5.0 doc-site against the `@directive-run/ai` orchestrator's
  fact init.

  **The fix.** `dev-true.ts` is now a runtime expression that bundlers
  inline:

  ```ts
  export default typeof process !== "undefined" &&
    process.env?.NODE_ENV !== "production";
  ```

  - In a bundler (Webpack / Vite / Turbopack / Rollup / esbuild) for a
    consumer production build, the expression folds to literal `false` via
    the bundler's standard `process.env.NODE_ENV = "production"` define —
    dev-mode validation is dropped.
  - In a Node.js process, the check evaluates at runtime against the live
    `NODE_ENV`. Setting `NODE_ENV=production` correctly disables dev-mode
    validation; the default and `NODE_ENV=development` keep it on.
  - Edge / Workers / web-worker envs where `process` is undefined or
    partially polyfilled are guarded by the `typeof` check and the optional
    chain on `.env`.

  Also patched a sibling reference: `warnIfNotStarted` in `system.ts`
  read `process.env.NODE_ENV` without the same guard. Now mirrors the
  `dev-true.ts` form.

  **Required action for consumers on v1.5.0 / v1.6.0:** upgrade. There
  is no runtime workaround for the broken published bundle — the literal
  `true` was baked into the chunk and is read every time `createSystem`
  runs in any environment.

  Tested via the doc-site's `next build` against a local link of the
  patched packages — clean end-to-end after the change.

## 1.6.0

## 1.5.0

## 1.4.0

### Minor Changes

- [`9340e0d`](https://github.com/directive-run/directive/commit/9340e0d6af3c0ac85547cae9917162630c9ac445) Thanks [@jasoncomes](https://github.com/jasoncomes)! - feat: resolver constraint-binding (`bind: 'auto'`) + `useFactWithDefault`

  Adds opt-in resolver-constraint-binding that auto-rejects fact writes from
  resolvers whose triggering constraint has flipped to false. Eliminates the
  executor-tail-clobber footgun (event-driven terminal status getting
  overwritten by an in-flight resolver's tail). Default `bind: 'none'`
  preserves existing behavior; consumers opt in per-constraint.

  Also adds `useFactWithDefault(sys, key, factory)` for stable-identity
  nullable-fact fallbacks. Replaces the `useFact(sys, k) ?? factory()`
  pattern that breaks downstream memoization.

  **RFC-1 — Resolver constraint-binding (`@directive-run/core`):**

  ```ts
  constraints: {
    mutate: {
      when: (f) => f.status === "mutating",
      require: { type: "EXECUTE_ACTION" },
      bind: "auto", // NEW — default 'none'
    },
  }
  ```

  Semantics:

  - Each fact write through `ctx.facts` re-evaluates the constraint's
    `when()` predicate against the pre-write snapshot.
  - If the predicate returns `false`, the write is dropped, the resolver's
    `AbortController` is aborted, and `ctx.signal.aborted` becomes `true`
    on the next checkpoint.
  - One-shot per resolver invocation: once flipped false, the binding stays
    deactivated even if `when()` would later flip back to true mid-resolver.
  - Forbidden on async constraints (re-evaluating async predicates on every
    write would be unsound). Async + `bind: 'auto'` logs a dev warning and
    is treated as `'none'`.
  - No-op for `manager.callOne()` and out-of-band invocations (no source
    constraint).
  - Mixed-source batches fall back to no binding (predicate would be
    ambiguous).

  **RFC-2 — `useFactWithDefault` (`@directive-run/react`):**

  ```ts
  const markedCells = useFactWithDefault(sys, "markedCells", () =>
    deps.initializeMarkedCells()
  );
  ```

  The factory runs at most once per system instance. While the fact is
  `null`/`undefined`, every render returns the same cached identity. When
  the fact transitions to non-null, that value is returned. If the fact
  later returns to null, the cached factory result is reused (factory does
  NOT run again). Swapping the `system` argument re-runs the factory on the
  new system.

  **Tests added (+21):** 14 in core (12 unit-level binding tests in
  `resolvers.test.ts` + 2 engine-level integration tests in `engine.test.ts`)

  - 7 in react (`useFactWithDefault.test.tsx`). 0 regressions in the existing
    4091-test suite.

  Migration guide: `docs/upgrade-guides/constraint-binding.md` (added).

## 1.3.0

## 1.1.2

### Patch Changes

- [`81da1e2`](https://github.com/directive-run/directive/commit/81da1e285e96f29f40451bcd2a05e61345f94487) Thanks [@jasoncomes](https://github.com/jasoncomes)! - AE review fixes + test coverage for new features

  **Core:**

  - Fix: `reconcile.end` observation event fields renamed to `resolversCompleted`/`resolversCanceled` (correct semantics)
  - Fix: Observer cap (100 max) prevents memory leaks from fast-remounting components
  - Fix: `hasPlugins` cached as boolean for O(1) hot-path access
  - Fix: Knowledge docs `inspect()` section rewritten with correct field names
  - Tests: 8 tests for `system.observe()`, 9 tests for coverage/observer utilities

  **Adapters (React, Vue, Svelte, Solid, Lit):**

  - All 5 framework adapters migrated to `#is-development` compile-time imports
  - Tests: 6 tests for `createDirectiveContext` (useFact, useDerived, useEvents, Provider override, error boundary, useSystem)

## 1.1.1

## 1.1.0

### Minor Changes

- [`8ae20b1`](https://github.com/directive-run/directive/commit/8ae20b1f0d9e06bfbc01a3ff79f7c47ee6aba241) Thanks [@jasoncomes](https://github.com/jasoncomes)! - XState-inspired improvements: React context provider, observation protocol, coverage testing

  **React (`@directive-run/react`):**

  - `createDirectiveContext(system)` — returns `{ Provider, useFact, useDerived, useEvents, useDispatch, useSelector, useWatch, useInspect, useExplain, useHistory, useSystem }`. Eliminates prop-drilling. Provider accepts `system` override for testing.

  **Core (`@directive-run/core`):**

  - `system.observe(observer)` — typed inspection protocol with 18 event types (`ObservationEvent`). Enables browser extensions, third-party tools, and inspection-based test assertions. Implemented as internal plugin — zero overhead when no observers.
  - `createCoverageTracker(system)` — run test scenarios, get coverage report showing which constraints/resolvers/effects/derivations were exercised and which were missed. Something XState can't do.
  - `createTestObserver(system)` — collect all observation events during tests, filter by type for assertions.
  - `CLAUDE.md` — AI contributor guide with architecture, key files, conventions.

## 1.0.1

## 1.0.0

### Patch Changes

- Updated dependencies [[`a6a23b2`](https://github.com/directive-run/directive/commit/a6a23b2e52377a07bbbde52a89dcffcc3db2f826)]:
  - @directive-run/core@1.0.0
  - @directive-run/query@1.0.0

## 0.8.9

## 0.8.8

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

### Patch Changes

- [`97a780c`](https://github.com/directive-run/directive/commit/97a780c1d6bdf7b647e0118443dbedd6bbf6e6b7) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Post-release bug fixes:

  - Fix useSelector dep-retracking when selector function changes (React adapter)
  - Fix GraphQL headers function type (removed misleading facts parameter)
  - Fix expireAfter GC re-run bug (polling now restarts after re-activation cycles)
  - Cap mutateAsync pendingPromises Map at 100 with FIFO eviction
  - Harden replaceEqualDeep with Object.create(null) for prototype pollution defense
  - Document type inference tradeoff in createQuerySystem JSDoc
  - Add @directive-run/react install note to README

## 0.8.3

### Patch Changes

- [`0e51375`](https://github.com/directive-run/directive/commit/0e51375f17cb6b271b5af58b0c49f72b6ea945a5) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add @directive-run/query – declarative data fetching with causal cache invalidation.

  New package: createQuery, createMutation, createSubscription, createInfiniteQuery, createBaseQuery, createGraphQLQuery, createGraphQLClient, createQuerySystem, createQueryModule, withQueries, explainQuery. 191 tests across 15 test files.

  Framework adapters: useQuerySystem hook added to React, Vue, Svelte, Solid. QuerySystemController added to Lit. Factory pattern keeps @directive-run/query as zero-coupling optional dep.

## 0.8.2

## 0.8.1

### Patch Changes

- Fix `useFact` infinite re-render loop with React 19.

  - Fix `useFact` returning unstable object references from proxy access, causing `useSyncExternalStore` to trigger infinite update loops in React 19
  - Switch snapshot reads from facts proxy to raw `$store.get()` for stable references
  - Bump React dev dependencies from 18.x to 19.x

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
