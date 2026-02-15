---
title: Stop Writing If-Else Chains for Business Logic
description: Nested conditionals don't scale. Learn how constraint-driven architecture replaces imperative rule spaghetti with independent, testable declarations.
layout: blog
date: 2026-02-12
dateModified: 2026-02-12
slug: stop-writing-if-else-chains
author: directive-labs
categories: [Architecture, Tutorial]
---

You've seen this function before. Maybe you wrote it. An e-commerce checkout that validates permissions, inventory, payment methods, and shipping rules &ndash; all in one procedural block:

```typescript
async function validateCheckout(cart: Cart, user: User): Promise<ValidationResult> {
  // Permission checks
  if (!user.isVerified) {
    return { valid: false, reason: "Account not verified" };
  }
  if (user.role === "guest" && cart.total > 500) {
    return { valid: false, reason: "Guests cannot place orders over $500" };
  }
  if (user.flaggedForReview) {
    const review = await checkFraudStatus(user.id);
    if (review.status === "blocked") {
      return { valid: false, reason: "Account under review" };
    }
  }

  // Inventory checks
  for (const item of cart.items) {
    const stock = await getStock(item.sku);
    if (stock.available < item.quantity) {
      return { valid: false, reason: `${item.name} is out of stock` };
    }
    if (stock.warehouse === "overseas" && cart.shippingMethod === "overnight") {
      return { valid: false, reason: `${item.name} not eligible for overnight shipping` };
    }
  }

  // Payment checks
  if (cart.paymentMethod === "credit" && cart.total > user.creditLimit) {
    return { valid: false, reason: "Order exceeds credit limit" };
  }
  if (cart.paymentMethod === "invoice" && user.role !== "enterprise") {
    return { valid: false, reason: "Invoice payment requires enterprise account" };
  }

  // Shipping checks
  if (cart.shippingAddress.country !== "US" && !user.permissions.includes("international")) {
    return { valid: false, reason: "International shipping not enabled" };
  }
  if (cart.items.some((i) => i.hazmat) && cart.shippingMethod === "air") {
    return { valid: false, reason: "Hazmat items cannot ship by air" };
  }

  return { valid: true };
}
```

Thirty-eight lines. Eight branches. Four concerns tangled into one function. And this is a *simplified* version &ndash; the real thing has twice the rules and a dozen more edge cases layered in over the last eighteen months by five different developers.

It works. Ship it. Move on.

Until the next business rule arrives.

---

## The pattern: imperative rule spaghetti

The function above has a name in the wild: **imperative rule spaghetti**. Every business rule is an `if` statement. Every new requirement adds a branch. Every branch increases the cyclomatic complexity of the function by one.

The problems compound predictably:

**Order dependence.** The rules execute top-to-bottom. The fraud check runs before the inventory check. Does that matter? Maybe. But the only way to know is to read every line and reason about the interactions. Move one block and you might change behavior.

**One failure hides the rest.** If the user isn't verified, the function returns immediately. You never learn that the cart also has out-of-stock items, an invalid payment method, and a shipping restriction. The user fixes one problem, submits again, and hits the next. Repeat four times.

**Testing requires the full context.** To test the hazmat shipping rule, you need to construct a valid user, a valid cart, valid inventory responses, and valid payment state &ndash; just to reach line 35. The test setup dwarfs the assertion.

**Adding rules means editing the function.** Every new rule touches the same file, the same function, the same control flow. Two developers adding rules simultaneously create merge conflicts. The function grows monotonically and never shrinks.

**No introspection.** You can't ask the system "which rules are currently failing?" or "what would need to change for this checkout to succeed?" The rules are executable code, not inspectable data.

This is a design problem, not a skill problem. The structure of if-else chains makes these outcomes inevitable. A disciplined team slows the decay; it doesn't prevent it.

---

## The alternative: constraints as declarations

What if each business rule were an independent, named, testable declaration instead of a branch in a function?

Constraint-driven architecture inverts the model. Instead of writing a procedure that checks rules in sequence, you declare each rule separately: *what must be true* for the system to be valid. The runtime evaluates all constraints, collects all violations, and resolves them.

Here's the same checkout logic expressed as Directive constraints:

