---
title: Multi-Agent
description: Orchestrate multiple AI agents with parallel, sequential, and supervisor patterns, plus inter-agent communication.
---

Coordinate multiple agents with execution patterns, handoffs, communication channels, and result merging. {% .lead %}

---

## Setup

Multi-agent orchestration builds on the [Agent Orchestrator](/docs/ai/orchestrator) adapter. Start by defining your agents and a run function, then register them in an orchestrator:

```typescript
import {
  createMultiAgentOrchestrator,
  parallel,
  sequential,
  supervisor,
  selectAgent,
  runAgentRequirement,
  concatResults,
  collectOutputs,
  pickBestResult,
  aggregateTokens,
} from 'directive/ai';
import type {
  AgentLike,
  AgentRunner,
  RunResult,
  AgentRegistration,
  MultiAgentOrchestrator,
} from 'directive/ai';

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
  const result = await openaiAgentsRun(agent, input, options);

  return result;
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
| `onHandoff` | `(request: HandoffRequest) => void` | &ndash; | Called when a handoff starts |
| `onHandoffComplete` | `(result: HandoffResult) => void` | &ndash; | Called when a handoff finishes |
| `maxHandoffHistory` | `number` | `1000` | Max completed handoff results to retain |
| `debug` | `boolean` | `false` | Enable debug logging |

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
| `guardrails.output` | `Array<GuardrailFn \| NamedGuardrail>` | &ndash; | Per-agent output guardrails (additive with stack-level) |

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

---

## Parallel Execution

Run multiple agents at the same time and merge their results.

### Using a Named Pattern

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
```

When passing an array of inputs, the count must match the agent count. If they don't match, the orchestrator throws immediately.

### `parallel()` Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `minSuccess` | `number` | all | Minimum successful results required. Failed agents are silently caught when set |
| `timeout` | `number` | &ndash; | Overall timeout for the entire parallel batch (ms) |

When `minSuccess` is set, individual agent failures are caught silently. If fewer agents succeed than the threshold, the pattern throws with the count:

```
Not enough successful results: 1/2
```

---

## Sequential Pipelines

Chain agents so each one's output feeds into the next.

### Using a Named Pattern

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

### `sequential()` Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `transform` | `(output, agentId, index) => string` | auto-stringify | Transform each agent's output into the next agent's input |
| `extract` | `(output) => T` | identity | Extract the final result from the last agent's output |
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
import { selectAgent } from 'directive/ai';

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
import { runAgentRequirement } from 'directive/ai';

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

---

## Agent Communication

For decentralized agent coordination without a central orchestrator, use the message bus and agent network.

### Message Bus

The low-level pub/sub transport for agent-to-agent messaging:

```typescript
import { createMessageBus } from 'directive/ai';
import type { MessageBus, TypedAgentMessage } from 'directive/ai';

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
import { createAgentNetwork, createMessageBus } from 'directive/ai';
import type { AgentNetwork } from 'directive/ai';

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
import { createResponder } from 'directive/ai';

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
import { createDelegator } from 'directive/ai';

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
import { createPubSub } from 'directive/ai';

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
} from 'directive/ai';

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

## Concurrency Control

Each registered agent gets its own `Semaphore` instance based on `maxConcurrent`. The semaphore is queue-based (no polling):

```typescript
import { Semaphore } from 'directive/ai';

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

### Reset and Dispose

```typescript
// Reset all agent states, drain semaphores, clear handoff history
orchestrator.reset();

// Alias for reset &ndash; use when you're done with the orchestrator
orchestrator.dispose();
```

`reset()` drains all semaphores (rejecting pending waiters with an error), resets every agent to `idle` with zero counts, and clears both pending and completed handoff lists.

---

## Error Handling

### Parallel Patterns

Without `minSuccess`, any single agent failure causes the entire parallel batch to reject. With `minSuccess`, individual failures are caught and the pattern succeeds if enough agents complete:

