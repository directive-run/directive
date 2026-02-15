---
title: Why State Machines Aren't Enough
description: State machines are great for UI flows, but struggle with data-driven constraints, state explosion, and async coordination. Discover when to use state machines vs. constraint-driven systems.
layout: blog
date: 2026-02-09
dateModified: 2026-02-09
slug: why-state-machines-arent-enough
author: directive-labs
categories: [Architecture, Comparison]
---

State machines changed everything.

Before finite state machines entered mainstream frontend development, UI code was a minefield of boolean flags. `isLoading && !isError && hasData && !isRetrying` – four booleans, sixteen possible combinations, and half of them were impossible states your code handled anyway. State machines brought sanity to this chaos. You define the valid states, the valid transitions between them, and suddenly impossible states become actually impossible.

Libraries like XState took this further. Hierarchical states, parallel regions, invoked services, guards – a rich vocabulary for modeling complex behavior. The visual editor alone is worth the adoption cost. You can *see* your application logic as a diagram, share it with non-engineers, and formally verify that certain states are unreachable.

If you're using state machines effectively today, this article isn't here to convince you to stop.

But as systems grow – as the number of interacting rules increases, as data-driven logic replaces boolean flags, as async operations multiply – three patterns emerge that state machines struggle with. Not because state machines are poorly designed, but because they were built to solve a different shape of problem.

Let's look at each one.

---

## Limit 1: State explosion

Consider a permission system. You have three user roles (viewer, editor, admin), four resources (documents, settings, billing, users), three access levels (none, read, write), and a cache that can be fresh or stale.

In a state machine, each unique combination is a discrete state. That's 3 &times; 4 &times; 3 &times; 2 = **72 states**. Each state needs transitions to handle role changes, cache invalidation, and access upgrades. You're looking at hundreds of transitions.

XState's parallel regions help. You can model role, resource, access level, and cache status as independent parallel states:

```typescript
// XState: parallel regions reduce explicit states,
// but guards still multiply across every combination
const permissionMachine = createMachine({
  type: "parallel",
  states: {
    role: {
      initial: "viewer",
      states: {
        viewer: { on: { PROMOTE: "editor" } },
        editor: { on: { PROMOTE: "admin", DEMOTE: "viewer" } },
        admin: { on: { DEMOTE: "editor" } },
      },
    },
    cache: {
      initial: "stale",
      states: {
        fresh: { on: { INVALIDATE: "stale" } },
        stale: { on: { REFRESH: "fresh" } },
      },
    },
    // ... resource and access states
  },
});
// Guard logic for "can this role write to billing?" still
// lives in transition guards, scattered across the config.
```

Parallel regions reduce the number of explicitly named states, but the *logic* still exists somewhere. Guards on transitions encode the combinatorial rules. As dimensions grow, the guard logic grows with it, and the visual diagram – one of the best features of state machines – becomes a dense graph that obscures rather than clarifies.

With constraint-driven architecture, each rule is a standalone declaration:

```typescript
// Directive: one constraint per rule, no combinatorial explosion
const permissions = createModule("permissions", {
  schema: {
    role: t.string<"viewer" | "editor" | "admin">(),
    resource: t.string(),
    accessLevel: t.string<"none" | "read" | "write">(),
    cacheFresh: t.boolean(),
  },
  // ...
  constraints: {
    ensureFreshCache: {
      when: (facts) => !facts.cacheFresh,
      require: { type: "REFRESH_PERMISSIONS" },
    },
    enforceAccess: {
      when: (facts) =>
        facts.role === "viewer" && facts.accessLevel === "write",
      require: { type: "DOWNGRADE_ACCESS", to: "read" },
    },
    restrictBilling: {
      when: (facts) =>
        facts.resource === "billing" && facts.role !== "admin",
      require: { type: "DOWNGRADE_ACCESS", to: "none" },
    },
  },
  // Each resolver handles one concern
  resolvers: {
    refreshPerms: {
      requirement: "REFRESH_PERMISSIONS",
      resolve: async (_req, context) => {
        const perms = await fetchPermissions(context.facts.role);
        context.facts.accessLevel = perms.level;
        context.facts.cacheFresh = true;
      },
    },
    downgradeAccess: {
      requirement: "DOWNGRADE_ACCESS",
      resolve: async (req, context) => {
        context.facts.accessLevel = req.to;
      },
    },
  },
});
```

