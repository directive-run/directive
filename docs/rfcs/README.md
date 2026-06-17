# Directive RFCs

Accepted RFCs that shipped or are scheduled for upcoming releases. Each
RFC names its acceptance criteria, scope guard, and the version it
landed in. Open questions are tracked inline.

## Index

| # | Title | Status | Landing |
|---|---|---|---|
| [0001](./0001-t-timer.md) | `t.timer()` schema primitive | Accepted | 1.x |
| [0002](./0002-unregister-and-multi-instance.md) | `unregisterModule()` + multi-instance modules | Draft | TBD |
| [0003](./0003-resolver-constraint-binding.md) | Resolver / constraint binding (`abortOn:`) | Accepted | 1.x |
| [0004](./0004-data-configuration-triggers.md) | Data-form predicate triggers | Accepted | 1.x |
| [0005](./0005-live-context-agent.md) | `runStream({ liveContext })` – Reactive Agents | Accepted | shipped 2026-06-07 (v1.18.0) |
| [0006](./0006-spell-out-type-names.md) | `*Definition` aliases (1.x forward-compat) | Accepted | shipped 2026-06-07 (v1.18.0) |
| [0007](./0007-source-backpressure.md) | Source `coalesce` backpressure | Accepted | shipped 2026-06-07 (v1.18.0) |
| [0008](./0008-source-observer-protocol.md) | Source Observer protocol (`attach(publish, reportError?)`) | Accepted | shipped 2026-06-07 (v1.18.0) |
| [0009](./0009-async-stop-and-do-eviction.md) | Async stop + Durable Object eviction | Accepted | shipped 2026-06-07 (v1.18.0); wrapper wiring + adapter `onEvict` shipped 2026-06-09 (v1.19.0 / v1.19.1) |
| [0010](./0010-guardrail-blocked-event.md) | `guardrail.blocked` `ObservationEvent` + `system.notify` | Accepted | shipped 2026-06-10 (`@directive-run/core` v1.20.0 + `@directive-run/ai` v1.19.7) |

## Drafting flow

1. Open as a draft PR titled `[rfc] NNNN – <one-line summary>`.
2. The RFC body lists: Summary, Motivation, Proposed API, Security
   considerations (if any), Scope guard, Open questions, Acceptance
   criteria.
3. Reviewers comment on the draft. Major design pivots get committed
   into the RFC body so the conversation is preserved.
4. On acceptance: status flips to `Accepted` and the RFC tracks any
   follow-ups in `Open questions` + the changelog entry.
5. On ship: status updates to include the landing version in the line
   "Status: Accepted – shipped YYYY-MM-DD in <branch>".

## Shipped post-1.18.0

- **Walker security rewrite** – three rounds of patches on the
  `createFactPIIGuardrail` walker each opened a slightly different
  Proxy bypass surface (R13 → R14 → R15). R16 landed
  `structuredClone`-based sanitization-then-walk so the walker only
  operates on a Proxy-free clone of the fact value. Shipped
  2026-06-09 in `@directive-run/ai` v1.19.3. R17 hardened the
  pre-clone array cap + Error/Date/RegExp/Blob/TypedArray
  short-circuits in v1.19.6. R18 closed a Proxy `length`-getter
  TOCTOU bypass (via `new Array(len)` materialization), added
  `Error.cause` + `AggregateError.errors` recursion, restricted
  the idempotency gate to primitives, and fixed the Error
  redact-mode contract (shipped in v1.19.7).

- **`system.evict()` reentry gate** – Cloudflare DO hibernation can
  signal eviction twice; without a gate, the second call re-runs
  every source's `onEvict` and non-idempotent eviction handlers
  double-fire. `state.isEvicting` is now set BEFORE awaiting any
  async eviction work AND cleared in a `finally` so a rejected
  inner work doesn't latch the gate forever. `system.start()`
  refuses to start while eviction is in flight or after destroy.
  R18 Tier 2-C, shipped 2026-06-10 in `@directive-run/core` v1.20.0
  (follow-up added the try/finally + start guard).

- **RFC 0010 / `guardrail.blocked` ObservationEvent** – new
  `ObservationEvent` variant + `Plugin.onGuardrailBlocked` hook +
  `System.notify.guardrailBlocked` external plugin surface.
  `createFactPIIGuardrail` calls `notify.guardrailBlocked` on
  every detection with `kind: "redact" | "alert" | "detect"`.
  Backend wiring (`attachSourcesToOtel`, timeline, audit-ledger)
  is consumer-driven via `system.observe()`. R18 Tier 2-A,
  shipped 2026-06-10 in `@directive-run/core` v1.20.0 +
  `@directive-run/ai` v1.20.0. follow-up validated the
  `plugin` field against registered plugin names + added a
  reentry depth cap.

- **Framework adapter async-destroy migration** – all 5 adapters
  (react / vue / svelte / solid / lit) switched from sync
  `system.destroy()` to `system.destroyAsync().catch(...)` so
  source unsubscribes complete before host hibernation. Dev-mode
  `console.warn` surfaces any unsubscribe rejection. R18 Tier 2-B,
  shipped 2026-06-10 in framework adapter v1.20.x.

## Open follow-up RFCs (tracked but not yet drafted)

- **Live-context automatic re-prompt semantics** – the original RFC 0005
  drafted a `mode: "restart"` field; the impl was abort-and-emit only.
  Future RFC will spec the auto-re-prompt merge strategy (rerender vs.
  delta) and re-introduce the field alongside an impl that reads it.
- **Pre-emit transform hook** – `createFactPIIGuardrail` is a post-emit
  redactor; observability plugins (audit-ledger, debug-timeline,
  devtools, custom log shippers) see raw PII on the first `onFactSet`
  emission before the redaction follow-up write fires. Future RFC will
  spec a pre-emit transform plugin API so Tier 0 PII guards close the
  surface for every plugin, not just future fact reads.

  *Partially mitigated by RFC 0010 (`guardrail.blocked` event) – every
  PII detection now surfaces through `system.observe()` so
  observability sinks can correlate the typed event with the
  preceding `fact.change`. Hard pre-emit redaction still needs a
  separate RFC.*
- **`source.evict` observation event variant** – RFC 0009 added the
  evict lifecycle but the `ObservationEvent` union still has no
  `source.evict` variant, so audit-ledger / OTel exporters cannot
  attribute the success path.
- **Reconnect contract for sources** – production transports (Supabase
  realtime, WebSocket) drop on day one. There's no canonical
  `withRetry(source)` / `SourceDef.retry` field; every adapter
  reinvents it. Future RFC will propose a primitive.
- **`complete()` channel on `SourcePublish`** – `SourcePublish` is a
  callable interface with `publish(event, payload?)` only. Finite
  sources (one-shot OAuth callback, SSE stream end, paginated cursor
  exhaustion) have no canonical way to signal end-of-stream. Future RFC
  will add `publish.complete?()` per the Observer-protocol shape.
