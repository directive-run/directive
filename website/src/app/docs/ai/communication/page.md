---
title: Communication
description: Decentralized agent-to-agent messaging with message bus, agent network, and communication patterns.
---

Message bus, agent network, and structured communication patterns for decentralized agent coordination. {% .lead %}

For centralized orchestration, use [Execution Patterns](/docs/ai/patterns). For decentralized coordination where agents communicate directly, use the message bus and agent network.

---

## Message Bus

The low-level pub/sub transport for agent-to-agent messaging:

```typescript
import { createMessageBus } from '@directive-run/ai';
import type { MessageBus, TypedAgentMessage } from '@directive-run/ai';

const bus = createMessageBus({
  maxHistory: 1000,
  defaultTtlMs: 3600000,       // 1 hour message TTL
  maxPendingPerAgent: 100,
  onDelivery: (message, recipients) => {
    console.log(`Delivered ${message.type} to ${recipients.join(', ')}`);
  },
  onDeliveryError: (message, error) => {
    console.error(`Failed to deliver ${message.id}:`, error);
  },
});
```

### Publishing and Subscribing

```typescript
// Subscribe with filters
const sub = bus.subscribe('writer', (message) => {
  console.log(`Writer received: ${message.type} from ${message.from}`);
}, {
  types: ['DELEGATION', 'REQUEST'],
  from: ['researcher'],
  priority: ['high', 'urgent'],
});

// Publish a message
const messageId = bus.publish({
  type: 'DELEGATION',
  from: 'researcher',
  to: 'writer',
  task: 'Write a summary',
  context: { data: '...' },
  priority: 'high',
});

// Query history
const history = bus.getHistory({ types: ['DELEGATION'] }, 50);
const specific = bus.getMessage(messageId);
const pending = bus.getPending('offline-agent');

// Cleanup
sub.unsubscribe();
bus.dispose();
```

### Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxHistory` | `number` | &ndash; | Messages to retain in history |
| `defaultTtlMs` | `number` | &ndash; | Default message time-to-live (ms) |
| `maxPendingPerAgent` | `number` | &ndash; | Queue cap for offline agents |
| `persistence` | `MessagePersistence` | &ndash; | Storage backend for durability |
| `onDelivery` | `(message, recipients) => void` | &ndash; | Delivery confirmation callback |
| `onDeliveryError` | `(message, error) => void` | &ndash; | Delivery error callback |

### Message Queuing

When a recipient has no active subscription, messages are queued (up to `maxPendingPerAgent`). Queued messages are delivered immediately when the agent subscribes. Expired messages (past `ttlMs`) are skipped during delivery.

### Persistence

Plug in your own persistence layer to survive restarts:

```typescript
const bus = createMessageBus({
  persistence: {
    save: async (message) => { await db.insert('messages', message); },
    load: async (agentId, since) => { return db.query('messages', { to: agentId, after: since }); },
    delete: async (messageId) => { await db.delete('messages', messageId); },
    clear: async (agentId) => { await db.deleteAll('messages', agentId); },
  },
});
```

---

## Message Types

Every message has `id`, `from`, `to` (single agent, array, or `"*"` for broadcast), `timestamp`, optional `correlationId` for request-response matching, optional `priority`, and optional `ttlMs`.

| Type | Description |
|------|-------------|
| `REQUEST` | Ask another agent to perform an action |
| `RESPONSE` | Reply to a request |
| `DELEGATION` | Delegate a task with context and constraints |
| `DELEGATION_RESULT` | Result of a delegated task with metrics |
| `QUERY` | Ask for information |
| `INFORM` | Share information (fire-and-forget) |
| `SUBSCRIBE` | Subscribe to topic updates |
| `UNSUBSCRIBE` | Unsubscribe from topics |
| `UPDATE` | Push update to subscribers |
| `ACK` / `NACK` | Acknowledgment / rejection |
| `PING` / `PONG` | Health check |
| `CUSTOM` | Custom message type |

---

## Agent Network

Higher-level coordination built on the message bus with structured request-response, delegation, and capability-based discovery:

```typescript
import { createAgentNetwork, createMessageBus } from '@directive-run/ai';
import type { AgentNetwork } from '@directive-run/ai';

const network = createAgentNetwork({
  bus: createMessageBus(),
  agents: {
    researcher: { capabilities: ['search', 'summarize'] },
    writer: { capabilities: ['draft', 'edit'] },
    reviewer: { capabilities: ['review', 'approve'] },
  },
  defaultTimeout: 30000,
  onAgentOnline: (agentId) => console.log(`${agentId} connected`),
  onAgentOffline: (agentId) => console.log(`${agentId} disconnected`),
});
```

### Request-Response

```typescript
const answer = await network.request(
  'writer', 'reviewer',
  'check-accuracy',
  { paragraph: 'WebAssembly compiles to...' },
  15000  // timeout
);
console.log(answer.success, answer.result);
```

### Delegation

```typescript
const result = await network.delegate(
  'researcher', 'writer',
  'Write an article about AI safety',
  { research: findingsData }
);
console.log(result.success, result.metrics?.durationMs);
```

