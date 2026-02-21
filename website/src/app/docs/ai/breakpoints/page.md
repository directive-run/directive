---
title: Breakpoints & Checkpoints
description: Human-in-the-loop breakpoints for pausing agent execution and checkpoints for persistent state snapshots.
---

Pause agent execution at key points for inspection, and save/restore full orchestrator state with checkpoints. {% .lead %}

---

## Breakpoints

Breakpoints pause execution at specific lifecycle points so you can inspect state, modify input, or skip steps entirely.

### Breakpoint Types

**Single-agent types:**

| Type | When it fires |
|------|---------------|
| `pre_input_guardrails` | Before input guardrails run |
| `pre_agent_run` | Before the agent executes |
| `pre_output_guardrails` | Before output guardrails run |
| `post_run` | After the agent completes |

**Multi-agent types (additional):**

| Type | When it fires |
|------|---------------|
| `pre_handoff` | Before an agent-to-agent handoff |
| `pre_pattern_step` | Before each step in a pattern execution |

### Configuration

```typescript
import { createAgentOrchestrator } from '@directive-run/ai';
import type { BreakpointConfig } from '@directive-run/ai';

const orchestrator = createAgentOrchestrator({
  runner,
  debug: true,

  breakpoints: [
    { type: 'pre_agent_run', label: 'Before agent runs' },
    {
      type: 'pre_output_guardrails',
      when: (context) => context.input.includes('sensitive'),
      label: 'Sensitive content check',
    },
  ],

  onBreakpoint: (request) => {
    console.log(`Breakpoint hit: ${request.type} for ${request.agentId}`);
    console.log(`Input: ${request.input}`);
  },

  breakpointTimeoutMs: 300000,  // 5 minutes (default)
});
```

### Resuming and Cancelling

```typescript
// List pending breakpoints
const pending = orchestrator.getPendingBreakpoints();

for (const bp of pending) {
  console.log(`${bp.id}: ${bp.type} – ${bp.label}`);
}

// Resume with optional modifications
orchestrator.resumeBreakpoint(bp.id, {
  input: 'Modified input',  // Override the input
  skip: false,               // Set to true to skip the step entirely
});

// Cancel a breakpoint (aborts the operation)
orchestrator.cancelBreakpoint(bp.id, 'User cancelled');
```

### BreakpointConfig

```typescript
interface BreakpointConfig<T extends BreakpointType = BreakpointType> {
  type: T;
  when?: (context: BreakpointContext) => boolean;  // Conditional – fires only when true
  label?: string;                                   // Human-readable label
}
```

### BreakpointContext

```typescript
interface BreakpointContext {
  agentId: string;
  agentName: string;
  input: string;
  state: Record<string, unknown>;
  breakpointType: BreakpointType;
  patternId?: string;     // Set during pattern execution
  handoff?: HandoffRequest;  // Set during handoffs
}
```

### BreakpointRequest

```typescript
interface BreakpointRequest {
  id: string;
  type: BreakpointType;
  agentId: string;
  input: string;
  label?: string;
  requestedAt: number;
}
```

### BreakpointModifications

```typescript
interface BreakpointModifications {
  input?: string;   // Override the agent input
  skip?: boolean;   // Skip this step entirely
}
```

### Multi-Agent Breakpoints

The multi-agent orchestrator supports two additional breakpoint types (`pre_handoff` and `pre_pattern_step`) and can filter by agent or pattern ID:

```typescript
import { createMultiAgentOrchestrator } from '@directive-run/ai';

const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: { researcher: { agent: researcher }, writer: { agent: writer } },
  breakpoints: [
    { type: 'pre_handoff', agentIds: ['researcher'] },
    { type: 'pre_pattern_step', patternIds: ['pipeline'] },
  ],
  onBreakpoint: (req) => console.log('Breakpoint:', req.type, req.id),
});
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `breakpoints` | `BreakpointConfig[]` | `[]` | Breakpoint definitions |
| `onBreakpoint` | `(request) => void` | &ndash; | Callback when breakpoint fires |
| `breakpointTimeoutMs` | `number` | `300000` | Timeout before breakpoint auto-cancels (ms) |

Breakpoint history is capped at 200 entries (`MAX_BREAKPOINT_HISTORY`).

### Matching

```typescript
import { matchBreakpoint } from '@directive-run/ai';

