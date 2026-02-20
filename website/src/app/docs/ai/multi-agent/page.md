---
title: Multi-Agent
description: Orchestrate multiple AI agents with parallel, sequential, and supervisor patterns, plus inter-agent communication.
---

Coordinate multiple agents with execution patterns, handoffs, communication channels, and result merging. {% .lead %}

The multi-agent orchestrator has **full feature parity** with the [single-agent orchestrator](/docs/ai/orchestrator): guardrails (orchestrator-level + per-agent), streaming, approval workflows, pause/resume, memory, hooks, retry, budget, plugins, time-travel debugging, constraints, and resolvers. Each registered agent becomes a namespaced module in a Directive System.

---

## Setup

Multi-agent orchestration builds on the [Agent Orchestrator](/docs/ai/orchestrator) adapter. Start by defining your agents and a run function, then register them in an orchestrator:

```typescript
import {
  createMultiAgentOrchestrator,
  createPIIGuardrail,
  parallel,
  sequential,
  supervisor,
  composePatterns,
  selectAgent,
  runAgentRequirement,
  findAgentsByCapability,
  capabilityRoute,
  concatResults,
  collectOutputs,
  pickBestResult,
  aggregateTokens,
} from '@directive-run/ai';
import type {
  AgentLike,
  AgentRunner,
  RunResult,
  AgentRegistration,
  MultiAgentOrchestrator,
} from '@directive-run/ai';

// Define specialized agents &ndash; each has a distinct role in the pipeline
const researcher: AgentLike = {
  name: 'researcher',
  instructions: 'You are a research assistant. Find relevant information on the given topic.',
  model: 'gpt-4',
};

const writer: AgentLike = {
  name: 'writer',
  instructions: 'You are a technical writer. Write clear, concise content from research notes.',
  model: 'gpt-4',
};

const reviewer: AgentLike = {
  name: 'reviewer',
  instructions: 'You review drafts for accuracy and clarity. Return "approve" or revision notes.',
  model: 'gpt-4',
};

// Wrap your LLM SDK in a standard runner function
const runner: AgentRunner = async (agent, input, options) => {
  // Your LLM SDK call — e.g. OpenAI, Anthropic, Ollama
  return { output: '...', totalTokens: 0 };
};
```

---

## Creating the Orchestrator

Register agents with concurrency limits, timeouts, capabilities, and per-agent guardrails. Optionally define reusable execution patterns:

```typescript
const orchestrator = createMultiAgentOrchestrator({
  runner,

  // Register each agent with its configuration
  agents: {
    researcher: {
      agent: researcher,
      maxConcurrent: 3,               // Allow 3 parallel research runs
      timeout: 30000,                  // 30s timeout per run
      capabilities: ['search', 'summarize'],
      description: 'Finds and summarizes information on any topic',
    },
    writer: {
      agent: writer,
      maxConcurrent: 1,               // Only one writer at a time
      timeout: 60000,
      guardrails: {                    // Per-agent output guardrails
        output: [createPIIGuardrail({ redact: true })],
      },
    },
    reviewer: {
      agent: reviewer,
      maxConcurrent: 1,
      timeout: 30000,
    },
  },

  // Define reusable execution patterns
  patterns: {
    // Fan out to 3 researchers, merge their outputs with a separator
    research: parallel(
      ['researcher', 'researcher', 'researcher'],
      (results) => concatResults(results, '\n\n---\n\n'),
      { minSuccess: 2 }               // Succeed if at least 2 of 3 complete
    ),

    // Writer drafts, then reviewer checks &ndash; output flows from one to the next
    writeAndReview: sequential(
      ['writer', 'reviewer'],
      {
        transform: (output, agentId) =>
          agentId === 'writer'
            ? `Review this draft for accuracy:\n\n${output}`
            : String(output),
      }
    ),
  },

  // Handoff lifecycle hooks
  onHandoff: (request) => {
    console.log(`Handoff: ${request.fromAgent} → ${request.toAgent}`);
  },
  onHandoffComplete: (result) => {
    console.log(`Handoff complete in ${result.completedAt - result.request.requestedAt}ms`);
  },

  // Bounded history &ndash; how many completed handoffs to retain (default: 1000)
  maxHandoffHistory: 500,
});
```

The orchestrator validates that all patterns reference registered agents at creation time. If a pattern references `'editor'` but no agent with that ID is registered, it throws immediately with a detailed error listing every unresolved reference.

### Configuration Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `runner` | `AgentRunner` | *required* | Base LLM execution function |
| `agents` | `AgentRegistry` | *required* | Map of agent ID to `AgentRegistration` |
| `patterns` | `Record<string, ExecutionPattern>` | `{}` | Named execution patterns |
| `guardrails` | `GuardrailsConfig` | &ndash; | Orchestrator-level input/output/toolCall guardrails (applied to all agents) |
| `hooks` | `MultiAgentLifecycleHooks` | &ndash; | Lifecycle hooks for observability |
| `memory` | `AgentMemory` | &ndash; | Shared memory across all agents |
| `agentRetry` | `AgentRetryConfig` | &ndash; | Default retry config for all agents (per-agent overrides this) |
| `maxTokenBudget` | `number` | &ndash; | Maximum token budget across all agent runs |
| `budgetWarningThreshold` | `number` | `0.8` | Fires `onBudgetWarning` when token usage reaches this fraction (0&ndash;1) of `maxTokenBudget` |
| `onBudgetWarning` | `(event) => void` | &ndash; | Callback when budget warning threshold is reached. Event: `{ currentTokens, maxBudget, percentage }` |
| `plugins` | `Plugin[]` | `[]` | Plugins to attach to the underlying Directive System |
| `onApprovalRequest` | `(request: ApprovalRequest) => void` | &ndash; | Callback for approval requests |
| `autoApproveToolCalls` | `boolean` | `true` | Auto-approve tool calls |
| `approvalTimeoutMs` | `number` | `300000` | Approval timeout (ms) |
| `constraints` | `Record<string, OrchestratorConstraint>` | &ndash; | Orchestrator-level constraints |
| `resolvers` | `Record<string, OrchestratorResolver>` | &ndash; | Orchestrator-level resolvers |
| `circuitBreaker` | `CircuitBreaker` | &ndash; | Orchestrator-level circuit breaker |
| `onHandoff` | `(request: HandoffRequest) => void` | &ndash; | Called when a handoff starts |
| `onHandoffComplete` | `(result: HandoffResult) => void` | &ndash; | Called when a handoff finishes |
| `maxHandoffHistory` | `number` | `1000` | Max completed handoff results to retain |
| `debug` | `boolean` | `false` | Enable debug logging and time-travel |

