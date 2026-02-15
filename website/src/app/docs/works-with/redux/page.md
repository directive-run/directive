---
title: Directive + Redux
description: Use Redux for predictable UI state and Directive for constraint-driven async orchestration.
---

Redux handles predictable state with reducers, actions, and devtools. Directive adds constraint-driven async orchestration – requirements that evaluate automatically and resolvers that fulfill them. {% .lead %}

{% callout type="note" title="Prerequisites" %}
This guide assumes familiarity with [Core Concepts](/docs/core-concepts) and [Module & System](/docs/module-system). Need to install first? See [Installation](/docs/installation).
{% /callout %}

{% callout title="Migrating from Redux?" %}
Want to replace Redux entirely? See the [Redux to Directive migration guide](/docs/migration/from-redux) for step-by-step codemods and concept mapping.
{% /callout %}

---

## Why Use Both

**Redux** gives you predictable state management: immutable updates, action history, time-travel debugging through Redux DevTools, and a massive ecosystem of middleware.

**Directive** adds a constraint layer that evaluates across your Redux state automatically. Instead of writing thunks or sagas that manually check conditions and dispatch actions, you declare constraints that fire when conditions are met and resolvers that handle the async work.

Together:
- Redux owns UI state: reducers, selectors, action history, DevTools
- Directive owns orchestration: constraints evaluate your Redux state, resolvers handle async side effects with retry and error recovery
- Replace complex thunk chains and saga flows with declarative constraints

---

## Redux → Directive

Subscribe to your Redux store and batch-write slices into Directive facts.

{% callout type="warning" title="Redux subscribe receives NO arguments" %}
Unlike Zustand, Redux's `store.subscribe(listener)` passes **no arguments** to the listener. You must call `store.getState()` inside the callback to read current state.
{% /callout %}

```typescript
import { store } from './redux-store';

function syncReduxToDirective(state: RootState, prevState: RootState) {
  system.batch(() => {
    if (state.auth.user !== prevState.auth.user) {
      system.facts.user = state.auth.user;
    }
    if (state.cart.items !== prevState.cart.items) {
      system.facts.cartItems = state.cart.items;
    }
    if (state.cart.total !== prevState.cart.total) {
      system.facts.cartTotal = state.cart.total;
    }
  });
}

// Sync current state immediately so facts aren't stale until first change
let prevState = store.getState();
syncReduxToDirective(prevState, {} as RootState);

const unsubscribe = store.subscribe(() => {
  const state = store.getState();
  syncReduxToDirective(state, prevState);
  prevState = state;
});

// Clean up when done: unsubscribe()
```

Selective sync avoids unnecessary derivation recomputation. Only write facts that actually changed.

---

## Directive → Redux

Watch Directive facts and dispatch Redux actions when they change:

```typescript
import { orderActions } from './redux-store';

const unwatch = system.watch('orderStatus', (status, prev) => {
  store.dispatch(orderActions.setStatus(status));
});

// Clean up when done: unwatch()
```

For RTK slices, use the generated action creators directly:

```typescript
system.watch('discountApplied', (discount) => {
  store.dispatch(cartSlice.actions.applyDiscount(discount));
});

system.watch('shippingEstimate', (estimate) => {
  store.dispatch(cartSlice.actions.setShipping(estimate));
});
```

---

## Directive as Redux Middleware

Forward every Redux action to Directive as an event. This lets constraints react to Redux actions directly:

```typescript
import type { Middleware } from 'redux';

const directiveMiddleware: Middleware = (api) => (next) => (action) => {
  // Let Redux process the action first
  const result = next(action);

  // Forward to Directive as an event
  if (typeof action === 'object' && action !== null && 'type' in action) {
    try {
      system.dispatch({ type: action.type, payload: (action as any).payload });
    } catch (err) {
      // Directive may not have a handler for every Redux action – that's expected.
      // Log in development so real errors aren't hidden.
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[directive-middleware] Failed to dispatch ${action.type}:`, err);
      }
    }
  }

  return result;
};

// Apply middleware
const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(directiveMiddleware),
});
```

Now your Directive module can define event handlers that respond to Redux actions:

```typescript
events: {
  'cart/addItem': (facts, payload) => {
    facts.lastCartAction = 'add';
  },
  'cart/removeItem': (facts, payload) => {
    facts.lastCartAction = 'remove';
  },
},
```

---

## Constraint-Driven Side Effects

Replace thunks with Directive constraints. When Redux state (synced as facts) meets a condition, the constraint fires and a resolver handles the async work:

```typescript
import { createModule, t } from '@directive-run/core';

