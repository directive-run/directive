---
title: Directive + Zustand
description: Use Zustand for simple UI state and Directive for constraint evaluation and requirement resolution.
---

Zustand is great for simple, fast UI state. Directive adds constraint evaluation, requirement resolution, and declarative orchestration alongside it. Both use subscribe patterns – they compose naturally. {% .lead %}

{% callout type="note" title="Prerequisites" %}
This guide assumes familiarity with [Core Concepts](/docs/core-concepts) and [Module & System](/docs/module-system). Need to install first? See [Installation](/docs/installation).
{% /callout %}

---

## Why Use Both

**Zustand** gives you minimal, fast UI state: no boilerplate, no providers, direct store access with selectors. It's the simplest way to manage client-side state.

**Directive** adds a smart constraint layer on top. Instead of writing `useEffect` chains that watch Zustand state and trigger async work, you declare constraints that evaluate automatically and resolvers that handle the fulfillment.

Together:
- Zustand owns lightweight UI state: modals, form inputs, selections, UI toggles
- Directive owns business logic: constraints that evaluate across state, resolvers that handle async flows with retry, effects that react to state transitions
- Clean separation – Zustand stays simple, Directive handles complexity

---

## Zustand → Directive

Subscribe to Zustand and batch-write into Directive facts.

{% callout type="note" title="Zustand subscribe passes BOTH state arguments" %}
Unlike Redux, Zustand's `store.subscribe(listener)` passes **both** `(state, prevState)` to the listener. Use `prevState` to detect what actually changed.
{% /callout %}

```typescript
import { store } from './zustand-store';

// Sync current state immediately so facts aren't stale until first change
const initialState = store.getState();
system.batch(() => {
  system.facts.selectedPlan = initialState.selectedPlan;
  system.facts.billingCycle = initialState.billingCycle;
});

const unsubscribe = store.subscribe((state, prevState) => {
  system.batch(() => {
    if (state.selectedPlan !== prevState.selectedPlan) {
      system.facts.selectedPlan = state.selectedPlan;
    }
    if (state.billingCycle !== prevState.billingCycle) {
      system.facts.billingCycle = state.billingCycle;
    }
  });
});

// Clean up when done: unsubscribe()
```

Since Zustand gives you `prevState`, you can skip writes for unchanged values – avoiding unnecessary derivation recomputation. Alternatively, use `subscribeWithSelector` with `fireImmediately: true` (shown below) to sync initial state automatically.

---

## Zustand → Directive with subscribeWithSelector

For more efficient sync, use Zustand's `subscribeWithSelector` middleware to subscribe to specific slices:

```typescript
import { createStore } from 'zustand/vanilla';
import { subscribeWithSelector } from 'zustand/middleware';

const store = createStore(
  subscribeWithSelector((set) => ({
    selectedPlan: 'free',
    billingCycle: 'monthly' as 'monthly' | 'annual',
  }))
);

// Subscribe to just the plan – fires only when it changes
const unsubPlan = store.subscribe(
  (state) => state.selectedPlan,
  (selectedPlan, prevSelectedPlan) => {
    system.facts.selectedPlan = selectedPlan;
  },
  { equalityFn: Object.is }
);

// Subscribe to billing cycle separately
const unsubCycle = store.subscribe(
  (state) => state.billingCycle,
  (billingCycle) => {
    system.facts.billingCycle = billingCycle;
  }
);

// Fire immediately to sync initial state
const unsubImmediate = store.subscribe(
  (state) => state.selectedPlan,
  (selectedPlan) => {
    system.facts.selectedPlan = selectedPlan;
  },
  { fireImmediately: true }
);
```

This avoids checking every field on every state change – the selector handles the filtering.

---

## Directive → Zustand

Watch Directive facts and push changes to Zustand:

```typescript
const unwatch = system.watch('pricingResult', (result) => {
  store.setState({ pricing: result });
});

// Clean up when done: unwatch()
```