### Agent Registration

Each entry in the `agents` map is an `AgentRegistration`:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `agent` | `AgentLike` | *required* | The agent instance |
| `maxConcurrent` | `number` | `1` | Max parallel runs for this agent |
| `timeout` | `number` | &ndash; | Per-run timeout (ms) |
| `runOptions` | `Omit<RunOptions, 'signal'>` | &ndash; | Default run options (e.g. `onMessage`, `onToken`) |
| `description` | `string` | &ndash; | Human-readable description for constraint-based selection |
| `capabilities` | `string[]` | &ndash; | Capability tags for `selectAgent()` lookups |
| `guardrails.input` | `Array<GuardrailFn \| NamedGuardrail>` | &ndash; | Per-agent input guardrails (additive with orchestrator-level) |
| `guardrails.output` | `Array<GuardrailFn \| NamedGuardrail>` | &ndash; | Per-agent output guardrails (additive with orchestrator-level) |
| `guardrails.toolCall` | `Array<GuardrailFn \| NamedGuardrail>` | &ndash; | Per-agent tool call guardrails (additive with orchestrator-level) |
| `retry` | `AgentRetryConfig` | &ndash; | Per-agent retry config (overrides orchestrator-level `agentRetry`) |
| `constraints` | `Record<string, OrchestratorConstraint>` | &ndash; | Per-agent constraints |
| `resolvers` | `Record<string, OrchestratorResolver>` | &ndash; | Per-agent resolvers |
| `memory` | `AgentMemory` | &ndash; | Per-agent memory (overrides orchestrator-level `memory`) |
| `circuitBreaker` | `CircuitBreaker` | &ndash; | Per-agent circuit breaker (overrides orchestrator-level) |

---

## Running a Single Agent

The simplest operation &ndash; run one registered agent with concurrency control and timeouts handled automatically:

```typescript
const result = await orchestrator.runAgent<string>('researcher', 'What is WebAssembly?');

console.log(result.output);       // The agent's response
console.log(result.totalTokens);  // Token usage
```

If the researcher's `maxConcurrent: 3` slots are all occupied, the call waits until a slot opens. This uses an async semaphore internally &ndash; no polling, no busy-waiting.

You can pass `RunOptions` as the third argument to supply an `AbortSignal` for cancellation:

```typescript
const controller = new AbortController();
setTimeout(() => controller.abort(), 10000);

const result = await orchestrator.runAgent('researcher', 'Explain WASM', {
  signal: controller.signal,
});
```

External signals are combined with the per-agent `timeout` &ndash; whichever fires first aborts the run. Both are cleaned up properly to prevent memory leaks.

### `run()` and `runStream()` Aliases

For convenience, `run()` and `runStream()` are aliases for `runAgent()` and `runAgentStream()` respectively. They have identical signatures:

```typescript
const result = await orchestrator.run<string>('researcher', 'What is WebAssembly?');

const { stream } = orchestrator.runStream<string>('writer', 'Write about AI');
```

### `totalTokens` Getter

Read the cumulative token count across all agent runs at any time:

```typescript
await orchestrator.runAgent('researcher', 'Summarize this...');
await orchestrator.runAgent('writer', 'Write an article...');

console.log(orchestrator.totalTokens);  // e.g. 1250
```

---

## Parallel Execution

Run multiple agents at the same time and merge their results.

### Parallel Named Pattern

```typescript
// Execute the named "research" pattern &ndash; fans out to 3 researchers
const research = await orchestrator.runPattern<string>(
  'research',
  'Explain the benefits of constraint-driven architecture'
);
// Result is the concatenated outputs from all 3, separated by ---
```

### Using `runParallel` Directly

For one-off parallel runs without defining a pattern:

```typescript
// Broadcast the same input to multiple agents
const combined = await orchestrator.runParallel(
  ['researcher', 'researcher'],
  'What are WebSockets?',
  (results) => concatResults(results)
);

// Send different inputs to each agent in parallel
const answers = await orchestrator.runParallel(
  ['researcher', 'researcher', 'researcher'],
  ['Explain REST', 'Explain GraphQL', 'Explain gRPC'],
  (results) => collectOutputs(results)  // Returns string[]
);

// With minSuccess and timeout options
const tolerant = await orchestrator.runParallel(
  ['researcher', 'researcher', 'researcher'],
  'What are WebSockets?',
  (results) => concatResults(results),
  { minSuccess: 2, timeout: 15000 }
);
```

When passing an array of inputs, the count must match the agent count. If they don't match, the orchestrator throws immediately.

`runParallel` accepts an optional fourth argument with `minSuccess` and `timeout` options. These work identically to the `parallel()` pattern options but are applied inline without defining a named pattern.

### `parallel()` Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `minSuccess` | `number` | all | Minimum successful results required. Failed agents are silently caught when set |
| `timeout` | `number` | &ndash; | Overall timeout for the entire parallel batch (ms) |

When `minSuccess` is set, individual agent failures are caught silently. If fewer agents succeed than the threshold, the pattern throws:

```
[Directive MultiAgent] Parallel pattern: Only 1/3 agents succeeded (minimum required: 2, failed: 2)
```

---

## Sequential Pipelines

Chain agents so each one's output feeds into the next.

### Sequential Named Pattern

```typescript
const result = await orchestrator.runPattern<string>(
  'writeAndReview',
  'Write a guide to Directive multi-agent orchestration'
);
```

### Using `runSequential` Directly

```typescript
const results = await orchestrator.runSequential<string>(
  ['researcher', 'writer', 'reviewer'],
  'Create a blog post about AI safety',
  {
    // Shape how each agent's output becomes the next agent's input
    transform: (output, agentId, index) => {
      if (agentId === 'researcher') {
        return `Write a blog post based on this research:\n\n${output}`;
      }
      if (agentId === 'writer') {
        return `Review this blog post draft:\n\n${output}`;
      }

      return String(output);
    },
  }
);

// Each step's RunResult is available in the array
const finalReview = results[results.length - 1].output;
const totalTokens = aggregateTokens(results);
```

