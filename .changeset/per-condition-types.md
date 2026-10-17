---
"@directive-run/ai": patch
"@directive-run/claude-plugin": patch
"@directive-run/cli": patch
"@directive-run/core": patch
"@directive-run/el": patch
"@directive-run/knowledge": patch
"@directive-run/lint": patch
"@directive-run/lit": patch
"@directive-run/mcp": patch
"@directive-run/mutator": patch
"@directive-run/optimistic": patch
"@directive-run/query": patch
"@directive-run/react": patch
"@directive-run/sandbox": patch
"@directive-run/scaffold": patch
"@directive-run/solid": patch
"@directive-run/sources": patch
"@directive-run/svelte": patch
"@directive-run/timeline": patch
"@directive-run/vue": patch
---

Package metadata: each export now declares types per condition (`.d.cts` for `require`), so CommonJS consumers get CommonJS type declarations instead of the ESM ones. The repository URL now uses the `git+https://…git` form. No runtime change.
