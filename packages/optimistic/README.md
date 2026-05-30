# `@directive-run/optimistic`

> Resolver-scope optimistic update + automatic rollback for Directive.

```sh
npm install @directive-run/optimistic
```

## What it solves

The "snapshot before, restore on catch, rethrow" pattern that recurred
~3 times during the Minglingo migration. Manual version:

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
}
```

With this package:

```ts
import { withOptimistic } from '@directive-run/optimistic';

interface FormFacts { values: FormValues; /* ... */ }

submit: withOptimistic<FormFacts>(['values'])(async ({ payload, facts }) => {
  facts.values = optimisticGuess(payload);
  facts.values = await deps.submit(payload);
}),
```

The single-arg outer call (`withOptimistic<F>(keys)`) is what makes
the keys array type-check against `keyof F` – a typo like
`['valuess']` becomes a compile error. The inner call accepts your
mutator handler unchanged.

If the inner handler throws, `facts.values` snaps back to its
pre-handler value and the throw propagates upward.

## Scope: deliberately tight

This package operates within a **single resolver invocation**. It is:

- ✅ A "try / restore on catch" macro
- ❌ NOT a system-wide transaction
- ❌ NOT a cross-module rollback
- ❌ NOT a replay-undo

If you need cross-module rollback, you're describing a distributed
transaction – not what this is. The MIGRATION_FEEDBACK item this
addresses (#19) is explicitly resolver-scope.

## API

### `createSnapshot(facts, keys) → restore`

Capture the current values of selected keys; return a `restore`
function. Use inside a try/catch:

```ts
const restore = createSnapshot(facts, ['values', 'lastSavedAt']);
try {
  facts.values = optimisticGuess(payload);
  facts.values = await deps.submit(payload);
  facts.lastSavedAt = Date.now();
} catch (err) {
  restore();
  throw err;
}
```

`restore()` can be called multiple times – each call writes the
captured snapshot back. Useful if your handler has multiple
mid-execution decision points.

### `withOptimistic<F>(keys)(handler) → wrappedHandler`

Higher-order helper that wraps a handler with snapshot + automatic
rollback. The two-call signature lets TypeScript infer the keys array
against `keyof F` – typos are compile errors. Composes with
`@directive-run/mutator`:

```ts
import { defineMutator } from '@directive-run/mutator';
import { withOptimistic } from '@directive-run/optimistic';

const mut = defineMutator<FormMutations, FormFacts>({
  submit: withOptimistic<FormFacts>(['values'])(
    async ({ payload, facts }) => {
      facts.values = optimisticGuess(payload);
      facts.values = await deps.submit(payload);
    },
  ),
  cancel: ({ facts }) => { facts.values = []; },
});
```

The wrapper:
1. Snapshots `facts.values` at handler entry.
2. Runs the inner handler.
3. On uncaught throw: restores `facts.values`, then rethrows.
4. On success: leaves the new values in place.

## Cloning semantics

Snapshots are **deep-cloned** via `structuredClone` (Node 17+, modern
browsers – Directive's documented engine baseline). There is **no**
JSON-roundtrip fallback: that path silently dropped functions,
symbols, undefined values, and was the exact silent-corruption hole
optimistic rollback exists to prevent. structuredClone covers what
the JSON-roundtrip-fact contract allows, so falling back to JSON
adds zero recoverable cases and one corruption surface.

If a fact contains a function, DOM node, non-cloneable instance, or
some other shape `structuredClone` rejects, the snapshot **throws**
an `OptimisticCloneError` with the offending key – making the
violation loud rather than silently corrupting the rolled-back
state. Convert at the boundary (e.g. `Date → number`,
`BigInt → string`) before assigning to facts.

```ts
import { OptimisticCloneError } from '@directive-run/optimistic';

try {
  const restore = createSnapshot(facts, ['weirdField']);
  // ...
} catch (err) {
  if (err instanceof OptimisticCloneError) {
    // err.key is the fact key that couldn't be cloned
  }
}
```

## Composition with mutator

When using `@directive-run/mutator` and a handler throws, the mutator
captures the error on `pendingMutation.error` and stops the constraint
from re-firing. With `withOptimistic`, the rollback runs **before** the
mutator captures the error – so by the time the UI renders the error,
the facts are already back to their pre-mutation state.

This is the right ordering for optimistic UI:
- Optimistic write happens immediately (good UX)
- Rollback happens before the error surfaces (no torn state)
- Error message is preserved on `pendingMutation.error` (UI can show)

### Layering with `cancellable()`

`@directive-run/mutator` also ships a `cancellable()` HOC that aborts an
in-flight handler when a fresh dispatch supersedes it (or the timeout
fires). `cancellable()` throws an `AbortError` / `SupersededCancelError`
out of the handler, and `withOptimistic` cannot tell that error apart
from a "real" failure: it rolls back the snapshot.

If the successor dispatch has already written to the same facts by then,
the rollback clobbers those writes – the UI flickers back to the pre-
mutation state for one tick before the new dispatch's optimistic write
lands.

**Wrap `withOptimistic` on the inside of `cancellable`, not the outside:**

```ts
// good: withOptimistic only sees the handler that actually does the work.
// If cancellable aborts, the abort never reaches the optimistic snapshot.
const handler = cancellable(
  withOptimistic<Facts, "draft">(["draft"])(async (req, ctx, signal) => {
    ctx.facts.draft = req.text;
    await saveDraft(req.text, { signal });
  }),
);

// bad: a supersede abort throws past withOptimistic, which then rolls back
// `draft` even though the new dispatch was about to set it.
const handler = withOptimistic<Facts, "draft">(["draft"])(
  cancellable(async (req, ctx, signal) => {
    ctx.facts.draft = req.text;
    await saveDraft(req.text, { signal });
  }),
);
```

The same rule applies to `recordReplayable()`: it sits at the outermost
layer so timeline frames capture the cancel event before any rollback
runs.

## When to skip the helper

- **Synchronous handlers.** No async work means no in-flight state to
  protect from. Just write the value.
- **Single fact mutation that's idempotent.** If the only thing the
  handler writes is the result of an awaited call (`facts.x = await
  fn()`) and there's no optimistic guess, there's nothing to roll back.
- **Multi-fact reads/writes that aren't related.** Snapshot only the
  facts you actually optimistically wrote.

## See also

- [`@directive-run/mutator`](https://www.npmjs.com/package/@directive-run/mutator) – composes with this for full optimistic-UI flows
- [`@directive-run/core`](https://www.npmjs.com/package/@directive-run/core) – the runtime
- [JSON-fact contract](https://docs.directive.run/api/facts#json-roundtrippability-is-required)
- [`MIGRATION_FEEDBACK.md` item 19](https://github.com/directive-run/directive/blob/main/docs/MIGRATION_FEEDBACK.md)

## License

MIT OR Apache-2.0
