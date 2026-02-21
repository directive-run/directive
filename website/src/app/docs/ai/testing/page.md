---
title: Testing
description: Mock runners, test orchestrators, assertion helpers, and simulators for AI agent testing.
---

Deterministic testing utilities for agent orchestration &ndash; mock runners, test orchestrators, assertion helpers, and simulators. {% .lead %}

Import from `@directive-run/ai/testing` for a complete toolkit that makes agent tests fast and deterministic.

---

## Mock Runner

Create a mock `AgentRunner` with per-agent response configuration:

```typescript
import { createMockAgentRunner } from '@directive-run/ai/testing';

const mock = createMockAgentRunner({
  defaultResponse: {
    output: 'Default response',
    totalTokens: 10,
  },
  responses: {
    researcher: {
      output: 'Research findings...',
      totalTokens: 150,
    },
    writer: {
      output: 'Draft article...',
      totalTokens: 200,
    },
  },
});

// Use as a runner
const result = await mock.run(researcher, 'input');

// Inspect calls
console.log(mock.getCalls());              // All calls
console.log(mock.getCallsFor('researcher')); // Calls to specific agent

// Dynamic responses
mock.setResponse('reviewer', {
  output: 'dynamic',
  totalTokens: 50,
  generate: (input) => ({
    output: `Reviewed: ${input}`,
    totalTokens: 50,
  }),
});

// Error responses
mock.setResponse('flaky', {
  output: '',
  totalTokens: 0,
  error: new Error('Rate limited'),
});

// Reset
mock.clearCalls();
mock.setDefaultResponse({
  output: 'New default',
  totalTokens: 5,
});
```

---

## Test Orchestrators

### Single-Agent

```typescript
import { createTestOrchestrator } from '@directive-run/ai/testing';

const test = createTestOrchestrator({
  mockResponses: {
    default: {
      output: 'OK',
      totalTokens: 10,
    },
  },
  guardrails: { /* ... */ },
  debug: true,
});

const result = await test.run(agent, 'Hello');
```

### Multi-Agent

```typescript
import {
  createTestMultiAgentOrchestrator,
  assertMultiAgentState,
} from '@directive-run/ai/testing';
import { parallel, sequential, concatResults } from '@directive-run/ai';

const test = createTestMultiAgentOrchestrator({
  agents: {
    researcher: {
      agent: { name: 'researcher' },
      maxConcurrent: 3,
    },
    writer: {
      agent: { name: 'writer' },
      maxConcurrent: 1,
    },
    reviewer: {
      agent: { name: 'reviewer' },
      maxConcurrent: 1,
    },
  },
  mockResponses: {
    researcher: {
      output: 'Research findings...',
      totalTokens: 150,
    },
    writer: {
      output: 'Draft article...',
      totalTokens: 200,
    },
    reviewer: {
      output: 'APPROVED',
      totalTokens: 50,
    },
  },
  patterns: {
    research: parallel(
      ['researcher', 'researcher'],
      (results) => concatResults(results)
    ),
    pipeline: sequential(['researcher', 'writer', 'reviewer']),
  },
  debug: true,
});

// Test patterns
const research = await test.runPattern('research', 'Explain WASM');
const article = await test.runPattern('pipeline', 'Write about WASM');

// Inspect
expect(test.getCalls()).toHaveLength(5);

// Assert state
assertMultiAgentState(test, {
  agentStatus: { researcher: 'completed', writer: 'completed', reviewer: 'completed' },
  globalTokens: { min: 0, max: 2000 },
  pendingHandoffs: 0,
});

// Reset between tests
test.resetAll();
```

---

## Assertion Helpers

| Helper | Asserts on |
|--------|-----------|
| `assertOrchestratorState` | Single-agent status, tokens, approvals, conversation |
| `assertMultiAgentState` | Per-agent statuses, global tokens, handoffs |
| `assertTimelineEvents` | Event counts, types, per-agent events |
| `assertRerouted` | Self-healing reroute from/to agent |
| `assertAgentHealth` | Health score, circuit state, success rate |
| `assertBreakpointHit` | Breakpoint type, agent, count |
| `assertScratchpadState` | Scratchpad key-value equality |
| `assertDerivedValues` | Derived value equality |
| `assertCheckpoint` | Checkpoint type, timeline, memory, label |
| `assertDagExecution` | Node statuses, completed/skipped/error nodes |
| `assertMultiplexedStream` | Agent IDs, chunk counts, done/error flags |

### `assertOrchestratorState`

```typescript
import { assertOrchestratorState } from '@directive-run/ai/testing';

assertOrchestratorState(orchestrator, {
  agentStatus: 'completed',
  tokenUsage: { min: 0, max: 1000 },
  pendingApprovals: 0,
  conversationLength: { min: 1 },
});
```

### `assertMultiAgentState`

```typescript
import { assertMultiAgentState } from '@directive-run/ai/testing';

assertMultiAgentState(orchestrator, {
  agentStatus: { researcher: 'completed', writer: 'idle' },
  totalTokens: { min: 100 },
  globalTokens: { min: 0, max: 5000 },
  pendingHandoffs: 0,
});
```

### `assertTimelineEvents`

```typescript
import { assertTimelineEvents } from '@directive-run/ai/testing';

assertTimelineEvents(timeline, {
  totalEvents: { min: 3 },
  eventTypes: ['agent_start', 'agent_complete'],
  agentEvents: { researcher: { min: 2 } },
  hasType: 'pattern_start',
  doesNotHaveType: 'agent_error',
});
```