Without a `transform`, the output is stringified automatically (`string` values pass through; objects are `JSON.stringify`'d).

### `sequential()` Pattern Options

These options apply when defining a named pattern with `sequential()`. The `runSequential` method accepts only `transform`.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `transform` | `(output, agentId, index) => string` | auto-stringify | Transform each agent's output into the next agent's input |
| `extract` | `(output) => T` | identity | Extract the final result from the last agent's output (pattern definitions only, not `runSequential`) |
| `continueOnError` | `boolean` | `false` | Skip failed agents instead of aborting the pipeline |

By default, if any agent in the sequence fails the entire pipeline throws. Set `continueOnError: true` to skip failures:

```typescript
const pipeline = sequential(
  ['researcher', 'writer', 'reviewer'],
  { continueOnError: true }
);
```

---

## Supervisor Pattern

A supervisor agent delegates work to workers in a loop. The supervisor decides what to do next based on worker results:

```typescript
const manager: AgentLike = {
  name: 'manager',
  instructions: `You are a project manager. Analyze the request and delegate to workers.
    Respond with JSON: { "action": "delegate", "worker": "researcher"|"writer", "workerInput": "..." }
    Or when done: { "action": "complete", "output": "..." }`,
  model: 'gpt-4',
};

const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: {
    manager: { agent: manager, maxConcurrent: 1 },
    researcher: { agent: researcher, maxConcurrent: 3 },
    writer: { agent: writer, maxConcurrent: 1 },
  },

  patterns: {
    managed: supervisor('manager', ['researcher', 'writer'], {
      maxRounds: 5,    // Safety limit to prevent infinite delegation loops (default: 5)
      extract: (supervisorOutput, workerResults) => ({
        answer: supervisorOutput,
        sources: collectOutputs(workerResults),
        tokens: aggregateTokens(workerResults),
      }),
    }),
  },
});

const result = await orchestrator.runPattern('managed', 'Research and write about WASM');
```

### How the Loop Works

1. Runs the supervisor with the initial input
2. Parses the supervisor's output as JSON
3. If `{ action: "delegate", worker: "researcher", workerInput: "..." }` &ndash; runs that worker
4. Feeds the worker result back to the supervisor: `"Worker researcher completed with result: ..."`
5. Repeats until `{ action: "complete" }` or `maxRounds` is reached

The supervisor validates worker names against the registered workers list. If the supervisor attempts to delegate to an unregistered worker, the pattern throws immediately:

```
Invalid worker: unknown-agent
```

### `supervisor()` Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxRounds` | `number` | `5` | Maximum delegation rounds before stopping |
| `extract` | `(supervisorOutput, workerResults) => T` | identity | Extract the final result from supervisor output and all worker results |

---

## Handoffs

Transfer work from one agent to another with tracking. Unlike sequential pipelines, handoffs are explicit and support attached context:

```typescript
const research = await orchestrator.runAgent('researcher', 'What is Directive?');

// Handoff with optional context metadata
const draft = await orchestrator.handoff(
  'researcher', 'writer',
  `Write an article based on this research:\n\n${research.output}`,
  { sourceTokens: research.totalTokens }  // Attached context
);

const review = await orchestrator.handoff(
  'writer', 'reviewer',
  `Review this article:\n\n${draft.output}`
);
```

Each handoff gets a unique ID (`handoff-1`, `handoff-2`, ...) and fires the `onHandoff` / `onHandoffComplete` hooks. Query pending handoffs at any time:

```typescript
const pending = orchestrator.getPendingHandoffs();
console.log(`${pending.length} handoffs in flight`);
```

### Handoff Data Types

```typescript
interface HandoffRequest {
  id: string;                          // 'handoff-1', 'handoff-2', ...
  fromAgent: string;
  toAgent: string;
  input: string;
  context?: Record<string, unknown>;   // Optional attached metadata
  requestedAt: number;                 // Date.now() timestamp
}

interface HandoffResult {
  request: HandoffRequest;
  result: RunResult<unknown>;
  completedAt: number;
}
```

Completed handoff results are retained up to `maxHandoffHistory` (default: 1000). Oldest results are evicted when the limit is exceeded.

---

## Constraint-Driven Agent Selection

Use Directive constraints to automatically route work to the right agent based on runtime state:

### `selectAgent` Helper

```typescript
import { selectAgent } from '@directive-run/ai';

// Route complex queries to the expert agent
const routeToExpert = selectAgent(
  (facts) => facts.complexity > 0.8,      // When condition
  'expert',                                // Agent to select (string or function)
  (facts) => String(facts.query),          // Input to send (string or function)
  100                                       // Optional priority
);

// Dynamic agent selection based on facts
const dynamicRoute = selectAgent(
  (facts) => facts.needsProcessing === true,
  (facts) => facts.preferredAgent as string,   // Select agent dynamically
  (facts) => `Process this: ${facts.data}`
);
```

### `runAgentRequirement` Helper

Create `RUN_AGENT` requirements for use in Directive constraint definitions:

```typescript
import { runAgentRequirement } from '@directive-run/ai';

// Use in a Directive constraint definition
const constraints = {
  needsResearch: {
    when: (facts) => facts.hasUnknowns,
    require: runAgentRequirement('researcher', 'Find relevant data', {
      priority: 'high',
    }),
  },
};
```

The `RunAgentRequirement` type:

```typescript
interface RunAgentRequirement extends Requirement {
  type: 'RUN_AGENT';
  agent: string;
  input: string;
  context?: Record<string, unknown>;
}
```

### `findAgentsByCapability` Utility

Find agents in a registry that match all required capabilities. Returns an array of matching agent IDs:

```typescript
import { findAgentsByCapability } from '@directive-run/ai';

const agents = {
  researcher: { agent: researchAgent, capabilities: ['search', 'summarize'] },
  coder: { agent: coderAgent, capabilities: ['code', 'debug'] },
  writer: { agent: writerAgent, capabilities: ['write', 'edit'] },
};

const matches = findAgentsByCapability(agents, ['search']);
// Returns ['researcher']

const matches2 = findAgentsByCapability(agents, ['write', 'edit']);
// Returns ['writer']

const noMatches = findAgentsByCapability(agents, ['search', 'code']);
// Returns [] &ndash; no single agent has both
```

### `capabilityRoute` Utility

Create a constraint that automatically routes work to an agent based on capabilities. Combines `findAgentsByCapability` with constraint-driven selection:

```typescript
import { capabilityRoute } from '@directive-run/ai';

const routeByCapability = capabilityRoute(
  agents,
  (facts) => facts.requiredCapabilities as string[],
  (facts) => facts.query as string,
);
```

When multiple agents match, the first match is chosen by default. Use the `options.select` callback to implement custom tiebreaking:

```typescript
const routeWithTiebreaker = capabilityRoute(
  agents,
  (facts) => facts.requiredCapabilities as string[],
  (facts) => facts.query as string,
  {
    priority: 50,
    select: (matches, registry) => {
      // Pick the agent with the fewest capabilities (most specialized)
      return matches.reduce((best, id) => {
        const bestCaps = registry[best]?.capabilities?.length ?? 0;
        const currentCaps = registry[id]?.capabilities?.length ?? 0;

        return currentCaps < bestCaps ? id : best;
      });
    },
  }
);
```

The `capabilityRoute` function returns an `OrchestratorConstraint` &ndash; use it in the `constraints` option of `createMultiAgentOrchestrator`.

---

## Agent Communication

For decentralized agent coordination without a central orchestrator, use the message bus and agent network.

### Message Bus

The low-level pub/sub transport for agent-to-agent messaging:

```typescript
import { createMessageBus } from '@directive-run/ai';
import type { MessageBus, TypedAgentMessage } from '@directive-run/ai';

const bus = createMessageBus({
  maxHistory: 1000,            // Messages to retain in history
  defaultTtlMs: 3600000,      // 1 hour default message TTL
  maxPendingPerAgent: 100,     // Queue cap for offline agents
  onDelivery: (message, recipients) => {
    console.log(`Delivered ${message.type} to ${recipients.join(', ')}`);
  },
  onDeliveryError: (message, error) => {
    console.error(`Failed to deliver ${message.id}:`, error);
  },
});

// Subscribe to messages
const sub = bus.subscribe('writer', (message) => {
  console.log(`Writer received: ${message.type} from ${message.from}`);
}, {
  types: ['DELEGATION', 'REQUEST'],   // Filter by message type
  from: ['researcher'],                // Filter by sender
  priority: ['high', 'urgent'],        // Filter by priority
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
bus.dispose();  // Clears all subscriptions, history, and pending queues
```

#### Message Types

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

Every message has `id`, `from`, `to` (single agent, array, or `"*"` for broadcast), `timestamp`, optional `correlationId` for request-response matching, optional `priority`, and optional `ttlMs`. Expired messages are automatically skipped during delivery.

When a recipient has no active subscription, messages are queued (up to `maxPendingPerAgent`). Queued messages are delivered immediately when the agent subscribes.

#### Message Persistence

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

### Agent Network

Higher-level coordination built on the message bus with structured patterns like request-response, delegation, and capability-based discovery:

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

// Request-response (waits for correlated RESPONSE)
const answer = await network.request(
  'writer', 'reviewer',
  'check-accuracy',
  { paragraph: 'WebAssembly compiles to...' },
  15000   // Optional per-request timeout
);
console.log(answer.success, answer.result);

// Delegation (waits for correlated DELEGATION_RESULT with metrics)
const result = await network.delegate(
  'researcher', 'writer',
  'Write an article about AI safety',
  { research: findingsData }
);
console.log(result.success, result.metrics?.durationMs);

// Query (request-response shorthand for questions)
const info = await network.query(
  'writer', 'reviewer',
  'Is this paragraph technically accurate?',
  { text: '...' }
);

// Fire-and-forget notification
network.send('researcher', 'writer', {
  type: 'INFORM',
  topic: 'research-complete',
  content: { documentId: 'doc-123' },
});

// Broadcast to all agents
network.broadcast('system', {
  type: 'INFORM',
  topic: 'shutdown',
  content: { reason: 'maintenance' },
});

// Capability-based discovery
const writers = network.findByCapability('draft');
console.log(writers.map((a) => a.id));  // ['writer']

// Dynamic registration
network.register('editor', { capabilities: ['proofread', 'format'] });
network.unregister('editor');

// Cleanup
network.dispose();
```

---

## Communication Patterns

Three pre-built patterns for common agent coordination strategies:

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

// Remove a handler
responder.offRequest('edit');

// Cleanup
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

// Remove the handler
delegator.offDelegation();

// Cleanup
delegator.dispose();
```

### Pub/Sub

Topic-based publish/subscribe using `SUBSCRIBE` and `UPDATE` messages:

```typescript
import { createPubSub } from '@directive-run/ai';

const pubsub = createPubSub(network, 'analyst');

// Subscribe to topics (returns unsubscribe function)
const unsub = pubsub.subscribe(
  ['market-updates', 'alerts'],
  (topic, content) => {
    console.log(`[${topic}]`, content);
  }
);

// Publish to a topic (broadcasts UPDATE to all agents)
pubsub.publish('market-updates', { price: 100, change: 5 });

// Unsubscribe from specific topics
unsub();

// Cleanup
pubsub.dispose();
```

---

## Result Merging Utilities

Four built-in helpers for combining results from parallel runs:

```typescript
import {
  concatResults,
  collectOutputs,
  pickBestResult,
  aggregateTokens,
} from '@directive-run/ai';

// Join all string outputs with a separator (default: '\n\n')
const merged = concatResults(results, '\n\n---\n\n');

// Gather every output into a typed array
const outputs = collectOutputs(results);  // T[]

// Select the single best result using a custom scoring function
const best = pickBestResult(results, (r) => {
  return typeof r.output === 'string' ? r.output.length : 0;
});

// Sum token usage across every result
const totalTokens = aggregateTokens(results);
```

| Helper | Signature | Description |
|--------|-----------|-------------|
| `concatResults` | `(results, separator?) => string` | Concatenate outputs. Non-strings are `JSON.stringify`'d |
| `collectOutputs` | `(results) => T[]` | Collect all outputs into an array |
| `pickBestResult` | `(results, scoreFn) => RunResult<T>` | Pick the highest-scoring result. Throws if array is empty |
| `aggregateTokens` | `(results) => number` | Sum `totalTokens` across all results |

---

## Pattern Composition

Compose multiple patterns into a pipeline where each pattern's output feeds as input to the next. `composePatterns()` returns an async function `(orchestrator, input) => Promise<unknown>`:

```typescript
import { composePatterns, parallel, sequential, concatResults } from '@directive-run/ai';

// Build a two-stage workflow: parallel research, then sequential write + review
const workflow = composePatterns(
  parallel(['researcher', 'researcher'], (results) => concatResults(results)),
  sequential(['writer', 'reviewer']),
);

// Run the composed workflow
const result = await workflow(orchestrator, 'Research and write about AI safety');
```

Between patterns, output is automatically converted to a string input for the next pattern:
- `string` output passes through directly
- Objects are `JSON.stringify`'d

`composePatterns` requires at least one pattern. Supervisor patterns in a composed pipeline run the supervisor agent directly (without the full delegation loop).

---

## Concurrency Control

Each registered agent gets its own `Semaphore` instance based on `maxConcurrent`. The semaphore is queue-based (no polling):

```typescript
import { Semaphore } from '@directive-run/ai';

const sem = new Semaphore(3);  // 3 concurrent permits

const release = await sem.acquire();  // Waits if all 3 permits are taken
try {
  await doWork();
} finally {
  release();
}

// Inspect state
console.log(sem.available);  // Permits currently free
console.log(sem.waiting);    // Callers queued up
console.log(sem.max);        // Total permits (3)

// Reject all pending waiters and reset permits
sem.drain();
```

The `drain()` method is called automatically during `orchestrator.reset()` to reject any callers waiting for permits.

---

## Agent State

Track what each agent is doing:

```typescript
const state = orchestrator.getAgentState('researcher');
console.log(state.status);      // 'idle' | 'running' | 'completed' | 'error'
console.log(state.runCount);    // How many times this agent has run
console.log(state.totalTokens); // Cumulative token usage
console.log(state.lastInput);   // Last input string
console.log(state.lastOutput);  // Last output value
console.log(state.lastError);   // Last error message (if status is 'error')

// Iterate over all registered agents
const allStates = orchestrator.getAllAgentStates();
for (const [id, s] of Object.entries(allStates)) {
  console.log(`${id}: ${s.status} (${s.runCount} runs, ${s.totalTokens} tokens)`);
}
```

### Agent State Shape

```typescript
interface MultiAgentState {
  __agents: Record<string, {
    status: 'idle' | 'running' | 'completed' | 'error';
    lastInput?: string;
    lastOutput?: unknown;
    lastError?: string;
    runCount: number;
    totalTokens: number;
  }>;
  __handoffs: HandoffRequest[];
  __handoffResults: HandoffResult[];
}
```

### Pause & Resume

```typescript
// Pause all agent activity (e.g., user clicked "stop" or budget exceeded)
orchestrator.pause();

// Resume from where the orchestrator left off
orchestrator.resume();
```

When paused, subsequent `runAgent()` calls throw immediately. Budget limits also trigger automatic pausing via the built-in constraint.

### Wait for Idle

`waitForIdle()` returns a promise that resolves when every registered agent's status is `idle`, `completed`, or `error` (i.e., no agents are `running`). An optional timeout rejects the promise if agents are still busy:

```typescript
// Fire-and-forget several runs, then wait for all to finish
orchestrator.runAgent('researcher', 'Topic A');
orchestrator.runAgent('researcher', 'Topic B');
orchestrator.runAgent('writer', 'Draft article');

await orchestrator.waitForIdle();
console.log('All agents finished');

// With timeout — throws if agents are still running after 10s
await orchestrator.waitForIdle(10000);
```

If all agents are already idle when called, the promise resolves immediately.

### Reset and Dispose

```typescript
// Reset all agent states, drain semaphores, clear handoff history
orchestrator.reset();

// Reset + destroy the underlying Directive System
orchestrator.dispose();
```

`reset()` drains all semaphores (rejecting pending waiters with an error), resets every agent to `idle` with zero counts, and clears both pending and completed handoff lists.

---

## Dynamic Agent Management

Register and unregister agents at runtime with `registerAgent()`, `unregisterAgent()`, and `getAgentIds()`. Dynamically registered agents get full parity: their own Directive module, semaphore, constraints, resolvers, and guardrails.

```typescript
// Register a new agent after creation
const editor: AgentLike = {
  name: 'editor',
  instructions: 'You proofread and format documents.',
  model: 'gpt-4',
};

orchestrator.registerAgent('editor', {
  agent: editor,
  maxConcurrent: 2,
  timeout: 30000,
  capabilities: ['proofread', 'format'],
});

// Use the newly registered agent immediately
const result = await orchestrator.runAgent('editor', 'Fix the grammar in this draft...');

// List all registered agent IDs
console.log(orchestrator.getAgentIds());  // ['researcher', 'writer', 'reviewer', 'editor']

// Unregister when no longer needed (agent must be idle)
orchestrator.unregisterAgent('editor');
```

`registerAgent()` throws if the agent ID is already registered or is a reserved ID. `unregisterAgent()` throws if the agent is currently running. Unregistering drains the agent's semaphore, resets its System facts, and removes it from the orchestrator's registry.

---

## Guardrails

Guardrails run at two levels: orchestrator-level (applied to every agent) and per-agent (additive). Orchestrator guardrails execute first, then per-agent guardrails.

```typescript
import {
  createMultiAgentOrchestrator,
  createPIIGuardrail,
  createToolGuardrail,
  createOutputTypeGuardrail,
} from '@directive-run/ai';

const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: {
    researcher: {
      agent: researcher,
      maxConcurrent: 3,
      // Per-agent guardrails — additive with orchestrator-level
      guardrails: {
        output: [createOutputTypeGuardrail({ type: 'string', minStringLength: 10 })],
      },
    },
    writer: {
      agent: writer,
      maxConcurrent: 1,
      guardrails: {
        input: [createPIIGuardrail({ redact: true })],
        output: [createPIIGuardrail()],
        toolCall: [createToolGuardrail({ denylist: ['shell'] })],
      },
    },
  },

  // Orchestrator-level guardrails — applied to ALL agents
  guardrails: {
    input: [createPIIGuardrail({ redact: true })],
    toolCall: [createToolGuardrail({ denylist: ['eval', 'exec'] })],
  },
});
```

For the full guardrails API, see [Guardrails & Safety](/docs/ai/guardrails).

---

## Streaming

Stream individual agent responses with `runAgentStream()`. All guardrails, approval checks, and state tracking apply:

```typescript
const { stream, result, abort } = orchestrator.runAgentStream<string>('writer', 'Write about AI');

for await (const chunk of stream) {
  switch (chunk.type) {
    case 'token':
      process.stdout.write(chunk.data);
      break;
    case 'tool_start':
      console.log(`\nCalling tool: ${chunk.tool}`);
      break;
    case 'tool_end':
      console.log(`Tool done: ${chunk.result}`);
      break;
    case 'guardrail_triggered':
      console.warn(`Guardrail ${chunk.guardrailName}: ${chunk.reason}`);
      break;
    case 'done':
      console.log(`\n\nDone: ${chunk.totalTokens} tokens in ${chunk.duration}ms`);
      break;
    case 'error':
      console.error(chunk.error);
      break;
  }
}

const finalResult = await result;
```

When a guardrail error occurs during a streaming run, `runAgentStream` emits a `guardrail_triggered` chunk before the `error` chunk. This lets consumers display a guardrail-specific message to the user while the stream is still open:

```typescript
case 'guardrail_triggered':
  console.warn(`Guardrail ${chunk.guardrailName}: ${chunk.reason}`);
  console.log(`Partial output so far: ${chunk.partialOutput}`);
  break;
```

The `guardrail_triggered` chunk includes `guardrailName`, `reason`, `partialOutput` (any output accumulated before the guardrail fired), and `stopped: true`.

Cancel a stream at any time with the `abort` handle or an `AbortSignal`:

```typescript
const controller = new AbortController();
const { stream } = orchestrator.runAgentStream('writer', input, {
  signal: controller.signal,
});
```

For chunk types and stream operators, see [Streaming](/docs/ai/streaming).

---

## Approval Workflow

Require human approval before tool calls execute. The workflow is identical to the [single-agent orchestrator](/docs/ai/orchestrator#approval-workflow), but `approve()` and `reject()` automatically route to the correct agent's approval state:

```typescript
const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: {
    researcher: { agent: researcher },
    writer: { agent: writer },
  },
  autoApproveToolCalls: false,
  approvalTimeoutMs: 60000,

  onApprovalRequest: (request) => {
    // request.agentName identifies which agent wants to act
    broadcastToAdminDashboard(request);
  },
});

// Human clicks approve or reject in the dashboard
orchestrator.approve(requestId);
orchestrator.reject(requestId, 'Denied by reviewer');
```

---

## Lifecycle Hooks

Observe agent runs, guardrail checks, retries, handoffs, and pattern execution. Multi-agent hooks include `agentId` in every event to distinguish which registered agent fired:

```typescript
const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: { /* ... */ },

  hooks: {
    onAgentStart: ({ agentId, agentName, input, timestamp }) => {
      console.log(`[${agentId}] Starting at ${timestamp}`);
    },
    onAgentComplete: ({ agentId, agentName, tokenUsage, durationMs }) => {
      console.log(`[${agentId}] Done: ${tokenUsage} tokens in ${durationMs}ms`);
    },
    onAgentError: ({ agentId, error, durationMs }) => {
      console.error(`[${agentId}] Failed after ${durationMs}ms:`, error.message);
    },
    onGuardrailCheck: ({ agentId, guardrailName, guardrailType, passed, reason }) => {
      if (!passed) {
        console.warn(`[${agentId}] Guardrail ${guardrailName} (${guardrailType}) blocked: ${reason}`);
      }
    },
    onAgentRetry: ({ agentId, attempt, error, delayMs }) => {
      console.log(`[${agentId}] Retry #${attempt} in ${delayMs}ms: ${error.message}`);
    },
    onPatternStart: ({ patternId, patternType, timestamp }) => {
      console.log(`Pattern ${patternId} (${patternType}) started`);
    },
    onPatternComplete: ({ patternId, durationMs, error }) => {
      if (error) {
        console.error(`Pattern ${patternId} failed after ${durationMs}ms:`, error.message);
      } else {
        console.log(`Pattern ${patternId} completed in ${durationMs}ms`);
      }
    },
  },

  onHandoff: (request) => {
    console.log(`Handoff: ${request.fromAgent} → ${request.toAgent}`);
  },
  onHandoffComplete: (result) => {
    console.log(`Handoff ${result.request.id} complete`);
  },
});
```

---

## Retries

Configure automatic retries at the orchestrator level (applies to all agents) or per-agent (overrides the default):

```typescript
const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: {
    researcher: {
      agent: researcher,
      // Per-agent retry overrides the orchestrator default
      retry: {
        attempts: 5,
        backoff: 'exponential',
        baseDelayMs: 500,
      },
    },
    writer: { agent: writer },
  },

  // Default retry config for all agents (writer uses this)
  agentRetry: {
    attempts: 3,
    backoff: 'exponential',
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    isRetryable: (error) => {
      return error.message.includes('429') || error.message.includes('500');
    },
  },
});
```

---

## Budget Control

Set a token budget that automatically pauses all agents when exceeded:

```typescript
const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: { researcher: { agent: researcher }, writer: { agent: writer } },
  maxTokenBudget: 50000,
});

