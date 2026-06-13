---
"@directive-run/mcp": minor
---

Per-process lint-worker cap with AbortSignal support, plus README + bundled-skill regen.

**New: `setMaxConcurrentLintWorkers(n)`.** Now re-exported from the main entry. Caps the simultaneously-running ts-morph lint workers spawned by the `review_source` / `fix_code` MCP tools. Each worker spawns a ts-morph project + a thread; a multi-client burst (Cursor + Claude + IDE all reviewing in parallel) could amplify into a thread-spawn storm. Calls beyond the cap queue FIFO; abandoned callers (signal-aborted or dropped promises) deregister cleanly so they don't leak phantom waiters. Pass `Infinity` to disable.

**README**: server now registers 22 tools (was documented as 20).

**Bundled skills**: regenerated `api-skeleton.md` across all 12 bundled skills so the bundled prose matches the current `@directive-run/knowledge` API reference.
