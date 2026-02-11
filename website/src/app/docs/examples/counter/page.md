---
title: Counter Example
description: A simple counter example demonstrating Directive's core concepts - facts, derivations, and constraints.
---

The classic counter example, reimagined with constraints. {% .lead %}

---

## Basic Counter

Let's start with a simple counter that increments and decrements:

```typescript
import { createModule, createSystem, t } from 'directive';

const counterModule = createModule("counter", {
  // Define the shape of our state
  schema: {
    facts: {
      count: t.number(),
    },
  },

  // Set starting values when the module initializes
  init: (facts) => {
    facts.count = 0;
  },

  // Derivations auto-track which facts they read –no manual deps needed
  derive: {
    isPositive: (facts) => facts.count > 0,
    isNegative: (facts) => facts.count < 0,
    isZero: (facts) => facts.count === 0,
  },
});

// Wire up and start the runtime
const system = createSystem({ module: counterModule });
system.start();

// Mutate facts directly –derivations recompute automatically
system.facts.count++;
console.log(system.facts.count); // 1
console.log(system.derive.isPositive); // true

// Derivations stay in sync no matter how facts change
system.facts.count -= 2;
console.log(system.facts.count); // -1
console.log(system.derive.isNegative); // true
```

---

## Counter with Limits

Add constraints to enforce min/max values:

```typescript
const boundedCounterModule = createModule("bounded-counter", {
  schema: {
    facts: {
      count: t.number(),
      min: t.number(),
      max: t.number(),
    },
  },

  // Configure the allowed range alongside the count
  init: (facts) => {
    facts.count = 0;
    facts.min = 0;
    facts.max = 10;
  },

  // UI helpers –disable buttons when limits are reached
  derive: {
    canIncrement: (facts) => facts.count < facts.max,
    canDecrement: (facts) => facts.count > facts.min,
    percentage: (facts) =>
      ((facts.count - facts.min) / (facts.max - facts.min)) * 100,
  },

  // Constraints declare *what must be true* –they fire when violated
  constraints: {
    enforceMax: {
      when: (facts) => facts.count > facts.max,
      require: { type: "CLAMP_TO_MAX" },
    },
    enforceMin: {
      when: (facts) => facts.count < facts.min,
      require: { type: "CLAMP_TO_MIN" },
    },
  },

  // Resolvers describe *how to fix it* when a constraint raises a requirement
  resolvers: {
    clampToMax: {
      requirement: "CLAMP_TO_MAX",
      resolve: (_, context) => {
        context.facts.count = context.facts.max;
      },
    },
    clampToMin: {
      requirement: "CLAMP_TO_MIN",
      resolve: (_, context) => {
        context.facts.count = context.facts.min;
      },
    },
  },
});
```

Now the counter automatically clamps to bounds:

```typescript
const system = createSystem({ module: boundedCounterModule });
system.start();

// Set count beyond the upper bound
system.facts.count = 15;
// settle() waits for all constraints and resolvers to finish
await system.settle();
console.log(system.facts.count); // 10 (clamped to max)

// Same thing on the lower end –the runtime enforces the floor
system.facts.count = -5;
await system.settle();
console.log(system.facts.count); // 0 (clamped to min)
```

---

## Counter with Effects

Log counter changes:

```typescript
const counterWithEffectsModule = createModule("counter-effects", {
  schema: {
    facts: {
      count: t.number(),
      history: t.array(t.object<{ value: number; timestamp: number }>()),
    },
  },

  init: (facts) => {
    facts.count = 0;
    facts.history = [];
  },

  // Effects are fire-and-forget side effects –they never mutate facts
  effects: {
    // Log every change by comparing current and previous values
    logChanges: {
      deps: ['count'],
      run: (facts, prev) => {
        if (prev && prev.count !== facts.count) {
          console.log(`Count changed: ${prev.count} to ${facts.count}`);
        }
      },
    },

    // Celebrate round numbers (10, 20, 30...)
    notifyMilestone: {
      deps: ['count'],
      run: (facts) => {
        if (facts.count % 10 === 0 && facts.count !== 0) {
          console.log(`Milestone reached: ${facts.count}!`);
        }
      },
    },
  },
});
```

---

## React Counter

Here's a complete React implementation:

