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
  schema: {
    facts: {
      count: t.number(),
    },
  },

  init: (facts) => {
    facts.count = 0;
  },

  derive: {
    isPositive: (facts) => facts.count > 0,
    isNegative: (facts) => facts.count < 0,
    isZero: (facts) => facts.count === 0,
  },
});

const system = createSystem({ module: counterModule });

// Increment
system.facts.count++;
console.log(system.facts.count); // 1
console.log(system.derive.isPositive); // true

// Decrement
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

  init: (facts) => {
    facts.count = 0;
    facts.min = 0;
    facts.max = 10;
  },

  derive: {
    canIncrement: (facts) => facts.count < facts.max,
    canDecrement: (facts) => facts.count > facts.min,
    percentage: (facts) =>
      ((facts.count - facts.min) / (facts.max - facts.min)) * 100,
  },

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

system.facts.count = 15;
await system.settle();
console.log(system.facts.count); // 10 (clamped to max)

system.facts.count = -5;
await system.settle();
console.log(system.facts.count); // 0 (clamped to min)
```

---

## Counter with Effects

Track counter changes:

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

  effects: {
    trackHistory: {
      filter: (facts, prev) => prev && prev.count !== facts.count,
      run: (facts, prev) => {
        // In a real app, you'd update facts in a resolver
        console.log(`Count changed: ${prev?.count} to ${facts.count}`);
      },
    },
    notifyMilestone: {
      filter: (facts) => facts.count % 10 === 0 && facts.count !== 0,
      run: (facts) => {
        console.log(`Milestone reached: ${facts.count}!`);
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
import { DirectiveProvider, useFacts, useDerive } from 'directive/react';

// Module
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

// System
const system = createSystem({ module: counterModule });

// Components
function Counter() {
  const { count } = useFacts();
  const { doubled, isEven } = useDerive();
  const setFacts = useFacts.set();

  return (
    <div className="counter">
      <h1>{count}</h1>
      <p>Doubled: {doubled}</p>
      <p>Is even: {isEven ? 'Yes' : 'No'}</p>
      <div className="buttons">
        <button onClick={() => setFacts({ count: count - 1 })}>-</button>
        <button onClick={() => setFacts({ count: count + 1 })}>+</button>
        <button onClick={() => setFacts({ count: 0 })}>Reset</button>
      </div>
    </div>
  );
}

function App() {
  return (
    <DirectiveProvider system={system}>
      <Counter />
    </DirectiveProvider>
  );
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

  init: (facts) => {
    facts.count = null;
    facts.loading = false;
    facts.error = null;
  },

  constraints: {
    needsInitialValue: {
      when: (facts) => facts.count === null && !facts.loading,
      require: { type: "FETCH_INITIAL_COUNT" },
    },
  },

  resolvers: {
    fetchInitialCount: {
      requirement: "FETCH_INITIAL_COUNT",
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
      action: t.literal("increment", "decrement", "reset").nullable(),
    },
  },

  init: (facts) => {
    facts.count = 0;
    facts.step = 1;
    facts.action = null;
  },

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
5. **Effects** - Side effects on state changes (`trackHistory`)

---

## Next Steps

- **[Data Fetching Example](/docs/examples/data-fetching)** - Async patterns
- **[Form Validation](/docs/examples/form-validation)** - Complex constraints
- **[Quick Start](/docs/quick-start)** - Build your first real module
