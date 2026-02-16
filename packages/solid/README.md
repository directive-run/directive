# @directive-run/solid

[![npm](https://img.shields.io/npm/v/@directive-run/solid?color=%236366f1)](https://www.npmjs.com/package/@directive-run/solid)
[![downloads](https://img.shields.io/npm/dm/@directive-run/solid)](https://www.npmjs.com/package/@directive-run/solid)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@directive-run/solid)](https://bundlephobia.com/package/@directive-run/solid)

Solid.js primitives for [Directive](https://www.npmjs.com/package/@directive-run/core). Returns `Accessor` signals that integrate with Solid's fine-grained reactivity system.

## Install

```bash
npm install @directive-run/core @directive-run/solid
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

```tsx
// Counter.tsx
import { useFact, useDerived, useEvents } from "@directive-run/solid";
import { system } from "./system";

export function Counter() {
  const count = useFact(system, "count");
  const doubled = useDerived(system, "doubled");
  const events = useEvents(system);

  return (
    <div>
      <p>Count: {count()} (doubled: {doubled()})</p>
      <button onClick={() => events.increment()}>+</button>
      <button onClick={() => events.decrement()}>&minus;</button>
    </div>
  );
}
```

## useSelector

Auto-tracking selector over facts and derivations. Returns an `Accessor` that updates when accessed keys change:

```tsx
import { useSelector } from "@directive-run/solid";
import { system } from "./system";

function Summary() {
  const label = useSelector(system, (state) => {
    return state.count > 10 ? "High" : "Low";
  });

  return <span>{label()}</span>;
}
```

## API Reference

### Core Primitives

| Primitive | Return Type | Description |
|-----------|------------|-------------|
| `useFact(system, key)` | `Accessor<T>` | Subscribe to a single fact value |
| `useFact(system, [keys])` | `Accessor<Pick<Facts, K>>` | Subscribe to multiple facts |
| `useDerived(system, key)` | `Accessor<T>` | Subscribe to a single derivation |
| `useDerived(system, [keys])` | `Accessor<Pick<Derivations, K>>` | Subscribe to multiple derivations |
| `useSelector(system, fn)` | `Accessor<R>` | Auto-tracking selector with optional equality function |
| `useEvents(system)` | `Events` | Events dispatcher |
| `useDispatch(system)` | `(event) => void` | Low-level dispatch function |

### Advanced Primitives

| Primitive | Return Type | Description |
|-----------|------------|-------------|
| `useWatch(system, key, cb)` | `void` | Side-effect on fact or derivation change |
| `useInspect(system)` | `Accessor<InspectState>` | Consolidated system state (isSettled, unmet, inflight) |
| `useRequirementStatus(plugin, type)` | `Accessor<RequirementTypeStatus>` | Requirement loading/error state |
| `useExplain(system, reqId)` | `Accessor<string \| null>` | Human-readable requirement explanation |
| `useConstraintStatus(system)` | `Accessor<ConstraintInfo[]>` | All constraint states |
| `useOptimisticUpdate(system)` | `{ mutate, isPending: Accessor, error: Accessor, rollback }` | Optimistic mutation with auto-rollback |
| `useTimeTravel(system)` | `Accessor<TimeTravelState \| null>` | Undo/redo navigation |

### Solid-Specific

| Export | Description |
|--------|-------------|
| `useDirective(module, config?)` | Scoped system with lifecycle (auto-start/cleanup) |
| `useSuspenseRequirement(plugin, type)` | Suspense-compatible requirement status |
| `createFactSignal(system, key)` | `[Accessor, cleanup]` signal factory for use outside components |
| `createDerivedSignal(system, key)` | `[Accessor, cleanup]` signal factory for use outside components |
| `createTypedHooks()` | Factory for pre-typed primitives |
| `shallowEqual` | Shallow equality helper for selectors |

## Peer Dependencies

- `solid-js >= 1`
- `@directive-run/core`

## Documentation

- [Solid Adapter Guide](https://directive.run/docs/adapters/solid)
- [API Reference](https://directive.run/docs/api)

## License

MIT
