---
title: XState Bridge
description: Sync Directive with XState machines for hybrid state management.
---

Use XState machines alongside Directive systems. {% .lead %}

---

## Installation

```bash
npm install directive directive/bridges xstate
```

---

## Basic Integration

Connect XState machine context to Directive:

```typescript
import { createXStateBridge } from 'directive/bridges';
import { createMachine, interpret } from 'xstate';

const machine = createMachine({
  id: 'auth',
  initial: 'idle',
  context: { user: null },
  states: {
    idle: { on: { LOGIN: 'authenticating' } },
    authenticating: { on: { SUCCESS: 'authenticated' } },
    authenticated: {},
  },
});

const service = interpret(machine).start();

const bridge = createXStateBridge({
  system,
  service,
  sync: {
    context: {
      'user': 'user',
    },
    state: 'authState', // Store current state in fact
  },
});
```

---

## Send Events

Trigger XState events from Directive:

```typescript
const bridge = createXStateBridge({
  system,
  service,
  events: {
    LOGIN_REQUESTED: () => ({ type: 'LOGIN' }),
    LOGOUT_REQUESTED: () => ({ type: 'LOGOUT' }),
  },
});

// Directive event triggers XState transition
system.dispatch("LOGIN_REQUESTED");
```

---

## React to State Changes

Update Directive when XState transitions:

```typescript
const bridge = createXStateBridge({
  system,
  service,
  onTransition: (state, context) => {
    context.facts.currentState = state.value;
    context.facts.user = state.context.user;
  },
});
```

---

## Hybrid Approach

Use XState for UI flows, Directive for data:

```typescript
// XState handles wizard steps
const wizardMachine = createMachine({
  states: {
    step1: { on: { NEXT: 'step2' } },
    step2: { on: { NEXT: 'step3', BACK: 'step1' } },
    step3: { on: { SUBMIT: 'complete' } },
  },
});

// Directive handles form data
const formModule = createModule("form", {
  schema: {
    facts: {
      name: t.string(),
      email: t.string(),
      preferences: t.object<Preferences>(),
    },
  },
});
```

---

## Next Steps

- See From XState migration guide
- See Constraints for declarative logic
- See Module and System for setup
