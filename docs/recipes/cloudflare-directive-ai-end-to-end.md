# Recipe: Cloudflare Workers + Durable Objects + `@directive-run/ai`

Compose `@directive-run/core`, `@directive-run/sources/cloudflare`, and
`@directive-run/ai` inside a Durable Object. The DO alarm drives a periodic
tick source, a multi-agent chain runs on demand, and results are routed
by confidence.

Working example (canonical source of truth):
[`examples/cloudflare-directive-ai/`](../../examples/cloudflare-directive-ai/).
Run `pnpm --filter @directive-run/example-cloudflare-directive-ai typecheck`
to verify against the current API surface. If a snippet here diverges
from the example, the example wins.

## Why compose this way

A Durable Object is the natural host for a long-lived Directive System.
DO storage survives hibernation; the alarm cadence gives you a
first-class tick source; the WebSocket connection surface gives you
streaming ingest; R2 gives you an append-only audit sink. The Directive
System sits in the middle: facts hold state, constraints emit
requirements, resolvers do side effects. The `@directive-run/ai`
multi-agent orchestrator plugs in as a resolver dependency, not as
part of the reactor.

Status is the reactor. `status: "aggregating"` or `status: "reviewing"`
transitions trigger the constraints that emit the AI-chain or routing
requirement — not an imperative `execute()` inside the constraint.

## Wire notes

Common places composers drift from the shipped API. Every point below
matches a line in the example.

1. **Constraints have no `execute:`.** `TypedConstraintDef` accepts
   `{ when, require }` only. The requirement's `type` keys a resolver:

   ```ts
   constraints: {
     startAggregation: {
       when: (facts) => facts.ingestQueue.length >= 3 && facts.status === "idle",
       require: (facts) => ({ type: "RUN_PUBLISHING_CHAIN", sources: facts.ingestQueue.slice(0, 8) }),
     },
   },
   resolvers: {
     runChain: {
       requirement: "RUN_PUBLISHING_CHAIN",
       resolve: async (req, context) => { /* run chain, mutate facts */ },
     },
   },
   ```

2. **Sources live in `sources:` on the module config.** Consumers never
   call `source.attach()` — the engine does that at `system.start()`.
   `sourceFromDOAlarm` returns a `SourceDef & { tick(): void }`:

   ```ts
   sources: {
     alarm: sourceFromDOAlarm({
       storage: ctx.storage,
       intervalMs: 5 * 60 * 1000,
       eventName: "tick",
       payload: () => ({}),
       onTickRegistered: (tick) => { handle.alarmTick = tick; },
     }),
   },
   ```

3. **The DO's own `alarm()` must call the source's tick.** The adapter
   can't intercept a DO runtime class method, so capture the tick via
   `onTickRegistered` and delegate to it from the class:

   ```ts
   async alarm(): Promise<void> {
     this.handle.alarmTick();
   }
   ```

4. **`createSystem` shape.** Single-module: `createSystem({ module })`.
   Multi-module: `createSystem({ modules: { name: mod } })` (an OBJECT,
   not an array). Access on a single-module system is direct:
   `system.facts.status`, `system.derive.queueDepth`,
   `system.dispatch({ type: "ingest", url })`.

5. **Multi-agent orchestrator — `sequential` takes handler IDs.**
   Handlers are the string keys of the `agents` registry, not agent
   instances. `sequential([...])` returns a pattern config object;
   `orchestrator.runPattern('publish', input)` executes it:

   ```ts
   const orchestrator = createMultiAgentOrchestrator({
     runner,
     agents: {
       aggregator: { agent: aggregatorAgent },
       rewriter: { agent: rewriterAgent },
       publisher: { agent: publisherAgent },
     },
     guardrails: { input: [createEnhancedPIIGuardrail()] },
     patterns: { publish: sequential(["aggregator", "rewriter", "publisher"]) },
   });
   const result = await orchestrator.runPattern<string>("publish", input);
   ```

6. **Guardrails is an object, not an array.** `{ input?, output?, toolCall? }`
   on `OrchestratorOptions`. `createEnhancedPIIGuardrail()` returns a
   guardrail function that fits `input`. `createFactPIIGuardrail()`
   returns a system Plugin — it belongs in `createSystem({ plugins: [...] })`,
   not in `guardrails.input`.

7. **Real Anthropic model IDs.** `claude-sonnet-4-5-20250929`,
   `claude-haiku-4-5-20251001`, `claude-opus-4-20250514`. See
   `packages/ai/src/adapters/anthropic.ts` `ANTHROPIC_PRICING` for
   the current set.

8. **`sourceFromWebSocketMessage.decode` returns `{ name, payload } | null`.**
   Return the event name explicitly — the source uses it to publish
   under that name. Return `null` to drop the frame (ping frames,
   malformed payloads).

## When NOT to reach for this composition

- **No streaming ingest, no periodic tick.** A regular Worker with an
  in-memory Directive System per request handles this fine; skip the DO.
- **Multi-tenant fan-out with shared state.** DO isolates per instance;
  use a KV-backed store or a single "coordinator" DO and post to it
  from per-tenant workers instead of running a chain per tenant.
- **Sub-second response SLAs.** DO cold-starts + AI runner latency
  won't fit; route synchronous work through a regular Worker and
  reserve the DO for background chains.

## Extend

- **Reactive agents mid-run.** Swap the sequential chain for
  `agent-orchestrator`'s `runStream({ liveContext })` — the agent
  observes fact updates while it runs. See `packages/ai/src/agent-orchestrator.ts`.
- **Signed audit trail.** Wrap the R2 append with an ed25519 signing
  step so consumers can verify each event out-of-band.
- **Fan-out publishing.** Swap `createNoopBroadcaster` for a POST to
  your own downstream endpoint.
