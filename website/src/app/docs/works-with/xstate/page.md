---
title: Directive + XState
description: Use XState for explicit state machine transitions and Directive for constraint-driven multi-machine orchestration.
---

XState handles explicit state machine transitions with actors and guards. Directive coordinates multiple machines with constraint-driven orchestration – constraints evaluate across machine states, resolvers can start and await actors. {% .lead %}

{% callout type="note" title="Prerequisites" %}
This guide assumes familiarity with [Core Concepts](/docs/core-concepts) and [Module & System](/docs/module-system). Need to install first? See [Installation](/docs/installation).
{% /callout %}

{% callout title="Migrating from XState?" %}
Want to replace XState entirely? See the [XState to Directive migration guide](/docs/migration/from-xstate) for step-by-step codemods and concept mapping.
{% /callout %}

---

## Why Use Both

**XState** gives you explicit state machines: typed states, guarded transitions, visual state charts, the actor model. Each machine handles one well-defined workflow.

**Directive** orchestrates across machines. Instead of machines sending events to each other directly (creating tight coupling), Directive constraints evaluate the combined state of all your machines and trigger actions when cross-machine conditions are met.

Together:
- XState owns individual state machines: clear transitions, visual state charts, actor lifecycle
- Directive orchestrates across machines: constraints evaluate against multiple actor states, resolvers start actors and await results, effects react to cross-machine state changes
- Machines stay decoupled – Directive handles the coordination

---

## XState → Directive

Subscribe to an XState actor's snapshots and write state into Directive facts.

{% callout type="warning" title="XState subscribe returns { unsubscribe }, not a function" %}
Unlike Redux and Zustand, `actor.subscribe(fn)` returns a `Subscription` object with an `unsubscribe()` method – not a bare unsubscribe function.
{% /callout %}

```typescript
import { createActor } from 'xstate';
import { trafficLightMachine } from './machines';

const actor = createActor(trafficLightMachine);

const subscription = actor.subscribe((snapshot) => {
  system.batch(() => {
    system.facts.lightStatus = snapshot.status;   // 'active' | 'done' | 'error' | 'stopped'
    system.facts.lightValue = snapshot.value;      // Current state value
    system.facts.lightContext = snapshot.context;   // Machine context
  });
});

actor.start();

// Clean up – note: .unsubscribe() is a method, not a function call
// subscription.unsubscribe();
// actor.stop();
```

You can also use the observer form for error handling:

```typescript
const subscription = actor.subscribe({
  next: (snapshot) => {
    system.batch(() => {
      system.facts.lightValue = snapshot.value;
      system.facts.lightContext = snapshot.context;
    });
  },
  error: (err) => {
    system.facts.lightError = String(err);
  },
  complete: () => {
    system.facts.lightStatus = 'done';
  },
});
```

---

## Directive → XState

Watch Directive facts and send events to an XState actor when conditions change.

{% callout type="warning" title="XState send requires object form" %}
`actor.send({ type: 'EVENT' })` – must be an object with a `type` property. String-only events are not supported in XState v5.
{% /callout %}

```typescript
const actor = createActor(checkoutMachine);
actor.start();

// Watch a Directive fact and send events to the machine
system.watch('paymentReady', (ready) => {
  if (ready) {
    actor.send({ type: 'PROCEED_TO_PAYMENT' });
  }
});

system.watch('orderCancelled', (cancelled) => {
  if (cancelled) {
    actor.send({ type: 'CANCEL' });
  }
});
```

For events with payload data:

```typescript
system.watch('shippingAddress', (address, prevAddress) => {
  if (address && address !== prevAddress) {
    actor.send({ type: 'SET_ADDRESS', address });
  }
});
```

---

## Machine as Resolver

Start an actor inside a resolver and await its final state using XState's `toPromise`:

```typescript
import { createActor, toPromise } from 'xstate';
import { createModule, t } from '@directive-run/core';

const checkoutModule = createModule('checkout', {
  schema: {
    facts: {
      paymentStatus: t.string(),
      orderConfirmed: t.boolean(),
    },
    derivations: {},
    events: {},
    requirements: {
      PROCESS_PAYMENT: { amount: t.number(), method: t.string() },
    },
  },

  init: (facts) => {
    facts.paymentStatus = 'idle';
    facts.orderConfirmed = false;
  },

  resolvers: {
    processPayment: {
      requirement: 'PROCESS_PAYMENT',
      key: (req) => `payment-${req.method}`,
      retry: { attempts: 2, backoff: 'exponential' },
      resolve: async (req, context) => {
        context.facts.paymentStatus = 'processing';

        const actor = createActor(paymentMachine, {
          input: { amount: req.amount, method: req.method },
        });
        actor.start();

        // toPromise resolves with snapshot.output when the machine reaches a final state
        try {
          const output = await toPromise(actor);
          context.facts.paymentStatus = output.status;
          context.facts.orderConfirmed = output.status === 'success';
        } finally {
          actor.stop(); // Always clean up the actor
        }
      },
    },
  },
});
```

