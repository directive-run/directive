# AI Adapter Roadmap

Items from AE review (2026-02-10). These are enhancement ideas for future iterations.

## Constraint System

- **Constraint validation at build time** — Validate requirement types match schema, detect circular dependencies, warn on suspicious priority values. Surface in devtools as "Constraint Graph" DAG.
- **Constraint introspection API** — `orchestrator.getConstraints()`, `traceConstraint(id)` with full fact snapshots. Wire into devtools for "Why did PAUSE fire?" debugging.
- **Dynamic priority** — `constraint().priority(f => f.critical ? 100 : 10)` — priority as a function of facts.

## Guardrails

- **Guardrail retry execution** — `GuardrailRetryConfig` exists in types but has no execution logic. Implement with exponential backoff for transient failures.
- **Streaming guardrail composition** — `andGuardrails()`, `orGuardrails()` for combining streaming checks with AND/OR logic.
- **Error recovery suggestions** — Extend `GuardrailResult` with `suggestions?: string[]` for guided recovery (e.g., "Use summarization to shorten output").
- **Model-aware token estimation** — Ship `estimateGPT4()`, `estimateClaude()` estimators. Let users register custom estimators per agent model.
- **Built-in timeout guardrail** — `createTimeoutGuardrail({ maxMs: 30000 })` for stalled streams.
- **Guardrail telemetry** — Emit `guardrail.triggered` in metrics, track failure rates by name/type, warn if any check > 100ms.

## Documentation

- Add constraint helpers to docs with before/after examples
- Add new guardrails (`createLengthGuardrail`, `createContentFilterGuardrail`) to security docs
- Document `streamChunks()` with pattern-matching examples for all chunk types