await orchestrator.runAgent('researcher', 'Summarize this...');
await orchestrator.runAgent('writer', 'Write an article...');

// When cumulative tokens across all agents exceed 50000,
// the orchestrator pauses and subsequent runAgent() calls throw
```

### Budget Warning Threshold

Get an early warning before the budget limit is reached. The `budgetWarningThreshold` (0&ndash;1, default `0.8`) fires the `onBudgetWarning` callback once when token usage crosses that fraction of `maxTokenBudget`:

```typescript
const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: { researcher: { agent: researcher }, writer: { agent: writer } },
  maxTokenBudget: 50000,
  budgetWarningThreshold: 0.75,  // Warn at 75%
  onBudgetWarning: ({ currentTokens, maxBudget, percentage }) => {
    console.warn(
      `Budget warning: ${currentTokens}/${maxBudget} tokens used (${(percentage * 100).toFixed(0)}%)`
    );
  },
});
```

The callback fires exactly once per orchestrator lifetime (reset with `orchestrator.reset()`). The `percentage` value is the actual ratio at the moment the threshold was crossed, which may be higher than the threshold if a single agent run consumed a large chunk.

Combine with custom constraints for more granular control:

```typescript
import { requirementGuard } from '@directive-run/core/adapter-utils';

const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: { /* ... */ },
  maxTokenBudget: 50000,

  constraints: {
    costWarning: {
      priority: 100,
      when: (facts) => facts.globalTokens > 25000,
      require: { type: 'COST_WARNING' },
    },
  },

  resolvers: {
    costWarning: {
      requirement: requirementGuard('COST_WARNING'),
      resolve: async (req, context) => {
        console.warn('Token usage high:', context.facts.globalTokens);
      },
    },
  },
});
```

---

## Memory

Attach shared memory across all agents or per-agent memory that overrides the shared one:

```typescript
import { createAgentMemory, createSlidingWindowStrategy } from '@directive-run/ai';

