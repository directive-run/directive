# @directive-run/mcp

## 0.6.1

### Patch Changes

- Updated dependencies []:
  - @directive-run/knowledge@1.22.0
  - @directive-run/sandbox@0.4.1
  - @directive-run/claude-plugin@1.22.0

## 0.6.0

### Minor Changes

- [`0c2d306`](https://github.com/directive-run/directive/commit/0c2d30637d854098286980309a00f2152c9997d4) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Per-process lint-worker cap with AbortSignal support, plus README + bundled-skill regen.

  **New: `setMaxConcurrentLintWorkers(n)`.** Now re-exported from the main entry. Caps the simultaneously-running ts-morph lint workers spawned by the `review_source` / `fix_code` MCP tools. Each worker spawns a ts-morph project + a thread; a multi-client burst (Cursor + Claude + IDE all reviewing in parallel) could amplify into a thread-spawn storm. Calls beyond the cap queue FIFO; abandoned callers (signal-aborted or dropped promises) deregister cleanly so they don't leak phantom waiters. Pass `Infinity` to disable.

  **README**: server now registers 22 tools (was documented as 20).

  **Bundled skills**: regenerated `api-skeleton.md` across all 12 bundled skills so the bundled prose matches the current `@directive-run/knowledge` API reference.

### Patch Changes

- [`0444f55`](https://github.com/directive-run/directive/commit/0444f557f068d6d22fd921fe0eac21c99cca766c) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Convergence round following the AE review of last cycle's fix batch. Closes the two HIGH issues + the four MAJOR items the review surfaced.

  ## sandbox — post-acquisition signal wiring + sanitizeStack export + expanded coverage

  **Post-acquisition AbortSignal wiring.** The previous release plumbed `signal` only through the `acquireSlot` queue wait. After the slot acquired, the signal was dropped — a client that disconnected mid-execution still tied up the slot for the full `timeoutMs` (up to 10 s). Now the signal also fires `worker.terminate()` on the running worker so the slot frees immediately. The docstring's "released immediately on disconnect" contract is now accurate end-to-end.

  **`sanitizeStack` is now a public export.** Consumers building custom error-routing (Sentry integrations, audit-log middleware) previously couldn't strip host filesystem paths from `SandboxResult.errors[]` before logging. The function is now exported from `@directive-run/sandbox` directly:

  ```ts
  import { sanitizeStack } from "@directive-run/sandbox";
  logger.error(sanitizeStack(result.errors.join("\n")));
  ```

  **Extended path coverage.** The sanitizer now strips `/app/` (Heroku/Render/Docker), `/srv/` (Linux deploy), `/workspace/` (Codespaces/GitHub Actions), `/data/` (volume mounts), `/etc/` (configs), and `/root/` (root home) on top of the POSIX + Windows + UNC patterns. 7 new regression tests.

  **`@example` block** added to `setMaxConcurrentWorkers`.

  ## core — `SourceDropReason` adoption completion

  Two inline copies of the drop-reason union survived the previous round:

  - `SystemInspection.sources[i].lastDropReason` (`types/system.ts`)
  - `SourceDispatchResult.reason` (`core/sources.ts`)

  Both now reference `SourceDropReason`. The four surfaces that report drops (inspect row, plugin hook, plugin manager emit, observation event) are finally unified — a new reason added to the shared type now propagates everywhere at compile time.

  ## lit — deprecated aliases as function wrappers

  `export const createModule = createModuleController` and `export const useHistory = getHistory` swallowed the `@deprecated` JSDoc strikethrough in older VS Code, Vim+coc, and JetBrains < 2024.1. Both aliases are now thin function wrappers so the deprecation marker renders in every TS-aware editor.

  ## mcp — full JSDoc on `setMaxConcurrentLintWorkers`

  The MCP cap setter's JSDoc was a 3-line summary; the sandbox sister had the full WHY (per-worker heap cost, multi-client burst scenario, `Infinity` to disable). Brought them to parity with an `@example` block.

- Updated dependencies [[`0c2d306`](https://github.com/directive-run/directive/commit/0c2d30637d854098286980309a00f2152c9997d4), [`0c2d306`](https://github.com/directive-run/directive/commit/0c2d30637d854098286980309a00f2152c9997d4), [`0c2d306`](https://github.com/directive-run/directive/commit/0c2d30637d854098286980309a00f2152c9997d4), [`0444f55`](https://github.com/directive-run/directive/commit/0444f557f068d6d22fd921fe0eac21c99cca766c)]:
  - @directive-run/knowledge@1.21.0
  - @directive-run/sandbox@0.4.0
  - @directive-run/scaffold@0.2.1
  - @directive-run/claude-plugin@1.21.0

## 0.5.15

### Patch Changes

- Updated dependencies []:
  - @directive-run/knowledge@1.20.2
  - @directive-run/sandbox@0.3.13
  - @directive-run/claude-plugin@1.20.2

## 0.5.14

### Patch Changes

- Updated dependencies []:
  - @directive-run/knowledge@1.20.1
  - @directive-run/claude-plugin@1.20.1
  - @directive-run/sandbox@0.3.12

## 0.5.13

### Patch Changes

- Updated dependencies []:
  - @directive-run/knowledge@1.20.0
  - @directive-run/sandbox@0.3.11
  - @directive-run/claude-plugin@1.20.0

## 0.5.12

### Patch Changes

- Updated dependencies []:
  - @directive-run/knowledge@1.19.7
  - @directive-run/claude-plugin@1.19.7
  - @directive-run/sandbox@0.3.10

## 0.5.11

### Patch Changes

- Updated dependencies []:
  - @directive-run/knowledge@1.19.6
  - @directive-run/claude-plugin@1.19.6
  - @directive-run/sandbox@0.3.9

## 0.5.10

### Patch Changes

- Updated dependencies []:
  - @directive-run/knowledge@1.19.5
  - @directive-run/claude-plugin@1.19.5
  - @directive-run/sandbox@0.3.8

## 0.5.9

### Patch Changes

- Updated dependencies [[`134b7b9`](https://github.com/directive-run/directive/commit/134b7b917156f07e1b1ecdb1f5ba75068274bce3)]:
  - @directive-run/knowledge@1.19.4
  - @directive-run/claude-plugin@1.19.4
  - @directive-run/sandbox@0.3.7

## 0.5.8

### Patch Changes

- Updated dependencies [[`869e8fc`](https://github.com/directive-run/directive/commit/869e8fc3f12f6f4677e7c7c27e2a9ea795cfc4d1)]:
  - @directive-run/knowledge@1.19.3
  - @directive-run/claude-plugin@1.19.3
  - @directive-run/sandbox@0.3.6

## 0.5.7

### Patch Changes

- Updated dependencies []:
  - @directive-run/knowledge@1.19.2
  - @directive-run/sandbox@0.3.5
  - @directive-run/claude-plugin@1.19.2

## 0.5.6

### Patch Changes

- Updated dependencies []:
  - @directive-run/knowledge@1.19.1
  - @directive-run/sandbox@0.3.4
  - @directive-run/claude-plugin@1.19.1

## 0.5.5

### Patch Changes

- Updated dependencies [[`9ffd758`](https://github.com/directive-run/directive/commit/9ffd7584914b93ca840ae84372fe3e83c75f29e8)]:
  - @directive-run/sandbox@0.3.3
  - @directive-run/knowledge@1.19.0
  - @directive-run/claude-plugin@1.19.0

## 0.5.4

### Patch Changes

- Updated dependencies [[`84117e8`](https://github.com/directive-run/directive/commit/84117e8203be19263da563ca2b3d9ea4ac4670d4)]:
  - @directive-run/sandbox@0.3.2
  - @directive-run/knowledge@1.18.0
  - @directive-run/claude-plugin@1.18.0

## 0.5.3

### Patch Changes

- Updated dependencies [[`039f8c0`](https://github.com/directive-run/directive/commit/039f8c0d2138ac483f4e40b46a8882552a94a8f4)]:
  - @directive-run/sandbox@0.3.1

## 0.5.2

### Patch Changes

- Updated dependencies [[`4237df7`](https://github.com/directive-run/directive/commit/4237df771965e29f7f4eec3005d35811cc6d0fbc)]:
  - @directive-run/sandbox@0.3.0

## 0.5.1

### Patch Changes

- [`9801112`](https://github.com/directive-run/directive/commit/980111207191e013eb127f4e01349bd0aecc2115) Thanks [@jasoncomes](https://github.com/jasoncomes)! - **Security hotfix.** Closes critical AST property-access bypass in `@directive-run/sandbox@0.1.0` and `@0.2.0` where `globalThis.process.exit()`, `Reflect.get(globalThis, "process")`, and `({}).constructor.constructor("return process")()` all bypassed the validator. The original "skip identifiers in property-access position" rule (added to avoid `{module: x}` false-positives) was a total bypass — `process` was a property name and got skipped. v0.3.0 closes this with a dedicated `checkPropertyAccessEscapes` pass.

  Full security audit at [docs/security/sandbox-audit-2026-06.md](https://github.com/directive-run/directive/blob/main/docs/security/sandbox-audit-2026-06.md) covering security, architecture, agent UX, developer experience, and domain correctness. This release ships the property-access bypass and tool-description allowlist fixes; SSRF + rate-limiting on `/api/run-sandbox` and remaining stability + documentation items ship in 0.3.0.

  **v0.3.0 validator additions:**

  - Rejects `globalThis.process` / `globalThis.fetch` / `globalThis.Buffer` / `globalThis.setTimeout` etc. — any property-access whose `.name` matches a denied identifier.
  - Rejects `.constructor` access on any value — closes the `({}).constructor.constructor("...")()` Function-constructor smuggle.
  - Rejects `Function(...)` call expression (in addition to the existing `new Function(...)` denial).
  - Rejects `globalThis["X"]` bracket access with a string literal — including allowlisted names, since there's no legitimate bracket-access use.
  - Rejects bracket access with a denied-name string literal on any value.
  - Rejects `Reflect.get(globalThis, "X")` / `Reflect.has(globalThis, "X")` / `Object.getOwnPropertyDescriptor(globalThis, "X")` when X is a denied name or `constructor`.
  - Legitimate property keys in object literals (`createSystem({ module: counter })`) and Directive system surface (`system.events.foo`, `system.facts.count`) still permitted.

  **`@directive-run/mcp@0.5.1` (patch):**

  - Tool description for `run_in_sandbox` rewritten with the full 16-package allowlist (was incorrectly documented as `@directive-run/{core,ai,query}` in v0.5.0).
  - Decoding-errors section so the LLM knows how to distinguish validation / bundle / runtime / timeout failure modes.
  - Note about react/vue/svelte/solid/lit imports working but their runtime hooks throwing in Node — directs the LLM to `playground_link` for UI demos.
  - README Playground section updated with the same allowlist.

  Stability and developer-experience gaps surfaced in the audit are tracked for follow-up releases per the audit doc's incident-response priorities.

- Updated dependencies [[`51f721e`](https://github.com/directive-run/directive/commit/51f721eefc265d5f5d97120c6976556c39595d1c), [`9801112`](https://github.com/directive-run/directive/commit/980111207191e013eb127f4e01349bd0aecc2115)]:
  - @directive-run/sandbox@0.2.0

## 0.5.0

### Minor Changes

- [`4d9ac56`](https://github.com/directive-run/directive/commit/4d9ac568672c898d95da3ac32d7625c9d84cf178) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Ship `run_in_sandbox` — the Innovation lens's "MCP tools return observed behavior, not just code" pick from the v0.4.0 plan's deferred backlog. The 22nd MCP tool executes a Directive snippet server-side and returns a structured transcript (`logs`, `facts`, `errors`, `durationMs`, `timedOut`, `playgroundUrl`) the LLM can hand the user alongside any generated code.

  - **NEW `@directive-run/sandbox@0.1.0`** — focused package providing `runInSandbox({source | files, timeoutMs})`. Three-layer defense: an AST allowlist validator (ts-morph) rejects imports outside `@directive-run/{core,ai,query}` and identifier references to FS / network / eval surfaces (`process`, `require`, `fetch`, `fs`, `child_process`, `eval`, `new Function`, etc.); an esbuild bundler virtualizes the multi-file payload into a single ESM string; a `worker_threads.Worker` with `resourceLimits` (32 MB heap, 16 MB code) executes the bundle with a clamped wall-clock budget ([100ms, 10s], default 5s). Console output is captured to a buffer, `system.facts` is serialized via `$store.toObject()`, and the bundler injects an early-capture immediately after `createSystem(...)` so the post-mortem snapshot survives mid-runner errors (a validation throw inside `await system.settle()` still hands you the init-state facts).
  - **`@directive-run/mcp@0.5.0`** — `run_in_sandbox` tool registered alongside `playground_link`. Same input shapes (`source: string` for already-runnable code, `files: [{path, source}]` for paired output from `generate_module`); response payload includes a `playgroundUrl` built via `buildPlaygroundLink` so the LLM can give the user BOTH the transcript AND a click-through to edit the same snippet in StackBlitz. Tool count 21 → 22.
  - The docs site's `/playground` DevTools panel switches from static-structure parsing (v0.4.0) to a live transcript view powered by an internal `/api/run-sandbox` Next.js route that wraps `runInSandbox`. The Run snippet button hits the route, swaps the panel into "live transcript" mode (Facts / Logs / Events / Constraints / Resolvers tabs), and surfaces runner errors as a persistent banner.

  Sandbox boundary documented in detail in `packages/sandbox/src/validator.ts`. Allowlist is strict by default — we expand based on real failures rather than ship a "mostly safe" surface.

### Patch Changes

- Updated dependencies [[`4d9ac56`](https://github.com/directive-run/directive/commit/4d9ac568672c898d95da3ac32d7625c9d84cf178)]:
  - @directive-run/sandbox@0.1.0

## 0.4.0

### Minor Changes

- [`fcb6c9c`](https://github.com/directive-run/directive/commit/fcb6c9cf54c744fdbcfbef96a0806ae994261336) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Close the playground "runner forgot to ship" gap that left every `generate_module → playground_link` chain booting StackBlitz to a library file that exported a binding and exited. v0.4.0 lands a "paired files always" pattern: every generated module now ships with its runner.

  - **`@directive-run/scaffold@0.2.0`** — `generateModule` and `generateOrchestrator` now return `{moduleSource, runnerSource, suggestedFilenames, runnable}` instead of a single source string. The runner is a 15-25 LOC driver that does `createSystem(module).start()` → dispatch detected events → `await system.settle()` → log facts → destroy. Generated by regex-extracting the binding name + event keys from the module source. Already-runnable input (sources that call `system.start()`) returns `runnerSource: null` with `runnable: true`. CLI consumers (`directive new <name>`) pull `.moduleSource` and discard the runner; the MCP playground tool ships both.
  - **`@directive-run/mcp@0.4.0`** — `generate_module` returns the paired shape in its `<directive-data>` payload with cross-referenced tool description pointing at `playground_link`. `playground_link` now accepts EITHER a single `source` string (kept for `get_example` / `fix_code` already-runnable output) OR a `files: [{path, source}]` array (used by `generate_module`'s paired output). The multi-file payload is JSON-encoded before lz-string compression so it stays within the 8 KB URL cap. New `mode: "preview" | "instant"` parameter — `"preview"` (default) routes to `directive.run/playground` (code + Open-in-StackBlitz button, the only Directive-branded surface); `"instant"` routes to `directive.run/run`, a thin auto-submit redirect that POSTs the StackBlitz form on load and lands in the editor in ~600ms with no preview UI.
  - **End-to-end regression gate** at `packages/mcp/__tests__/multi-file-playground.test.ts` asserts that a `generate_module → playground_link` chain produces a URL whose decoded payload contains both `createSystem` AND `system.start()`. Catches the entire class of "runner forgot to ship" before npm.

  Breaking change for `@directive-run/scaffold` consumers: `generateModule(name, sections)` and `generateOrchestrator(name)` now return `GeneratedScaffold` instead of `string`. Both in-tree consumers (`@directive-run/cli`'s `new` command and `@directive-run/mcp`'s `generate_module` tool) updated to read `.moduleSource`. Pre-1.0, no external consumers.

### Patch Changes

- Updated dependencies [[`fcb6c9c`](https://github.com/directive-run/directive/commit/fcb6c9cf54c744fdbcfbef96a0806ae994261336)]:
  - @directive-run/scaffold@0.2.0
  - @directive-run/knowledge@1.17.2
  - @directive-run/claude-plugin@1.17.2

## 0.3.1

### Patch Changes

- [`4c11096`](https://github.com/directive-run/directive/commit/4c11096bca3c3a4d7416bbbf3c007ae71d5ce7ef) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Fix `@directive-run/mcp@0.3.0` crashing Claude Desktop on first handshake with `SyntaxError: Named export 'compressToEncodedURIComponent' not found. The requested module 'lz-string' is a CommonJS module`.

  `lz-string@1.5.0` ships CJS-only, but tsup's default externalization preserved the named-import shape in the ESM build, which Node's ESM loader rejects when the underlying module has no named exports. `lz-string` is now bundled inline (`noExternal` in `tsup.config.ts`) — adds ~6 KB minified, removes the CJS↔ESM interop trap entirely. Added a `dist-smoke.test.ts` regression suite that loads the built artifacts through Node's real ESM loader so this class of bug can't reach npm again.

  No API or behavior changes — `playground_link` works the same as the broken 0.3.0 release was supposed to.

## 0.3.0

### Minor Changes

- [`db8d4aa`](https://github.com/directive-run/directive/commit/db8d4aa02bbc63b1b5bf8064c14640cd157b7fe4) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add `playground_link` tool: turn any TypeScript snippet (≤ 8 KB) into a `directive.run/playground` URL. The page decompresses the source from the URL hash, renders it with syntax highlighting, and offers a one-click **Open in StackBlitz** button that boots a real running Directive project with the snippet as `src/main.ts`. Source travels in the URL fragment (never sent to the server) and is compressed with lz-string.

  Pair `playground_link` with any tool that returns code — `generate_module`, `get_example`, `fix_code` — to give the user a clickable "try it now" link in chat. First v0.3.0 alpha milestone of the production-readiness work.

## 0.2.3

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
