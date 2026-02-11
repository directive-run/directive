---
title: Migrating from XState
description: Step-by-step guide to migrate from XState to Directive with before/after comparisons.
---

Migrate your XState state machines to Directive. {% .lead %}

---

## Key Differences

| XState | Directive |
|--------|-----------|
| States + Transitions | Facts (direct values) |
| Guards | Constraints (when conditions) |
| Actions | Effects + Resolvers |
| Services | Resolvers (async) |
| Context | Facts |

---

## When to Migrate

**Keep XState when:**
- UI flows with strict state sequences (wizards, forms)
- Finite state modeling is the core abstraction
- Visualizing state machines is important

**Use Directive when:**
- Data-driven constraints ("if X, then Y must happen")
- Complex dependency graphs
- Automatic resolution of requirements
- Less boilerplate for common patterns

---

## Before: XState Traffic Light

```typescript
// Before: XState approach – define states, transitions, and timed events
import { createMachine, interpret } from 'xstate';

const trafficLightMachine = createMachine({
  id: 'trafficLight',
  initial: 'red',
  context: { elapsed: 0 },

  // Each state defines its own transitions and timing
  states: {
    red: {
      after: { 30000: 'green' },   // Auto-transition after 30s
      entry: 'resetTimer',          // Run action on state entry
    },
    green: {
      after: { 25000: 'yellow' },  // Auto-transition after 25s
      entry: 'resetTimer',
    },
    yellow: {
      after: { 5000: 'red' },      // Auto-transition after 5s
      entry: 'resetTimer',
    },
  },
}, {
  // Actions are defined separately and referenced by name
  actions: {
    resetTimer: (context) => { context.elapsed = 0 },
  },
});

// Interpret the machine to create a running service
const service = interpret(trafficLightMachine).start();
```

## After: Directive Traffic Light

```typescript
// After: Directive approach – constraints declare when transitions should happen
import { createModule, createSystem, t } from 'directive';

const trafficLightModule = createModule("traffic-light", {
  schema: {
    facts: {
      phase: t.string<'red' | 'green' | 'yellow'>(),
      elapsed: t.number(),
    },
  },

  init: (facts) => {
    facts.phase = 'red';
    facts.elapsed = 0;
  },

  // Each constraint declares a condition that triggers a transition
  constraints: {
    redToGreen: {
      when: (facts) => facts.phase === 'red' && facts.elapsed >= 30,
      require: { type: 'TRANSITION', to: 'green' },
    },

    greenToYellow: {
      when: (facts) => facts.phase === 'green' && facts.elapsed >= 25,
      require: { type: 'TRANSITION', to: 'yellow' },
    },

    yellowToRed: {
      when: (facts) => facts.phase === 'yellow' && facts.elapsed >= 5,
      require: { type: 'TRANSITION', to: 'red' },
    },
  },

  // One resolver handles all transitions – the requirement carries the data
  resolvers: {
    transition: {
      requirement: 'TRANSITION',
      resolve: (req, context) => {
        context.facts.phase = req.to;
        context.facts.elapsed = 0;
      },
    },
  },
});
```

---

## Migrating Guards to Constraints

### XState Guards

```typescript
// Before: XState guards – conditions that gate transitions between states
const paymentMachine = createMachine({
  states: {
    idle: {
      on: {
        SUBMIT: {
          target: 'processing',
          cond: 'isValidAmount',   // Guard blocks transition if false
        },
      },
    },

    processing: {
      // Invoke an async service, route to success or failure state
      invoke: {
        src: 'processPayment',
        onDone: 'success',
        onError: 'failed',
      },
    },
  },
}, {
  // Guards are defined separately and referenced by string name
  guards: {
    isValidAmount: (context) => context.amount > 0,
  },
});
```

### Directive Constraints

```typescript
// After: Directive constraints – guard logic and trigger logic live together
const paymentModule = createModule("payment", {
  schema: {
    facts: {
      amount: t.number(),
      status: t.string<'idle' | 'processing' | 'success' | 'failed'>(),
      shouldSubmit: t.boolean(),
    },
  },

  constraints: {
    processPayment: {
      // All conditions inline – combines guard + trigger in one place
      when: (facts) =>
        facts.shouldSubmit &&
        facts.amount > 0 &&
        facts.status === 'idle',
      require: { type: 'PROCESS_PAYMENT' },
    },
  },

  resolvers: {
    processPayment: {
      requirement: 'PROCESS_PAYMENT',
      resolve: async (req, context) => {
        context.facts.status = 'processing';

        try {
          await api.processPayment(context.facts.amount);
          context.facts.status = 'success';
        } catch {
          context.facts.status = 'failed';
        }

        // Reset the trigger flag after processing
        context.facts.shouldSubmit = false;
      },
    },
  },
});
```

---

## Migrating Services to Resolvers

### XState Services