const sharedMemory = createAgentMemory({
  strategy: createSlidingWindowStrategy({ maxMessages: 50 }),
});

const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: {
    researcher: {
      agent: researcher,
      // Per-agent memory — overrides shared memory for this agent
      memory: createAgentMemory({
        strategy: createSlidingWindowStrategy({ maxMessages: 100 }),
      }),
    },
    writer: { agent: writer },  // Uses shared memory
  },
  memory: sharedMemory,
});
```

---

## Constraints & Resolvers

Define constraints and resolvers at both the orchestrator level and per-agent. Per-agent constraints/resolvers are namespaced within that agent's module in the Directive System:

```typescript
import { requirementGuard } from '@directive-run/core/adapter-utils';

const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: {
    researcher: {
      agent: researcher,
      // Per-agent constraint: escalate when researcher finds low-confidence data
      constraints: {
        lowConfidence: {
          when: (facts) => (facts.agent.output?.confidence ?? 1) < 0.5,
          require: { type: 'RUN_AGENT', agent: 'expert', input: 'Verify findings' },
        },
      },
    },
    expert: { agent: expert },
  },

  // Orchestrator-level constraint: pause everything when budget is high
  constraints: {
    budgetAlert: {
      priority: 100,
      when: (facts) => facts.globalTokens > 40000,
      require: { type: 'BUDGET_ALERT' },
    },
  },

  resolvers: {
    budgetAlert: {
      requirement: requirementGuard('BUDGET_ALERT'),
      resolve: async (req, context) => {
        console.warn('Approaching budget limit');
      },
    },
  },
});
```

---

## Debug & Time-Travel

Enable `debug: true` to get console logging and time-travel snapshot support on the underlying Directive System:

```typescript
const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: { /* ... */ },
  debug: true,  // Enables console logging + time-travel snapshots
});

