---
title: Constraints
description: Constraints declare what must be true in your system. When conditions are met, they raise requirements for resolvers to fulfill.
---

Constraints are the heart of Directive – they declare what must be true. {% .lead %}

---

## Basic Constraints

Define constraints in your module to declare conditions and their requirements:

```typescript
import { createModule, t } from '@directive-run/core';

const userModule = createModule("user", {
  schema: {
    facts: {
      userId: t.number(),
      user: t.object<User>().nullable(),
      loading: t.boolean(),
    },
    requirements: {
      FETCH_USER: { userId: t.number() },
    },
  },

  constraints: {
    needsUser: {
      // When we have a userId but no user data and aren't loading
      when: (facts) => facts.userId > 0 && !facts.user && !facts.loading,

      // Dynamically build the requirement with the current userId
      require: (facts) => ({ type: "FETCH_USER", userId: facts.userId }),
    },
  },
});
```

---

## Constraint Anatomy

| Property | Type | Description |
|----------|------|-------------|
| `when` | `(facts) => boolean \| Promise<boolean>` | Condition – returns true when the constraint is active |
| `require` | `Requirement \| Requirement[] \| (facts) => Requirement \| Requirement[] \| null` | What to produce when `when` is true |
| `priority` | `number` | Evaluation order (higher runs first, default: 0) |
| `after` | `string[]` | Constraint IDs that must resolve before this one evaluates |
| `async` | `boolean` | Mark as async (avoids runtime detection overhead) |
| `timeout` | `number` | Timeout in ms for async `when()` evaluation (default: 5000) |

---

## Auto-Tracking

Constraint `when()` functions are auto-tracked – Directive records which facts are read during evaluation. On subsequent reconciliation cycles, only constraints affected by changed facts are re-evaluated. This means you don't need to declare dependencies manually.

```typescript
constraints: {
  needsUser: {
    // Directive auto-tracks which facts are read here
    // Only re-evaluates when userId or user changes
    when: (facts) => facts.userId > 0 && facts.user === null,
    require: { type: "FETCH_USER" },
  },
}
```

---

## Require Variants

The `require` field supports multiple forms:

```typescript
constraints: {
  // Static – always produces the same requirement
  simple: {
    when: (facts) => !facts.data,
    require: { type: "FETCH_DATA" },
  },

  // Dynamic – builds requirement from current facts
  dynamic: {
    when: (facts) => facts.userId > 0 && !facts.user,
    require: (facts) => ({
      type: "FETCH_USER",
      userId: facts.userId,
      includeProfile: facts.needsProfile,
    }),
  },

  // Multiple – produce several requirements at once
  multiple: {
    when: (facts) => facts.isNewUser,
    require: [
      { type: "SEND_WELCOME_EMAIL" },
      { type: "CREATE_DEFAULT_SETTINGS" },
    ],
  },

  // Conditional – return null to skip producing a requirement
  conditional: {
    when: (facts) => facts.needsSync,
    require: (facts) => facts.isCritical
      ? [{ type: "SYNC_NOW" }, { type: "NOTIFY_ADMIN" }]
      : null,
  },
},
```

---

## Priority Ordering

When multiple constraints are active, priority determines evaluation order:

```typescript
constraints: {
  // Low priority – runs after higher-priority constraints
  lowPriority: {
    priority: 10,
    when: (facts) => facts.needsData,
    require: { type: "FETCH_DATA" },
  },

  // High priority – evaluated before lower numbers
  highPriority: {
    priority: 100,
    when: (facts) => facts.needsAuth,
    require: { type: "AUTHENTICATE" },
  },

  // Emergency – always evaluated first
  emergency: {
    priority: 1000,
    when: (facts) => facts.securityBreach,
    require: { type: "LOCKDOWN" },
  },
}
```

Higher priority constraints are evaluated first. Default priority is 0.

{% constraint-priority-diagram /%}

---

## Constraint Dependencies (`after`)

{% constraint-dependency-diagram /%}

Use `after` to ensure one constraint's resolver completes before another constraint evaluates:

```typescript
constraints: {
  // Step 1: Authenticate first
  authenticate: {
    when: (facts) => !facts.isAuthenticated,
    require: { type: "AUTH" },
  },

  // Step 2: Fetch user data after authentication completes
  fetchUserData: {
    after: ["authenticate"],
    when: (facts) => facts.isAuthenticated && !facts.userData,
    require: { type: "FETCH_USER_DATA" },
  },

  // Step 3: Fetch preferences after user data is loaded
  fetchPreferences: {
    after: ["fetchUserData"],
    when: (facts) => facts.userData && !facts.preferences,
    require: { type: "FETCH_PREFERENCES" },
  },
}
```

**Behavior:**
- If constraint B has `after: ["A"]`, B's `when()` is not called until A's resolver completes
- If A's `when()` returns false (no requirement), B proceeds immediately – nothing to wait for
- If A's resolver fails, B remains blocked until A succeeds (retries apply)
- Cycles are detected at startup: `"[Directive] Constraint cycle detected: A → B → A"`

**Priority vs `after`:**
- `after` always takes precedence – a constraint with `after: ["A"]` will always wait for A, regardless of priority
- `priority` only affects ordering among constraints that have no `after` dependencies on each other
- Constraints with the same priority and no mutual `after` dependencies may run in parallel

**Cross-module references:** Use `"moduleName::constraintName"` format for `after` dependencies across modules. Note: unlike `deps`, constraint `after` references are not auto-prefixed in multi-module systems – you must use the full `"namespace::constraintName"` format.

---

## Async Constraints

The `when()` function can be async for conditions that require I/O. Mark with `async: true` to avoid runtime detection overhead:

