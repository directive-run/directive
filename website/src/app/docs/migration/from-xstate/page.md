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
// XState
import { createMachine, interpret } from 'xstate';

const trafficLightMachine = createMachine({
  id: 'trafficLight',
  initial: 'red',
  context: { elapsed: 0 },
  states: {
    red: {
      after: { 30000: 'green' },
      entry: 'resetTimer',
    },
    green: {
      after: { 25000: 'yellow' },
      entry: 'resetTimer',
    },
    yellow: {
      after: { 5000: 'red' },
      entry: 'resetTimer',
    },
  },
}, {
  actions: {
    resetTimer: (context) => { context.elapsed = 0 },
  },
});

const service = interpret(trafficLightMachine).start();
```

## After: Directive Traffic Light

```typescript
// Directive
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
// XState with guards
const paymentMachine = createMachine({
  states: {
    idle: {
      on: {
        SUBMIT: {
          target: 'processing',
          cond: 'isValidAmount',
        },
      },
    },
    processing: {
      invoke: {
        src: 'processPayment',
        onDone: 'success',
        onError: 'failed',
      },
    },
  },
}, {
  guards: {
    isValidAmount: (context) => context.amount > 0,
  },
});
```

### Directive Constraints

```typescript
// Directive constraints
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
      // Guard logic in constraint condition
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
// XState invoked service
const userMachine = createMachine({
  states: {
    loading: {
      invoke: {
        id: 'fetchUser',
        src: (context) => fetchUser(context.userId),
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
// Directive resolver
const userModule = createModule("user", {
  schema: {
    facts: {
      userId: t.number(),
      user: t.object<User>().nullable(),
      error: t.string().nullable(),
      loading: t.boolean(),
    },
  },
  constraints: {
    needsUser: {
      when: (facts) => facts.userId > 0 && !facts.user && !facts.loading,
      require: { type: 'FETCH_USER' },
    },
  },
  resolvers: {
    fetchUser: {
      requirement: 'FETCH_USER',
      retry: { attempts: 3, backoff: 'exponential' },
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
// XState entry/exit actions
const formMachine = createMachine({
  states: {
    editing: {
      entry: 'focusInput',
      exit: 'validateForm',
      on: { SUBMIT: 'submitting' },
    },
  },
}, {
  actions: {
    focusInput: () => document.getElementById('input')?.focus(),
    validateForm: (context) => console.log('Validating...'),
  },
});
```

### Directive Effects

```typescript
// Directive effects
const formModule = createModule("form", {
  schema: {
    facts: {
      status: t.string<'editing' | 'submitting'>(),
    },
  },
  effects: {
    onEditing: {
      deps: ['status'],
      run: (facts) => {
        if (facts.status === 'editing') {
          document.getElementById('input')?.focus();
        }
      },
    },
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
// XState hierarchical states
const machine = createMachine({
  states: {
    authenticated: {
      initial: 'idle',
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
// Directive - flat facts with derivations
const authModule = createModule("auth", {
  schema: {
    facts: {
      isAuthenticated: t.boolean(),
      dataStatus: t.string<'idle' | 'loading' | 'error'>(),
    },
  },
  derive: {
    // Compose state from facts
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
// XState parallel
const machine = createMachine({
  type: 'parallel',
  states: {
    upload: {
      initial: 'idle',
      states: { idle: {}, uploading: {}, complete: {} },
    },
    validation: {
      initial: 'pending',
      states: { pending: {}, valid: {}, invalid: {} },
    },
  },
});
```

### Directive Independent Facts

```typescript
// Directive - naturally parallel
const fileModule = createModule("file", {
  schema: {
    facts: {
      uploadStatus: t.string<'idle' | 'uploading' | 'complete'>(),
      validationStatus: t.string<'pending' | 'valid' | 'invalid'>(),
    },
  },
  // Both can be constrained independently
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
