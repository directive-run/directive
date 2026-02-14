# @directive-run/solid

Solid.js signals adapter for Directive. Provides `Accessor`-based primitives for reading facts, derivations, and dispatching events.

## Install

```bash
npm install @directive-run/core @directive-run/solid
```

## Usage

```tsx
import { useFact, useDerived, useEvents } from "@directive-run/solid";

function Counter() {
  const count = useFact(system, "count");
  const doubled = useDerived(system, "doubled");
  const events = useEvents(system);

  return (
    <div>
      <p>Count: {count()} (doubled: {doubled()})</p>
      <button onClick={() => events.increment()}>+</button>
    </div>
  );
}
```

## Exports

`useFact`, `useDerived`, `useSelector`, `useDispatch`, `useEvents`, `useWatch`, `useInspect`, `useRequirementStatus`, `useSuspenseRequirement`, `useExplain`, `useConstraintStatus`, `useOptimisticUpdate`, `useTimeTravel`, `useDirective`, `createTypedHooks`, `createFactSignal`, `createDerivedSignal`, `shallowEqual`

## Peer Dependencies

- `solid-js >= 1`
- `@directive-run/core`

## License

MIT

[Full documentation](https://directive.run/docs)
