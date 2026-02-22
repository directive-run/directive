---
title: Examples
description: Interactive examples that show Directive in action &ndash; from everyday patterns to complex constraint-driven apps.
---

Learn Directive by playing with it. Every example runs live in the browser, and every line of source code is visible below the demo. {% .lead %}

---

## Everyday Patterns

### [Theme & Locale](/docs/examples/theme-locale)

Global UI preferences with light/dark/system theme, multi-language support, and persistence. Shows `persistencePlugin`, effects with cleanup, and system preference detection.

**Directive features:** multi-module composition, `persistencePlugin`, effects with `matchMedia` listener, derivation composition

### [Auth Flow](/docs/examples/auth-flow)

Login, token refresh with countdown, constraint ordering, and session management. A ticking `now` fact drives reactive expiry detection.

**Directive features:** constraint `after` ordering, auto-tracked derivations, resolvers with retry, effects for status logging

### [Pagination](/docs/examples/pagination)

Cursor-based infinite scroll with search, category filters, and sort. IntersectionObserver effect triggers loading, filter changes reset to page 1.

**Directive features:** IntersectionObserver effect, cross-module `crossModuleDeps`, `loggingPlugin`, batch mutations

### [URL Sync](/docs/examples/url-sync)

Bidirectional URL-state synchronization for a filterable product list. Filters survive page refresh and are shareable via links.

**Directive features:** bidirectional effects, guard flag pattern, cross-module constraints, custom URL plugin

### [Notifications](/docs/examples/notifications)

Toast queue with auto-dismiss driven by `tickMs`, priority-based overflow handling, and cross-module event dispatching.

**Directive features:** `tickMs`, constraint priority, derivation-driven auto-dismiss, cross-module events

### [Dashboard Loader](/docs/examples/dashboard-loader)

Multi-step data loading with dependency ordering and error recovery.

**Directive features:** constraint `after` ordering, multi-module composition

---

## Multi-Module & Advanced

### [Async Chains](/docs/examples/async-chains)

Three-module chain (auth &rarr; permissions &rarr; dashboard) with configurable failure rates, retry with exponential backoff, and visual chain status.

**Directive features:** cross-module `after` chains, `crossModuleDeps`, `loggingPlugin`, `devtoolsPlugin({ trace: true })`

### [Form Wizard](/docs/examples/form-wizard)

Multi-step form with constraint-gated advancement, per-step validation, async email checking, and persistence for save-and-resume.

**Directive features:** `persistencePlugin`, constraint-gated advancement, schema validation, async cross-module constraints

### [Shopping Cart](/docs/examples/shopping-cart)

Business rules as constraints: quantity limits, coupon validation via API, auth-gated checkout with retry, and derivation composition for totals.

**Directive features:** `devtoolsPlugin({ panel: true })`, multi-module, constraint priority + `after`, error boundaries

### [Permissions](/docs/examples/permissions)

Role-based access control with three user roles, API-loaded permissions, conditional UI rendering, and constraint-gated actions.

**Directive features:** derivation composition, cross-module constraints, dynamic `disable()`, multi-module

---

## Games & Puzzles

### [Sudoku](/docs/examples/sudoku)

The perfect Directive showcase. Sudoku is literally a constraint satisfaction problem &ndash; no duplicates in rows, columns, or 3&times;3 boxes &ndash; and those rules map 1:1 to Directive's constraint&ndash;resolver flow.

**Directive features:** 14 auto-tracked derivations, prioritized constraints, temporal constraints, time-travel debugging

### [Checkers](/docs/examples/checkers)

Two-player checkers with move validation, king promotion, and forced captures &ndash; all expressed as constraints.

**Directive features:** constraint-driven game rules, derived valid moves, time-travel undo

---

## Next Steps

- **[Quick Start](/docs/quick-start)** &ndash; Guided tutorial for your first module
- **[Core Concepts](/docs/core-concepts)** &ndash; Understand the theory behind the examples
- **[Choosing Primitives](/docs/choosing-primitives)** &ndash; When to use each Directive primitive
- **[How-To Guides](/docs/how-to/overview)** &ndash; Task-oriented recipes for common patterns
