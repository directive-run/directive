---
title: Multi-Module
description: Compose multiple Directive modules for complex applications.
---

Build complex applications with composable modules. {% .lead %}

---

## Basic Composition

Pass a `modules` map to create a namespaced system:

```typescript
import { createSystem } from '@directive-run/core';

// Each key becomes a namespace for accessing that module's state
const system = createSystem({
  modules: {
    auth: authModule,
    cart: cartModule,
    user: userModule,
  },
});
```

```
    ┌─────────────────── createSystem ───────────────────┐
    │                                                    │
    │  ┌──────────┐   ┌──────────┐   ┌──────────┐        │ 
    │  │   auth   │   │   cart   │   │    ui    │        │
    │  │  module  │   │  module  │   │  module  │        │
    │  └──────────┘   └──────────┘   └──────────┘        │
    │                                                    │
    └────────────────────────┬───────────────────────────┘
                             ▼
                  system.facts.auth.token
                  system.facts.cart.items
                  system.facts.ui.theme
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
    total: (facts, derived) =>
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

## Cross-Module Constraints

Constraints in one module can reference facts from other modules using `crossModuleDeps`. This is the primary mechanism for inter-module coordination:

```typescript
const cartModule = createModule("cart", {
  schema: {
    facts: {
      items: t.array(t.object<CartItem>()),
      checkoutInProgress: t.boolean(),
    },
  },
  // Declare cross-module dependencies at the module level
  crossModuleDeps: { auth: authSchema },

  init: (facts) => {
    facts.items = [];
    facts.checkoutInProgress = false;
  },

  constraints: {
    blockCheckoutIfNotAuthenticated: {
      // facts.self.* for own module, facts.auth.* for cross-module
      when: (facts) =>
        facts.self.checkoutInProgress && !facts.auth.isAuthenticated,
      require: { type: "REQUIRE_LOGIN" },
    },
  },
});
```

Declare `crossModuleDeps` as a module-level object mapping dependency names to their schemas. Inside `derive`, `constraints`, and `effects`, access own-module facts via `facts.self.*` and cross-module facts via `facts.{dep}.*`. Constraint ordering across modules uses the `after` property with the `"moduleName::constraintName"` format:

```typescript
constraints: {
  afterAuth: {
    after: ["auth::validateSession"],  // Wait for auth's constraint to resolve
    when: (facts) => facts.needsData,
    require: { type: "FETCH_DATA" },
  },
}
```

---

## Dynamic Module Registration

Add modules to a running system with `system.registerModule()`. This is useful for code-split features that load on demand:

```typescript
const system = createSystem({
  modules: {
    auth: authModule,
  },
});
system.start();

// Later, after dynamic import
const { chatModule } = await import('./features/chat');
system.registerModule("chat", chatModule);

// Immediately available through namespaced access
system.facts.chat.messages;
system.events.chat.sendMessage({ text: "Hello!" });
```

The registered module is fully wired into the system – its constraints, resolvers, effects, and derivations all activate immediately. Existing modules continue running uninterrupted. See [Runtime Dynamics](/docs/advanced/runtime) for more on runtime registration, overrides, and introspection across all subsystems.

### Restrictions

- Cannot register during reconciliation (throws an error)
- Cannot register on a destroyed system (throws an error)
- Module names must be unique (schema key collisions are caught at registration time)

---

## Module Factory

Use `createModuleFactory()` to produce named instances from a single definition. This is useful for multi-instance UIs like tabs, panels, or multi-tenant layouts where you need isolated state from the same schema:

```typescript
import { createModuleFactory, t } from '@directive-run/core';

const chatRoom = createModuleFactory({
  schema: {
    facts: {
      messages: t.array<string>(),
      users: t.array<string>(),
    },
    derivations: {
      messageCount: t.number(),
    },
  },
  init: (facts) => {
    facts.messages = [];
    facts.users = [];
  },
  derive: {
    messageCount: (facts) => facts.messages.length,
  },
});

// Create independent instances with different names
const system = createSystem({
  modules: {
    lobby: chatRoom("lobby"),
    support: chatRoom("support"),
  },
});

system.start();

// Each instance has isolated state
system.facts.lobby.messages;   // []
system.facts.support.messages; // []
```

`createModuleFactory` preserves `crossModuleDeps` when provided, so factory-produced modules work correctly with cross-module dependencies.

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

- [Module and System](/docs/module-system) – Basics
- [Time-Travel & Snapshots](/docs/advanced/history) – Debugging
- [Error Handling](/docs/advanced/errors) – Recovery strategies
