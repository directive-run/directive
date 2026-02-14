---
title: Constraint-Driven Architecture
description: Learn why declaring "what must be true" is more powerful than imperative state transitions. Explore the paradigm shift from event-driven to constraint-driven systems.
layout: blog
date: 2026-02-01
dateModified: 2026-02-12
slug: constraint-driven-architecture
author: directive-labs
categories: [Architecture, State Management]
---

What if your system could fix itself?

Not in a hand-wavy, AI-powered way. In a precise, deterministic way. You declare what must be true. The runtime figures out how to make it true. When something changes, it re-evaluates and corrects course automatically.

This is **constraint-driven architecture** – a paradigm where you stop writing instructions for every possible state transition and start declaring the rules your system must satisfy. It's the difference between micromanaging every step and hiring someone who understands the goal.

Directive is a TypeScript library built on this idea. But before we look at the library, let's understand why this approach exists and what problems it solves.

---

## The problem with imperative state

Most applications manage state imperatively. Something happens, you write code to handle it. Another thing happens, you write more code. Over time, you end up with a web of event handlers, conditionals, and side effects that's difficult to reason about.

Here's a simplified checkout flow:

```typescript
async function handleCheckout(cart: Cart, user: User) {
  if (!user.isLoggedIn) {
    redirectToLogin();

    return;
  }

  if (cart.items.length === 0) {
    showError("Cart is empty");

    return;
  }

  setLoading(true);

  try {
    const inventory = await checkInventory(cart.items);
    if (inventory.some((item) => !item.available)) {
      setLoading(false);
      showError("Some items are out of stock");
      removeUnavailableItems(cart, inventory);

      return;
    }

    const payment = await processPayment(user, cart.total);
    if (!payment.success) {
      setLoading(false);
      showError("Payment failed");

      return;
    }

    await createOrder(cart, payment);
    clearCart();
    setLoading(false);
    redirectToConfirmation();
  } catch (error) {
    setLoading(false);
    showError("Something went wrong");
  }
}
```

This code works. But it has problems that compound as the system grows:

**Scattered logic.** The rules for "when can we check out?" are buried inside procedural code. To understand all the preconditions, you have to read the entire function – and every other function that touches the same state.

**Missed transitions.** What happens if the user's session expires mid-checkout? What if a promotional discount changes the total after inventory was checked? Each new edge case means another `if` branch, and the probability of missing one increases with every addition.

**Untestable side effects.** Loading states, error messages, redirects, and API calls are tangled together. Testing "what happens when inventory is partially unavailable" requires mocking the entire flow up to that point.

**No self-correction.** If the system ends up in an unexpected state – say, loading is `true` but no request is in flight – nothing notices or recovers. The bug persists until a user reports it.

---

## What if you could declare what must be true?

Think about a thermostat. You don't tell it "if the temperature drops below 70, turn on the heater, wait until it reaches 72, then turn off the heater, but only if the AC isn't running." You set it to 72°F and walk away. The thermostat continuously monitors the actual temperature and takes whatever action is needed to satisfy your constraint.

This is a fundamentally different model. Instead of encoding every transition, you declare the desired state and let the system figure out how to get there. The thermostat doesn't have a bug where it forgets to turn off the heater – it simply re-evaluates the constraint on every cycle.

The same idea applies to software. Instead of writing a procedure that handles every possible path through a checkout, you declare the constraints:

- The user **must be authenticated** before payment can proceed.
- All items **must be in stock** before an order is created.
- Payment **must be confirmed** before the order is finalized.

Each constraint has a corresponding resolver – the "how" to the constraint's "what." When a constraint isn't satisfied, the runtime emits a requirement and invokes the appropriate resolver. When the world changes, constraints are re-evaluated automatically.

This is [constraint-driven architecture](/docs/core-concepts): declare what must be true, define how to make it true, let the runtime orchestrate the rest.

---

## Constraint-driven architecture in practice

In Directive, you model your domain as a **module** – a self-contained unit with facts (state), constraints (rules), and resolvers (actions). Here's how the checkout example looks:

```typescript
import { createModule, t } from "@directive-run/core";

const checkout = createModule("checkout", {
  schema: {
    authenticated: t.boolean(),
    inventoryChecked: t.boolean(),
    allInStock: t.boolean(),
    paymentConfirmed: t.boolean(),
    orderCreated: t.boolean(),
    error: t.string().optional(),
  },

  init: (facts) => {
    facts.authenticated = false;
    facts.inventoryChecked = false;
    facts.allInStock = false;
    facts.paymentConfirmed = false;
    facts.orderCreated = false;
  },

  constraints: {
    needsAuth: {
      when: (facts) => !facts.authenticated,
      require: { type: "AUTHENTICATE" },
    },
    needsInventory: {
      when: (facts) => facts.authenticated && !facts.inventoryChecked,
      require: { type: "CHECK_INVENTORY" },
    },
    needsPayment: {
      when: (facts) =>
        facts.inventoryChecked && facts.allInStock && !facts.paymentConfirmed,
      require: { type: "PROCESS_PAYMENT" },
    },
    needsOrder: {
      when: (facts) => facts.paymentConfirmed && !facts.orderCreated,
      require: { type: "CREATE_ORDER" },
    },
  },

  resolvers: {
    authenticate: {
      requirement: "AUTHENTICATE",
      resolve: async (_req, ctx) => {
        const session = await verifySession();
        ctx.facts.authenticated = session.valid;
      },
    },
    checkInventory: {
      requirement: "CHECK_INVENTORY",
      resolve: async (_req, ctx) => {
        const result = await checkInventory(ctx.facts);
        ctx.facts.inventoryChecked = true;
        ctx.facts.allInStock = result.every((i) => i.available);
      },
    },
    processPayment: {
      requirement: "PROCESS_PAYMENT",
      retry: { attempts: 3, backoff: "exponential" },
      resolve: async (_req, ctx) => {
        const result = await chargeCard(ctx.facts);
        ctx.facts.paymentConfirmed = result.success;
      },
    },
    createOrder: {
      requirement: "CREATE_ORDER",
      resolve: async (_req, ctx) => {
        await submitOrder(ctx.facts);
        ctx.facts.orderCreated = true;
      },
    },
  },
});
```

