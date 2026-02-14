# @directive-run/react

React hooks for Directive. Provides `useSyncExternalStore`-based hooks for reading facts, derivations, and dispatching events.

## Install

```bash
npm install @directive-run/core @directive-run/react
```

## Usage

```tsx
import { useFact, useDerived, useEvents } from "@directive-run/react";

function Counter({ system }) {
  const count = useFact(system, "count");
  const doubled = useDerived(system, "doubled");
  const events = useEvents(system);

  return (
    <div>
      <p>Count: {count} (doubled: {doubled})</p>
      <button onClick={() => events.increment()}>+</button>
    </div>
  );
}
```

## Exports

`useFact`, `useDerived`, `useSelector`, `useDispatch`, `useEvents`, `useWatch`, `useInspect`, `useRequirementStatus`, `useSuspenseRequirement`, `useExplain`, `useConstraintStatus`, `useOptimisticUpdate`, `useTimeTravel`, `useDirective`, `useDirectiveRef`, `useHydratedSystem`, `DirectiveDevTools`, `DirectiveHydrator`, `shallowEqual`

## Peer Dependencies

- `react >= 18`
- `@directive-run/core`

## License

MIT

[Full documentation](https://directive.run/docs)
