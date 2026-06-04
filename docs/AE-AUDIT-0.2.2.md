# AE production-readiness audit — `@directive-run/mcp@0.2.2`

**Date:** 2026-06-03
**Trigger:** post-ship evaluation before v0.3.0 scope-lock. 13 parallel reviewers (the full lens audit plus domain experts) interrogated the shipped 0.2.2 surface, READMEs, IDE-integration doc, and the supporting packages (lint@0.1.1, scaffold@0.1.0, knowledge@1.17.0, claude-plugin@1.17.0).
**Question:** do users + AI clients have everything they need to use this successfully?
**Answer:** mostly — the tool surface is strong and the security/perf foundation is sound, but **3 P0 lies** (broken lazy-load, README ↔ destination doc mismatch, error-envelope inconsistency) plus **the architecture diagram never landing in the README** are blocking smooth onboarding. Doc reckoning + a small code patch (0.2.3) closes the gap; v0.3.0 has a ranked roadmap with `playground_link` + `explain_finding` + DevTools bridge + telemetry as the headline items.

## Reviewers

| Lens | Agent | Returned |
|---|---|---|
| Security | quinn-qa-security | ✅ |
| Architecture | sam-technical | ✅ |
| Performance | riley-systems | ✅ |
| DX/UX | blake-ux | ✅ |
| Agent UX | sage-intelligence | ✅ |
| Innovation | nova-ventures | ✅ |
| Product onboarding | taylor-product | ✅ |
| Technical writing | sam-content | ✅ |
| Directive-domain correctness | domain-expert | ✅ (retried — first attempt errored on model access) |
| Streaming | river-streaming | ✅ |
| SSE deploy readiness | harper-infrastructure | ✅ |
| Implementation quality | charlie-backend | ✅ |
| Telemetry | val-analytics | ✅ |

## P0 — ship now (deduplicated)

