---
"@directive-run/cli": minor
"@directive-run/knowledge": patch
"@directive-run/claude-plugin": patch
---

Two shipping items closing v1.16 roadmap follow-ons.

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
