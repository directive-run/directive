# AI × Sources

> Wire `@directive-run/core`'s `source` primitive into `@directive-run/ai`
> agents and orchestrators. Sources are how external event streams
> (Supabase realtime, WebSockets, Cloudflare DO alarms, MCP server lifecycle)
> publish into facts that agents reason over.

The source primitive's full semantics live at
[`../core/sources.md`](../core/sources.md). This doc covers the AI-specific
patterns: which external streams to wire as a source vs. as an
`AsyncIterable` (anti-pattern), how `runStream` reacts to live fact
changes, how to keep PII out of agent prompts, and which existing
adapter (`@directive-run/sources/*`) covers the common vendors.

---

## Decision: source vs AsyncIterable

A long-running external stream can show up as a Directive **source** OR
as a per-call **AsyncIterable**. The boundary is durable.

| Use a **source** when... | Use an **AsyncIterable** when... |
|---|---|
| The stream's lifetime is the **system's lifetime** (Supabase realtime channel, WebSocket message stream, MCP server connection) | The stream's lifetime is **one agent generation** (LLM token stream from `runStream`, per-call SSE response) |
| You want every message to update **facts** the agent reasons over | You want the LLM's output tokens delivered to a single caller |
| The publisher cannot read facts | The consumer needs to act on each chunk synchronously |

**Three-tier lifetime ladder:**

1. **System source** (outermost): Supabase channel, MCP server, DO alarm,
   WebSocket message stream. Mount at `system.start()`, tear down at
   `system.stop()`.
2. **Conversation subscription** (middle): per-agent message bus
   subscription, PubSub topic subscription, per-agent breakpoint waiter.
   Created in the orchestrator's constructor, cleaned up on
   destroy. Lives across many generations.
3. **Generation iterable** (innermost): the actual LLM token AsyncIterable
   returned by `runStream`. Created per `runStream` call, ends when the
   model finishes or `abort()` fires.

Sources own the outermost ring; AsyncIterable owns the innermost; the
middle ring is what `@directive-run/ai/communication` covers today.

---

## Recipes by user intent

### "I want my agent to react to external lifecycle events"

Wire the lifecycle as a source on the orchestrator's module. The agent
sees fact-change reactions through its bound-facts view; resolvers can
gate execution on `facts.<lifecycle>.healthy` derivations.

- **MCP server connect/disconnect** → see "MCP Lifecycle" below.
- **Health checks** → poll inside the source's `attach`; publish
  `health_changed` events as the upstream service responds.
- **WebSocket open / close (Cloudflare DO)** → `sourceFromWebSocketMessage()`
  (`@directive-run/sources/cloudflare`). For raw Node/browser WebSocket
  bridges, declare a source whose `attach` wires `addEventListener` and
  publishes `MESSAGE` / `CLOSE` / `ERROR` events (a generic
  `sourceFromWebSocket()` helper is queued for a follow-up RFC).

### "I want my agent's facts to update from a live external feed"

This is the **live-context** pattern — the differentiator nobody in the
agent-framework space has. See `runStream({ liveContext })` below for the
full recipe. tl;dr: sources publish into facts; `liveContext` re-renders
the agent's system prompt on each change AND can interrupt the stream
when conditions warrant.

### "I want to bridge a callback-based SDK into Directive"

Wrap the SDK's `subscribe()` / `on('event')` API inside `attach(publish)`,
forward the unsubscribe. Direct generalization of the source primitive —
no AI-specific machinery required.

### "I want to multiplex agent messages into the system"

Use `createMessageBus` from `@directive-run/ai/communication` for
per-agent messaging. The bus is a conversation-tier subscription (tier 2
above), not a source. Wire it inside the orchestrator's constructor.

---

## `runStream({ liveContext })` — Reactive Agents

> The killer demo: the agent is mid-generation, a source publishes a fact
> update, the agent's NEXT token reflects the new state — or interrupts
> the stream and re-prompts with fresh context. No external orchestration
> required.

### When to use

- A market-data agent whose recommendation depends on live prices.
- A coding agent reviewing a PR while commits keep landing.
- A customer-support agent whose context updates when Stripe confirms a
  refund mid-conversation.

### Signature