### Query

```typescript
const info = await network.query(
  'writer', 'reviewer',
  'Is this paragraph technically accurate?',
  { text: '...' }
);
```

### Fire-and-Forget

```typescript
network.send('researcher', 'writer', {
  type: 'INFORM',
  topic: 'research-complete',
  content: { documentId: 'doc-123' },
});
```

### Broadcast

```typescript
network.broadcast('system', {
  type: 'INFORM',
  topic: 'shutdown',
  content: { reason: 'maintenance' },
});
```

### Capability Discovery

```typescript
const writers = network.findByCapability('draft');
console.log(writers.map((a) => a.id));
```

### Dynamic Registration

```typescript
network.register('editor', { capabilities: ['proofread', 'format'] });
network.unregister('editor');
```

### Network API

| Method | Returns | Description |
|--------|---------|-------------|
| `register(id, info)` | `void` | Register an agent |
| `unregister(id)` | `void` | Remove an agent |
| `getAgent(id)` | `AgentInfo` | Get agent info |
| `getAgents()` | `AgentInfo[]` | List all agents |
| `findByCapability(cap)` | `AgentInfo[]` | Find by capability |
| `send(from, to, msg)` | `string` | Fire-and-forget message |
| `request(from, to, action, payload, timeout?)` | `Promise<ResponseMessage>` | Request-response |
| `delegate(from, to, task, context)` | `Promise<DelegationResultMessage>` | Delegation with metrics |
| `query(from, to, question, context?)` | `Promise<ResponseMessage>` | Query shorthand |
| `broadcast(from, msg)` | `string` | Broadcast to all |
| `listen(agentId, handler, filter?)` | `Subscription` | Listen for messages |
| `getBus()` | `MessageBus` | Access underlying bus |
| `dispose()` | `void` | Cleanup |

---

## Communication Patterns

Three pre-built patterns for common coordination strategies.

### Responder

Auto-handles incoming `REQUEST` messages and sends back `RESPONSE`:

```typescript
import { createResponder } from '@directive-run/ai';

const responder = createResponder(network, 'writer');

responder.onRequest('draft', async (payload) => {
  const draft = await generateDraft(payload.topic as string);

  return { success: true, result: draft };
});

responder.onRequest('edit', async (payload) => {
  const edited = await editDocument(payload.content as string);

  return { success: true, result: edited };
});

responder.offRequest('edit');
responder.dispose();
```

### Delegator

Auto-handles incoming `DELEGATION` messages and sends back `DELEGATION_RESULT` with metrics:

```typescript
import { createDelegator } from '@directive-run/ai';

const delegator = createDelegator(network, 'writer');

delegator.onDelegation(async (task, context) => {
  const start = Date.now();
  const result = await executeTask(task, context);

  return {
    success: true,
    result,
    metrics: {
      durationMs: Date.now() - start,
      tokensUsed: 500,
      cost: 0.003,
    },
  };
});

delegator.offDelegation();
delegator.dispose();
```

### Pub/Sub

Topic-based publish/subscribe using `SUBSCRIBE` and `UPDATE` messages:

```typescript
import { createPubSub } from '@directive-run/ai';

const pubsub = createPubSub(network, 'analyst');

const unsub = pubsub.subscribe(
  ['market-updates', 'alerts'],
  (topic, content) => {
    console.log(`[${topic}]`, content);
  }
);

pubsub.publish('market-updates', { price: 100, change: 5 });

unsub();
pubsub.dispose();
```

---

## Handoffs

Transfer work between agents in a multi-agent orchestrator with tracking:

```typescript
const research = await orchestrator.runAgent('researcher', 'What is Directive?');

const draft = await orchestrator.handoff(
  'researcher', 'writer',
  `Write an article based on this:\n\n${research.output}`,
  { sourceTokens: research.totalTokens }
);

const review = await orchestrator.handoff(
  'writer', 'reviewer',
  `Review this article:\n\n${draft.output}`
);
```

Each handoff gets a unique ID and fires `onHandoff` / `onHandoffComplete` hooks.

```typescript
const pending = orchestrator.getPendingHandoffs();
```

### Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `onHandoff` | `(request: HandoffRequest) => void` | &ndash; | Called when a handoff starts |
| `onHandoffComplete` | `(result: HandoffResult) => void` | &ndash; | Called when a handoff finishes |
| `maxHandoffHistory` | `number` | `1000` | Max completed handoff results to retain |

### Types

```typescript
interface HandoffRequest {
  id: string;
  fromAgent: string;
  toAgent: string;
  input: string;
  context?: Record<string, unknown>;
  requestedAt: number;
}

interface HandoffResult {
  request: HandoffRequest;
  result: RunResult<unknown>;
  completedAt: number;
}
```

---

## Next Steps

- [Multi-Agent Orchestrator](/docs/ai/multi-agent) &ndash; Setup and configuration
- [Execution Patterns](/docs/ai/patterns) &ndash; Parallel, sequential, supervisor, and more
- [Cross-Agent State](/docs/ai/cross-agent-state) &ndash; Shared derivations and scratchpad