// Access the underlying Directive System for inspection
const { system } = orchestrator;
```

---

## Error Handling

### Parallel Error Handling

Without `minSuccess`, any single agent failure causes the entire parallel batch to reject. With `minSuccess`, individual failures are caught and the pattern succeeds if enough agents complete:

```typescript
// Tolerates 1 failure out of 3
const research = parallel(
  ['researcher', 'researcher', 'researcher'],
  (results) => concatResults(results),
  { minSuccess: 2 }
);
```

### Sequential Error Handling

Without `continueOnError`, the first failure stops the pipeline. With `continueOnError: true`, failed agents are skipped and the pipeline continues with the last successful output. If no agent succeeds, the pipeline throws:

```
[Directive MultiAgent] No successful results in sequential pattern
```

### Supervisor Error Handling

If a worker fails, the error propagates immediately (no retry at the supervisor level). If the supervisor requests an invalid worker, the pattern throws:

```
[Directive MultiAgent] Supervisor delegated to unknown worker "unknown-agent". Available workers: researcher, writer
```

### Unknown Agents and Patterns

```typescript
// Throws: '[Directive MultiAgent] Unknown agent "nonexistent". Registered agents: researcher, writer'
await orchestrator.runAgent('nonexistent', 'hello');

// Throws: '[Directive MultiAgent] Unknown pattern "nonexistent". Available patterns: research, writeAndReview'
await orchestrator.runPattern('nonexistent', 'hello');
```

---

## Testing

Use `createTestMultiAgentOrchestrator` for testing with built-in mocking and assertion helpers. Import from `@directive-run/ai/testing`:

```typescript
import {
  createTestMultiAgentOrchestrator,
  assertMultiAgentState,
} from '@directive-run/ai/testing';
import { parallel, sequential, concatResults } from '@directive-run/ai';

