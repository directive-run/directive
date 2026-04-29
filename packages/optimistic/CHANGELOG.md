# @directive-run/optimistic changelog

## 0.1.0 — 2026-04-29

Initial release.

### Added
- `createSnapshot(facts, keys)` — captures the current values of selected
  fact keys; returns a `restore` function that writes them back. Deep
  clone via `structuredClone` (Node 17+ / modern browsers). On clone
  failure (function, DOM node, non-cloneable shape) throws a typed
  `OptimisticCloneError` with the offending key — no silent
  corruption. Capture is atomic: if any single key throws, no
  partial-snapshot state leaks to the caller.
- `OptimisticCloneError` — thrown when a fact value cannot be
  snapshotted; carries the key + cause.
- `withOptimistic<F>(keys)(handler)` — curried higher-order helper
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
