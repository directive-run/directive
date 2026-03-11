---
"@directive-run/core": minor
---

Add type-safe runtime dynamics for dynamic definition APIs.

- Add `DynamicConstraintDef`, `DynamicEffectDef`, `DynamicResolverDef` types for typed `register()` and `assign()` callbacks
- Parameterize `ConstraintsControl`, `EffectsControl`, `DerivationsControl`, `ResolversControl` on module schema — dynamic definition callbacks now receive typed `facts` with autocomplete
- Add generic `call<T>()` on `DerivationsControl` for typed derivation return values
- Thread type params through `System<M>` and `SingleModuleSystem<S>`
