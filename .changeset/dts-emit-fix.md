---
"@directive-run/core": patch
---

Fix: `t.union<>()` declaration emit cycle

The 1.2.0 release shipped `t.union<T>()` as a generic-only schema constructor (the Phase 1 P0 from MIGRATION_FEEDBACK item #21). The runtime works correctly, but the declaration emitter hit a self-reference cycle when typing the `t` object — the overload-cast pattern (`(impl) as { ovl1; ovl2 }`) inside an object literal triggered:

```
error TS7022: 't' implicitly has type 'any' because it does not have a
type annotation and is referenced directly or indirectly in its own
initializer.
```

Downstream consumers running `tsc --noEmit` against `@directive-run/core@1.2.0` saw type errors. Hoist `unionImpl` to a typed top-level const (`unionImpl: UnionFn`) and reference it as `union: unionImpl` in the `t` object — runtime semantics unchanged, declaration emit walks cleanly.

Caught when Minglingo's `apps/web` tried to consume `@directive-run/core/testing.flushAsync` — the JS dist built fine but the DTS build failed for the union exports, masking the entire testing surface from typed downstream usage.
