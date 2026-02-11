---
title: XState Bridge
description: Use XState machines as Directive resolvers, sync actor state to facts, and coordinate multiple machines with constraint-driven orchestration.
---

XState handles individual state machine behavior. Directive coordinates multiple machines with facts-based constraints. {% .lead %}

---

## Installation

```bash
npm install directive xstate
```

Import from `directive/xstate` (not `directive/bridges`):

```typescript
import { xstateResolver, createActorBridge, createActorCoordinator } from 'directive/xstate';
import { createActor } from 'xstate';
```

---

## xstateResolver

Wraps an XState machine as a Directive resolver. When a matching requirement fires, the resolver starts an actor, subscribes to its state, and resolves when the actor reaches a final state.

```typescript
import { createModule, createSystem, t } from 'directive';
import { createMachine, createActor } from 'xstate';
import { xstateResolver } from 'directive/xstate';

// Define the XState machine for payment processing
const paymentMachine = createMachine({
  id: 'payment',
  initial: 'processing',
  context: { transactionId: '' },
  states: {
    processing: {
      invoke: {
        src: 'processPayment',
        onDone: { target: 'success', actions: 'assignTransaction' },
        onError: 'failed',
      },
    },
    success: { type: 'final' },
    failed: { type: 'final' },
  },
});

const checkout = createModule('checkout', {
  schema: {
    facts: {
      amount: t.number(),
      paymentComplete: t.boolean(),
      orderId: t.string().nullable(),
      paymentError: t.string().nullable(),
    },
  },

  init: (facts) => {
    facts.amount = 0;
    facts.paymentComplete = false;
    facts.orderId = null;
    facts.paymentError = null;
  },

  constraints: {
    // Start payment when there's an amount and payment hasn't completed
    startPayment: {
      when: (facts) => facts.amount > 0 && !facts.paymentComplete,
      require: (facts) => ({ type: 'START_PAYMENT', amount: facts.amount }),
    },
  },

  resolvers: {
    // Wrap the XState machine as a Directive resolver
    payment: xstateResolver({
      machine: paymentMachine,
      createActor,
      requirement: (req): req is { type: 'START_PAYMENT'; amount: number } =>
        req.type === 'START_PAYMENT',

      // Deduplicate by amount to prevent duplicate payment flows
      key: (req) => `payment-${req.amount}`,

      // Pass requirement data as machine input
      input: (req) => ({ amount: req.amount }),

      // Handle final states
      onDone: (output, ctx) => {
        ctx.facts.paymentComplete = true;
        ctx.facts.orderId = output?.transactionId ?? null;
      },
      onError: (error, ctx) => {
        ctx.facts.paymentError = String(error);
      },

      // Log each state transition
      onTransition: (snapshot, ctx) => {
        console.log('Payment state:', snapshot.value);
      },
      timeout: 30000,
    }),
  },
});
```

### Options

| Option | Type | Description |
|--------|------|-------------|
| `machine` | `MachineLike` | The XState machine definition |
| `createActor` | `CreateActorFn` | XState's `createActor` function (passed in, not imported by the adapter) |
| `requirement` | `(req) => req is R` | Type guard to match requirements |
| `key` | `(req) => string` | Custom deduplication key. Defaults to `xstate:{machineId}:{req.type}` |
| `input` | `(req, ctx) => unknown` | Generate machine input from the requirement |
| `onDone` | `(output, ctx, req) => void` | Called when the machine reaches a final state |
| `onError` | `(error, ctx, req) => void` | Called when the machine errors |
| `onTransition` | `(snapshot, ctx, req) => void` | Called on every state transition |
| `timeout` | `number` | Timeout in ms |

The resolver context (`ctx`) provides `facts` (read/write) and `signal` (AbortSignal). If the signal is aborted, the actor is stopped automatically.

---

## Actor Bridge

`createActorBridge` creates a bi-directional sync between a single XState actor and a Directive system. The actor's state is mirrored into Directive facts so you can write constraints that react to machine transitions.

```typescript
import { createMachine, createActor } from 'xstate';
import { createActorBridge } from 'directive/xstate';

const trafficLightMachine = createMachine({
  id: 'trafficLight',
  initial: 'red',
  states: {
    red: { on: { TIMER: 'green' } },
    green: { on: { TIMER: 'yellow' } },
    yellow: { on: { TIMER: 'red' } },
  },
});

const bridge = createActorBridge({
  machine: trafficLightMachine,
  createActor,
});

// Actor state is automatically synced to Directive facts
console.log(bridge.facts.actorStatus); // "active"
console.log(bridge.facts.actorValue);  // "red"

// Send events to the underlying XState actor
bridge.send({ type: 'TIMER' });
// bridge.facts.actorValue is now "green"

// Subscribe to state changes through the Directive system
bridge.system.watch('actorValue', (value) => {
  console.log('Transitioned to:', value);
});

// Clean up the bridge, actor, and system
bridge.destroy();
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `machine` | `MachineLike` | required | The XState machine |
| `createActor` | `CreateActorFn` | required | XState's `createActor` function |
| `input` | `unknown` | `undefined` | Initial input for the machine |
| `plugins` | `Plugin[]` | `[]` | Directive plugins |
| `debug` | `boolean` | `false` | Enable time-travel debugging |
| `autoStart` | `boolean` | `true` | Automatically start the actor and system |

### Synced Facts

The bridge exposes these facts:

| Fact | Type | Description |
|------|------|-------------|
| `actorStatus` | `"active" \| "done" \| "error" \| "stopped"` | Current actor lifecycle status |
| `actorValue` | `string \| object` | Current state value (e.g. `"red"`, or `{ parent: "child" }` for nested states) |
| `actorContext` | `TContext` | The actor's context object |
| `actorOutput` | `TOutput \| undefined` | Output from a final state |
| `actorError` | `string \| null` | Error message if the actor errored |

### Lifecycle

```typescript
const bridge = createActorBridge({
  machine: myMachine,
  createActor,
  autoStart: false, // Don't start immediately
});