const cartModule = createModule('cart', {
  schema: {
    facts: {
      cartItems: t.array(t.any()),
      cartTotal: t.number(),
      user: t.any(),
      discountApplied: t.boolean(),
    },
    derivations: {
      eligibleForFreeShipping: t.boolean(),
    },
    events: {},
    requirements: {
      APPLY_DISCOUNT: { discount: t.string() },
    },
  },

  init: (facts) => {
    facts.cartItems = [];
    facts.cartTotal = 0;
    facts.user = null;
    facts.discountApplied = false;
  },

  derive: {
    eligibleForFreeShipping: (facts) =>
      facts.cartTotal > 100 && facts.user?.tier === 'premium',
  },

  constraints: {
    freeShipping: {
      when: (facts) =>
        facts.eligibleForFreeShipping && !facts.discountApplied,
      require: () => ({ type: 'APPLY_DISCOUNT', discount: 'FREE_SHIPPING' }),
    },
  },

  resolvers: {
    applyDiscount: {
      requirement: 'APPLY_DISCOUNT',
      key: (req) => `discount-${req.discount}`,
      retry: { attempts: 3, backoff: 'exponential' },
      resolve: async (req, context) => {
        const result = await api.applyDiscount(req.discount);
        context.facts.discountApplied = true;
        // Push result back to Redux
        store.dispatch(cartActions.setDiscount(result));
      },
    },
  },
});
```

The constraint fires automatically when `cartTotal > 100` and the user is premium. The resolver handles the API call with retry. No thunk, no saga – just a declaration.

---

## Plugin: Mirror to Redux DevTools

Use a plugin to dispatch Directive fact changes as Redux actions, making them visible in Redux DevTools:

```typescript
import type { Plugin } from '@directive-run/core';

const reduxDevtoolsPlugin: Plugin = {
  name: 'redux-devtools-mirror',

  onFactSet: (key, value, prev) => {
    store.dispatch({ type: `directive/${key}`, payload: value });
  },

  onResolverStart: (resolver, req) => {
    store.dispatch({
      type: `directive/resolver/${resolver}/start`,
      payload: { requirement: req.type },
    });
  },

  onResolverComplete: (resolver, req, duration) => {
    store.dispatch({
      type: `directive/resolver/${resolver}/complete`,
      payload: { requirement: req.type, duration },
    });
  },

  onResolverError: (resolver, req, error) => {
    store.dispatch({
      type: `directive/resolver/${resolver}/error`,
      payload: { requirement: req.type, error: String(error) },
    });
  },
};
```

Now every Directive state change and resolver lifecycle event shows up in Redux DevTools alongside your Redux actions.

---

## React Integration

Wire both stores in a React component using `useEffect` for subscription lifecycle:

```tsx
import { useEffect } from 'react';
import { useSelector } from 'react-redux';
import { useDirectiveRef } from '@directive-run/react';

function CartPage() {
  // useDirectiveRef returns the system directly (useDirective returns reactive selections)
  const system = useDirectiveRef(cartModule);
  const reduxCart = useSelector((state) => state.cart);

  // Sync Redux → Directive
  useEffect(() => {
    let prevCart = store.getState().cart;
    const unsubscribe = store.subscribe(() => {
      const state = store.getState();
      if (state.cart !== prevCart) {
        system.batch(() => {
          system.facts.cartItems = state.cart.items;
          system.facts.cartTotal = state.cart.total;
        });
        prevCart = state.cart;
      }
    });
    return () => unsubscribe();
  }, [system]);

  // Sync Directive → Redux
  useEffect(() => {
    const unwatch = system.watch('discountApplied', (applied) => {
      if (applied) {
        store.dispatch(cartActions.markDiscounted());
      }
    });
    return () => unwatch();
  }, [system]);

  return (
    <div>
      <p>Total: ${reduxCart.total}</p>
      <p>Discount: {system.facts.discountApplied ? 'Applied' : 'None'}</p>
    </div>
  );
}
```

{% callout type="note" title="SSR / Next.js" %}
For server-side rendering, see [Advanced: SSR & Hydration](/docs/advanced/ssr) for how to serialize and restore both stores during hydration.
{% /callout %}

---

## Avoiding Infinite Loops

When syncing bidirectionally, prevent infinite loops with a guard:

```typescript
let syncing = false;

// Redux → Directive
store.subscribe(() => {
  if (syncing) {
    return;
  }

  syncing = true;
  const state = store.getState();
  system.batch(() => {
    system.facts.count = state.counter.value;
  });
  syncing = false;
});

// Directive → Redux
system.watch('count', (value) => {
  if (syncing) {
    return;
  }

  syncing = true;
  store.dispatch(counterActions.set(value));
  syncing = false;
});
```

Alternatively, use `equalityFn` on `system.watch` to skip redundant updates:

```typescript
system.watch('count', (value) => {
  if (value !== store.getState().counter.value) {
    store.dispatch(counterActions.set(value));
  }
});
```

---

## Testing

Test the integration using Directive's test utilities alongside a real or mock Redux store:

```typescript
import { configureStore } from '@reduxjs/toolkit';
import { createTestSystem } from '@directive-run/core/testing';

test('constraint fires when Redux state synced', async () => {
  const testSystem = createTestSystem({ module: cartModule });
  testSystem.start();

  // Simulate Redux state arriving
  testSystem.batch(() => {
    testSystem.facts.cartTotal = 150;
    testSystem.facts.user = { tier: 'premium' };
    testSystem.facts.discountApplied = false;
  });

  // Constraint should fire and produce a requirement
  await testSystem.waitForIdle();
  expect(testSystem.allRequirements).toContainEqual(
    expect.objectContaining({
      requirement: expect.objectContaining({ type: 'APPLY_DISCOUNT' }),
    })
  );
});
```

---

## Next Steps

- **[Migration from Redux](/docs/migration/from-redux)** – Full migration guide if you want to move off Redux entirely
- **[Constraints](/docs/constraints)** – How constraints evaluate and emit requirements
- **[Resolvers](/docs/resolvers)** – How resolvers fulfill requirements with retry and batching
- **[Plugins](/docs/plugins/overview)** – Build custom plugins for cross-cutting concerns
