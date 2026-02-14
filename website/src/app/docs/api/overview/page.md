---
title: API Reference
description: Complete API reference for Directive – core exports, type definitions, and framework adapter hooks.
---

Comprehensive reference documentation for every public export in Directive. {% .lead %}

---

## Reference Sections

| Section | Page | Contents |
|---------|------|----------|
| [Core API](/docs/api/core) | `createModule`, `createSystem`, `t`, `module`, `Backoff`, and all core factory functions |
| [Types](/docs/api/types) | `ModuleSchema`, `Plugin`, `System`, `Requirement`, and all TypeScript type definitions |
| [React Hooks](/docs/api/react) | `useFact`, `useDerived`, `useSelector`, `useEvents`, and all React adapter exports |
| [Vue Composables](/docs/api/vue) | `useFact`, `useDerived`, `useSelector`, `useEvents`, and all Vue adapter exports |
| [Svelte Hooks](/docs/api/svelte) | `useFact`, `useDerived`, `useSelector`, `useEvents`, and all Svelte adapter exports |
| [Solid Hooks](/docs/api/solid) | `useFact`, `useDerived`, `useSelector`, `useEvents`, and all Solid adapter exports |
| [Lit Controllers](/docs/api/lit) | `DerivedController`, `FactController`, `InspectController`, and all Lit adapter exports |

---

## Import Paths

| Path | Contents |
|------|----------|
| `@directive-run/core` | Core API – modules, systems, type builders, [constraint/resolver helpers](/docs/api/core#builders--helpers) |
| `@directive-run/react` | React hooks and components |
| `@directive-run/vue` | Vue composables |
| `@directive-run/svelte` | Svelte stores |
| `@directive-run/solid` | Solid signals |
| `@directive-run/lit` | Lit controllers |
| `@directive-run/core/plugins` | Built-in plugins (logging, devtools, persistence) |
| `@directive-run/core/testing` | Test utilities (mock resolvers, fake timers, assertions) |
| `@directive-run/ai` | AI agent orchestration, guardrails, streaming, [constraint builders](/docs/glossary#ai-builders-directiveai) |
| `@directive-run/core/worker` | Web Worker adapter |

---

## Next Steps

- **[Core API Reference](/docs/api/core)** – Start here for the main `@directive-run/core` exports
- **[Type Definitions](/docs/api/types)** – All TypeScript interfaces and types
- **[React Hooks](/docs/api/react)** – React adapter hooks reference
- **[Vue Composables](/docs/api/vue)** – Vue adapter composables reference
- **[Svelte Hooks](/docs/api/svelte)** – Svelte adapter hooks reference
- **[Solid Hooks](/docs/api/solid)** – Solid adapter hooks reference
- **[Lit Controllers](/docs/api/lit)** – Lit adapter controllers reference