```typescript
import { createModule, createSystem, t } from "@directive-run/core";

const checkout = createModule("checkout", {
  schema: {
    userVerified: t.boolean(),
    userRole: t.string<"guest" | "member" | "enterprise">(),
    flaggedForReview: t.boolean(),
    fraudStatus: t.string<"clear" | "blocked" | "pending">(),
    cartTotal: t.number(),
    creditLimit: t.number(),
    paymentMethod: t.string<"credit" | "invoice" | "debit">(),
    allItemsInStock: t.boolean(),
    hasOverseasOvernight: t.boolean(),
    hasInternationalShipping: t.boolean(),
    internationalEnabled: t.boolean(),
    hasHazmatAir: t.boolean(),
    checkoutReady: t.boolean(),
  },

  init: (facts) => {
    facts.userVerified = false;
    facts.userRole = "guest";
    facts.flaggedForReview = false;
    facts.fraudStatus = "pending";
    facts.cartTotal = 0;
    facts.creditLimit = 0;
    facts.paymentMethod = "debit";
    facts.allItemsInStock = false;
    facts.hasOverseasOvernight = false;
    facts.hasInternationalShipping = false;
    facts.internationalEnabled = false;
    facts.hasHazmatAir = false;
    facts.checkoutReady = false;
  },

  derive: {
    guestOverLimit: (facts) =>
      facts.userRole === "guest" && facts.cartTotal > 500,
    creditExceeded: (facts) =>
      facts.paymentMethod === "credit" && facts.cartTotal > facts.creditLimit,
    invoiceNotAllowed: (facts) =>
      facts.paymentMethod === "invoice" && facts.userRole !== "enterprise",
  },

  constraints: {
    requireVerification: {
      when: (facts) => !facts.userVerified,
      require: { type: "VERIFY_ACCOUNT" },
    },
    guestSpendingCap: {
      when: (_facts, derive) => derive.guestOverLimit,
      require: { type: "BLOCK_CHECKOUT", reason: "Guests cannot place orders over $500" },
    },
    fraudReview: {
      priority: 90,
      when: (facts) => facts.flaggedForReview && facts.fraudStatus !== "clear",
      require: { type: "CHECK_FRAUD" },
    },
    inventoryAvailable: {
      when: (facts) => !facts.allItemsInStock,
      require: { type: "CHECK_INVENTORY" },
    },
    noOverseasOvernight: {
      when: (facts) => facts.hasOverseasOvernight,
      require: { type: "BLOCK_CHECKOUT", reason: "Overseas items not eligible for overnight" },
    },
    creditLimitCheck: {
      when: (_facts, derive) => derive.creditExceeded,
      require: { type: "BLOCK_CHECKOUT", reason: "Order exceeds credit limit" },
    },
    invoiceRequiresEnterprise: {
      when: (_facts, derive) => derive.invoiceNotAllowed,
      require: { type: "BLOCK_CHECKOUT", reason: "Invoice requires enterprise account" },
    },
    internationalPermission: {
      when: (facts) => facts.hasInternationalShipping && !facts.internationalEnabled,
      require: { type: "BLOCK_CHECKOUT", reason: "International shipping not enabled" },
    },
    hazmatAirRestriction: {
      when: (facts) => facts.hasHazmatAir,
      require: { type: "BLOCK_CHECKOUT", reason: "Hazmat items cannot ship by air" },
    },
  },

  resolvers: {
    verifyAccount: {
      requirement: "VERIFY_ACCOUNT",
      resolve: async (_req, context) => {
        const result = await verifyUserAccount(context.facts);
        context.facts.userVerified = result.verified;
      },
    },
    checkFraud: {
      requirement: "CHECK_FRAUD",
      retry: { attempts: 2, backoff: "exponential" },
      resolve: async (_req, context) => {
        const review = await checkFraudStatus(context.facts);
        context.facts.fraudStatus = review.status;
      },
    },
    checkInventory: {
      requirement: "CHECK_INVENTORY",
      resolve: async (_req, context) => {
        const stock = await checkAllInventory(context.facts);
        context.facts.allItemsInStock = stock.allAvailable;
        context.facts.hasOverseasOvernight = stock.hasOverseasOvernight;
      },
    },
    blockCheckout: {
      requirement: "BLOCK_CHECKOUT",
      resolve: async (req, context) => {
        context.facts.checkoutReady = false;
        notifyUser(req.reason);
      },
    },
  },
});

const system = createSystem({ module: checkout });
system.start();
```