| # | Finding | Reviewers who flagged | File(s) | Fix |
|---|---|---|---|---|
| **P0-1** | **ts-morph eager-loaded by bundler.** `packages/lint/src/rules/*.ts` use `import { SyntaxKind } from "ts-morph"` (value import). tsup inlines the rules barrel into `dist/index.js`; ESM hoists ts-morph to the top. `import { runRules } from "@directive-run/lint"` in `mcp/dist/index.js` triggers ts-morph load on every stdio handshake. The "lazy ts-morph" + "optionalDependencies" story in the README is a lie at the bundle level. | sam-technical, riley-systems | `packages/lint/src/rules/*.ts:1`, `packages/lint/dist/index.js:1`, `packages/lint/tsup.config.ts` | Split lint into two tsup entries: `index` (metadata only, no ts-morph) + `executable` (rules + ts-morph). `runRules`/`applyFix` `await import("./executable.js")` only when called. Verify with `node -e "require('@directive-run/lint').getRules()"` in an env where ts-morph is uninstalled — must not throw. |
| **P0-2** | **Error-envelope convention is inconsistent.** Most `get_*` tools return `isError: true` on lookup miss; `get_composable_packages` returns success with prose; `review_source`/`fix_code` use a different prefix; `list_*` never error. An LLM client cannot reliably distinguish "lookup miss" from "data absent." | charlie-backend, sage-intelligence | `packages/mcp/src/server.ts` (all get_* handlers, esp. lines 450-459 composable) | Pick one: `NOT_FOUND` → always `isError: true` with structured `{code, message}` JSON inside the text content. `get_composable_packages` returns `isError: true` when both arrays empty AND the package name is unknown. |
| **P0-3** | **README destination doc missing from repo.** README links to `directive.run/docs/ide-integration` but that source isn't in the working tree (only `website/.next/` build cache). Single point of failure: if the deployed page is stale or down, every npm reader bounces. | taylor-product, sam-content | `packages/mcp/README.md:140` + missing `directive-docs/` | Either (a) inline the install decision tree into the README, or (b) commit the directive-docs source so it's reviewable in PRs. The architecture diagram drafted this session also needs to land here. |
| **P0-4** | **Architecture diagram has no home.** The 8-section walkthrough drafted this session (Claude Desktop ↔ stdio ↔ MCP server ↔ 4 supporting packages, with the request-flow trace) is good README material but isn't incorporated. Without it, the only way to answer "how does this actually work?" is by reading source. | sam-content, blake-ux | `packages/mcp/README.md` (insertion between SSE and Tools sections) | Add `## How it works` section with the diagram + lead-in paragraph (sam-content provided verbatim text). |
| **P0-5** | **No "first prompt" guidance.** After config + restart, the user has no idea what to ask Claude. Time-to-first-tool-call ≈ 5+ min for users who guess; the README never seeds a prompt. | taylor-product, blake-ux | `packages/mcp/README.md` | Add a "Try it" block with 3 copy-pasteable first prompts that each fire one tool (`list_knowledge`, `generate_module`, `review_source`). |
| **P0-6** | **No "verify install" step.** A user who saves config + restarts Claude has no concrete confirmation the server is loaded. Click the hammer icon? Run `curl /healthz`? Ask Claude `get_server_info`? Nothing told. | blake-ux, taylor-product | `packages/mcp/README.md` (new section) | Add `## Verify install`: stdio → "click the hammer icon, expect `directive` with 20 tools" + "ask Claude `Use the directive MCP server's get_server_info tool`." SSE → `curl http://127.0.0.1:3000/healthz`. |
| **P0-7** | **`build:registry` is not wired to a lifecycle hook.** `prepack` / `prepublishOnly` absent. If `pnpm publish` runs without `pnpm build` first, the tarball ships a stale baked registry referencing old versions. | sam-technical | `packages/mcp/package.json:47-49` | Add `"prepublishOnly": "pnpm clean && pnpm build"`. CI assertion that the registry's versions match workspace versions before tag. |
| **P0-8** | **SSE session-cap TOCTOU race.** `sessions.size >= maxSessions` checked before insert, but the await on `server.connect(transport)` runs first. N concurrent SSE connects all observe size 63 and all admit. | quinn-qa-security, charlie-backend | `packages/mcp/src/sse.ts:182-192` | Increment a synchronous `pendingConnects` counter before the await; decrement on failure. Check `sessions.size + pendingConnects >= cap`. |
| **P0-9** | **Worker termination is OFF by default.** `DIRECTIVE_MCP_USE_LINT_WORKER=1` required for `worker.terminate()` hard kill. Default in-process; a 199 KB pathological union/deeply-nested generic source can pin the event loop > 5s. AE v0.2.0 P0 #3 explicitly required hard termination. The shipped product violates the original P0. | quinn-qa-security, charlie-backend, blake-ux | `packages/mcp/src/lint-runner.ts:125-127` | Flip default: `shouldUseWorker() => process.env.DIRECTIVE_MCP_USE_LINT_WORKER !== "0"`. Skip worker only inside vitest (`process.env.VITEST === "true"`). |
| **P0-10** | **`module-missing-facts-schema` rule's explanation is wrong.** Says missing `facts` wrapper "produces a runtime error" — actually facts are silently empty. Misleads users. | domain-expert | `packages/lint/src/rules/module-missing-facts-schema.ts:27,67` | Reword explanation to "facts will be silently empty — top-level keys won't register." |
| **P0-11** | **`resolver-naming-mismatch` enforces undocumented convention.** No canonical Directive doc requires resolver keys to be camelCase of requirement type. Will lint-blast every real codebase with false positives. | domain-expert, sage-intelligence | `packages/lint/src/rules/resolver-naming-mismatch.ts:42` | Drop to `info` severity OR gate behind opt-in config; default off. |
| **P0-12** | **Redux migration `useSelector` mapping is broken.** Concept map says `useSelector → useSelector`, but @directive-run/react's useSelector requires the system as first arg (not Provider-based). Migrators copy-paste broken code. | domain-expert | `packages/knowledge/migration.json:42-44, 60-62` | Map to `useFact("x")` / `useDerived("y")` — matches the steps section already. |

## P1 — next sprint / v0.2.3 candidates

