---
title: Multi-Module
description: Compose multiple Directive modules for complex applications.
---

Build complex applications with composable modules. {% .lead %}

---

## Basic Composition

Combine modules in a system:

```typescript
import { createSystem, composeModules } from 'directive';

const system = createSystem({
  modules: composeModules({
    auth: authModule,
    cart: cartModule,
    user: userModule,
  }),
});
```

---

## Namespaced Access

Access facts by namespace:

```typescript
// Access auth facts
system.facts.auth.isAuthenticated;
system.facts.auth.token;

// Access cart facts
system.facts.cart.items;
system.facts.cart.total;

// Access user facts
system.facts.user.profile;
system.facts.user.preferences;
```

---

## Cross-Module Constraints

Reference other modules in constraints:

```typescript
const cartModule = createModule("cart", {
  constraints: {
    canCheckout: {
      when: (facts, { modules }) =>
        facts.items.length > 0 &&
        modules.auth.facts.isAuthenticated,
      require: { type: "CHECKOUT" },
    },
  },
});
```

---

## Shared Derivations

Derive values across modules:

```typescript
const appModule = createModule("app", {
  derive: {
    isReady: (facts, { modules }) =>
      modules.auth.facts.initialized &&
      modules.user.facts.loaded &&
      modules.config.facts.fetched,
  },
});
```

---

## Module Dependencies

Declare dependencies explicitly:

```typescript
const cartModule = createModule("cart", {
  dependencies: ["auth", "user"],

  constraints: {
    loadCart: {
      after: ["auth.initialized", "user.loaded"],
      when: (facts) => !facts.loaded,
      require: { type: "LOAD_CART" },
    },
  },
});
```

---

## Independent Systems

Run modules as separate systems:

```typescript
const authSystem = createSystem({ module: authModule });
const cartSystem = createSystem({ module: cartModule });

// Connect via events
authSystem.on("LOGGED_OUT", () => {
  cartSystem.facts.items = [];
});
```

---

## Next Steps

- See Module and System for basics
- See Time-Travel for debugging
- See Snapshots for state management