Three constraints replace 72 states. Adding a fifth dimension – say, a "trial" vs. "paid" account tier – means one new constraint, not a multiplicative explosion of states and transitions.

---

## Limit 2: Data-driven constraints

State machines model *categorical* state well – a connection is "connected" or "disconnected," a form is "idle" or "submitting." They're less natural for rules that depend on *continuous data*.

Consider inventory management. Your business rules:

- Reorder when stock falls below a threshold (which varies by product category).
- Only reorder from suppliers who are currently available.
- Managers can override minimum stock levels. Regular staff cannot.
- Rush orders are allowed when stock is critically low, but only during business hours.

In XState, these rules become guards on transitions – `cond` functions that check context values:

```typescript
// XState: data rules live in guards, scattered across transitions
const inventoryMachine = createMachine({
  initial: "monitoring",
  context: { stock: 100, threshold: 20, supplierAvailable: true },
  states: {
    monitoring: {
      on: {
        STOCK_CHANGED: [
          {
            target: "rushOrdering",
            cond: (context) =>
              context.stock < context.threshold * 0.5 &&
              isBusinessHours() &&
              context.supplierAvailable,
          },
          {
            target: "reordering",
            cond: (context) =>
              context.stock < context.threshold && context.supplierAvailable,
          },
          { target: "monitoring" },
        ],
      },
    },
    reordering: {
      invoke: {
        src: "placeOrder",
        onDone: "monitoring",
        onError: "error",
      },
    },
    rushOrdering: { /* similar but with rush supplier */ },
    error: { /* retry logic */ },
  },
});
```

The guard functions work, but the business rules are *implicit*. To understand "when do we rush order?", you trace through transition arrays, read guard conditions, and mentally reconstruct the priority order. When rules change – and inventory rules change often – you're editing deeply nested objects and hoping you got the priority right.

Directive makes each rule a first-class declaration:

```typescript
// Directive: each business rule is explicit and independent
const inventory = createModule("inventory", {
  schema: {
    stock: t.number(),
    threshold: t.number(),
    supplierAvailable: t.boolean(),
    userRole: t.string<"staff" | "manager">(),
  },
  // ...
  constraints: {
    lowStock: {
      priority: 50,
      when: (facts) =>
        facts.stock < facts.threshold && facts.supplierAvailable,
      require: { type: "REORDER", rush: false },
    },
    criticalStock: {
      priority: 90,
      when: (facts) =>
        facts.stock < facts.threshold * 0.5 &&
        facts.supplierAvailable &&
        isBusinessHours(),
      require: { type: "REORDER", rush: true },
    },
    managerOverride: {
      priority: 100,
      when: (facts) =>
        facts.userRole === "manager" && facts.stock < facts.threshold * 0.25,
      require: { type: "EMERGENCY_REORDER" },
    },
  },
  resolvers: {
    reorder: {
      requirement: "REORDER",
      retry: { attempts: 3, backoff: "exponential" },
      resolve: async (req, context) => {
        await placeOrder({ rush: req.rush, quantity: context.facts.threshold * 2 });
        context.facts.stock += context.facts.threshold * 2;
      },
    },
    emergencyReorder: {
      requirement: "EMERGENCY_REORDER",
      resolve: async (_req, context) => {
        await placeEmergencyOrder(context.facts);
        context.facts.stock += context.facts.threshold * 3;
      },
    },
  },
});
```

Each constraint is a named, prioritized, independently testable rule. `priority` values make conflict resolution explicit – `criticalStock` at 90 overrides `lowStock` at 50. Adding a new rule (say, "don't reorder on holidays") means adding one constraint, not rewriting a transition array.

---

## Limit 3: Async coordination

This is where the gap widens most. Real applications coordinate multiple async operations that depend on each other, fail independently, and need different recovery strategies.

