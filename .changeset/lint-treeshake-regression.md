---
"@directive-run/lint": patch
"@directive-run/mcp": patch
---

**Bug fix:** `@directive-run/lint@0.1.0` shipped with an empty rule registry — esbuild's treeshake + minify pipeline elided the array contents at publish time even though every rule import was referenced. `getRules()` returned `[]`, `review_source` reported zero findings on broken code, and `fix_code` had nothing to apply.

Two-layer fix:

- `tsup.config.ts` now sets `treeshake: false` for both `index` and `worker` entries on `@directive-run/lint`.
- `src/rules.ts` builds `EXECUTABLE_RULES` with explicit `.push(...)` calls rather than the `Object.freeze([…literal])` pattern that the treeshaker was eliding. The matching `Object.freeze(EXECUTABLE_RULES)` after the pushes preserves the original immutability contract.

`@directive-run/mcp` gets a patch bump because its `review_source` / `fix_code` / `list_review_rules` / `get_review_rule` tools depend on this rule registry being populated.
