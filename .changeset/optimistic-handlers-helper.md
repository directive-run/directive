---
"@directive-run/optimistic": minor
---

Add `withOptimisticHandlers` for batch-wrapping a `defineMutator` handler map.

Wrapping every handler in a mutator config with `withOptimistic(...)`
individually means an extra layer of nesting at every callsite.
`withOptimisticHandlers` takes a partial per-handler key map and a handler
map, returns the same-shape map with the listed handlers wrapped:

```ts
import { defineMutator } from "@directive-run/mutator";
import { withOptimisticHandlers } from "@directive-run/optimistic";

const handlers = withOptimisticHandlers<typeof raw, Facts>(
  {
    saveDraft: ["draft"],
    publish: ["draft", "published"],
  },
  raw,
);

const mut = defineMutator<Muts, Facts>(handlers);
```

Listed handlers are wrapped with `withOptimistic(keys)`; omitted entries
(and entries with an empty key array) are returned by identity so a
`=== handlers.x` check stays sound. Apply this before any outer
`cancellable()` so a supersede-abort doesn't trip the rollback.