```typescript
// Tolerates 1 failure out of 3
const research = parallel(
  ['researcher', 'researcher', 'researcher'],
  (results) => concatResults(results),
  { minSuccess: 2 }
);
```

### Sequential Pipelines

Without `continueOnError`, the first failure stops the pipeline. With `continueOnError: true`, failed agents are skipped and the pipeline continues with the last successful output. If no agent succeeds, the pipeline throws:

```
No successful results in sequential pattern
```

### Supervisor Pattern

If a worker fails, the error propagates immediately (no retry at the supervisor level). If the supervisor requests an invalid worker, the pattern throws:

```
Invalid worker: unknown-agent
```

### Unknown Agents and Patterns

```typescript
// Throws: 'Unknown agent: nonexistent'
await orchestrator.runAgent('nonexistent', 'hello');

// Throws: 'Unknown pattern: nonexistent'
await orchestrator.runPattern('nonexistent', 'hello');
```

---

## Testing

Use `createMockAgentRunner` to test multi-agent patterns without real LLM calls:

```typescript
import {
  createMockAgentRunner,
  createMultiAgentOrchestrator,
  parallel,
  sequential,
  concatResults,
} from 'directive/ai';

const runner = createMockAgentRunner({
  responses: {
    researcher: 'Research findings about WebAssembly...',
    writer: 'WebAssembly (WASM) is a binary instruction format...',
    reviewer: 'APPROVED. The article is technically accurate.',
  },
  tokenCount: 150,
  latencyMs: 50,
});

const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: {
    researcher: { agent: { name: 'researcher' }, maxConcurrent: 3 },
    writer: { agent: { name: 'writer' }, maxConcurrent: 1 },
    reviewer: { agent: { name: 'reviewer' }, maxConcurrent: 1 },
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
const research = await orchestrator.runPattern('research', 'Explain WASM');
expect(research).toContain('Research findings');

// Test a sequential pipeline
const article = await orchestrator.runPattern('pipeline', 'Write about WASM');

// Inspect runner call history
expect(runner.getCallCount('researcher')).toBe(3);  // 2 parallel + 1 sequential
expect(runner.getCallCount('writer')).toBe(1);
expect(runner.calls.length).toBe(5);

// Reset between tests
runner.reset();
orchestrator.reset();
```

### Testing with Failures

```typescript
const flakyRunner = createMockAgentRunner({
  defaultResponse: 'OK',
  shouldFail: (agent) => agent.name === 'researcher',
  failureError: new Error('Rate limited'),
});

const orchestrator = createMultiAgentOrchestrator({
  runner: flakyRunner,
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

## Integration with Agent Stack

The [Agent Stack](/docs/ai/agent-stack) composes multi-agent patterns with memory, caching, observability, and guardrails in a single factory:

```typescript
import { createAgentStack, parallel, sequential } from 'directive/ai';

const stack = createAgentStack({
  runner,
  agents: {
    researcher: { agent: researcher, maxConcurrent: 3 },
    writer: { agent: writer, maxConcurrent: 1 },
    reviewer: { agent: reviewer, maxConcurrent: 1 },
  },
  patterns: {
    research: parallel(
      ['researcher', 'researcher'],
      (results) => concatResults(results)
    ),
    pipeline: sequential(['researcher', 'writer', 'reviewer']),
  },
  // Stack-level features apply to all agent runs
  memory: { strategy: 'sliding', maxMessages: 50 },
  circuitBreaker: { maxFailures: 5, resetMs: 60000 },
  guardrails: {
    input: [createPIIGuardrail({ redact: true })],
    output: [createModerationGuardrail({ checkFn: moderate })],
  },
  messageBus: { maxHistory: 500 },
});

// Run patterns through the stack
const research = await stack.runPattern('research', 'Explain WASM');

// Access the underlying multi-agent orchestrator
const coordinator = stack.coordinator;
const state = coordinator.getAgentState('researcher');