```typescript
// Before: XState invoked service – async work tied to a specific state
const userMachine = createMachine({
  states: {
    loading: {
      // Invoke runs when entering this state
      invoke: {
        id: 'fetchUser',
        src: (context) => fetchUser(context.userId),

        // Route to different states based on outcome
        onDone: {
          target: 'loaded',
          actions: assign({ user: (_, event) => event.data }),
        },
        onError: {
          target: 'error',
          actions: assign({ error: (_, event) => event.data }),
        },
      },
    },
  },
});
```

### Directive Resolvers

```typescript
// After: Directive resolver – constraint triggers fetch, resolver handles async + retry
const userModule = createModule("user", {
  schema: {
    facts: {
      userId: t.number(),
      user: t.object<User>().nullable(),
      error: t.string().nullable(),
      loading: t.boolean(),
    },
  },

  // Constraint declares when user data is needed
  constraints: {
    needsUser: {
      when: (facts) => facts.userId > 0 && !facts.user && !facts.loading,
      require: { type: 'FETCH_USER' },
    },
  },

  // Resolver fulfills the requirement with built-in retry support
  resolvers: {
    fetchUser: {
      requirement: 'FETCH_USER',
      retry: { attempts: 3, backoff: 'exponential' }, // Automatic retry on failure

      resolve: async (req, context) => {
        context.facts.loading = true;

        try {
          context.facts.user = await fetchUser(context.facts.userId);
          context.facts.error = null;
        } catch (e) {
          context.facts.error = e.message;
        } finally {
          context.facts.loading = false;
        }
      },
    },
  },
});
```

---

## Migrating Actions to Effects

### XState Actions

```typescript
// Before: XState entry/exit actions – side effects tied to state transitions
const formMachine = createMachine({
  states: {
    editing: {
      entry: 'focusInput',     // Run when entering this state
      exit: 'validateForm',    // Run when leaving this state
      on: { SUBMIT: 'submitting' },
    },
  },
}, {
  // Actions defined separately and referenced by name
  actions: {
    focusInput: () => document.getElementById('input')?.focus(),
    validateForm: (context) => console.log('Validating...'),
  },
});
```

### Directive Effects

```typescript
// After: Directive effects – react to fact changes, not state transitions
const formModule = createModule("form", {
  schema: {
    facts: {
      status: t.string<'editing' | 'submitting'>(),
    },
  },

  effects: {
    // Fires whenever `status` changes – replaces XState's entry action
    onEditing: {
      deps: ['status'],
      run: (facts) => {
        if (facts.status === 'editing') {
          document.getElementById('input')?.focus();
        }
      },
    },

    // Compare previous and current values – replaces XState's exit action
    onSubmit: {
      deps: ['status'],
      run: (facts, prev) => {
        if (prev?.status === 'editing' && facts.status === 'submitting') {
          console.log('Validating...');
        }
      },
    },
  },
});
```

---

## Hierarchical States to Flat Facts

### XState Nested States

```typescript
// Before: XState hierarchical states – nested state trees model compound conditions
const machine = createMachine({
  states: {
    authenticated: {
      initial: 'idle',
      // Child states only accessible when authenticated
      states: {
        idle: {},
        loading: {},
        error: {},
      },
    },

    unauthenticated: {},
  },
});
```

### Directive Flat Facts

```typescript
// After: Directive – flat independent facts, derive compound state when needed
const authModule = createModule("auth", {
  schema: {
    facts: {
      // Two independent facts instead of a nested state tree
      isAuthenticated: t.boolean(),
      dataStatus: t.string<'idle' | 'loading' | 'error'>(),
    },
  },

  derive: {
    // Reconstruct the compound state from flat facts if needed
    currentState: (facts) => {
      if (!facts.isAuthenticated) return 'unauthenticated';
      return `authenticated.${facts.dataStatus}`;
    },
  },
});
```

---

## Parallel States to Independent Facts

### XState Parallel States

```typescript
// Before: XState parallel states – two independent state machines running simultaneously
const machine = createMachine({
  type: 'parallel',  // Both regions active at the same time

  states: {
    // Upload region with its own state flow
    upload: {
      initial: 'idle',
      states: { idle: {}, uploading: {}, complete: {} },
    },

    // Validation region runs independently of upload
    validation: {
      initial: 'pending',
      states: { pending: {}, valid: {}, invalid: {} },
    },
  },
});
```

### Directive Independent Facts

```typescript
// After: Directive – facts are naturally independent, no parallel config needed
const fileModule = createModule("file", {
  schema: {
    facts: {
      // Each fact is independent – no need for parallel state regions
      uploadStatus: t.string<'idle' | 'uploading' | 'complete'>(),
      validationStatus: t.string<'pending' | 'valid' | 'invalid'>(),
    },
  },

  // Each constraint operates on its own facts – they resolve independently
  constraints: {
    needsUpload: {
      when: (facts) => facts.uploadStatus === 'idle',
      require: { type: 'UPLOAD' },
    },

    needsValidation: {
      when: (facts) => facts.validationStatus === 'pending',
      require: { type: 'VALIDATE' },
    },
  },
});
```

---

## Next Steps

- See the [Quick Start](/docs/quick-start) for a complete tutorial
- See [Constraints](/docs/constraints) for declarative logic
- See [Resolvers](/docs/resolvers) for async handling
