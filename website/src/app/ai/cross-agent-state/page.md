---
title: Cross-Agent State
description: Cross-agent derivations and shared scratchpad for reactive multi-agent state coordination.
---

Reactive derived state across agents and a shared scratchpad for coordination. {% .lead %}

Cross-agent state lets you compute values from the combined state of all agents and share mutable state through a scratchpad &ndash; both integrated with the debug timeline.

---

## Cross-Agent Derivations

Define derived values that react to changes across any registered agent's state:

```typescript
import { createMultiAgentOrchestrator } from '@directive-run/ai';

const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: {
    researcher: { agent: researcher },
    writer: { agent: writer },
    reviewer: { agent: reviewer },
  },

  derive: {
    totalTokens: (snapshot) => {
      let sum = 0;
      for (const [, agentState] of Object.entries(snapshot.agents)) {
        sum += agentState.totalTokens ?? 0;
      }

      return sum;
    },

    allIdle: (snapshot) =>
      Object.values(snapshot.agents).every(
        (s) => s.status === 'idle' || s.status === 'completed'
      ),

    progress: (snapshot) => {
      const agents = Object.values(snapshot.agents);
      const completed = agents.filter((s) => s.status === 'completed').length;

      return `${completed}/${agents.length} agents done`;
    },
  },
});
```

### Reading Derived Values

```typescript
// Read all derived values (frozen record)
const derived = orchestrator.derived;
console.log(derived.totalTokens);
console.log(derived.allIdle);
console.log(derived.progress);
```

### Subscribing to Changes

```typescript
const unsubscribe = orchestrator.onDerivedChange((id, value) => {
  console.log(`Derivation ${id} changed to:`, value);
});

// Later
unsubscribe();
```

### CrossAgentSnapshot

The snapshot passed to derivation functions contains:

```typescript
interface CrossAgentSnapshot {
  agents: Record<string, AgentState>;            // All agent states
  coordinator: { globalTokens: number; status: string };  // Coordinator facts
  scratchpad?: Record<string, unknown>;          // Current scratchpad state
}
```

### Timeline Integration

Derivation changes emit `derivation_update` events on the debug timeline, recording which derivation changed and its new value.

---

## Shared Scratchpad

A key-value store shared across all agents for mutable coordination state:

```typescript
const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: { /* ... */ },

  scratchpad: {
    init: {
      taskList: [],
      completedCount: 0,
      lastUpdate: null,
    },
  },
});
```

### Reading and Writing

```typescript
const pad = orchestrator.scratchpad!;

// Basic operations
pad.set('taskList', ['research', 'write', 'review']);
pad.get('taskList');      // ['research', 'write', 'review']
pad.has('taskList');       // true
pad.delete('lastUpdate');

// Batch update (merges into scratchpad)
pad.update({ completedCount: 1 });

// Read all values
const all = pad.getAll();
// { taskList: [...], completedCount: 1 }

// Reset to initial values
pad.reset();
```

### Subscribing to Changes

```typescript
// Subscribe to specific keys
const unsub = pad.subscribe(['completedCount', 'taskList'], (key, value) => {
  console.log(`Scratchpad: ${String(key)} =`, value);
});

// Subscribe to all changes
const unsub2 = pad.onChange((key, value) => {
  console.log(`Changed: ${key} =`, value);
});
```

### Scratchpad API

| Method | Returns | Description |
|--------|---------|-------------|
| `get(key)` | `T` | Read a value |
| `set(key, value)` | `void` | Write a value |
| `has(key)` | `boolean` | Check if key exists |
| `delete(key)` | `void` | Remove a key |
| `update(values)` | `void` | Merge partial values into scratchpad |
| `getAll()` | `T` | Read all values |
| `subscribe(keys, cb)` | `() => void` | Subscribe to specific key changes |
| `onChange(cb)` | `() => void` | Subscribe to all changes |
| `reset()` | `void` | Reset to initial values |

### Timeline Integration

Scratchpad mutations emit `scratchpad_update` events on the debug timeline with the key and new value.

---

## Reactive Agent Triggering

Combine derivations with `derivedConstraint` to trigger agent runs when derived state changes:

```typescript
import { derivedConstraint } from '@directive-run/ai';

const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: {
    researcher: { agent: researcher },
    writer: { agent: writer },
    optimizer: { agent: optimizer },
  },

  derive: {
    totalCost: (snapshot) => {
      let sum = 0;
      for (const [, s] of Object.entries(snapshot.agents)) {
        sum += s.totalTokens ?? 0;
      }

      return sum * 0.00001;  // Estimated cost
    },
  },

  constraints: {
    costAlert: derivedConstraint(
      'totalCost',
      (value) => (value as number) > 0.50,
      { agent: 'optimizer', input: (value) => `Reduce token usage – current cost: $${value}`, priority: 100 }
    ),
  },
});
```

When `totalCost` crosses `$0.50`, the optimizer agent is automatically triggered.

---

## Next Steps

- [Multi-Agent Orchestrator](/ai/multi-agent) &ndash; Setup and configuration
- [Execution Patterns](/ai/patterns) &ndash; Coordinating agent execution
- [Communication](/ai/communication) &ndash; Agent-to-agent messaging
- [DevTools](/ai/devtools) &ndash; Visualize state in the DevTools UI
