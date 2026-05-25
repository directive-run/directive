# @directive-run/ai

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

## 1.6.0

## 1.5.0

### Minor Changes

- [`e3b4cc6`](https://github.com/directive-run/directive/commit/e3b4cc661679e267039e2a64ee85d32f2fc00ddd) Thanks [@jasoncomes](https://github.com/jasoncomes)! - PII guardrails: split detection from redaction

  `detectPII` is now **detection-only**. The `redact` and `redactionStyle`
  options have been removed — `detectPII(text, options)` returns a
  `PIIDetectionResult` whose `redactedText` is always `undefined`. A new
  `detectAndRedactPII` helper covers the previous one-shot detect-and-redact
  shape.

  This is a small shape change on a utility export that hadn't reached a
  stable 1.x API contract; the migration is a one-line drop-in. Treating it
  as a `minor` reflects the practical migration cost rather than a wholesale
  v2 commitment.

  ### Migration

  Calls that relied on `detectPII(text, { redact: true, redactionStyle })`
  no longer compile. Pick the form that matches your usage:

  ```ts
  // Before
  const result = await detectPII(text, {
    redact: true,
    redactionStyle: "typed",
  });
  // result.redactedText -> the redacted string

  // After (one-shot, equivalent shape)
  import { detectAndRedactPII } from "@directive-run/ai";
  const result = await detectAndRedactPII(text, { style: "typed" });
  // result.redactedText -> the redacted string

  // After (separated — detect once, redact later)
  import { detectPII, redactPII } from "@directive-run/ai";
  const result = await detectPII(text);
  const redacted = result.detected
    ? redactPII(text, result.items, "typed")
    : text;
  ```

  `detectAndRedactPII` accepts every `detectPII` option plus an optional
  `style?: RedactionStyle`, and populates `redactedText` only when PII is
  actually detected (`undefined` otherwise).

  ### Also in this release

  - **`national_id` is now detectable** as a first-class `PIIType`.
  - **`redactPII` overlap handling fixed** — overlapping or adjacent matches
    no longer corrupt the redacted output.
  - **New PII type exports** for consumers building custom detectors and
    redaction flows (`PIIDetectionResult`, `DetectedPII`, `PIIType`,
    `PIIDetector`, `RedactionStyle`).

## 1.4.0

## 1.3.0

## 1.1.2

## 1.1.1

## 1.1.0

## 1.0.1

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

### Patch Changes

- Updated dependencies [[`a6a23b2`](https://github.com/directive-run/directive/commit/a6a23b2e52377a07bbbde52a89dcffcc3db2f826)]:
  - @directive-run/core@1.0.0

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

## 0.8.5

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
