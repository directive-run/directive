---
title: State Bridges
description: Connect Directive to existing state management – Zustand, React Query, Redux, XState, and Web Workers.
---

State bridges let you adopt Directive incrementally by syncing facts with your existing state management library. Keep your current stores running and layer Directive's constraint system on top. {% .lead %}

---

## Available Bridges

| Bridge | Import | Sync Direction | Use Case |
|--------|--------|---------------|----------|
| [Zustand](/docs/bridges/zustand) | `directive/zustand` | Bidirectional | Zustand stores ↔ Directive facts |
| [React Query](/docs/bridges/react-query) | `directive/react-query` | Query → Facts | Server state → Directive facts |
| [Redux](/docs/bridges/redux) | `directive/redux` | Bidirectional | Redux slices ↔ Directive facts |
| [XState](/docs/bridges/xstate) | `directive/xstate` | Bidirectional | XState machines ↔ Directive facts |
| [Web Worker](/docs/bridges/worker) | `directive/worker` | Bidirectional | Off-main-thread Directive system |

---

## When to Use a Bridge

- **Incremental adoption** – Add Directive to an existing app without rewriting state management.
- **Server state** – Feed React Query / SWR data into Directive for constraint evaluation.
- **Performance** – Move computation to a Web Worker and sync results to the main thread.
- **State machines** – Use XState for sequential workflows, Directive for constraint logic.

---

## How Bridges Work

Bridges create a two-way sync between your existing store and Directive facts:

1. **External → Directive**: When the external store changes, the bridge updates Directive facts.
2. **Directive → External**: When Directive facts change (via resolvers or events), the bridge pushes updates back.

All bridges use Directive's batch API to coalesce updates and avoid notification storms.

---

## Next Steps

- **[Zustand Bridge](/docs/bridges/zustand)** – Most common starting point
- **[Migration Guides](/docs/migration/overview)** – Full migration from Redux, Zustand, or XState
