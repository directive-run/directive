---
title: Derivations
description: Derivations are auto-tracked computed values. No dependency arrays – they automatically know what they depend on.
---

Derivations compute values from facts with automatic dependency tracking. {% .lead %}

---

## Basic Derivations

Define derivations in the `derive` block of your module. Each derivation is a function that receives `facts` and returns a computed value:

```typescript
import { createModule, t } from '@directive-run/core';

const userModule = createModule("user", {
  schema: {
    facts: {
      firstName: t.string(),
      lastName: t.string(),
      age: t.number(),
    },
    derivations: {
      fullName: t.string(),
      isAdult: t.boolean(),
      ageGroup: t.string(),
    },
  },

  init: (facts) => {
    facts.firstName = "";
    facts.lastName = "";
    facts.age = 0;
  },

  // Derivations auto-track which facts they read
  derive: {
    // Combine two facts into a display string
    fullName: (facts) => `${facts.firstName} ${facts.lastName}`,

    // Boolean derivation from a numeric fact
    isAdult: (facts) => facts.age >= 18,

    // Multi-branch logic for categorization
    ageGroup: (facts) => {
      if (facts.age < 13) {
        return "child";
      }

      if (facts.age < 20) {
        return "teen";
      }

      return "adult";
    },
  },
});
```

---

## Auto-Tracking

Derivations automatically track which facts they access – no dependency arrays needed:

```typescript
derive: {
  // Automatically tracks firstName and lastName – ignores age
  fullName: (facts) => `${facts.firstName} ${facts.lastName}`,
}
```

This derivation:
- Tracks `firstName` and `lastName`
- Recomputes when either changes
- Ignores changes to `age`

```
    Facts:        user        cart        promo
                    \          |          /
                     \         |         /
    Derivations:   isEligible  |   itemCount
                        \      |      /
                         \     |     /
    Composed:        checkoutReady
```

---

## Accessing Derivations

### Derive proxy

The most common way – access derivations as properties on `system.derive`:

```typescript
const system = createSystem({ module: userModule });
system.start();

// Set some fact values
system.facts.firstName = "Jane";
system.facts.lastName = "Doe";

// Read derivations – recomputed automatically when facts change
system.derive.fullName;   // "Jane Doe"
system.derive.isAdult;    // false
system.derive.ageGroup;   // "child"
```

For namespaced (multi-module) systems:

```typescript
const system = createSystem({
  modules: { user: userModule, cart: cartModule },
});

// Derivations are namespaced by module
system.derive.user.fullName;      // "Jane Doe"
system.derive.cart.totalPrice;    // 42.99
```

### Read by ID

Read a derivation value by its string ID. This is the same value as `system.derive.X`, but useful when the derivation name is dynamic or when passing to framework adapters:

```typescript
// Read by string ID (useful when name is dynamic)
system.read("fullName");          // "Jane Doe"

// Namespaced – dot syntax
system.read("user.fullName");     // "Jane Doe"
```

---

## Subscribing to Derivations

### `system.subscribe()`

Subscribe to one or more keys. The listener fires whenever any of the listed keys change. `subscribe()` auto-detects whether each key is a fact or derivation – you can mix both in a single call.

```typescript
// Subscribe to a single derivation
const unsub = system.subscribe(["fullName"], () => {
  console.log("Name changed:", system.derive.fullName);
});

// Subscribe to multiple derivations at once
const unsub2 = system.subscribe(["fullName", "isAdult"], () => {
  console.log("Name or age status changed");
});

// Mix facts and derivations in one subscription
const unsub3 = system.subscribe(["age", "fullName"], () => {
  console.log("Age fact or fullName derivation changed");
});

// Namespaced subscriptions
const unsub4 = system.subscribe(["user.fullName", "cart.totalPrice"], () => {
  console.log("User or cart changed");
});

// Clean up when no longer needed
unsub();
```

### `system.watch()`

