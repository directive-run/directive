---
title: How to Build Shopping Cart Business Rules
description: Implement quantity limits, coupon validation, inventory checks, and checkout gating with Directive constraints.
---

Quantity limits, coupon validation, inventory checks, and checkout gating — the constraint-driven business rules that make Directive shine. {% .lead %}

---

## The Problem

The multi-module example shows a skeleton cart but not the constraint-driven business rules: when a quantity exceeds stock, automatically adjust it. When a coupon code is entered, validate it asynchronously. When checkout is requested, gate it on authentication and cart validity. These interdependent rules need clear ordering, and errors in one shouldn't block the others.

## The Solution

```typescript
import { createModule, createSystem, t } from '@directive-run/core';
import { devtoolsPlugin } from '@directive-run/core/plugins';

interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  maxStock: number;
}

const cart = createModule('cart', {
  schema: {
    items: t.object<CartItem[]>(),
    couponCode: t.string(),
    couponDiscount: t.number(),
    couponStatus: t.string<'idle' | 'checking' | 'valid' | 'invalid'>(),
    checkoutRequested: t.boolean(),
    checkoutStatus: t.string<'idle' | 'processing' | 'complete' | 'failed'>(),
  },

  init: (facts) => {
    facts.items = [];
    facts.couponCode = '';
    facts.couponDiscount = 0;
    facts.couponStatus = 'idle';
    facts.checkoutRequested = false;
    facts.checkoutStatus = 'idle';
  },

  derive: {
    subtotal: (facts) => facts.items.reduce((sum, item) => sum + item.price * item.quantity, 0),
    itemCount: (facts) => facts.items.reduce((sum, item) => sum + item.quantity, 0),
    isEmpty: (facts) => facts.items.length === 0,
    discount: (facts) => facts.couponDiscount,
    tax: (facts, derive) => Math.round((derive.subtotal - derive.discount) * 0.08 * 100) / 100,
    total: (facts, derive) => Math.max(0, derive.subtotal - derive.discount + derive.tax),
    hasOverstockedItem: (facts) => facts.items.some((item) => item.quantity > item.maxStock),
    freeShipping: (facts, derive) => derive.subtotal >= 50,
  },

  constraints: {
    quantityLimit: {
      priority: 80,
      when: (facts) => facts.items.some((item) => item.quantity > item.maxStock),
      require: { type: 'ADJUST_QUANTITY' },
    },
    couponValidation: {
      priority: 70,
      when: (facts) => facts.couponCode !== '' && facts.couponStatus === 'idle',
      require: (facts) => ({
        type: 'VALIDATE_COUPON',
        code: facts.couponCode,
      }),
    },
    checkoutReady: {
      priority: 60,
      after: ['quantityLimit', 'couponValidation'],
      crossModuleDeps: ['auth.isAuthenticated'],
      when: (facts) => {
        return (
          facts.checkoutRequested &&
          facts.items.length > 0 &&
          !facts.items.some((item) => item.quantity > item.maxStock) &&
          facts.auth.isAuthenticated
        );
      },
      require: { type: 'PROCESS_CHECKOUT' },
    },
  },

  resolvers: {
    adjustQuantity: {
      requirement: 'ADJUST_QUANTITY',
      resolve: async (req, context) => {
        context.facts.items = context.facts.items.map((item) => ({
          ...item,
          quantity: Math.min(item.quantity, item.maxStock),
        }));
      },
    },
    validateCoupon: {
      requirement: 'VALIDATE_COUPON',
      resolve: async (req, context) => {
        context.facts.couponStatus = 'checking';
        const res = await fetch(`/api/coupons/validate?code=${req.code}`);
        const data = await res.json();

        if (data.valid) {
          context.facts.couponDiscount = data.discount;
          context.facts.couponStatus = 'valid';
        } else {
          context.facts.couponDiscount = 0;
          context.facts.couponStatus = 'invalid';
        }
      },
    },
    processCheckout: {
      requirement: 'PROCESS_CHECKOUT',
      retry: { attempts: 2, backoff: 'exponential' },
      resolve: async (req, context) => {
        context.facts.checkoutStatus = 'processing';
        const res = await fetch('/api/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: context.facts.items,
            couponCode: context.facts.couponCode,
          }),
        });

        if (!res.ok) {
          context.facts.checkoutStatus = 'failed';
          throw new Error('Checkout failed');
        }

        context.facts.items = [];
        context.facts.checkoutStatus = 'complete';
        context.facts.checkoutRequested = false;
      },
    },
  },

  events: {
    addItem: (facts, item: CartItem) => {
      const existing = facts.items.find((i) => i.id === item.id);
      if (existing) {
        facts.items = facts.items.map((i) =>
          i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i,
        );
      } else {
        facts.items = [...facts.items, { ...item, quantity: 1 }];
      }
    },
    removeItem: (facts, { id }: { id: string }) => {
      facts.items = facts.items.filter((i) => i.id !== id);
    },
    updateQuantity: (facts, { id, quantity }: { id: string; quantity: number }) => {
      facts.items = facts.items.map((i) =>
        i.id === id ? { ...i, quantity: Math.max(0, quantity) } : i,
      );
      facts.items = facts.items.filter((i) => i.quantity > 0);
    },
    applyCoupon: (facts, { code }: { code: string }) => {
      facts.couponCode = code;
      facts.couponStatus = 'idle';
      facts.couponDiscount = 0;
    },
    requestCheckout: (facts) => {
      facts.checkoutRequested = true;
    },
  },
});

const auth = createModule('auth', {
  schema: {
    isAuthenticated: t.boolean(),
    userId: t.string(),
  },

  init: (facts) => {
    facts.isAuthenticated = false;
    facts.userId = '';
  },

  derive: {
    isAuthenticated: (facts) => facts.isAuthenticated,
  },
});

const system = createSystem({
  modules: { cart, auth },
  plugins: [devtoolsPlugin({ panel: true })],
});
```

