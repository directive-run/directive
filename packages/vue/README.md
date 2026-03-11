# @directive-run/vue

[![npm](https://img.shields.io/npm/v/@directive-run/vue?color=%236366f1)](https://www.npmjs.com/package/@directive-run/vue)
[![downloads](https://img.shields.io/npm/dm/@directive-run/vue)](https://www.npmjs.com/package/@directive-run/vue)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@directive-run/vue)](https://bundlephobia.com/package/@directive-run/vue)

Vue 3 composables for [Directive](https://www.npmjs.com/package/@directive-run/core). Returns reactive `Ref` and `ShallowRef` values that integrate with Vue's reactivity system.

## Install

```bash
npm install @directive-run/core @directive-run/vue
```

## Quick Start

Define a module in a shared file, then use it in any component:

```typescript
// system.ts
import { createModule, createSystem, t } from "@directive-run/core";

const counter = createModule("counter", {
  schema: {
    facts: { count: t.number() },
    derivations: { doubled: t.number() },
    events: { increment: {}, decrement: {} },
    requirements: {},
  },
  init: (facts) => {
    facts.count = 0;
  },
  derive: {
    doubled: (facts) => facts.count * 2,
  },
  events: {
    increment: (facts) => { facts.count += 1; },
    decrement: (facts) => { facts.count -= 1; },
  },
});

export const system = createSystem({ module: counter });
system.start();
```

```vue
<!-- Counter.vue -->
<script setup lang="ts">
import { useFact, useDerived, useEvents } from "@directive-run/vue";
import { system } from "./system";

const count = useFact(system, "count");
const doubled = useDerived(system, "doubled");
const events = useEvents(system);
</script>

<template>
  <p>Count: {{ count }} (doubled: {{ doubled }})</p>
  <button @click="events.increment()">+</button>
  <button @click="events.decrement()">&minus;</button>
</template>
```

## useSelector

Auto-tracking selector over facts and derivations. Returns a `Ref` that updates when accessed keys change:

```vue
<script setup lang="ts">
import { useSelector } from "@directive-run/vue";
import { system } from "./system";

const label = useSelector(system, (state) => {
  return state.count > 10 ? "High" : "Low";
});
</script>

<template>
  <span>{{ label }}</span>
</template>
```

## API Reference

### Core Composables

| Composable | Return Type | Description |
|------------|------------|-------------|
| `useFact(system, key)` | `Ref<T>` | Subscribe to a single fact value |
| `useFact(system, [keys])` | `ShallowRef<Pick<Facts, K>>` | Subscribe to multiple facts |
| `useDerived(system, key)` | `Ref<T>` | Subscribe to a single derivation |
| `useDerived(system, [keys])` | `ShallowRef<Pick<Derivations, K>>` | Subscribe to multiple derivations |
| `useSelector(system, fn)` | `Ref<R>` | Auto-tracking selector with optional equality function |
| `useEvents(system)` | `Events` | Events dispatcher |
| `useDispatch(system)` | `(event) => void` | Low-level dispatch function |

### Advanced Composables

| Composable | Return Type | Description |
|------------|------------|-------------|
| `useWatch(system, key, cb)` | `void` | Side-effect on fact or derivation change |
| `useInspect(system)` | `ShallowRef<InspectState>` | Consolidated system state (isSettled, unmet, inflight) |
| `useRequirementStatus(plugin, type)` | `ShallowRef<RequirementTypeStatus>` | Requirement loading/error state |
| `useExplain(system, reqId)` | `Ref<string \| null>` | Human-readable requirement explanation |
| `useConstraintStatus(system)` | `ComputedRef<ConstraintInfo[]>` | All constraint states |
| `useOptimisticUpdate(system)` | `{ mutate, isPending: Ref, error: Ref, rollback }` | Optimistic mutation with auto-rollback |
| `useHistory(system)` | `ShallowRef<HistoryState \| null>` | Undo/redo navigation |

### Vue-Specific

| Export | Description |
|--------|-------------|
| `useDirective(module, config?)` | Scoped system with lifecycle (auto-start/destroy) |
| `createTypedHooks()` | Factory for pre-typed composables |
| `shallowEqual` | Shallow equality helper for selectors |

## Peer Dependencies

- `vue >= 3`
- `@directive-run/core`

## Documentation

- [Vue Adapter Guide](https://directive.run/docs/adapters/vue)
- [API Reference](https://directive.run/docs/api)

## License

MIT
