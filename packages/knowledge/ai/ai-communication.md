# AI inter-agent communication

`createMessageBus` for typed pub/sub, `createAgentNetwork` for capability-based discovery and request/response patterns, plus the scratchpad and cross-agent state access available via a multi-agent orchestrator. Import from `@directive-run/ai`.

## Decision tree

```
What do you need?
├── Typed pub/sub between agents          → createMessageBus(config?)
├── Capability lookup + request/response  → createAgentNetwork({ bus, agents? })
├── Per-pattern ephemeral state           → context.scratchpad inside tasks/agents
├── Reading another agent's facts         → orchestrator.system.facts[agentId].x
└── Cross-agent derived state             → orchestrator.system.derive[agentId].x
```

## `createMessageBus(config?)`

Fire-and-forget pub/sub keyed by `agentId`. `publish()` is synchronous — it returns the message id before delivery completes. Use `onDelivery` / `onDeliveryError` in config to observe delivery status.

```typescript
import { createMessageBus, type TypedAgentMessage } from "@directive-run/ai";

const bus = createMessageBus({
  maxHistory: 1000,
  defaultTtlMs: 60 * 60 * 1000,
  maxPendingPerAgent: 100,
  onDelivery:      (msg, recipients) => log("delivered", msg.id, recipients),
  onDeliveryError: (msg, error) => log("delivery_failed", msg.id, error.message),
});

// Subscribe — returns a Subscription object with an .unsubscribe() method
const sub = bus.subscribe("writer", (message: TypedAgentMessage) => {
  console.log(`writer received: ${message.type}`);
});

// Later
sub.unsubscribe();

// Publish — returns the message id (sync)
const id = bus.publish({
  type: "DELEGATION",
  from: "researcher",
  to: "writer",
  task: "Summarize the findings",
  context: { sources: 12 },
});

// Inspect
bus.getHistory({ from: "researcher" }, 50);
bus.getMessage(id);
bus.getPending("writer"); // messages queued for an offline subscriber

bus.clear();
bus.destroy();
```

There is no `bus.request(...)` method — request/response lives on the AgentNetwork (next section).

## `createAgentNetwork({ bus, agents? })`

Wraps a MessageBus with registry, capability lookup, and request/response patterns. **Capability lookup returns `AgentInfo[]`, not `string[]`.** Request/response shapes — `request`, `delegate`, `query`, `broadcast`, `listen`, `send` — are all on the network, NOT on the bus.

```typescript
import { createAgentNetwork, type AgentInfo } from "@directive-run/ai";

const network = createAgentNetwork({
  bus,
  agents: {
    researcher: { capabilities: ["search", "verify", "cite"] },
    writer:     { capabilities: ["draft", "edit", "summarize"] },
    analyst:    { capabilities: ["analyze", "chart", "report"] },
  },
  defaultTimeout: 30_000,
  onAgentOnline:  (id) => log(`${id} online`),
  onAgentOffline: (id) => log(`${id} offline`),
});

// Find — returns AgentInfo[], not string[]
const verifiers: AgentInfo[] = network.findByCapability("verify");
verifiers.forEach((info) => console.log(info.id, info.capabilities));

// Request/response with timeout
const reply = await network.request("coordinator", "researcher", "verify-claim", {
  claim: "GPT-4 has 1.8T parameters",
}, 10_000);
console.log(reply.payload);

// Delegate a task and await its result
const result = await network.delegate(
  "coordinator",
  "writer",
  "Draft a 200-word summary",
  { source: reply.payload },
);

// Question / answer
const answer = await network.query("coordinator", "analyst", "What's the median latency?", { window: "24h" });

// Broadcast to all agents
network.broadcast("coordinator", { type: "INFORM", content: "Cache cleared" });

// Plain fire-and-forget through the network (returns message id)
network.send("coordinator", "writer", { type: "INFORM", content: "Starting batch" });

// Subscribe an agent — same as bus.subscribe but registered through the network
const sub = network.listen("writer", (msg) => console.log(msg.type));
sub.unsubscribe();

network.destroy();
```

There is no `network.route(capability, payload)` — pick the agent yourself via `findByCapability(...)`, then call `request` / `delegate` against the chosen `agent.id`.

```typescript
const candidates = network.findByCapability("verify");
if (candidates.length === 0) throw new Error("no verifier available");
const target = candidates[0];

const result = await network.request("coordinator", target.id, "verify", { claim });
```

## Cross-agent state via facts + derivations

Each agent in a multi-agent orchestrator becomes a namespaced module, so its facts and derivations are readable on `orchestrator.system`.

```typescript
const orchestrator = createMultiAgentOrchestrator({
  agents: { researcher, writer },
  runner,
});

orchestrator.start();

// Read another agent's namespaced state (read-only outside its own resolvers)
const status   = orchestrator.system.facts.researcher.status;
const output   = orchestrator.system.facts.writer.output;
const isReady  = orchestrator.system.derive.researcher.isComplete;
```

For a deeper treatment of multi-module fact access + cross-module dependencies, see `multi-module.md`.

## Scratchpad — per-pattern ephemeral state

The scratchpad is a read-only context object shared across tasks/agents inside a single pattern execution. **You cannot mutate `context.scratchpad` directly** — pass updates back through the task's return value, or use `network.send` / `bus.publish` for messages that outlive the pattern.