bridge.start();   // Start the actor, system, and sync
bridge.stop();    // Stop sync, system, and actor
bridge.destroy(); // Stop everything and release resources
```

---

## Multi-Actor Coordination

`createActorCoordinator` orchestrates multiple XState actors through a single Directive system. Each actor's state is tracked in a shared `facts.actors` record, and you can define constraints and resolvers that coordinate across all machines.

```typescript
import { createMachine, createActor } from 'xstate';
import { createActorCoordinator, isInState } from 'directive/xstate';

const elevatorMachine = createMachine({
  id: 'elevator',
  initial: 'idle',
  context: { floor: 1 },
  states: {
    idle: { on: { GO_TO_FLOOR: 'moving' } },
    moving: { on: { ARRIVED: 'idle' } },
  },
});

const coordinator = createActorCoordinator({
  // Register multiple actors of the same machine type
  actors: [
    { id: 'elevator-1', machine: elevatorMachine, input: { floor: 1 } },
    { id: 'elevator-2', machine: elevatorMachine, input: { floor: 5 } },
  ],
  createActor,

  // Additional facts beyond the auto-tracked actor states
  factsSchema: {
    pendingFloors: { _type: [] as number[], _validators: [] },
  },
  init: (facts) => {
    facts.pendingFloors = [];
  },

  // Constraints see facts.actors (Record<string, ActorStateInfo>)
  constraints: {
    // Dispatch an elevator when there are pending floor requests
    dispatchElevator: {
      when: (facts) => facts.pendingFloors.length > 0,
      require: (facts) => ({
        type: 'DISPATCH_ELEVATOR',
        floor: facts.pendingFloors[0],
      }),
      priority: 50,
    },
  },

  // Resolvers get { facts, actors, signal }
  resolvers: {
    dispatch: {
      requirement: (req) => req.type === 'DISPATCH_ELEVATOR',
      resolve: (req, { actors, facts }) => {
        // Find an idle elevator to handle the request
        const idleId = Object.keys(facts.actors).find(
          (id) => isInState(facts.actors[id], 'idle')
        );

        if (idleId) {
          // Send the floor request to the idle elevator
          actors[idleId].send({ type: 'GO_TO_FLOOR', floor: req.floor });

          // Remove the handled floor from the queue
          facts.pendingFloors = facts.pendingFloors.slice(1);
        }
      },
    },
  },
});

coordinator.start();

// Send events to a specific actor by ID
coordinator.send('elevator-1', { type: 'GO_TO_FLOOR', floor: 3 });

// Access individual actor instances
coordinator.actors['elevator-1'];

// Read coordinated actor state through Directive facts
coordinator.facts.actors['elevator-1'].status; // "active"
coordinator.facts.actors['elevator-1'].value;  // "idle"

// Clean up all actors and the coordinator
coordinator.destroy();
```

### Actor State Info

Each entry in `facts.actors` is an `ActorStateInfo` object:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | The actor's registration ID |
| `machineId` | `string` | The machine's ID |
| `status` | `"active" \| "done" \| "error" \| "stopped"` | Current lifecycle status |
| `value` | `string \| object` | Current state value |
| `startedAt` | `number` | Timestamp when the actor started |
| `completedAt` | `number \| undefined` | Timestamp when the actor completed or errored |
| `error` | `string \| undefined` | Error message if the actor errored |

---

## Helper Functions

Utility functions for checking actor state inside constraints and resolvers:

```typescript
import { isInState, isDone, hasError, isActive } from 'directive/xstate';

// Check if an actor is in a specific state
isInState(facts.actors['elevator-1'], 'idle');              // true/false
isInState(facts.actors['elevator-1'], ['idle', 'moving']);  // true if in any listed state

// Lifecycle status checks
isDone(facts.actors['elevator-1']);     // status === "done"
hasError(facts.actors['elevator-1']);   // status === "error"
isActive(facts.actors['elevator-1']);   // status === "active"
```

All helpers return `false` if the actor state is `undefined`, so they are safe to use before actors are initialized.

---

## Next Steps

- See [Migrating from XState](/docs/migration/from-xstate) for a step-by-step migration guide
- See [Resolvers](/docs/resolvers) for resolver patterns (retry, batching, cancellation)
- See [Constraints](/docs/constraints) for declarative logic
- See [Module and System](/docs/module-system) for setup