For more control over intermediate states, use `waitFor` instead:

```typescript
import { createActor, waitFor } from 'xstate';

resolve: async (req, context) => {
  const actor = createActor(paymentMachine, {
    input: { amount: req.amount },
  });
  actor.start();

  try {
    // Wait for the machine to reach a specific state, with timeout
    const snapshot = await waitFor(
      actor,
      (snap) => snap.status === 'done' || snap.status === 'error',
      { timeout: 30_000 }
    );

    if (snapshot.status === 'error') {
      throw snapshot.error;
    }

    context.facts.paymentStatus = snapshot.output.status;
  } finally {
    actor.stop(); // Always clean up the actor
  }
},
```

---

## Multi-Machine Coordination

Store multiple actor states as facts. Directive constraints evaluate across all of them:

```typescript
import { createActor } from 'xstate';
import { createModule, t } from '@directive-run/core';

// Each actor pushes its state into Directive facts
const authActor = createActor(authMachine);
const cartActor = createActor(cartMachine);
const paymentActor = createActor(paymentMachine);

// Store subscriptions for cleanup
const authSub = authActor.subscribe((s) => {
  system.batch(() => {
    system.facts.authState = s.value;
    system.facts.authUser = s.context.user;
  });
});

const cartSub = cartActor.subscribe((s) => {
  system.batch(() => {
    system.facts.cartState = s.value;
    system.facts.cartItems = s.context.items;
  });
});

const paymentSub = paymentActor.subscribe((s) => {
  system.batch(() => {
    system.facts.paymentState = s.value;
    system.facts.paymentError = s.status === 'error' ? String(s.error) : null;
  });
});

// Start all actors
[authActor, cartActor, paymentActor].forEach((a) => a.start());

// Clean up when done:
// [authSub, cartSub, paymentSub].forEach((s) => s.unsubscribe());
// [authActor, cartActor, paymentActor].forEach((a) => a.stop());

// Constraint spans all three machines
const orderModule = createModule('order', {
  schema: {
    facts: {
      authState: t.string(),
      authUser: t.object(),
      cartState: t.string(),
      cartItems: t.array(t.object()),
      paymentState: t.string(),
      paymentError: t.object(),
    },
    derivations: {
      readyToShip: t.boolean(),
      orderSummary: t.object(),
    },
    events: {},
    requirements: {
      SHIP_ORDER: { userId: t.string(), items: t.array(t.object()) },
    },
  },

  derive: {
    readyToShip: (facts) =>
      facts.authState === 'authenticated' &&
      facts.cartState === 'confirmed' &&
      facts.paymentState === 'paid',
    orderSummary: (facts) => ({
      user: facts.authUser,
      items: facts.cartItems,
      payment: facts.paymentState,
    }),
  },

  constraints: {
    shipWhenReady: {
      when: (facts) => facts.readyToShip,
      require: (facts) => ({
        type: 'SHIP_ORDER',
        userId: facts.authUser?.id,
        items: facts.cartItems,
      }),
    },
  },

  resolvers: {
    ship: {
      requirement: 'SHIP_ORDER',
      resolve: async (req, context) => {
        await api.createShipment(req.userId, req.items);
      },
    },
  },
});
```

No machine knows about the others. Directive handles the cross-cutting coordination.

---

## Actor Lifecycle Management

Use a Directive plugin to track actor creation and cleanup:

```typescript
import type { Plugin } from '@directive-run/core';
import type { AnyActorRef } from 'xstate';

function actorManagerPlugin(): Plugin {
  const actors = new Map<string, AnyActorRef>();
  const subscriptions = new Map<string, { unsubscribe: () => void }>();

  return {
    name: 'actor-manager',

    onInit: (system) => {
      // Start actors and begin syncing
      const auth = createActor(authMachine);
      actors.set('auth', auth);

      const sub = auth.subscribe((s) => {
        system.batch(() => {
          (system.facts as any).authState = s.value;
        });
      });
      subscriptions.set('auth', sub);

      auth.start();
    },

    onDestroy: () => {
      // Unsubscribe from all actor snapshots
      for (const [, sub] of subscriptions) {
        sub.unsubscribe();
      }
      subscriptions.clear();

      // Stop all actors
      for (const [, actor] of actors) {
        actor.stop();
      }
      actors.clear();
    },
  };
}
```

