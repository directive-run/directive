# Cloudflare Workers + Durable Objects + `@directive-run/ai`

Working scaffold: a Durable Object hosts a Directive System that ingests URLs,
runs a three-agent chain on a periodic tick, and routes the result by
confidence. Typechecks against the workspace.

## What this shows

- Durable Object hosting a Directive System backed by DO storage
- `sourceFromDOAlarm` — the DO alarm as a periodic tick source (the DO's own
  `alarm()` callback delegates to the source, since the adapter can't
  intercept a runtime class method)
- Multi-agent chain via `createMultiAgentOrchestrator` + `sequential(['aggregator', 'rewriter', 'publisher'])`
- Constraint → requirement → resolver split: constraints observe facts and
  emit `RUN_PUBLISHING_CHAIN` / `ROUTE_ARTICLE` requirements; resolvers do
  the async work
- Enhanced PII guardrail wired at the orchestrator boundary
- R2 append-only audit log via injected `deps.auditLog`
- WebSocket ingest via `system.dispatch({ type: 'ingest', url })`

## Prerequisites

- Cloudflare account with Workers + Durable Objects + R2
- `wrangler` CLI installed and authenticated
- Anthropic API key: `wrangler secret put ANTHROPIC_API_KEY`

## Run

```bash
pnpm install
pnpm typecheck
wrangler dev
```

Send an ingest signal:

```bash
curl -X POST http://localhost:8787/tenants/demo/ingest \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/story-1"}'
```

Inspect state:

```bash
curl http://localhost:8787/tenants/demo/status
```

## Layout

```
src/
├── index.ts        Hono Worker entry, tenant routing (DO ID via idFromName)
├── agent-room.ts   Durable Object — hosts one Directive System per tenant
├── module.ts       Directive module + createSystem + alarm source wiring
├── schema.ts       Facts / derivations / events / requirements schema
├── agents.ts       Multi-agent chain (aggregator → rewriter → publisher)
└── deps.ts         Injected R2 audit log + broadcaster stub
```

## Wiring notes

- **Alarm delegation** — `sourceFromDOAlarm` returns a source that exposes a
  `tick()` callback via `onTickRegistered`. The DO's own `alarm()` method
  MUST call that tick — the source can't intercept the DO runtime callback.
- **Single-module system** — `createSystem({ module })` gives direct
  `system.facts`, `system.derive`, `system.dispatch` access without a
  namespace prefix. For multiple modules use `createSystem({ modules: { name: mod } })`.
- **Guardrails as objects, not arrays** — `guardrails: { input, output, toolCall }`
  on the orchestrator options. `createEnhancedPIIGuardrail()` returns a
  guardrail function that fits here; `createFactPIIGuardrail()` returns a
  system Plugin and belongs in `createSystem({ plugins: [...] })` instead.
- **`sequential` takes handler IDs** — string keys of the agents registry,
  not agent instances. It returns a plain pattern config; the orchestrator's
  `runPattern('publish', input)` executes it.
