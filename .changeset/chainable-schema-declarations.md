---
"@directive-run/core": patch
---

Chaining a validator no longer erases the fact's type

`t.number().min(0)`, `t.string().minLength(1)`, `t.array<T>().nonEmpty()` and
`t.object<T>().hasKeys(...)` returned `any` in the published declarations, so
tightening a fact with a validator silently removed static checking from that fact
and from every derivation, constraint and resolver reading it.

The chainable types are recursive and were declared inside their builder
functions, where the declaration emitter has no name to reference — it emitted the
recursive return as an intersection with `any`. They are now module-scope
interfaces. The runtime never changed; only the emitted types were wrong, which is
why the source type-checked and every existing test passed.

Adds `packages/core/__tests__/dist-types.test.ts`, which type-checks a fixture
against the built `dist/index.d.ts` the way a consumer does. Tests that run
against `src/` cannot see this class of defect.