Consider a checkout flow: authenticate the user, check inventory, process payment, create the order. In XState, each step is an invoked service with success and error transitions:

```typescript
// XState: sequential invoke states with error handling
const checkoutMachine = createMachine({
  initial: "authenticating",
  states: {
    authenticating: {
      invoke: {
        src: "authenticate",
        onDone: "checkingInventory",
        onError: "authFailed",
      },
    },
    checkingInventory: {
      invoke: {
        src: "checkInventory",
        onDone: [
          { target: "processing", cond: (_, e) => e.data.allAvailable },
          { target: "itemsUnavailable" },
        ],
        onError: "inventoryError",
      },
    },
    processing: {
      invoke: {
        src: "processPayment",
        onDone: "creatingOrder",
        onError: "paymentFailed",
      },
    },
    creatingOrder: {
      invoke: {
        src: "createOrder",
        onDone: "complete",
        onError: "orderFailed",
      },
    },
    authFailed: { /* retry or redirect */ },
    inventoryError: { /* retry */ },
    paymentFailed: { /* retry with backoff */ },
    itemsUnavailable: { /* show alternatives */ },
    orderFailed: { /* retry or refund */ },
    complete: { type: "final" },
  },
});
```

This works for the happy path and a few error states. But now consider: what if the user's authentication token expires *while payment is processing*? The machine is in the `processing` state – it has no transition for `AUTH_EXPIRED`. You need to either add that transition to every state (tedious and error-prone) or restructure with parallel regions (complex and hard to visualize).

What about retry? Each error state needs its own retry logic. `paymentFailed` should retry with exponential backoff. `inventoryError` should retry once then fail. `authFailed` should redirect. That's three different retry strategies implemented as state machine patterns – counting states, delayed transitions, max-attempt guards – all hand-built.

Directive handles this differently. Each concern is an independent constraint with its own resolution strategy:

```typescript
// Directive: independent constraints with built-in retry
const checkout = createModule("checkout", {
  schema: {
    authenticated: t.boolean(),
    inventoryChecked: t.boolean(),
    allInStock: t.boolean(),
    paymentConfirmed: t.boolean(),
    orderCreated: t.boolean(),
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
      retry: { attempts: 1 },
      resolve: async (_req, context) => {
        const session = await verifySession();
        context.facts.authenticated = session.valid;
      },
    },
    checkInventory: {
      requirement: "CHECK_INVENTORY",
      retry: { attempts: 2, backoff: "linear" },
      resolve: async (_req, context) => {
        const result = await checkStock();
        context.facts.inventoryChecked = true;
        context.facts.allInStock = result.every((i) => i.available);
      },
    },
    processPayment: {
      requirement: "PROCESS_PAYMENT",
      retry: { attempts: 3, backoff: "exponential" },
      resolve: async (_req, context) => {
        const result = await chargeCard();
        context.facts.paymentConfirmed = result.success;
      },
    },
    createOrder: {
      requirement: "CREATE_ORDER",
      resolve: async (_req, context) => {
        await submitOrder();
        context.facts.orderCreated = true;
      },
    },
  },
});
```

If authentication expires mid-payment, the `needsAuth` constraint simply activates. The runtime re-evaluates all constraints, sees that `authenticated` is now `false`, and the auth resolver fires. Once re-authenticated, the payment constraint re-activates. No special wiring needed – the reconciliation loop handles it.

Retry policies are declarative – `{ attempts: 3, backoff: "exponential" }` – not hand-built state patterns. Each resolver's failure is isolated. A payment retry doesn't affect inventory checking. An auth failure doesn't leave the system in a broken intermediate state.

For a deeper look at how Directive's reconciliation loop handles these scenarios, see the [first article in this series](/blog/constraint-driven-architecture).

---

## When state machines still win

State machines remain the right choice for many problems. Be honest about this – using a constraint engine for a simple wizard flow is over-engineering.

**UI workflows with fixed steps.** A multi-step form (personal info &rarr; shipping &rarr; payment &rarr; confirm) has well-defined states and transitions. A state machine makes the flow visible and prevents skipping steps. The visual editor is a genuine productivity tool here.