Use Zustand's function updater form for state that depends on current values:

```typescript
system.watch('appliedDiscounts', (discounts) => {
  store.setState((prev) => ({
    ...prev,
    discounts,
    hasDiscounts: discounts.length > 0,
  }));
});
```

---

## Shared Reactivity Example

Zustand manages what the user selects. Directive decides what to do about it – with retry and error handling:

```typescript
import { createModule, t } from '@directive-run/core';

const pricingModule = createModule('pricing', {
  schema: {
    facts: {
      selectedPlan: t.string(),
      billingCycle: t.string<'monthly' | 'annual'>(),
      pricingResult: t.any(),
      pricingError: t.any(),
    },
    derivations: {
      hasPlanSelected: t.boolean(),
    },
    events: {},
    requirements: {
      FETCH_PRICING: { plan: t.string(), cycle: t.string() },
    },
  },

  init: (facts) => {
    facts.selectedPlan = '';
    facts.billingCycle = 'monthly';
    facts.pricingResult = null;
    facts.pricingError = null;
  },

  derive: {
    hasPlanSelected: (facts) => Boolean(facts.selectedPlan && facts.billingCycle),
  },

  constraints: {
    fetchPricing: {
      when: (facts) => facts.hasPlanSelected,
      require: (facts) => ({
        type: 'FETCH_PRICING',
        plan: facts.selectedPlan,
        cycle: facts.billingCycle,
      }),
    },
  },

  resolvers: {
    pricing: {
      requirement: 'FETCH_PRICING',
      key: (req) => `${req.plan}-${req.cycle}`,
      retry: { attempts: 3, backoff: 'exponential' },
      resolve: async (req, ctx) => {
        try {
          const result = await api.getPricing(req.plan, req.cycle);
          ctx.facts.pricingResult = result;
          ctx.facts.pricingError = null;
          // Push result back to Zustand for UI
          store.setState({ pricing: result, pricingLoading: false });
        } catch (err) {
          ctx.facts.pricingError = err;
          store.setState({ pricingLoading: false, pricingError: String(err) });
          throw err; // Let retry policy handle it
        }
      },
    },
  },
});
```

The user picks a plan in Zustand → synced as a Directive fact → constraint fires → resolver fetches pricing with retry → result flows back to both Directive and Zustand.

---

## Zustand Middleware Integration

The `subscribe` approach above is simpler and works for most cases. A middleware approach auto-syncs on every `setState` call without manual subscription setup – useful when many components write to the store independently. The tradeoff is more complex TypeScript and tighter coupling to Zustand internals.

{% callout type="warning" title="Middleware limitation" %}
This middleware intercepts `store.setState()` calls only. Internal `set()` calls from within the state creator function are also intercepted since Zustand's `set` calls `setState` internally. However, direct property mutations on `store.getState()` (an anti-pattern) will not be caught.
{% /callout %}

```typescript
import type { StateCreator, StoreMutatorIdentifier } from 'zustand';

type DirectiveSyncImpl = <
  T,
  Mps extends [StoreMutatorIdentifier, unknown][] = [],
  Mcs extends [StoreMutatorIdentifier, unknown][] = [],
>(
  f: StateCreator<T, Mps, Mcs>,
  system: ReturnType<typeof createSystem>,
  keyMap: Record<string, (state: T) => unknown>
) => StateCreator<T, Mps, Mcs>;

const directiveSyncImpl: DirectiveSyncImpl = (f, system, keyMap) => (set, get, store) => {
  const originalSet = store.setState;
  store.setState = (...args) => {
    const prevState = store.getState();
    originalSet(...args);
    const nextState = store.getState();

    system.batch(() => {
      for (const [factKey, selector] of Object.entries(keyMap)) {
        const prev = selector(prevState as any);
        const next = selector(nextState as any);
        if (prev !== next) {
          (system.facts as any)[factKey] = next;
        }
      }
    });
  };
  return f(set, get, store);
};

// Usage
const store = createStore(
  directiveSyncImpl(
    (set) => ({
      plan: 'free',
      cycle: 'monthly',
      setPlan: (plan: string) => set({ plan }),
    }),
    system,
    {
      selectedPlan: (state) => state.plan,
      billingCycle: (state) => state.cycle,
    }
  )
);
```