| # | Finding | Reviewers | Notes |
|---|---|---|---|
| P1-1 | Token comparison not constant-time (`===` on string). Ship `crypto.timingSafeEqual`. | quinn | `packages/mcp/src/sse.ts:136`. Required before hosted SSE. |
| P1-2 | Body-cap streaming guard races against `handlePostMessage`. Buffer-and-validate pattern. | quinn | `packages/mcp/src/sse.ts:246-261`. |
| P1-3 | npm provenance not enabled. `"provenance": true` on every publishConfig + GitHub Actions OIDC. | quinn | Supply-chain hygiene. |
| P1-4 | Knowledge JSON is a prompt-injection vector. Wrap output in `<directive-data>` consistently. | quinn, sage | `packages/mcp/src/server.ts` (multiple). |
| P1-5 | `<directive-data>` fence applied inconsistently across tools. Codify rule: fence anything from outside-the-source-tree OR injection-risk prose. | sage, blake | `packages/mcp/src/server.ts` (multiple). |
| P1-6 | Tool descriptions: `generate_module` vs `get_example`, `review_source` vs `get_review_rule` need disambiguator first sentences ("CREATE new …" vs "DOCS LOOKUP: …"). | sage | Description text rewrites. |
| P1-7 | `ruleFilter` with unknown rule IDs silently drops. Validate + error. | sage | `packages/mcp/src/server.ts:790` + lint-runner. |
| P1-8 | `fix_code` finding contract is fragile. Add `findingId` freshness check; reject stale/fabricated findings. | sage | `lint-runner.ts` + server.ts. |
| P1-9 | npx cold install ≈ 90-100 MB disk / 12-18 MB download because ts-morph optionalDep pulls TypeScript. Drop ts-morph from mcp deps; let pnpm hoist via lint. | riley | `packages/mcp/package.json:62-64`. |
| P1-10 | Sourcemaps shipped in published tarball (~300-400 KB bloat). Drop or filter `*.map` from `files`. | riley | All tsup configs. |
| P1-11 | claude-plugin ships 2 MB skill bundles inside the tarball though most stdio clients never call `get_skill`. Split into `@directive-run/claude-plugin-skills`. | riley | claude-plugin packaging. |
| P1-12 | `computeBundledKnowledgeHash` synchronously reads ~700 KB on first `list_knowledge` call (handshake hot path). Warm via `setImmediate` post-connect or precompute at build time. | riley | `server.ts:114-129`. |
| P1-13 | Idle sweep uses `Date.now()` — vulnerable to clock skew (NTP, suspend/resume). Use `performance.now()` or `process.hrtime.bigint()` with negative-delta guard. | charlie | `packages/mcp/src/sse.ts:298-308`. |
| P1-14 | Worker timeout race: timer fires → `terminate()` → exit handler may double-reject. Set `resolved = true` inside the setTimeout callback. | charlie | `packages/mcp/src/lint-runner.ts:96-114`. |
| P1-15 | `fetchLatestVersion` lumps 5xx + timeout + malformed JSON. Distinguish; short TTL for 5xx, long TTL for 404. Surface error reason in `renderPackageInfo`. | charlie | `packages/mcp/src/packages.ts:141-162`. |
| P1-16 | `setServerInfo` is module-level singleton state; tests that exercise both stdio and SSE get cross-talk. Thread `ServerInfoOptions` through `createDirectiveServer(opts)`. | charlie | `packages/mcp/src/server.ts:137-145`. |
| P1-17 | Magic numbers (`MAX_SEARCH_RESULTS=50`, `MAX_LINE_PREVIEW=200`, etc.) not surfaced in tool descriptions or `get_server_info`. Hoist to a `LIMITS` export; document in `get_server_info`; accept env overrides. | charlie | `packages/mcp/src/server.ts:67-69`. |
| P1-18 | Version-inlining via tsup `define` is good — but only mcp uses it. cli reads at runtime; lint/scaffold/knowledge/claude-plugin have no version constant. Adopt mcp pattern across all five. | sam-technical | All tsup configs. |
| P1-19 | `@directive-run/lint/worker` is `import`-only — CJS consumers get silent `ERR_PACKAGE_PATH_NOT_EXPORTED`. Add `require` condition. | sam-technical | `packages/lint/package.json:42-44`. |
| P1-20 | `treeshake: false` on lint is a workaround for the v0.1.0 `.push` regression. Fix the root cause: revert to `Object.freeze([rule1, rule2, …] as const)` literal, then `treeshake: true`. | sam-technical | `packages/lint/tsup.config.ts` + `packages/lint/src/rules.ts`. |
| P1-21 | No troubleshooting section. The 4 most common errors and one-line fixes (path issues, npx cache, restart Claude, log path) belong in the README. | blake, taylor | `packages/mcp/README.md`. |
| P1-22 | Sibling READMEs use "You probably don't depend on this package directly" — useful filter. mcp+knowledge don't. Add "Who this is for" lines. | blake, sam-content | Multiple READMEs. |
| P1-23 | Tool descriptions are LLM-targeted; humans browsing MCP Inspector get topic-dump first sentences. Lead with a one-sentence human summary, then "Use when:" guidance. | blake | `packages/mcp/src/server.ts` all tools. |
| P1-24 | Lint rules with high false-positive rates: `derivation-uses-imported-state` (flags any non-allowlisted identifier), `useState-alongside-facts` (any file with both, even legit). Need symbol-resolution / same-component-only scope checks. | domain-expert | `packages/lint/src/rules/{derivation-uses-imported-state,useState-alongside-facts}.ts`. |
| P1-25 | `effect-mutates-facts` misses `++`, `--`, `??=`, `&&=`, `||=`, `Object.assign(facts,…)`, `delete facts.x`, `facts.items.push(x)`. Add compound assignments + unary + delete + mutating method calls. | domain-expert | `packages/lint/src/rules/effect-mutates-facts.ts:56-62`. |
| P1-26 | Zustand migration `before/after` doesn't actually demonstrate the spread→crossModuleDeps claim. Add a 2-store-merged "after" example or drop the claim. | domain-expert | `packages/knowledge/migration.json:86-90`. |
| P1-27 | MobX migration silent on "effects can't mutate facts" (lint rule L4 + anti-pattern). Add a "common pitfall" note. | domain-expert | `packages/knowledge/migration.json:192-195`. |
| P1-28 | Missing anti-patterns: "Reading facts inside resolve() that races with sibling resolver" + "Putting computed state in init". Both are top production bugs. Add as A20/A21. | domain-expert | `packages/knowledge/core/anti-patterns.md`. |
| P1-29 | Composition graph missing: `react → query` (most common React composition) + `ai → timeline` (agent runs replay). And `core → ai` edge is wrong-direction (core has zero knowledge of ai). | domain-expert | `packages/knowledge/compositions.json`. |
| P1-30 | XState migration "after" is a 3-state enum lookup, throws away every reason teams use XState. Rewrite with a 2-region machine + service + guard mapped to constraints + resolvers. | domain-expert | `packages/knowledge/migration.json:113-165`. |