// Access the message bus
const bus = stack.messageBus;
```

---

## Framework Integration

Track multi-agent state through the [Agent Orchestrator](/docs/ai/orchestrator) adapter's `.system` bridge. The `__agent` key holds the active agent status, `__agents` for per-agent states.

### React

```tsx
import { useAgentOrchestrator, useFact, useSelector } from 'directive/react';

function MultiAgentPanel() {
  const orchestrator = useAgentOrchestrator({ runner, autoApproveToolCalls: true });
  const { system } = orchestrator;

  const agent = useFact(system, '__agent');
  const summary = useSelector(system, (facts) => ({
    status: facts.__agent?.status,
    tokens: facts.__agent?.totalTokens,
  }));

  return (
    <div>
      <p>Status: {agent?.status}</p>
      <p>Tokens: {summary.tokens}</p>
    </div>
  );
}
```

### Vue

```html
<script setup>
import { createMultiAgentOrchestrator } from 'directive/ai';
import { useFact, useInspect } from 'directive/vue';
import { onUnmounted } from 'vue';

const orchestrator = createMultiAgentOrchestrator({ runner, agents: { /* ... */ } });
onUnmounted(() => orchestrator.dispose());

const agent = useFact(orchestrator.system, '__agent');
const { isSettled } = useInspect(orchestrator.system);
</script>

<template>
  <p>Status: {{ agent?.status }}</p>
  <p>{{ isSettled ? 'Idle' : 'Working...' }}</p>
</template>
```

### Svelte

```html
<script>
import { createMultiAgentOrchestrator } from 'directive/ai';
import { useFact, useInspect } from 'directive/svelte';
import { onDestroy } from 'svelte';

const orchestrator = createMultiAgentOrchestrator({ runner, agents: { /* ... */ } });
onDestroy(() => orchestrator.dispose());

const agent = useFact(orchestrator.system, '__agent');
const inspect = useInspect(orchestrator.system);
</script>

<p>Status: {$agent?.status}</p>
<p>{$inspect.isSettled ? 'Idle' : 'Working...'}</p>
```

### Solid

```tsx
import { createMultiAgentOrchestrator } from 'directive/ai';
import { useFact, useInspect } from 'directive/solid';
import { onCleanup } from 'solid-js';

function MultiAgentPanel() {
  const orchestrator = createMultiAgentOrchestrator({ runner, agents: { /* ... */ } });
  onCleanup(() => orchestrator.dispose());

  const agent = useFact(orchestrator.system, '__agent');
  const inspect = useInspect(orchestrator.system);

  return (
    <div>
      <p>Status: {agent()?.status}</p>
      <p>{inspect().isSettled ? 'Idle' : 'Working...'}</p>
    </div>
  );
}
```

### Lit

```typescript
import { LitElement, html } from 'lit';
import { createMultiAgentOrchestrator } from 'directive/ai';
import { FactController, InspectController } from 'directive/lit';

class MultiAgentPanel extends LitElement {
  private orchestrator = createMultiAgentOrchestrator({ runner, agents: { /* ... */ } });
  private agent = new FactController(this, this.orchestrator.system, '__agent');
  private inspect = new InspectController(this, this.orchestrator.system);

  disconnectedCallback() {
    super.disconnectedCallback();
    this.orchestrator.dispose();
  }

  render() {
    return html`
      <p>Status: ${this.agent.value?.status}</p>
      <p>${this.inspect.value?.isSettled ? 'Idle' : 'Working...'}</p>
    `;
  }
}
```

---

## Next Steps

- [Agent Orchestrator](/docs/ai/orchestrator) &ndash; Single-agent orchestration, constraints, and approvals
- [Agent Stack](/docs/ai/agent-stack) &ndash; All-in-one composition with memory, caching, and observability
- [Guardrails](/docs/ai/guardrails) &ndash; Input/output validation and safety
- [Streaming](/docs/ai/streaming) &ndash; Real-time token streaming
- [MCP Integration](/docs/ai/mcp) &ndash; Model Context Protocol server connections
