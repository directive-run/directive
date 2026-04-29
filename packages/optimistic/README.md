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

submit: withOptimistic(['values'], async ({ payload, facts }) => {
  facts.values = optimisticGuess(payload);
  facts.values = await deps.submit(payload);
}),
```

If the inner handler throws, `facts.values` snaps back to its
pre-handler value and the throw propagates upward.

## Scope: deliberately tight

This package operates within a **single resolver invocation**. It is:

- ✅ A "try / restore on catch" macro
- ❌ NOT a system-wide transaction
- ❌ NOT a cross-module rollback
- ❌ NOT a replay-undo

If you need cross-module rollback, you're describing a distributed
transaction — not what this is. The MIGRATION_FEEDBACK item this
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

`restore()` can be called multiple times — each call writes the
captured snapshot back. Useful if your handler has multiple
mid-execution decision points.

### `withOptimistic(keys, handler) → wrappedHandler`

Higher-order helper that wraps a handler with snapshot + automatic
rollback. Designed to compose with `@directive-run/mutator`:

```ts
import { defineMutator } from '@directive-run/mutator';
import { withOptimistic } from '@directive-run/optimistic';

const mut = defineMutator<FormMutations, FormFacts>({
  submit: withOptimistic(['values'], async ({ payload, facts }) => {
    facts.values = optimisticGuess(payload);
    facts.values = await deps.submit(payload);
  }),
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
browsers) with a JSON-roundtrip fallback. This matches Directive's
JSON-roundtrippable-fact contract — all reactive facts MUST be
JSON-roundtrippable, so JSON cloning is sufficient and safe.

If your fact contains a `Date`, `Set`, `Map`, `File`, or class instance,
you're already violating the JSON-fact contract (see
`@directive-run/core@1.2.0`'s dev-mode warning). The snapshot will
silently mis-restore. Convert at the boundary instead.

## Composition with mutator

When using `@directive-run/mutator` and a handler throws, the mutator
captures the error on `pendingMutation.error` and stops the constraint
from re-firing. With `withOptimistic`, the rollback runs **before** the
mutator captures the error — so by the time the UI renders the error,
the facts are already back to their pre-mutation state.

This is the right ordering for optimistic UI:
- Optimistic write happens immediately (good UX)
- Rollback happens before the error surfaces (no torn state)
- Error message is preserved on `pendingMutation.error` (UI can show)

## When to skip the helper

- **Synchronous handlers.** No async work means no in-flight state to
  protect from. Just write the value.
- **Single fact mutation that's idempotent.** If the only thing the
  handler writes is the result of an awaited call (`facts.x = await
  fn()`) and there's no optimistic guess, there's nothing to roll back.
- **Multi-fact reads/writes that aren't related.** Snapshot only the
  facts you actually optimistically wrote.

## See also

- [`@directive-run/mutator`](https://www.npmjs.com/package/@directive-run/mutator) — composes with this for full optimistic-UI flows
- [`@directive-run/core`](https://www.npmjs.com/package/@directive-run/core) — the runtime
- [JSON-fact contract](https://docs.directive.run/api/facts#json-roundtrippability-is-required)
- [`MIGRATION_FEEDBACK.md` item 19](https://github.com/directive-run/directive/blob/main/docs/MIGRATION_FEEDBACK.md)

## License

MIT OR Apache-2.0
