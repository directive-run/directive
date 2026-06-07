---
"@directive-run/sandbox": minor
---

Widen the AST allowlist validator from the initial `@directive-run/{core,ai,query}` set to every consumer-safe `@directive-run/*` package, with an explicit denylist for build / CLI / sandbox-meta tooling.

- **Allowed (16):** `core`, `ai`, `query`, `react`, `vue`, `svelte`, `solid`, `lit`, `el`, `optimistic`, `timeline`, `mutator`, `knowledge`, `scaffold`, `claude-plugin`, `lint` — anything an end-user Directive demo realistically composes from.
- **Denied (4):** `cli` (uses `process.argv` + `fs.write`), `mcp` (speaks MCP over stdio, would let a sandboxed snippet open a transport), `sandbox` (sandbox-in-sandbox), `vite-plugin-api-proxy` (build tooling). Each gets a clear rejection message distinguishing "denied" from "not in allowlist."
- Subpath imports like `@directive-run/ai/openai` and `@directive-run/react/hooks` are honored — the validator extracts the package segment before checking the allowlist.
- Bundler's `external` list switched from the explicit three-package enumeration to a wildcard `@directive-run/*` so any allowlisted package resolves at worker runtime against the worker's `node_modules`.
- 22 new validator tests covering each allowlisted package, subpath import handling, each denied package, and `@sizls/*` rejection (no current scope).

No runtime-behavior change for snippets that were already passing (the v0.1.0 set is a subset of v0.2.0's). The strict-by-default rule documented in `validator.ts` was always "expand on real failures"; this is the first deliberate expansion.