```typescript
tasks: {
  gather: {
    run: async (input, signal, context) => {
      // context.scratchpad is Readonly — do NOT do context.scratchpad.x = …
      const seed = context.scratchpad.seed;
      return JSON.stringify({ seed, data: await fetchData(seed) });
    },
  },
  format: {
    run: async (input, signal, context) => {
      // Read scratchpad written by the pattern config
      const region = context.scratchpad.region;
      const parsed = JSON.parse(input);
      return JSON.stringify({ ...parsed, region });
    },
  },
},
```

For full task surface, see `ai-tasks.md`.

## Message bus + orchestrator wiring

The orchestrator does NOT accept a `bus:` option directly — wire the bus alongside the orchestrator and route messages explicitly.

```typescript
import { createMultiAgentOrchestrator } from "@directive-run/ai/multi-agent";
import { createMessageBus, createAgentNetwork } from "@directive-run/ai";

const bus = createMessageBus({ maxHistory: 1000 });
const network = createAgentNetwork({
  bus,
  agents: {
    researcher: { capabilities: ["search", "verify"] },
    writer:     { capabilities: ["draft", "edit"] },
  },
});

const orchestrator = createMultiAgentOrchestrator({
  agents: { researcher, writer },
  runner,
  hooks: {
    onAgentStart: (e) => {
      bus.publish({
        type: "AGENT_START",
        from: "orchestrator",
        to: e.agentName,
        input: e.input,
      });
    },
  },
});

orchestrator.start();

// External systems can publish to the bus directly
bus.publish({
  type: "INFORM",
  from: "external-pipeline",
  to: "researcher",
  content: "New corpus available",
});
```

## Anti-patterns

### `bus.request(...)`

```typescript
// WRONG — there is no request method on MessageBus
const reply = await bus.request({ type: "REQUEST", from: "a", to: "b", action: "verify", timeout: 10_000 });

// CORRECT — request/response is on AgentNetwork
const reply = await network.request("a", "b", "verify", { /* payload */ }, 10_000);
```

### `const unsub = bus.subscribe(...); unsub();`

```typescript
// WRONG — subscribe returns a Subscription object, not the unsubscribe function
const unsub = bus.subscribe("writer", handler);
unsub();

// CORRECT — call .unsubscribe() on the returned Subscription
const sub = bus.subscribe("writer", handler);
sub.unsubscribe();
```

### `network.findByCapability(...)` returning strings

```typescript
// WRONG — assumes the return is string[]
const writers = network.findByCapability("draft"); // ["writer"]?
network.send("coordinator", writers[0], message);   // passes a string where AgentInfo was expected? No — but we lost capabilities/metadata

// CORRECT — it returns AgentInfo[]; use .id when you need the string
const candidates = network.findByCapability("draft");
network.send("coordinator", candidates[0].id, message);
```

### `network.route(capability, payload)`

```typescript
// WRONG — no such method
await network.route("verify", { claim });

// CORRECT — pick an agent via findByCapability, then request/delegate
const verifiers = network.findByCapability("verify");
if (verifiers.length === 0) throw new Error("no verifier");
const result = await network.request("coordinator", verifiers[0].id, "verify", { claim });
```

### `createMultiAgentOrchestrator({ bus })`

```typescript
// WRONG — bus is not an option on MultiAgentOrchestratorOptions
createMultiAgentOrchestrator({ agents, runner, bus })

// CORRECT — wire the bus separately and publish through hooks/handlers
createMultiAgentOrchestrator({
  agents,
  runner,
  hooks: {
    onAgentComplete: (e) => bus.publish({ type: "AGENT_COMPLETE", from: "orchestrator", to: e.agentName, output: e.output }),
  },
});
```

### Mutating `context.scratchpad`

```typescript
// WRONG — context.scratchpad is Readonly
context.scratchpad.researchData = data;
context.scratchpad.timestamp = Date.now();

// CORRECT — return new state from the task; or use bus.publish to broadcast
return JSON.stringify({ ...JSON.parse(input), researchData: data, timestamp: Date.now() });
```

## Quick reference

| API | Purpose | Notes |
|---|---|---|
| `createMessageBus(config?)` | Pub/sub primitive | `publish` / `subscribe` / `getHistory` / `getMessage` / `getPending` / `clear` / `destroy` |
| `bus.subscribe(id, handler, filter?)` | Subscribe | returns a `Subscription` — call `sub.unsubscribe()` |
| `createAgentNetwork({ bus, agents? })` | Capability-aware coordination | `request` / `delegate` / `query` / `broadcast` / `send` / `listen` / `findByCapability` |
| `network.findByCapability(cap)` | Discovery | returns `AgentInfo[]` (NOT `string[]`) |
| `network.request(from, to, action, payload, timeout?)` | Request/response | `Promise<ResponseMessage>` |
| `network.delegate(from, to, task, context)` | Delegated task with result | `Promise<DelegationResultMessage>` |
| `orchestrator.system.facts[agentId].x` | Cross-agent fact read | each agent is a namespaced module |
| `context.scratchpad` | Per-pattern ephemeral state | Readonly inside tasks/agents |
