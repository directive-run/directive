---
"@directive-run/mcp": patch
"@directive-run/lint": patch
"@directive-run/knowledge": patch
---

Post-0.2.2 production-readiness audit findings — 12 P0 fixes shipped together. Full audit synthesis at `docs/AE-AUDIT-0.2.2.md`.

**`@directive-run/mcp@0.2.3`**

- Worker_threads is now ON by default for `review_source` and `fix_code`. Falls back to in-process only inside vitest (`VITEST=true`) or when `DIRECTIVE_MCP_USE_LINT_WORKER=0` is set explicitly. Hostile or pathological sources can no longer pin the event loop past the 5-second budget — the AE v0.2.0 P0 requirement is finally the default.
- `get_composable_packages` returns `isError: true` with a structured `NOT_FOUND` / `NO_COMPOSITIONS` prefix when the package name isn't known to the graph, instead of a misleading success-with-prose response. LLM clients can now distinguish "you typed it wrong" from "data absent."
- SSE session-cap hardened against future SDK changes that might add async-leaky behavior to the transport constructor — a synchronous `pendingConnects` counter is incremented before any yield, so the cap can't be over-shot by N concurrent connects observing the same `sessions.size`.
- `prepublishOnly` script chains `clean && build` so the published tarball can't ship a stale baked package registry.
- README rebuilt around a 3-step Try it block, a full `## How it works` section with an ASCII architecture diagram, a `## Troubleshooting` table covering the four most common first-time failures, and accurate prose throughout (no more "queryable at retrieval time instead of bundled as a static snapshot" jargon).

**`@directive-run/lint@0.1.2`**

- **Lazy ts-morph is finally true at the bundle level.** v0.1.0 and v0.1.1 statically imported `SyntaxKind` from `ts-morph` in every rule file, so tsup inlined the rules barrel into `dist/index.js` and ESM hoisted ts-morph to the top — every consumer of `getRules()` paid the ~25 MB ts-morph load at module-init. Fixed by extracting the metadata into `rule-metadata.ts` (no ts-morph chain) and splitting the executable rules into a separate tsup entry (`./executable`) that's loaded only when `runRules` or `applyFix` fires. Verified: `dist/index.js` has zero references to ts-morph or `SyntaxKind`.
- `resolver-naming-mismatch` dropped from `warning` to `info` severity, with explanation rewritten. No canonical Directive doc requires the camelCase convention; warning-level was lint-blasting real codebases. Disable via `ruleFilter` in projects that use semantic keys.
- `module-missing-facts-schema` explanation rewritten — flat schemas don't produce a runtime error, they silently register no facts. The previous wording misled users.
- New `./executable` subpath export and `./executable.d.ts` types so worker-thread consumers can resolve the rule registry without going through the main entry.

**`@directive-run/knowledge@1.17.1`**

- Redux migration's concept map fixed: `useSelector → useFact("x") / useDerived("y")`. The previous mapping pointed migrators at a `useSelector` API that doesn't exist with that shape in `@directive-run/react`. The steps section already said the right thing; the concept map now agrees.
