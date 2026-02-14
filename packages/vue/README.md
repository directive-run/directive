# @directive-run/vue

Vue 3 composition API adapter for Directive. Provides reactive `ref` and `shallowRef` composables for reading facts, derivations, and dispatching events.

## Install

```bash
npm install @directive-run/core @directive-run/vue
```

## Usage

```vue
<script setup>
import { useFact, useDerived, useEvents } from "@directive-run/vue";

const count = useFact(system, "count");
const doubled = useDerived(system, "doubled");
const events = useEvents(system);
</script>

<template>
  <p>Count: {{ count }} (doubled: {{ doubled }})</p>
  <button @click="events.increment()">+</button>
</template>
```

## Exports

`useFact`, `useDerived`, `useSelector`, `useDispatch`, `useEvents`, `useWatch`, `useInspect`, `useRequirementStatus`, `useExplain`, `useConstraintStatus`, `useOptimisticUpdate`, `useTimeTravel`, `useDirective`, `createTypedHooks`, `shallowEqual`

## Peer Dependencies

- `vue >= 3`
- `@directive-run/core`

## License

MIT

[Full documentation](https://directive.run/docs)
