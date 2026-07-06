# RFC 0006 – Spell out `*Def` type names across `@directive-run/core`

- **Status:** Accepted – shipped 2026-06-07 in `feat/source-primitive` (PR #52, merge `ab97b028`); pending v1.18.0 release
- **Author:** Jason Comes
- **Related:** anti-patterns entry #5 (`context` → `ctx` is wrong).

## Summary

`@directive-run/core` exports 22+ type names that abbreviate `Definition`
to `Def`: `ModuleDef`, `SourceDef`, `EffectsDef`, `ConstraintDef`,
`ResolverDef`, all `TypedXxxDef`, all `CrossModuleXxxDef`, etc. The
abbreviation cuts against how consumers actually read the API surface
because:

- The workspace's own `anti-patterns.md` entry #5 calls out abbreviating
  `context` to `ctx` as wrong. The same logic applies to type names.
- These types appear in autocomplete + hover documentation for every
  module / system / plugin author. They read as internal jargon.
- Minifiers handle the bytes regardless – source-code readability
  outweighs the keystroke savings.

This RFC renames every `*Def` to `*Definition` across the public surface,
with deprecated back-compat aliases through 1.x.

## Affected types (22+)

| Today | After |
|---|---|
| `ModuleDef` | `ModuleDefinition` |
| `ConstraintDef`, `ConstraintsDef` | `ConstraintDefinition`, `ConstraintsDefinition` |
| `TypedConstraintDef`, `TypedConstraintsDef` | `TypedConstraintDefinition`, `TypedConstraintsDefinition` |
| `CrossModuleConstraintDef`, `CrossModuleConstraintsDef` | `CrossModuleConstraintDefinition`, `CrossModuleConstraintsDefinition` |
| `DynamicConstraintDef` | `DynamicConstraintDefinition` |
| `ResolverDef`, `ResolversDef` | `ResolverDefinition`, `ResolversDefinition` |
| `TypedResolverDef`, `TypedResolversDef` | `TypedResolverDefinition`, `TypedResolversDefinition` |
| `AnyTypedResolverDef`, `SchemaTypedResolversDef` | `AnyTypedResolverDefinition`, `SchemaTypedResolversDefinition` |
| `DynamicResolverDef`, `MockResolverDef` | `DynamicResolverDefinition`, `MockResolverDefinition` |
| `DerivationDef`, `DerivationsDef` | `DerivationDefinition`, `DerivationsDefinition` |
| `TypedDerivationsDef`, `CrossModuleDerivationsDef` | `TypedDerivationsDefinition`, `CrossModuleDerivationsDefinition` |
| `DerivationDefWithMeta` | `DerivationDefinitionWithMeta` |
| `EffectDef`, `EffectsDef` | `EffectDefinition`, `EffectsDefinition` |
| `CrossModuleEffectDef`, `CrossModuleEffectsDef` | `CrossModuleEffectDefinition`, `CrossModuleEffectsDefinition` |
| `DynamicEffectDef` | `DynamicEffectDefinition` |
| `EventsDef`, `TypedEventsDef` | `EventsDefinition`, `TypedEventsDefinition` |
| `SourceDef`, `SourcesDef` | `SourceDefinition`, `SourcesDefinition` |
| `SourcePublish` | `SourcePublishFn` |
| `SourceUnsubscribe` | `SourceUnsubscribeFn` |

**Explicit "no-rename" decisions** (with reasoning):

- `EffectCleanup` → kept as-is for now (symmetric `EffectCleanupFn`
  rename deferred to a separate sweep; track in a follow-up issue).
- `MetaAccessor`, `EventsAccessor`, `DeriveAccessor` → kept as-is
  (`Meta` here is the term-of-art for the metadata-accessor pattern, not
  an abbreviation).
- `SchemaType`, `ModuleHooks`, `SystemConfig`, `SystemInspection`,
  `Snapshot` → already spelled out.

## Back-compat aliases

```ts
// packages/core/src/core/types.ts
/** @deprecated use ModuleDefinition (renamed in 1.x for readability) */
export type ModuleDef = ModuleDefinition;
// ...one per renamed type
```

Aliases ship through 1.x; removed in 2.0.

## Affected packages

Touches every package that imports a renamed type:

- `@directive-run/core` (origin)
- `@directive-run/react`, `query`, `timeline`, `mutator`, `optimistic`
- `@directive-run/vue`, `svelte`, `solid`, `lit`, `el`
- `@directive-run/scaffold`, `cli`, `lint`, `mcp`, `sandbox`, `claude-plugin`
- `@directive-run/sources` (post-rename)
- `@directive-run/vite-plugin-api-proxy`

Plus every `.md` in `packages/knowledge/` mentioning the old names
(excluding `api-skeleton.md` + `sitemap.md` – auto-generated; regen
those via `pnpm --filter @directive-run/knowledge generate-sitemap`).

## Verification (CI gates)

- `pnpm -r tsc --noEmit` – workspace-wide typecheck clean.
- `pnpm -r build` – every package builds; subpath exports + tree-shaking
  intact.
- `pnpm -r test` – per-package test counts: zero drops, zero skips.
- `pnpm --filter @directive-run/claude-plugin build && test` – bundled
  AI rules reflect renamed types.
- `pnpm tsx scripts/size-check.ts` against `size-budgets.json` – no
  regressions.
- New `packages/core/src/core/__tests__/rename-aliases.test-d.ts` –
  covers the 5 TS-inference edge cases where alias identity matters:
  generic constraint, mapped-key, conditional distribution,
  tagged-union literal, barrel re-export.
- External-consumer smoke: a production-consumer typecheck verifies
  the renamed types compose through the back-compat aliases (the
  external app consumes `ModuleDef` directly).

## Why an RFC and not a single fix commit

This rename is **mechanical** (find-and-replace across ~21 packages) but
**high-blast-radius**: every consumer's import statement changes (or
falls back to a deprecated alias and gets a warning). Bundling this
with any concurrent hardening work risks the rename getting bisected
into work it has nothing to do with. Shipping it as a dedicated branch
keeps the diff bisectable and the breaking-via-deprecation surface
explicit.

## Acceptance criteria

- Every type in the table above is renamed in its source declaration.
- A deprecated alias exists in `packages/core/src/core/types.ts` for
  every renamed type.
- All ~21 packages in the workspace typecheck + build + test clean.
- A new test file exercises the 5 TS-inference edge cases per renamed
  alias.
- `packages/knowledge/core/anti-patterns.md` adds an entry "Abbreviating
  type names" (analogous to entry #5 on `ctx`).
- Changeset describes the rename + the 1.x deprecation window.
