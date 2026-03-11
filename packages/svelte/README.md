# @directive-run/svelte

[![npm](https://img.shields.io/npm/v/@directive-run/svelte?color=%236366f1)](https://www.npmjs.com/package/@directive-run/svelte)
[![downloads](https://img.shields.io/npm/dm/@directive-run/svelte)](https://www.npmjs.com/package/@directive-run/svelte)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@directive-run/svelte)](https://bundlephobia.com/package/@directive-run/svelte)

Svelte stores for [Directive](https://www.npmjs.com/package/@directive-run/core). Returns `Readable` stores that work with Svelte's `$` auto-subscription syntax.

## Install

```bash
npm install @directive-run/core @directive-run/svelte
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

```svelte
<!-- Counter.svelte -->
<script>
  import { useFact, useDerived, useEvents } from "@directive-run/svelte";
  import { system } from "./system";

  const count = useFact(system, "count");
  const doubled = useDerived(system, "doubled");
  const events = useEvents(system);
</script>

<p>Count: {$count} (doubled: {$doubled})</p>
<button on:click={() => events.increment()}>+</button>
<button on:click={() => events.decrement()}>&minus;</button>
```

## useSelector

Auto-tracking selector over facts and derivations. Returns a `Readable` store:

```svelte
<script>
  import { useSelector } from "@directive-run/svelte";
  import { system } from "./system";

  const label = useSelector(system, (state) => {
    return state.count > 10 ? "High" : "Low";
  });
</script>

<span>{$label}</span>
```

## API Reference

### Core Hooks

| Hook | Return Type | Description |
|------|------------|-------------|
| `useFact(system, key)` | `Readable<T>` | Subscribe to a single fact value |
| `useFact(system, [keys])` | `Readable<Pick<Facts, K>>` | Subscribe to multiple facts |
| `useDerived(system, key)` | `Readable<T>` | Subscribe to a single derivation |
| `useDerived(system, [keys])` | `Readable<Pick<Derivations, K>>` | Subscribe to multiple derivations |
| `useSelector(system, fn)` | `Readable<R>` | Auto-tracking selector with optional equality function |
| `useEvents(system)` | `Events` | Events dispatcher |
| `useDispatch(system)` | `(event) => void` | Low-level dispatch function |

### Advanced Hooks

| Hook | Return Type | Description |
|------|------------|-------------|
| `useWatch(system, key, cb)` | `void` | Side-effect on fact or derivation change |
| `useInspect(system)` | `Readable<InspectState>` | Consolidated system state (isSettled, unmet, inflight) |
| `useRequirementStatus(plugin, type)` | `Readable<RequirementTypeStatus>` | Requirement loading/error state |
| `useExplain(system, reqId)` | `Readable<string \| null>` | Human-readable requirement explanation |
| `useConstraintStatus(system)` | `Readable<ConstraintInfo[]>` | All constraint states |
| `useOptimisticUpdate(system)` | `{ mutate, isPending: Readable, error: Readable, rollback }` | Optimistic mutation with auto-rollback |
| `useHistory(system)` | `Readable<HistoryState \| null>` | Undo/redo navigation |

### Svelte-Specific

| Export | Description |
|--------|-------------|
| `useDirective(module, config?)` | Scoped system with lifecycle (auto-start/destroy) |
| `createFactStore(system, key)` | `Readable` store factory for a single fact |
| `createDerivedStore(system, key)` | `Readable` store factory for a single derivation |
| `createDerivedsStore(system, [keys])` | `Readable` store factory for multiple derivations |
| `createInspectStore(system)` | `Readable` store factory for system inspection |
| `createTypedHooks()` | Factory for pre-typed hooks |
| `shallowEqual` | Shallow equality helper for selectors |

## Peer Dependencies

- `svelte >= 4`
- `@directive-run/core`

## Documentation

- [Svelte Adapter Guide](https://directive.run/docs/adapters/svelte)
- [API Reference](https://directive.run/docs/api)

## License

MIT