```ts
const result = orchestrator.runStream(agent, input, {
  signal,                                     // existing AbortSignal — terminates stream
  liveContext: {
    system,                                   // the Directive system whose facts feed the agent
    keys: ["pr.headSha", "pr.state"],         // REQUIRED — fact keys to watch
    interruptWhen: (facts, changedKeys) => boolean,  // optional; default: () => true
    notifyOn: "interrupt-only",               // default; "all-changes" emits chunk per watched change
    onContextUpdate: (changedKeys) => void,   // optional logging hook
  },
});

// New methods on the returned result:
result.interrupt(reason?);  // cancel in-flight LLM run, KEEP liveContext alive
result.abort();             // tear down stream + detach liveContext
```

Two new chunk variants land on the stream:

```ts
| { type: "context_updated"; changedKeys: readonly string[] }
| {
    type: "interrupted";
    reason: string;
    partialOutput: string;
    changedKeys: readonly string[];
  }
```

### Anatomy

- The orchestrator subscribes to `system.facts.$store.subscribe(keys, ...)`
  for the keys it depends on — the same bridge primitive that powers
  breakpoints and approvals elsewhere in `agent-orchestrator.ts`.
- The subscription wires up BEFORE the LLM run's IIFE starts, so a fact
  change during the input-guardrail phase is observed correctly.
- On each batch of fact changes that touches the watched keys:
  - `liveContext.onContextUpdate(changedKeys)` fires (logging hook).
  - `interruptWhen(facts, changedKeys)` runs.
  - If it returns `true`, the orchestrator emits an `interrupted` chunk
    with the partial output captured so far + the changed keys, then
    aborts the in-flight LLM stream. The consumer's `for await` sees
    the `interrupted` chunk before the final `error` chunk lands.
  - If it returns `false` and `notifyOn === "all-changes"`, a
    `context_updated` chunk is emitted. With the default
    `"interrupt-only"`, no chunk is emitted for non-interrupting
    changes.
- `result.interrupt(reason?)` is the CALLER-driven counterpart: same
  `interrupted` chunk, same abort, but the subscription stays attached
  so the next caller-driven `runStream` continues against the live
  fact stream without re-subscribing.

### Status — shipped

`runStream({ liveContext })` is the dedicated subject of
[RFC 0005](../../docs/rfcs/0005-live-context-agent.md). Today's
implementation is **231 LOC in `agent-orchestrator.ts`** — under the
RFC's 300-LOC scope guard. Behavior is **abort-and-emit**: when
`interruptWhen` returns `true`, the orchestrator aborts the in-flight
LLM run and emits an `interrupted` chunk with the partial output; the
caller resumes by issuing a fresh `runStream` against the still-live
subscription (or fully tears down via `result.abort()`). Automatic
re-invocation (the "restart" semantic the original RFC drafted) is
reserved for a follow-up RFC + field — the original `mode` field was
removed before release because the impl never read it.

