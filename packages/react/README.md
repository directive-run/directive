# @directive-run/react

[![npm](https://img.shields.io/npm/v/@directive-run/react?color=%236366f1)](https://www.npmjs.com/package/@directive-run/react)
[![downloads](https://img.shields.io/npm/dm/@directive-run/react)](https://www.npmjs.com/package/@directive-run/react)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@directive-run/react)](https://bundlephobia.com/package/@directive-run/react)

React hooks for [Directive](https://www.npmjs.com/package/@directive-run/core). Built on `useSyncExternalStore` for tear-free reads with concurrent rendering support.

## Install

```bash
npm install @directive-run/core @directive-run/react
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
import { useFact, useDerived, useEvents } from "@directive-run/react";
import { system } from "./system";

export function Counter() {
  const count = useFact(system, "count");
  const doubled = useDerived(system, "doubled");
  const events = useEvents(system);

  return (
    <div>
      <p>Count: {count} (doubled: {doubled})</p>
      <button onClick={() => events.increment()}>+</button>
      <button onClick={() => events.decrement()}>&minus;</button>
    </div>
  );
}
```

## useSelector

Auto-tracking selector over facts and derivations. Subscribes only to the keys your selector reads:

```tsx
import { useSelector } from "@directive-run/react";
import { system } from "./system";

function Summary() {
  const label = useSelector(system, (state) => {
    return state.count > 10 ? "High" : "Low";
  });

  return <span>{label}</span>;
}
```

## API Reference

### Core Hooks

| Hook | Return Type | Description |
|------|------------|-------------|
| `useFact(system, key)` | `T \| undefined` | Subscribe to a single fact value |
| `useFact(system, [keys])` | `Pick<Facts, K>` | Subscribe to multiple facts |
| `useDerived(system, key)` | `T` | Subscribe to a single derivation |
| `useDerived(system, [keys])` | `Pick<Derivations, K>` | Subscribe to multiple derivations |
| `useSelector(system, fn)` | `R` | Auto-tracking selector with optional equality function |
| `useEvents(system)` | `Events` | Memoized events dispatcher |
| `useDispatch(system)` | `(event) => void` | Low-level dispatch function |

### Advanced Hooks

| Hook | Return Type | Description |
|------|------------|-------------|
| `useWatch(system, key, cb)` | `void` | Side-effect on fact or derivation change (no re-render) |
| `useInspect(system)` | `InspectState` | Consolidated system state (isSettled, unmet, inflight) |
| `useRequirementStatus(plugin, type)` | `RequirementTypeStatus` | Requirement loading/error state |
| `useExplain(system, reqId)` | `string \| null` | Human-readable requirement explanation |
| `useConstraintStatus(system)` | `ConstraintInfo[]` | All constraint states |
| `useOptimisticUpdate(system)` | `{ mutate, isPending, error, rollback }` | Optimistic mutation with auto-rollback |
| `useTimeTravel(system)` | `TimeTravelState \| null` | Undo/redo navigation |

### React-Specific

| Export | Description |
|--------|-------------|
| `useDirective(module, options?)` | Scoped system with selected facts/derivations |
| `useDirectiveRef(module)` | Scoped system lifecycle (start on mount, destroy on unmount) |
| `useSuspenseRequirement(plugin, type)` | Suspense-compatible requirement status |
| `useHydratedSystem(module)` | Client-side system hydrated from server snapshot |
| `DirectiveDevTools` | Floating dev panel (tree-shaken in production) |
| `DirectiveHydrator` | SSR/RSC snapshot provider |
| `shallowEqual` | Shallow equality helper for selectors |

## Peer Dependencies

- `react >= 18`
- `@directive-run/core`

## Documentation

- [React Adapter Guide](https://directive.run/docs/adapters/react)
- [API Reference](https://directive.run/docs/api)

## License

MIT