```tsx
import { createModule, createSystem, t } from 'directive';
import { useFact, useDerived } from 'directive/react';

// --- Module definition ---

const counterModule = createModule("counter", {
  schema: {
    facts: {
      count: t.number(),
    },
  },
  init: (facts) => {
    facts.count = 0;
  },
  derive: {
    doubled: (facts) => facts.count * 2,
    isEven: (facts) => facts.count % 2 === 0,
  },
});

// --- System initialization (happens once, outside components) ---

const system = createSystem({ module: counterModule });
system.start();

// --- React component wired to the Directive system ---

function Counter() {
  // useFact subscribes to a single fact –re-renders only when it changes
  const count = useFact(system, 'count');

  // useDerived subscribes to computed values
  const doubled = useDerived(system, 'doubled');
  const isEven = useDerived(system, 'isEven');

  return (
    <div className="counter">
      <h1>{count}</h1>
      <p>Doubled: {doubled}</p>
      <p>Is even: {isEven ? 'Yes' : 'No'}</p>

      {/* Mutate facts directly from event handlers */}
      <div className="buttons">
        <button onClick={() => { system.facts.count = count - 1 }}>-</button>
        <button onClick={() => { system.facts.count = count + 1 }}>+</button>
        <button onClick={() => { system.facts.count = 0 }}>Reset</button>
      </div>
    </div>
  );
}

function App() {
  return <Counter />;
}
```

---

## Async Counter

A counter that fetches the initial value:

```typescript
const asyncCounterModule = createModule("async-counter", {
  schema: {
    facts: {
      count: t.number().nullable(),
      loading: t.boolean(),
      error: t.string().nullable(),
    },
  },

  // Start with null count –the constraint below will trigger a fetch
  init: (facts) => {
    facts.count = null;
    facts.loading = false;
    facts.error = null;
  },

  // When count is missing and nothing is in-flight, fetch it automatically
  constraints: {
    needsInitialValue: {
      when: (facts) => facts.count === null && !facts.loading,
      require: { type: "FETCH_INITIAL_COUNT" },
    },
  },

  resolvers: {
    fetchInitialCount: {
      requirement: "FETCH_INITIAL_COUNT",
      // Retry up to 3 times with exponential backoff on failure
      retry: { attempts: 3, backoff: "exponential" },
      resolve: async (_, context) => {
        context.facts.loading = true;
        try {
          const response = await fetch('/api/counter');
          const { count } = await response.json();
          context.facts.count = count;
        } catch (e) {
          context.facts.error = e instanceof Error ? e.message : 'Unknown error';
        } finally {
          context.facts.loading = false;
        }
      },
    },
  },

  // Derive a single status string from the three loading/error/count facts
  derive: {
    status: (facts) => {
      if (facts.loading) return 'loading';
      if (facts.error) return 'error';
      if (facts.count !== null) return 'ready';
      return 'idle';
    },
  },
});
```

---

## Step Counter

A counter that increments by a configurable step:

```typescript
const stepCounterModule = createModule("step-counter", {
  schema: {
    facts: {
      count: t.number(),
      step: t.number(),
      // A command-style fact: set it to trigger the matching constraint
      action: t.literal("increment", "decrement", "reset").nullable(),
    },
  },

  init: (facts) => {
    facts.count = 0;
    facts.step = 1;
    facts.action = null;
  },

  // Each action value maps to a distinct requirement
  constraints: {
    handleIncrement: {
      when: (facts) => facts.action === "increment",
      require: { type: "INCREMENT" },
    },
    handleDecrement: {
      when: (facts) => facts.action === "decrement",
      require: { type: "DECREMENT" },
    },
    handleReset: {
      when: (facts) => facts.action === "reset",
      require: { type: "RESET" },
    },
  },

  // Each resolver applies the step size, then clears the action to reset the constraint
  resolvers: {
    increment: {
      requirement: "INCREMENT",
      resolve: (_, context) => {
        context.facts.count += context.facts.step;
        context.facts.action = null;
      },
    },
    decrement: {
      requirement: "DECREMENT",
      resolve: (_, context) => {
        context.facts.count -= context.facts.step;
        context.facts.action = null;
      },
    },
    reset: {
      requirement: "RESET",
      resolve: (_, context) => {
        context.facts.count = 0;
        context.facts.action = null;
      },
    },
  },
});
```

---

## Key Takeaways

This simple counter demonstrates:

1. **Facts** - Basic state (`count`)
2. **Derivations** - Computed values (`doubled`, `isEven`, `canIncrement`)
3. **Constraints** - Rules that generate requirements (`enforceMax`, `enforceMin`)
4. **Resolvers** - Actions that fulfill requirements (`clampToMax`)
5. **Effects** - Side effects on state changes (`logChanges`)

---

## Next Steps

- **[Data Fetching Example](/docs/examples/data-fetching)** - Async patterns
- **[Form Validation](/docs/examples/form-validation)** - Complex constraints
- **[Quick Start](/docs/quick-start)** - Build your first real module
