---
"@directive-run/core": minor
"@directive-run/ai": minor
"@directive-run/react": patch
"@directive-run/vue": patch
"@directive-run/svelte": patch
"@directive-run/solid": patch
"@directive-run/lit": patch
"@directive-run/vite-plugin-api-proxy": patch
---

R6 full-library AE review — 4 security fixes, bundle splits, +64 tests

Library-wide AE review across all 16 packages (~100K LOC, 4,765 tests).
Found 0 CRITICAL / 23 MAJOR. Closed the real-gap subset surgically; deferred
architectural-only items. Tests 4,765 → 4,829 (+64).

### Security fixes (4 MAJOR closed)

- **`@directive-run/vite-plugin-api-proxy`** — 10 MB body cap + 30 s slowloris
  timeout + response-header allowlist. `set-cookie`, `authorization`,
  `x-api-key`, `x-internal-*` are now explicitly dropped from upstream
  responses; only `content-type`, `cache-control`, `etag`, `last-modified`,
  `vary`, `content-encoding`, `content-language`, `expires`, `pragma`
  forwarded. Closes upstream-header info-leak + body-flood DoS.
- **`@directive-run/core` worker adapter** — `request<T>()` accepts
  `timeoutMs?: number` (default 30 s; `0`/`Infinity` opts out). On timeout
  or `worker.onerror`, all pending entries reject + clear. Closes
  unbounded `pendingRequests` Map leak.
- **`@directive-run/ai` structured-output** — `extractJsonFromOutput` now
  runs `isPrototypeSafe` on every `JSON.parse` return point. LLM output
  with `__proto__`/`constructor`/`prototype` keys throws
  `[Directive] structured-output: extracted JSON contains unsafe
  prototype keys` instead of silently passing through.

### Architecture splits (2 MAJOR closed)

- **`@directive-run/ai` bundle split** — main bundle 120 KB → **44 KB**
  (-63%). New subpath exports (additive — main barrel keeps re-exports
  with `@deprecated` JSDoc for one cycle):
  - `@directive-run/ai/multi-agent` — orchestrator + patterns + agent
    communication + checkpoints + breakpoints
  - `@directive-run/ai/predicate` — `predicateFromIntent*`,
    `predicateToolSpec*`, `PredicateFromIntentError`
  - `@directive-run/ai/guardrails` — PII / moderation / prompt-injection /
    semantic cache
  - `@directive-run/ai/devtools` — debug timeline + devtools WebSocket
    server + health monitor
  - `@directive-run/ai/evals` — eval harness
  - (`@directive-run/ai/mcp`, `/openai`, `/anthropic`, `/ollama`, `/gemini`
    unchanged)
- **`@directive-run/core` audit-ledger split** — 1,313 LOC monolith
  refactored into `packages/core/src/plugins/audit-ledger/` (6 files:
  `types`, `hash`, `sink`, `predicate-redact`, `verify`, `index`). Public
  API unchanged. `LEDGER_INTERNAL_TOKEN` sentinel still confined to one
  file; tombstone-forgery defense intact.

### Test parity (1 MAJOR closed)

`useAuditLedger` hooks shipped in v1.13 for React / Vue / Svelte / Solid
had ZERO tests (Lit had 1 controller test). Added **25 tests** across 4
new test files covering: initial-value sync, reactive update,
filter exclusion, `pollMs<50` clamp + dev warning, large-ledger warning,
cleanup on unmount.

Plus: vite-plugin-api-proxy gained its first 4 tests (body cap, header
allowlist, timeout) + worker adapter gained 5 timeout/onerror tests + 6
new structured-output prototype-safety tests. Total +40 tests.

### DX fixes (5 closed)

- Root README — added 8 missing packages to the table (`el`, `query`,
  `cli`, `mutator`, `optimistic`, `timeline`, `vite-plugin-api-proxy`,
  `knowledge`); fixed adapter-count mismatch.
- `@directive-run/vite-plugin-api-proxy` — new README documenting CORS
  rationale, header allowlist, body cap, prod warning.
- `@directive-run/core` CHANGELOG — 1.12.0 entry was empty; filled in
  with the R4 AE-review-loop scope.
- `AuditLedgerSink.erase` parameter renamed `tombstoneFactory` →
  `markerEntryFactory` (param-name rename, no behavior change — TS
  positional args mean no consumer breakage).
- `[Directive]` prefix sweep on `predicate-to-mongo.ts`, `sweep-under.ts`,
  `module.ts`, `adapter-utils.ts` — confirmed all 36 throws already
  prefixed (no diff).

### Docs (1 closed)

6 plugin concept docs added (`logging`, `devtools`, `persistence`,
`observability`, `circuit-breaker`, `performance`) under
`docs/concepts/`. Mirror pages at `directive-docs/src/app/docs/<name>/`
for v2 routing (the existing nav under `/docs/plugins/<name>` keeps its
deeper content; the observability nav entry remains commented out per
the existing "re-evaluating vs OTel" product call).

### Deferred (R5 MAJOR not closed this round)

- Observability + OTLP exporter + predicate-to-{sql,mongo,pgrest} direct
  test files (~300-1100 LOC each, no regression risk currently)
- Cross-package integration tests
- LLM-emit provenance → audit-ledger seam (predicateHash on
  `constraint.evaluate` entries) — wider design call
- Subject-keyed audit queries (multi-tenant ergonomics)
- Devtools extraction to its own package
- Shared `Sink<T>` interface refactor

R5 review surfaced 0 CRITICAL across the whole library. R6 closes the
high-signal subset. Engine + AI substrate + R4 hardening all intact.
