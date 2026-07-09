---
"@directive-run/core": patch
"@directive-run/ai": patch
"@directive-run/react": patch
"@directive-run/vue": patch
"@directive-run/svelte": patch
"@directive-run/solid": patch
"@directive-run/lit": patch
"@directive-run/el": patch
"@directive-run/sources": patch
"@directive-run/mutator": patch
"@directive-run/optimistic": patch
"@directive-run/timeline": patch
"@directive-run/query": patch
"@directive-run/cli": patch
"@directive-run/mcp": patch
"@directive-run/sandbox": patch
"@directive-run/scaffold": patch
"@directive-run/lint": patch
"@directive-run/knowledge": patch
"@directive-run/claude-plugin": patch
"@directive-run/vite-plugin-api-proxy": patch
---

Bump `vitest` to `^3.2.6` across every package that pins it directly, closing GHSA-9crc-q9x8-hgqq (arbitrary file read via Vitest's UI server prior to 3.2.6). Dev-dependency only — no runtime code ships to consumers changes. The full workspace test suite (5,383 tests across 195 files) runs green on 3.2.7.

Per-package `test` scripts now delegate to the workspace root (`cd ../.. && vitest run packages/<name>/`) to match Vitest 3's cwd-relative `include` resolution.
