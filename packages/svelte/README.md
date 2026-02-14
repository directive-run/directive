# @directive-run/svelte

Svelte stores adapter for Directive. Provides `Readable` store-based hooks and store factories for reading facts, derivations, and dispatching events.

## Install

```bash
npm install @directive-run/core @directive-run/svelte
```

## Usage

```svelte
<script>
  import { useFact, useDerived, useEvents } from "@directive-run/svelte";

  const count = useFact(system, "count");
  const doubled = useDerived(system, "doubled");
  const events = useEvents(system);
</script>

<p>Count: {$count} (doubled: {$doubled})</p>
<button on:click={() => events.increment()}>+</button>
```

## Exports

`useFact`, `useDerived`, `useSelector`, `useDispatch`, `useEvents`, `useWatch`, `useInspect`, `useRequirementStatus`, `useExplain`, `useConstraintStatus`, `useOptimisticUpdate`, `useTimeTravel`, `useDirective`, `createTypedHooks`, `createFactStore`, `createDerivedStore`, `createDerivedsStore`, `createInspectStore`, `shallowEqual`

## Peer Dependencies

- `svelte >= 4`
- `@directive-run/core`

## License

MIT

[Full documentation](https://directive.run/docs)
