---
title: How to Use batch() to Prevent Glitches
description: Multi-field updates that never expose intermediate states to constraints or the UI.
---

Multi-field updates that never expose intermediate states to constraints or the UI. {% .lead %}

---

## The Problem

When you update multiple related facts one at a time, constraints evaluate between each update. If a constraint reads both `status` and `items`, updating `status` first triggers evaluation with the new status but stale items – a "glitch." The constraint may emit requirements based on this inconsistent intermediate state, causing unnecessary API calls or incorrect UI.

## The Solution

```typescript
import { createModule, t } from 'directive';

const checkout = createModule('checkout', {
  schema: {
    items: t.array<{ id: string; price: number }>(),
    status: t.string<'idle' | 'processing' | 'complete' | 'error'>(),
    total: t.number(),
    orderId: t.string().optional(),
  },

  init: (facts) => {
    facts.items = [];
    facts.status = 'idle';
    facts.total = 0;
    facts.orderId = undefined;
  },

  constraints: {
    needsPayment: {
      when: (facts) => facts.status === 'processing' && facts.total > 0,
      require: (facts) => ({
        type: 'PROCESS_PAYMENT',
        total: facts.total,
        items: facts.items,
      }),
    },
  },

  resolvers: {
    processPayment: {
      requirement: 'PROCESS_PAYMENT',
      resolve: async (req, ctx) => {
        const res = await fetch('/api/payment', {
          method: 'POST',
          body: JSON.stringify({ total: req.total, items: req.items }),
        });
        const data = await res.json();

        // Batch the completion update
        ctx.system.batch(() => {
          ctx.facts.status = 'complete';
          ctx.facts.orderId = data.orderId;
          ctx.facts.items = [];
          ctx.facts.total = 0;
        });
      },
    },
  },
});
```

```tsx
function CheckoutButton({ system }) {
  const { facts } = useDirective(system);

  const handleCheckout = () => {
    // Without batch: constraints see status='processing' with old total
    // With batch: constraints see both updates atomically
    system.batch(() => {
      system.facts.status = 'processing';
      system.facts.total = system.facts.items.reduce(
        (sum, i) => sum + i.price, 0,
      );
    });
  };

  return (
    <button onClick={handleCheckout} disabled={facts.status === 'processing'}>
      Checkout ({facts.items.length} items)
    </button>
  );
}
```

## Step by Step

1. **`system.batch()` defers all notifications** – fact changes inside the callback are applied immediately to the store, but listeners (constraints, derivations, effects, React subscribers) are not notified until the batch completes.

2. **Constraints see consistent state** – when `needsPayment` evaluates after the batch, both `status` and `total` reflect the new values. There's no intermediate state where status is `'processing'` but total is still `0`.

3. **Batches inside resolvers use `ctx.system.batch()`** – when a resolver completes and updates multiple facts, batching prevents the UI from briefly showing a "complete" status with stale items.

4. **Derivations recompute once** – without batch, changing `items` then `total` triggers two derivation cycles. With batch, derivations recompute once with the final state.

## Common Variations

### Resetting a form

```typescript
function resetForm(system) {
  system.batch(() => {
    system.facts.name = '';
    system.facts.email = '';
    system.facts.phone = '';
    system.facts.errors = {};
    system.facts.touched = {};
    system.facts.submitStatus = 'idle';
  });
}
```

### Batch with return value

```typescript
// batch() returns whatever the callback returns
const total = system.batch(() => {
  system.facts.items = newItems;
  const sum = newItems.reduce((s, i) => s + i.price, 0);
  system.facts.total = sum;

  return sum;
});
console.log(total); // The computed sum
```

### Nested batches

```typescript
// Nested batches are safe – only the outermost batch flushes
system.batch(() => {
  system.facts.status = 'loading';
  system.batch(() => {
    // This inner batch doesn't trigger an intermediate flush
    system.facts.items = [];
    system.facts.total = 0;
  });
  system.facts.message = 'Resetting...';
});
// All four changes flush together here
```

## Related

- [Facts](/docs/facts) – store internals and notification model
- [Constraints](/docs/constraints) – evaluation timing
- [WebSocket Connections](/docs/how-to/websockets) – batching socket events
- [Optimize Re-Renders](/docs/how-to/optimize-rerenders) – reducing React updates
