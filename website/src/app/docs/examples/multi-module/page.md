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

  derive: {
    isAuthenticated: (facts) => facts.user !== null,
  },

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
          context.facts.user = await api.validateToken(context.facts.token);
        } catch {
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

  derive: {
    subtotal: (facts) =>
      facts.items.reduce((sum, item) => sum + item.price * item.qty, 0),
    total: (facts, derive) =>
      derive.subtotal - facts.discount,
    itemCount: (facts) =>
      facts.items.reduce((sum, item) => sum + item.qty, 0),
  },

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
      step: t.string<"shipping" | "payment" | "review" | "complete">(),
      shippingAddress: t.object<Address>().nullable(),
      paymentMethod: t.object<PaymentMethod>().nullable(),
      processing: t.boolean(),
    },
  },

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
        await api.createOrder({
          shipping: context.facts.shippingAddress,
          payment: context.facts.paymentMethod,
        });
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

const system = createSystem({
  modules: {
    auth: authModule,
    cart: cartModule,
    checkout: checkoutModule,
  },
});

// Access namespaced facts
system.facts.auth.user;
system.facts.cart.items;
system.facts.checkout.step;
```

---

## Next Steps

- See [Multi-Module](/docs/advanced/multi-module) for composition patterns
- See [Data Fetching](/docs/examples/data-fetching) for async patterns
- See [Module and System](/docs/module-system) for setup
