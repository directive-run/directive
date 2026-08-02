# @directive-run/knowledge

## 1.24.1

## 1.24.0

## 1.23.1

### Patch Changes

- [`3a86db7`](https://github.com/directive-run/directive/commit/3a86db7a9ff55cff81150eadc766ae3ca47e5790) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Bump `vitest` to `^3.2.6` across every package that pins it directly, closing GHSA-9crc-q9x8-hgqq (arbitrary file read via Vitest's UI server prior to 3.2.6). Dev-dependency only — no runtime code ships to consumers changes. The full workspace test suite (5,383 tests across 195 files) runs green on 3.2.7.

  Per-package `test` scripts now delegate to the workspace root (`cd ../.. && vitest run packages/<name>/`) to match Vitest 3's cwd-relative `include` resolution.

## 1.23.0

## 1.22.0

## 1.21.0

### Minor Changes

- [`0c2d306`](https://github.com/directive-run/directive/commit/0c2d30637d854098286980309a00f2152c9997d4) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add `hasKnowledge(name)` and `hasExample(name)` so LLM-driven callers can disambiguate "this name isn't bundled" from "this file is intentionally empty".

  `getKnowledge("typo")` and `getExample("typo")` continue to return `""` for back-compat — they previously returned `""` whether the name was missing OR the file was actually empty. Agent code writing the name from LLM output had no signal when it typo'd one; the prompt just degraded silently. Pair the new `has*` check with the existing getter:

  ```ts
  import {
    getKnowledge,
    hasKnowledge,
    getAllKnowledge,
  } from "@directive-run/knowledge";

  if (!hasKnowledge(userTyped)) {
    console.error(`unknown knowledge file: ${userTyped}`);
    console.error(`available: ${[...getAllKnowledge().keys()].join(", ")}`);
    return;
  }
  const md = getKnowledge(userTyped);
  ```

  Also adds JSDoc + `@example` blocks to the four public loaders (`getKnowledge`, `getAllKnowledge`, `getExample`, `getAllExamples`) explaining the miss-vs-empty disambiguator.

## 1.20.2

## 1.20.1

## 1.20.0

## 1.19.7

## 1.19.6

## 1.19.5

## 1.19.4

### Patch Changes

- [#63](https://github.com/directive-run/directive/pull/63) [`134b7b9`](https://github.com/directive-run/directive/commit/134b7b917156f07e1b1ecdb1f5ba75068274bce3) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Knowledge docs tail — choosing-primitives matrix + LangChain/Vercel/LlamaIndex comparison

  Closes the last two small docs items from R14 deferred list (the third — runnable `examples/ai-live-context/` Vite scaffold — is queued separately as a bigger work item).

  - New `packages/knowledge/core/choosing-primitives.md` decision matrix for the six core primitives (`facts` / `derivations` / `events` / `constraints` / `resolvers` / `effects` / `sources`). Side-by-side comparisons for the common confusion pairs (`effect` vs `source`, `derivation` vs `resolver` vs `effect`, `event` vs `resolver`, `constraint` vs `derivation`). Worked example: a chat app that mirrors a Supabase realtime channel + calls a moderation API maps every layer to a single primitive — every external touch is a source or resolver, every state field is a fact or derivation, zero `useEffect` hooks.

  - New "## What other agent frameworks have (and don't)" section in `ai-sources.md` comparing `runStream({ liveContext })` against LangChain / LangGraph / Vercel AI SDK / LlamaIndex across six capabilities (mid-generation fact updates, declarative source, interrupt + resume, PII guard at the publish→fact boundary, source × OTel out of the box, multi-system composition). Sets the pitch explicitly: Directive's differentiator is "your state engine and your agent runtime share one fact store" — not "we're a better LangChain."

  - Added `choosing-primitives` to `getting-started-with-directive` skill so the matrix ships in the bundled claude-plugin and an LLM consuming the skill finds the decision tree on first use.

## 1.19.3

### Patch Changes

- [#61](https://github.com/directive-run/directive/pull/61) [`869e8fc`](https://github.com/directive-run/directive/commit/869e8fc3f12f6f4677e7c7c27e2a9ea795cfc4d1) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Knowledge docs deferred batch — RFC index + sources install line + Runtime Compat + polling recipe + attachSourcesToOtel recipe

  Closes five docs-deferred items, all explicit acceptance criteria from RFCs 0005 / 0009:

  - `docs/rfcs/README.md` index listing every RFC's title / status / landing version, plus the open follow-up RFCs queue (live-context auto-reprompt, walker security rewrite via structuredClone, pre-emit transform hook, `source.evict` observation event, reconnect contract, `publish.complete()` channel).
  - `@directive-run/sources` install lines in `ai-sources.md` covering the umbrella + the two vendor peerDeps (`@supabase/supabase-js`, `@cloudflare/workers-types`). Documents that both peerDeps are optional and pull in only when the corresponding subpath is imported.
  - `## Runtime compatibility` section in `core/sources.md` per RFC 0009 acceptance criterion — matrix across Cloudflare DO / Workers / Bun / Deno / Browser / Node for the shipped adapters (`sourceFromSupabaseChannel`, `sourceFromDOAlarm`, `sourceFromWebSocketMessage`).
  - `### Polling — when a transport is request/response only` recipe in `core/sources.md` with the full `setInterval` + `AbortController` + `reportError` + `coalesce: "lastWriteWins"` pattern (the pattern was previously inline-mentioned but had no recipe section).
  - `## Observability — pipe source.* events to OpenTelemetry` recipe in `ai-sources.md` covering `attachSourcesToOtel(system, { tracer, serviceName })`, with a cross-ref from `core/sources.md` Observation section. Closes the gap between RFC 0005 / RFC 0009's mention of source-side observability and the actual `@directive-run/ai`-side helper.

## 1.19.2

## 1.19.1

## 1.19.0

## 1.18.0

## 1.17.2

## 1.17.1

### Patch Changes

- [`e4e3d08`](https://github.com/directive-run/directive/commit/e4e3d0809fc44892cbd1a28c76ebe61e8b7317ad) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Post-0.2.2 production-readiness review — 12 critical fixes shipped together.

  **`@directive-run/mcp@0.2.3`**

  - Worker_threads is now ON by default for `review_source` and `fix_code`. Falls back to in-process only inside vitest (`VITEST=true`) or when `DIRECTIVE_MCP_USE_LINT_WORKER=0` is set explicitly. Hostile or pathological sources can no longer pin the event loop past the 5-second budget — the original v0.2.0 hard requirement is finally the default.
  - `get_composable_packages` returns `isError: true` with a structured `NOT_FOUND` / `NO_COMPOSITIONS` prefix when the package name isn't known to the graph, instead of a misleading success-with-prose response. LLM clients can now distinguish "you typed it wrong" from "data absent."
  - SSE session-cap hardened against future SDK changes that might add async-leaky behavior to the transport constructor — a synchronous `pendingConnects` counter is incremented before any yield, so the cap can't be over-shot by N concurrent connects observing the same `sessions.size`.
  - `prepublishOnly` script chains `clean && build` so the published tarball can't ship a stale baked package registry.
  - README rebuilt around a 3-step Try it block, a full `## How it works` section with an ASCII architecture diagram, a `## Troubleshooting` table covering the four most common first-time failures, and accurate prose throughout (no more "queryable at retrieval time instead of bundled as a static snapshot" jargon).

  **`@directive-run/lint@0.1.2`**

  - **Lazy ts-morph is finally true at the bundle level.** v0.1.0 and v0.1.1 statically imported `SyntaxKind` from `ts-morph` in every rule file, so tsup inlined the rules barrel into `dist/index.js` and ESM hoisted ts-morph to the top — every consumer of `getRules()` paid the ~25 MB ts-morph load at module-init. Fixed by extracting the metadata into `rule-metadata.ts` (no ts-morph chain) and splitting the executable rules into a separate tsup entry (`./executable`) that's loaded only when `runRules` or `applyFix` fires. Verified: `dist/index.js` has zero references to ts-morph or `SyntaxKind`.
  - `resolver-naming-mismatch` dropped from `warning` to `info` severity, with explanation rewritten. No canonical Directive doc requires the camelCase convention; warning-level was lint-blasting real codebases. Disable via `ruleFilter` in projects that use semantic keys.
  - `module-missing-facts-schema` explanation rewritten — flat schemas don't produce a runtime error, they silently register no facts. The previous wording misled users.
  - New `./executable` subpath export and `./executable.d.ts` types so worker-thread consumers can resolve the rule registry without going through the main entry.

  **`@directive-run/knowledge@1.17.1`**

  - Redux migration's concept map fixed: `useSelector → useFact("x") / useDerived("y")`. The previous mapping pointed migrators at a `useSelector` API that doesn't exist with that shape in `@directive-run/react`. The steps section already said the right thing; the concept map now agrees.

## 1.17.0

### Minor Changes

- [`f98c183`](https://github.com/directive-run/directive/commit/f98c1835e6c13f382420bd93412ff4a54b586d2a) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Knowledge data APIs — structured anti-pattern, migration, and composition data shipping in the published tarball.

  **New JSON assets:**

  - `compositions.json` — 42-edge graph covering every `@directive-run/*` package with one-line reasons. Powers `@directive-run/mcp`'s `get_composable_packages` tool.
  - `migration.json` — structured concept maps + step lists + before/after exemplars for migrating to Directive from Redux, Zustand, XState, MobX, Jotai, Recoil. Powers `get_migration_pattern`.

  **New parsers + exports:**

  - `getAntiPatterns()` / `getAntiPatternById(id)` — structured parse of `core/anti-patterns.md`. Returns `{ id, severity, category, title, badExample, goodExample, explanation }`.
  - `getCompositions()` / `getCompositionsFor(pkg)` / `getReverseCompositionsFor(pkg)` — flat list, outgoing edges, incoming edges.
  - `getMigrationSources()` / `getMigrationPattern(source)` / `getMigrationPatterns()` plus the `MIGRATION_SOURCES` constant.

  All loaders are lazy + cached + return frozen arrays. `clearXxxCache()` helpers for tests / watch mode. Data files ship in the tarball via the `files` array.

## 1.16.0

### Patch Changes

- [`06be54d`](https://github.com/directive-run/directive/commit/06be54d891c91a3ee0b170f4bc66e6e37fe5a023) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Two shipping items closing v1.16 roadmap follow-ons.

  **`npx directive install` one-shot.** New top-level command (and
  `ai-rules install` alias) that drops Directive AI rules into every
  supported assistant in a single non-interactive command — Cursor,
  Copilot, Windsurf, Cline, OpenAI Codex, and Claude Code. No prompts,
  no per-tool selection. Matches the install UX TanStack pioneered with
  `@tanstack/intent`. Idempotent on re-run — first install wraps each
  rules file's content in HTML-comment section markers (invisible in
  rendered markdown), so subsequent `install` / `ai-rules update` runs
  merge cleanly while preserving any user-authored content outside the
  markers. `--force` overwrites; default behavior on a non-Directive
  existing file is to skip with an informative message rather than
  clobber.

  ```bash
  # v1.15 path (still works, interactive)
  npx directive ai-rules init

  # v1.16 path (new, one-shot, every tool)
  npx directive install
  ```

  For Claude Code users the canonical install remains the plugin
  (`/plugin marketplace add directive-run/directive` then `/plugin
install directive@directive-plugins`); the `CLAUDE.md` file the
  `install` command produces is the fallback for repos that don't use
  Claude Code's plugin system.

  **`naming.md` rewritten as an alias map.** The previous version of
  `packages/knowledge/core/naming.md` aggressively forbade vocabulary
  that an evaluator would search for (`selectors`, `actions`, `stores`,
  `atoms`, `reducers`, `thunks`, `sagas`) without providing the bridge
  back to the Directive equivalent. A developer searching the knowledge
  package for "what's the Directive equivalent of Zustand selectors?"
  or "Redux reducer in Directive?" found nothing — the strict naming
  rules made the package un-searchable for cross-paradigm queries.

  The rewrite leads with a "Coming from another library? Start here"
  table that maps every common alias from Redux / Zustand / Jotai /
  XState / MobX / Recoil / TanStack Query / Apollo / NgRx / Pinia /
  LangChain to the Directive equivalent, with a one-line "why the name"
  hint. The strict canonical-terms rules stay non-negotiable for code
  Directive ships — both directions are now listed in the bidirectional
  "Terminology quick reference" table at the bottom so retrieval works
  regardless of which vocabulary the searcher knows.

  Bundle size impact: ~2KB added to the Claude Code template; the
  template-output test cap raised from 40KB to 50KB. The 50KB ceiling
  still sits well within Claude Code's actual CLAUDE.md ingestion
  budget.

- [`92d7930`](https://github.com/directive-run/directive/commit/92d793041ea3aac3190b798304913359f8588e20) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Bidirectional `## See also` footers across all 25 hand-authored
  knowledge files (13 core + 12 ai). Phase D2 from the v1.15 plan,
  deferred at the time as honest 2-3 sessions of editorial work.

  Each footer cross-links 2-7 sibling files with a one-clause "what
  this adds" hint, designed so a developer or LLM reading any file in
  isolation has an honest breadcrumb to the related concepts instead
  of a dead end. Bidirectionality is enforced — if `constraints.md`
  links `resolvers.md`, `resolvers.md` links back. The cross-link
  graph was designed against the conceptual pair-ups that recurred
  across the v1.15 audit:

  - Core constraint-resolver loop: `constraints` ↔ `resolvers` ↔
    `core-patterns` ↔ `multi-module` ↔ `anti-patterns`
  - Module + system shape: `core-patterns` ↔ `schema-types` ↔
    `system-api` ↔ `multi-module` ↔ `react-adapter`
  - Testing + history loop: `resolvers` ↔ `testing` ↔ `history` ↔
    `system-api`
  - Plugins + error handling: `plugins` ↔ `error-boundaries` ↔
    `system-api`
  - AI orchestrator + multi-agent: `ai-orchestrator` ↔
    `ai-multi-agent` ↔ `ai-communication` ↔ `ai-tasks` ↔
    `ai-testing-evals`
  - AI orchestrator config surface: `ai-orchestrator` ↔
    `ai-guardrails-memory` ↔ `ai-budget-resilience` ↔
    `ai-debug-observability` ↔ `ai-adapters` ↔ `ai-agents-streaming`
  - AI security: `ai-security` ↔ `ai-guardrails-memory` ↔ `ai-mcp-rag`

  Skill bundles rebuilt atomically in the same commit; the cross-link
  file paths are relative (`./X.md`) so they resolve correctly inside
  both the published knowledge package directory and inside each
  Claude Code skill bundle (where the linked files are siblings on
  disk).

  Closes the v1.16.A roadmap item.

## 1.15.0

### Patch Changes

- [`93cd8b8`](https://github.com/directive-run/directive/commit/93cd8b804c79ae3f08a52d9848312faf135f2cf5) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Docs UX reconciliation: AI tooling becomes a first-class install path
  and Directive's coding knowledge ships from one source-of-truth to
  every assistant.

  A new `/docs/ide-integration` page at directive.run is the canonical
  decision tree across Claude Code, Cursor, GitHub Copilot, Windsurf,
  Cline, OpenAI Codex, and the programmatic `@directive-run/knowledge`
  API. The docs sidebar gets an "AI Tooling" section as item #2 between
  Getting Started and Core API, surfacing the integration path
  alongside the core learning journey. The `/llms.txt` route gains an
  "Install paths for your AI assistant" block so LLM agents crawling
  the docs at runtime learn how a downstream developer would install
  the same knowledge they're consuming.

  The Claude Code install path becomes real: a `.claude-plugin/
marketplace.json` is now committed to the directive monorepo root —
  previously gitignored, which is why `/plugin marketplace add
directive-run/directive` returned 404 from GitHub. Users can now run
  the two-step install the claude-plugin README has been documenting:

  ```
  /plugin marketplace add directive-run/directive
  /plugin install directive@directive-plugins
  ```

  Every published adapter README (query, mutator, optimistic, timeline,
  el, cli, vite-plugin-api-proxy) gains two new sections: a "Composes
  with" footer linking the sibling packages it commonly composes with
  (fixes the nav-orphan gap from R7 — query had no links to mutator /
  optimistic / timeline despite being designed to compose), and a "Use
  this package with your AI assistant" hook tied to that package's
  value prop. Each knowledge `.md` file in `@directive-run/knowledge`
  gains a one-line top-of-file breadcrumb naming the package(s) it
  documents, so a developer or LLM reading any file in isolation knows
  immediately which import to use.

  The top-level monorepo README gains an "AI tooling" section between
  the existing AI Guardrails and React sections. The
  `@directive-run/knowledge` README is restructured so consumer
  pathways (plugin / CLI / programmatic / llms.txt) lead, instead of
  the programmatic API which previously dominated above the fold.

  Strategic FYIs for the v1.15 release notes — these are NOT shipping
  in v1.15 but are explicitly tracked:

  - `@directive-run/claude-plugin` npm publication is under evaluation;
    the plugin stays Claude Code marketplace-only for v1.15.
  - See-also cross-link footers across the 25 knowledge files are on
    the v1.16 roadmap.
  - MCP SSE server (`mcp.directive.run`) for live agent retrieval is on
    the v1.16 roadmap.

  No code changes; no API changes; this is the docs UX reconciliation
  that makes v1.15's AI tooling story discoverable.

- [`dc739d7`](https://github.com/directive-run/directive/commit/dc739d7157650759f2899701edd95124ed9c16f1) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Rewrite `ai/ai-multi-agent.md`, `ai/ai-guardrails-memory.md`,
  `ai/ai-budget-resilience.md`, and `ai/ai-testing-evals.md` against
  the actual v1.14 exports. Every one of these four files had
  comprehensive hallucinations that caused LLM-generated code to fail
  at import time or first call.

  **ai-multi-agent.md** had been teaching `dag([{}])` as an array form
  (real shape: `Record<string, DagNode>` with `deps` not
  `dependencies`), `parallel(handlers)` without a required `merge` arg,
  `reflect("name", opts)` without a required `evaluator` agent,
  `debate(arr, {judge})` instead of `debate(DebateConfig)` with
  `evaluator`, and `goal("agent", opts)` instead of
  `goal(Record<string, GoalNode>, when, options)`. All five pattern
  factory signatures were wrong.

  **ai-guardrails-memory.md** had `createOutputSchemaGuardrail({
schema, retries })` (real shape: `{ validate, errorPrefix }`),
  `createToolGuardrail({ allowedTools })` (real: `{ allowlist,
denylist, caseSensitive }`), `createLengthGuardrail({ minChars,
maxChars, minTokens, maxTokens })` (real: only `maxCharacters` and
  `maxTokens` — no min, no `maxChars` spelling),
  `createContentFilterGuardrail({ patterns, action: "redact" })`
  (real: `{ blockedPatterns, caseSensitive }`, block-only, no redact
  mode), and `GuardrailError.errorCode` / `error.reason` (real:
  `error.code` / `error.userMessage`).

  **ai-budget-resilience.md** had `withFallback(primary, backup)`
  (real: array of runners), `withRetry({ backoff, shouldRetry })`
  (neither option exists; real: `{ maxRetries, baseDelayMs,
maxDelayMs, isRetryable, onRetry }`), `createCircuitBreaker({
resetTimeout, halfOpenMaxAttempts })` (real: `recoveryTimeMs` and
  `halfOpenMaxRequests`), `breaker.wrap(runner)` / `breaker.state`
  (real: `breaker.execute(fn)` / `breaker.getState()`),
  `createHealthMonitor({ agents, checkInterval, onStatusChange })`
  with `monitor.start()`/`getReport()`/`stop()` (real: a metrics
  tracker with `recordSuccess`/`recordFailure`/`getHealthScore`),
  `createOpenAIEmbedder` and `createAnthropicEmbedder` (neither exists
  — users supply their own `EmbedderFn`), and `cache.wrap(runner)`
  (real: pair `createSemanticCache` with
  `createSemanticCacheGuardrail`).

  **ai-testing-evals.md** had `createMockRunner` (real:
  `createMockAgentRunner`), five hallucinated `assert*` helpers
  (`assertAgentCalled`/`assertTokensUsed`/etc. — none exist), the
  entire `createEvaluator` + `criteria.*()` namespace + `createLLMJudge`

  - `createEvaluationSuite` (all hallucinated — real surface is
    `createEvalSuite` with top-level `evalCost`/`evalLatency`/`evalJudge`
    /`evalRelevance`/`evalCoherence`/`evalFaithfulness`/etc. factories),
    and `createErrorSimulator` / `createLatencySimulator` (real:
    `createFailingRunner` + `delay` on `MockAgentConfig`).

  All four files now use full runnable examples with the actual import
  paths (`@directive-run/ai/multi-agent`, `@directive-run/ai/guardrails`,
  `@directive-run/ai/evals`, etc.) instead of the main barrel, and
  inline every hallucination as a WRONG/CORRECT pair so future LLMs
  catch the same drift on first read.

  No code changes; no API changes; this is a content fix to the
  published knowledge package.

- [`19b056c`](https://github.com/directive-run/directive/commit/19b056cb1ff0efdd9f3fd2c99a03bd4835a10f08) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Final batch of the Tier-1 knowledge sweep. Three coordinated changes:

  **Subpath barrel migration (T1.9).** Knowledge AI files and the
  checkers example now import `createMultiAgentOrchestrator`, `parallel`,
  `createOutputSchemaGuardrail`, and related multi-agent / guardrail
  symbols from their `@directive-run/ai/multi-agent` and
  `@directive-run/ai/guardrails` subpath barrels instead of the main
  `@directive-run/ai` barrel. The main-barrel re-exports are marked
  `@deprecated` and will be removed in v2; every example now compiles
  clean against the post-v2 surface.

  **Broken example extracts removed (T1.10).** Adds
  `debounce-constraints` and `multi-module` to the
  `EXCLUDED_EXAMPLES` list in
  `packages/knowledge/scripts/extract-examples.ts`. Both had structural
  mismatches between the source layout and the extractor's preferred-
  file-name heuristic, producing bundled `.ts` files with bare string
  literals (debounce-constraints) and zero schema definitions plus
  unresolved relative imports (multi-module). Their underlying concepts
  remain covered by `permissions.ts`, `shopping-cart.ts`, and
  `async-chains.ts` — which all extract cleanly.

  `examples/checkers/src/ai-orchestrator.ts` also fixed in the same
  pass: the `dispose` / `destroy` rename hole is closed (the canonical
  verb is `destroy()` for the orchestrators and `destroy()` for the
  observability instance), the broken `.lab.js` import is replaced with
  the public `@directive-run/core/plugins` exports (`createObservability`
  and `createAgentMetrics` are both shipped on the public barrel), and
  `createLengthStreamingGuardrail` is imported from the right home (it
  lives on the main `@directive-run/ai` barrel, NOT under
  `/guardrails`). The bundled `ai-orchestrator.ts` and `checkers.ts`
  examples both regenerate from this fixed source.

  `examples/data-triggers/src/index.ts` also gets `(req, ctx)` →
  `(req, context)` to match the team's naming convention.

  **Comparison framing injected into discovery surfaces (T1.11).** The
  CLI-generated `.cursorrules` (cursor.ts template) and `CLAUDE.md`
  (claude.ts template) now lead with a "When to reach for Directive"
  section that explicitly positions the package against Redux Toolkit,
  Zustand, Jotai, XState, React Query, and TanStack Query. The unique
  claim — "state and AI agents share the same runtime" — is stated
  verbatim, because `@directive-run/ai` is structurally the only
  state-library ecosystem that ships LLM orchestration as a sibling
  concept. The same paragraph is added to the website's `/llms.txt`
  route so an LLM doing free-form retrieval also sees the positioning
  inline instead of clicking through the buried `/comparison` page. The
  cursor template also drops the stale anti-pattern that flagged
  `useDirective` (which DOES exist in v1.14) and the now-corrected
  GuardrailError field names propagate into the claude template's
  anti-pattern table.

  No code changes; no API changes; this is a content + tooling fix.

- [`5f5dd4d`](https://github.com/directive-run/directive/commit/5f5dd4d36b80bce0a13152cfa4db3895fc53616e) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Fix the five critical knowledge issues flagged by the v1.14 audit.

  **core/testing.md** rewritten against the actual `createTestSystem`
  overload — options-object only (`{ module: ... }` or `{ modules: ... }`),
  no separate `createTestSystemFromModules` factory, mocks keyed by
  type under `mocks.resolvers: { TYPE: { resolve: (req, context) => ... } }`,
  and assertion helpers exposed as methods on the test-system instance
  (`system.assertRequirement`, `system.assertFactSet`,
  `system.assertResolverCalled`, `system.assertFactChanges`) rather
  than as top-level imports. Inspect results now reference the real
  `inspection.unmet` / `inspection.inflight` accessors instead of the
  fictitious `inspection.requirements` field.

  **core/constraints.md** changes the very first "basic anatomy"
  example to use the function form of `require:` so that `facts.userId`
  is actually in scope. The previous static-object example with a bare
  `facts.userId` reference would not compile.

  **core/multi-module.md** and **core/anti-patterns.md** reconciled on
  `dispatch()`: the string-keyed two-argument form
  (`system.dispatch("login", payload)`) does not exist, but the
  single-arg object form (`system.dispatch({ type: "login", token })`)
  is supported and is the right escape hatch for forwarding
  programmatically-built events. The events accessor remains the
  preferred path; both files now say the same thing.

  **core/naming.md** rewrites the "Always Use Braces" section to stop
  flip-flopping between WRONG and "wait actually". The rule is now
  stated plainly: arrow-expression bodies (single-line derivations,
  predicates, computed requirements) stay concise; control-flow blocks
  (`if` / `for` / `while`) always use braces.

  No code changes; no API changes; content fix to the published
  knowledge package.

- [`8008465`](https://github.com/directive-run/directive/commit/80084654073360a1a84d2cab80d36db5e2b10561) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Rewrite `core/react-adapter.md` and `ai/ai-orchestrator.md` against the
  actual v1.14 exports. Both files were teaching hallucinated APIs that
  caused every LLM scaffolding code from these knowledge files to fail
  at import time or runtime.

  The React adapter file had been teaching `useEvent` (singular),
  `useSystem` as a top-level import, `DirectiveProvider` as a top-level
  import, and `useDirectiveContext` — none of which exist as top-level
  exports. The rewrite leads with the canonical `createDirectiveContext`
  pattern (the actual sanctioned way to share a system across a
  component tree) and shows the typed standalone hooks (`useFact`,
  `useDerived`, `useEvents`, `useDispatch`, `useSelector`, `useDirective`)
  in full runnable example files. The hallucinations are now called out
  inline with a "use instead" table.

  The AI orchestrator file had been teaching five hook names
  (`onStart`, `onBeforeRun`, `onAfterRun`, `onError`, `onBudgetWarning`
  inside `hooks`) that don't exist on `OrchestratorLifecycleHooks`,
  along with a sync `checkpoint()` that's actually async, a
  `createAgentOrchestrator({ checkpoint })` restore option that doesn't
  exist (real flow: `orch.restore(cp)` on an existing instance), and
  state fields (`runCount`, `lastError`, `tokenUsage.total`) that don't
  match `AgentState`. The rewrite shows the real hook names
  (`onAgentStart` / `onAgentComplete` / `onAgentError` / `onAgentRetry`
  / `onGuardrailCheck`), the correct top-level placement of
  `onBudgetWarning`, async checkpoint flow, the `{ stream, result,
abort }` shape returned by `runStream`, and the actual nested-under-
  `agent` state read path.

  Both files now use full runnable file examples (imports + exports +
  runnable) instead of fragments, so LLMs aren't forced to fill in
  missing imports with guessed paths.

  No code changes; no API changes; this is a content fix to the
  published knowledge package.

- [`b4f748b`](https://github.com/directive-run/directive/commit/b4f748bbf194dadc019413f47dea3505147102c9) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Rewrite `ai/ai-debug-observability.md`, `ai/ai-security.md`,
  `ai/ai-mcp-rag.md`, `ai/ai-agents-streaming.md`, and
  `ai/ai-communication.md` against the actual v1.14 exports. Closes the
  final batch of T1.7 in the knowledge content sweep.

  **ai-debug-observability.md** had been teaching
  `timeline.subscribe(listener, { filter })` (no options arg exists),
  `timeline.query({type, since})` (no `.query()` exists — real surface
  is typed `getEventsByType<T>` / `getEventsInRange` /
  `getEventsForAgent` / `getEventsAtSnapshot`), `debug: { timeline,
verbose, breakpoints }` (real `OrchestratorDebugConfig` has only
  `verboseTimeline?: boolean`; breakpoints + onBreakpoint are top-level
  options; the timeline is read off `orchestrator.timeline` after
  construction), and breakpoint configs with imaginary `when()` /
  `onHit(event, resume)` shapes (real shape is declarative
  `before:`/`after:` event type + optional `filter:` predicate, resumed
  via `orchestrator.resumeBreakpoint(id)`).

  **ai-security.md** had `createAuditTrailPlugin` and
  `createCompliancePlugin` from `@directive-run/core/plugins` (real:
  `createAuditTrail` and `createCompliance` from `@directive-run/ai`),
  both treated as Directive plugins to drop into `plugins:[…]` (real:
  they return instances you record into / call directly).
  `createPromptInjectionGuardrail` had `sensitivity` and `allowlist`
  options (real: `strictMode`, `blockThreshold`, `additionalPatterns`,
  `replacePatterns`, `sanitize`, `onBlocked`, `ignoreCategories`).
  `createPIIGuardrail` was being used on both input and output (real:
  it's input-only; `createOutputPIIGuardrail` covers output).

  **ai-mcp-rag.md** fixed every lifecycle verb
  (`disconnect("name")` / `disconnectAll()` → `disconnectServer(name)`
  / `disconnect()`), the status surface
  (`getStatus()` → `getServerStatus(name)` + `getAllServerStatuses()`),
  the tools return type (`getTools()` returns
  `Map<server, MCPTool[]>` not a flat array), the MCPAdapterConfig
  options (`autoConnect` / `autoReconnect` / `approvalTimeoutMs` /
  `allowDirectCalls` / `clientFactory` — not `connectionTimeout` /
  `reconnect`), and the embedder shape (`EmbedderFn = (string) =>
Promise<number[]>` — no `createOpenAIEmbedder` /
  `createAnthropicEmbedder` factories exist; users supply their own
  embedder, optionally batched via `createBatchedEmbedder`).

  **ai-agents-streaming.md** fixed `createStreamingCallbackRunner` →
  `createStreamingRunner(callbackBased, opts)` (the callback form is
  the INPUT to this wrapper, not a separate factory),
  `createSSEResponse(stream)` → `createSSETransport(config)` with
  `{ toResponse, toStream }`, the runStream return value
  (`{ stream, result, abort }`, not an AsyncIterable directly), and the
  `TokenUsage` shape (only `inputTokens` and `outputTokens` — no
  `total`).

  **ai-communication.md** fixed `bus.request(...)` (lives on
  `AgentNetwork.request(from, to, action, payload, timeout)` — not on
  the MessageBus), the subscription return type (`Subscription` with
  `.unsubscribe()`, not a bare unsubscribe function), the
  `findByCapability` return type (`AgentInfo[]`, not `string[]`),
  removed the fictitious `network.route(capability, payload)` method,
  removed the `createMultiAgentOrchestrator({ bus })` option (wire the
  bus alongside the orchestrator via hooks), and corrected the
  scratchpad mutability story (the scratchpad is `Readonly` — return
  new state through task outputs).

  All five files now use full runnable examples with the correct
  subpath import paths and inline every hallucination as a WRONG/CORRECT
  pair. T1.7 closed — combined with T1.1-T1.6 this completes the
  Tier-1 knowledge content rewrites against v1.14.

  No code changes; no API changes; this is a content fix to the
  published knowledge package.

- [`f1c0c7c`](https://github.com/directive-run/directive/commit/f1c0c7cf0e0320f15bc154fc9b09dbb17608c24e) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Fix `parseNavigation` so the last section of `docsNavigation` no longer
  gets misplaced under `aiNavigation` when the parser walks `navigation.ts`.

  The parser switches `currentArray` when it sees `export const aiNavigation`
  but did not flush the in-progress section into the old array first. The
  next title-only line would then push the orphaned section into the wrong
  bucket. In the published `sitemap.md`, that meant "Integration Guides"
  appeared under `## AI` instead of `## Docs`. The regenerated sitemap now
  places it correctly and surfaces the new "Composing all four" entry under
  Packages.

  Also adds 43 unit tests across the four generator scripts
  (`build-skills`, `generate-sitemap`, `generate-api-skeleton`,
  `extract-examples`), covering frontmatter parsing, nav walking,
  kind-order rendering, DOM-stripping rules, and the `addHeader` formatter.
  The pure helpers are now exported and each `main()` is gated on
  `import.meta.url === \`file://${process.argv[1]}\`` so tests can import
  the helpers without triggering script execution.

## 1.14.0

## 1.13.0

## 1.12.0

## 1.11.0

## 1.10.0

## 1.9.0

## 1.8.0

## 1.7.0

## 1.6.1

## 1.6.0

## 1.5.0

## 1.4.0

## 1.3.0

## 1.1.2

## 1.1.1

## 1.1.0

## 1.0.1

## 1.0.0

## 0.8.9

## 0.8.8

## 0.8.7

## 0.8.6

## 0.8.5

## 0.8.4

## 0.8.3

## 0.8.2

## 0.8.1

## 0.8.0

### Patch Changes

- ### Features

  - Dev-mode nested mutation detection in facts store
  - Docs-artifacts CI job with knowledge bundling

  ### Refactors

  - Extract engine subsystems (accessors, definitions, trace) and deduplicate system.ts

  ### Chores

  - Update docs references for standalone directive-docs repo
  - Website extraction cleanup

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

## 0.2.0
