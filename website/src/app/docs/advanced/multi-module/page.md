---
title: Multi-Module
description: Compose multiple Directive modules for complex applications.
---

Build complex applications with composable modules. {% .lead %}

---

## Basic Composition

Pass a `modules` map to create a namespaced system:

```typescript
import { createSystem } from 'directive';

const system = createSystem({
  modules: {
    auth: authModule,
    cart: cartModule,
    user: userModule,
  },
});
```

---

## Namespaced Access

Facts, derivations, and events are accessed by namespace:

```typescript
// Access auth facts
system.facts.auth.isAuthenticated;
system.facts.auth.token;

// Access cart facts
system.facts.cart.items;
system.facts.cart.total;

// Dispatch module events
system.dispatch({ type: "ADD_ITEM", item: product });
```

---

## Module Definition

Each module defines its own schema, constraints, resolvers, and effects:

```typescript
const cartModule = createModule("cart", {
  schema: {
    facts: {
      items: t.array(t.object<CartItem>()),
      couponCode: t.string().nullable(),
      discount: t.number(),
    },
  },

  init: (facts) => {
    facts.items = [];
    facts.couponCode = null;
    facts.discount = 0;
  },

  derive: {
    subtotal: (facts) =>
      facts.items.reduce((sum, item) => sum + item.price * item.qty, 0),
    total: (facts, derive) =>
      derive.subtotal - facts.discount,
  },

  constraints: {
    applyCoupon: {
      when: (facts) => facts.couponCode !== null && facts.discount === 0,
      require: { type: "APPLY_COUPON" },
    },
  },

  resolvers: {
    applyCoupon: {
      requirement: "APPLY_COUPON",
      resolve: async (req, context) => {
        const result = await api.validateCoupon(context.facts.couponCode);
        context.facts.discount = result.discount;
      },
    },
  },
});
```

---

## Independent Systems

You can also run modules as separate systems and coordinate through your application layer:

```typescript
const authSystem = createSystem({ module: authModule });
const cartSystem = createSystem({ module: cartModule });

// Coordinate at the application level
function handleLogout() {
  authSystem.facts.token = null;
  cartSystem.facts.items = [];
}
```

---

## React with Multiple Modules

With independent systems, pass each system directly to the components that need it -- no provider needed:

```typescript
function App() {
  return (
    <Layout authSystem={authSystem} cartSystem={cartSystem} />
  );
}
```

Or use a single namespaced system and pass it to hooks:

```typescript
const system = createSystem({
  modules: { auth: authModule, cart: cartModule },
});

function App() {
  // Access namespaced facts directly
  const isAuthenticated = system.facts.auth.isAuthenticated;
  return <Layout system={system} />;
}
```

---

## Next Steps

- See [Module and System](/docs/module-system) for basics
- See [Time-Travel](/docs/advanced/time-travel) for debugging
- See [Snapshots](/docs/advanced/snapshots) for state management