**Security companion (mandatory when watched facts may carry PII):**
wire `createFactPIIGuardrail` on the same Directive system. Without
it, `liveContext` expands the source → fact → prompt PII bypass
surface into mid-stream context updates. See the
["Sources × Security"](#sources--security) section below for the full
threat model.

---

## MCP Lifecycle as a Source

`@directive-run/ai/mcp` exposes `MCPAdapterConfig.events`
(`onConnect`, `onDisconnect`, `onToolCall`, `onError`, ...) as a single
bag of callbacks set at adapter-construction time. To bridge the
adapter's lifecycle into a Directive source the recipe is: declare a
holder that the source's `attach` populates with the live `publish`,
then point the adapter's `events.onConnect` / `onDisconnect` at the
holder. The holder pattern lets you construct the adapter and the
source in either order — the source's mount/unmount drives which
publish closure (if any) receives lifecycle events.

> **Multi-tenant safety.** If you import the module that owns the
> holder from two places (e.g., a Worker that mounts one Directive
> system per tenant DO), a module-level `let publishRef` would be
> SHARED — the second tenant's `attach` would silently overwrite the
> first tenant's pipe. **Always declare the holder + adapter inside a
> factory function** so each call yields an isolated closure pair.
> The recipe below uses `makeOrchestrator(adapter)` for exactly this
> reason; if you create the adapter outside the factory, pass it in
> per call too.

```ts
import { createSystem, createModule, t } from "@directive-run/core";
import type { SourcePublish } from "@directive-run/core";
import { createMCPAdapter } from "@directive-run/ai/mcp";

// Factory closure — each call yields a fresh `(adapter, module)`
// pair with its own `publishRef`. Multi-tenant safe; SSR / Vitest
// hot-reload safe; one tenant's MCP traffic can never leak into
// another tenant's facts.
function makeOrchestrator() {
  let publishRef: SourcePublish | null = null;

  const adapter = createMCPAdapter({
    servers: [/* ... */],
    events: {
      onConnect: (name) => publishRef?.("MCP_SERVER_CONNECTED", { name }),
      onDisconnect: (name) =>
        publishRef?.("MCP_SERVER_DISCONNECTED", { name }),
    },
  });

  const orchestrator = createModule("orchestrator", {
    schema: {
      facts: {
        mcp: t.object<{
          servers: Record<string, "connected" | "disconnected">;
        }>(),
      },
      events: {
        MCP_SERVER_CONNECTED: { name: t.string() },
        MCP_SERVER_DISCONNECTED: { name: t.string() },
      },
      derivations: {
        allServersHealthy: t.boolean(),
      },
    },
    init: (f) => {
      f.mcp = { servers: {} };
    },
    events: {
      MCP_SERVER_CONNECTED: (f, p) => {
        f.mcp = {
          ...f.mcp,
          servers: { ...f.mcp.servers, [p.name]: "connected" },
        };
      },
      MCP_SERVER_DISCONNECTED: (f, p) => {
        f.mcp = {
          ...f.mcp,
          servers: { ...f.mcp.servers, [p.name]: "disconnected" },
        };
      },
    },
    derive: {
      allServersHealthy: (facts) =>
        Object.values(facts.mcp.servers).every((s) => s === "connected"),
    },
    sources: {
      mcpLifecycle: {
        attach: (publish) => {
          publishRef = publish;
          // Kick the adapter's connection lifecycle once the source is
          // attached so the first `onConnect` flows into our publish.
          void adapter.connect();
          return async () => {
            publishRef = null;
            await adapter.disconnect();
          };
        },
      },
    },
  });

  return { orchestrator, adapter };
}

// Per-tenant / per-request usage:
const { orchestrator, adapter } = makeOrchestrator();
const system = createSystem({ module: orchestrator });
```

Constraints can now gate agent execution on
`facts.allServersHealthy` — no separate health-check loop needed.

> The holder + closure pattern is the canonical bridge from any
> single-callback-bag third-party SDK (MCP, telemetry SDKs that take an
> `onEvent` config at construction) into a Directive source. The
> alternative — passing `publish` from inside `attach` into the
> adapter's events — requires the adapter to be constructed AFTER the
> source is created, which is awkward when the adapter is used outside
> Directive too.

---

## Sources × Security

> A source can publish PII into a fact BEFORE any input guardrail runs.
> The pattern is real and exploitable. ALWAYS wire `createFactPIIGuardrail`
> when sources feed facts the agent will reason over.

### The bypass chain

1. Source wraps Supabase realtime: `subscribe('users', row => publish('USER_UPDATED', { email: row.email, ssn: row.ssn }))`.
2. Event handler writes: `f.email = payload.email; f.ssn = payload.ssn;`.
3. Agent prompt template embeds: `"Hello ${facts.email}, your record shows ${facts.ssn}..."`.
4. `createPIIGuardrail` (input guardrail) only inspects the `input` argument
   passed to `runStream(agent, input, ...)`. The facts injected into the
   prompt are **not in `input`** — they flow through the resolver's
   templating layer.
5. The LLM call ships the PII. The audit ledger's `fact.change` entry
   carries it. Devtools / breakpoint snapshots see it. Operators see it.

### The fix — `createFactPIIGuardrail`

A Directive plugin that scans every write to a `pii`-tagged fact and
either redacts (default) or alerts:

```ts
import { createSystem } from "@directive-run/core";
import { createFactPIIGuardrail } from "@directive-run/ai/guardrails";

const system = createSystem({
  module: customer,                 // schema tags `email` + `ssn` with `tags: ['pii']`
  plugins: [
    createFactPIIGuardrail({
      mode: "redact",               // 'redact' (default) | 'alert'
      types: ["ssn", "credit_card", "email"],
      onBlocked: (key, detected) => {
        Sentry.captureMessage(`pii redacted: ${key}`, { extra: { count: detected.length } });
      },
    }),
  ],
});
```

**Modes:**

- `"redact"` (default, safest): rewrites the fact value via a follow-up
  store write. The raw value briefly exists for one microtask while the
  redaction lands; downstream subscribers that snapshot at that instant
  see it; the LLM call after the next settle does not.
- `"alert"`: fires `onBlocked` but does NOT mutate the fact. Use for
  monitoring-only deployments where the source's transport is already
  trusted and you want to page on every match without modifying state.

The plugin scans `pii`-tagged facts auto-detected via `meta.byTag("pii")`,
plus any `includeKeys` you list explicitly. The built-in regex matches
SSN, credit card, and email; pass a `customDetector` for domain-specific
patterns (internal account numbers, partner IDs).

### Limitation — hard rejection needs an RFC

Plugin hooks (`onFactSet`, `onFactsBatch`) are wrapped by the plugin
manager's `safeCall`, so a `throw` from the guardrail can't actually
reject the write. The `"redact"` mode handles this with a follow-up write;
the `"alert"` mode is observation-only. Hard rejection at the publish
boundary requires a pre-commit transform hook on the source primitive
itself — that's tracked as a future RFC. For now: wire `"redact"` for
safety, `"alert"` for monitoring.

See also: [`ai-security.md`](./ai-security.md) — "Sources × PII" section
for the full threat model and the additional output-side mitigations
that should accompany this plugin in regulated deployments.

---

## Adapter packages

The canonical bridges live in **`@directive-run/sources`** as subpath
exports. One install, optional peerDependencies per vendor.

| Subpath | Source factory | Wraps |
|---|---|---|
| `@directive-run/sources/supabase` | `sourceFromSupabaseChannel()` | Supabase realtime channel |
| `@directive-run/sources/cloudflare` | `sourceFromDOAlarm()` | Cloudflare Durable Object alarm |
| `@directive-run/sources/cloudflare` | `sourceFromWebSocketMessage()` | Cloudflare Durable Object WebSocket message stream |
| `@directive-run/sources/websocket` | `sourceFromWebSocket()` | (future RFC) raw browser / Node WebSocket |
| `@directive-run/sources/sentry` | `sourceFromSentryHook()` | (future RFC) Sentry production-error stream |

Install only the umbrella; the vendor peerDeps are optional and pull in
only when the corresponding subpath is imported.

---

## Anti-patterns

### Anti-pattern A — Don't use a source for token streaming

LLM tokens are a per-generation hot stream. Wrap them in an
`AsyncIterable` (the existing `runStream` contract), not a source.

```ts
// WRONG — sources are mount-once; tokens are per-call
sources: {
  llmTokens: {
    attach: (publish) => {
      const stream = openai.chat.completions.create({ stream: true });
      for await (const chunk of stream) {
        publish("TOKEN", { content: chunk.choices[0].delta.content });
      }
      return () => stream.abort();
    },
  },
},

// RIGHT — tokens flow through the runStream AsyncIterable
const result = orchestrator.runStream(agent, input);
for await (const chunk of result.stream) {
  if (chunk.type === "token") render(chunk.content);
}
```

The rule: **source per connection; AsyncIterable per generation.**

### Anti-pattern B — Don't poll an external system from a constraint

Constraints model declarative when-then rules over facts. A
`setInterval` inside a constraint smuggles a long-running subscription
into a non-lifecycle hook.

```ts
// WRONG — constraint kicks off polling that lives forever
constraints: {
  pollLatest: {
    when: (facts) => true,
    require: { type: "POLL_INVENTORY" },
  },
},
resolvers: {
  pollInventory: {
    requirement: "POLL_INVENTORY",
    resolve: async (req, context) => {
      setInterval(async () => {
        const latest = await fetch("/api/inventory");
        context.facts.inventory = await latest.json();
      }, 5000);
    },
  },
},

// RIGHT — declare a source; the engine owns the lifecycle
sources: {
  inventoryPoll: {
    attach: (publish) => {
      const id = setInterval(async () => {
        const latest = await fetch("/api/inventory");
        publish("INVENTORY_LATEST", await latest.json());
      }, 5000);
      return () => clearInterval(id);
    },
  },
},
```

---

## Related

- [`../core/sources.md`](../core/sources.md) — full source primitive semantics, lifecycle, recipes
- [`ai-security.md`](./ai-security.md) — PII detection, prompt-injection, output guardrails (see "Sources × PII" section)
- [`ai-orchestrator.md`](./ai-orchestrator.md) — `createAgentOrchestrator` + `runStream`
- [`ai-mcp-rag.md`](./ai-mcp-rag.md) — MCP adapter
- [`ai-communication.md`](./ai-communication.md) — agent message bus + PubSub
