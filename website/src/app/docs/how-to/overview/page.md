---
title: How-To Guides
description: Task-oriented guides for solving real-world problems with Directive.
---

Practical, copy-paste recipes for common patterns – loading states, auth flows, pagination, shopping carts, and more. {% .lead %}

---

## Every-App Essentials

Patterns you need in virtually every project.

| Guide | What You'll Build |
|-------|-------------------|
| [Global UI State](/docs/how-to/global-ui-state) | Theme, locale, sidebar preferences with persistence and system detection |
| [Loading & Error States](/docs/how-to/loading-states) | Track loading, error, and success across concurrent async operations |
| [Authentication Flow](/docs/how-to/auth-flow) | Login, logout, session validation, and automatic token refresh |
| [Pagination & Infinite Scroll](/docs/how-to/pagination) | Cursor-based loading with filter-aware resets and IntersectionObserver |
| [Sync State with URL](/docs/how-to/url-sync) | Bidirectional URL-state sync for shareable, bookmarkable filtered views |
| [Optimistic Updates](/docs/how-to/optimistic-updates) | Instant UI updates with automatic rollback on server failure |
| [Notifications & Toasts](/docs/how-to/notifications) | Notification queue with auto-dismiss, priority ordering, and cross-module triggers |
| [Persist State](/docs/how-to/persist-state) | Save and restore state across page reloads with selective filtering |

---

## Multi-Module & Architecture

Scaling beyond one module with cross-module patterns.

| Guide | What You'll Build |
|-------|-------------------|
| [Async Chains Across Modules](/docs/how-to/async-chains) | Cross-module `after` chains: auth → permissions → dashboard data |
| [Organize Modules](/docs/how-to/organize-modules) | Module structure, naming, and cross-module dependencies for growing apps |
| [Multi-Step Form Wizard](/docs/how-to/form-wizard) | Constraint-gated step advancement with persistence and async validation |
| [Shopping Cart Rules](/docs/how-to/shopping-cart) | Quantity limits, coupon validation, and auth-gated checkout |
| [Role-Based Permissions](/docs/how-to/permissions) | RBAC with derivation composition and dynamic constraint disable |
| [Dynamic Modules](/docs/how-to/dynamic-modules) | Code-split features with lazy loading and runtime module registration |

---

## Performance & Real-Time

Optimization and real-time communication patterns.

| Guide | What You'll Build |
|-------|-------------------|
| [Optimize Re-Renders](/docs/how-to/optimize-rerenders) | Pick the right hook and derivation pattern to minimize React re-renders |
| [Batch Mutations](/docs/how-to/batch-mutations) | Multi-field updates that never expose intermediate states |
| [WebSocket Connections](/docs/how-to/websockets) | Managed WebSocket lifecycle with reconnection and message dispatch |
| [Debounce Constraints](/docs/how-to/debounce-constraints) | Prevent constraints from firing too frequently during rapid input |

---

## Testing & Debugging

| Guide | What You'll Build |
|-------|-------------------|
| [Test Async Chains](/docs/how-to/test-async-chains) | Deterministic testing of multi-step constraint-resolver flows |
| [Debug with Time-Travel](/docs/how-to/debug-time-travel) | Step-by-step debugging when constraints aren't firing as expected |

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
- **Need API details?** See the [API Reference](/docs/api/overview)
- **Looking for examples?** See [Examples](/docs/examples/overview)
