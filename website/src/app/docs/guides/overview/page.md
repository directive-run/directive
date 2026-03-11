---
title: Guides
description: Task-oriented guides for solving real-world problems with Directive.
---

Practical, copy-paste recipes for common patterns – loading states, auth flows, shopping carts, and more. {% .lead %}

---

## Core Patterns

Patterns you need in virtually every project.

| Guide | What You'll Build |
|-------|-------------------|
| [Loading & Error States](/docs/guides/loading-states) | Track loading, error, and success across concurrent async operations |
| [Authentication Flow](/docs/guides/auth-flow) | Login, logout, session validation, and automatic token refresh |
| [Optimistic Updates](/docs/guides/optimistic-updates) | Instant UI updates with automatic rollback on server failure |
| [Shopping Cart Rules](/docs/guides/shopping-cart) | Quantity limits, coupon validation, and auth-gated checkout |
| [Multi-Step Form Wizard](/docs/guides/form-wizard) | Constraint-gated step advancement with persistence and async validation |

---

## Multi-Module & Architecture

Scaling beyond one module with cross-module patterns.

| Guide | What You'll Build |
|-------|-------------------|
| [Async Chains Across Modules](/docs/guides/async-chains) | Cross-module `after` chains: auth → permissions → dashboard data |
| [Role-Based Permissions](/docs/guides/permissions) | RBAC with derivation composition and dynamic constraint disable |
| [Batch Mutations](/docs/guides/batch-mutations) | Multi-field updates that never expose intermediate states |
| [Debounce Constraints](/docs/guides/debounce-constraints) | Prevent constraints from firing too frequently during rapid input |

---

## Testing & Debugging

| Guide | What You'll Build |
|-------|-------------------|
| [Test Async Chains](/docs/guides/test-async-chains) | Deterministic testing of multi-step constraint-resolver flows |
| [Debug with Time-Travel](/docs/guides/debug-history) | Step-by-step debugging when constraints aren't firing as expected |

---

## How These Guides Work

Each guide follows the same structure:

1. **The Problem** – what goes wrong without the pattern
2. **The Solution** – complete, working code you can copy
3. **Step by Step** – what each piece does and why
4. **Common Variations** – alternate approaches and edge cases
5. **Related** – links to concept pages and API reference

---

## Next Steps

- **New to Directive?** Start with [Quick Start](/docs/quick-start) and [Core Concepts](/docs/core-concepts)
- **Not sure which primitive to use?** See [Choosing Primitives](/docs/choosing-primitives)
- **Need API details?** See the [API Reference](/docs/api/core)
- **Looking for examples?** See [Examples](/docs/examples/counter)