Watch a single key (fact or derivation) with old and new values. Like `subscribe()`, `watch()` auto-detects the key type.

You can pass an optional `equalityFn` to control when the listener fires. By default, values are compared with `===`. Provide a custom function to suppress notifications when the value is semantically unchanged (useful for object or array values):

```typescript
// Watch a single derivation with old and new values
const unsub = system.watch("fullName", (newValue, previousValue) => {
  console.log(`Name changed from "${previousValue}" to "${newValue}"`);
});

// Namespaced watch
const unsub2 = system.watch("user.ageGroup", (newVal, oldVal) => {
  console.log(`Age group: ${oldVal} → ${newVal}`);
});

// Custom equality – only fire when the array length changes
const unsub3 = system.watch("activeUsers", (newVal, oldVal) => {
  console.log(`Active user count: ${newVal.length}`);
}, { equalityFn: (a, b) => a.length === b.length });

unsub();
```

---

## Composed Derivations

```
    Facts:         items       tax      shipping
                     │          │          │
    Derivations:  subtotal     fees ◄──────┘
                     │          │
                     └────┬─────┘
                          ▼
    Composed:          total
```

Derivations can depend on other derivations via the second parameter (`derived`):

```typescript
derive: {
  // Base derivations from facts
  firstName: (facts) => facts.user?.name.split(' ')[0] ?? "",
  lastName: (facts) => facts.user?.name.split(' ')[1] ?? "",

  // Composed – depends on firstName and lastName derivations
  initials: (facts, derived) =>
    `${derived.firstName[0] ?? ""}${derived.lastName[0] ?? ""}`.toUpperCase(),

  // Composed – depends on firstName derivation
  greeting: (facts, derived) =>
    `Hello, ${derived.firstName}!`,
}
```

The dependency graph is resolved automatically. If `firstName` changes, `initials` and `greeting` both recompute.

{% callout type="warning" title="Circular dependencies" %}
A derivation cannot depend on itself (directly or indirectly). Directive detects circular dependencies at runtime and throws an error.
{% /callout %}

---

## Lazy Evaluation

Derivations are lazy – they only compute when accessed:

```typescript
derive: {
  expensiveCalculation: (facts) => {
    // Only runs when someone reads the derivation
    return heavyComputation(facts.data);
  },
}

// Changing the fact just marks the derivation as stale
system.facts.data = largeDataset;

// Now it computes (and caches the result)
const result = system.derive.expensiveCalculation;
```

---

## Caching

Results are cached until a dependency changes:

```typescript
derive: {
  filtered: (facts) => facts.items.filter(item => item.active),
}

// First access: computes and caches the result
const result1 = system.derive.filtered;

// Second access: returns cached value (no recomputation)
const result2 = system.derive.filtered;

// Changing a dependency marks the derivation as stale
system.facts.items = [...items, newItem];

// Next access: recomputes with updated data
const result3 = system.derive.filtered;
```

---

## Conditional Dependencies

Derivations only track facts they actually access in a given run:

```typescript
derive: {
  display: (facts) => {
    if (facts.showDetails) {
      // Only tracked when showDetails is true
      return facts.details;
    }
    return facts.summary;
  },
}
```

When `showDetails` is false:
- Only `showDetails` and `summary` are tracked
- Changes to `details` won't trigger recomputation

When `showDetails` becomes true:
- Dependencies update to include `details`
- `summary` is no longer tracked

---

## Complex Derivations

### Array Operations

```typescript
derive: {
  // Filter to active items only
  activeItems: (facts) => facts.items.filter(i => i.active),

  // Sum all item prices
  totalPrice: (facts) => facts.items.reduce((sum, i) => sum + i.price, 0),

  // Sort by name (spread to avoid mutating the original)
  sortedItems: (facts) => [...facts.items].sort((a, b) => a.name.localeCompare(b.name)),
}
```

### Multiple Facts