```tsx
function CartSummary({ system }) {
  const { facts, derived } = useDirective(system);

  return (
    <div>
      <p>Items: {derived['cart::itemCount']}</p>
      <p>Subtotal: ${derived['cart::subtotal'].toFixed(2)}</p>
      {derived['cart::discount'] > 0 && (
        <p>Discount: -${derived['cart::discount'].toFixed(2)}</p>
      )}
      <p>Tax: ${derived['cart::tax'].toFixed(2)}</p>
      <p>Total: ${derived['cart::total'].toFixed(2)}</p>
      {derived['cart::freeShipping'] && <p>Free shipping!</p>}
      <button
        disabled={derived['cart::isEmpty']}
        onClick={() => system.events.requestCheckout()}
      >
        Checkout
      </button>
    </div>
  );
}
```

## Step by Step

1. **`quantityLimit` constraint** (priority 80) fires first — when any item exceeds stock, the resolver clamps all quantities. This runs before checkout so the cart is always valid.

2. **`couponValidation` constraint** fires when a coupon code is set and status is `idle`. The resolver calls the API and sets `couponStatus` to `valid` or `invalid`.

3. **`checkoutReady` uses `after`** — it waits for both `quantityLimit` and `couponValidation` to settle before evaluating. This ensures checkout never proceeds with invalid quantities or an unchecked coupon.

4. **Cross-module auth gating** — `crossModuleDeps: ['auth.isAuthenticated']` ensures checkout only fires when the user is authenticated. Guest users see the checkout button but it won't proceed.

5. **Derivation composition** — `total` depends on `subtotal`, `discount`, and `tax`. Changing any item recalculates all three. The `freeShipping` derivation reads `subtotal` for threshold detection.

6. **`devtoolsPlugin({ panel: true })`** opens the DevTools panel, showing real-time constraint evaluation, resolver status, and fact changes — invaluable for debugging business rules.

## Common Variations

### Bundle discounts

```typescript
derive: {
  bundleDiscount: (facts) => {
    const hasShirt = facts.items.some((i) => i.category === 'shirts');
    const hasPants = facts.items.some((i) => i.category === 'pants');

    return hasShirt && hasPants ? 10 : 0;
  },
},
```

### Guest checkout path

```typescript
constraints: {
  checkoutReady: {
    when: (facts) => {
      return facts.checkoutRequested && facts.items.length > 0 && (
        facts.auth.isAuthenticated || facts.guestEmail !== ''
      );
    },
    require: { type: 'PROCESS_CHECKOUT' },
  },
},
```

### Real-time inventory checking

```typescript
constraints: {
  checkInventory: {
    when: (facts) => facts.items.length > 0 && facts.inventoryStale,
    require: (facts) => ({
      type: 'CHECK_INVENTORY',
      itemIds: facts.items.map((i) => i.id),
    }),
  },
},
```

## Related

- [Interactive Example](/docs/examples/shopping-cart) — try it in your browser
- [Constraints](/docs/constraints) — `after`, priority, and cross-module deps
- [Authentication Flow](/docs/how-to/auth-flow) — login/logout patterns
- [DevTools Plugin](/docs/plugins/devtools) — debugging constraints in real time
- [Error Boundaries](/docs/advanced/errors) — handling checkout failures
