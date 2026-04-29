# @directive-run/optimistic changelog

## 0.1.0 — 2026-04-29

Initial release.

### Added
- `createSnapshot(facts, keys)` — captures the current values of selected
  fact keys; returns a `restore` function that writes them back. Deep
  clone via `structuredClone` (Node 17+ / modern browsers) with
  JSON-roundtrip fallback.
- `withOptimistic(keys, handler)` — higher-order helper that wraps a
  handler with snapshot + automatic rollback on uncaught throw.
  Composes with `@directive-run/mutator` for full optimistic-UI flows.

### Scope (intentional)
- Resolver-scope only. Not a system-wide transaction primitive. Not a
  cross-module rollback. Not a replay-undo.
- Relies on Directive's JSON-roundtrippable-fact contract — facts that
  violate the contract (Date, Set, Map, File, class instances) will
  silently mis-restore.

### Why the 0.x version
The API surface (HOC vs context-method vs explicit createSnapshot) needs
≥3 external consumers before settling. v1.0 ships when the wrapper
shape is validated by real-world use.
