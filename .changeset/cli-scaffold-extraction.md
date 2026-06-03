---
"@directive-run/cli": patch
---

Internal refactor: `directive new <name>` and `directive new-orchestrator <name>` now delegate to the new `@directive-run/scaffold` package. End-user behavior is unchanged — same generated source, same file paths, same error messages — but the generators are now reusable from `@directive-run/mcp`'s `generate_module` tool, and the kebab-case naming rule lives in one place.

No public API additions or removals. Workspace dep added.
