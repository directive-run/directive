---
title: Events
description: Events are type-safe state mutation handlers. Define named operations that modify facts with typed payloads.
---

Events are type-safe state mutation handlers – named operations that modify facts. {% .lead %}

---

## Defining Events

Events are defined in two places: the **schema** declares the payload shape, and the **events** object defines the handler:

```typescript
import { createModule, t } from '@directive-run/core';

const counterModule = createModule("counter", {
  schema: {
    // Define the state shape for this module
    facts: {
      count: t.number(),
      items: t.array<string>(),
    },

    // Declare event names and their payload types
    events: {
      increment: {},                        // No payload needed
      addAmount: { amount: t.number() },    // Requires a numeric amount
      addItem: { item: t.string() },        // Requires a string item
    },
  },

  // Set initial state when the system starts
  init: (facts) => {
    facts.count = 0;
    facts.items = [];
  },

  // Event handlers mutate facts synchronously
  events: {
    // Simple mutation – no payload required
    increment: (facts) => {
      facts.count += 1;
    },

    // Destructure the typed payload from the schema
    addAmount: (facts, { amount }) => {
      facts.count += amount;
    },

    // Immutable update – replace the array, don't push
    addItem: (facts, { item }) => {
      facts.items = [...facts.items, item];
    },
  },
});
```

---

## Event Anatomy

Event handlers are functions that receive facts and an optional typed payload:

```typescript
// No payload – simple mutation
eventName: (facts) => {
  facts.someValue = newValue;
}

// With payload – typed from schema.events
eventName: (facts, { field1, field2 }) => {
  facts.someValue = field1;
}
```

| Part | Description |
|------|-------------|
| `facts` | Writable facts proxy – mutate directly |
| `payload` | Typed from schema.events definition (optional) |
| Return | `void` – events are synchronous |

---

## Dispatching Events

Two ways to dispatch events:

### `system.events` accessor (recommended)

The typed proxy provides autocomplete and type checking:

```typescript
const system = createSystem({ module: counterModule });
system.start();

// Call events as typed methods – TypeScript enforces payload shapes
system.events.increment();                  // No payload needed
system.events.addAmount({ amount: 5 });     // Typed payload with autocomplete
system.events.addItem({ item: "hello" });   // Compile-time type checking
```

### `system.dispatch()` object syntax

Pass a full event object with `type`:

```typescript
// Object syntax with explicit type field
system.dispatch({ type: "increment" });
system.dispatch({ type: "addAmount", amount: 5 });
system.dispatch({ type: "addItem", item: "hello" });
```

Both approaches are equivalent. The `events` accessor is more ergonomic with better type inference.

---

## Batched Mutations

Event handlers run inside `store.batch()` – all fact mutations within a handler are coalesced into a single notification. This means constraints and derivations are only re-evaluated once after the handler completes, not after each individual mutation:

```typescript
events: {
  resetAll: (facts) => {
    // All three mutations trigger ONE reconciliation, not three
    facts.count = 0;
    facts.items = [];
    facts.error = null;
  },
}
```

---

## Complex Mutations

Events are the right place for multi-step state changes:

```typescript
const cartModule = createModule("cart", {
  schema: {
    facts: {
      items: t.array<CartItem>(),
      subtotal: t.number(),
    },

    events: {
      addToCart: { productId: t.string(), price: t.number(), quantity: t.number() },
      removeFromCart: { productId: t.string() },
      clearCart: {},
    },
  },

  events: {
    addToCart: (facts, { productId, price, quantity }) => {
      // Update quantity if item already exists, otherwise add new
      const existing = facts.items.find(i => i.productId === productId);
      if (existing) {
        facts.items = facts.items.map(i =>
          i.productId === productId
            ? { ...i, quantity: i.quantity + quantity }
            : i
        );
      } else {
        facts.items = [...facts.items, { productId, price, quantity }];
      }

      // Recalculate subtotal after modification
      facts.subtotal = facts.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    },

    removeFromCart: (facts, { productId }) => {
      facts.items = facts.items.filter(i => i.productId !== productId);
      facts.subtotal = facts.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    },

    clearCart: (facts) => {
      facts.items = [];
      facts.subtotal = 0;
    },
  },
});
```