The same eight rules. But now each one is independent. They evaluate in parallel, not in sequence. They report all violations at once, not the first one found. And the function you need to edit when the next business rule arrives is... nothing. You add a constraint.

---

## Side-by-side: adding a new rule

Your product manager walks over: "We need to block checkout for carts containing recalled products."

**Imperative approach.** Open `validateCheckout`. Decide where the new `if` goes &ndash; after inventory checks? Before payment? You add the branch somewhere in the middle, re-test the entire function, and hope you didn't change the behavior of other rules by altering the execution order.

```typescript
// Somewhere in the middle of validateCheckout...
for (const item of cart.items) {
  if (item.recalled) {
    return { valid: false, reason: `${item.name} has been recalled` };
  }
  // ... existing stock checks ...
}
```

**Constraint-driven approach.** Add one constraint. Existing constraints are untouched.

```typescript
// Add to constraints:
recalledProduct: {
  priority: 95,
  when: (facts) => facts.hasRecalledItem,
  require: { type: "BLOCK_CHECKOUT", reason: "Cart contains a recalled product" },
},
```

One declaration. No existing code modified. The priority of 95 ensures it evaluates with high importance. The existing `BLOCK_CHECKOUT` resolver handles the notification. The constraint is self-documenting: its name says what it checks, its `when` says when it fires, its `require` says what it demands.

