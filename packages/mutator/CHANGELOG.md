# @directive-run/mutator changelog

## 0.1.0 — 2026-04-29

Initial release.

### Added
- `defineMutator(handlers)` — typed builder that returns six fragments
  (facts / events / requirements / eventHandlers / constraints /
  resolvers) wiring a discriminated `pendingMutation` lifecycle into a
  Directive module.
- `mutate(kind, payload?)` — typed payload constructor for `MUTATE`
  dispatches.
- Single-flight concurrency model: new mutations overwrite in-flight ones
  via the `pendingMutation` fact.
- Error capture: thrown handlers surface on `pendingMutation.error`
  with `status: 'failed'` (a distinct status from `'running'` so the
  UI can disambiguate; the constraint stops firing).
- Built on `@directive-run/core@^1.2.0` (requires `ctx.requeue` for
  handler-cascade chains).

### Known gaps
- Parallel-of-same-shape mutations not supported — last-write-wins.
- No runtime payload validation — TypeScript only at dispatch site.
- Optimistic / snapshot-rollback support belongs to upcoming
  `@directive-run/optimistic`; do manual rollback inside handlers for
  now.

### Why the 0.x version
This package collapses a real-world boilerplate pattern but the API
shape (six-spread vs builder vs HOC) is still being validated against
production use. v1.0 ships once at least three external consumers have
worn the API end-to-end.