## Defer — parking lot

| Topic | Reviewer | Reason |
|---|---|---|
| ts-morph dep dedup (drop from mcp, lint has it) | sam-technical | After P1-9 ships. |
| scaffold `peerDependencies` on core/ai (current inlined strings) | sam-technical | Low risk; revisit when core/ai entrypoints change. |
| Single-pass AST traversal for lint (one walk, dispatch to rules by parent key) | riley | 3-5× perf win; significant refactor. |
| Worker pool for lint (1-2 persistent workers vs spawn-per-call) | riley | Major throughput improvement. |
| Bake knowledge content via build-time imports (replace `readFileSync`) | riley | Saves syscalls; needs Node 22 baseline. |
| `Object.freeze` array idiom replace for treeshake | sam-technical | Bundled in P1-20. |
| Style-only lint rules (`no-single-line-if-return`) | domain-expert | Move to a Biome plugin or drop. |
| Anti-pattern #16 "Passthrough Derivations" — tag as style vs bug | domain-expert | Low impact. |
| `MAX_LINE_PREVIEW` config | charlie | Defer to LIMITS object work. |

## v0.3.0 candidates — ranked

Composite score = **viral × foundation × effort (lower=better) × moat**. Top 8:

| Rank | Candidate | Pitch | Score breakdown | Owner-lens |
|---|---|---|---|---|
| **1** | **`playground_link` tool** | Returns `directive.run/play/?gist=…` URL pre-populated with broken source + proposed fix. Every `fix_code` result becomes a shareable artifact. Zero-install distribution loop. | viral 9, effort 8, impact 9 | nova |
| **2** | **DevTools ↔ MCP runtime bridge** (`inspect_running_system`, `why_constraint_failed`, `snapshot_diff`) | "Claude, why is my orchestrator stuck?" → Claude reads live facts + constraints + derivations from the running app. First agent-debuggable runtime in the category. | viral 10, effort 3, impact 10 — the **moat** | nova, sam-technical |
| **3** | **`explain_finding` tool** | One round trip = explanation + minimal-repro + the exact 3 lines of fixed code. Pedagogy in one call. | viral 8, effort 9, impact 8 | nova |
| **4** | **Slim cold-start (P0-1 + P1-9 + P1-10 + P1-11)** | Lazy ts-morph (real), drop ts-morph from mcp deps, drop sourcemaps, split skill bundles. Cuts ~85 MB install + ~10s cold start. | foundational; not viral but blocks everything else | riley |
| **5** | **MCP Resources for knowledge/examples/rules** (`directive://knowledge/{name}`) | Resources are cacheable and discoverable via `resources/list`. Cuts round-trips. | viral 5, effort 7, impact 7 | sage |
| **6** | **MCP Prompts for common flows** (`review-and-fix`, `migrate-from-redux`, `scaffold-orchestrator`) | Prompt templates remove orchestration burden from the LLM. | viral 6, effort 9, impact 7 | sage |
| **7** | **`apply_review` macro tool** | One call: source in, source with all fixable findings applied + remaining unfixable findings. Closes the loop server-side. | viral 7, effort 8, impact 8 | sage |
| **8** | **Telemetry (anonymous, opt-out, local-NDJSON first)** | Anonymous UUID, `DIRECTIVE_TELEMETRY=0`, NDJSON at `~/.cache/directive/telemetry.log`. v0.3.0-beta local-only, v0.3.0-rc adds Cloudflare Worker collector. | foundational for v0.4 decisions | val-analytics |

