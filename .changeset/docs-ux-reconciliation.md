---
"@directive-run/knowledge": patch
"@directive-run/cli": patch
"@directive-run/claude-plugin": patch
"@directive-run/mutator": patch
---

Docs UX reconciliation: AI tooling becomes a first-class install path
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
