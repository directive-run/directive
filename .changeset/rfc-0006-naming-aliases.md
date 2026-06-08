---
"@directive-run/core": minor
---

`*Definition` aliases for the `*Def` cohort (RFC 0006 — 1.x forward-compat landing)

`@directive-run/core` now exports `*Definition` names alongside every
`*Def` type so consumers can migrate from the abbreviated form today
without breaking change. The `*Def` types stay canonical through 1.x;
**2.0** swaps which name is canonical and which is the deprecated
alias.

Rationale (per RFC 0006): `*Def` is an abbreviation. The workspace's
own `anti-patterns.md` entry #5 forbids abbreviating `context` to
`ctx`; the same logic applies to type names. Minifiers handle the
bytes; source-code readability does not.

### What ships

The aliases live in `packages/core/src/core/types/index.ts` via the
`export type { X as Y }` re-export-rename pattern, which preserves all
generic forwarding + TS inference rules (mapped types, conditional
distribution, tagged-union discrimination, barrel re-exports). Each
alias resolves to the SAME type symbol as its canonical name — just
under a different label.

Aliased cohorts:

- `ModuleDef` → `ModuleDefinition`
- `ConstraintDef` / `ConstraintsDef` → `ConstraintDefinition` / `ConstraintsDefinition`
- `TypedConstraintDef` / `TypedConstraintsDef` → `TypedConstraintDefinition` / `TypedConstraintsDefinition`
- `CrossModuleConstraintDef` / `CrossModuleConstraintsDef` → `CrossModuleConstraintDefinition` / `CrossModuleConstraintsDefinition`
- `DynamicConstraintDef` → `DynamicConstraintDefinition`
- `ResolverDef` / `ResolversDef` → `ResolverDefinition` / `ResolversDefinition`
- `TypedResolverDef` / `TypedResolversDef` → `TypedResolverDefinition` / `TypedResolversDefinition`
- `SchemaTypedResolversDef` → `SchemaTypedResolversDefinition`
- `DynamicResolverDef` → `DynamicResolverDefinition`
- `DerivationDef` / `DerivationsDef` / `DerivationDefWithMeta` → `DerivationDefinition` / `DerivationsDefinition` / `DerivationDefinitionWithMeta`
- `TypedDerivationsDef` / `CrossModuleDerivationsDef` → `TypedDerivationsDefinition` / `CrossModuleDerivationsDefinition`
- `EffectDef` / `EffectsDef` → `EffectDefinition` / `EffectsDefinition`
- `CrossModuleEffectDef` / `CrossModuleEffectsDef` → `CrossModuleEffectDefinition` / `CrossModuleEffectsDefinition`
- `EventsDef` / `TypedEventsDef` → `EventsDefinition` / `TypedEventsDefinition`
- `SourceDef` / `SourcesDef` → `SourceDefinition` / `SourcesDefinition`
- `SourcePublish` → `SourcePublishFn`
- `SourceUnsubscribe` → `SourceUnsubscribeFn`

### Explicit "no rename" decisions

- `EffectCleanup` — kept as-is (symmetric `EffectCleanupFn` rename
  deferred to a separate sweep tracked in a follow-up issue;
  asymmetry with `SourceUnsubscribeFn` documented).
- `MetaAccessor`, `EventsAccessor`, `DeriveAccessor` — `Meta` here is
  the term-of-art for the metadata-accessor pattern, not an
  abbreviation.
- `SchemaType`, `ModuleHooks`, `SystemConfig`, `SystemInspection`,
  `Snapshot` — already spelled out.

### Migration

```ts
// 1.x — both work, pick whichever reads better
import type { ModuleDef, SourceDef } from "@directive-run/core";        // canonical
import type { ModuleDefinition, SourceDefinition } from "@directive-run/core"; // forward-compat
```

### Verification

`packages/core/src/core/__tests__/rename-aliases.test-d.ts` smoke-tests
the 5 TS-inference edge cases per RFC 0006 (direct structural
identity, generic-constraint position, mapped-key position,
conditional distribution, tagged-union literal discriminant, barrel
re-export). If any alias breaks identity, `tsc --noEmit` rejects.

`packages/knowledge/core/anti-patterns.md` adds entry #21
("Abbreviating Type Names") so AI-generated code paths preferentially
emit the spelled-out names.

### 2.0 plan

Canonical declarations rename to `*Definition`; the `*Def` names
become the deprecated `@deprecated` aliases (same `export type { X as
Y }` shape, reversed direction). Touches ~21 packages across the
workspace; lands on its own dedicated 2.0 branch.