const match = matchBreakpoint(breakpoints, 'pre_agent_run', context);
if (match) {
  console.log(`Matched: ${match.label}`);
}
```

---

## Checkpoints

Save and restore full orchestrator state &ndash; system facts, timeline events, memory, and orchestrator-specific local state.

### Creating Checkpoints

```typescript
const checkpoint = await orchestrator.checkpoint({ label: 'Before experiment' });

console.log(checkpoint.id);         // Unique ID
console.log(checkpoint.createdAt);  // Timestamp
console.log(checkpoint.label);      // 'Before experiment'
```

### Restoring Checkpoints

```typescript
orchestrator.restore(checkpoint, {
  restoreTimeline: true,  // Also restore timeline events (default: true)
});
```

### Checkpoint Shape

```typescript
interface Checkpoint {
  version: 1;
  id: string;
  createdAt: number;
  label?: string;
  systemExport: string;        // Serialized Directive System state
  timelineExport: string;      // Serialized timeline events
  localState: CheckpointLocalState;
  memoryExport: string | null; // Serialized memory state
  orchestratorType: 'single' | 'multi';
}
```

### Multi-Agent Local State

For multi-agent orchestrators, `localState` includes:

```typescript
interface MultiAgentCheckpointLocalState {
  type: 'multi';
  globalTokenCount: number;
  globalStatus: string;
  agentStates: Record<string, unknown>;
  handoffCounter: number;
  pendingHandoffs: HandoffRequest[];
  handoffResults: HandoffResult[];
  roundRobinCounters: Record<string, number>;
}
```

---

## Checkpoint Store

Persist checkpoints with the `CheckpointStore` interface:

```typescript
import { InMemoryCheckpointStore } from '@directive-run/ai';
import type { CheckpointStore } from '@directive-run/ai';

const store = new InMemoryCheckpointStore({ maxCheckpoints: 50 });

// Save
await store.save(checkpoint);

// Load
const loaded = await store.load(checkpoint.id);

// List all (returns { id, label, createdAt } summaries)
const all = await store.list();

// Delete
await store.delete(checkpoint.id);

// Clear all
await store.clear();
```

### Custom Store

Implement the `CheckpointStore` interface for persistent backends:

```typescript
const store: CheckpointStore = {
  save: async (checkpoint) => {
    await db.insert('checkpoints', checkpoint);

    return checkpoint.id;
  },
  load: async (id) => {
    return await db.findOne('checkpoints', { id });
  },
  list: async () => {
    return await db.find('checkpoints', {}, { select: ['id', 'label', 'createdAt'] });
  },
  delete: async (id) => {
    const deleted = await db.delete('checkpoints', { id });

    return deleted > 0;
  },
  clear: async () => {
    await db.deleteAll('checkpoints');
  },
};
```

### Validation

```typescript
import { validateCheckpoint, createCheckpointId } from '@directive-run/ai';

// Type guard with prototype pollution protection
if (validateCheckpoint(data)) {
  orchestrator.restore(data);
}

// Generate a unique checkpoint ID
const id = createCheckpointId();
```

---

## Timeline Integration

Breakpoints emit `breakpoint_hit` and `breakpoint_resumed` events on the debug timeline:

```typescript
const breakpointEvents = timeline.getEventsByType('breakpoint_hit');
const resumeEvents = timeline.getEventsByType('breakpoint_resumed');
```

---

## Next Steps

- [Debug Timeline](/docs/ai/debug-timeline) &ndash; Event recording and time-travel
- [DevTools](/docs/ai/devtools) &ndash; Visual debugging UI
- [Testing](/docs/ai/testing) &ndash; Breakpoint simulation in tests
