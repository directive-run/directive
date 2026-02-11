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

// Each key becomes a namespace for accessing that module's state
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
// Read authentication state from the auth namespace
system.facts.auth.isAuthenticated;
system.facts.auth.token;

// Read shopping cart state from the cart namespace
system.facts.cart.items;
system.facts.cart.total;

// Dispatch events – the system routes them to the right module
system.dispatch({ type: "ADD_ITEM", item: product });
```

---

## Module Definition

Each module defines its own schema, constraints, resolvers, and effects:

```typescript
const cartModule = createModule("cart", {
  // Define the shape of cart state with typed schema fields
  schema: {
    facts: {
      items: t.array(t.object<CartItem>()),
      couponCode: t.string().nullable(),
      discount: t.number(),
    },
  },

  // Set default values when the module initializes
  init: (facts) => {
    facts.items = [];
    facts.couponCode = null;
    facts.discount = 0;
  },

  // Auto-tracked derivations recompute when their dependencies change
  derive: {
    subtotal: (facts) =>
      facts.items.reduce((sum, item) => sum + item.price * item.qty, 0),

    // Derivations can reference other derivations via the second argument
    total: (facts, derive) =>
      derive.subtotal - facts.discount,
  },

  // Constraints declare "when X is true, require Y"
  constraints: {
    applyCoupon: {
      when: (facts) => facts.couponCode !== null && facts.discount === 0,
      require: { type: "APPLY_COUPON" },
    },
  },

  // Resolvers fulfill requirements emitted by constraints
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
// Create separate systems – each module runs independently
const authSystem = createSystem({ module: authModule });
const cartSystem = createSystem({ module: cartModule });

authSystem.start();
cartSystem.start();

// Coordinate across systems in your application logic
function handleLogout() {
  authSystem.facts.token = null;  // Clear the session
  cartSystem.facts.items = [];    // Empty the cart on logout
}
```

---

## React with Multiple Modules

With independent systems, pass each system directly to the components that need it –no provider needed:

```typescript
// Pass each independent system to the components that need it
function App() {
  return (
    <Layout authSystem={authSystem} cartSystem={cartSystem} />
  );
}
```

Or use a single namespaced system and pass it to hooks:

```typescript
// Combine modules into a single namespaced system
const system = createSystem({
  modules: { auth: authModule, cart: cartModule },
});
system.start();

function App() {
  // Read facts through the module namespace
  const isAuthenticated = system.facts.auth.isAuthenticated;

  return <Layout system={system} />;
}
```

---

## Next Steps

- See [Module and System](/docs/module-system) for basics
- See [Time-Travel](/docs/advanced/time-travel) for debugging
- See [Snapshots](/docs/advanced/snapshots) for state management
