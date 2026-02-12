---
title: Framework Adapters
description: Use Directive with React, Vue, Svelte, Solid, or Lit – reactive hooks and bindings for every major framework.
---

Directive provides first-class adapters for five UI frameworks. Each adapter gives you reactive hooks (or stores/controllers) that subscribe to facts, derivations, and system state with zero boilerplate. {% .lead %}

---

## Supported Frameworks

| Framework | Import | Pattern | Reactivity Model |
|-----------|--------|---------|-----------------|
| [React](/docs/adapters/react) | `directive/react` | Hooks (`useFact`, `useDerived`, ...) | `useSyncExternalStore` |
| [Vue](/docs/adapters/vue) | `directive/vue` | Composables (`useFact`, `useDerived`, ...) | `ref` / `shallowRef` |
| [Svelte](/docs/adapters/svelte) | `directive/svelte` | Stores (`useFact`, `useDerived`, ...) | Svelte `Readable` stores |
| [Solid](/docs/adapters/solid) | `directive/solid` | Signals (`useFact`, `useDerived`, ...) | `createSignal` / `createMemo` |
| [Lit](/docs/adapters/lit) | `directive/lit` | Controllers (`FactController`, ...) | `ReactiveController` |

---

## Common Hook API

All adapters share the same core hook names and signatures (adapted to each framework's reactivity model):

| Hook | Purpose |
|------|---------|
| `useSelector(system, fn)` | Auto-tracking cross-fact selector |
| `useFact(system, key)` | Subscribe to a single fact |
| `useFact(system, [keys])` | Subscribe to multiple facts |
| `useDerived(system, key)` | Subscribe to a derivation |
| `useDerived(system, [keys])` | Subscribe to multiple derivations |
| `useEvents(system)` | Typed event dispatchers |
| `useDispatch(system)` | Low-level event dispatch |
| `useWatch(system, key, callback)` | Side-effect watcher (no re-render) |
| `useInspect(system)` | System inspection (settled, unmet, inflight) |
| `useExplain(system, reqId)` | Requirement explanation |
| `useConstraintStatus(system)` | Reactive constraint inspection |
| `useRequirementStatus(statusPlugin, type)` | Requirement loading/error status (takes `statusPlugin`, not `system`) |
| `useOptimisticUpdate(system, statusPlugin?, type?)` | Optimistic mutations with rollback |
| `useTimeTravel(system)` | Time-travel controls (undo/redo) |
| `useDirective(moduleDef)` | Scoped system with selected or all subscriptions |
| `createTypedHooks<M>()` | Factory for fully typed hook variants |

---

## How to Choose

- **React** – Most comprehensive adapter. Use if you're building a React app.
- **Vue** – Full composable API with `ref`-based reactivity. Pass `system` explicitly to composables.
- **Svelte** – Returns Svelte `Readable` stores. Use `$` prefix for auto-subscription.
- **Solid** – Signal-based reactivity. Fine-grained updates without VDOM overhead.
- **Lit** – Controller-based pattern for Web Components. Works with any Lit element.

---

## Next Steps

- **[React Adapter](/docs/adapters/react)** – The most popular starting point
- **[Quick Start](/docs/quick-start)** – Build your first module
- **[Core Concepts](/docs/core-concepts)** – Understand facts, derivations, and constraints