const test = createTestMultiAgentOrchestrator({
  agents: {
    researcher: { agent: { name: 'researcher' }, maxConcurrent: 3 },
    writer: { agent: { name: 'writer' }, maxConcurrent: 1 },
    reviewer: { agent: { name: 'reviewer' }, maxConcurrent: 1 },
  },
  mockResponses: {
    researcher: { output: 'Research findings about WebAssembly...', totalTokens: 150 },
    writer: { output: 'WebAssembly (WASM) is a binary instruction format...', totalTokens: 200 },
    reviewer: { output: 'APPROVED. The article is technically accurate.', totalTokens: 50 },
  },
  patterns: {
    research: parallel(
      ['researcher', 'researcher'],
      (results) => concatResults(results)
    ),
    pipeline: sequential(['researcher', 'writer', 'reviewer']),
  },
});

// Test a parallel pattern
const research = await test.runPattern('research', 'Explain WASM');
expect(research).toContain('Research findings');

// Test a sequential pipeline
const article = await test.runPattern('pipeline', 'Write about WASM');

// Inspect mock runner call history
expect(test.getCalls()).toHaveLength(5);  // 2 parallel + 3 sequential

// Assert orchestrator state
assertMultiAgentState(test, {
  agentStatus: { researcher: 'completed', writer: 'completed', reviewer: 'completed' },
  globalTokens: { min: 0, max: 2000 },
  pendingHandoffs: 0,
});

