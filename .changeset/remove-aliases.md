---
"@directive-run/core": minor
"@directive-run/lit": minor
"@directive-run/ai": minor
---

One name per thing: the duplicate names are gone.

- The RFC 0006 `*Definition` type aliases are removed. Each type has one name, the `*Def` form: `ModuleDef`, `ConstraintDef`, `ResolverDef`, `EffectDef`, `SourceDef` and the rest. `SourcePublishFn` and `SourceUnsubscribeFn` are removed too; use `SourcePublish` and `SourceUnsubscribe`. Rewrite `ModuleDefinition` as `ModuleDef`, and so on.
- `@directive-run/lit` no longer exports `createModule`, the old name for `createModuleController` that collided with core's `createModule`. Import `createModuleController`.
- The unused `_kind` field is removed from `ExtendedSchemaType` and `IntrospectableSchema`. Schema introspection reads the `_typeName` every `t.*()` builder records.
- `@directive-run/ai`: `attachSourcesToOtel` reads `localId` from every source event (no fallback to `id`), and the core peer range is `^1.35.0`.
