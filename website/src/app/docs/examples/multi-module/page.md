---
title: Multi-Module App Example
description: Build a complete e-commerce cart with multiple composed modules.
---

Compose modules for a complete application. {% .lead %}

---

## Auth Module

```typescript
const authModule = createModule("auth", {
  schema: {
    facts: {
      user: t.object<User>().nullable(),
      token: t.string().nullable(),
      loading: t.boolean(),
    },
  },

  // Start logged out –a token can be restored from localStorage later
  init: (facts) => {
    facts.user = null;
    facts.token = null;
    facts.loading = false;
  },

  // Other modules can read this to gate authenticated features
  derive: {
    isAuthenticated: (facts) => facts.user !== null,
  },

  // When a token exists but we haven't fetched the user yet, validate it
  constraints: {
    validateSession: {
      when: (facts) => facts.token && !facts.user && !facts.loading,
      require: { type: "VALIDATE_SESSION" },
    },
  },

  resolvers: {
    validateSession: {
      requirement: "VALIDATE_SESSION",
      resolve: async (req, context) => {
        context.facts.loading = true;
        try {
          // Exchange the token for user data
          context.facts.user = await api.validateToken(context.facts.token);
        } catch {
          // Invalid token –clear it so the user can log in again
          context.facts.token = null;
        } finally {
          context.facts.loading = false;
        }
      },
    },
  },
});
```

---

## Cart Module

```typescript
const cartModule = createModule("cart", {
  schema: {
    facts: {
      items: t.array(t.object<CartItem>()),
      couponCode: t.string().nullable(),
      discount: t.number(),
    },
  },

  // Empty cart with no coupon applied
  init: (facts) => {
    facts.items = [];
    facts.couponCode = null;
    facts.discount = 0;
  },

  derive: {
    // Sum up price * quantity for every item
    subtotal: (facts) =>
      facts.items.reduce((sum, item) => sum + item.price * item.qty, 0),
    // Composition: total depends on another derivation (subtotal)
    total: (facts, derive) =>
      derive.subtotal - facts.discount,
    // Badge count for the cart icon
    itemCount: (facts) =>
      facts.items.reduce((sum, item) => sum + item.qty, 0),
  },

  // When a coupon code is entered but not yet validated, validate it
  constraints: {
    applyCoupon: {
      when: (facts) => facts.couponCode && facts.discount === 0,
      require: { type: "APPLY_COUPON" },
    },
  },

  resolvers: {
    applyCoupon: {
      requirement: "APPLY_COUPON",
      resolve: async (req, context) => {
        // Server validates the code and returns the discount amount
        const result = await api.validateCoupon(context.facts.couponCode);
        context.facts.discount = result.discount;
      },
    },
  },
});
```

---

## Checkout Module

```typescript
const checkoutModule = createModule("checkout", {
  schema: {
    facts: {
      // Wizard-style flow through four steps
      step: t.string<"shipping" | "payment" | "review" | "complete">(),
      shippingAddress: t.object<Address>().nullable(),
      paymentMethod: t.object<PaymentMethod>().nullable(),
      processing: t.boolean(),
    },
  },

  // Begin at the first step with no data collected
  init: (facts) => {
    facts.step = "shipping";
    facts.shippingAddress = null;
    facts.paymentMethod = null;
    facts.processing = false;
  },

  // Submit the order once the user reaches "review" with all required info
  constraints: {
    processOrder: {
      when: (facts) =>
        facts.step === "review" &&
        facts.shippingAddress &&
        facts.paymentMethod &&
        !facts.processing,
      require: { type: "PROCESS_ORDER" },
    },
  },

  resolvers: {
    processOrder: {
      requirement: "PROCESS_ORDER",
      resolve: async (req, context) => {
        context.facts.processing = true;

        // Send the collected data to the order API
        await api.createOrder({
          shipping: context.facts.shippingAddress,
          payment: context.facts.paymentMethod,
        });

        // Advance to the confirmation step
        context.facts.step = "complete";
        context.facts.processing = false;
      },
    },
  },
});
```

---

## Composing Modules

```typescript
import { createSystem } from 'directive';

// Pass multiple modules via a named map instead of a single `module`
const system = createSystem({
  modules: {
    auth: authModule,
    cart: cartModule,
    checkout: checkoutModule,
  },
});
system.start();

// Each module's facts live under its namespace –fully typed
system.facts.auth.user;
system.facts.cart.items;
system.facts.checkout.step;
```

---

## Next Steps

- See [Multi-Module](/docs/advanced/multi-module) for composition patterns
- See [Data Fetching](/docs/examples/data-fetching) for async patterns
- See [Module and System](/docs/module-system) for setup
