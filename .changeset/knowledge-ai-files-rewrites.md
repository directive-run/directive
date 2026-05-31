---
"@directive-run/knowledge": patch
---

Rewrite `ai/ai-multi-agent.md`, `ai/ai-guardrails-memory.md`,
`ai/ai-budget-resilience.md`, and `ai/ai-testing-evals.md` against
the actual v1.14 exports. Every one of these four files had
comprehensive hallucinations that caused LLM-generated code to fail
at import time or first call.

**ai-multi-agent.md** had been teaching `dag([{}])` as an array form
(real shape: `Record<string, DagNode>` with `deps` not
`dependencies`), `parallel(handlers)` without a required `merge` arg,
`reflect("name", opts)` without a required `evaluator` agent,
`debate(arr, {judge})` instead of `debate(DebateConfig)` with
`evaluator`, and `goal("agent", opts)` instead of
`goal(Record<string, GoalNode>, when, options)`. All five pattern
factory signatures were wrong.

**ai-guardrails-memory.md** had `createOutputSchemaGuardrail({
schema, retries })` (real shape: `{ validate, errorPrefix }`),
`createToolGuardrail({ allowedTools })` (real: `{ allowlist,
denylist, caseSensitive }`), `createLengthGuardrail({ minChars,
maxChars, minTokens, maxTokens })` (real: only `maxCharacters` and
`maxTokens` — no min, no `maxChars` spelling),
`createContentFilterGuardrail({ patterns, action: "redact" })`
(real: `{ blockedPatterns, caseSensitive }`, block-only, no redact
mode), and `GuardrailError.errorCode` / `error.reason` (real:
`error.code` / `error.userMessage`).

**ai-budget-resilience.md** had `withFallback(primary, backup)`
(real: array of runners), `withRetry({ backoff, shouldRetry })`
(neither option exists; real: `{ maxRetries, baseDelayMs,
maxDelayMs, isRetryable, onRetry }`), `createCircuitBreaker({
resetTimeout, halfOpenMaxAttempts })` (real: `recoveryTimeMs` and
`halfOpenMaxRequests`), `breaker.wrap(runner)` / `breaker.state`
(real: `breaker.execute(fn)` / `breaker.getState()`),
`createHealthMonitor({ agents, checkInterval, onStatusChange })`
with `monitor.start()`/`getReport()`/`stop()` (real: a metrics
tracker with `recordSuccess`/`recordFailure`/`getHealthScore`),
`createOpenAIEmbedder` and `createAnthropicEmbedder` (neither exists
— users supply their own `EmbedderFn`), and `cache.wrap(runner)`
(real: pair `createSemanticCache` with
`createSemanticCacheGuardrail`).

**ai-testing-evals.md** had `createMockRunner` (real:
`createMockAgentRunner`), five hallucinated `assert*` helpers
(`assertAgentCalled`/`assertTokensUsed`/etc. — none exist), the
entire `createEvaluator` + `criteria.*()` namespace + `createLLMJudge`
+ `createEvaluationSuite` (all hallucinated — real surface is
`createEvalSuite` with top-level `evalCost`/`evalLatency`/`evalJudge`
/`evalRelevance`/`evalCoherence`/`evalFaithfulness`/etc. factories),
and `createErrorSimulator` / `createLatencySimulator` (real:
`createFailingRunner` + `delay` on `MockAgentConfig`).

All four files now use full runnable examples with the actual import
paths (`@directive-run/ai/multi-agent`, `@directive-run/ai/guardrails`,
`@directive-run/ai/evals`, etc.) instead of the main barrel, and
inline every hallucination as a WRONG/CORRECT pair so future LLMs
catch the same drift on first read.

No code changes; no API changes; this is a content fix to the
published knowledge package.
