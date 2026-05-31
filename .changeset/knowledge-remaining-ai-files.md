---
"@directive-run/knowledge": patch
---

Rewrite `ai/ai-debug-observability.md`, `ai/ai-security.md`,
`ai/ai-mcp-rag.md`, `ai/ai-agents-streaming.md`, and
`ai/ai-communication.md` against the actual v1.14 exports. Closes the
final batch of T1.7 in the knowledge content sweep.

**ai-debug-observability.md** had been teaching
`timeline.subscribe(listener, { filter })` (no options arg exists),
`timeline.query({type, since})` (no `.query()` exists — real surface
is typed `getEventsByType<T>` / `getEventsInRange` /
`getEventsForAgent` / `getEventsAtSnapshot`), `debug: { timeline,
verbose, breakpoints }` (real `OrchestratorDebugConfig` has only
`verboseTimeline?: boolean`; breakpoints + onBreakpoint are top-level
options; the timeline is read off `orchestrator.timeline` after
construction), and breakpoint configs with imaginary `when()` /
`onHit(event, resume)` shapes (real shape is declarative
`before:`/`after:` event type + optional `filter:` predicate, resumed
via `orchestrator.resumeBreakpoint(id)`).

**ai-security.md** had `createAuditTrailPlugin` and
`createCompliancePlugin` from `@directive-run/core/plugins` (real:
`createAuditTrail` and `createCompliance` from `@directive-run/ai`),
both treated as Directive plugins to drop into `plugins:[…]` (real:
they return instances you record into / call directly).
`createPromptInjectionGuardrail` had `sensitivity` and `allowlist`
options (real: `strictMode`, `blockThreshold`, `additionalPatterns`,
`replacePatterns`, `sanitize`, `onBlocked`, `ignoreCategories`).
`createPIIGuardrail` was being used on both input and output (real:
it's input-only; `createOutputPIIGuardrail` covers output).

**ai-mcp-rag.md** fixed every lifecycle verb
(`disconnect("name")` / `disconnectAll()` → `disconnectServer(name)`
/ `disconnect()`), the status surface
(`getStatus()` → `getServerStatus(name)` + `getAllServerStatuses()`),
the tools return type (`getTools()` returns
`Map<server, MCPTool[]>` not a flat array), the MCPAdapterConfig
options (`autoConnect` / `autoReconnect` / `approvalTimeoutMs` /
`allowDirectCalls` / `clientFactory` — not `connectionTimeout` /
`reconnect`), and the embedder shape (`EmbedderFn = (string) =>
Promise<number[]>` — no `createOpenAIEmbedder` /
`createAnthropicEmbedder` factories exist; users supply their own
embedder, optionally batched via `createBatchedEmbedder`).

**ai-agents-streaming.md** fixed `createStreamingCallbackRunner` →
`createStreamingRunner(callbackBased, opts)` (the callback form is
the INPUT to this wrapper, not a separate factory),
`createSSEResponse(stream)` → `createSSETransport(config)` with
`{ toResponse, toStream }`, the runStream return value
(`{ stream, result, abort }`, not an AsyncIterable directly), and the
`TokenUsage` shape (only `inputTokens` and `outputTokens` — no
`total`).

**ai-communication.md** fixed `bus.request(...)` (lives on
`AgentNetwork.request(from, to, action, payload, timeout)` — not on
the MessageBus), the subscription return type (`Subscription` with
`.unsubscribe()`, not a bare unsubscribe function), the
`findByCapability` return type (`AgentInfo[]`, not `string[]`),
removed the fictitious `network.route(capability, payload)` method,
removed the `createMultiAgentOrchestrator({ bus })` option (wire the
bus alongside the orchestrator via hooks), and corrected the
scratchpad mutability story (the scratchpad is `Readonly` — return
new state through task outputs).

All five files now use full runnable examples with the correct
subpath import paths and inline every hallucination as a WRONG/CORRECT
pair. T1.7 closed — combined with T1.1-T1.6 this completes the
Tier-1 knowledge content rewrites against v1.14.

No code changes; no API changes; this is a content fix to the
published knowledge package.