```typescript
constraints: {
  needsPermission: {
    async: true,
    timeout: 3000,  // Override default 5s timeout
    when: async (facts) => {
      // Check external permission service before proceeding
      const allowed = await checkPermissions(facts.userId);

      return allowed && !facts.hasData;
    },
    require: { type: "FETCH_DATA" },
  },
}
```

If you omit `async: true` and `when()` returns a Promise, Directive detects it at runtime and logs a dev warning. Async constraints within the same evaluation cycle run in parallel.

{% callout type="warning" title="Async race conditions" %}
When `when()` is async, facts can change while the promise is pending. Any fact reads **after** `await` see the latest values, not the values at evaluation start. For stable behavior, read all facts **before** the first `await`, or use explicit `deps` to declare which facts the constraint depends on:

```typescript
constraints: {
  asyncSafe: {
    async: true,
    deps: ["userId", "hasData"],  // Explicit deps — re-evaluated when these change
    when: async (facts) => {
      const allowed = await checkPermissions(facts.userId);

      return allowed && !facts.hasData;
    },
    require: { type: "FETCH_DATA" },
  },
}
```
{% /callout %}

{% callout type="note" title="Namespace syntax in multi-module systems" %}
Multi-module systems use different separators for different contexts:

- **Constraint `after`:** `"moduleName::constraintName"` (double colon)
- **Fact access in code:** `system.facts.moduleName.factKey` (dot access)
- **Constraint `deps`:** `["factKey"]` (auto-prefixed with module namespace)

The `::` separator is used internally and in `after` references. You never need it for fact access or `deps` — those are handled automatically.
{% /callout %}

---

## Complex Conditions

Combine multiple conditions for precise control:

```typescript
constraints: {
  canCheckout: {
    when: (facts) => {
      // All conditions must be met before checkout can proceed
      const hasItems = facts.cart.items.length > 0;
      const hasPayment = facts.paymentMethod !== null;
      const isAuthenticated = facts.user !== null;
      const notProcessing = !facts.checkoutInProgress;

      return hasItems && hasPayment && isAuthenticated && notProcessing;
    },
    require: { type: "PROCESS_CHECKOUT" },
  },
}
```

---

## Constraint Groups

Organize related constraints logically:

```typescript
const cartModule = createModule("cart", {
  constraints: {
    // --- Validation constraints (highest priority) ---
    validateStock: {
      priority: 100,
      when: (facts) => facts.needsStockCheck,
      require: { type: "CHECK_STOCK" },
    },
    validatePricing: {
      priority: 100,
      when: (facts) => facts.needsPriceCheck,
      require: { type: "CHECK_PRICES" },
    },

    // --- Action constraints (medium priority) ---
    applyDiscount: {
      priority: 50,
      when: (facts) => facts.discountCode && !facts.discountApplied,
      require: { type: "APPLY_DISCOUNT" },
    },
    calculateTax: {
      priority: 50,
      when: (facts) => facts.subtotal > 0 && !facts.taxCalculated,
      require: { type: "CALCULATE_TAX" },
    },

    // --- Final constraints (run after validations complete) ---
    checkout: {
      priority: 10,
      after: ["validateStock", "validatePricing", "calculateTax"],
      when: (facts) => facts.readyToCheckout,
      require: { type: "CHECKOUT" },
    },
  },
});
```

---

## Constraint Evaluation

Constraints are evaluated:

1. When facts change (only affected constraints, thanks to auto-tracking)
2. After a resolver completes
3. During reconciliation (triggered by `system.start()` and fact changes)

The engine continuously evaluates until no more constraints are active.

---

## Preventing Re-Triggering

Guard against infinite loops by checking for existing data:

```typescript
constraints: {
  fetchUser: {
    when: (facts) => {
      // Guard against re-triggering: only fetch if we don't have
      // the user AND aren't already loading
      return facts.userId > 0
        && facts.user === null
        && !facts.loading;
    },
    require: { type: "FETCH_USER" },
  },
}
```

---

## Best Practices

### Keep Conditions Pure

```typescript
// Good - pure function
when: (facts) => facts.count > 10

// Bad - side effects in condition
when: (facts) => {
  console.log("Checking...");  // Don't do this

  return facts.count > 10;
}
```

### Use Descriptive Names

```typescript
constraints: {
  // Good - describes intent
  userNeedsAuthentication: { ... },
  cartRequiresPriceRecalculation: { ... },

  // Bad - vague names
  check1: { ... },
  doThing: { ... },
}
```

### Single Responsibility

Each constraint should handle one specific requirement:

```typescript
// Good - separate concerns
constraints: {
  needsAuth: { when: ... , require: { type: "AUTH" } },
  needsProfile: { when: ..., require: { type: "FETCH_PROFILE" } },
}

// Bad - mixed concerns
constraints: {
  setup: { when: ..., require: { type: "AUTH_AND_FETCH_PROFILE" } },
}
```

---

## Runtime Control

Disable or enable constraints at runtime without removing them from the module definition:

```typescript
// Disable a constraint – its when() function won't be called
system.constraints.disable("expensiveCheck");

// Re-enable it for future reconciliation cycles
system.constraints.enable("expensiveCheck");
```

This is useful for feature flags, A/B testing, or temporarily suppressing constraints during maintenance windows. Disabled constraints are skipped entirely – their `when()` function is never called.

---

## Next Steps

- [Resolvers](/docs/resolvers) – Handling requirements
- [Derivations](/docs/derivations) – Computed values
- [Effects](/docs/effects) – Side effects
- [Events](/docs/events) – Typed event dispatching