---

## Error Handling

Handle XState actor errors at multiple levels:

```typescript
// 1. Observer error callback
actor.subscribe({
  next: (snapshot) => {
    system.batch(() => {
      system.facts.machineState = snapshot.value;
    });
  },
  error: (err) => {
    system.facts.machineError = String(err);
  },
});

// 2. Check snapshot status in constraints
constraints: {
  handleMachineError: {
    when: (facts) => facts.machineError !== null,
    require: (facts) => ({
      type: 'RECOVER_MACHINE',
      error: facts.machineError,
    }),
  },
},

// 3. Recovery resolver
resolvers: {
  recover: {
    requirement: 'RECOVER_MACHINE',
    retry: { attempts: 3, backoff: 'exponential' },
    resolve: async (req, context) => {
      // Restart the actor with fresh state
      const actor = createActor(machine);
      actor.start();
      context.facts.machineError = null;
    },
  },
},
```

For resolvers that use `toPromise`, errors from the machine are thrown automatically:

```typescript
resolve: async (req, context) => {
  const actor = createActor(machine, { input: req });
  actor.start();

  try {
    const output = await toPromise(actor);
    context.facts.result = output;
  } catch (err) {
    // Machine reached 'error' status – toPromise rejects
    context.facts.error = String(err);
    throw err; // Let Directive's retry policy handle it
  }
},
```

---

## React Integration

Wire actors and Directive together in a React component:

```tsx
import { useEffect, useRef } from 'react';
import { createActor } from 'xstate';
import { useDirectiveRef } from '@directive-run/react';

function CheckoutPage() {
  // useDirectiveRef returns the system directly (useDirective returns reactive selections)
  const system = useDirectiveRef(checkoutModule);
  const actorRef = useRef<ReturnType<typeof createActor> | null>(null);

  useEffect(() => {
    const actor = createActor(checkoutMachine);
    actorRef.current = actor;

    // Sync actor → Directive
    const subscription = actor.subscribe((snapshot) => {
      system.batch(() => {
        system.facts.checkoutState = snapshot.value;
        system.facts.checkoutContext = snapshot.context;
      });
    });

    // Sync Directive → actor
    const unwatch = system.watch('paymentReady', (ready) => {
      if (ready) {
        actor.send({ type: 'PROCEED_TO_PAYMENT' });
      }
    });

    actor.start();

    return () => {
      subscription.unsubscribe();
      unwatch();
      actor.stop();
    };
  }, [system]);

  return (
    <div>
      <p>Status: {system.facts.checkoutState}</p>
      <button onClick={() => actorRef.current?.send({ type: 'NEXT' })}>
        Next Step
      </button>
    </div>
  );
}
```

{% callout type="note" title="SSR / Next.js" %}
For server-side rendering, see [Advanced: SSR & Hydration](/docs/advanced/ssr) for how to serialize and restore both stores during hydration.
{% /callout %}

---

## Testing

Test machine-as-resolver patterns with Directive's test utilities:

```typescript
import { createTestSystem } from '@directive-run/core/testing';

test('multi-machine constraint fires when all ready', async () => {
  const testSystem = createTestSystem({ module: orderModule });
  testSystem.start();

  testSystem.batch(() => {
    testSystem.facts.authState = 'authenticated';
    testSystem.facts.cartState = 'confirmed';
    testSystem.facts.paymentState = 'paid';
    testSystem.facts.authUser = { id: 'user-1' };
    testSystem.facts.cartItems = [{ id: 'item-1' }];
  });

  await testSystem.waitForIdle();
  expect(testSystem.allRequirements).toContainEqual(
    expect.objectContaining({
      requirement: expect.objectContaining({ type: 'SHIP_ORDER' }),
    })
  );
});
```

---

## Next Steps

- **[Migration from XState](/docs/migration/from-xstate)** – Full migration guide if you want to move off XState entirely
- **[Resolvers](/docs/resolvers)** – How resolvers handle async fulfillment with retry and batching
- **[Constraints](/docs/constraints)** – How constraints evaluate and coordinate requirements
- **[Plugins](/docs/plugins/overview)** – Build custom plugins for actor lifecycle management
