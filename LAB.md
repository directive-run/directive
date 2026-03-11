# Lab & Deprecated Features

Features not yet shipped (lab) or being phased out (deprecated). See `docs/ARCHITECTURE.md` → "Feature Lifecycle" for the full convention.

---

## Lab

Features under evaluation. Not in the bundle, not in docs navigation, not indexed for search.

| Feature | Files | Reason | Added |
|---------|-------|--------|-------|
| Observability Plugin | `packages/core/src/plugins/observability.lab.ts` | Homebrew metrics/tracing/alerting — re-evaluating vs OpenTelemetry | 2026-03-11 |
| Observability Docs | `website/src/app/docs/plugins/observability/page.lab.md` | Docs for lab plugin | 2026-03-11 |
| AI Evals | `website/src/app/ai/evals/page.lab.md` | AI evals page — not yet ready | 2026-03-11 |
| AI OpenTelemetry | `website/src/app/ai/otel/page.lab.md` | AI OTel integration docs — needs rework after observability lab | 2026-03-11 |
| AI Testing | `website/src/app/ai/testing/page.lab.md` | AI testing docs — not yet ready | 2026-03-11 |

### Notes

- **Observability:** `createObservability` and `createAgentMetrics` provide in-memory metrics, tracing, and alerting. The OTLP exporter and circuit breaker import types from the lab file (type-only, erased at compile time). The checkers example imports the runtime directly via relative path. Decision: evaluate whether to replace with thin OTel wrapper or promote as-is.

---

## Deprecated

Shipped features being phased out. Still in bundle (with runtime warnings), docs have deprecation banner.

| Feature | Files | Replacement | Removal Target |
|---------|-------|-------------|----------------|
| *(none yet)* | | | |
