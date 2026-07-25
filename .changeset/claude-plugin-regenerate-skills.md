---
"@directive-run/claude-plugin": patch
---

Regenerates the bundled Claude Code skill files so
`building-ai-agents/ai-adapters.md` and
`building-ai-agents/ai-agents-streaming.md` reflect the opt-in
prompt-caching feature that shipped in the previous release
(`@directive-run/ai` v1.5.0). Consumers pulling
`@directive-run/claude-plugin` see the updated `promptCaching`
documentation + cache-token usage examples inside their Claude
Code sidebar without needing to regenerate locally.

No API changes to the plugin itself; the skill files are the
only diff. `pnpm --filter @directive-run/claude-plugin
build:skills` is deterministic against `packages/knowledge/` —
this release just runs that regeneration and commits its output.
