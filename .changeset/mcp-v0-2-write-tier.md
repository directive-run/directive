---
"@directive-run/mcp": minor
---

`@directive-run/mcp@0.2.0` — 13 new MCP tools + SSE transport hardening.

**Reads, expanded (4):**

- `search_examples` — substring search across 37 bundled example .ts files.
- `list_packages` — every `@directive-run/*` package as name + one-line description, from a build-time-baked registry.
- `get_package_info` — single-package detail with baked metadata + LIVE npm version (1 h cache, 3 s timeout, falls back to baked).
- `get_composable_packages` — outgoing + incoming composition edges for a package, sourced from `@directive-run/knowledge`.

**Generate (2):**

- `generate_module` — wraps `@directive-run/scaffold` to return source for a new Directive module or AI orchestrator. Strict regex on name, enum on sections. Never writes to disk.
- `list_module_sections` — discovery tool for the `sections` enum.

**Metadata-as-data (4):**

- `list_review_rules` / `get_review_rule` — Directive anti-patterns parsed from `@directive-run/knowledge`.
- `list_migration_sources` / `get_migration_pattern` — concept maps + steps + before/after exemplars for migrating from Redux, Zustand, XState, MobX, Jotai, Recoil.

**Review + fix (2):**

- `review_source` — `@directive-run/lint` rule registry against a source string. Structured findings (line, column, severity, message) wrapped in `<directive-data>`. Pre-parse 200 KB cap.
- `fix_code` — apply a rule's mechanical fix; returns unified diff + fixed source + explanation, or `{ ok: false, reason }` when the rule has no fix.

**Server hygiene (1):**

- `get_server_info` — version manifest with transport, auth state, bundled-knowledge hash, package-registry build timestamp, and SSE session count.

**SSE transport hardening:**

- Bearer token auth (mandatory on non-loopback hosts), via `--token` or `DIRECTIVE_MCP_TOKEN`.
- 1 MB body cap on `/messages` (Content-Length pre-check + streaming guard).
- 64 concurrent-session cap; 429 + Retry-After past the limit.
- 5-minute idle session pruning.
- Optional `--allow-origin` allowlist.

**Net:** 7 → 20 tools, full input validation, hardened HTTP transport.