```typescript
derive: {
  // Combine multiple facts into a boolean check
  canCheckout: (facts) =>
    facts.cart.length > 0 &&
    facts.user !== null &&
    facts.paymentMethod !== null,
}
```

### With Composition

```typescript
derive: {
  // Base: filter active users
  activeUsers: (facts) => facts.users.filter(u => u.active),

  // Composed: filter admins from active users
  activeAdmins: (facts, derived) =>
    derived.activeUsers.filter(u => u.role === 'admin'),

  // Composed: count from activeAdmins
  activeAdminCount: (facts, derived) => derived.activeAdmins.length,
}
```

---

## Type Inference

Derivation return types are inferred automatically:

```typescript
derive: {
  count: (facts) => facts.items.length,           // number
  names: (facts) => facts.users.map(u => u.name), // string[]
  isReady: (facts) => facts.loaded && !facts.error, // boolean
}

// TypeScript infers the return types automatically
const count: number = system.derive.count;
const names: string[] = system.derive.names;
```

---

## Best Practices

### Keep Derivations Pure

Derivations should be pure functions with no side effects:

```typescript
// Good – pure computation
fullName: (facts) => `${facts.firstName} ${facts.lastName}`

// Bad – side effect in a derivation
fullName: (facts) => {
  console.log("Computing name");  // Don't do this

  return `${facts.firstName} ${facts.lastName}`;
}
```

Use [Effects](/docs/effects) for side effects instead.

### Use Composition Over Duplication

Break complex derivations into smaller ones:

```typescript
derive: {
  // Good – composed, each piece is reusable
  activeUsers: (facts) => facts.users.filter(u => u.active),
  activeAdmins: (facts, derived) => derived.activeUsers.filter(u => u.admin),

  // Not as good – duplicated filter logic
  activeAdmins: (facts) => facts.users.filter(u => u.active && u.admin),
}
```

### Avoid Expensive Work in Derivations

Derivations recompute whenever their dependencies change. For expensive operations, consider storing the result in a fact via an effect or resolver instead.

---

## Runtime Registration

Register, override, or remove derivations at runtime — useful for plugin-provided computed values or dynamic business rules:

```typescript
// Register a new derivation at runtime
system.derive.register("tripled", (facts) => facts.count * 3);

// Access it like any other derivation
system.derive.tripled; // => 15

// Override an existing derivation's logic
system.derive.assign("doubled", (facts) => facts.count * 20);

// Remove a dynamically registered derivation
system.derive.unregister("tripled");

// Recompute a derivation (ignores cache)
const value = system.derive.call("doubled");
```

### Introspection

```typescript
system.derive.isDynamic("tripled");   // true
system.derive.isDynamic("doubled");   // false (module-defined)
system.derive.listDynamic();          // ["tripled"]
```

{% callout type="warning" title="Reserved names" %}
Derivation IDs cannot be `register`, `assign`, `unregister`, `call`, `isDynamic`, or `listDynamic` — these names are reserved for the runtime registration methods on the `derive` proxy.
{% /callout %}

### Semantics

| Method | ID exists (static) | ID exists (dynamic) | ID doesn't exist |
|--------|-------------------|---------------------|--------------------|
| `register` | throws | throws | creates |
| `assign` | overrides | overrides | throws |
| `unregister` | dev warning, no-op | removes | dev warning, no-op |
| `call` | recomputes | recomputes | throws |

{% callout type="note" title="Deferred during reconciliation" %}
If you call `register`, `assign`, or `unregister` during a reconciliation cycle, the operation is automatically deferred and applied after the current cycle completes.
{% /callout %}

---

## Next Steps

- **[Facts](/docs/facts)** – The source data for derivations
- **[Constraints](/docs/constraints)** – Use facts in rules (cross-module constraints can also read derivations via `crossModuleDeps`)
- **[Effects](/docs/effects)** – Side effects that run after stabilization
- **[Events](/docs/events)** – Dispatch typed events to mutate facts
