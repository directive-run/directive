# @directive-run/optimistic changelog

## 0.2.1

### Patch Changes

- [`0c2d306`](https://github.com/directive-run/directive/commit/0c2d30637d854098286980309a00f2152c9997d4) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Repair two README examples that didn't compile.

  `withOptimistic<F>` is a single-generic curried helper, but two worked examples in the cancel-supersession layering section called `withOptimistic<Facts, "draft">(["draft"])(...)`. The second generic was a leftover from an older two-arg shape — copy-paste produced an "Expected 1 type argument, got 2" compile error. Dropped to `withOptimistic<Facts>` so the example matches the function's actual signature.

  No code changes.

## 0.2.0

### Minor Changes

- [`2c613ba`](https://github.com/directive-run/directive/commit/2c613bae5aab8bf0d922833ec3e6f13e5ceacdcc) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add `withOptimisticHandlers` for batch-wrapping a `defineMutator` handler map.

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
    raw
  );

  const mut = defineMutator<Muts, Facts>(handlers);
  ```

  Listed handlers are wrapped with `withOptimistic(keys)`; omitted entries
  (and entries with an empty key array) are returned by identity so a
  `=== handlers.x` check stays sound. Apply this before any outer
  `cancellable()` so a supersede-abort doesn't trip the rollback.

## 0.1.0 – 2026-04-29

Initial release.

### Added

- `createSnapshot(facts, keys)` – captures the current values of selected
  fact keys; returns a `restore` function that writes them back. Deep
  clone via `structuredClone` (Node 17+ / modern browsers). On clone
  failure (function, DOM node, non-cloneable shape) throws a typed
  `OptimisticCloneError` with the offending key – no silent
  corruption. Capture is atomic: if any single key throws, no
  partial-snapshot state leaks to the caller.
- `OptimisticCloneError` – thrown when a fact value cannot be
  snapshotted; carries the key + cause.
- `withOptimistic<F>(keys)(handler)` – curried higher-order helper
  that wraps a handler with snapshot + automatic rollback on uncaught
  throw. The two-call shape lets TypeScript infer the keys array
  against `keyof F` so typos become compile errors.
  Composes with `@directive-run/mutator` for full optimistic-UI flows.

### Scope (intentional)

- Resolver-scope only. Not a system-wide transaction primitive. Not a
  cross-module rollback. Not a replay-undo.
- Relies on `structuredClone` availability (Node 17+ / modern
  browsers). Facts that violate Directive's JSON-roundtrippable
  contract trigger a loud `OptimisticCloneError` rather than silent
  mis-restore.

### Why the 0.x version

The API surface (HOC vs context-method vs explicit createSnapshot) needs
≥3 external consumers before settling. v1.0 ships when the wrapper
shape is validated by real-world use.
