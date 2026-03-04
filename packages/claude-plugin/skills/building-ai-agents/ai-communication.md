# AI Communication

Cross-agent messaging, agent networks, shared state via derivations, scratchpad coordination, and handoff patterns.

## Decision Tree: "How do agents communicate?"

```
What kind of communication?
├── Fire-and-forget notification → bus.publish({ type: "INFORM", ... })
├── Request-response (await reply) → bus.request({ type: "REQUEST", ... })
├── Delegate work to another agent → bus.publish({ type: "DELEGATION", ... })
├── Subscribe to ongoing updates → bus.publish({ type: "SUBSCRIBE", ... })
│
How do agents share state?
├── Read another agent's facts → orchestrator.system.facts.agentName.key
├── Cross-agent derivations → orchestrator.derive.agentName.derivation
├── Ephemeral key-value store → context.scratchpad
│
How do agents hand off work?
├── One-time transfer → handoff pattern (DELEGATION + await DELEGATION_RESULT)
├── Ongoing collaboration → agent network with capabilities
└── Conditional routing → reroute in supervisor pattern
```

## Message Bus

The message bus enables structured communication between agents:

```typescript
import { createMessageBus } from "@directive-run/ai";

const bus = createMessageBus();
```

## Publishing Messages

```typescript
// Fire-and-forget notification
bus.publish({
  type: "INFORM",
  from: "researcher",
  to: "writer",
  content: "Found 5 relevant sources",
  metadata: { sourceCount: 5, topics: ["AI", "ML"] },
});

// Broadcast to all agents (omit "to")
bus.publish({
  type: "INFORM",
  from: "coordinator",
  content: "System entering maintenance mode",
});
```

## Request-Response Pattern

```typescript
// Send a request and await the response
const response = await bus.request({
  type: "REQUEST",
  from: "writer",
  to: "researcher",
  action: "verify_claim",
  payload: { claim: "Transformers were invented in 2017" },
  timeout: 5000, // Throws after 5s if no response
});

console.log(response.content); // "Verified: correct"
console.log(response.metadata); // { confidence: 0.95, source: "..." }
```

## Message Types

All 11 message types in the system:

| Type | Direction | Purpose |
|---|---|---|
| `REQUEST` | Agent-to-agent | Ask another agent to do something |
| `RESPONSE` | Agent-to-agent | Reply to a REQUEST |
| `DELEGATION` | Agent-to-agent | Hand off a task to another agent |
| `DELEGATION_RESULT` | Agent-to-agent | Return result of delegated work |
| `QUERY` | Agent-to-agent | Ask for information without side effects |
| `INFORM` | Agent-to-agent/all | Share information, no response expected |
| `SUBSCRIBE` | Agent-to-agent | Request ongoing updates on a topic |
| `UNSUBSCRIBE` | Agent-to-agent | Stop receiving updates |
| `UPDATE` | Agent-to-subscriber | Push update to a subscriber |
| `ACK` | Agent-to-agent | Acknowledge receipt |
| `NACK` | Agent-to-agent | Reject or refuse a message |

## Subscribing to Messages

```typescript
// Subscribe to all messages for an agent
const unsubscribe = bus.subscribe("writer", (message) => {
  switch (message.type) {
    case "INFORM":
      console.log(`Info from ${message.from}: ${message.content}`);
      break;
    case "REQUEST":
      // Handle and respond
      bus.publish({
        type: "RESPONSE",
        from: "writer",
        to: message.from,
        correlationId: message.id,
        content: "Done",
      });
      break;
  }
});

// Clean up
unsubscribe();
```

## Agent Network

Higher-level abstraction for capability-based agent discovery:

```typescript
import { createAgentNetwork } from "@directive-run/ai";

const network = createAgentNetwork({
  bus,
  agents: {
    researcher: {
      capabilities: ["search", "verify", "cite"],
    },
    writer: {
      capabilities: ["draft", "edit", "summarize"],
    },
    analyst: {
      capabilities: ["analyze", "chart", "report"],
    },
  },
});

// Find agents by capability
const writers = network.findByCapability("draft");
// ["writer"]

const verifiers = network.findByCapability("verify");
// ["researcher"]

// Route a request to the best agent for a capability
const result = await network.route("verify", {
  claim: "GPT-4 has 1.8T parameters",
});
```

## Cross-Agent State via Derivations

Agents can read each other's facts and derivations through the shared system:

```typescript
const orchestrator = createMultiAgentOrchestrator({
  agents: {
    researcher: {
      name: "researcher",
      instructions: "...",
      model: "claude-sonnet-4-5",
    },
    writer: {
      name: "writer",
      instructions: "...",
      model: "claude-sonnet-4-5",
    },
  },
  runner,
});

orchestrator.start();

// Read another agent's facts (read-only)
const researchStatus = orchestrator.system.facts.researcher.status;
const writerOutput = orchestrator.system.facts.writer.lastOutput;

// Cross-agent derivations react to fact changes
const isReady = orchestrator.system.derive.researcher.isComplete;
```

## Scratchpad Coordination

The scratchpad is an ephemeral key-value store scoped to a single pattern execution. Tasks and agents in the same pattern share it:

```typescript
// In a task – write to scratchpad
tasks: {
  gather: {
    run: async (input, context) => {
      const data = JSON.parse(input);
      context.scratchpad.researchData = data;
      context.scratchpad.timestamp = Date.now();

      return input;
    },
  },
  format: {
    run: async (input, context) => {
      // Read from scratchpad set by earlier task
      const data = context.scratchpad.researchData;
      const ts = context.scratchpad.timestamp as number;

      return JSON.stringify({ data, processedAt: ts });
    },
  },
},
```

## Handoff Patterns

### One-Time Delegation

```typescript
// Agent A delegates work to Agent B
bus.publish({
  type: "DELEGATION",
  from: "coordinator",
  to: "researcher",
  content: "Research the topic: quantum computing",
  metadata: { priority: "high", deadline: Date.now() + 60000 },
});

// Agent B returns the result
bus.publish({
  type: "DELEGATION_RESULT",
  from: "researcher",
  to: "coordinator",
  correlationId: originalMessage.id,
  content: "Research findings: ...",
  metadata: { sourcesFound: 12 },
});
```

### Supervisor Reroute

In a supervisor pattern, the supervisor can reroute work mid-execution:

```typescript
const managed = supervisor("editor", ["researcher", "writer"], {
  onReroute: (from, to, reason) => {
    console.log(`Rerouting from ${from} to ${to}: ${reason}`);
  },
});
```

## Message Bus with Orchestrator

```typescript
import { createMultiAgentOrchestrator, createMessageBus } from "@directive-run/ai";

const bus = createMessageBus();

const orchestrator = createMultiAgentOrchestrator({
  agents: { researcher, writer },
  runner,
  bus, // Attach the message bus
});

orchestrator.start();

// External systems can also publish to the bus
bus.publish({
  type: "INFORM",
  from: "external",
  to: "researcher",
  content: "New data available",
});
```

## Quick Reference

| API | Purpose | Key Options |
|---|---|---|
| `createMessageBus()` | Agent-to-agent messaging | subscribe, publish, request |
| `createAgentNetwork()` | Capability-based discovery | agents with capabilities |
| `bus.publish()` | Fire-and-forget message | type, from, to, content |
| `bus.request()` | Request-response with timeout | action, payload, timeout |
| `bus.subscribe()` | Listen for messages | agentName, callback |
| `network.findByCapability()` | Find agents by skill | capability string |
| `network.route()` | Route work to capable agent | capability, payload |