### `assertRerouted`

```typescript
import { assertRerouted } from '@directive-run/ai/testing';

assertRerouted(events, {
  fromAgent: 'researcher',
  toAgent: 'backup-researcher',
  reason: 'circuit_open',
  minReroutes: 1,
});
```

### `assertAgentHealth`

```typescript
import { assertAgentHealth } from '@directive-run/ai/testing';

assertAgentHealth(monitor, 'researcher', {
  minScore: 70,
  circuitState: 'closed',
  minSuccessRate: 0.9,
});
```

### `assertBreakpointHit`

```typescript
import { assertBreakpointHit } from '@directive-run/ai/testing';

assertBreakpointHit(hits, {
  type: 'pre_agent_run',
  agentId: 'researcher',
  count: 1,
});
```

### `assertScratchpadState`

```typescript
import { assertScratchpadState } from '@directive-run/ai/testing';

assertScratchpadState(scratchpad, {
  completedCount: 2,
  lastUpdate: 'research phase done',
});
```

### `assertDerivedValues`

```typescript
import { assertDerivedValues } from '@directive-run/ai/testing';

assertDerivedValues(orchestrator, {
  totalCost: 0.05,
  allIdle: true,
});
```

### `assertCheckpoint`

```typescript
import { assertCheckpoint } from '@directive-run/ai/testing';

assertCheckpoint(checkpoint, {
  orchestratorType: 'multi',
  hasTimeline: true,
  hasMemory: true,
  label: 'Before experiment',
});
```

### `assertDagExecution`

```typescript
import { assertDagExecution } from '@directive-run/ai/testing';

assertDagExecution(context, {
  nodeStatuses: { researcher: 'completed', writer: 'completed' },
  completedNodes: ['researcher', 'writer'],
  skippedNodes: [],
  errorNodes: [],
});
```

### `assertMultiplexedStream`

```typescript
import { assertMultiplexedStream, collectMultiplexedStream } from '@directive-run/ai/testing';

const chunks = await collectMultiplexedStream(stream);

assertMultiplexedStream(chunks, {
  agentIds: ['researcher', 'writer'],
  minChunks: 5,
  hasDone: true,
  hasErrors: false,
});
```

---

## Simulators

### Approval Simulator

Auto-approve or reject tool call approvals in tests:

```typescript
import { createApprovalSimulator } from '@directive-run/ai/testing';

const simulator = createApprovalSimulator({
  autoApprove: true,   // Approve everything by default
  delay: 100,          // Simulate human delay (ms)
});

// Or manual control
const manual = createApprovalSimulator();
const request = await manual.waitForRequest(
  (req) => req.agentName === 'researcher',
  5000
);
manual.approve(request.id);
```

### Breakpoint Simulator

Auto-resolve breakpoints in tests:

```typescript
import { createBreakpointSimulator } from '@directive-run/ai/testing';

const simulator = createBreakpointSimulator({
  autoResume: true,
  delay: 50,
  modifications: { skip: false },
});
```

### Reflection Evaluator

Test reflection patterns with deterministic pass/fail:

```typescript
import { createTestReflectionEvaluator } from '@directive-run/ai/testing';

const evaluator = createTestReflectionEvaluator({
  passAfter: 2,  // Pass on the 2nd iteration
  scores: [0.3, 0.7, 0.95],
});
```

---

## Test Helpers

### Failing Runner

```typescript
import { createFailingRunner } from '@directive-run/ai/testing';

// Always throws
const runner = createFailingRunner(new Error('LLM down'));

// Fails N times then succeeds
const flakyRunner = createFailingRunner(new Error('Timeout'), {
  failCount: 2,
  thenReturn: { output: 'Success', totalTokens: 10 },
});
```

### Test Timeline

```typescript
import { createTestTimeline } from '@directive-run/ai/testing';

const timeline = createTestTimeline([
  { type: 'agent_start', agentId: 'researcher', timestamp: 1000 },
  { type: 'agent_complete', agentId: 'researcher', timestamp: 2000 },
]);
```

### Test Checkpoint Store

```typescript
import { createTestCheckpointStore } from '@directive-run/ai/testing';

const store = createTestCheckpointStore(50);
await store.save(checkpoint);
console.log(store.saved);        // All saved checkpoints
console.log(store.getLatest());  // Most recent
```

### Constraint Recorder

Record constraint evaluations for snapshot testing:

```typescript
import { createConstraintRecorder } from '@directive-run/ai/testing';

const recorder = createConstraintRecorder();
// Use as a plugin – records all constraint/resolver events
```

### Time Controller

Fake timers for deterministic time-based tests:

```typescript
import { createTimeController } from '@directive-run/ai/testing';

const time = createTimeController(Date.now());
time.advance(5000);  // Advance 5 seconds
```

### Test DAG

```typescript
import { createTestDag } from '@directive-run/ai/testing';

const dagPattern = createTestDag(
  [
    { agent: 'a', deps: [] },
    { agent: 'b', deps: ['a'] },
  ],
  (results) => concatResults(Object.values(results))
);
```

### Mock Schema

```typescript
import { createMockSchema } from '@directive-run/ai/testing';

const schema = createMockSchema(
  (data) => ({ success: true, data }),
  'Test schema'
);
```

---

## Next Steps

- [Evals](/docs/ai/evals) &ndash; Dataset-driven quality evaluation
- [Breakpoints & Checkpoints](/docs/ai/breakpoints) &ndash; Pausing and state snapshots
- [Debug Timeline](/docs/ai/debug-timeline) &ndash; Event recording