---

## Namespaced Events (Multi-Module)

In multi-module systems using the object syntax, events are namespaced automatically:

```typescript
const system = createSystem({
  modules: {
    auth: authModule,
    cart: cartModule,
  },
});

// Access events through the module namespace
system.events.auth.login({ token: "abc" });
system.events.cart.addToCart({ productId: "123", price: 999, quantity: 1 });

// Or use dispatch with prefixed type names
system.dispatch({ type: "auth::login", token: "abc" });
system.dispatch({ type: "cart::addToCart", productId: "123", price: 999, quantity: 1 });
```

---

## Tick Events

For time-based systems, Directive supports a built-in tick mechanism:

```typescript
const timerModule = createModule("timer", {
  schema: {
    facts: { elapsed: t.number() },
    events: { tick: {} },
  },

  init: (facts) => { facts.elapsed = 0; },

  events: {
    // Called automatically at the configured interval
    tick: (facts) => {
      facts.elapsed += 1;
    },
  },
});

// Dispatch "tick" every 1000ms while the system is running
const system = createSystem({
  module: timerModule,
  tickMs: 1000,
});
system.start();
```

The system automatically dispatches the `tick` event at the configured interval. A dev warning is shown if `tickMs` is set but no module defines a `tick` event handler.

{% callout type="note" title="Time-travel tip" %}
Tick events fire frequently and clutter undo history. Use `snapshotEvents` to exclude them from time-travel snapshots &ndash; see [Filtering Snapshot Events](/docs/advanced/history#filtering-snapshot-events).
{% /callout %}

---

## Dev-Mode Warnings

In development, dispatching an unknown event type logs a warning:

```typescript
// Dispatching an unknown event type logs a helpful warning
system.dispatch({ type: "typo_event" });
// [Directive] Unknown event type "typo_event".
// No handler is registered for this event.
// Available events: increment, addAmount, addItem
```

---

## Events vs Other Concepts

| Aspect | Events | Effects | Resolvers |
|--------|--------|---------|-----------|
| Purpose | Mutate facts | Side effects (logging, DOM) | Fulfill requirements (API calls) |
| Trigger | Explicit dispatch | Fact changes | Constraint activation |
| Modifies facts | Yes (primary purpose) | No | Yes |
| Synchronous | Yes | Can be async | Async |
| Batched | Yes (auto) | N/A | Yes (auto) |

---

## Best Practices

### Keep Handlers Focused

Each event should represent one logical mutation:

```typescript
// Good - clear, focused events
events: {
  setUser: (facts, { user }) => { facts.user = user; },
  clearUser: (facts) => { facts.user = null; },
}

// Avoid - vague catch-all
events: {
  update: (facts, { key, value }) => { facts[key] = value; },
}
```

### Use Descriptive Names

```typescript
// Good - describes what happens
"addToCart"
"removeItem"
"resetFilters"

// Avoid - vague
"update"
"set"
"handle"
```

### Don't Put Async Logic in Events

Events are synchronous fact mutations. For async operations, use constraints and resolvers:

```typescript
// Bad - don't do async in events
events: {
  fetchUser: async (facts) => {           // Don't do this!
    facts.user = await api.getUser(123);
  },
}

// Good - use constraints + resolvers for async
constraints: {
  needsUser: {
    when: (facts) => facts.userId > 0 && !facts.user,
    require: { type: "FETCH_USER" },
  },
}
```

---

## Next Steps

- [Facts](/docs/facts) – State store
- [Constraints](/docs/constraints) – Declarative rules
- [Derivations](/docs/derivations) – Computed values
- [Resolvers](/docs/resolvers) – Handling requirements
- [Effects](/docs/effects) – Side effects on fact changes
- [Module & System](/docs/module-system) – Composing modules
- [Choosing Primitives](/docs/choosing-primitives) – When to use what
