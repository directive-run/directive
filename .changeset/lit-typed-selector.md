---
"@directive-run/lit": minor
---

`createDirectiveSelector` and `DirectiveSelectorController` now thread
the system's schema into their selector callbacks. A selector receives
`InferSelectorState<S>` — the union of `InferFacts<S>` and
`InferDerivations<S>` — instead of `Record<string, unknown>`, so
`state.count + state.doubled` compiles without `as number` casts at the
call site.

`DirectiveSelectorController` gains an `S extends ModuleSchema` type
parameter ahead of its existing `R` parameter, with `S` defaulting to
`ModuleSchema`. Existing callers that wrote `new DirectiveSelectorController<R>(...)`
without an explicit `S` keep compiling because the factory infers `S`
from the `SingleModuleSystem<S>` argument. No runtime change; selector
proxy semantics are identical.
