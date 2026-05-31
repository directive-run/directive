---
"@directive-run/knowledge": patch
"@directive-run/cli": patch
"@directive-run/claude-plugin": patch
---

Final batch of the Tier-1 knowledge sweep. Three coordinated changes:

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