// Reset between tests
test.resetAll();
```

### Testing with Failures

```typescript
import { createMockAgentRunner } from '@directive-run/ai/testing';
import { createMultiAgentOrchestrator, parallel, concatResults } from '@directive-run/ai';

const flakyRunner = createMockAgentRunner({
  defaultResponse: { output: 'OK', totalTokens: 10 },
  responses: {
    researcher: { error: new Error('Rate limited') },
  },
});

const orchestrator = createMultiAgentOrchestrator({
  runner: flakyRunner.run,
  agents: {
    researcher: { agent: { name: 'researcher' }, maxConcurrent: 1 },
    writer: { agent: { name: 'writer' }, maxConcurrent: 1 },
  },
  patterns: {
    tolerant: parallel(
      ['researcher', 'writer'],
      (results) => concatResults(results),
      { minSuccess: 1 }
    ),
  },
});

// Researcher fails but writer succeeds &ndash; pattern completes
const result = await orchestrator.runPattern('tolerant', 'test');
expect(result).toBe('OK');
```

---

## Framework Integration

The multi-agent orchestrator exposes a `.system` property &ndash; a standard Directive System with namespaced modules. Each agent's state is under its agent ID key (e.g., `researcher`, `writer`), with bridge keys `__agent`, `__approval`, `__conversation`, and `__toolCalls` inside each namespace.

### React

```tsx
import { useFact, useSelector, useInspect } from '@directive-run/react';
import { createMultiAgentOrchestrator } from '@directive-run/ai';

function MultiAgentPanel({ orchestrator }: { orchestrator: MultiAgentOrchestrator }) {
  const { system } = orchestrator;

  // Subscribe to a specific agent's state (namespaced under the agent ID)
  const researcherAgent = useFact(system, 'researcher.__agent');
  const writerAgent = useFact(system, 'writer.__agent');

  // Derive a summary across multiple agents
  const summary = useSelector(system, (state) => ({
    researcherStatus: state.researcher?.__agent?.status,
    writerStatus: state.writer?.__agent?.status,
    researcherTokens: state.researcher?.__agent?.tokenUsage ?? 0,
    writerTokens: state.writer?.__agent?.tokenUsage ?? 0,
  }));

  const { isSettled } = useInspect(system);

  return (
    <div>
      <p>Researcher: {researcherAgent?.status} ({summary.researcherTokens} tokens)</p>
      <p>Writer: {writerAgent?.status} ({summary.writerTokens} tokens)</p>
      <p>{isSettled ? 'Idle' : 'Working...'}</p>
    </div>
  );
}
```

### Vue

```html
<script setup>
import { createMultiAgentOrchestrator } from '@directive-run/ai';
import { useFact, useInspect } from '@directive-run/vue';
import { onUnmounted } from 'vue';

const orchestrator = createMultiAgentOrchestrator({ runner, agents: { /* ... */ } });
onUnmounted(() => orchestrator.dispose());

const researcherAgent = useFact(orchestrator.system, 'researcher.__agent');
const writerAgent = useFact(orchestrator.system, 'writer.__agent');
const { isSettled } = useInspect(orchestrator.system);
</script>

<template>
  <p>Researcher: {{ researcherAgent?.status }}</p>
  <p>Writer: {{ writerAgent?.status }}</p>
  <p>{{ isSettled ? 'Idle' : 'Working...' }}</p>
</template>
```

### Svelte

```html
<script>
import { createMultiAgentOrchestrator } from '@directive-run/ai';
import { useFact, useInspect } from '@directive-run/svelte';
import { onDestroy } from 'svelte';

const orchestrator = createMultiAgentOrchestrator({ runner, agents: { /* ... */ } });
onDestroy(() => orchestrator.dispose());

const researcherAgent = useFact(orchestrator.system, 'researcher.__agent');
const writerAgent = useFact(orchestrator.system, 'writer.__agent');
const inspect = useInspect(orchestrator.system);
</script>

<p>Researcher: {$researcherAgent?.status}</p>
<p>Writer: {$writerAgent?.status}</p>
<p>{$inspect.isSettled ? 'Idle' : 'Working...'}</p>
```

### Solid

```tsx
import { createMultiAgentOrchestrator } from '@directive-run/ai';
import { useFact, useInspect } from '@directive-run/solid';
import { onCleanup } from 'solid-js';

function MultiAgentPanel() {
  const orchestrator = createMultiAgentOrchestrator({ runner, agents: { /* ... */ } });
  onCleanup(() => orchestrator.dispose());

  const researcherAgent = useFact(orchestrator.system, 'researcher.__agent');
  const writerAgent = useFact(orchestrator.system, 'writer.__agent');
  const inspect = useInspect(orchestrator.system);

  return (
    <div>
      <p>Researcher: {researcherAgent()?.status}</p>
      <p>Writer: {writerAgent()?.status}</p>
      <p>{inspect().isSettled ? 'Idle' : 'Working...'}</p>
    </div>
  );
}
```

### Lit

```typescript
import { LitElement, html } from 'lit';
import { createMultiAgentOrchestrator } from '@directive-run/ai';
import { FactController, InspectController } from '@directive-run/lit';

class MultiAgentPanel extends LitElement {
  private orchestrator = createMultiAgentOrchestrator({ runner, agents: { /* ... */ } });
  private researcherAgent = new FactController(this, this.orchestrator.system, 'researcher.__agent');
  private writerAgent = new FactController(this, this.orchestrator.system, 'writer.__agent');
  private inspect = new InspectController(this, this.orchestrator.system);

  disconnectedCallback() {
    super.disconnectedCallback();
    this.orchestrator.dispose();
  }

  render() {
    return html`
      <p>Researcher: ${this.researcherAgent.value?.status}</p>
      <p>Writer: ${this.writerAgent.value?.status}</p>
      <p>${this.inspect.value?.isSettled ? 'Idle' : 'Working...'}</p>
    `;
  }
}
```

---

## Next Steps

- [Orchestrator](/docs/ai/orchestrator) &ndash; Single-agent orchestration, constraints, and approvals
- [Guardrails](/docs/ai/guardrails) &ndash; Input/output validation and safety
- [Streaming](/docs/ai/streaming) &ndash; Real-time token streaming
- [MCP Integration](/docs/ai/mcp) &ndash; Model Context Protocol server connections