**Media and device control.** A video player (idle &rarr; loading &rarr; playing &rarr; paused &rarr; ended) is a textbook state machine. States are mutually exclusive, transitions are triggered by user actions, and the set of possible states is small and fixed.

**Connection lifecycle.** WebSocket connections (connecting &rarr; connected &rarr; reconnecting &rarr; disconnected) benefit from state machines' guarantee that you can't be "connected" and "disconnecting" simultaneously.

**Formal verification.** If you need to *prove* that certain states are unreachable – critical in payment processing, medical devices, or safety systems – state machines have decades of formal methods behind them.

The common thread: small, fixed, categorical state where transitions are the primary concern. If your state machine is working well and the diagram fits on a screen, keep it.

---

## The bridge: use both

State machines and constraint-driven systems aren't mutually exclusive. In practice, many applications benefit from both: state machines for well-defined UI flows, Directive for the orchestration layer above them.

XState actors can live inside a Directive system. A state machine manages the micro-level flow (form steps, animation states), while constraints manage the macro-level rules (when should this flow start? what happens when it completes? how does it interact with other flows?).

```typescript
import { createModule, createSystem, t } from "@directive-run/core";
import { createActor } from "xstate";
import { checkoutFormMachine } from "./machines";

const orchestrator = createModule("orchestrator", {
  schema: {
    cartValid: t.boolean(),
    checkoutFlowActive: t.boolean(),
    checkoutComplete: t.boolean(),
    orderConfirmed: t.boolean(),
  },

  init: (facts) => {
    facts.cartValid = false;
    facts.checkoutFlowActive = false;
    facts.checkoutComplete = false;
    facts.orderConfirmed = false;
  },

  constraints: {
    startCheckout: {
      when: (facts) => facts.cartValid && !facts.checkoutFlowActive,
      require: { type: "START_CHECKOUT_FLOW" },
    },
    finalizeOrder: {
      when: (facts) => facts.checkoutComplete && !facts.orderConfirmed,
      require: { type: "CONFIRM_ORDER" },
    },
  },

  resolvers: {
    startFlow: {
      requirement: "START_CHECKOUT_FLOW",
      resolve: async (_req, context) => {
        // XState manages the step-by-step UI flow
        const actor = createActor(checkoutFormMachine);
        actor.subscribe((state) => {
          if (state.matches("complete")) {
            context.facts.checkoutComplete = true;
          }
        });
        actor.start();
        context.facts.checkoutFlowActive = true;
      },
    },
    confirmOrder: {
      requirement: "CONFIRM_ORDER",
      retry: { attempts: 3, backoff: "exponential" },
      resolve: async (_req, context) => {
        await submitFinalOrder();
        context.facts.orderConfirmed = true;
      },
    },
  },
});
```

XState handles what it's best at – the deterministic, visual, step-by-step flow. Directive handles what *it's* best at – reacting to changing conditions, coordinating async operations, and self-correcting when things go wrong.

For detailed patterns on combining XState with Directive, see the [XState integration guide](/docs/works-with/xstate).

---

## Getting started

If the patterns in this article resonate, here are your next steps:

- **[Constraint-Driven Architecture](/blog/constraint-driven-architecture)** – the first article in this series, covering the paradigm from scratch.
- **[Quick Start](/docs/quick-start)** – install Directive and build your first module in five minutes.
- **[Core Concepts](/docs/core-concepts)** – facts, constraints, resolvers, and the reconciliation loop explained in depth.
- **[Comparison Guide](/docs/comparison)** – side-by-side comparison of Directive with Redux, Zustand, XState, and others.
- **[XState Migration Guide](/docs/migration/from-xstate)** – step-by-step guide for moving XState patterns to Directive.

State machines aren't wrong. They're a precise, well-understood tool for a specific class of problems. But when your system outgrows categorical state – when the rules are data-driven, the async operations are interdependent, and the state space is combinatorial – constraint-driven architecture picks up where state machines leave off.

One tool for the flow. Another for the rules. Use both.
