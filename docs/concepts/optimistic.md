# `@directive-run/optimistic` – resolver-scope snapshot + rollback

> The "snapshot before, restore on catch, rethrow" pattern – the one
> that recurred ~3 times across a production migration – as a one-line
> macro. Single resolver invocation. Loud-fail on non-cloneable values.

## What it solves

Manual version of the pattern:

```ts
submit: async ({ payload, facts }) => {
  const previousValues = [...facts.values];
  facts.values = optimisticGuess(payload);
  try {
    facts.values = await deps.submit(payload);
  } catch (err) {
    facts.values = previousValues;
    throw err;
  }
},
```

With this package:

```ts
import { withOptimistic } from "@directive-run/optimistic";

interface FormFacts { values: FormValues; /* ... */ }

submit: withOptimistic<FormFacts>(["values"])(async ({ payload, facts }) => {
  facts.values = optimisticGuess(payload);
  facts.values = await deps.submit(payload);
}),
// → on throw: facts.values snaps back, then the throw propagates
```

The single-arg outer call (`withOptimistic<F>(keys)`) is what makes the
keys array type-check against `keyof F`. A typo like `["valuess"]`
becomes a compile error. The inner call accepts your mutator handler
unchanged.

## Setup

```ts
import { defineMutator } from "@directive-run/mutator";
import { withOptimistic } from "@directive-run/optimistic";

const mut = defineMutator<FormMutations, FormFacts>({
  submit: withOptimistic<FormFacts>(["values"])(
    async ({ payload, facts }) => {
      facts.values = optimisticGuess(payload);     // optimistic write
      facts.values = await deps.submit(payload);   // throws on network err
    },
  ),
  cancel: ({ facts }) => {
    facts.values = [];
  },
});
```

The wrapper:

1. Snapshots the listed keys at handler entry via `structuredClone`.
2. Runs the inner handler.
3. On uncaught throw: restores the listed keys, then rethrows.
4. On success: leaves the new values in place.

## API

| Symbol | What |
| --- | --- |
| `createSnapshot(facts, keys)` | Capture selected keys; returns a `restore` function. Use inside a try/catch. `restore()` may be called multiple times. |
| `withOptimistic<F>(keys)(handler)` | Curried HOC that wraps a handler with auto-snapshot + restore-on-throw. The two-call form lets TS infer `keys` against `keyof F`. |
| `OptimisticCloneError` | Thrown when a fact value is not `structuredClone`-able. Carries the offending `key`. |

## Examples

### Manual snapshot + multi-key restore

```ts
import { createSnapshot } from "@directive-run/optimistic";

const restore = createSnapshot(facts, ["values", "lastSavedAt"]);
try {
  facts.values = optimisticGuess(payload);
  facts.values = await deps.submit(payload);
  facts.lastSavedAt = Date.now();
} catch (err) {
  restore();   // both keys snap back
  throw err;
}
// → on throw, facts.values and facts.lastSavedAt both restored
```

The snapshot is captured **atomically** – if any single key fails to
clone, the partial snapshot is discarded and the throw propagates. The
caller never gets a `restore()` that would overwrite un-snapshotted
facts with `undefined`.

### Composition with `@directive-run/mutator`

```ts
import { defineMutator } from "@directive-run/mutator";
import { withOptimistic } from "@directive-run/optimistic";

const mut = defineMutator<FormMutations, FormFacts>({
  submit: withOptimistic<FormFacts>(["values"])(
    async ({ payload, facts }) => {
      facts.values = optimisticGuess(payload);
      facts.values = await deps.submit(payload);
    },
  ),
});
```

When the handler throws, the mutator captures the error on
`pendingMutation.error` and stops the constraint from re-firing. With
`withOptimistic`, the rollback runs **before** the mutator captures the
error – so by the time the UI renders the error, the facts are already
back to their pre-mutation state.

This is the right ordering for optimistic UI:

- Optimistic write happens immediately (good UX).
- Rollback happens before the error surfaces (no torn state).
- Error message is preserved on `pendingMutation.error` (UI can show).

### Edge case – non-cloneable values throw loudly

```ts
import { OptimisticCloneError } from "@directive-run/optimistic";

try {
  const restore = createSnapshot(facts, ["domNode"]);
  // ...
} catch (err) {
  if (err instanceof OptimisticCloneError) {
    console.log(err.key);
    // → "domNode"
  }
}
```

Snapshots use `structuredClone` (Node 17+ / modern browsers –
Directive's documented engine baseline). There is **no JSON-roundtrip
fallback**: that path silently drops functions, symbols, and undefined
values, which is exactly the silent corruption optimistic rollback
exists to prevent. If `structuredClone` rejects a value (function, DOM
node, BigInt, circular ref, class instance with non-cloneable
properties), the snapshot throws `OptimisticCloneError` with the
offending key. Convert at the boundary (`Date → number`,
`BigInt → string`, `Set/Map → array/object`) before assigning to facts.

## Scope – deliberately tight

This package operates within a **single resolver invocation**. It is:

- ✅ A "try / restore on catch" macro.
- ✅ Composable with `@directive-run/mutator` for optimistic-UI flows.
- ❌ NOT a system-wide transaction.
- ❌ NOT a cross-module rollback.
- ❌ NOT a replay-undo (use [`@directive-run/timeline`](./timeline.md) for that).
- ❌ NOT a JSON-roundtrip fallback – non-cloneable values throw, by design.

If you need cross-module rollback, you are describing a distributed
transaction – not what this is.

## When to skip the helper

- **Synchronous handlers.** No async work means no in-flight state to
  protect from. Just write the value.
- **Idempotent single-fact mutation.** If the only thing the handler
  writes is the result of an awaited call (`facts.x = await fn()`) with
  no optimistic guess, there is nothing to roll back.
- **Multi-fact reads/writes that are unrelated.** Snapshot only the
  facts you actually optimistically wrote.

## What it does NOT do

- ✅ Snapshots specific keys via `structuredClone` at handler entry.
- ✅ Restores on uncaught throw; leaves new values on success.
- ✅ Composes with `@directive-run/mutator` – rollback runs before error capture.
- ✅ Loud-fails on non-cloneable values (`OptimisticCloneError`).
- ❌ Not a system-wide transaction – single resolver scope only.
- ❌ Not a cross-module rollback – snapshots only the facts you list.
- ❌ Not a silent corruption layer – no JSON-roundtrip fallback.
- ❌ Not a JSON-roundtrip checker for the schema – it only runs against the keys you pass in.

## See also

- [Package README on GitHub](https://github.com/directive-run/directive/tree/main/packages/optimistic)
- [`@directive-run/mutator`](./mutator.md) – composes with this for full optimistic-UI flows
- [JSON-fact contract](https://docs.directive.run/api/facts#json-roundtrippability-is-required) – why the clone rejects what it rejects