Notice what's different:

**Each rule is independent.** The `needsPayment` constraint doesn't know or care about authentication – it only checks its own preconditions. If facts change, the engine re-evaluates all constraints and figures out what to do next.

**Resolvers are isolated.** Each resolver handles exactly one concern. Retry logic is declarative (`retry: { attempts: 3, backoff: "exponential" }`), not hand-coded.

**The flow is emergent.** You never write "first authenticate, then check inventory, then process payment." The ordering emerges from constraint dependencies. If the session expires mid-checkout, the `needsAuth` constraint activates and the system self-corrects.

Read more about this pattern in the [module system documentation](/docs/module-system).

---

## The reconciliation loop

At the heart of Directive is a **reconciliation loop** – a cycle that continuously ensures all constraints are satisfied. Here's how it works:

```
Facts change
  → Constraints evaluate (which rules are unsatisfied?)
    → Requirements emitted (what needs to happen?)
      → Resolvers execute (make it happen)
        → Facts update
          → Loop repeats until settled
```

The engine runs this loop after every fact mutation. It evaluates all active constraints, collects any unsatisfied requirements, deduplicates them (using typed identity keys), and dispatches them to the matching resolvers. When resolvers complete, they update facts, which may trigger new constraint evaluations.

The loop continues until the system reaches a **settled state** – a point where all constraints are satisfied and no new requirements are pending. If the system can't settle (for example, two constraints conflict), error boundaries catch the cycle and surface the problem.

This is similar to how React's reconciliation works: you declare what the UI should look like, and React figures out the minimal DOM updates. Directive does the same thing for application state – you declare what must be true, and the engine figures out the minimal set of actions to make it so.

The key insight is that the loop is **convergent**. Each iteration brings the system closer to its constraints. Unlike event-driven systems where a missed handler leaves the system in an inconsistent state, the reconciliation loop will keep trying until constraints are satisfied or an error boundary intervenes.

---

## Why this is better

Constraint-driven architecture isn't just a different syntax for the same thing. It changes the properties of your system in meaningful ways.

### Declarative

You describe the "what," not the "how." This makes your intent explicit and readable. A new team member can scan the constraints and understand the business rules without tracing through procedural code.

### Self-healing

If the system drifts into an unexpected state, the reconciliation loop detects unsatisfied constraints and corrects course. No manual recovery code needed – the same constraints that govern normal operation also handle edge cases.

### Composable

Constraints are independent. You can add new rules without modifying existing ones. Need a fraud check before payment? Add a constraint. Need an address verification step? Add another. Existing constraints don't change.

### Testable

Each constraint and resolver can be tested in isolation. "Given these facts, does this constraint emit a requirement?" is a pure function test. No mocking entire workflows to test a single business rule.

### Inspectable

Because the system's rules are declarative data structures, you can introspect them at runtime. Directive's [plugin architecture](/docs/api/overview) supports logging, devtools, and time-travel debugging – you can see exactly which constraints are active, what requirements are pending, and why a resolver fired.

---

## When to use constraint-driven architecture

Constraint-driven architecture is a good fit when your system has:

**Multiple interacting rules.** If your domain has many preconditions that depend on each other – checkout flows, permission systems, workflow engines, multi-step forms – constraints make the interactions explicit and manageable.

**Async resolution.** When satisfying a rule requires API calls, user input, or other async operations, the reconciliation loop handles sequencing and retry naturally. You don't write nested callbacks or carefully ordered `await` chains.

**Requirements that change at runtime.** If business rules are dynamic – feature flags, A/B tests, user roles that change mid-session – constraint re-evaluation handles this automatically.

**AI agent orchestration.** Agents that need to satisfy goals, manage tool usage, and handle partial failures map naturally to constraints and resolvers. The declarative model makes agent behavior inspectable and debuggable.

It's **less ideal** when:

- Your state is simple (a single boolean toggle doesn't need a constraint engine).
- You need microsecond-level performance in a tight loop (the reconciliation overhead isn't zero).
- Your team is deeply invested in a state machine model that's working well – if FSMs cover your use case, they're a great tool.

The sweet spot is systems where **the rules are complex enough that imperative code becomes fragile**, but **structured enough that constraints can express them clearly**.

---

## Getting started

Install Directive:

```bash
npm install @directive-run/core
```

Define a module with facts, constraints, and resolvers:

```typescript
import { createModule, createSystem, t } from "@directive-run/core";

const counter = createModule("counter", {
  schema: {
    count: t.number(),
    maxReached: t.boolean(),
  },
  init: (facts) => {
    facts.count = 0;
    facts.maxReached = false;
  },
  derive: {
    isHigh: (facts) => facts.count > 10,
  },
  constraints: {
    capAt100: {
      when: (facts) => facts.count > 100,
      require: { type: "RESET_COUNTER" },
    },
  },
  resolvers: {
    reset: {
      requirement: "RESET_COUNTER",
      resolve: async (_req, ctx) => {
        ctx.facts.count = 0;
        ctx.facts.maxReached = true;
      },
    },
  },
});

const system = createSystem({ module: counter });
system.start();
```

Explore the [core concepts documentation](/docs/core-concepts) for a deeper walkthrough, or check the [API reference](/docs/api/overview) for the full surface area.