### v0.3.0 deferred from the v0.2.0 plan — re-ranked

- **PROMOTED:** DevTools↔MCP runtime bridge → #2. `record_tool_usage` → #8 (telemetry).
- **KEPT:** Codemod `migrate_from`, semantic knowledge search, prototype-pollution hardening (P1-4).
- **DEMOTED → v0.4:** `validate_module_schema` (internal quality, no viral wow), `mcp.directive.run` SSE hosting (waits on harper's MVP spec + telemetry).

### Lint rules to add in v0.3.0 (from domain-expert)

1. **`fact-in-place-mutation`** — `facts.x.push()`, `facts.x.y = z`, `Object.assign(facts.x, …)`. Top production bug source. Error, fixable.
2. **`init-is-async`** — anti-pattern #12. Error, not fixable (semantic rewrite needed).
3. **`async-constraint-missing-deps`** — anti-pattern #18. Error, partially fixable.

### Streaming opportunity (#1 — river)

**`review_source` progress notifications.** Emit each `Finding` as `notifications/progress` mid-call. Worker already iterates rules; wire a callback through `runLintInWorker`. Backwards-compatible: clients without `progressToken` get today's exact behavior. Cuts perceived latency on large files by 40-60%.

### `mcp.directive.run` deploy MVP (harper)

- Fly.io app, shared-cpu-1x (256MB), `min_machines_running=1`, autoscale max 3.
- Cloudflare in front: orange-cloud, Full-Strict TLS, WAF rate-limit (60 req/min per IP `/messages`, 10 req/min `/sse`).
- Bearer tokens minted at `directive.run/mcp/connect` (rotatable, 90-day TTL), stored hashed, verified with `timingSafeEqual`.
- pino JSON → Fly Logs → Sentry (errors) + BetterStack (uptime).
- Privacy contract published: zero retention of `review_source` input; metadata-only logs; 30-day rotation.

**3 things to add to the server BEFORE hosting:**
1. Per-IP rate limiter + constant-time token compare + per-IP session cap.
2. Structured request logs + `/metrics` Prometheus endpoint.
3. Real `/readyz` that exercises the worker pool + knowledge loader.

## Recommended ship order

**v0.2.3 (this cycle — code patch + docs):**
- All 12 P0s above.
- P1-2 (body-cap race), P1-13 (clock skew), P1-14 (worker race), P1-16 (server-info singleton) — small fixes, big correctness wins.
- Doc reckoning: architecture diagram in README, sam-content's 3 rewrites, "Try it" block, "Verify install" section, troubleshooting section.

**v0.3.0-alpha (next session):**
- `playground_link` + `explain_finding` + `apply_review` macro (week 1).
- Slim cold-start (P0-1 lazy ts-morph done right, P1-9 drop ts-morph from mcp, P1-10 drop sourcemaps).
- Telemetry foundation (local NDJSON only).
- `fact-in-place-mutation` + `init-is-async` + `async-constraint-missing-deps` lint rules.

**v0.3.0-beta:**
- DevTools↔MCP runtime bridge (the moat — weeks 3-6 of v0.3.0).
- MCP Resources + Prompts.
- `review_source` streaming via `notifications/progress`.

**v0.3.0 GA:**
- `mcp.directive.run` SSE hosting with all of harper's pre-host requirements.
- Telemetry Cloudflare Worker collector.

## Open questions for next planning session

- Should `@directive-run/mcp/runtime` ship as a subpath export (sam-technical), or stay one binary?
- Should `@directive-run/lint-react`, `@directive-run/lint-ai-orchestration` be separate plugin packages with a registry protocol (sam-technical)?
- Telemetry opt-in vs opt-out at GA — Next.js / Astro pattern (val) vs stricter?
- XState migration rewrite — sketch in this audit, or kick to a dedicated docs commit?

## End-state

13 lenses run. 12 P0s identified. 30 P1s captured for next-sprint triage. v0.3.0 roadmap ranked. The path to "production-ready for both users and AI clients" is **a 0.2.3 patch (code + docs) followed by a 0.3.0 cycle focused on the playground + DevTools bridge + slim cold-start + telemetry foundation.** Confidence answer to the framing question: **yes after this audit's P0s land — not before.**
