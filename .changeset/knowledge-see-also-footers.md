---
"@directive-run/knowledge": patch
"@directive-run/claude-plugin": patch
---

Bidirectional `## See also` footers across all 25 hand-authored
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