This is the [open-closed principle](https://en.wikipedia.org/wiki/Open%E2%80%93closed_principle) enforced by architecture, not discipline. The module is open for extension (add constraints) and closed for modification (don't touch existing ones).

---

## The testing difference

Testing imperative rule spaghetti means simulating the entire control flow up to the branch you care about. Testing a constraint means calling a pure function.

**Testing the imperative version:**

```typescript
test("hazmat items cannot ship by air", async () => {
  // Setup: construct a user that passes ALL prior checks
  const user = {
    isVerified: true,
    role: "member",
    flaggedForReview: false,
    creditLimit: 10000,
    permissions: ["international"],
  };

  // Setup: construct a cart that passes ALL prior checks
  const cart = {
    items: [
      { sku: "HAZ-001", name: "Battery Pack", quantity: 1, hazmat: true },
    ],
    total: 50,
    paymentMethod: "debit",
    shippingMethod: "air",
    shippingAddress: { country: "US" },
  };

  // Mock: inventory must return available
  mockGetStock.mockResolvedValue({ available: 10, warehouse: "domestic" });

  const result = await validateCheckout(cart, user);

  expect(result.valid).toBe(false);
  expect(result.reason).toBe("Hazmat items cannot ship by air");
});
```

Fourteen lines of setup to test one business rule. The test has implicit dependencies on every check that comes before the hazmat rule. If someone adds a new rule above it, this test might start failing for the wrong reason.

**Testing the constraint version:**

```typescript
import { testConstraint } from "@directive-run/core/testing";

test("hazmat items cannot ship by air", () => {
  const result = testConstraint(checkout, "hazmatAirRestriction", {
    hasHazmatAir: true,
  });

  expect(result.fired).toBe(true);
  expect(result.requirement).toEqual({
    type: "BLOCK_CHECKOUT",
    reason: "Hazmat items cannot ship by air",
  });
});

test("non-hazmat items can ship by air", () => {
  const result = testConstraint(checkout, "hazmatAirRestriction", {
    hasHazmatAir: false,
  });

  expect(result.fired).toBe(false);
});
```

Two tests. Zero mocks. Zero unrelated setup. The constraint is a pure function of facts &ndash; given this state, does it fire? Each test is isolated from every other rule in the system.

The resolver gets its own test:

```typescript
import { testResolver } from "@directive-run/core/testing";

test("block checkout notifies user", async () => {
  const notifySpy = vi.fn();
  globalThis.notifyUser = notifySpy;

  await testResolver(checkout, "blockCheckout", {
    requirement: { type: "BLOCK_CHECKOUT", reason: "Test reason" },
    facts: { checkoutReady: true },
  });

  expect(notifySpy).toHaveBeenCalledWith("Test reason");
});
```

Constraints test the "when." Resolvers test the "how." Neither needs the other.

---

## Derivations: extracting shared logic

Notice the `derive` block in the checkout module. Derivations are auto-tracked computed values that multiple constraints can reference:

```typescript
derive: {
  guestOverLimit: (facts) =>
    facts.userRole === "guest" && facts.cartTotal > 500,
  creditExceeded: (facts) =>
    facts.paymentMethod === "credit" && facts.cartTotal > facts.creditLimit,
  invoiceNotAllowed: (facts) =>
    facts.paymentMethod === "invoice" && facts.userRole !== "enterprise",
},
```

In the imperative version, the expression `user.role === "guest" && cart.total > 500` lives inside the `if` block. If another function needs the same check, it either duplicates the logic or calls a shared helper &ndash; but the helper still returns a boolean that feeds into another `if` chain.

Derivations make these computed values first-class. They react to fact changes automatically (no manual dependency tracking), they're composable (derivations can reference other derivations), and they're readable from anywhere in the system. The constraint `guestSpendingCap` references `derive.guestOverLimit` directly. If the business definition of "over limit" changes, you update one derivation and every constraint that depends on it re-evaluates.

---

## When NOT to use this

Constraint-driven architecture is not a universal replacement for conditionals. Be honest about where the overhead isn't justified.

**Simple toggles.** If your logic is `if (featureEnabled) { showBanner() }`, a constraint engine is overkill. A boolean and an `if` statement are the right tool.

**Linear, non-branching flows.** A three-step wizard with no conditional logic (step 1 &rarr; step 2 &rarr; step 3) doesn't benefit from constraints. There are no interacting rules to manage.

**Performance-critical hot paths.** The reconciliation loop adds overhead &ndash; constraint evaluation, requirement deduplication, resolver dispatch. For code that runs thousands of times per frame (game loops, pixel processing), that overhead matters. Keep the constraint engine at the orchestration layer, not the inner loop.

**Trivial validation.** `if (!email.includes("@")) return "Invalid email"` doesn't need a constraint. The cost of declaring a schema, a constraint, and a resolver for a single string check is more complexity than it saves.

The threshold is roughly this: when you have **five or more interacting rules** that touch the same state, when those rules change independently, and when multiple developers edit them concurrently &ndash; that's when constraint-driven architecture pays for itself. Below that threshold, `if` statements are fine.

---

## From spaghetti to declarations

The progression is straightforward:

1. **Identify the rules.** Read your existing if-else chain. Each branch is a rule. Name it.
2. **Extract the facts.** The values each rule checks become your schema. The computed combinations become derivations.
3. **Declare the constraints.** Each rule becomes a `when` + `require` pair. Set priorities where rules conflict.
4. **Implement the resolvers.** Each requirement type gets a resolver. Add retry policies where operations are fallible.
5. **Delete the if-else chain.** The module replaces it entirely.

The result: business rules that are independent, named, prioritized, testable, and inspectable. Adding a rule means adding a declaration, not editing a procedure. Removing a rule means removing a declaration, not worrying about what else breaks.

Your checkout function doesn't need thirty-eight lines and eight branches. It needs eight constraints and a runtime that knows what to do with them.

---

## Get started

Install Directive:

```bash
npm install @directive-run/core
```

Explore the documentation:

- **[Schema Overview](/docs/schema-overview)** &ndash; defining your facts with typed schemas
- **[Constraints](/docs/constraints)** &ndash; declaring rules with `when` and `require`
- **[Resolvers](/docs/resolvers)** &ndash; implementing resolution logic with retry and batching
- **[Testing](/docs/testing/overview)** &ndash; testing constraints and resolvers in isolation
- **[Constraint-Driven Architecture](/blog/constraint-driven-architecture)** &ndash; the paradigm explained from first principles

If your codebase has a function that keeps growing &ndash; a function where every sprint adds another `if` branch &ndash; that function is a module waiting to be declared.
