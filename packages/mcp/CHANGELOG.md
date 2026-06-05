# @directive-run/mcp

## 0.3.1

### Patch Changes

- [`4c11096`](https://github.com/directive-run/directive/commit/4c11096bca3c3a4d7416bbbf3c007ae71d5ce7ef) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Fix `@directive-run/mcp@0.3.0` crashing Claude Desktop on first handshake with `SyntaxError: Named export 'compressToEncodedURIComponent' not found. The requested module 'lz-string' is a CommonJS module`.

  `lz-string@1.5.0` ships CJS-only, but tsup's default externalization preserved the named-import shape in the ESM build, which Node's ESM loader rejects when the underlying module has no named exports. `lz-string` is now bundled inline (`noExternal` in `tsup.config.ts`) — adds ~6 KB minified, removes the CJS↔ESM interop trap entirely. Added a `dist-smoke.test.ts` regression suite that loads the built artifacts through Node's real ESM loader so this class of bug can't reach npm again.

  No API or behavior changes — `playground_link` works the same as the broken 0.3.0 release was supposed to.

## 0.3.0

### Minor Changes

- [`db8d4aa`](https://github.com/directive-run/directive/commit/db8d4aa02bbc63b1b5bf8064c14640cd157b7fe4) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add `playground_link` tool: turn any TypeScript snippet (≤ 8 KB) into a `directive.run/playground` URL. The page decompresses the source from the URL hash, renders it with syntax highlighting, and offers a one-click **Open in StackBlitz** button that boots a real running Directive project with the snippet as `src/main.ts`. Source travels in the URL fragment (never sent to the server) and is compressed with lz-string.

  Pair `playground_link` with any tool that returns code — `generate_module`, `get_example`, `fix_code` — to give the user a clickable "try it now" link in chat. v0.3.0 alpha kickoff per the production-readiness audit.

## 0.2.3

### Patch Changes

- [`e4e3d08`](https://github.com/directive-run/directive/commit/e4e3d0809fc44892cbd1a28c76ebe61e8b7317ad) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Post-0.2.2 production-readiness audit findings — 12 P0 fixes shipped together. Full audit synthesis at `docs/AE-AUDIT-0.2.2.md`.

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

- Updated dependencies [[`e4e3d08`](https://github.com/directive-run/directive/commit/e4e3d0809fc44892cbd1a28c76ebe61e8b7317ad)]:
  - @directive-run/lint@0.1.2
  - @directive-run/knowledge@1.17.1
  - @directive-run/claude-plugin@1.17.1

## 0.2.2

### Patch Changes

- [`da2b8bc`](https://github.com/directive-run/directive/commit/da2b8bc878af7822c921209374403564887ef70a) Thanks [@jasoncomes](https://github.com/jasoncomes)! - **Bug fix:** the MCP handshake and `get_server_info` were reporting the source-hardcoded `PKG_VERSION = "0.2.0"` long after the package shipped 0.2.1 — the constant was easy to forget on patch bumps. The constant is now sourced from `package.json` via tsup's `define` at build time, so `changeset version`'s bump is the single source of truth and the dist version can't drift from the published one. CLI's `--version` flag picks up the same value through the same channel.

  In `tsx` dev runs (no build), both fall back to `0.0.0-dev` so handshakes don't claim a real version.

## 0.2.1

### Patch Changes

- [`63e625e`](https://github.com/directive-run/directive/commit/63e625eb73c2795d867d31ab57cefda72f87242f) Thanks [@jasoncomes](https://github.com/jasoncomes)! - **Bug fix:** `@directive-run/lint@0.1.0` shipped with an empty rule registry — esbuild's treeshake + minify pipeline elided the array contents at publish time even though every rule import was referenced. `getRules()` returned `[]`, `review_source` reported zero findings on broken code, and `fix_code` had nothing to apply.

  Two-layer fix:

  - `tsup.config.ts` now sets `treeshake: false` for both `index` and `worker` entries on `@directive-run/lint`.
  - `src/rules.ts` builds `EXECUTABLE_RULES` with explicit `.push(...)` calls rather than the `Object.freeze([…literal])` pattern that the treeshaker was eliding. The matching `Object.freeze(EXECUTABLE_RULES)` after the pushes preserves the original immutability contract.

  `@directive-run/mcp` gets a patch bump because its `review_source` / `fix_code` / `list_review_rules` / `get_review_rule` tools depend on this rule registry being populated.

- Updated dependencies [[`63e625e`](https://github.com/directive-run/directive/commit/63e625eb73c2795d867d31ab57cefda72f87242f)]:
  - @directive-run/lint@0.1.1

## 0.2.0

### Minor Changes

- [`f98c183`](https://github.com/directive-run/directive/commit/f98c1835e6c13f382420bd93412ff4a54b586d2a) Thanks [@jasoncomes](https://github.com/jasoncomes)! - `@directive-run/mcp@0.2.0` — 13 new MCP tools + SSE transport hardening.

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

### Patch Changes

- Updated dependencies [[`f98c183`](https://github.com/directive-run/directive/commit/f98c1835e6c13f382420bd93412ff4a54b586d2a), [`f98c183`](https://github.com/directive-run/directive/commit/f98c1835e6c13f382420bd93412ff4a54b586d2a), [`f98c183`](https://github.com/directive-run/directive/commit/f98c1835e6c13f382420bd93412ff4a54b586d2a)]:
  - @directive-run/knowledge@1.17.0
  - @directive-run/lint@0.1.0
  - @directive-run/scaffold@0.1.0
  - @directive-run/claude-plugin@1.17.0
