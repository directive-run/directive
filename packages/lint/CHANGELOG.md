# @directive-run/lint

## 0.1.3

### Patch Changes

- [`3a86db7`](https://github.com/directive-run/directive/commit/3a86db7a9ff55cff81150eadc766ae3ca47e5790) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Bump `vitest` to `^3.2.6` across every package that pins it directly, closing GHSA-9crc-q9x8-hgqq (arbitrary file read via Vitest's UI server prior to 3.2.6). Dev-dependency only — no runtime code ships to consumers changes. The full workspace test suite (5,383 tests across 195 files) runs green on 3.2.7.

  Per-package `test` scripts now delegate to the workspace root (`cd ../.. && vitest run packages/<name>/`) to match Vitest 3's cwd-relative `include` resolution.

## 0.1.2

### Patch Changes

- [`e4e3d08`](https://github.com/directive-run/directive/commit/e4e3d0809fc44892cbd1a28c76ebe61e8b7317ad) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Post-0.2.2 production-readiness review — 12 critical fixes shipped together.

  **`@directive-run/mcp@0.2.3`**

  - Worker_threads is now ON by default for `review_source` and `fix_code`. Falls back to in-process only inside vitest (`VITEST=true`) or when `DIRECTIVE_MCP_USE_LINT_WORKER=0` is set explicitly. Hostile or pathological sources can no longer pin the event loop past the 5-second budget — the original v0.2.0 hard requirement is finally the default.
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

## 0.1.1

### Patch Changes

- [`63e625e`](https://github.com/directive-run/directive/commit/63e625eb73c2795d867d31ab57cefda72f87242f) Thanks [@jasoncomes](https://github.com/jasoncomes)! - **Bug fix:** `@directive-run/lint@0.1.0` shipped with an empty rule registry — esbuild's treeshake + minify pipeline elided the array contents at publish time even though every rule import was referenced. `getRules()` returned `[]`, `review_source` reported zero findings on broken code, and `fix_code` had nothing to apply.

  Two-layer fix:

  - `tsup.config.ts` now sets `treeshake: false` for both `index` and `worker` entries on `@directive-run/lint`.
  - `src/rules.ts` builds `EXECUTABLE_RULES` with explicit `.push(...)` calls rather than the `Object.freeze([…literal])` pattern that the treeshaker was eliding. The matching `Object.freeze(EXECUTABLE_RULES)` after the pushes preserves the original immutability contract.

  `@directive-run/mcp` gets a patch bump because its `review_source` / `fix_code` / `list_review_rules` / `get_review_rule` tools depend on this rule registry being populated.

## 0.1.0

### Minor Changes

- [`f98c183`](https://github.com/directive-run/directive/commit/f98c1835e6c13f382420bd93412ff4a54b586d2a) Thanks [@jasoncomes](https://github.com/jasoncomes)! - `@directive-run/lint@0.1.0` — ts-morph-based static analysis for Directive code, with 10 rules and 6 mechanical autofixes.

  **Rules (10):**

  - `no-single-line-if-return` (warning, fixable) — adds braces around bare `if (x) return y;`.
  - `module-missing-facts-schema` (error) — catches flat schemas missing the `facts` wrapper.
  - `resolver-not-async` (warning, fixable) — adds `async` to non-async resolve functions.
  - `derivation-uses-imported-state` (warning) — flags derive fns reading identifiers outside the facts proxy.
  - `effect-mutates-facts` (error) — flags `facts.x = …` inside an effect.run handler.
  - `useState-alongside-facts` (warning) — flags React components mixing `useState` with `useFact` / `useDerived`.
  - `constraint-without-when-or-require` (error) — flags constraint entries missing either key.
  - `resolver-naming-mismatch` (warning) — flags resolver key not matching camelCase of requirement type.
  - `module-name-not-kebab` (warning, fixable) — rewrites `createModule("TrafficLight")` to `"traffic-light"`.
  - `imperative-task-in-effect` (error) — flags `setInterval` / `setTimeout` / `queueMicrotask` inside `effect.run`.

  **Public API:** `getRules()`, `getRuleById(id)`, `runRules(source, opts)`, `applyFix(source, finding)` plus `Finding`, `RuleMetadata`, `RunResult`, `FixResult`, `Severity`, `RuleCategory` types.

  **ts-morph is `optionalDependencies`** so read-only consumers (just listing rule metadata via `getRules()`) don't pay the ~25 MB install cost. `runRules` and `applyFix` lazy-import ts-morph and throw a structured error if it's missing.

  **`./worker` subpath export** for `worker_threads`-based timeout enforcement; see `@directive-run/mcp`'s `lint-runner.ts` for the pattern.
