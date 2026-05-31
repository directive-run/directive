# @directive-run/claude-plugin

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