Now every `store.setState` call automatically syncs the mapped keys into Directive facts.

---

## Bidirectional Sync Guard

When syncing both directions, prevent infinite loops:

```typescript
let syncing = false;

// Zustand → Directive
store.subscribe((state, prevState) => {
  if (syncing) {
    return;
  }

  syncing = true;
  system.batch(() => {
    if (state.count !== prevState.count) {
      system.facts.count = state.count;
    }
  });
  syncing = false;
});

// Directive → Zustand
system.watch('count', (value) => {
  if (syncing) {
    return;
  }

  syncing = true;
  store.setState({ count: value });
  syncing = false;
});
```

Since Zustand provides `prevState` in the listener, you can also use a shallow compare approach instead of a flag:

```typescript
system.watch('count', (value) => {
  // Only push if Zustand doesn't already have this value
  if (store.getState().count !== value) {
    store.setState({ count: value });
  }
});
```

---

## React Integration

Wire both stores in a React component:

```tsx
import { useEffect } from 'react';
import { useDirectiveRef } from '@directive-run/react';
import { useStore } from './zustand-store';

function PricingPage() {
  // useDirectiveRef returns the system directly (useDirective returns reactive selections)
  const system = useDirectiveRef(pricingModule);
  const { selectedPlan, billingCycle, pricing } = useStore();

  // Sync Zustand → Directive (requires subscribeWithSelector middleware on the store)
  useEffect(() => {
    const unsub = store.subscribe(
      (state) => ({ plan: state.selectedPlan, cycle: state.billingCycle }),
      ({ plan, cycle }) => {
        system.batch(() => {
          system.facts.selectedPlan = plan;
          system.facts.billingCycle = cycle;
        });
      },
      { fireImmediately: true }
    );
    return () => unsub();
  }, [system]);

  // Sync Directive → Zustand
  useEffect(() => {
    const unwatch = system.watch('pricingResult', (result) => {
      store.setState({ pricing: result });
    });
    return () => unwatch();
  }, [system]);

  return (
    <div>
      <p>Plan: {selectedPlan}</p>
      <p>Cycle: {billingCycle}</p>
      {pricing && <p>Price: ${pricing.amount}/{pricing.interval}</p>}
    </div>
  );
}
```

{% callout type="note" title="SSR / Next.js" %}
For server-side rendering, see [Advanced: SSR & Hydration](/docs/advanced/ssr) for how to serialize and restore both stores during hydration.
{% /callout %}

---

## Testing

Test the integration with Directive's test utilities:

```typescript
import { createTestSystem } from '@directive-run/core/testing';

test('pricing constraint fires when plan selected', async () => {
  const testSystem = createTestSystem(pricingModule);

  testSystem.batch(() => {
    testSystem.facts.selectedPlan = 'pro';
    testSystem.facts.billingCycle = 'annual';
  });

  await testSystem.reconcile();
  expect(testSystem.pendingRequirements()).toContainEqual(
    expect.objectContaining({
      type: 'FETCH_PRICING',
      plan: 'pro',
      cycle: 'annual',
    })
  );
});
```

---

## Next Steps

- **[Migration from Zustand](/docs/migration/from-zustand)** – Full migration guide if you want to move off Zustand entirely
- **[Facts](/docs/facts)** – How Directive's proxy-based facts work
- **[Constraints](/docs/constraints)** – How constraints evaluate and emit requirements
- **[Plugins](/docs/plugins/overview)** – Build custom plugins for cross-cutting concerns
