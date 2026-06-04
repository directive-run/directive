# @directive-run/claude-plugin

## 1.17.1

## 1.17.0

## 1.16.0

### Minor Changes

- [`2cee19e`](https://github.com/directive-run/directive/commit/2cee19e9819be81a00ad8d1cd64a620c7621a032) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Publish `@directive-run/claude-plugin` to npm alongside the Claude Code plugin marketplace install.

  The Claude Code marketplace remains the canonical install for end users (`/plugin install directive@directive-plugins`). The npm install path is for tool authors who need the skill bundles programmatically — custom skill registries, doc pipelines, eval harnesses, and AI orchestrators that route Directive skills through their own layer.

  New exports:

  - `listSkills(): string[]` — all skill names, alphabetical.
  - `getSkill(name): Skill | undefined` — manifest + supporting files for one skill.
  - `getAllSkills(): Map<string, Skill>` — every skill, keyed by name.
  - `getSkillFile(skillName, fileName): string | undefined` — one supporting file from a skill bundle.
  - `clearCache(): void` — reset the in-memory skill cache.
  - `Skill` interface: `{ name, manifest, files }`.

  The package ships the pre-built `skills/` directory in the npm tarball. The API reads from that directory; no install-time generation. Adds tsup dual-build (ESM + CJS + `.d.ts`).

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

  Closes v1.16.A from the IDEAS.md roadmap.

## 1.15.0

### Patch Changes

- [`97fd62f`](https://github.com/directive-run/directive/commit/97fd62f1646de1f3e66a6a53718096868e6346e7) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Move per-skill knowledge-file and example mappings into each template's
  YAML frontmatter. Adding a knowledge file now means editing the
  knowledge package and the matching template; previously a third edit
  to a `SKILL_MAP` constant in the build script was also required, which
  made it easy for the three sources to drift.

  The build script now discovers skills by scanning `templates/*.md` and
  reads `knowledgeFiles: [...]` and `examples: [...]` arrays from each
  template's frontmatter. The build-only fields are stripped from the
  `SKILL.md` that ships in each skill directory, so the published view
  Claude reads is unchanged. Generated skill content is byte-identical
  to the prior implementation.

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
