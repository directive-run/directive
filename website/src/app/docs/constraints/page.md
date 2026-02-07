---
title: Constraints
description: Constraints declare what must be true in your system. When conditions are met, they raise requirements for resolvers to fulfill.
---

Constraints are the heart of Directive — they declare what must be true. {% .lead %}

---

## Basic Constraints

Define constraints in your module to declare conditions and their requirements:

```typescript
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
      when: (facts) => facts.userId > 0 && !facts.user && !facts.loading,
      require: (facts) => ({ type: "FETCH_USER", userId: facts.userId }),
    },
  },
});
```

---

## Constraint Anatomy

| Property | Type | Description |
|----------|------|-------------|
| `when` | `(facts) => boolean \| Promise<boolean>` | Condition — returns true when the constraint is active |
| `require` | `Requirement \| Requirement[] \| (facts) => Requirement \| Requirement[] \| null` | What to produce when `when` is true |
| `priority` | `number` | Evaluation order (higher runs first, default: 0) |
| `after` | `string[]` | Constraint IDs that must resolve before this one evaluates |
| `async` | `boolean` | Mark as async (avoids runtime detection overhead) |
| `timeout` | `number` | Timeout in ms for async `when()` evaluation (default: 5000) |

---

## Auto-Tracking

Constraint `when()` functions are auto-tracked — Directive records which facts are read during evaluation. On subsequent reconciliation cycles, only constraints affected by changed facts are re-evaluated. This means you don't need to declare dependencies manually.

```typescript
constraints: {
  needsUser: {
    // Directive knows this depends on userId and user
    // It will only re-evaluate when those facts change
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
  // Static object — always produces the same requirement
  simple: {
    when: (facts) => !facts.data,
    require: { type: "FETCH_DATA" },
  },

  // Function — dynamic requirement based on current facts
  dynamic: {
    when: (facts) => facts.userId > 0 && !facts.user,
    require: (facts) => ({
      type: "FETCH_USER",
      userId: facts.userId,
      includeProfile: facts.needsProfile,
    }),
  },

  // Array — produce multiple requirements at once
  multiple: {
    when: (facts) => facts.isNewUser,
    require: [
      { type: "SEND_WELCOME_EMAIL" },
      { type: "CREATE_DEFAULT_SETTINGS" },
    ],
  },

  // Conditional — function returning null to skip
  conditional: {
    when: (facts) => facts.needsSync,
    require: (facts) => facts.isCritical
      ? [{ type: "SYNC_NOW" }, { type: "NOTIFY_ADMIN" }]
      : null,  // No requirement produced
  },
},
```

---

## Priority Ordering

When multiple constraints are active, priority determines evaluation order:

```typescript
constraints: {
  lowPriority: {
    priority: 10,
    when: (facts) => facts.needsData,
    require: { type: "FETCH_DATA" },
  },
  highPriority: {
    priority: 100,
    when: (facts) => facts.needsAuth,
    require: { type: "AUTHENTICATE" },
  },
  emergency: {
    priority: 1000,
    when: (facts) => facts.securityBreach,
    require: { type: "LOCKDOWN" },
  },
}
```

Higher priority constraints are evaluated first. Default priority is 0.

---

## Constraint Dependencies (`after`)

Use `after` to ensure one constraint's resolver completes before another constraint evaluates:

```typescript
constraints: {
  authenticate: {
    when: (facts) => !facts.isAuthenticated,
    require: { type: "AUTH" },
  },
  fetchUserData: {
    after: ["authenticate"],
    when: (facts) => facts.isAuthenticated && !facts.userData,
    require: { type: "FETCH_USER_DATA" },
  },
  fetchPreferences: {
    after: ["fetchUserData"],
    when: (facts) => facts.userData && !facts.preferences,
    require: { type: "FETCH_PREFERENCES" },
  },
}
```

**Behavior:**
- If constraint B has `after: ["A"]`, B's `when()` is not called until A's resolver completes
- If A's `when()` returns false (no requirement), B proceeds immediately — nothing to wait for
- If A's resolver fails, B remains blocked until A succeeds (retries apply)
- Cycles are detected at startup: `"[Directive] Constraint cycle detected: A → B → A"`

**Priority vs `after`:**
- `after` always takes precedence — a constraint with `after: ["A"]` will always wait for A, regardless of priority
- `priority` only affects ordering among constraints that have no `after` dependencies on each other
- Constraints with the same priority and no mutual `after` dependencies may run in parallel

**Cross-module references:** Use `"moduleName.constraintName"` format for `after` dependencies across modules.

---

## Async Constraints

The `when()` function can be async for conditions that require I/O. Mark with `async: true` to avoid runtime detection overhead:

```typescript
constraints: {
  needsPermission: {
    async: true,
    timeout: 3000,  // Override default 5s timeout
    when: async (facts) => {
      const allowed = await checkPermissions(facts.userId);
      return allowed && !facts.hasData;
    },
    require: { type: "FETCH_DATA" },
  },
}
```

If you omit `async: true` and `when()` returns a Promise, Directive detects it at runtime and logs a dev warning. Async constraints within the same evaluation cycle run in parallel.

---

## Complex Conditions

Combine multiple conditions for precise control:

```typescript
constraints: {
  canCheckout: {
    when: (facts) => {
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
    // Validation constraints
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

    // Action constraints
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

    // Final constraints
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

---

## Constraint Evaluation

Constraints are evaluated:

1. When facts change (only affected constraints, thanks to auto-tracking)
2. After a resolver completes
3. When `system.reconcile()` is called

The engine continuously evaluates until no more constraints are active.

---

## Preventing Re-Triggering

Guard against infinite loops by checking for existing data:

```typescript
constraints: {
  fetchUser: {
    when: (facts) => {
      // Only fetch if we don't have the user and aren't already loading
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
// Disable a constraint — it won't be evaluated during reconciliation
system.constraints.disable("expensiveCheck");

// Re-enable it
system.constraints.enable("expensiveCheck");
```

This is useful for feature flags, A/B testing, or temporarily suppressing constraints during maintenance windows. Disabled constraints are skipped entirely — their `when()` function is never called.

---

## Next Steps

- See Resolvers for handling requirements
- See Derivations for computed values
- See Effects for side effects
