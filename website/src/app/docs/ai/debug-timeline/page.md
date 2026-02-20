---
title: Debug Timeline
description: Record agent lifecycle events correlated with time-travel snapshots for visual timeline UIs and fork-and-replay debugging.
---

AI-specific event log with snapshot correlation for time-travel debugging. {% .lead %}

The debug timeline records agent lifecycle events (start, complete, error, guardrails, approvals, handoffs, patterns) and correlates them with core time-travel snapshots. Zero-cost when `debug: false` — the timeline is simply `null`.

---

## Quick Start

Enable the timeline by passing `debug` to either orchestrator:

```typescript
import { createAgentOrchestrator } from '@directive-run/ai';

const orchestrator = createAgentOrchestrator({
  runner,
  debug: { timeTravel: true },
});

await orchestrator.run(agent, 'Hello!');

// Access the timeline
const events = orchestrator.timeline?.getEvents();
```

Both `createAgentOrchestrator` and `createMultiAgentOrchestrator` expose a `timeline` property when debug is enabled.

---

## Event Types

The timeline records 16 event types covering the full agent lifecycle:

| Event | When it fires |
| --- | --- |
| `agent_start` | Agent run begins |
| `agent_complete` | Agent run succeeds |
| `agent_error` | Agent run fails |
| `agent_retry` | Agent retries after failure |
| `guardrail_check` | Guardrail evaluates input/output |
| `constraint_evaluate` | Directive constraint fires |
| `resolver_start` | Resolver begins execution |
| `resolver_complete` | Resolver completes |
| `resolver_error` | Resolver fails |
| `approval_request` | Approval workflow triggered |
| `approval_response` | Approval granted/denied |
| `handoff_start` | Agent handoff begins |
| `handoff_complete` | Agent handoff completes |
| `pattern_start` | Execution pattern begins |
| `pattern_complete` | Execution pattern completes |
| `dag_node_update` | DAG node status changes |

Every event includes `id`, `type`, `timestamp`, and `snapshotId` (for time-travel correlation). Agent-scoped events also include `agentId`.

---

## Querying Events

```typescript
const timeline = orchestrator.timeline!;

// All events in order
const all = timeline.getEvents();

// Events for a specific agent
const agentEvents = timeline.getEventsForAgent('researcher');

// Events by type (type-narrowed)
const errors = timeline.getEventsByType('agent_error');
// errors[0].errorMessage — TypeScript knows the shape

// Events at a specific snapshot
const atSnapshot = timeline.getEventsAtSnapshot(5);

// Events in a time range
const recent = timeline.getEventsInRange(Date.now() - 10000, Date.now());
```

---

## Snapshot Correlation

Each event stores a `snapshotId` that links it to a core time-travel snapshot. Events that cause fact changes get the latest snapshot ID; events without fact changes (like guardrail checks) get `snapshotId: null`.

```typescript
// Find what happened at snapshot 7
const events = timeline.getEventsAtSnapshot(7);

// Walk backwards from the latest snapshot
const allEvents = timeline.getEvents();
const grouped = Object.groupBy(allEvents, (e) => e.snapshotId ?? 'no-snapshot');
```

---

## Fork and Replay

Truncate the timeline at a snapshot point and replay from there:

```typescript
// Fork from snapshot 5 — truncates events after that point
// and navigates the system back to snapshot 5
timeline.forkFrom(5);

// Re-run the agent — new events append automatically
await orchestrator.run(agent, 'Try a different approach');
```

This calls `system.debug.goTo(snapshotId)` under the hood, restoring the full system state.

---

## Export and Import

Serialize the timeline for persistence or sharing:

```typescript
// Export as JSON
const json = timeline.export();
localStorage.setItem('debug-session', json);

// Import from JSON
const saved = localStorage.getItem('debug-session');
if (saved) {
  timeline.import(saved);
}
```

Import validates all events and enforces the `maxEvents` cap.

---

## Standalone Usage

Create a timeline without an orchestrator for custom instrumentation:

```typescript
import { createDebugTimeline, createDebugTimelinePlugin } from '@directive-run/ai';

const timeline = createDebugTimeline({ maxEvents: 1000 });

// Record custom events
timeline.record({
  type: 'agent_start',
  timestamp: Date.now(),
  agentId: 'my-agent',
  snapshotId: null,
  inputLength: 42,
});

// Bridge core constraint/resolver events
const plugin = createDebugTimelinePlugin(timeline, () => system.debug?.currentIndex ?? null);
```

---

## Multi-Agent Timeline

In a multi-agent orchestrator, every event includes `agentId`, making it easy to build per-agent timelines:

```typescript
const multi = createMultiAgentOrchestrator({
  runner,
  agents: { researcher: { agent: researcher }, writer: { agent: writer } },
  debug: { timeTravel: true },
});

await multi.runPattern('research-and-write', 'Explain WASM');

// Per-agent view
const researcherEvents = multi.timeline!.getEventsForAgent('researcher');
const writerEvents = multi.timeline!.getEventsForAgent('writer');

// Pattern-level view
const patternStarts = multi.timeline!.getEventsByType('pattern_start');
```

---

## Configuration

| Option | Default | Description |
| --- | --- | --- |
| `maxEvents` | 500 | Ring buffer size — oldest events evicted first |
| `getSnapshotId` | — | Callback to read current snapshot ID |
| `goToSnapshot` | — | Callback for `forkFrom()` navigation |

---

## Privacy

Events store `inputLength` and `outputLength`, never full content. Error messages are included since they are developer-facing. Token usage is recorded as `totalTokens`.
